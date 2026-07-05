package providers

import "testing"

func TestStorePersistsModelProtocols(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if err := store.Create(Provider{
		ID:             "p1",
		Name:           "OpenCode Go",
		BaseURL:        "https://opencode.ai/zen/go",
		Enabled:        true,
		Line:           "claude",
		Protocol:       "openai-chat",
		ModelProtocols: map[string]string{"claude-native": "anthropic"},
	}); err != nil {
		t.Fatal(err)
	}

	reloaded := NewStore(t.TempDir())
	reloaded.path = store.path
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	got, err := reloaded.Get("p1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ModelProtocols["claude-native"] != "anthropic" {
		t.Fatalf("modelProtocols not persisted: %#v", got.ModelProtocols)
	}
}
