package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// HubConfig holds Hub synchronization settings (L4)
type HubConfig struct {
	Enabled         bool   `json:"enabled"`
	HubURL          string `json:"hub_url,omitempty"`
	Secret          string `json:"secret,omitempty"`
	DeviceName      string `json:"device_name,omitempty"`
	PushIntervalSec int    `json:"push_interval_sec,omitempty"`
}

// HubPath returns the path to hub.json
func HubPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "hub.json"), nil
}

// LoadHub loads hub.json
func LoadHub(path string) (*HubConfig, error) {
	if path == "" {
		var err error
		path, err = HubPath()
		if err != nil {
			return nil, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &HubConfig{}, nil
		}
		return nil, err
	}

	var cfg HubConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// SaveHub saves hub.json
func SaveHub(cfg *HubConfig, path string) error {
	if path == "" {
		var err error
		path, err = HubPath()
		if err != nil {
			return err
		}
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, append(data, '\n'), 0o600)
}
