package quota

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// withMockServers temporarily redirects the package-level base URLs to the
// provided httptest servers and restores them when the test ends. This keeps
// tests hermetic and avoids cross-test contamination of shared state.
func withMockServers(t *testing.T, base, server string) {
	t.Helper()
	origBase, origServer := openCodeGoBaseURL, serverURL
	openCodeGoBaseURL, serverURL = base, server
	t.Cleanup(func() {
		openCodeGoBaseURL = origBase
		serverURL = origServer
	})
}

// newRPCHandler returns an httptest handler that simulates the opencode.ai
// _server RPC endpoint for workspace resolution.
func newRPCHandler(body string, status int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript")
		w.WriteHeader(status)
		_, _ = fmt.Fprint(w, body)
	})
}

// ---------------------------------------------------------------------------
// sanitizeCookie
// ---------------------------------------------------------------------------

func TestSanitizeCookie(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "empty", raw: "", want: ""},
		{name: "whitespace only", raw: "   \t\n", want: ""},
		{name: "bare value wrapped as auth", raw: "  abc123  ", want: "auth=abc123"},
		{name: "already named", raw: "auth=abc123", want: "auth=abc123"},
		{name: "strips cookie prefix", raw: "cookie: auth=abc123", want: "auth=abc123"},
		{name: "strips cookie prefix case-insensitive", raw: "Cookie: session=xyz", want: "session=xyz"},
		{name: "multiple parts normalized", raw: "a=1; b=2;; ;c=3", want: "a=1; b=2; c=3"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeCookie(tt.raw); got != tt.want {
				t.Errorf("sanitizeCookie(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestCredentialConfiguredExpandsEnvPlaceholder(t *testing.T) {
	t.Setenv("OPENCODE_GO_AUTH_COOKIE", "")
	if CredentialConfigured("${OPENCODE_GO_AUTH_COOKIE}") {
		t.Fatal("unset env placeholder must not count as configured")
	}

	t.Setenv("OPENCODE_GO_AUTH_COOKIE", "auth=abc123")
	if !CredentialConfigured("${OPENCODE_GO_AUTH_COOKIE}") {
		t.Fatal("set env placeholder should count as configured")
	}
}

// ---------------------------------------------------------------------------
// parseWorkspaceIDs
// ---------------------------------------------------------------------------

func TestParseWorkspaceIDs_JSFormat(t *testing.T) {
	text := `{ "data": [{ id: "wrk_abc" }, { id: "wrk_def" }] }`
	got := parseWorkspaceIDs(text)
	if len(got) != 2 || got[0] != "wrk_abc" || got[1] != "wrk_def" {
		t.Errorf("parseWorkspaceIDs() = %v, want [wrk_abc wrk_def]", got)
	}
}

func TestParseWorkspaceIDs_JSONFormat(t *testing.T) {
	text := `["wrk_one", "wrk_two", "not_a_workspace"]`
	got := parseWorkspaceIDs(text)
	if len(got) != 2 || got[0] != "wrk_one" || got[1] != "wrk_two" {
		t.Errorf("parseWorkspaceIDs() = %v, want [wrk_one wrk_two]", got)
	}
}

func TestParseWorkspaceIDs_Dedup(t *testing.T) {
	// Same id appearing multiple times should only be listed once.
	text := `{ id: "wrk_dup" }, { id: "wrk_dup" }`
	got := parseWorkspaceIDs(text)
	if len(got) != 1 || got[0] != "wrk_dup" {
		t.Errorf("parseWorkspaceIDs() = %v, want [wrk_dup]", got)
	}
}

func TestParseWorkspaceIDs_None(t *testing.T) {
	if got := parseWorkspaceIDs("nothing useful here"); got != nil {
		t.Errorf("parseWorkspaceIDs() = %v, want nil", got)
	}
}

// ---------------------------------------------------------------------------
// looksLikeSignedOut
// ---------------------------------------------------------------------------

func TestLooksLikeSignedOut(t *testing.T) {
	tests := []struct {
		text string
		want bool
	}{
		{"please sign in to continue", true},
		{"you need to login first", true},
		{`not associated with an account`, true},
		{`actor of type "public"`, true},
		{"{ \"data\": \"all good\" }", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := looksLikeSignedOut(tt.text); got != tt.want {
			t.Errorf("looksLikeSignedOut(%q) = %v, want %v", tt.text, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// formatDurationCompact
// ---------------------------------------------------------------------------

func TestFormatDurationCompact(t *testing.T) {
	tests := []struct {
		secs int
		want string
	}{
		{0, "0s"},
		{45, "45s"},
		{60, "1m"},
		{90, "1m"},
		{1800, "30m"},
		{3600, "1h"},
		{5400, "1h"},
		{7200, "2h"},
		{86400, "1d"},
		{172800, "2d"},
	}
	for _, tt := range tests {
		if got := formatDurationCompact(tt.secs); got != tt.want {
			t.Errorf("formatDurationCompact(%d) = %q, want %q", tt.secs, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// clampPct
// ---------------------------------------------------------------------------

func TestClampPct(t *testing.T) {
	for _, tt := range []struct{ in, want int }{{-5, 0}, {0, 0}, {50, 50}, {100, 100}, {150, 100}} {
		if got := clampPct(tt.in); got != tt.want {
			t.Errorf("clampPct(%d) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// parseGoUsage (JSON + regex fallback)
// ---------------------------------------------------------------------------

func TestParseGoUsageJSON(t *testing.T) {
	body := `{
		"rollingUsage": {"status":"active","usagePercent":50,"resetInSec":3600},
		"weeklyUsage": {"status":"active","usagePercent":30,"resetInSec":86400},
		"monthlyUsage": {"status":"active","usagePercent":10,"resetInSec":2592000}
	}`
	data, err := parseGoUsage(body)
	if err != nil {
		t.Fatalf("parseGoUsage failed: %v", err)
	}
	if data.Rolling.UsagePercent != 50 {
		t.Errorf("rolling usagePercent = %d, want 50", data.Rolling.UsagePercent)
	}
	if data.Rolling.ResetDisplay != "1h" {
		t.Errorf("rolling resetDisplay = %q, want 1h", data.Rolling.ResetDisplay)
	}
	if data.Weekly.UsagePercent != 30 {
		t.Errorf("weekly usagePercent = %d, want 30", data.Weekly.UsagePercent)
	}
	if data.Weekly.ResetDisplay != "1d" {
		t.Errorf("weekly resetDisplay = %q, want 1d", data.Weekly.ResetDisplay)
	}
	if data.Monthly == nil {
		t.Fatal("expected monthly data, got nil")
	}
	if data.Monthly.UsagePercent != 10 {
		t.Errorf("monthly usagePercent = %d, want 10", data.Monthly.UsagePercent)
	}
}

func TestParseGoUsageJSON_MissingRolling(t *testing.T) {
	// Missing rollingUsage should make JSON parsing fail and fall through to
	// the regex path (which will also fail here), returning an error.
	body := `{"weeklyUsage": {"usagePercent":30,"resetInSec":86400}}`
	if _, err := parseGoUsage(body); err == nil {
		t.Fatal("expected error for missing rolling data, got nil")
	}
}

func TestParseGoUsageRegex(t *testing.T) {
	// Deliberately non-JSON text so the regex fallback is exercised.
	body := `<script> rollingUsage: { usagePercent: 45, resetInSec: 1800 } ` +
		`weeklyUsage: { usagePercent: 25, resetInSec: 7200 } ` +
		`monthlyUsage: { usagePercent: 5, resetInSec: 3600 } </script>`
	data, err := parseGoUsage(body)
	if err != nil {
		t.Fatalf("parseGoUsage (regex) failed: %v", err)
	}
	if data.Rolling.UsagePercent != 45 {
		t.Errorf("rolling usagePercent = %d, want 45", data.Rolling.UsagePercent)
	}
	if data.Rolling.ResetInSec != 1800 {
		t.Errorf("rolling resetInSec = %d, want 1800", data.Rolling.ResetInSec)
	}
	if data.Weekly.UsagePercent != 25 {
		t.Errorf("weekly usagePercent = %d, want 25", data.Weekly.UsagePercent)
	}
	if data.Monthly == nil || data.Monthly.UsagePercent != 5 {
		t.Errorf("monthly = %+v, want usagePercent 5", data.Monthly)
	}
}

func TestParseGoUsageRegex_NoMatch(t *testing.T) {
	body := `totally unrelated content with no usage info`
	if _, err := parseGoUsage(body); err == nil {
		t.Fatal("expected error when no usage data is present, got nil")
	}
}

// ---------------------------------------------------------------------------
// resolveWorkspaceID
// ---------------------------------------------------------------------------

func TestResolveWorkspaceID(t *testing.T) {
	srv := httptest.NewServer(newRPCHandler(`{ id: "wrk_resolved" }`, 200))
	defer srv.Close()
	withMockServers(t, srv.URL, srv.URL)

	id, err := resolveWorkspaceID("auth=abc")
	if err != nil {
		t.Fatalf("resolveWorkspaceID failed: %v", err)
	}
	if id != "wrk_resolved" {
		t.Errorf("resolveWorkspaceID = %q, want wrk_resolved", id)
	}
}

func TestResolveWorkspaceID_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(newRPCHandler("please sign in to continue", 401))
	defer srv.Close()
	withMockServers(t, srv.URL, srv.URL)

	if _, err := resolveWorkspaceID("auth=abc"); err == nil {
		t.Fatal("expected error for unauthorized, got nil")
	}
}

func TestResolveWorkspaceID_SignedOutBody(t *testing.T) {
	srv := httptest.NewServer(newRPCHandler("this account is not associated with an account", 200))
	defer srv.Close()
	withMockServers(t, srv.URL, srv.URL)

	if _, err := resolveWorkspaceID("auth=abc"); err == nil {
		t.Fatal("expected error for signed-out body, got nil")
	}
}

func TestResolveWorkspaceID_NoIDs(t *testing.T) {
	srv := httptest.NewServer(newRPCHandler(`{ "empty": true }`, 200))
	defer srv.Close()
	withMockServers(t, srv.URL, srv.URL)

	if _, err := resolveWorkspaceID("auth=abc"); err == nil {
		t.Fatal("expected error when no workspace IDs are found, got nil")
	}
}

func TestResolveWorkspaceID_NetworkError(t *testing.T) {
	// Point at a closed server to force a network error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close()
	withMockServers(t, srv.URL, srv.URL)

	if _, err := resolveWorkspaceID("auth=abc"); err == nil {
		t.Fatal("expected network error, got nil")
	}
}

// ---------------------------------------------------------------------------
// FetchOpenCodeGoQuota (full integration via httptest)
// ---------------------------------------------------------------------------

// validPageJSON is a JSON page body the page scraper can parse successfully.
const validPageJSON = `{
	"rollingUsage": {"status":"active","usagePercent":60,"resetInSec":3600},
	"weeklyUsage": {"status":"active","usagePercent":40,"resetInSec":86400}
}`

func TestFetchOpenCodeGoQuota_EmptyCookie(t *testing.T) {
	_, err := FetchOpenCodeGoQuota("", "wrk_123")
	if err == nil {
		t.Fatal("expected error for empty cookie, got nil")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestFetchOpenCodeGoQuota_WhitespaceCookie(t *testing.T) {
	if _, err := FetchOpenCodeGoQuota("   \t ", "wrk_123"); err == nil {
		t.Fatal("expected error for whitespace-only cookie, got nil")
	}
}

func TestFetchOpenCodeGoQuota_SuccessViaAutoResolve(t *testing.T) {
	rpcSrv := httptest.NewServer(newRPCHandler(`{ id: "wrk_auto" }`, 200))
	defer rpcSrv.Close()
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/workspace/wrk_auto/go" {
			t.Errorf("page path = %q, want /workspace/wrk_auto/go", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(200)
		_, _ = fmt.Fprint(w, validPageJSON)
	}))
	defer pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	data, err := FetchOpenCodeGoQuota("auth=test-cookie", "")
	if err != nil {
		t.Fatalf("FetchOpenCodeGoQuota failed: %v", err)
	}
	if data.Rolling.UsagePercent != 60 {
		t.Errorf("rolling usagePercent = %d, want 60", data.Rolling.UsagePercent)
	}
	if data.Weekly.UsagePercent != 40 {
		t.Errorf("weekly usagePercent = %d, want 40", data.Weekly.UsagePercent)
	}
}

func TestFetchOpenCodeGoQuota_SuccessViaFallbackID(t *testing.T) {
	// RPC fails (no IDs), so the provided workspaceID must be used instead.
	rpcSrv := httptest.NewServer(newRPCHandler(`{ "no": "ids" }`, 200))
	defer rpcSrv.Close()
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/workspace/wrk_user/go" {
			t.Errorf("page path = %q, want /workspace/wrk_user/go", r.URL.Path)
		}
		w.WriteHeader(200)
		_, _ = fmt.Fprint(w, validPageJSON)
	}))
	defer pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	data, err := FetchOpenCodeGoQuota("auth=test-cookie", "wrk_user")
	if err != nil {
		t.Fatalf("FetchOpenCodeGoQuota failed: %v", err)
	}
	if data.Rolling.UsagePercent != 60 {
		t.Errorf("rolling usagePercent = %d, want 60", data.Rolling.UsagePercent)
	}
}

func TestFetchOpenCodeGoQuota_ExpandsEnvPlaceholders(t *testing.T) {
	t.Setenv("OPENCODE_GO_AUTH_COOKIE", "auth=test-cookie")
	t.Setenv("OPENCODE_GO_WORKSPACE_ID", "wrk_env")

	// RPC fails (no IDs), so the workspace placeholder must expand and drive
	// the fallback page request.
	rpcSrv := httptest.NewServer(newRPCHandler(`{ "no": "ids" }`, 200))
	defer rpcSrv.Close()
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/workspace/wrk_env/go" {
			t.Errorf("page path = %q, want /workspace/wrk_env/go", r.URL.Path)
		}
		w.WriteHeader(200)
		_, _ = fmt.Fprint(w, validPageJSON)
	}))
	defer pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	data, err := FetchOpenCodeGoQuota("${OPENCODE_GO_AUTH_COOKIE}", "${OPENCODE_GO_WORKSPACE_ID}")
	if err != nil {
		t.Fatalf("FetchOpenCodeGoQuota failed: %v", err)
	}
	if data.Rolling.UsagePercent != 60 {
		t.Errorf("rolling usagePercent = %d, want 60", data.Rolling.UsagePercent)
	}
}

func TestFetchOpenCodeGoQuota_AllPathsFail(t *testing.T) {
	rpcSrv := httptest.NewServer(newRPCHandler(`{ "no": "ids" }`, 200))
	defer rpcSrv.Close()
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	_, err := FetchOpenCodeGoQuota("auth=test-cookie", "wrk_user")
	if err == nil {
		t.Fatal("expected error when all paths fail, got nil")
	}
	if !strings.Contains(err.Error(), "failed to fetch quota") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestFetchOpenCodeGoQuota_NetworkError(t *testing.T) {
	// Closed servers force network errors on every attempt.
	rpcSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rpcSrv.Close()
	pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	_, err := FetchOpenCodeGoQuota("auth=test-cookie", "wrk_user")
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
}

func TestFetchOpenCodeGoQuota_UnauthorizedCookie(t *testing.T) {
	// RPC reports unauthorized; fallback also fails → error.
	rpcSrv := httptest.NewServer(newRPCHandler("please sign in", 401))
	defer rpcSrv.Close()
	pageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
	}))
	defer pageSrv.Close()
	withMockServers(t, pageSrv.URL, rpcSrv.URL)

	if _, err := FetchOpenCodeGoQuota("auth=expired", "wrk_user"); err == nil {
		t.Fatal("expected error for unauthorized cookie, got nil")
	}
}

// ---------------------------------------------------------------------------
// QuotaResult JSON round-trip
// ---------------------------------------------------------------------------

func TestQuotaResultJSONRoundTrip(t *testing.T) {
	src := QuotaResult{
		Success:      true,
		ProviderName: "opencode-go",
		Data: &QuotaData{
			Rolling:   QuotaUsage{Status: "active", UsagePercent: 50, ResetInSec: 3600, ResetDisplay: "1h"},
			Weekly:    QuotaUsage{Status: "active", UsagePercent: 30, ResetInSec: 86400, ResetDisplay: "1d"},
			FetchedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
	}
	raw, err := json.Marshal(src)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var dst QuotaResult
	if err := json.Unmarshal(raw, &dst); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if !dst.Success || dst.ProviderName != "opencode-go" {
		t.Errorf("unexpected round-trip: %+v", dst)
	}
	if dst.Data.Rolling.UsagePercent != 50 {
		t.Errorf("rolling pct = %d, want 50", dst.Data.Rolling.UsagePercent)
	}
}
