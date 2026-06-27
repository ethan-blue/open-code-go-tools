package preferences

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingPreferencesUsesDefaults(t *testing.T) {
	prefs, err := Load(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if prefs.CloseBehavior != DefaultCloseBehavior {
		t.Fatalf("expected default close behavior %q, got %q", DefaultCloseBehavior, prefs.CloseBehavior)
	}
	if !prefs.LogEnabled {
		t.Fatal("expected logging to be enabled by default")
	}
	if prefs.LogDirectory == "" {
		t.Fatal("expected default log directory")
	}
	if prefs.LogRetentionDays != DefaultLogRetentionDays {
		t.Fatalf("expected default log retention %d, got %d", DefaultLogRetentionDays, prefs.LogRetentionDays)
	}
	if prefs.Theme != DefaultTheme {
		t.Fatalf("expected default theme %q, got %q", DefaultTheme, prefs.Theme)
	}
	if prefs.Language != DefaultLanguage {
		t.Fatalf("expected default language %q, got %q", DefaultLanguage, prefs.Language)
	}
	if prefs.AccentHue != DefaultAccentHue {
		t.Fatalf("expected default accent hue %d, got %d", DefaultAccentHue, prefs.AccentHue)
	}
	if prefs.LastView != DefaultLastView {
		t.Fatalf("expected default last view %q, got %q", DefaultLastView, prefs.LastView)
	}
	if prefs.CompactShell != DefaultCompactShell {
		t.Fatalf("expected default compact shell %q, got %q", DefaultCompactShell, prefs.CompactShell)
	}
}

func TestSaveAndLoadPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	want := Preferences{
		CloseBehavior:        "minimize",
		LogEnabled:           false,
		LogDirectory:         filepath.Join(t.TempDir(), "logs"),
		LogRetentionDays:     7,
		Theme:                "dark",
		Language:             "en",
		AccentHue:            212,
		LastView:             "terminal",
		CompactShell:         "bash",
		ExpandedIntegrations: []string{"quick", "vscode"},
	}
	if err := want.Save(path); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.CloseBehavior != want.CloseBehavior {
		t.Fatalf("expected close behavior %q, got %q", want.CloseBehavior, got.CloseBehavior)
	}
	if got.LogEnabled != want.LogEnabled {
		t.Fatalf("expected log enabled %v, got %v", want.LogEnabled, got.LogEnabled)
	}
	if got.LogDirectory != want.LogDirectory {
		t.Fatalf("expected log directory %q, got %q", want.LogDirectory, got.LogDirectory)
	}
	if got.LogRetentionDays != want.LogRetentionDays {
		t.Fatalf("expected log retention %d, got %d", want.LogRetentionDays, got.LogRetentionDays)
	}
	if got.Theme != want.Theme {
		t.Fatalf("expected theme %q, got %q", want.Theme, got.Theme)
	}
	if got.Language != want.Language {
		t.Fatalf("expected language %q, got %q", want.Language, got.Language)
	}
	if got.AccentHue != want.AccentHue {
		t.Fatalf("expected accent hue %d, got %d", want.AccentHue, got.AccentHue)
	}
	if got.LastView != want.LastView {
		t.Fatalf("expected last view %q, got %q", want.LastView, got.LastView)
	}
	if got.CompactShell != want.CompactShell {
		t.Fatalf("expected compact shell %q, got %q", want.CompactShell, got.CompactShell)
	}
	if len(got.ExpandedIntegrations) != len(want.ExpandedIntegrations) {
		t.Fatalf("expected expanded integrations %v, got %v", want.ExpandedIntegrations, got.ExpandedIntegrations)
	}
	for i := range want.ExpandedIntegrations {
		if got.ExpandedIntegrations[i] != want.ExpandedIntegrations[i] {
			t.Fatalf("expected expanded integrations %v, got %v", want.ExpandedIntegrations, got.ExpandedIntegrations)
		}
	}
}

func TestRejectInvalidCloseBehavior(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	if err := os.WriteFile(path, []byte(`{"close_behavior":"unknown"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected invalid close behavior error")
	}
}

func TestRejectInvalidUIPreferences(t *testing.T) {
	cases := []Preferences{
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "neon", Language: "zh", AccentHue: 174, LastView: "dashboard", CompactShell: "powershell"},
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "system", Language: "fr", AccentHue: 174, LastView: "dashboard", CompactShell: "powershell"},
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "system", Language: "zh", AccentHue: 361, LastView: "dashboard", CompactShell: "powershell"},
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "system", Language: "zh", AccentHue: 174, LastView: "unknown", CompactShell: "powershell"},
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "system", Language: "zh", AccentHue: 174, LastView: "dashboard", CompactShell: "fish"},
		{CloseBehavior: "prompt", LogDirectory: "C:\\logs", LogRetentionDays: 14, Theme: "system", Language: "zh", AccentHue: 174, LastView: "dashboard", CompactShell: "powershell", ExpandedIntegrations: []string{"missing"}},
	}
	for _, tc := range cases {
		if err := tc.Validate(); err == nil {
			t.Fatalf("expected invalid UI preference error for %+v", tc)
		}
	}
}

func TestRejectInvalidLogRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	if err := os.WriteFile(path, []byte(`{"close_behavior":"prompt","log_enabled":true,"log_directory":"C:\\logs","log_retention_days":0}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err != nil {
		t.Fatalf("missing retention should default, got error: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"close_behavior":"prompt","log_enabled":true,"log_directory":"C:\\logs","log_retention_days":366}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected invalid log retention error")
	}
}
