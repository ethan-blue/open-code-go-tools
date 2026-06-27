package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	CurrentConfigVersion           = 1
	DefaultListen                  = "127.0.0.1:8787"
	DefaultUpstream                = "https://opencode.ai/zen/go"
	DefaultRequestTimeoutSeconds   = 300
	DefaultMaxThinkingBudgetTokens = 2048
	DefaultRateLimitPerSecond      = 100
	DefaultRateLimitBurst          = 200
	DefaultRateLimitPerMinute      = 0 // 0 means unlimited

	// AuthMode values control how the proxy authenticates against an upstream.
	AuthModeBearer  = "bearer"    // Send only Authorization: Bearer (OpenAI-compatible gateways, e.g. opencode.ai/zen/go)
	AuthModeAPIKey  = "x-api-key" // Send only X-Api-Key + Anthropic-Version (genuine Anthropic API / new-api style gateways)
	AuthModeBoth    = "both"      // Send both headers (compatibility fallback for ambiguous upstreams)
	DefaultAuthMode = AuthModeBearer
)

type Config struct {
	Version                 int                `json:"version,omitempty"`
	Listen                  string             `json:"listen"`
	Upstream                string             `json:"upstream"`
	RequestTimeoutSeconds   int                `json:"request_timeout_seconds,omitempty"`
	MaxThinkingBudgetTokens int                `json:"max_thinking_budget_tokens,omitempty"`
	ActiveProfile           string             `json:"active_profile"`
	Profiles                map[string]Profile `json:"profiles"`
	LocalAuthToken          string             `json:"local_auth_token,omitempty"`        // Optional local auth token for proxy access
	MaxConcurrentRequests   int                `json:"max_concurrent_requests,omitempty"` // Optional concurrent request limit
	RateLimitPerSecond      int                `json:"rate_limit_per_second,omitempty"`   // Rate limit: requests per second per IP
	RateLimitBurst          int                `json:"rate_limit_burst,omitempty"`        // Rate limit: max burst size per IP
	RateLimitPerMinute      int                `json:"rate_limit_per_minute,omitempty"`   // Quota protection: max requests per minute (0 = unlimited)
	ClaudeEnv               map[string]string  `json:"claude_env,omitempty"`              // User-editable Claude Code env template
}

// Profile holds configuration for a specific API backend.
// Multiple profiles allow switching between different providers/keys.
//
// Known Limitation: When using OpenAI-compatible endpoints (non-Anthropic upstream),
// usage statistics will lack cache-related fields (cache_creation_input_tokens,
// cache_read_input_tokens) because the OpenAI Chat Completions protocol does not
// support Anthropic's prompt caching metrics. This affects used_percentage
// calculations in downstream tools like Claude Code's status line.
type Profile struct {
	APIKeyEnv        string            `json:"api_key_env"`       // Environment variable name for API key
	APIKey           string            `json:"api_key,omitempty"` // Direct API key (takes precedence over APIKeyEnv)
	DefaultModel     string            `json:"default_model,omitempty"`
	ModelAliases     map[string]string `json:"model_aliases,omitempty"`      // Model name mappings (e.g., "sonnet" -> "deepseek-v4-pro")
	MessageModels    []string          `json:"message_models,omitempty"`     // Models using Anthropic native endpoint (bypass OpenAI conversion)
	FallbackChain    []string          `json:"fallback_chain,omitempty"`     // Automatic fallback models on failure
	Headers          map[string]string `json:"headers,omitempty"`            // Custom headers for upstream requests
	AuthMode         string            `json:"auth_mode,omitempty"`          // How the proxy authenticates to this upstream: "bearer" (default) | "x-api-key" | "both"
	QuotaCookie      string            `json:"quota_cookie,omitempty"`       // OpenCode Go auth cookie for quota display
	QuotaWorkspaceID string            `json:"quota_workspace_id,omitempty"` // OpenCode Go workspace ID for quota display
}

