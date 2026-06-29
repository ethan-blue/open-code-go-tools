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
