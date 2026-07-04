package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

func newRotationTestServer(t *testing.T) *Server {
	t.Helper()
	srv, err := New(config.Config{
		Listen:   "127.0.0.1:0",
		Upstream: "https://opencode.ai/zen/go",
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func rotationTarget(accounts ...providers.Account) requestTarget {
	return requestTarget{
		name:     "prov-1",
		accounts: accounts,
	}
}

// The pool always prefers the FIRST healthy account (deterministic primary):
// this keeps requests on one subscription so upstream prompt caches stay warm,
// and guarantees traffic returns to the primary once its cooldown expires.
func TestPickAccountPrefersPrimary(t *testing.T) {
	srv := newRotationTestServer(t)
	target := rotationTarget(
		providers.Account{ID: "a", APIKey: "key-a"},
		providers.Account{ID: "b", APIKey: "key-b"},
	)

	if got := srv.pickAccount(&target); got != "a" {
		t.Fatalf("expected primary account %q, got %q", "a", got)
	}
	if target.profile.APIKey != "key-a" {
		t.Fatalf("expected profile key to be swapped to key-a, got %q", target.profile.APIKey)
	}
}

// A 429 must remove the account from rotation immediately (quota exhausted —
// hammering it again would just burn retries), and the pool must fall over to
// the next account.
func TestPickAccountFailsOverAfter429(t *testing.T) {
	srv := newRotationTestServer(t)
	target := rotationTarget(
		providers.Account{ID: "a", APIKey: "key-a"},
		providers.Account{ID: "b", APIKey: "key-b"},
	)

	srv.pickAccount(&target)
	srv.noteAccountFailure("prov-1", "a", http.StatusTooManyRequests, 0, "quota exceeded")

	if got := srv.pickAccount(&target); got != "b" {
		t.Fatalf("expected failover to account b after 429, got %q", got)
	}
	if target.profile.APIKey != "key-b" {
		t.Fatalf("expected profile key key-b after failover, got %q", target.profile.APIKey)
	}
}

// After the cooldown expires the primary must be picked again — failover is
// temporary, not a permanent demotion.
func TestPickAccountReturnsToPrimaryAfterCooldown(t *testing.T) {
	srv := newRotationTestServer(t)
	target := rotationTarget(
		providers.Account{ID: "a", APIKey: "key-a"},
		providers.Account{ID: "b", APIKey: "key-b"},
	)

	srv.noteAccountFailure("prov-1", "a", http.StatusTooManyRequests, 0, "quota")
	// Manually expire the cooldown instead of sleeping.
	srv.accountMu.Lock()
	srv.accountStates[accountStateKey("prov-1", "a")].cooldownUntil = time.Now().Add(-time.Second)
	srv.accountMu.Unlock()

	if got := srv.pickAccount(&target); got != "a" {
		t.Fatalf("expected primary account a after cooldown expiry, got %q", got)
	}
}

// When every account is cooling down the pool must still pick one (the one
// recovering first) instead of failing the request outright.
func TestPickAccountAllCoolingPicksEarliestRecovery(t *testing.T) {
	srv := newRotationTestServer(t)
	target := rotationTarget(
		providers.Account{ID: "a", APIKey: "key-a"},
		providers.Account{ID: "b", APIKey: "key-b"},
	)

	srv.noteAccountFailure("prov-1", "a", http.StatusUnauthorized, 0, "bad key") // 5min cooldown
	srv.noteAccountFailure("prov-1", "b", http.StatusTooManyRequests, 0, "429") // 60s cooldown

	if got := srv.pickAccount(&target); got != "b" {
		t.Fatalf("expected account b (earliest recovery), got %q", got)
	}
}

// Cooldown policy: success clears failure state; soft failures (5xx/network)
// only trip after 3 consecutive occurrences; Retry-After is honored but capped.
func TestNoteAccountFailureCooldownPolicy(t *testing.T) {
	srv := newRotationTestServer(t)

	cooldownOf := func(id string) time.Time {
		srv.accountMu.Lock()
		defer srv.accountMu.Unlock()
		st := srv.accountStates[accountStateKey("prov-1", id)]
		if st == nil {
			return time.Time{}
		}
		return st.cooldownUntil
	}

	// Soft failures: below the threshold no cooldown is applied.
	srv.noteAccountFailure("prov-1", "soft", 0, 0, "net err")
	srv.noteAccountFailure("prov-1", "soft", 502, 0, "bad gateway")
	if !cooldownOf("soft").IsZero() {
		t.Fatalf("soft failures below threshold must not cool down")
	}
	srv.noteAccountFailure("prov-1", "soft", 503, 0, "unavailable")
	if cooldownOf("soft").IsZero() {
		t.Fatalf("3 consecutive soft failures must apply a cooldown")
	}

	// Success resets everything.
	srv.noteAccountSuccess("prov-1", "soft")
	if !cooldownOf("soft").IsZero() {
		t.Fatalf("success must clear the cooldown")
	}

	// Retry-After is honored but capped at rateLimitCooldownMax.
	srv.noteAccountFailure("prov-1", "rl", http.StatusTooManyRequests, time.Hour, "429")
	if remaining := time.Until(cooldownOf("rl")); remaining > rateLimitCooldownMax+time.Second {
		t.Fatalf("Retry-After must be capped at %v, got %v", rateLimitCooldownMax, remaining)
	}
}

// End-to-end: a provider with two accounts, upstream rejects the first key
// with 429 and accepts the second — the request must succeed transparently
// and the very next request must skip the cooling primary entirely.
func TestMessagesAccountFailoverEndToEnd(t *testing.T) {
	var mu sync.Mutex
	var authSeen []string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		mu.Lock()
		authSeen = append(authSeen, auth)
		mu.Unlock()

		if auth == "Bearer key-a" {
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"type":"rate_limit_error","message":"quota exhausted"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_1","model":"test-model","choices":[{"message":{"content":"ok","role":"assistant"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer upstream.Close()

	dir := t.TempDir()
	providersJSON := map[string]any{
		"providers": []map[string]any{{
			"id":       "pool-provider",
			"name":     "OpenCode Go Pool",
			"baseUrl":  upstream.URL,
			"enabled":  true,
			"line":     "claude",
			"protocol": "openai-chat",
			"accounts": []map[string]any{
				{"id": "acc-a", "label": "主账号", "apiKey": "key-a"},
				{"id": "acc-b", "label": "备用", "apiKey": "key-b"},
			},
		}},
	}
	data, _ := json.Marshal(providersJSON)
	if err := os.WriteFile(filepath.Join(dir, "providers.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	srv.SetConfigPath(filepath.Join(dir, "config.json"))
	srv.retryBackoffBase = 0

	doRequest := func() *httptest.ResponseRecorder {
		body := []byte(`{"model":"test-model","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rr, req)
		return rr
	}

	// First request: key-a → 429 → failover → key-b → 200.
	if rr := doRequest(); rr.Code != http.StatusOK {
		t.Fatalf("expected 200 via failover, got %d: %s", rr.Code, rr.Body.String())
	}
	mu.Lock()
	first := append([]string(nil), authSeen...)
	authSeen = nil
	mu.Unlock()
	if len(first) != 2 || first[0] != "Bearer key-a" || first[1] != "Bearer key-b" {
		t.Fatalf("expected [key-a, key-b] auth sequence, got %v", first)
	}

	// Second request: key-a is cooling down — must go straight to key-b.
	if rr := doRequest(); rr.Code != http.StatusOK {
		t.Fatalf("expected 200 on second request, got %d: %s", rr.Code, rr.Body.String())
	}
	mu.Lock()
	second := append([]string(nil), authSeen...)
	mu.Unlock()
	if len(second) != 1 || second[0] != "Bearer key-b" {
		t.Fatalf("expected cooling primary to be skipped ([key-b]), got %v", second)
	}
}

// The rotation status API must reflect cooldowns and mark the account the
// failover would currently pick.
func TestRotationStatusEndpoint(t *testing.T) {
	dir := t.TempDir()
	providersJSON := `{"providers":[{"id":"p1","name":"Pool","baseUrl":"https://x.example","enabled":true,"line":"claude","accounts":[{"id":"acc-a","apiKey":"key-aaaaaaaaaa"},{"id":"acc-b","apiKey":"key-bbbbbbbbbb"}]}]}`
	if err := os.WriteFile(filepath.Join(dir, "providers.json"), []byte(providersJSON), 0o600); err != nil {
		t.Fatal(err)
	}

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: "https://opencode.ai/zen/go"})
	if err != nil {
		t.Fatal(err)
	}
	srv.SetConfigPath(filepath.Join(dir, "config.json"))
	srv.noteAccountFailure("p1", "acc-a", http.StatusTooManyRequests, 0, "quota exhausted")

	req := httptest.NewRequest(http.MethodGet, "/ocgt/api/rotation", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var payload struct {
		Providers []accountRotationSnapshot `json:"providers"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Providers) != 1 || len(payload.Providers[0].Accounts) != 2 {
		t.Fatalf("expected 1 provider with 2 accounts, got %+v", payload)
	}
	a, b := payload.Providers[0].Accounts[0], payload.Providers[0].Accounts[1]
	if a.State != "cooldown" || a.Active {
		t.Fatalf("account a should be cooling and inactive, got %+v", a)
	}
	if b.State != "ready" || !b.Active {
		t.Fatalf("account b should be ready and active, got %+v", b)
	}
	if a.MaskedKey == "key-aaaaaaaaaa" {
		t.Fatalf("rotation status must not leak raw keys")
	}
}
