package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	"github.com/ethan-blue/open-code-go-tools/internal/session"
	"github.com/ethan-blue/open-code-go-tools/internal/version"
)

func (s *Server) apiStatus(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	activeProfile := s.config.ActiveProfile
	profile, _, _ := s.config.Profile(activeProfile)
	listen := s.config.Listen
	upstream := s.config.Upstream
	timeoutSeconds := s.config.RequestTimeoutSeconds
	thinkingBudgetTokens := s.config.ThinkingBudgetTokens()
	rateLimitPerSecond, rateLimitBurst := s.config.RateLimit()
	rateLimitPerMinute := s.config.RateLimitPerMinute
	claudeEnv := map[string]string{}
	if len(s.config.ClaudeEnv) > 0 {
		for key, value := range s.config.ClaudeEnv {
			claudeEnv[key] = value
		}
	} else {
		claudeEnv = config.DefaultClaudeEnv(profile)
	}
	authEnabled := s.config.LocalAuthToken != ""
	configPath := s.configPath
	s.configMu.RUnlock()

	type providerStatus struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		Line             string `json:"line"`
		BaseURL          string `json:"base_url"`
		DefaultModel     string `json:"default_model"`
		Protocol         string `json:"protocol"`
		Enabled          bool   `json:"enabled"`
		APIKeyConfigured bool   `json:"api_key_configured"`
	}
	providerView := func(line string, fallbackModel string) providerStatus {
		if strings.TrimSpace(s.configDir) == "" {
			return providerStatus{
				ID:               activeProfile,
				Name:             activeProfile,
				Line:             line,
				BaseURL:          upstream,
				DefaultModel:     fallbackModel,
				Enabled:          true,
				APIKeyConfigured: profile.APIKeyValue() != "",
			}
		}
		if provider, ok := s.ensureStore().Active(line); ok {
			model := strings.TrimSpace(provider.DefaultModel)
			if model == "" {
				model = fallbackModel
			}
			return providerStatus{
				ID:               provider.ID,
				Name:             provider.Name,
				Line:             line,
				BaseURL:          provider.BaseURL,
				DefaultModel:     model,
				Protocol:         provider.Protocol,
				Enabled:          provider.Enabled,
				APIKeyConfigured: provider.HasCredential() || profile.APIKeyValue() != "",
			}
		}
		return providerStatus{
			ID:               activeProfile,
			Name:             activeProfile,
			Line:             line,
			BaseURL:          upstream,
			DefaultModel:     fallbackModel,
			Enabled:          true,
			APIKeyConfigured: profile.APIKeyValue() != "",
		}
	}
	claudeProvider := providerView("claude", profile.DefaultModel)
	codexProvider := providerView("codex", profile.DefaultModel)

	status := map[string]any{
		"status":                     "running",
		"listen":                     listen,
		"upstream":                   upstream,
		"request_timeout_seconds":    timeoutSeconds,
		"max_thinking_budget_tokens": thinkingBudgetTokens,
		"rate_limit_per_second":      rateLimitPerSecond,
		"rate_limit_burst":           rateLimitBurst,
		"rate_limit_per_minute":      rateLimitPerMinute,
		"claude_env":                 claudeEnv,
		"api_key_configured":         profile.APIKeyValue() != "",
		"config_path":                configPath,
		"active_profile":             activeProfile,
		"default_model":              profile.DefaultModel,
		"auth_enabled":               authEnabled,
		"uptime_seconds":             int(time.Since(s.startedAt).Seconds()),
		"providers": map[string]any{
			"claude": claudeProvider,
			"codex":  codexProvider,
		},
	}
	writeJSON(w, http.StatusOK, status)
}

// maskAPIKey returns a masked version of the key showing only the first 4 and last 4 chars.
// If the key is empty or too short, returns an appropriate placeholder.
func maskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "..." + key[len(key)-4:]
}

