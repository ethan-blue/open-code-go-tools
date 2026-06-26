package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
)

func setUserEnvironment(name, value string) error {
	return setUserEnvironmentBatch(map[string]string{name: value})
}

func setUserEnvironmentBatch(env map[string]string) error {
	for k, v := range env {
		if err := os.Setenv(k, v); err != nil {
			return err
		}
	}
	switch runtime.GOOS {
	case "windows":
		return setWindowsUserEnvironmentBatch(env)
	case "darwin":
		return nil
	default:
		return nil
	}
}

// claudeSettingsPreserveFields lists top-level keys in ~/.claude/settings.json that
// must survive across tool switches.  Third-party tools like CC-Switch overwrite the
// entire file with only their "env" block, erasing permissions, plugins, etc.  When
// ocgt syncs settings it restores any missing preserve-fields from the last known-good
// backup.
var claudeSettingsPreserveFields = []string{
	"permissions",
	"model",
	"enabledPlugins",
	"statusLine",
	"allowedTools",
}

// syncClaudeSettings merges the given env vars into ~/.claude/settings.json.
// It preserves top-level fields like permissions, model, enabledPlugins, etc.
// NOTE: settings.json must be valid JSON (no comments). If it contains JSON
// comments, parsing will fail and the operation will abort safely.
func syncClaudeSettings(env map[string]string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	backupPath := filepath.Join(home, ".claude", "settings.json.ocgt-bak")

	settings := map[string]any{}
	if data, err := os.ReadFile(settingsPath); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &settings); err != nil {
			return err
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}

	// If a previous ocgt backup exists, restore any preserve-fields that are
	// missing from the current settings (e.g. CC-Switch wiped them).
	if backup, err := os.ReadFile(backupPath); err == nil && len(backup) > 0 {
		bakSettings := map[string]any{}
		if json.Unmarshal(backup, &bakSettings) == nil {
			for _, key := range claudeSettingsPreserveFields {
				if _, exists := settings[key]; !exists {
					if val, ok := bakSettings[key]; ok {
						settings[key] = val
					}
				}
			}
		}
	}

	envMap, _ := settings["env"].(map[string]any)
	if envMap == nil {
		envMap = map[string]any{}
	}
	for _, name := range legacyClaudeEnvNames() {
		delete(envMap, name)
	}

	for key, value := range env {
		envMap[key] = value
	}
	settings["env"] = envMap

	if err := os.MkdirAll(filepath.Dir(settingsPath), 0o700); err != nil {
		return err
	}
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := fileutil.AtomicWriteFile(settingsPath, append(out, '\n'), 0o600); err != nil {
		return err
	}

	// Keep a backup of the full settings (including preserve-fields) so that a
	// future external overwrite can be repaired on the next sync.
	if err := fileutil.AtomicWriteFile(backupPath, append(out, '\n'), 0o600); err != nil {
		log.Printf("ocgt: failed to write settings backup: %v", err)
	}

	return nil
}

// clearClaudeSettings removes ocgt-specific env vars from ~/.claude/settings.json.
func clearClaudeSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return err
	}
	envMap, _ := settings["env"].(map[string]any)
	if envMap == nil {
		return nil
	}
	for _, key := range []string{
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_CUSTOM_HEADERS",
		"OCGT_PROFILE",
		"ANTHROPIC_AUTH_TOKEN",
	} {
		delete(envMap, key)
	}
	if len(envMap) == 0 {
		delete(settings, "env")
	} else {
		settings["env"] = envMap
	}
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := fileutil.AtomicWriteFile(settingsPath, append(out, '\n'), 0o600); err != nil {
		return err
	}
	return nil
}
