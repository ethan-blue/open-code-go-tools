package codex

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
)

// ProviderConfig holds the data needed to generate a Codex provider entry.
//
// The Codex CLI and the official Codex desktop app share the same user-level
// ~/.codex/config.toml, so one managed block covers both clients. auth.json is
// deliberately never touched — the official ChatGPT/Codex OAuth login stays
// intact (same strategy as cc-switch's "official auth preservation").
type ProviderConfig struct {
	ProviderName string // e.g., "ocgt" — used as model_provider key
	BaseURL      string // e.g., "https://opencode.ai/zen/go/v1"
	APIKey       string // the API key (written to env var, NOT into config.toml)
	EnvKey       string // env var name, e.g., "OCGT_CODEX_API_KEY" (CLI-oriented auth)
	Token        string // provider-scoped experimental_bearer_token — GUI-app friendly
	// auth: desktop apps don't inherit shell env vars, so Token is preferred.
	// Codex forbids combining env_key with experimental_bearer_token; when
	// Token is set it takes precedence and EnvKey is omitted from the block.
	Model   string // default model, e.g., "claude-sonnet-4-6"
	WireAPI string // Responses API protocol; "responses" is the only value modern Codex accepts
}

const (
	beginMarker = "# ocgt-managed-begin — do not edit between these markers"
	endMarker   = "# ocgt-managed-end"

	backupSuffix = ".ocgt-bak"
	defaultPerms = 0o600
)

// ConfigPath returns the path to ~/.codex/config.toml.
func ConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("codex: determine home dir: %w", err)
	}
	return filepath.Join(home, ".codex", "config.toml"), nil
}

// backupPath returns the path to ~/.codex/config.toml.ocgt-bak.
func backupPath() (string, error) {
	p, err := ConfigPath()
	if err != nil {
		return "", err
	}
	return p + backupSuffix, nil
}