func DefaultPath() (string, error) {
	if p := strings.TrimSpace(os.Getenv("OCGT_CONFIG")); p != "" {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ocgt", "config.json"), nil
}

func Example() Config {
	defaultProfile := Profile{
		APIKeyEnv:    "OPENCODE_GO_API_KEY",
		DefaultModel: "kimi-k2.6",
		ModelAliases: map[string]string{
			"deepseek": "deepseek-v4-pro",
			"flash":    "deepseek-v4-flash",
			"glm":      "glm-5.1",
			"glm5":     "glm-5",
			"hy3":      "hy3-preview",
			"kimi":     "kimi-k2.6",
			"kimi25":   "kimi-k2.5",
			"mimo":     "mimo-v2.5-pro",
			"mimo25":   "mimo-v2.5",
			"minimax":  "minimax-m2.7",
			"opus":     "kimi-k2.6",
			"qwen":     "qwen3.6-plus",
			"qwen35":   "qwen3.5-plus",
			"sonnet":   "deepseek-v4-pro",
			"haiku":    "deepseek-v4-flash",
		},
		MessageModels:    []string{"minimax-m2.5", "minimax-m2.7"},
		FallbackChain:    []string{"kimi-k2.6", "qwen3.6-plus", "deepseek-v4-flash"},
		QuotaCookie:      "${OPENCODE_GO_AUTH_COOKIE}",
		QuotaWorkspaceID: "${OPENCODE_GO_WORKSPACE_ID}",
	}
	return Config{
		Version:                 CurrentConfigVersion,
		Listen:                  DefaultListen,
		Upstream:                DefaultUpstream,
		RequestTimeoutSeconds:   DefaultRequestTimeoutSeconds,
		MaxThinkingBudgetTokens: DefaultMaxThinkingBudgetTokens,
		RateLimitPerSecond:      DefaultRateLimitPerSecond,
		RateLimitBurst:          DefaultRateLimitBurst,
		ClaudeEnv:               DefaultClaudeEnv(defaultProfile),
		ActiveProfile:           "opencode-go",
		Profiles: map[string]Profile{
			"opencode-go": defaultProfile,
		},
	}
}

func DefaultClaudeEnv(profile Profile) map[string]string {
	env := map[string]string{
		"API_TIMEOUT_MS": "600000",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
		"DISABLE_NON_ESSENTIAL_MODEL_CALLS":        "1",
		"CLAUDE_CODE_ATTRIBUTION_HEADER":           "0",
		"CLAUDE_CODE_MAX_OUTPUT_TOKENS":            "131072",
		"ENABLE_TOOL_SEARCH":                       "true",
		"MAX_MCP_OUTPUT_TOKENS":                    "200000",
		"MCP_TIMEOUT":                              "600000",
		"MCP_TOOL_TIMEOUT":                         "600000",
	}
	if profile.DefaultModel != "" {
		env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = profile.ResolveModel("opus")
		env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = profile.ResolveModel("sonnet")
		env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = profile.ResolveModel("haiku")
		env["ANTHROPIC_SMALL_FAST_MODEL"] = profile.ResolveModel("haiku")
		env["CLAUDE_CODE_SUBAGENT_MODEL"] = profile.ResolveModel("haiku")
	}
	return env
}

func Load(path string) (Config, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return Config{}, fmt.Errorf("failed to determine config path: %w", err)
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("failed to read config file %q: %w", path, err)
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("failed to parse config file %q: %w", path, err)
	}
	cfg.applyDefaults()
	cfg.Migrate()
	return cfg, cfg.Validate()
}

func WriteExample(path string, overwrite bool) (string, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return "", err
		}
	}
	if !overwrite {
		if _, err := os.Stat(path); err == nil {
			return path, fmt.Errorf("config already exists: %s", path)
		} else if !errors.Is(err, os.ErrNotExist) {
			return path, err
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return path, err
	}
	data, err := json.MarshalIndent(Example(), "", "  ")
	if err != nil {
		return path, err
	}
	return path, atomicWriteFile(path, append(data, '\n'), 0o600)
}

