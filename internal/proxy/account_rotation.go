package proxy

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

// Account failover engine.
//
// A provider may carry a pool of accounts (API keys). Requests always prefer
// the FIRST healthy account in pool order (deterministic primary), and an
// account that fails is placed on a cooldown so subsequent attempts fall over
// to the next one. When the cooldown expires the primary is picked again —
// classic failover, friendly to upstream prompt caches.
//
// Cooldown policy (per account, in-memory only):
//   - 429            → cooldown for Retry-After (default 60s, capped at 10min)
//   - 401 / 403      → cooldown 5min (bad or exhausted credential; avoid hammering)
//   - 5xx / net err  → 3 consecutive failures → cooldown 30s (mirrors the model circuit breaker)

const (
	rateLimitCooldown    = 60 * time.Second
	rateLimitCooldownMax = 10 * time.Minute
	authFailureCooldown  = 5 * time.Minute
	softFailureCooldown  = 30 * time.Second
	softFailureThreshold = 3
)

type accountState struct {
	consecutiveFailures int
	cooldownUntil       time.Time
	lastError           string
	requests            int64
	failures            int64
}

func accountStateKey(providerID, accountID string) string {
	return providerID + "\x00" + accountID
}

// pickAccount selects the account to use for the next attempt and applies its
// API key onto target.profile. Returns the chosen account ID, or "" when the
// target has no account pool (legacy profile path — rotation disabled).
func (s *Server) pickAccount(target *requestTarget) string {
	if len(target.accounts) == 0 {
		return ""
	}
	now := time.Now()

	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	if s.accountStates == nil {
		s.accountStates = map[string]*accountState{}
	}

	chosen := -1
	for i, acc := range target.accounts {
		st := s.accountStates[accountStateKey(target.name, acc.ID)]
		if st == nil || now.After(st.cooldownUntil) {
			chosen = i
			break
		}
	}
	if chosen == -1 {
		// Every account is cooling down — pick the one that recovers first
		// rather than failing instantly.
		earliest := time.Time{}
		for i, acc := range target.accounts {
			st := s.accountStates[accountStateKey(target.name, acc.ID)]
			if chosen == -1 || st.cooldownUntil.Before(earliest) {
				chosen = i
				earliest = st.cooldownUntil
			}
		}
	}

	acc := target.accounts[chosen]
	target.profile.APIKey = acc.APIKey
	st := s.accountStates[accountStateKey(target.name, acc.ID)]
	if st == nil {
		st = &accountState{}
		s.accountStates[accountStateKey(target.name, acc.ID)] = st
	}
	st.requests++
	return acc.ID
}

// noteAccountSuccess clears failure state after a successful upstream call.
func (s *Server) noteAccountSuccess(providerID, accountID string) {
	if accountID == "" {
		return
	}
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	if st := s.accountStates[accountStateKey(providerID, accountID)]; st != nil {
		st.consecutiveFailures = 0
		st.cooldownUntil = time.Time{}
		st.lastError = ""
	}
}

// noteAccountFailure records a failed upstream call and applies the cooldown
// policy. status 0 means a transport-level error. retryAfter (from the 429
// Retry-After header) overrides the default rate-limit cooldown when set.
func (s *Server) noteAccountFailure(providerID, accountID string, status int, retryAfter time.Duration, errText string) {
	if accountID == "" {
		return
	}
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	if s.accountStates == nil {
		s.accountStates = map[string]*accountState{}
	}
	key := accountStateKey(providerID, accountID)
	st := s.accountStates[key]
	if st == nil {
		st = &accountState{}
		s.accountStates[key] = st
	}
	st.failures++
	st.consecutiveFailures++
	if len(errText) > 200 {
		errText = errText[:200]
	}
	st.lastError = errText

	now := time.Now()
	switch {
	case status == http.StatusTooManyRequests:
		cd := rateLimitCooldown
		if retryAfter > 0 {
			cd = retryAfter
			if cd > rateLimitCooldownMax {
				cd = rateLimitCooldownMax
			}
		}
		st.cooldownUntil = now.Add(cd)
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		st.cooldownUntil = now.Add(authFailureCooldown)
	default: // 5xx / network error
		if st.consecutiveFailures >= softFailureThreshold {
			st.cooldownUntil = now.Add(softFailureCooldown)
		}
	}
}

