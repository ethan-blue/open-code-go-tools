package codex

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
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
	DisplayName  string // optional UI label, e.g., "ocgt" when ProviderName is "custom"
	BaseURL      string // e.g., "https://opencode.ai/zen/go/v1"
	APIKey       string // the API key (written to env var, NOT into config.toml)
	EnvKey       string // env var name, e.g., "OCGT_CODEX_API_KEY" (CLI-oriented auth)
	Token        string // provider-scoped experimental_bearer_token — GUI-app friendly
	// auth: desktop apps don't inherit shell env vars, so Token is preferred.
	// Codex forbids combining env_key with experimental_bearer_token; when
	// Token is set it takes precedence and EnvKey is omitted from the block.
	Model       string // default model, e.g., "deepseek-v4-pro"
	CatalogPath string // optional model_catalog_json path for Codex's local /model picker
	WireAPI     string // Responses API protocol; "responses" is the only value modern Codex accepts
}

const (
	beginMarker = "# ocgt-managed-begin"
	endMarker   = "# ocgt-managed-end"

	backupSuffix = ".ocgt-bak"
	defaultPerms = 0o600
	catalogName  = "ocgt-model-catalog.json"

	legacyProviderName = "ocgt"

	// ponytail: neutral catalog prompt only; add per-model overrides if a vendor
	// needs its own identity text instead of cloning Codex's GPT template.
	catalogBaseInstructions = "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals."
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

func CatalogPath() (string, error) {
	p, err := ConfigPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(p), catalogName), nil
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
	catalog := ""
	if strings.TrimSpace(cfg.CatalogPath) != "" {
		catalog = fmt.Sprintf("model_catalog_json = %q\n", catalogConfigValue(cfg.CatalogPath))
	}
	displayName := strings.TrimSpace(cfg.DisplayName)
	if displayName == "" {
		displayName = cfg.ProviderName
	}
	return fmt.Sprintf(`%s
model_provider = %q
model = %q
%s

[model_providers.%s]
name = %q
base_url = %q
%s
wire_api = %q
%s`, beginMarker, cfg.ProviderName, cfg.Model, catalog,
		cfg.ProviderName, displayName,
		normalizeBaseURL(cfg.BaseURL), auth, wire,
		endMarker)
}

func catalogConfigValue(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		return abs
	}
	return filepath.Clean(path)
}

type modelCatalog struct {
	Models []map[string]any `json:"models"`
}

func WriteModelCatalog(modelIDs []string) (string, error) {
	path, err := CatalogPath()
	if err != nil {
		return "", err
	}
	seen := map[string]bool{}
	models := make([]map[string]any, 0, len(modelIDs))
	for _, id := range modelIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, catalogEntry(id, len(models)))
	}
	if len(models) == 0 {
		return "", fmt.Errorf("codex: model catalog requires at least one model")
	}
	data, err := json.MarshalIndent(modelCatalog{Models: models}, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("codex: create catalog dir: %w", err)
	}
	if err := fileutil.AtomicWriteFile(path, append(data, '\n'), defaultPerms); err != nil {
		return "", fmt.Errorf("codex: write model catalog: %w", err)
	}
	return path, nil
}

func RemoveModelCatalog() error {
	path, err := CatalogPath()
	if err != nil {
		return err
	}
	if configReferencesCatalog(path) {
		return nil
	}
	err = os.Remove(path)
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return err
}

func configReferencesCatalog(path string) bool {
	configPath, err := ConfigPath()
	if err != nil {
		return false
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false
	}
	wantAbs, _ := filepath.Abs(path)
	wantBase := filepath.Base(path)
	for _, ref := range modelCatalogRefs(string(data)) {
		if ref == "" || filepath.Base(ref) != wantBase {
			continue
		}
		if !filepath.IsAbs(ref) {
			return true
		}
		refAbs, err := filepath.Abs(ref)
		if err == nil && samePath(refAbs, wantAbs) {
			return true
		}
	}
	return false
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func modelCatalogRefs(content string) []string {
	re := regexp.MustCompile(`(?m)^\s*model_catalog_json\s*=\s*("[^"]*"|'[^']*')`)
	matches := re.FindAllStringSubmatch(content, -1)
	refs := make([]string, 0, len(matches))
	for _, match := range matches {
		raw := match[1]
		if strings.HasPrefix(raw, "'") {
			refs = append(refs, strings.Trim(raw, "'"))
			continue
		}
		ref, err := strconv.Unquote(raw)
		if err != nil {
			ref = strings.Trim(raw, `"`)
		}
		refs = append(refs, ref)
	}
	return refs
}

func catalogEntry(id string, index int) map[string]any {
	return map[string]any{
		"id":                               id,
		"slug":                             id,
		"type":                             "model",
		"name":                             id,
		"display_name":                     id,
		"description":                      id,
		"base_instructions":                catalogBaseInstructions,
		"default_reasoning_level":          "medium",
		"default_reasoning_summary":        "none",
		"support_verbosity":                false,
		"supported_in_api":                 true,
		"supports_reasoning_summaries":     false,
		"supports_parallel_tool_calls":     false,
		"supports_image_detail_original":   false,
		"supports_search_tool":             false,
		"shell_type":                       "shell_command",
		"visibility":                       "list",
		"priority":                         1000 - index,
		"additional_speed_tiers":           []string{},
		"service_tiers":                    []map[string]string{},
		"default_service_tier":             "default",
		"availability_nux":                 nil,
		"upgrade":                          nil,
		"use_responses_lite":               false,
		"truncation_policy":                map[string]any{"mode": "bytes", "limit": 10000},
		"context_window":                   262144,
		"max_context_window":               262144,
		"effective_context_window_percent": 95,
		"experimental_supported_tools":     []string{"shell", "apply_patch", "web_search"},
		"input_modalities":                 []string{"text"},
		// ponytail: one neutral level for third-party models; add richer
		// per-model metadata only after an upstream actually needs it.
		"supported_reasoning_levels": []map[string]string{
			{"effort": "medium", "description": "Default reasoning"},
		},
	}
}

// removeRootKey strips a root-level TOML key assignment (e.g. `model = "x"`)
// from content. Only matches lines at column 0 (no indentation) so keys inside
// [table] sections are left untouched.
func removeRootKey(content, key string) string {
	tableIdx := firstTopLevelTableIndex(content)
	if tableIdx >= 0 {
		root := content[:tableIdx]
		return removeRootKey(root, key) + content[tableIdx:]
	}
	re := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `\s*=\s*("[^"]*"|'[^']*')\s*\r?\n?`)
	return re.ReplaceAllString(content, "")
}

