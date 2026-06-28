package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStripComments(t *testing.T) {
	input := `{
		// This is a comment
		"name": "ocgt", /* This is a
		block comment */
		"url": "http://127.0.0.1:8787" // inline comment
	}`

	cleaned := stripComments(input)
	if strings.Contains(cleaned, "This is a comment") {
		t.Error("Failed to strip single line comments")
	}
	if strings.Contains(cleaned, "This is a\n\t\tblock comment") {
		t.Error("Failed to strip block comments")
	}
	if !strings.Contains(cleaned, `"url": "http://127.0.0.1:8787"`) {
		t.Error("Should preserve valid strings containing slashes")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(cleaned), &data); err != nil {
		t.Errorf("Cleaned JSON is invalid: %v", err)
	}

	if data["name"] != "ocgt" || data["url"] != "http://127.0.0.1:8787" {
		t.Error("JSON data parsed incorrectly after comment stripping")
	}
}

func TestVSCodeEnvIntegration(t *testing.T) {
	// Create a temporary settings file
	tempDir, err := os.MkdirTemp("", "ocgt-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	settingsPath := filepath.Join(tempDir, "settings.json")
	os.Setenv("OCGT_TEST_VSCODE_PATH", settingsPath)
	defer os.Unsetenv("OCGT_TEST_VSCODE_PATH")

	// Write initial settings with some comments and a custom setting
	initialJSON := `{
		// User preference
		"workbench.colorTheme": "Default Dark Modern",
		"terminal.integrated.env.windows": {
			"EXISTING_VAR": "keep-me",
			"ANTHROPIC_BASE_URL": "https://example.invalid"
		}
	}`
	if err := os.WriteFile(settingsPath, []byte(initialJSON), 0600); err != nil {
		t.Fatalf("Failed to write initial settings: %v", err)
	}

	app := NewApp()
	// Mock a status to ensure GetListenAddress returns a valid mock value
	// We'll just run it
	res := app.InstallVSCodeEnv()
	if res != "success" {
		t.Fatalf("InstallVSCodeEnv failed: %s", res)
	}

	// Read and verify the settings file
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("Failed to read settings file: %v", err)
	}

	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("Settings file contains invalid JSON: %v", err)
	}

	if settings["workbench.colorTheme"] != "Default Dark Modern" {
		t.Error("Original settings were not preserved")
	}

	// Verify windows env has injected vars and preserved EXISTING_VAR
	winEnv, ok := settings["terminal.integrated.env.windows"].(map[string]any)
	if !ok {
		t.Fatal("terminal.integrated.env.windows not found or not a map")
	}

	if winEnv["EXISTING_VAR"] != "keep-me" {
		t.Error("Pre-existing environment variables were lost")
	}

	if winEnv["ANTHROPIC_BASE_URL"] != "http://127.0.0.1:8787" {
		t.Errorf("Unexpected base URL: %v", winEnv["ANTHROPIC_BASE_URL"])
	}

	// Test IsVSCodeConfigured
	if !app.IsVSCodeConfigured() {
		t.Error("IsVSCodeConfigured returned false after installation")
	}

	// Test RemoveVSCodeEnv
	res = app.RemoveVSCodeEnv()
	if res != "success" {
		t.Fatalf("RemoveVSCodeEnv failed: %s", res)
	}

	data, err = os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("Failed to read settings file: %v", err)
	}

	var settingsClean map[string]any
	cleanStr := stripComments(string(data))
	if err := json.Unmarshal([]byte(cleanStr), &settingsClean); err != nil {
		t.Fatalf("Cleaned settings contains invalid JSON: %v", err)
	}

	if settingsClean["workbench.colorTheme"] != "Default Dark Modern" {
		t.Error("Original settings were lost after removal")
	}

	winEnvClean, ok := settingsClean["terminal.integrated.env.windows"].(map[string]any)
	if !ok {
		t.Fatal("terminal.integrated.env.windows should not have been deleted entirely because of EXISTING_VAR")
	}

	if winEnvClean["EXISTING_VAR"] != "keep-me" {
		t.Error("EXISTING_VAR was lost during cleanup")
	}

	if winEnvClean["ANTHROPIC_BASE_URL"] != "https://example.invalid" {
		t.Errorf("ANTHROPIC_BASE_URL was not restored, got %v", winEnvClean["ANTHROPIC_BASE_URL"])
	}

	if _, err := os.Stat(vscodeBackupPath(settingsPath)); !os.IsNotExist(err) {
		t.Error("VS Code backup file should be removed after cleanup")
	}

	if app.IsVSCodeConfigured() {
		t.Error("IsVSCodeConfigured returned true after removal")
	}
}
