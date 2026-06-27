package quota

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	openCodeGoBaseURL = "https://opencode.ai"
	serverURL         = "https://opencode.ai/_server"

	// From codexbar 0.32.4 — TanStack server function ID for workspace resolution.
	// Can break when opencode.ai redeploys.
	workspacesServerID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f"
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

// QuotaUsage represents quota usage for a single time dimension.
type QuotaUsage struct {
	Status       string `json:"status"`        // "active" or "unlimited"
	UsagePercent int    `json:"usage_percent"`  // 0–100
	ResetInSec   int    `json:"reset_in_sec"`
	ResetDisplay string `json:"reset_display"`  // compact duration: "2h", "30m", "5d"
}

// QuotaData holds rolling / weekly / monthly quota info.
type QuotaData struct {
	Rolling   QuotaUsage  `json:"rolling"`
	Weekly    QuotaUsage  `json:"weekly"`
	Monthly   *QuotaUsage `json:"monthly,omitempty"`
	FetchedAt time.Time   `json:"fetched_at"`
}

// QuotaResult is the JSON API response envelope.
type QuotaResult struct {
	Success      bool       `json:"success"`
	ProviderName string     `json:"provider_name"`
	Data         *QuotaData `json:"data,omitempty"`
	Error        string     `json:"error,omitempty"`
}

// --- page scraping types (fallback) ---

// pageGoUsage mirrors the JSON shape embedded in the /workspace/{id}/go page.
type pageGoUsage struct {
	Rolling *windowData `json:"rollingUsage"`
	Weekly  *windowData `json:"weeklyUsage"`
	Monthly *windowData `json:"monthlyUsage"`
}

type windowData struct {
	Status       *string  `json:"status"`
	UsagePercent *float64 `json:"usagePercent"`
	UsedPercent  *float64 `json:"usedPercent"`
	ResetInSec   *float64 `json:"resetInSec"`
}

// --- RPC types ---

type serverRequest struct {
	ServerID string
	Args     []any
	Method   string
	Referer  string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// FetchOpenCodeGoQuota retrieves current OpenCode Go quota.
// Strategy:
//  1. Primary: auto-resolve workspace ID via _server RPC, then scrape page
//  2. Fallback: scrape page with provided workspaceID (if primary fails)
//
// cookie is the opencode.ai session cookie. workspaceID is optional (wrk_xxx).
func FetchOpenCodeGoQuota(cookie, workspaceID string) (*QuotaData, error) {
	cookie = sanitizeCookie(cookie)
	if cookie == "" {
		return nil, fmt.Errorf("OpenCode Go auth cookie not configured (see quota_cookie in profile config)")
	}

	// Primary: auto-resolve workspace ID then scrape page
	if resolvedID, err := resolveWorkspaceID(cookie); err == nil {
		if data, err := fetchQuotaViaPage(cookie, resolvedID); err == nil {
			return data, nil
		}
	}

	// Fallback: try page scraping with user-provided workspace ID
	if workspaceID != "" {
		if data, err := fetchQuotaViaPage(cookie, workspaceID); err == nil {
			return data, nil
		}
	}

	return nil, fmt.Errorf("failed to fetch quota — check your cookie")
}

// CredentialsFromEnv reads OpenCode Go credentials from environment variables.
func CredentialsFromEnv() (cookie, workspaceID string) {
	cookie = os.Getenv("OPENCODE_GO_AUTH_COOKIE")
	workspaceID = os.Getenv("OPENCODE_GO_WORKSPACE_ID")
	return
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

// sanitizeCookie normalises a raw cookie string: strips "cookie:" prefix,
// trims whitespace, normalises separator, and wraps bare values as "auth=".
func sanitizeCookie(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	// Strip "cookie:" prefix (case-insensitive)
	text = regexp.MustCompile(`(?i)^cookie\s*:\s*`).ReplaceAllString(text, "")
	// Split and rejoin to normalize
	parts := strings.Split(text, ";")
	var cleaned []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			cleaned = append(cleaned, p)
		}
	}
	if len(cleaned) == 0 {
		return ""
	}
	result := strings.Join(cleaned, "; ")
	// Bare value without "name=" => treat as auth session cookie
	if !strings.Contains(result, "=") {
		return "auth=" + result
	}
	return result
}

// ---------------------------------------------------------------------------
// _server RPC helpers
// ---------------------------------------------------------------------------

