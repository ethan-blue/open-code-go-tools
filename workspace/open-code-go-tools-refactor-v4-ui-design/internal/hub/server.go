package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Server is the Hub HTTP server for cross-device sync.
type Server struct {
	store        *HubStore
	dataDir      string
	storeMu      sync.Mutex
	secret       string
	staleAfterMs int64
	host         string
	port         int
	sseClients   map[io.Writer]struct{}
	sseChans     map[io.Writer]chan struct{}
	sseMu        sync.Mutex
	listener     net.Listener
	httpServer   *http.Server
	logger       *log.Logger
}

// ServerOption holds configuration for creating a new Hub Server.
type ServerOption struct {
	Port         int
	Host         string
	Secret       string
	DataDir      string
	StaleAfterMs int64
	Logger       *log.Logger
}

const storeVersion = 1

// NewHubServer creates a new Hub HTTP server with the given options.
func NewHubServer(opt ServerOption) (*Server, error) {
	if opt.Port == 0 {
		opt.Port = DefaultHubPort
	}
	if opt.DataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("get home dir: %w", err)
		}
		opt.DataDir = filepath.Join(home, ".ocgt")
	}
	if opt.StaleAfterMs == 0 {
		opt.StaleAfterMs = DefaultStaleAfterMs
	}
	if opt.Logger == nil {
		opt.Logger = log.New(os.Stderr, "[hub] ", log.LstdFlags)
	}

	host := opt.Host
	if host == "" {
		if opt.Secret == "" {
			host = "127.0.0.1"
		} else {
			host = "0.0.0.0"
		}
	}

	s := &Server{
		secret:       opt.Secret,
		staleAfterMs: opt.StaleAfterMs,
		dataDir:      opt.DataDir,
		host:         host,
		port:         opt.Port,
		sseClients:   make(map[io.Writer]struct{}),
		sseChans:     make(map[io.Writer]chan struct{}),
		logger:       opt.Logger,
	}

	if err := s.loadStore(); err != nil {
		return nil, fmt.Errorf("load store: %w", err)
	}

	return s, nil
}

// Start starts the HTTP server in a background goroutine.
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.host, s.port)

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	s.listener = listener

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/stats", s.withAuth(s.handleStats))
	mux.HandleFunc("GET /api/stats/stream", s.withAuth(s.handleSSE))
	mux.HandleFunc("GET /api/devices", s.withAuth(s.handleDevices))
	mux.HandleFunc("DELETE /api/devices/{id}", s.withAuth(s.handleDeleteDevice))
	mux.HandleFunc("POST /api/ingest", s.withAuth(s.handleIngest))

	s.httpServer = &http.Server{
		Handler: mux,
	}

	s.logger.Printf("server listening on %s", s.listener.Addr())

	go func() {
		if err := s.httpServer.Serve(s.listener); err != nil && err != http.ErrServerClosed {
			s.logger.Printf("serve error: %v", err)
		}
	}()

	return nil
}

// Stop gracefully shuts down the HTTP server with a 5-second timeout.
func (s *Server) Stop() error {
	if s.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}

// Addr returns the address the server is listening on, or nil if not started.
func (s *Server) Addr() net.Addr {
	if s.listener != nil {
		return s.listener.Addr()
	}
	return nil
}

// ── Auth ──

// withAuth wraps a handler with authentication check.
// If secret is empty, all requests pass through (loopback-only enforced by binding).
// Otherwise, it checks Authorization: Bearer <secret> or X-OCGT-Secret header.
func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.secret == "" {
			next(w, r)
			return
		}

		token := ""
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token == "" {
			token = r.Header.Get("X-OCGT-Secret")
		}

		if token != s.secret {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		next(w, r)
	}
}

// ── Handlers ──

// handleHealth returns server health status (no auth required).
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.storeMu.Lock()
	deviceCount := len(s.store.Devices)
	s.storeMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":             true,
		"role":           "hub",
		"deviceCount":    deviceCount,
		"secretRequired": s.secret != "",
	})
}