func (c Config) Save(path string) error {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	c.Version = CurrentConfigVersion

	// Read existing file first to preserve unknown fields
	existing := make(map[string]any)
	if existingData, err := os.ReadFile(path); err == nil {
		existingData = bytes.TrimPrefix(existingData, []byte{0xEF, 0xBB, 0xBF})
		_ = json.Unmarshal(existingData, &existing)
	}

	// Marshal the config struct to get known fields
	knownData, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	var known map[string]any
	if err := json.Unmarshal(knownData, &known); err != nil {
		return err
	}

	// Merge: known fields overwrite existing, unknown fields preserved
	for k, v := range known {
		existing[k] = v
	}

	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(path, append(data, '\n'), 0o600)
}

func (c *Config) Migrate() {
	if c.Version >= CurrentConfigVersion {
		return
	}
	if c.Version == 0 {
		// v0 → v1: no breaking changes, just stamp the version
		c.Version = CurrentConfigVersion
	}
	// Future migrations go here as else-if chains:
	// else if c.Version == 1 { ... c.Version = 2 }
}

func (c *Config) applyDefaults() {
	if c.Listen == "" {
		c.Listen = DefaultListen
	}
	if c.Upstream == "" {
		c.Upstream = DefaultUpstream
	}
	if c.RequestTimeoutSeconds == 0 {
		c.RequestTimeoutSeconds = DefaultRequestTimeoutSeconds
	}
	if c.MaxThinkingBudgetTokens == 0 {
		c.MaxThinkingBudgetTokens = DefaultMaxThinkingBudgetTokens
	}
	if c.RateLimitPerSecond == 0 {
		c.RateLimitPerSecond = DefaultRateLimitPerSecond
	}
	if c.RateLimitBurst == 0 {
		c.RateLimitBurst = DefaultRateLimitBurst
	}
	if c.Profiles == nil {
		c.Profiles = map[string]Profile{}
	}
	if c.ActiveProfile == "" && len(c.Profiles) == 1 {
		for name := range c.Profiles {
			c.ActiveProfile = name
		}
	}
}

func (c Config) Validate() error {
	if err := ValidateListenAddress(c.Listen); err != nil {
		return err
	}
	if _, err := url.ParseRequestURI(c.Upstream); err != nil {
		return fmt.Errorf("invalid upstream %q: %w", c.Upstream, err)
	}
	if c.RequestTimeoutSeconds < 1 || c.RequestTimeoutSeconds > 3600 {
		return fmt.Errorf("request_timeout_seconds must be between 1 and 3600, got %d", c.RequestTimeoutSeconds)
	}
	if c.MaxThinkingBudgetTokens < -1 || c.MaxThinkingBudgetTokens > 8192 {
		return fmt.Errorf("max_thinking_budget_tokens must be -1, 0, or between 1 and 8192, got %d", c.MaxThinkingBudgetTokens)
	}
	if c.RateLimitPerSecond < 1 || c.RateLimitPerSecond > 10000 {
		return fmt.Errorf("rate_limit_per_second must be between 1 and 10000, got %d", c.RateLimitPerSecond)
	}
	if c.RateLimitBurst < 1 || c.RateLimitBurst > 100000 {
		return fmt.Errorf("rate_limit_burst must be between 1 and 100000, got %d", c.RateLimitBurst)
	}
	if c.RateLimitPerMinute < 0 || c.RateLimitPerMinute > 100000 {
		return fmt.Errorf("rate_limit_per_minute must be between 0 and 100000, got %d", c.RateLimitPerMinute)
	}
	if len(c.Profiles) == 0 {
		return errors.New("at least one profile is required")
	}
	if _, ok := c.Profiles[c.ActiveProfile]; !ok {
		return fmt.Errorf("active profile %q does not exist", c.ActiveProfile)
	}
	return nil
}

func ValidateListenAddress(listen string) error {
	host, portText, err := net.SplitHostPort(strings.TrimSpace(listen))
	if err != nil {
		return fmt.Errorf("invalid listen address %q: expected host:port, for example 127.0.0.1:8787 or :8787", listen)
	}
	if strings.ContainsAny(host, " \t\r\n") {
		return fmt.Errorf("invalid listen address %q: host must not contain whitespace", listen)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("invalid listen address %q: port must be between 1 and 65535", listen)
	}
	return nil
}