// callServer sends a request to the opencode.ai _server RPC endpoint.
// Returns the raw response text and HTTP status code.
func callServer(req serverRequest, cookie string) (string, int, error) {
	var reqURL string
	if req.Method == "GET" {
		u := fmt.Sprintf("%s?id=%s", serverURL, req.ServerID)
		if len(req.Args) > 0 {
			argsJSON, err := json.Marshal(req.Args)
			if err != nil {
				return "", 0, fmt.Errorf("marshal args: %w", err)
			}
			u += "&args=" + url.QueryEscape(string(argsJSON))
		}
		reqURL = u
	} else {
		reqURL = serverURL
	}

	httpReq, err := http.NewRequest(req.Method, reqURL, nil)
	if err != nil {
		return "", 0, fmt.Errorf("build request: %w", err)
	}

	if req.Method != "GET" && len(req.Args) > 0 {
		body, _ := json.Marshal(req.Args)
		httpReq.Body = io.NopCloser(bytes.NewReader(body))
		httpReq.Method = "POST"
		httpReq.Header.Set("Content-Type", "application/json")
	}

	httpReq.Header.Set("Cookie", cookie)
	httpReq.Header.Set("X-Server-Id", req.ServerID)
	httpReq.Header.Set("X-Server-Instance", "server-fn:"+randHex(16))
	httpReq.Header.Set("User-Agent", userAgent)
	httpReq.Header.Set("Origin", openCodeGoBaseURL)
	if req.Referer != "" {
		httpReq.Header.Set("Referer", req.Referer)
	} else {
		httpReq.Header.Set("Referer", openCodeGoBaseURL)
	}
	httpReq.Header.Set("Accept", "text/javascript, application/json;q=0.9, */*;q=0.8")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", 0, fmt.Errorf("call server: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return string(body), resp.StatusCode, nil
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// ---------------------------------------------------------------------------
// Workspace ID resolution
// ---------------------------------------------------------------------------

// parseWorkspaceIDs extracts wrk_xxx IDs from HTTP responses. Handles both
// text/javascript (id: "wrk_xxx") and JSON formats.
func parseWorkspaceIDs(text string) []string {
	seen := map[string]bool{}
	var ids []string

	// Regex for JS/text format: id: "wrk_xxx" or id="wrk_xxx"
	re := regexp.MustCompile(`id\s*[:=]\s*"(wrk_[^"]+)"`)
	for _, m := range re.FindAllStringSubmatch(text, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			ids = append(ids, m[1])
		}
	}
	if len(ids) > 0 {
		return ids
	}
	// Try JSON parse
	var doc any
	if err := json.Unmarshal([]byte(text), &doc); err != nil {
		return nil
	}
	var walk func(any)
	walk = func(v any) {
		switch val := v.(type) {
		case string:
			if strings.HasPrefix(val, "wrk_") && !seen[val] {
				seen[val] = true
				ids = append(ids, val)
			}
		case []any:
			for _, item := range val {
				walk(item)
			}
		case map[string]any:
			for _, item := range val {
				walk(item)
			}
		}
	}
	walk(doc)
	return ids
}

