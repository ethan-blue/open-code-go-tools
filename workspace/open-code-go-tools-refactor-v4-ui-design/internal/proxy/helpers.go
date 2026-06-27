package proxy

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

func copyHeaders(dst, src http.Header) {
	for k, values := range src {
		dst.Del(k)
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func stripHopByHopHeaders(h http.Header) {
	for _, key := range []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade"} {
		h.Del(key)
	}
}

var copyBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 32*1024)
		return &buf
	},
}

func copyResponse(w http.ResponseWriter, body io.Reader) (int64, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return io.Copy(w, body)
	}
	bufp := copyBufPool.Get().(*[]byte)
	defer copyBufPool.Put(bufp)
	buf := *bufp
	var written int64
	for {
		n, readErr := body.Read(buf)
		if n > 0 {
			m, writeErr := w.Write(buf[:n])
			written += int64(m)
			if writeErr != nil {
				return written, writeErr
			}
			if m != n {
				return written, io.ErrShortWrite
			}
			flusher.Flush()
		}
		if readErr != nil {
			if readErr == io.EOF {
				return written, nil
			}
			return written, readErr
		}
	}
}

func estimateTokens(payload anthropicRequest) int {
	var sb strings.Builder
	sb.WriteString(payload.Model)
	sb.WriteByte('\n')
	sb.WriteString(blocksToText(payload.System))
	for _, msg := range payload.Messages {
		sb.WriteByte('\n')
		sb.WriteString(msg.Role)
		sb.WriteByte(':')
		sb.WriteString(blocksToText(msg.Content))
	}
	for _, tool := range payload.Tools {
		sb.WriteByte('\n')
		sb.WriteString(tool.Name)
		sb.WriteByte(':')
		sb.WriteString(tool.Description)
	}
	// CJK characters typically use 2-3 tokens each vs ~4 chars per token for ASCII.
	// Count non-ASCII runes more heavily.
	tokenEstimate := 0
	for _, r := range sb.String() {
		if r > 127 {
			tokenEstimate += 3 // CJK characters roughly 2-3 tokens each
		} else {
			tokenEstimate++ // ASCII characters, ~4 per token
		}
	}
	return tokenEstimate/4 + 1
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"type": "ocgt_error", "message": err.Error()}})
}

func proxyErrorStatus(err error) int {
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return http.StatusGatewayTimeout
	}
	return http.StatusBadGateway
}

func writeProxyError(w http.ResponseWriter, err error) {
	writeError(w, proxyErrorStatus(err), err)
}

func writeUpstreamError(w http.ResponseWriter, status int, body []byte) {
	if len(body) == 0 {
		writeError(w, status, fmt.Errorf("upstream returned %d", status))
		return
	}
	// Sanitize: truncate to prevent leaking sensitive details
	msg := strings.TrimSpace(string(body))
	if len(msg) > 200 {
		msg = msg[:200] + "..."
	}
	// Clean up common patterns that leak internal info
	msg = sanitizeErrorMessage(msg)
	writeError(w, status, fmt.Errorf("%s", msg))
}

func sanitizeErrorMessage(msg string) string {
	// Remove potential sensitive patterns
	msg = strings.ReplaceAll(msg, "\\n", " ")
	msg = strings.ReplaceAll(msg, "\n", " ")
	msg = strings.ReplaceAll(msg, "\r", "")
	// Collapse repeated spaces
	for strings.Contains(msg, "  ") {
		msg = strings.ReplaceAll(msg, "  ", " ")
	}
	return strings.TrimSpace(msg)
}

func upstreamErrorSummary(status int, body []byte) string {
	if len(body) == 0 {
		return fmt.Sprintf("upstream returned %d", status)
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err == nil {
		if msg := nestedString(raw, "error", "message"); msg != "" {
			return msg
		}
		if msg := nestedString(raw, "error", "type"); msg != "" {
			return msg
		}
		if msg, _ := raw["message"].(string); msg != "" {
			return msg
		}
		if msg, _ := raw["error"].(string); msg != "" {
			return msg
		}
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 240 {
		text = text[:240] + "..."
	}
	return text
}

func nestedString(raw map[string]any, keys ...string) string {
	var cur any = raw
	for _, key := range keys {
		obj, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = obj[key]
	}
	value, _ := cur.(string)
	return value
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Enable CORS for frontend API requests - restrict to localhost origins
		origin := r.Header.Get("Origin")
		if origin != "" {
			// Only allow localhost origins for security
			if isLocalhostOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Ocgt-Profile, X-Ocgt-Client, X-Ocgt-Local-Token")
			}
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		method := strings.ReplaceAll(r.Method, "\n", "\\n")
		path := strings.ReplaceAll(r.URL.RequestURI(), "\n", "\\n")
		status := rec.status
		duration := time.Since(start).Round(time.Millisecond)
		go log.Printf("%s %s status=%d %s", method, path, status, duration)
	})
}