// retryAfterDuration parses a Retry-After response header (seconds form only;
// HTTP-date form is rare on AI gateways and safely ignored).
func retryAfterDuration(resp *http.Response) time.Duration {
	if resp == nil {
		return 0
	}
	raw := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if raw == "" {
		return 0
	}
	if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	return 0
}

// isAccountLevelFailure reports whether an upstream status should trigger
// account failover (as opposed to being the caller's fault).
func isAccountLevelFailure(status int) bool {
	return status == http.StatusTooManyRequests ||
		status == http.StatusUnauthorized ||
		status == http.StatusForbidden ||
		status >= 500
}

// accountRotationSnapshot is the wire shape of GET /ocgt/api/rotation.
type accountRotationSnapshot struct {
	ProviderID   string                  `json:"provider_id"`
	ProviderName string                  `json:"provider_name"`
	Line         string                  `json:"line"`
	Enabled      bool                    `json:"enabled"`
	Accounts     []accountStatusSnapshot `json:"accounts"`
}

type accountStatusSnapshot struct {
	ID                  string `json:"id"`
	Label               string `json:"label,omitempty"`
	MaskedKey           string `json:"masked_key"`
	Disabled            bool   `json:"disabled,omitempty"`
	State               string `json:"state"` // "ready" | "cooldown" | "disabled"
	CooldownRemainingMs int64  `json:"cooldown_remaining_ms,omitempty"`
	ConsecutiveFailures int    `json:"consecutive_failures,omitempty"`
	Requests            int64  `json:"requests"`
	Failures            int64  `json:"failures"`
	LastError           string `json:"last_error,omitempty"`
	Active              bool   `json:"active"` // the account failover would pick right now
	HasQuotaCookie      bool   `json:"has_quota_cookie"`
}

// apiRotationStatus handles GET /ocgt/api/rotation — per-provider account
// pool state for the dashboard.
func (s *Server) apiRotationStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	store := s.ensureStore()
	now := time.Now()

	s.accountMu.Lock()
	defer s.accountMu.Unlock()

	out := []accountRotationSnapshot{}
	for _, p := range store.List() {
		accounts := p.Accounts
		if len(accounts) == 0 {
			// Legacy single-key providers still show as a one-account pool.
			accounts = p.EnabledAccounts()
		}
		if len(accounts) == 0 {
			continue
		}
		snap := accountRotationSnapshot{
			ProviderID:   p.ID,
			ProviderName: p.Name,
			Line:         p.Line,
			Enabled:      p.Enabled,
		}
		activeMarked := false
		for _, acc := range accounts {
			st := s.accountStates[accountStateKey(p.ID, acc.ID)]
			view := accountStatusSnapshot{
				ID:             acc.ID,
				Label:          acc.Label,
				MaskedKey:      providers.MaskAPIKey(acc.APIKey),
				Disabled:       acc.Disabled,
				State:          "ready",
				HasQuotaCookie: strings.TrimSpace(acc.QuotaCookie) != "",
			}
			if acc.Disabled {
				view.State = "disabled"
			}
			if st != nil {
				view.ConsecutiveFailures = st.consecutiveFailures
				view.Requests = st.requests
				view.Failures = st.failures
				view.LastError = st.lastError
				if now.Before(st.cooldownUntil) && !acc.Disabled {
					view.State = "cooldown"
					view.CooldownRemainingMs = time.Until(st.cooldownUntil).Milliseconds()
				}
			}
			if !activeMarked && view.State == "ready" {
				view.Active = true
				activeMarked = true
			}
			snap.Accounts = append(snap.Accounts, view)
		}
		out = append(out, snap)
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": out})
}