// looksLikeSignedOut checks if the response indicates the user is not logged in.
func looksLikeSignedOut(text string) bool {
	lower := strings.ToLower(text)
	keywords := []string{"login", "sign in", "auth/authorize",
		"not associated with an account", `actor of type "public"`}
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// resolveWorkspaceID resolves the active opencode.ai workspace ID via the
// _server RPC endpoint. Tries GET first, then POST as fallback.
func resolveWorkspaceID(cookie string) (string, error) {
	const ref = "https://opencode.ai"

	wsResp, wsCode, err := callServer(serverRequest{
		ServerID: workspacesServerID,
		Args:     nil,
		Method:   "GET",
		Referer:  ref,
	}, cookie)
	if err != nil {
		return "", fmt.Errorf("call workspaces: %w", err)
	}
	if wsCode == 401 || wsCode == 403 || looksLikeSignedOut(wsResp) {
		return "", fmt.Errorf("unauthorized: cookie may be expired")
	}
	ids := parseWorkspaceIDs(wsResp)
	if len(ids) > 0 {
		return ids[0], nil
	}

	// Retry with POST (some opencode.ai versions require POST)
	wsResp, wsCode, err = callServer(serverRequest{
		ServerID: workspacesServerID,
		Args:     []any{},
		Method:   "POST",
		Referer:  ref,
	}, cookie)
	if err != nil {
		return "", fmt.Errorf("call workspaces (post): %w", err)
	}
	if wsCode == 401 || wsCode == 403 || looksLikeSignedOut(wsResp) {
		return "", fmt.Errorf("unauthorized: cookie may be expired")
	}
	ids = parseWorkspaceIDs(wsResp)
	if len(ids) == 0 {
		return "", fmt.Errorf("no workspace found for this account")
	}
	return ids[0], nil
}

// ---------------------------------------------------------------------------
// Page scraping
// ---------------------------------------------------------------------------

// fetchQuotaViaPage scrapes the /workspace/{id}/go page as a fallback when
// the _server RPC method fails. Uses the same Accept header as token-monitor.
func fetchQuotaViaPage(cookie, workspaceID string) (*QuotaData, error) {
	pageURL := fmt.Sprintf("%s/workspace/%s/go", openCodeGoBaseURL, workspaceID)
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch quota page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 429 {
		return nil, fmt.Errorf("page returned %d", resp.StatusCode)
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("page returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return parseGoUsage(string(body))
}

// parseGoUsage tries JSON first, then falls back to regex.
func parseGoUsage(text string) (*QuotaData, error) {
	data, err := parseGoUsageJSON(text)
	if err == nil && data != nil {
		return data, nil
	}
	return parseGoUsageRegex(text)
}

// parseGoUsageJSON attempts to unmarshal the page body as JSON.
func parseGoUsageJSON(text string) (*QuotaData, error) {
	var page pageGoUsage
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		return nil, err
	}
	if page.Rolling == nil || page.Weekly == nil {
		return nil, fmt.Errorf("incomplete JSON: missing rolling or weekly data")
	}
	rolling := buildUsage(toStatus(page.Rolling), toPct(page.Rolling), toSec(page.Rolling))
	weekly := buildUsage(toStatus(page.Weekly), toPct(page.Weekly), toSec(page.Weekly))
	var monthly *QuotaUsage
	if page.Monthly != nil {
		m := buildUsage(toStatus(page.Monthly), toPct(page.Monthly), toSec(page.Monthly))
		if m.Status != "unlimited" {
			monthly = &m
		}
	}
	return &QuotaData{
		Rolling:   rolling,
		Weekly:    weekly,
		Monthly:   monthly,
		FetchedAt: time.Now(),
	}, nil
}

// parseGoUsageRegex extracts window data from text/javascript responses (fallback).
func parseGoUsageRegex(text string) (*QuotaData, error) {
	type windowMatch struct {
		pct     int
		resetMs int
	}
	extract := func(key string) (windowMatch, bool) {
		pctRe := regexp.MustCompile(key + `[^}]*?usagePercent"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)`)
		pm := pctRe.FindStringSubmatch(text)
		if pm == nil {
			return windowMatch{}, false
		}
		resetRe := regexp.MustCompile(key + `[^}]*?resetInSec"?\s*[:=]\s*([0-9]+)`)
		rm := resetRe.FindStringSubmatch(text)
		resetSec := 0
		if rm != nil {
			resetSec, _ = strconv.Atoi(rm[1])
		}
		return windowMatch{
			pct:     clampPct(int(parseFloat(pm[1]))),
			resetMs: resetSec,
		}, true
	}

	rolling, rok := extract("rollingUsage")
	weekly, wok := extract("weeklyUsage")
	if !rok || !wok {
		return nil, fmt.Errorf("failed to parse usagePercent from page response")
	}

	result := &QuotaData{
		Rolling:   buildUsage("", rolling.pct, rolling.resetMs),
		Weekly:    buildUsage("", weekly.pct, weekly.resetMs),
		FetchedAt: time.Now(),
	}
	if monthly, mok := extract("monthlyUsage"); mok {
		m := buildUsage("", monthly.pct, monthly.resetMs)
		if m.Status != "unlimited" {
			result.Monthly = &m
		}
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Helpers (shared between RPC and page-scraping paths)
// ---------------------------------------------------------------------------

func toStatus(w *windowData) string {
	if w.Status != nil {
		return *w.Status
	}
	return ""
}

func toPct(w *windowData) int {
	if w.UsagePercent != nil {
		return clampPct(int(*w.UsagePercent))
	}
	if w.UsedPercent != nil {
		return clampPct(int(*w.UsedPercent))
	}
	return 0
}

func toSec(w *windowData) int {
	if w.ResetInSec != nil {
		return int(*w.ResetInSec)
	}
	return 0
}

func buildUsage(status string, pct, resetSec int) QuotaUsage {
	if status == "" {
		status = "active"
	}
	return QuotaUsage{
		Status:       status,
		UsagePercent: pct,
		ResetInSec:   resetSec,
		ResetDisplay: formatDurationCompact(resetSec),
	}
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func clampPct(pct int) int {
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}

// formatDurationCompact formats a duration in seconds as a compact human-readable string.
func formatDurationCompact(seconds int) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	if seconds < 3600 {
		return fmt.Sprintf("%dm", seconds/60)
	}
	if seconds < 86400 {
		return fmt.Sprintf("%dh", seconds/3600)
	}
	return fmt.Sprintf("%dd", seconds/86400)
}