func (s *Server) apiSetKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var req struct {
		Profile                 string            `json:"profile"`
		APIKey                  string            `json:"api_key"`
		DefaultModel            string            `json:"default_model"`
		ModelAliases            map[string]string `json:"model_aliases"`
		RequestTimeoutSeconds   int               `json:"request_timeout_seconds"`
		MaxThinkingBudgetTokens int               `json:"max_thinking_budget_tokens"`
		Upstream                string            `json:"upstream"`
		Listen                  string            `json:"listen"`
		RateLimitPerSecond      int               `json:"rate_limit_per_second"`
		RateLimitBurst          int               `json:"rate_limit_burst"`
		RateLimitPerMinute      *int              `json:"rate_limit_per_minute"`
		ClaudeEnv               map[string]string `json:"claude_env"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	s.configMu.Lock()
	defer s.configMu.Unlock()

	profileName := req.Profile
	if profileName == "" {
		profileName = s.config.ActiveProfile
	}

	// Profile map is optional since v4. When present, mirror key/model/aliases
	// into it for backward compatibility; when absent, just apply global fields.
	var p config.Profile
	if s.config.Profiles != nil {
		var ok bool
		p, ok = s.config.Profiles[profileName]
		if !ok && profileName != "" {
			// Tolerate a missing name rather than hard-failing the whole save.
			p = config.Profile{}
		}
	}
	if req.RequestTimeoutSeconds != 0 && (req.RequestTimeoutSeconds < 1 || req.RequestTimeoutSeconds > 3600) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("request_timeout_seconds must be between 1 and 3600, got %d", req.RequestTimeoutSeconds))
		return
	}
	if req.MaxThinkingBudgetTokens != 0 && (req.MaxThinkingBudgetTokens < -1 || req.MaxThinkingBudgetTokens > 8192) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("max_thinking_budget_tokens must be -1, 0, or between 1 and 8192, got %d", req.MaxThinkingBudgetTokens))
		return
	}
	if req.RateLimitPerSecond != 0 && (req.RateLimitPerSecond < 1 || req.RateLimitPerSecond > 10000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_per_second must be between 1 and 10000, got %d", req.RateLimitPerSecond))
		return
	}
	if req.RateLimitBurst != 0 && (req.RateLimitBurst < 1 || req.RateLimitBurst > 100000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_burst must be between 1 and 100000, got %d", req.RateLimitBurst))
		return
	}
	if req.RateLimitPerMinute != nil && (*req.RateLimitPerMinute < 0 || *req.RateLimitPerMinute > 100000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_per_minute must be between 0 and 100000, got %d", *req.RateLimitPerMinute))
		return
	}
	if strings.TrimSpace(req.Listen) != "" {
		if err := config.ValidateListenAddress(req.Listen); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}

	// If the API key looks masked (contains "..." or is the short placeholder),
	// don't overwrite the existing key — the frontend sent back the masked value
	// because the user didn't change it.
	if strings.Contains(req.APIKey, "...") || req.APIKey == "****" {
		req.APIKey = p.APIKey
	}
	p.APIKey = req.APIKey
	if req.DefaultModel != "" {
		p.DefaultModel = req.DefaultModel
	}
	if len(req.ModelAliases) > 0 {
		if p.ModelAliases == nil {
			p.ModelAliases = map[string]string{}
		}
		for k, v := range req.ModelAliases {
			p.ModelAliases[k] = v
		}
	}
	if s.config.Profiles != nil && profileName != "" {
		s.config.Profiles[profileName] = p
	}
	if req.RequestTimeoutSeconds != 0 {
		s.config.RequestTimeoutSeconds = req.RequestTimeoutSeconds
		// Replace client to avoid racing with concurrent readers.
		old := s.client
		s.client = &http.Client{
			Timeout:   s.config.RequestTimeout(),
			Transport: old.Transport,
		}
	}
	if req.MaxThinkingBudgetTokens != 0 {
		s.config.MaxThinkingBudgetTokens = req.MaxThinkingBudgetTokens
	}
	if strings.TrimSpace(req.Upstream) != "" {
		s.config.Upstream = strings.TrimSpace(req.Upstream)
		s.upstream = s.config.Upstream
	}
	if strings.TrimSpace(req.Listen) != "" {
		s.config.Listen = strings.TrimSpace(req.Listen)
	}
	if req.RateLimitPerSecond != 0 {
		s.config.RateLimitPerSecond = req.RateLimitPerSecond
	}
	if req.RateLimitBurst != 0 {
		s.config.RateLimitBurst = req.RateLimitBurst
	}
	if req.RateLimitPerMinute != nil {
		s.config.RateLimitPerMinute = *req.RateLimitPerMinute
		if s.rpmLimiter != nil {
			s.rpmLimiter.setLimit(*req.RateLimitPerMinute)
		}
	}
	if req.ClaudeEnv != nil {
		s.config.ClaudeEnv = req.ClaudeEnv
	}

	if err := s.config.Save(s.configPath); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to save config: %w", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "profile": profileName})
}

func (s *Server) apiHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		days := parseIntParam(r, "days", 0)
		// 先读内存历史（当前会话）
		s.historyMu.RLock()
		memHist := s.history
		s.historyMu.RUnlock()

		// 再从 JSONL 文件读取（历史持久化）
		fileEntries := s.readJSONLLogs(days)

		// 合并两份数据：文件条目（已按时间倒序）+ 内存中新增的（文件可能没来得及写入的）
		seen := make(map[string]bool, len(fileEntries))
		for _, e := range fileEntries {
			seen[e.ID] = true
		}
		for _, e := range memHist {
			if !seen[e.ID] {
				fileEntries = append(fileEntries, e)
			}
		}

		// 按时间倒序排列（最新在前）
		sort.Slice(fileEntries, func(i, j int) bool {
			return fileEntries[i].Time.After(fileEntries[j].Time)
		})

		writeJSON(w, http.StatusOK, fileEntries)
	case http.MethodDelete:
		s.historyMu.Lock()
		s.history = nil
		s.historyMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
	}
}

func (s *Server) apiSyslog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
		return
	}
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, ".ocgt", "proxy.log")

	content, err := os.ReadFile(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, map[string]string{"log": "Proxy log file not found or hasn't been created yet."})
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to read log: %w", err))
		return
	}

	// Keep last 1000 lines approx (around 100KB)
	const maxLen = 100 * 1024
	if len(content) > maxLen {
		content = content[len(content)-maxLen:]
	}
	writeJSON(w, http.StatusOK, map[string]string{"log": string(content)})
}

func (s *Server) apiRawConfig(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".claude", "settings.json")

	if r.Method == http.MethodGet {
		data, err := os.ReadFile(configPath)
		if err != nil {
			if os.IsNotExist(err) {
				writeJSON(w, http.StatusOK, map[string]any{})
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}

	if r.Method == http.MethodPost {
		data, err := io.ReadAll(io.LimitReader(r.Body, MaxBodySize+1))
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if int64(len(data)) > MaxBodySize {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("request body too large (max %d bytes)", MaxBodySize))
			return
		}
		var js map[string]interface{}
		if err := json.Unmarshal(data, &js); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("Invalid JSON: %w", err))
			return
		}
		// Formatting and saving
		formatted, _ := json.MarshalIndent(js, "", "  ")
		if err := os.MkdirAll(filepath.Dir(configPath), 0700); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if err := fileutil.AtomicWriteFile(configPath, formatted, 0600); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("Method not allowed"))
}

func (s *Server) apiVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"version": version.Version})
}

// apiSystemInfo returns system information for hardware-aware onboarding.
func (s *Server) apiSystemInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
		return
	}
	info := map[string]any{
		"os":            runtime.GOOS,
		"arch":          runtime.GOARCH,
		"num_cpu":       runtime.NumCPU(),
		"go_version":    runtime.Version(),
		"num_goroutine": runtime.NumGoroutine(),
	}
	writeJSON(w, http.StatusOK, info)
}

// apiQuota returns the cached quota data (GET only).
// Use /ocgt/api/quota/refresh to fetch fresh data first.
func (s *Server) apiQuota(w http.ResponseWriter, r *http.Request) {
	s.quotaMu.RLock()
	data := s.quotaData
	s.quotaMu.RUnlock()

	result := quota.QuotaResult{
		Success:      data != nil,
		ProviderName: "opencode-go",
		Data:         data,
	}
	if data == nil {
		result.Error = "no quota data available — call POST /ocgt/api/quota/refresh first"
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) apiQuotaStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("GET required"))
		return
	}
	cookie, _ := s.resolveQuotaCredentials()
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": quota.CredentialConfigured(cookie),
	})
}

// apiRefreshQuota fetches fresh quota data from OpenCode Go (POST only).
// Credentials are resolved in this order: profile config → env vars.
func (s *Server) apiRefreshQuota(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("POST required"))
		return
	}

	cookie, workspaceID := s.resolveQuotaCredentials()
	data, err := quota.FetchOpenCodeGoQuota(cookie, workspaceID)
	if err != nil {
		writeJSON(w, http.StatusOK, quota.QuotaResult{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	s.quotaMu.Lock()
	s.quotaData = data
	s.quotaMu.Unlock()

	writeJSON(w, http.StatusOK, quota.QuotaResult{
		Success: true,
		Data:    data,
	})
}

func (s *Server) apiSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	if sessionID := r.URL.Query().Get("id"); sessionID != "" {
		if strings.ContainsAny(sessionID, "/\\") {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid session id"))
			return
		}
		detail, err := session.ReadLocalSessionEvents(sessionID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if detail == nil {
			writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
			return
		}
		writeJSON(w, http.StatusOK, detail)
		return
	}

	sessions, err := s.sessionsSnapshot()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	sessions = session.FilterByPeriod(sessions, r.URL.Query().Get("period"), time.Now())
	if sessions == nil {
		sessions = []session.SessionStats{}
	}
	writeJSON(w, http.StatusOK, session.SessionsResponse{
		Sessions: sessions,
		Total:    len(sessions),
	})
}

// sessionsSnapshot returns the session list through the server-level TTL
// cache. The cache fields existed but were never wired up — every navigation
// rescanned all JSONL files.
func (s *Server) sessionsSnapshot() ([]session.SessionStats, error) {
	s.sessionsCacheMu.RLock()
	if s.sessionsCache != nil && time.Since(s.sessionsCacheAt) < s.sessionsCacheTTL {
		cached := s.sessionsCache
		s.sessionsCacheMu.RUnlock()
		return cached, nil
	}
	s.sessionsCacheMu.RUnlock()

	sessions, err := session.ReadLocalSessions()
	if err != nil {
		return nil, err
	}
	s.sessionsCacheMu.Lock()
	s.sessionsCache = sessions
	s.sessionsCacheAt = time.Now()
	s.sessionsCacheMu.Unlock()
	return sessions, nil
}

// resolveQuotaCredentials resolves quota display credentials from env vars
// first, then from the account-level top-level Config fields.
func (s *Server) resolveQuotaCredentials() (cookie, workspaceID string) {
	cookie = os.Getenv("OPENCODE_GO_AUTH_COOKIE")
	workspaceID = os.Getenv("OPENCODE_GO_WORKSPACE_ID")
	if cookie != "" && workspaceID != "" {
		return
	}

	s.configMu.RLock()
	if cookie == "" && s.config.QuotaCookie != "" {
		cookie = s.config.QuotaCookie
	}
	if workspaceID == "" && s.config.QuotaWorkspaceID != "" {
		workspaceID = s.config.QuotaWorkspaceID
	}
	s.configMu.RUnlock()
	if cookie == "" {
		if c, w, ok := s.providerQuotaCredentials(); ok {
			cookie = c
			if workspaceID == "" {
				workspaceID = w
			}
		}
	}
	return
}

func (s *Server) providerQuotaCredentials() (cookie, workspaceID string, ok bool) {
	store := s.ensureStore()
	for _, line := range []string{"claude", "codex"} {
		provider, found := store.Active(line)
		if !found {
			continue
		}
		if !strings.Contains(strings.ToLower(provider.BaseURL), "opencode.ai/zen/go") && !strings.EqualFold(provider.Name, "OpenCode Go") {
			continue
		}
		for _, acc := range provider.Accounts {
			if strings.TrimSpace(acc.QuotaCookie) == "" {
				continue
			}
			return strings.TrimSpace(acc.QuotaCookie), strings.TrimSpace(acc.QuotaWorkspaceID), true
		}
	}
	return "", "", false
}

// apiAccountQuotas handles GET /ocgt/api/quota/accounts?provider=ID — fetches
// OpenCode Go quota for every account in the provider's pool that carries its
// own quota cookie. Fetches run concurrently (each hits opencode.ai).
func (s *Server) apiAccountQuotas(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("GET required"))
		return
	}
	providerID := strings.TrimSpace(r.URL.Query().Get("provider"))
	if providerID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("provider query parameter is required"))
		return
	}
	store := s.ensureStore()
	p, err := store.Get(providerID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	type accountQuota struct {
		AccountID string           `json:"account_id"`
		Label     string           `json:"label,omitempty"`
		Success   bool             `json:"success"`
		Error     string           `json:"error,omitempty"`
		Data      *quota.QuotaData `json:"data,omitempty"`
	}
	accounts := p.Accounts
	results := make([]accountQuota, len(accounts))
	var wg sync.WaitGroup
	for i, acc := range accounts {
		results[i] = accountQuota{AccountID: acc.ID, Label: acc.Label}
		if strings.TrimSpace(acc.QuotaCookie) == "" {
			results[i].Error = "quota cookie not configured"
			continue
		}
		wg.Add(1)
		go func(i int, cookie, workspaceID string) {
			defer wg.Done()
			data, err := quota.FetchOpenCodeGoQuota(cookie, workspaceID)
			if err != nil {
				results[i].Error = err.Error()
				return
			}
			results[i].Success = true
			results[i].Data = data
		}(i, acc.QuotaCookie, acc.QuotaWorkspaceID)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"provider_id": providerID, "accounts": results})
}

func (s *Server) apiHubSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	if s.HubClient == nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("hub client not initialized"))
		return
	}
	s.HubClient.SyncNow()
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}
