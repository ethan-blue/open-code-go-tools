package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ProfilesConfig holds user-facing API configuration (L2)
type ProfilesConfig struct {
	ActiveProfile string             `json:"active_profile"`
	Profiles      map[string]Profile `json:"profiles"`
	ClaudeEnv     map[string]string  `json:"claude_env,omitempty"`
	Presets       map[string]Preset  `json:"presets,omitempty"`
}

// Preset is a named configuration template
type Preset struct {
	Name         string            `json:"name"`
	Description  string            `json:"description,omitempty"`
	DefaultModel string            `json:"default_model,omitempty"`
	ModelAliases map[string]string `json:"model_aliases,omitempty"`
}

// BuiltInPresets are the default configuration presets
var BuiltInPresets = map[string]Preset{
	"default": {
		Name:         "Default",
		Description:  "Balanced for general use",
		DefaultModel: "kimi-k2.6",
		ModelAliases: map[string]string{"sonnet": "deepseek-v4-pro", "haiku": "deepseek-v4-flash", "opus": "kimi-k2.6"},
	},
	"precise": {
		Name:         "Precise",
		Description:  "Accuracy-first, higher cost",
		DefaultModel: "qwen3.7-max",
		ModelAliases: map[string]string{"sonnet": "qwen3.7-max", "haiku": "qwen3.6-plus", "opus": "kimi-k2.6"},
	},
	"creative": {
		Name:         "Creative",
		Description:  "Diverse outputs, good for brainstorming",
		DefaultModel: "deepseek-v4-pro",
		ModelAliases: map[string]string{"sonnet": "deepseek-v4-pro", "haiku": "glm-5.1", "opus": "kimi-k2.6"},
	},
	"code": {
		Name:         "Code",
		Description:  "Optimized for coding tasks",
		DefaultModel: "deepseek-v4-pro",
		ModelAliases: map[string]string{"sonnet": "deepseek-v4-pro", "haiku": "deepseek-v4-flash", "opus": "kimi-k2.6"},
	},
}

// ProfilesPath returns the path to profiles.json
func ProfilesPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "profiles.json"), nil
}

// LoadProfiles loads profiles.json
func LoadProfiles(path string) (*ProfilesConfig, error) {
	if path == "" {
		var err error
		path, err = ProfilesPath()
		if err != nil {
			return nil, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultProfiles(), nil
		}
		return nil, err
	}

	var cfg ProfilesConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Ensure presets are populated
	if cfg.Presets == nil {
		cfg.Presets = BuiltInPresets
	}

	return &cfg, nil
}

// SaveProfiles saves profiles.json
func SaveProfiles(cfg *ProfilesConfig, path string) error {
	if path == "" {
		var err error
		path, err = ProfilesPath()
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

// DefaultProfiles returns a ProfilesConfig with sensible defaults
func DefaultProfiles() *ProfilesConfig {
	return &ProfilesConfig{
		ActiveProfile: "default",
		Profiles: map[string]Profile{
			"default": {
				DefaultModel: "kimi-k2.6",
				ModelAliases: map[string]string{
					"sonnet": "deepseek-v4-pro",
					"haiku":  "deepseek-v4-flash",
					"opus":   "kimi-k2.6",
				},
			},
		},
		Presets: BuiltInPresets,
	}
}

// Profile returns the active profile or the named profile
func (pc *ProfilesConfig) Profile(name string) (Profile, bool) {
	if name == "" {
		name = pc.ActiveProfile
	}
	if name == "" {
		name = "default"
	}
	p, ok := pc.Profiles[name]
	return p, ok
}

// ActiveProfileOrDefault returns the active profile name or "default"
func (pc *ProfilesConfig) ActiveProfileOrDefault() string {
	if pc.ActiveProfile != "" {
		return pc.ActiveProfile
	}
	return "default"
}

// ResolveModel resolves a model alias to the actual model name
func (pc *ProfilesConfig) ResolveModel(model string) string {
	p, ok := pc.Profile("")
	if !ok {
		return model
	}
	if resolved, ok := p.ModelAliases[model]; ok {
		return resolved
	}
	return model
}
