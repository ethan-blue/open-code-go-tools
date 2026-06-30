package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// MigrateLegacyConfig folds legacy profile-scoped configuration into the
// v4 single-file model.
//
// Before v4 the app split state across config.json (L1: proxy/network) and
// profiles.json (L2: API keys, model aliases, quota). v4 moved the
// user-facing configuration surface to providers (providers.json) plus
// account-level top-level Config fields. This migration:
//
//  1. Promotes quota_cookie / quota_workspace_id from any profile entry into
//     the Config top-level fields (account-scoped, no longer per-profile).
//  2. Merges a stray standalone profiles.json back into config.json's
//     (now optional, tolerated) profiles map, so nothing is lost.
//
// It is idempotent: running it on an already-migrated config is a no-op.
func MigrateLegacyConfig(configPath string) error {
	if configPath == "" {
		var err error
		configPath, err = DefaultPath()
		if err != nil {
			return err
		}
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing to migrate
		}
		return err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("failed to parse config for migration: %w", err)
	}

	changed := false

	// 1. Promote quota fields out of the profiles map into top-level Config.
	if profilesRaw, ok := raw["profiles"]; ok {
		// profiles is a JSON object keyed by profile name; each value holds
		// the per-profile fields including quota_cookie / quota_workspace_id.
		var profilesMap map[string]map[string]json.RawMessage
		if err := json.Unmarshal(profilesRaw, &profilesMap); err == nil && len(profilesMap) > 0 {
			// Find the active profile name, if any.
			activeName := ""
			if v, ok := raw["active_profile"]; ok {
				_ = json.Unmarshal(v, &activeName)
			}
			source, ok := pickProfileForQuota(profilesMap, activeName)
			if ok {
				if !hasNonEmptyValue(raw["quota_cookie"]) {
					if v, ok := source["quota_cookie"]; ok && hasNonEmptyValue(v) {
						raw["quota_cookie"] = v
						changed = true
					}
				}
				if !hasNonEmptyValue(raw["quota_workspace_id"]) {
					if v, ok := source["quota_workspace_id"]; ok && hasNonEmptyValue(v) {
						raw["quota_workspace_id"] = v
						changed = true
					}
				}
			}
		}
	}

	// 2. Merge a standalone legacy profiles.json (active_profile / claude_env)
	//    back into config.json, then remove the stray file.
	if profilesPath, err := ProfilesPath(); err == nil {
		if pdata, perr := os.ReadFile(profilesPath); perr == nil {
			var p struct {
				ActiveProfile string            `json:"active_profile"`
				ClaudeEnv     map[string]string `json:"claude_env,omitempty"`
			}
			if jerr := json.Unmarshal(pdata, &p); jerr == nil {
				if _, hasActive := raw["active_profile"]; !hasActive && p.ActiveProfile != "" {
					if v, merr := json.Marshal(p.ActiveProfile); merr == nil {
						raw["active_profile"] = v
						changed = true
					}
				}
				if _, hasEnv := raw["claude_env"]; !hasEnv && len(p.ClaudeEnv) > 0 {
					if v, merr := json.Marshal(p.ClaudeEnv); merr == nil {
						raw["claude_env"] = v
						changed = true
					}
				}
				// Best effort: remove the now-redundant standalone file.
				_ = os.Remove(profilesPath)
			}
		}
	}

	if !changed {
		return nil
	}

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, append(out, '\n'), 0o600)
}

// pickProfileForQuota selects the profile to read quota fields from: the active
// profile if present, otherwise the first profile in the map.
func pickProfileForQuota(profiles map[string]map[string]json.RawMessage, active string) (map[string]json.RawMessage, bool) {
	if active != "" {
		if p, ok := profiles[active]; ok {
			return p, true
		}
	}
	for _, p := range profiles {
		return p, true
	}
	return nil, false
}

// hasNonEmptyValue reports whether a json.RawMessage decodes to a non-empty
// JSON string. Missing or empty values ("" / null) return false.
func hasNonEmptyValue(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return false // non-string (object/array/number) counts as "present"
	}
	return s != ""
}

// NeedsMigration reports whether legacy quota fields still live inside the
// profiles map (i.e. have not yet been promoted to the Config top level), or a
// standalone profiles.json still exists.
func NeedsMigration() bool {
	configPath, err := DefaultPath()
	if err != nil {
		return false
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false
	}
	var raw struct {
		QuotaCookie      json.RawMessage            `json:"quota_cookie"`
		QuotaWorkspaceID json.RawMessage            `json:"quota_workspace_id"`
		Profiles         map[string]json.RawMessage `json:"profiles"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return false
	}
	// Promote needed when profiles carry quota and the top-level is unset.
	if len(raw.Profiles) > 0 {
		needsPromote := false
		for _, p := range raw.Profiles {
			var fields map[string]json.RawMessage
			if json.Unmarshal(p, &fields) == nil {
				if _, ok := fields["quota_cookie"]; ok {
					needsPromote = true
				}
				if _, ok := fields["quota_workspace_id"]; ok {
					needsPromote = true
				}
			}
		}
		if needsPromote && (len(raw.QuotaCookie) == 0 || len(raw.QuotaWorkspaceID) == 0) {
			return true
		}
	}
	// Standalone profiles.json still present → merge it.
	if profilesPath, err := ProfilesPath(); err == nil {
		if _, err := os.Stat(profilesPath); err == nil {
			return true
		}
	}
	return false
}

// EnsureMigration runs the legacy migration once when needed.
func EnsureMigration() error {
	if !NeedsMigration() {
		return nil
	}
	path, err := DefaultPath()
	if err != nil {
		return err
	}
	return MigrateLegacyConfig(path)
}

// ProfilesPath returns the path to the legacy standalone profiles.json. Kept
// only so the migration can detect and absorb it; new code must not write here.
func ProfilesPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "profiles.json"), nil
}