func (c Config) ThinkingBudgetTokens() int {
	if c.MaxThinkingBudgetTokens == 0 {
		return DefaultMaxThinkingBudgetTokens
	}
	return c.MaxThinkingBudgetTokens
}

func (c Config) RateLimit() (perSecond, burst int) {
	perSecond = c.RateLimitPerSecond
	if perSecond == 0 {
		perSecond = DefaultRateLimitPerSecond
	}
	burst = c.RateLimitBurst
	if burst == 0 {
		burst = DefaultRateLimitBurst
	}
	return
}

func (c Config) RequestTimeout() time.Duration {
	seconds := c.RequestTimeoutSeconds
	if seconds == 0 {
		seconds = DefaultRequestTimeoutSeconds
	}
	return time.Duration(seconds) * time.Second
}

// WarnIfNoAPIKey checks if the active profile has an API key and returns a warning message if not.
func (c Config) WarnIfNoAPIKey() string {
	profile, name, err := c.Profile("")
	if err != nil {
		return ""
	}
	if profile.APIKeyValue() == "" {
		return fmt.Sprintf("profile %q has no API key (set %s or configure api_key)", name, profile.APIKeyEnv)
	}
	return ""
}

func (c Config) Profile(name string) (Profile, string, error) {
	if strings.TrimSpace(name) == "" {
		name = c.ActiveProfile
	}
	p, ok := c.Profiles[name]
	if !ok {
		return Profile{}, name, fmt.Errorf("profile %q does not exist", name)
	}
	return p, name, nil
}

func (p Profile) APIKeyValue() string {
	if p.APIKey != "" && !IsMaskedAPIKey(p.APIKey) {
		return p.APIKey
	}
	if p.APIKeyEnv != "" {
		return os.Getenv(p.APIKeyEnv)
	}
	return ""
}

// EffectiveAuthMode returns the normalized auth mode for this profile, falling
// back to DefaultAuthMode ("bearer") for empty or unrecognized values. Keeping
// the fallback here (rather than at every call site) guarantees that old config
// files without an auth_mode field behave exactly as before.
func (p Profile) EffectiveAuthMode() string {
	switch strings.ToLower(strings.TrimSpace(p.AuthMode)) {
	case AuthModeAPIKey, AuthModeBoth:
		return strings.ToLower(strings.TrimSpace(p.AuthMode))
	default:
		return DefaultAuthMode
	}
}

// IsMaskedAPIKey returns true if the key appears to be a masked/placeholder value
// (e.g., "****" or contains "..."), indicating the user didn't change it.
func IsMaskedAPIKey(key string) bool {
	return key == "****" || strings.Contains(key, "...")
}

func (p Profile) ResolveModel(model string) string {
	if model == "" {
		model = p.DefaultModel
	}
	model = strings.TrimSpace(model)
	if p.ModelAliases != nil {
		if mapped := p.ModelAliases[model]; mapped != "" {
			return mapped
		}
	}
	lower := strings.ToLower(model)
	switch {
	case strings.Contains(lower, "opus"):
		return p.resolveAliasOrDefault("opus")
	case strings.Contains(lower, "sonnet"):
		return p.resolveAliasOrDefault("sonnet")
	case strings.Contains(lower, "haiku"):
		return p.resolveAliasOrDefault("haiku")
	}
	return model
}

func (p Profile) resolveAliasOrDefault(alias string) string {
	if p.ModelAliases != nil {
		if mapped := p.ModelAliases[alias]; mapped != "" {
			return mapped
		}
	}
	return p.DefaultModel
}

func (p Profile) UsesMessagesEndpoint(model string) bool {
	model = p.ResolveModel(model)
	for _, candidate := range p.MessageModels {
		if strings.EqualFold(candidate, model) {
			return true
		}
	}
	return false
}
