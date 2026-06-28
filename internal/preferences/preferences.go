package preferences

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultCloseBehavior    = "prompt"
	DefaultLogEnabled       = true
	DefaultLogRetentionDays = 14
	DefaultTheme            = "system"
	DefaultLanguage         = "zh"
	DefaultAccentHue        = 174
	DefaultLastView         = "dashboard"
	DefaultCompactShell     = "powershell"
	DefaultHubEnabled       = false
	DefaultHubPushInterval  = 120
)

type Preferences struct {
	CloseBehavior        string   `json:"close_behavior"`
	LogEnabled           bool     `json:"log_enabled"`
	LogDirectory         string   `json:"log_directory,omitempty"`
	LogRetentionDays     int      `json:"log_retention_days"`
	Theme                string   `json:"theme"`
	Language             string   `json:"language"`
	AccentHue            int      `json:"accent_hue"`
	LastView             string   `json:"last_view"`
	CompactShell         string   `json:"compact_shell"`
	ExpandedIntegrations []string `json:"expanded_integrations,omitempty"`
	HubEnabled           bool     `json:"hub_enabled"`
	HubURL               string   `json:"hub_url,omitempty"`
	HubSecret            string   `json:"-"`
	HubDeviceName        string   `json:"hub_device_name,omitempty"`
	HubPushIntervalSec   int      `json:"hub_push_interval_sec"`
}

func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "preferences.json"), nil
}

func DefaultLogDirectory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "logs"), nil
}

func Load(path string) (Preferences, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return Preferences{}, fmt.Errorf("failed to determine preferences path: %w", err)
		}
	}

	defaultLogDir, _ := DefaultLogDirectory()
	prefs := Preferences{
		CloseBehavior:        DefaultCloseBehavior,
		LogEnabled:           DefaultLogEnabled,
		LogDirectory:         defaultLogDir,
		LogRetentionDays:     DefaultLogRetentionDays,
		Theme:                DefaultTheme,
		Language:             DefaultLanguage,
		AccentHue:            DefaultAccentHue,
		LastView:             DefaultLastView,
		CompactShell:         DefaultCompactShell,
		ExpandedIntegrations: []string{},
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return prefs, nil
		}
		return Preferences{}, fmt.Errorf("failed to read preferences file %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return prefs, nil
	}
	if err := json.Unmarshal(data, &prefs); err != nil {
		return Preferences{}, fmt.Errorf("failed to parse preferences file %q: %w", path, err)
	}
	prefs.applyDefaults()
	return prefs, prefs.Validate()
}

func (p Preferences) Save(path string) error {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return err
		}
	}
	p.applyDefaults()
	if err := p.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(path, append(data, '\n'), 0o600)
}

func (p *Preferences) applyDefaults() {
	if p.CloseBehavior == "" {
		p.CloseBehavior = DefaultCloseBehavior
	}
	if strings.TrimSpace(p.LogDirectory) == "" {
		if dir, err := DefaultLogDirectory(); err == nil {
			p.LogDirectory = dir
		}
	}
	if p.LogRetentionDays == 0 {
		p.LogRetentionDays = DefaultLogRetentionDays
	}
	if strings.TrimSpace(p.Theme) == "" {
		p.Theme = DefaultTheme
	}
	if strings.TrimSpace(p.Language) == "" {
		p.Language = DefaultLanguage
	}
	if strings.TrimSpace(p.LastView) == "" {
		p.LastView = DefaultLastView
	}
	if strings.TrimSpace(p.CompactShell) == "" {
		p.CompactShell = DefaultCompactShell
	}
	if p.HubPushIntervalSec == 0 {
		p.HubPushIntervalSec = DefaultHubPushInterval
	}
}

func (p Preferences) Validate() error {
	if !IsValidCloseBehavior(p.CloseBehavior) {
		return fmt.Errorf("invalid close_behavior %q, must be 'prompt', 'minimize', or 'exit'", p.CloseBehavior)
	}
	if strings.TrimSpace(p.LogDirectory) == "" {
		return fmt.Errorf("log_directory is required")
	}
	if p.LogRetentionDays < 0 || p.LogRetentionDays > 365 {
		return fmt.Errorf("log_retention_days must be 0 (unlimited) or between 1 and 365, got %d", p.LogRetentionDays)
	}
	if !IsValidTheme(p.Theme) {
		return fmt.Errorf("invalid theme %q, must be 'light', 'dark', or 'system'", p.Theme)
	}
	if !IsValidLanguage(p.Language) {
		return fmt.Errorf("invalid language %q, must be 'zh' or 'en'", p.Language)
	}
	if p.AccentHue < 0 || p.AccentHue > 360 {
		return fmt.Errorf("accent_hue must be between 0 and 360, got %d", p.AccentHue)
	}
	if !IsValidView(p.LastView) {
		return fmt.Errorf("invalid last_view %q", p.LastView)
	}
	if !IsValidCompactShell(p.CompactShell) {
		return fmt.Errorf("invalid compact_shell %q", p.CompactShell)
	}
	if p.HubEnabled && (p.HubPushIntervalSec < 30 || p.HubPushIntervalSec > 1800) {
		return fmt.Errorf("hub_push_interval_sec must be between 30 and 1800 when hub is enabled, got %d", p.HubPushIntervalSec)
	}
	seen := map[string]bool{}
	for _, item := range p.ExpandedIntegrations {
		if !IsValidIntegration(item) {
			return fmt.Errorf("invalid expanded integration %q", item)
		}
		if seen[item] {
			return fmt.Errorf("duplicate expanded integration %q", item)
		}
		seen[item] = true
	}
	return nil
}

func IsValidCloseBehavior(value string) bool {
	switch value {
	case "prompt", "minimize", "exit":
		return true
	default:
		return false
	}
}

func IsValidTheme(value string) bool {
	switch value {
	case "light", "dark", "system":
		return true
	default:
		return false
	}
}

func IsValidLanguage(value string) bool {
	switch value {
	case "zh", "en":
		return true
	default:
		return false
	}
}

func IsValidView(value string) bool {
	switch value {
	case "dashboard", "settings", "terminal", "history", "traffic-detail", "hub", "sessions":
		return true
	default:
		return false
	}
}

func IsValidCompactShell(value string) bool {
	switch value {
	case "powershell", "cmd", "bash":
		return true
	default:
		return false
	}
}

func IsValidIntegration(value string) bool {
	switch value {
	case "quick", "cli", "vscode", "claude-desktop":
		return true
	default:
		return false
	}
}