func firstTopLevelTableIndex(content string) int {
	offset := 0
	for offset < len(content) {
		lineEnd := strings.IndexByte(content[offset:], '\n')
		next := len(content)
		if lineEnd >= 0 {
			next = offset + lineEnd + 1
		}
		if strings.HasPrefix(strings.TrimLeft(content[offset:next], " \t"), "[") {
			return offset
		}
		offset = next
	}
	return -1
}

func insertManagedBlock(content, block string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return block + "\n"
	}
	tableIdx := firstTopLevelTableIndex(content)
	if tableIdx < 0 {
		return content + "\n\n" + block + "\n"
	}
	prefix := strings.TrimRight(content[:tableIdx], "\r\n")
	suffix := strings.TrimLeft(content[tableIdx:], "\r\n")
	if prefix == "" {
		return block + "\n\n" + suffix + "\n"
	}
	return prefix + "\n\n" + block + "\n\n" + suffix + "\n"
}

// removeExistingBlock strips any previous ocgt-managed block from existing content.
func removeExistingBlock(content string) string {
	for {
		beginIdx := strings.Index(content, beginMarker)
		if beginIdx < 0 {
			return content
		}
		endIdx := strings.Index(content[beginIdx:], endMarker)
		if endIdx < 0 {
			// Malformed: just cut from begin marker to end.
			return strings.TrimSpace(content[:beginIdx])
		}
		endIdx += beginIdx + len(endMarker)
		rest := content[endIdx:]
		rest = strings.TrimPrefix(rest, "\n")
		rest = strings.TrimPrefix(rest, "\r\n")
		content = strings.TrimSpace(content[:beginIdx]) + "\n" + rest
	}
}

func removeTable(content, table string) string {
	re := regexp.MustCompile(`(?m)^\s*\[` + regexp.QuoteMeta(table) + `\]\s*\r?\n?`)
	nextTable := regexp.MustCompile(`(?m)^\s*\[`)
	for {
		loc := re.FindStringIndex(content)
		if loc == nil {
			return content
		}
		end := len(content)
		if next := nextTable.FindStringIndex(content[loc[1]:]); next != nil {
			end = loc[1] + next[0]
		}
		content = strings.TrimRight(content[:loc[0]], "\r\n") + "\n" + strings.TrimLeft(content[end:], "\r\n")
	}
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

	// Create backup before first mutation. If the current file has no managed
	// block, this is a fresh install and any leftover backup is stale.
	if existing != "" {
		bp, bkErr := backupPath()
		if bkErr != nil {
			return "", bkErr
		}
		if _, statErr := os.Stat(bp); os.IsNotExist(statErr) || !strings.Contains(existing, beginMarker) {
			if writeErr := fileutil.AtomicWriteFile(bp, []byte(existing), defaultPerms); writeErr != nil {
				return "", fmt.Errorf("codex: create backup: %w", writeErr)
			}
		}
	}

	// Merge: remove old ocgt block, then strip any pre-existing root-level
	// model/model_provider keys (from Codex's own defaults or a previous
	// tool) so the managed block is the single source of truth — avoids
	// TOML duplicate-key errors.
	merged := removeExistingBlock(existing)
	merged = removeTable(merged, "model_providers."+cfg.ProviderName)
	if !strings.EqualFold(cfg.ProviderName, legacyProviderName) {
		merged = removeTable(merged, "model_providers."+legacyProviderName)
	}
	merged = removeRootKey(merged, "model")
	merged = removeRootKey(merged, "model_provider")
	merged = removeRootKey(merged, "model_catalog_json")
	merged = insertManagedBlock(merged, generateBlock(cfg))

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

	data, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("codex: read config: %w", err)
	}
	if !strings.Contains(string(data), beginMarker) {
		_ = os.Remove(bp)
		return nil
	}

	// If backup exists, restore it
	if _, statErr := os.Stat(bp); statErr == nil {
		backup, readErr := os.ReadFile(bp)
		if readErr != nil {
			return fmt.Errorf("codex: read backup: %w", readErr)
		}
		if writeErr := fileutil.AtomicWriteFile(configPath, backup, defaultPerms); writeErr != nil {
			return fmt.Errorf("codex: restore backup: %w", writeErr)
		}
		_ = os.Remove(bp)
		return nil
	}

	// No backup — just strip the block
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
