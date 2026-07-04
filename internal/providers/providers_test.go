package providers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUpdatePreservesMaskedKey(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		Name:    "Test",
		BaseURL: "https://api.example.com",
		APIKey:  "sk-1234567890abcdef",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	original := store.List()
	if len(original) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(original))
	}
	id := original[0].ID
	realKey := original[0].APIKey

	maskedKey := MaskAPIKey(realKey)
	if err := store.Update(id, Provider{
		Name:    "Updated",
		BaseURL: "https://api.example.com/v2",
		APIKey:  maskedKey,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	updated, err := store.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if updated.APIKey != realKey {
		t.Errorf("expected key %q, got %q", realKey, updated.APIKey)
	}
	if updated.Name != "Updated" {
		t.Errorf("expected name 'Updated', got %q", updated.Name)
	}
}

func TestUpdatePreservesEmptyKey(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		Name:    "Test",
		BaseURL: "https://api.example.com",
		APIKey:  "sk-real-key-1234",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	original := store.List()[0]
	realKey := original.APIKey

	if err := store.Update(original.ID, Provider{
		Name:    "Updated",
		BaseURL: "https://api.example.com/v2",
		APIKey:  "",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	updated, _ := store.Get(original.ID)
	if updated.APIKey != realKey {
		t.Errorf("expected key %q, got %q", realKey, updated.APIKey)
	}
}

func TestUpdateWithNewRealKey(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		Name:    "Test",
		BaseURL: "https://api.example.com",
		APIKey:  "sk-old-key",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	original := store.List()[0]
	newKey := "sk-new-key-5678"

	if err := store.Update(original.ID, Provider{
		Name:    "Updated",
		BaseURL: "https://api.example.com/v2",
		APIKey:  newKey,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	updated, _ := store.Get(original.ID)
	if updated.APIKey != newKey {
		t.Errorf("expected key %q, got %q", newKey, updated.APIKey)
	}
}

func TestUpdatePreservesSortIndex(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		ID:        "first",
		Name:      "First",
		BaseURL:   "https://a.example.com",
		SortIndex: 7,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := store.Update("first", Provider{
		Name:    "Renamed",
		BaseURL: "https://b.example.com",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	updated, err := store.Get("first")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if updated.SortIndex != 7 {
		t.Fatalf("expected sortIndex 7, got %d", updated.SortIndex)
	}
}

func TestIsMaskedKey(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"", true},
		{"****", true},
		{"***", true},
		{"sk-1...ef", true},
		{MaskAPIKey("sk-1234567890abcdef"), true},
		{"sk-real-key-1234", false},
		{"short", false},
		{"123456", false},   // 6 chars — must not panic
		{"1234567", false},  // 7 chars — must not panic
		{"12345678", false}, // 8 chars, not all stars
	}
	for _, tt := range tests {
		if got := isMaskedKey(tt.key); got != tt.want {
			t.Errorf("isMaskedKey(%q) = %v, want %v", tt.key, got, tt.want)
		}
	}
}

func TestStoreSaveUsesAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		Name:    "Test",
		BaseURL: "https://api.example.com",
		APIKey:  "sk-test",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	path := filepath.Join(dir, "providers.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("file is empty")
	}
}

func TestActivateEnablesOneProviderPerLine(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{ID: "claude-a", Name: "A", BaseURL: "https://a.example", Enabled: true, Line: "claude"}); err != nil {
		t.Fatalf("create a: %v", err)
	}
	if err := store.Create(Provider{ID: "claude-b", Name: "B", BaseURL: "https://b.example", Enabled: false, Line: "claude"}); err != nil {
		t.Fatalf("create b: %v", err)
	}
	if err := store.Create(Provider{ID: "codex-a", Name: "C", BaseURL: "https://c.example", Enabled: true, Line: "codex"}); err != nil {
		t.Fatalf("create c: %v", err)
	}

	if err := store.Activate("claude-b"); err != nil {
		t.Fatalf("activate: %v", err)
	}

	got := map[string]bool{}
	for _, p := range store.List() {
		got[p.ID] = p.Enabled
	}
	if got["claude-a"] || !got["claude-b"] || !got["codex-a"] {
		t.Fatalf("unexpected enabled state: %#v", got)
	}
}

func TestCreateEnabledProviderDisablesSameLine(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{ID: "a", Name: "A", BaseURL: "https://a.example", Enabled: true, Line: "claude"}); err != nil {
		t.Fatalf("create a: %v", err)
	}
	if err := store.Create(Provider{ID: "b", Name: "B", BaseURL: "https://b.example", Enabled: true, Line: "claude"}); err != nil {
		t.Fatalf("create b: %v", err)
	}

	got := map[string]bool{}
	for _, p := range store.List() {
		got[p.ID] = p.Enabled
	}
	if got["a"] || !got["b"] {
		t.Fatalf("unexpected enabled state: %#v", got)
	}
}

func TestActiveReturnsEnabledProviderForLine(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{ID: "claude-a", Name: "A", BaseURL: "https://a.example", Enabled: true, Line: "claude"}); err != nil {
		t.Fatalf("create claude: %v", err)
	}
	if err := store.Create(Provider{ID: "codex-a", Name: "B", BaseURL: "https://b.example", Enabled: true, Line: "codex"}); err != nil {
		t.Fatalf("create codex: %v", err)
	}

	claude, ok := store.Active("claude")
	if !ok || claude.ID != "claude-a" {
		t.Fatalf("unexpected claude provider: %#v ok=%v", claude, ok)
	}
	codex, ok := store.Active("codex")
	if !ok || codex.ID != "codex-a" {
		t.Fatalf("unexpected codex provider: %#v ok=%v", codex, ok)
	}
}

// ── Account pool (multi-account rotation) ──

// Legacy single-key providers must load as a one-account pool so the rotation
// engine has a uniform view without any manual migration step by the user.
func TestLoadMigratesLegacyKeyToAccountPool(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"providers":[{"id":"p1","name":"Legacy","baseUrl":"https://api.example.com","apiKey":"sk-legacy-key-1234","enabled":true,"line":"claude"}]}`
	if err := os.WriteFile(filepath.Join(dir, "providers.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewStore(dir)
	if err := store.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}
	p, err := store.Get("p1")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Accounts) != 1 || p.Accounts[0].APIKey != "sk-legacy-key-1234" {
		t.Fatalf("expected legacy key folded into a one-account pool, got %+v", p.Accounts)
	}
	if p.Accounts[0].ID == "" {
		t.Fatalf("migrated account must get an ID")
	}
}

// EnabledAccounts skips disabled/empty entries and falls back to the legacy
// key so no caller needs to special-case old configs.
func TestEnabledAccountsFallbackAndFiltering(t *testing.T) {
	p := Provider{
		Accounts: []Account{
			{ID: "a", APIKey: "key-a", Disabled: true},
			{ID: "b", APIKey: "key-b"},
			{ID: "c", APIKey: "   "},
		},
	}
	accounts := p.EnabledAccounts()
	if len(accounts) != 1 || accounts[0].ID != "b" {
		t.Fatalf("expected only account b, got %+v", accounts)
	}

	legacy := Provider{APIKey: "sk-legacy"}
	accounts = legacy.EnabledAccounts()
	if len(accounts) != 1 || accounts[0].APIKey != "sk-legacy" {
		t.Fatalf("expected legacy pseudo-account, got %+v", accounts)
	}
}

// Round-tripping masked account secrets through Update must preserve the real
// values (the UI always sends masked keys back when the user didn't edit them),
// while an explicitly emptied quota cookie is a deliberate clear.
func TestUpdatePreservesMaskedAccountSecrets(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Create(Provider{
		ID:      "p1",
		Name:    "Pool",
		BaseURL: "https://api.example.com",
		Accounts: []Account{
			{ID: "acc-a", APIKey: "sk-real-key-aaaa", QuotaCookie: "auth=cookie-a"},
			{ID: "acc-b", APIKey: "sk-real-key-bbbb", QuotaCookie: "auth=cookie-b"},
		},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := store.Update("p1", Provider{
		Name:    "Pool",
		BaseURL: "https://api.example.com",
		Accounts: []Account{
			{ID: "acc-a", APIKey: MaskAPIKey("sk-real-key-aaaa"), QuotaCookie: MaskAPIKey("auth=cookie-a")},
			{ID: "acc-b", APIKey: "sk-brand-new-key", QuotaCookie: ""},
			{ID: "acc-c", APIKey: "sk-added-key-cccc"},
		},
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	p, err := store.Get("p1")
	if err != nil {
		t.Fatal(err)
	}
	if p.Accounts[0].APIKey != "sk-real-key-aaaa" || p.Accounts[0].QuotaCookie != "auth=cookie-a" {
		t.Errorf("masked secrets must be preserved, got %+v", p.Accounts[0])
	}
	if p.Accounts[1].APIKey != "sk-brand-new-key" {
		t.Errorf("new real key must overwrite, got %q", p.Accounts[1].APIKey)
	}
	if p.Accounts[1].QuotaCookie != "" {
		t.Errorf("empty cookie is an explicit clear, got %q", p.Accounts[1].QuotaCookie)
	}
	if p.Accounts[2].APIKey != "sk-added-key-cccc" {
		t.Errorf("added account must keep its key, got %q", p.Accounts[2].APIKey)
	}
}

// MaskProviderSecrets must mask every credential surface exposed by the API.
func TestMaskProviderSecretsMasksAccounts(t *testing.T) {
	p := Provider{
		APIKey: "sk-legacy-key-9999",
		Accounts: []Account{
			{ID: "a", APIKey: "sk-account-key-1111", QuotaCookie: "auth=super-secret-cookie"},
		},
	}
	masked := MaskProviderSecrets(p)
	if masked.APIKey == p.APIKey || masked.Accounts[0].APIKey == p.Accounts[0].APIKey {
		t.Fatalf("keys must be masked: %+v", masked)
	}
	if masked.Accounts[0].QuotaCookie == p.Accounts[0].QuotaCookie {
		t.Fatalf("quota cookie must be masked: %+v", masked)
	}
	// The original must be untouched (masking returns a copy).
	if p.Accounts[0].APIKey != "sk-account-key-1111" {
		t.Fatalf("MaskProviderSecrets must not mutate its input")
	}
}