// handleStats returns aggregated statistics for all devices.
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	resp := s.buildStatsResponse()
	writeJSON(w, http.StatusOK, resp)
}

// handleSSE provides real-time stats streaming via Server-Sent Events.
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Send initial snapshot
	resp := s.buildStatsResponse()
	data, _ := json.Marshal(resp)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()

	// Register client
	notify := make(chan struct{}, 1)
	s.sseMu.Lock()
	s.sseClients[w] = struct{}{}
	s.sseChans[w] = notify
	s.sseMu.Unlock()

	defer func() {
		s.sseMu.Lock()
		delete(s.sseClients, w)
		delete(s.sseChans, w)
		s.sseMu.Unlock()
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Heartbeat — SSE comment lines keep the connection alive
			fmt.Fprintf(w, ": hb\n\n")
			flusher.Flush()
		case <-notify:
			// Stats updated, push new snapshot
			resp := s.buildStatsResponse()
			data, _ := json.Marshal(resp)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handleDevices returns the list of all known devices with flat stats fields.
func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	resp := s.buildStatsResponse()
	if resp.Devices == nil {
		resp.Devices = []deviceStat{}
	}
	writeJSON(w, http.StatusOK, resp.Devices)
}

// handleDeleteDevice removes a device by its ID.
func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing device id"})
		return
	}

	s.storeMu.Lock()
	_, exists := s.store.Devices[id]
	if !exists {
		s.storeMu.Unlock()
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "device not found"})
		return
	}
	delete(s.store.Devices, id)
	if err := s.saveStore(); err != nil {
		s.logger.Printf("save store after delete: %v", err)
	}
	s.storeMu.Unlock()

	go s.sseBroadcast()

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// handleIngest receives a SyncPayload push from a device.
func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	var payload SyncPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)

	s.storeMu.Lock()
	if s.store.Devices == nil {
		s.store.Devices = make(map[string]DeviceRecord)
	}

	record := DeviceRecord{
		DeviceID:    payload.DeviceID,
		DisplayName: payload.DisplayName,
		Hostname:    payload.Hostname,
		Platform:    payload.Platform,
		Version:     payload.Version,
		UpdatedAt:   payload.UpdatedAt,
		ReceivedAt:  now,
		Periods: map[string]PeriodStats{
			PeriodToday:   payload.Today,
			PeriodMonth:   payload.Month,
			PeriodAllTime: payload.AllTime,
		},
	}
	s.store.Devices[payload.DeviceID] = record

	if err := s.saveStore(); err != nil {
		s.logger.Printf("save store: %v", err)
	}
	s.storeMu.Unlock()

	go s.sseBroadcast()

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// ── SSE Broadcast ──

