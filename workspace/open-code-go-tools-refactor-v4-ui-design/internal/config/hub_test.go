package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadHub_NonExistent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hub.json")

	cfg, err := LoadHub(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Enabled {
		t.Error("expected default hub to be disabled")
	}
}

func TestSaveAndLoadHub(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hub.json")

	original := &HubConfig{
		Enabled:         true,
		HubURL:          "https://hub.example.com",
		Secret:          "secret-123",
		DeviceName:      "my-device",
		PushIntervalSec: 60,
	}

	if err := SaveHub(original, path); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := LoadHub(path)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}

	if !loaded.Enabled {
		t.Error("expected hub enabled")
	}
	if loaded.HubURL != "https://hub.example.com" {
		t.Errorf("expected hub_url, got '%s'", loaded.HubURL)
	}
	if loaded.DeviceName != "my-device" {
		t.Errorf("expected device_name 'my-device', got '%s'", loaded.DeviceName)
	}
	if loaded.PushIntervalSec != 60 {
		t.Errorf("expected push_interval_sec 60, got %d", loaded.PushIntervalSec)
	}
}

func TestLoadHub_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hub.json")
	os.WriteFile(path, []byte("not json"), 0o600)

	_, err := LoadHub(path)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestSaveHub_CreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "hub.json")

	cfg := &HubConfig{Enabled: true}
	if err := SaveHub(cfg, path); err != nil {
		t.Fatalf("expected directory creation, got error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	var loaded HubConfig
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("failed to parse saved JSON: %v", err)
	}
	if !loaded.Enabled {
		t.Error("expected hub enabled after save/load")
	}
}