// IsConfigured checks if ~/.codex/config.toml exists and contains an ocgt-managed block.
func IsConfigured() (bool, error) {
	p, err := ConfigPath()
	if err != nil {
		return false, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return strings.Contains(string(data), beginMarker), nil
}

// normalizeBaseURL ensures the URL ends with /v1 for OpenAI-compatible APIs.
func normalizeBaseURL(raw string) string {
	s := strings.TrimRight(raw, "/")
	if strings.HasSuffix(s, "/v1") {
		return s
	}
	return s + "/v1"
}

// generateBlock produces the TOML text for the ocgt-managed section.
func generateBlock(cfg ProviderConfig) string {
	// Since Codex 0.x (Feb 2026) "responses" is the ONLY supported wire_api —
	// "chat" makes Codex error on startup. Default and coerce accordingly.
	wire := cfg.WireAPI
	if wire == "" || wire == "chat" {
		wire = "responses"
	}
	// Auth line: provider-scoped bearer token (works for the desktop app,
	// which never sees shell env vars) or the legacy env_key indirection.
	// Codex rejects configs that combine both.
	auth := fmt.Sprintf("env_key = %q", cfg.EnvKey)
	if cfg.Token != "" {
		auth = fmt.Sprintf("experimental_bearer_token = %q", cfg.Token)
	}
	return fmt.Sprintf(`%s
model_provider = %q
model = %q

[model_providers.%s]
name = %q
base_url = %q
%s
wire_api = %q
%s`, beginMarker, cfg.ProviderName, cfg.Model,
		cfg.ProviderName, cfg.ProviderName,
		normalizeBaseURL(cfg.BaseURL), auth, wire,
		endMarker)
}

// removeExistingBlock strips any previous ocgt-managed block from existing content.
func removeExistingBlock(content string) string {
	beginIdx := strings.Index(content, beginMarker)
	if beginIdx < 0 {
		return content
	}
	endIdx := strings.Index(content[beginIdx:], endMarker)
	if endIdx < 0 {
		// Malformed — just cut from begin marker to end
		return strings.TrimSpace(content[:beginIdx])
	}
	endIdx += beginIdx + len(endMarker)
	// Remove the block plus any trailing newline
	rest := content[endIdx:]
	rest = strings.TrimPrefix(rest, "\n")
	rest = strings.TrimPrefix(rest, "\r\n")
	return strings.TrimSpace(content[:beginIdx]) + "\n" + rest
}

// WriteConfig writes or merges the Codex provider config into ~/.codex/config.toml.
func WriteConfig(cfg ProviderConfig) (string, error) {
	if cfg.ProviderName == "" {
		return "", fmt.Errorf("codex: ProviderName is required")
	}
	if cfg.BaseURL == "" {
		return "", fmt.Errorf("codex: BaseURL is required")
	}
	if cfg.EnvKey == "" && cfg.Token == "" {
		return "", fmt.Errorf("codex: either EnvKey or Token is required")
	}

	configPath, err := ConfigPath()
	if err != nil {
		return "", err
	}

	// Ensure ~/.codex/ directory exists
	codexDir := filepath.Dir(configPath)
	if err := os.MkdirAll(codexDir, 0o700); err != nil {
		return "", fmt.Errorf("codex: create dir %s: %w", codexDir, err)
	}

	// Read existing content
	var existing string
	data, err := os.ReadFile(configPath)
	switch {
	case err == nil:
		existing = string(data)
	case os.IsNotExist(err):
		// New file
	default:
		return "", fmt.Errorf("codex: read existing config: %w", err)
	}

	// Create backup before first mutation (only if file exists and no backup yet)
	if existing != "" {
		bp, bkErr := backupPath()
		if bkErr != nil {
			return "", bkErr
		}
		if _, statErr := os.Stat(bp); os.IsNotExist(statErr) {
			if writeErr := fileutil.AtomicWriteFile(bp, []byte(existing), defaultPerms); writeErr != nil {
				return "", fmt.Errorf("codex: create backup: %w", writeErr)
			}
		}
	}

	// Merge: remove old ocgt block, append new one
	merged := removeExistingBlock(existing)
	if merged != "" && !strings.HasSuffix(merged, "\n") {
		merged += "\n"
	}
	if merged != "" {
		merged += "\n"
	}
	merged += generateBlock(cfg) + "\n"

	if err := fileutil.AtomicWriteFile(configPath, []byte(merged), defaultPerms); err != nil {
		return "", fmt.Errorf("codex: write config: %w", err)
	}

	return configPath, nil
}

// UndoConfig removes the ocgt-managed block from ~/.codex/config.toml.
// If a backup exists, it restores the original. Otherwise, it strips the block.
func UndoConfig() error {
	configPath, err := ConfigPath()
	if err != nil {
		return err
	}

	bp, err := backupPath()
	if err != nil {
		return err
	}

	// If backup exists, restore it
	if _, statErr := os.Stat(bp); statErr == nil {
		data, readErr := os.ReadFile(bp)
		if readErr != nil {
			return fmt.Errorf("codex: read backup: %w", readErr)
		}
		if writeErr := fileutil.AtomicWriteFile(configPath, data, defaultPerms); writeErr != nil {
			return fmt.Errorf("codex: restore backup: %w", writeErr)
		}
		_ = os.Remove(bp)
		return nil
	}

	// No backup — just strip the block
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing to undo
		}
		return fmt.Errorf("codex: read config: %w", err)
	}

	stripped := removeExistingBlock(string(data))
	if stripped == strings.TrimSpace(string(data)) {
		// No block found — nothing changed
		return nil
	}

	if err := fileutil.AtomicWriteFile(configPath, []byte(stripped+"\n"), defaultPerms); err != nil {
		return fmt.Errorf("codex: write stripped config: %w", err)
	}
	return nil
}

// MaskKey returns a masked version of an API key for safe display.
func MaskKey(key string) string {
	if len(key) <= 8 {
		return strings.Repeat("*", len(key))
	}
	return key[:3] + "..." + key[len(key)-4:]
}