// sseBroadcast notifies all connected SSE clients to refresh their stats.
func (s *Server) sseBroadcast() {
	s.sseMu.Lock()
	defer s.sseMu.Unlock()
	for _, ch := range s.sseChans {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// ── Stats Aggregation ──

// statsResponse is the JSON response structure for the /api/stats endpoint.
type statsResponse struct {
	UpdatedAt string       `json:"updatedAt"`
	Today     PeriodStats  `json:"today"`
	Month     PeriodStats  `json:"month"`
	AllTime   PeriodStats  `json:"allTime"`
	Devices   []deviceStat `json:"devices"`
}

// deviceStat is the per-device entry within statsResponse.
type deviceStat struct {
	DeviceID    string      `json:"deviceId"`
	DisplayName string      `json:"displayName,omitempty"`
	Hostname    string      `json:"hostname,omitempty"`
	Platform    string      `json:"platform,omitempty"`
	Version     string      `json:"version,omitempty"`
	UpdatedAt   string      `json:"updatedAt"`
	ReceivedAt  string      `json:"receivedAt"`
	Stale       bool        `json:"stale"`
	Today       PeriodStats `json:"today"`
	Month       PeriodStats `json:"month"`
	AllTime     PeriodStats `json:"allTime"`
}

// buildStatsResponse aggregates all device data into a single stats response.
func (s *Server) buildStatsResponse() statsResponse {
	s.storeMu.Lock()
	defer s.storeMu.Unlock()

	resp := statsResponse{
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Today: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
		Month: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
		AllTime: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
	}

	now := time.Now()

	for _, dev := range s.store.Devices {
		ds := deviceStat{
			DeviceID:    dev.DeviceID,
			DisplayName: dev.DisplayName,
			Hostname:    dev.Hostname,
			Platform:    dev.Platform,
			Version:     dev.Version,
			UpdatedAt:   dev.UpdatedAt,
			ReceivedAt:  dev.ReceivedAt,
		}

		// Stale check: device hasn't reported within staleAfterMs
		if s.staleAfterMs > 0 {
			receivedAt, err := time.Parse(time.RFC3339, dev.ReceivedAt)
			if err == nil && now.Sub(receivedAt).Milliseconds() > s.staleAfterMs {
				ds.Stale = true
			}
		}

		// Aggregate periods
		if dev.Periods != nil {
			ds.Today = dev.Periods[PeriodToday]
			ds.Month = dev.Periods[PeriodMonth]
			ds.AllTime = dev.Periods[PeriodAllTime]

			accumulatePeriodStats(&resp.Today, ds.Today)
			accumulatePeriodStats(&resp.Month, ds.Month)
			accumulatePeriodStats(&resp.AllTime, ds.AllTime)
		}

		resp.Devices = append(resp.Devices, ds)
	}

	// Sort by receivedAt descending (most recent first)
	sort.Slice(resp.Devices, func(i, j int) bool {
		return resp.Devices[i].ReceivedAt > resp.Devices[j].ReceivedAt
	})

	return resp
}

// accumulatePeriodStats adds all fields from src PeriodStats into target.
func accumulatePeriodStats(target *PeriodStats, src PeriodStats) {
	target.TotalTokens += src.TotalTokens
	target.EstimatedCost += src.EstimatedCost
	target.InputTokens += src.InputTokens
	target.OutputTokens += src.OutputTokens
	target.CacheReadTokens += src.CacheReadTokens
	target.CacheCreateTokens += src.CacheCreateTokens

	addDimStatsMap(target.ByModel, src.ByModel)
	addDimStatsMap(target.ByRoute, src.ByRoute)
	addDimStatsMap(target.ByClient, src.ByClient)
}

// addDimStatsMap merges src dimension stats into target.
func addDimStatsMap(target, src map[string]DimStats) {
	if src == nil {
		return
	}
	for k, v := range src {
		d := target[k]
		d.Tokens += v.Tokens
		d.Cost += v.Cost
		d.InputTokens += v.InputTokens
		d.OutputTokens += v.OutputTokens
		target[k] = d
	}
}

// ── Persistence ──

// storeFilePath returns the full path to the devices.json store file.
func (s *Server) storeFilePath() string {
	return filepath.Join(s.dataDir, "devices.json")
}

// saveStore atomically writes the current store to disk (temp file + rename).
func (s *Server) saveStore() error {
	s.store.SavedAt = time.Now().UTC().Format(time.RFC3339)

	data, err := json.MarshalIndent(s.store, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal store: %w", err)
	}

	path := s.storeFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create store dir: %w", err)
	}

	// Atomic write: write to temp file, then rename to target
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return fmt.Errorf("write store tmp: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath) // best-effort cleanup
		return fmt.Errorf("rename store: %w", err)
	}

	return nil
}

// loadStore reads the store from disk, or initializes an empty store if the file
// does not exist.
func (s *Server) loadStore() error {
	path := s.storeFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			s.store = &HubStore{
				Version: storeVersion,
				SavedAt: time.Now().UTC().Format(time.RFC3339),
				Devices: make(map[string]DeviceRecord),
			}
			return nil
		}
		return fmt.Errorf("read store: %w", err)
	}

	var store HubStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("unmarshal store: %w", err)
	}
	if store.Devices == nil {
		store.Devices = make(map[string]DeviceRecord)
	}
	s.store = &store
	return nil
}

// ── Helpers ──

// writeJSON is a convenience function for writing a JSON response.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