// isLocalhostOrigin checks if an origin is a localhost address
func isLocalhostOrigin(origin string) bool {
	// Allow non-HTTP origins (wails://)
	if strings.HasPrefix(origin, "wails://") || strings.HasPrefix(origin, "http://wails.localhost") || strings.HasPrefix(origin, "https://wails.localhost") {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// authMiddleware checks for local auth token if configured
func authMiddleware(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check and OPTIONS
		if r.URL.Path == "/healthz" || r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth for static web assets
		if strings.HasPrefix(r.URL.Path, "/ocgt/web/") || r.URL.Path == "/" {
			next.ServeHTTP(w, r)
			return
		}

		// Check auth token if configured using constant-time comparison
		if token != "" {
			providedToken := r.Header.Get("X-Ocgt-Local-Token")
			if providedToken == "" {
				// Also check Authorization header with Bearer prefix
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					providedToken = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}
			// Use constant-time comparison to prevent timing attacks
			if subtle.ConstantTimeCompare([]byte(providedToken), []byte(token)) != 1 {
				writeError(w, http.StatusUnauthorized, errors.New("invalid or missing auth token"))
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// rateLimiter implements a simple in-memory rate limiter using token bucket algorithm
type rateLimiter struct {
	mu        sync.Mutex
	clients   map[string]*clientBucket
	rate      int           // requests per second
	burst     int           // max burst size
	cleanup   time.Duration // cleanup interval
	lastClean time.Time
}

type clientBucket struct {
	tokens   float64
	lastSeen time.Time
}

// newRateLimiter creates a new rate limiter with the specified rate and burst
func newRateLimiter(rate, burst int) *rateLimiter {
	return &rateLimiter{
		clients:   make(map[string]*clientBucket),
		rate:      rate,
		burst:     burst,
		cleanup:   time.Minute,
		lastClean: time.Now(),
	}
}

func (rl *rateLimiter) setLimits(rate, burst int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.rate = rate
	rl.burst = burst
	for _, bucket := range rl.clients {
		if bucket.tokens > float64(burst) {
			bucket.tokens = float64(burst)
		}
	}
}

// allow checks if a request from the given client IP is allowed
func (rl *rateLimiter) allow(clientIP string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Cleanup old entries periodically
	if now.Sub(rl.lastClean) > rl.cleanup {
		for ip, bucket := range rl.clients {
			if now.Sub(bucket.lastSeen) > rl.cleanup {
				delete(rl.clients, ip)
			}
		}
		rl.lastClean = now
	}

	bucket, exists := rl.clients[clientIP]
	if !exists {
		bucket = &clientBucket{
			tokens:   float64(rl.burst),
			lastSeen: now,
		}
		rl.clients[clientIP] = bucket
	}

	// Refill tokens based on time elapsed
	elapsed := now.Sub(bucket.lastSeen).Seconds()
	bucket.tokens = min(float64(rl.burst), bucket.tokens+elapsed*float64(rl.rate))
	bucket.lastSeen = now

	if bucket.tokens >= 1 {
		bucket.tokens--
		return true
	}
	return false
}

// rateLimitMiddleware creates a middleware that limits requests per client IP
func rateLimitMiddleware(rl *rateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip rate limiting for health checks and OPTIONS
		if r.URL.Path == "/healthz" || r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		// Get client IP
		clientIP := getClientIP(r)

		if !rl.allow(clientIP) {
			writeError(w, http.StatusTooManyRequests, errors.New("rate limit exceeded (per second), please try again later"))
			return
		}

		next.ServeHTTP(w, r)
	})
}

// rpmLimitMiddleware creates a middleware that limits requests per minute per client IP
func rpmLimitMiddleware(rl *rpmLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip rate limiting for health checks and OPTIONS
		if r.URL.Path == "/healthz" || r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		clientIP := getClientIP(r)

		if !rl.allow(clientIP) {
			writeError(w, http.StatusTooManyRequests, errors.New("quota limit exceeded (requests per minute), please try again later"))
			return
		}

		next.ServeHTTP(w, r)
	})
}

// rpmLimiter implements a simple sliding window counter for Requests Per Minute
type rpmLimiter struct {
	mu       sync.Mutex
	clients  map[string]*rpmBucket
	limit    int // max requests per minute
}

type rpmBucket struct {
	count    int
	windowStart time.Time
}

func newRpmLimiter(limit int) *rpmLimiter {
	return &rpmLimiter{
		clients: make(map[string]*rpmBucket),
		limit:   limit,
	}
}

func (rl *rpmLimiter) setLimit(limit int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.limit = limit
}

func (rl *rpmLimiter) allow(clientIP string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if rl.limit <= 0 {
		return true
	}
	now := time.Now()
	bucket, exists := rl.clients[clientIP]
	if !exists {
		bucket = &rpmBucket{
			count:       0,
			windowStart: now,
		}
		rl.clients[clientIP] = bucket
	}

	// Reset window if more than 1 minute has passed
	if now.Sub(bucket.windowStart) >= time.Minute {
		bucket.count = 0
		bucket.windowStart = now
	}

	if bucket.count < rl.limit {
		bucket.count++
		return true
	}
	return false
}

// getClientIP extracts the client IP from the request, returning a canonical
// form so that the same host always produces the same rate-limit key.
func getClientIP(r *http.Request) string {
	// Use the actual TCP connection address as the primary source of truth.
	// X-Forwarded-For is ONLY trusted when the request comes from a known proxy
	// (e.g. localhost), otherwise it can be spoofed.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}

	// Normalize: strip brackets from IPv6 (e.g. "[::1]" → "::1") and
	// convert to the canonical net.IP string representation so that
	// bracketed/unbracketed and port-bearing variants all map to the
	// same rate-limit bucket.
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	if ip := net.ParseIP(host); ip != nil {
		host = ip.String()
	}

	// Only trust X-Forwarded-For when the direct connection is from localhost
	if host == "127.0.0.1" || host == "::1" || host == "localhost" {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if idx := strings.Index(xff, ","); idx != -1 {
				return strings.TrimSpace(xff[:idx])
			}
			return strings.TrimSpace(xff)
		}
		if xri := r.Header.Get("X-Real-IP"); xri != "" {
			return strings.TrimSpace(xri)
		}
	}

	return host
}
