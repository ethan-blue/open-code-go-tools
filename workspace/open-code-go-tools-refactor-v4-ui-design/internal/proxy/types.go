package proxy

import (
	"embed"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/hub"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	"github.com/ethan-blue/open-code-go-tools/internal/session"
)

const maxReasoningEntries = 1024

// MaxBodySize is the maximum allowed request body size (50 MB).
// Increased from 10MB to accommodate large tool call arguments (e.g., file content for WRITE/EDIT tools)
// and requests with extensive conversation history.
const MaxBodySize int64 = 50 << 20

type requestLogEntry struct {
	ID                  string    `json:"id"`
	Time                time.Time `json:"time"`
	Method              string    `json:"method"`
	Path                string    `json:"path"`
	Status              int       `json:"status"`
	Duration            string    `json:"duration"`
	Model               string    `json:"model"`
	Route               string    `json:"route"`
	Client              string    `json:"client,omitempty"`
	InputTokens         int       `json:"input_tokens,omitempty"`
	OutputTokens        int       `json:"output_tokens,omitempty"`
	CacheCreationTokens int       `json:"cache_creation_tokens,omitempty"`
	CacheReadTokens     int       `json:"cache_read_tokens,omitempty"`
	TotalTokens         int       `json:"total_tokens,omitempty"`
	Error               string    `json:"error,omitempty"`
}

type Server struct {
	config     config.Config
	configPath string
	client     *http.Client
	upstream   string
	webAssets  *embed.FS

	configMu    sync.RWMutex // Protects config, upstream, and client.Timeout
	rateLimiter *rateLimiter
	rpmLimiter  *rpmLimiter

	reasoningMu     sync.Mutex
	reasoningByTool map[string]string
	reasoningOrder  []string

	historyMu sync.RWMutex
	history   []requestLogEntry

	historyLogMu            sync.Mutex
	historyLogEnabled       bool
	historyLogDir           string
	historyLogRetentionDays int
	historyLogLastCleanup   time.Time

	// Circuit breaker state
	circuitMu           sync.Mutex
	consecutiveFailures map[string]int
	trippedUntil        map[string]time.Time

	// Auto-generated auth token when config.LocalAuthToken is empty
	// Protects the dashboard API from in-network access by default
	autoAuthToken string
	autoAuthOnce  sync.Once

	// Tracks in-flight streaming requests for graceful shutdown.
	// On shutdown, ListenAndServe waits for all tracked requests to complete.
	wg sync.WaitGroup

	// Quota monitoring — cached quota data from OpenCode Go RPC.
	quotaData *quota.QuotaData
	quotaMu   sync.RWMutex

	// Hub client for cross-device sync.
	HubClient *hub.Client

	// 跨设备同步计数器，由外部设置
	HubCounters *hub.SyncCounters

	// Sessions cache: ReadAllSessions 结果缓存，避免每次导航都重扫所有 JSONL
	sessionsCacheMu  sync.RWMutex
	sessionsCache    []session.SessionStats
	sessionsCacheAt  time.Time
	sessionsCacheTTL time.Duration
}

func (s *Server) SetConfigPath(path string) {
	s.configPath = path
}

// SetHubCounters 注入跨设备同步计数器。
func (s *Server) SetHubCounters(c *hub.SyncCounters) {
	s.HubCounters = c
}

// SetHubClient 注入跨设备同步客户端。
func (s *Server) SetHubClient(c *hub.Client) {
	s.HubClient = c
}

type anthropicRequest struct {
	Model         string          `json:"model"`
	MaxTokens     int             `json:"max_tokens,omitempty"`
	Messages      []anthropicMsg  `json:"messages"`
	System        any             `json:"system,omitempty"`
	Stream        bool            `json:"stream,omitempty"`
	Temperature   *float64        `json:"temperature,omitempty"`
	TopP          *float64        `json:"top_p,omitempty"`
	StopSequences []string        `json:"stop_sequences,omitempty"`
	Thinking      any             `json:"thinking,omitempty"`
	Tools         []anthropicTool `json:"tools,omitempty"`
	ToolChoice    any             `json:"tool_choice,omitempty"`
}

type anthropicMsg struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type anthropicTool struct {
	Type        string         `json:"type,omitempty"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema"`
}

type openAIRequest struct {
	Model         string          `json:"model"`
	Messages      []openAIMessage `json:"messages"`
	Stream        bool            `json:"stream,omitempty"`
	StreamOptions map[string]bool `json:"stream_options,omitempty"`
	MaxTokens     int             `json:"max_tokens,omitempty"`
	Temperature   *float64        `json:"temperature,omitempty"`
	TopP          *float64        `json:"top_p,omitempty"`
	Stop          []string        `json:"stop,omitempty"`
	Tools         []openAITool    `json:"tools,omitempty"`
	ToolChoice    any             `json:"tool_choice,omitempty"`
	Thinking      any             `json:"thinking,omitempty"`
	// DeepSeek-compatible thinking effort. Only set for models that advertise this parameter.
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

type openAIMessage struct {
	Role             string     `json:"role"`
	Content          any        `json:"content,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
	ToolCalls        []toolCall `json:"tool_calls,omitempty"`
	Name             string     `json:"name,omitempty"`
}

type openAITool struct {
	Type     string         `json:"type"`
	Function openAIFunction `json:"function"`
}

type openAIFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters"`
}

type openAIResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content          string     `json:"content"`
			ReasoningContent any        `json:"reasoning_content"`
			ThinkingContent  any        `json:"thinking_content"`  // compatibility
			Thinking         any        `json:"thinking"`          // compatibility
			Reasoning        any        `json:"reasoning"`         // compatibility
			ReasoningDetails any        `json:"reasoning_details"` // compatibility
			ToolCalls        []toolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage"`
}

type openAIChunk struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content          string     `json:"content"`
			ReasoningContent any        `json:"reasoning_content"`
			ThinkingContent  any        `json:"thinking_content"`  // compatibility
			Thinking         any        `json:"thinking"`          // compatibility
			Reasoning        any        `json:"reasoning"`         // compatibility
			ReasoningDetails any        `json:"reasoning_details"` // compatibility
			ToolCalls        []toolCall `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage"`
}

type toolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function"`
	Index *int `json:"index,omitempty"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	// Prompt caching details — 部分上游（如 DeepSeek/Qwen）在 OpenAI 格式中返回
	PromptTokensDetails *promptTokensDetails `json:"prompt_tokens_details,omitempty"`
	// Anthropic 原生 cache 字段 — 某些上游在 OpenAI 格式中也返回这些字段
	CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
}

type promptTokensDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type anthropicError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type anthropicErrorResponse struct {
	Error anthropicError `json:"error"`
}

func New(cfg config.Config, webAssets ...*embed.FS) (*Server, error) {
	var assets *embed.FS
	if len(webAssets) > 0 {
		assets = webAssets[0]
	}
	transport := &http.Transport{
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   100,
		IdleConnTimeout:       90 * time.Second,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
	}
	return &Server{
		config:              cfg,
		upstream:            cfg.Upstream,
		client:              &http.Client{Timeout: cfg.RequestTimeout(), Transport: transport},
		rateLimiter:         newRateLimiter(cfg.RateLimit()),
		rpmLimiter:          newRpmLimiter(cfg.RateLimitPerMinute),
		reasoningByTool:     map[string]string{},
		consecutiveFailures: map[string]int{},
		trippedUntil:        map[string]time.Time{},
		webAssets:           assets,
		sessionsCacheTTL:    30 * time.Second,
	}, nil
}

func (s *Server) Config() *config.Config {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return &s.config
}

func (s *Server) ApplyConfig(cfg config.Config) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	s.config = cfg
	s.upstream = cfg.Upstream
	if s.client != nil {
		// Replace the entire client so concurrent readers that already
		// snapshotted the old pointer keep using a consistent timeout.
		old := s.client
		s.client = &http.Client{
			Timeout:   cfg.RequestTimeout(),
			Transport: old.Transport,
		}
	}
	if s.rateLimiter != nil {
		s.rateLimiter.setLimits(cfg.RateLimit())
	}
	if s.rpmLimiter != nil {
		s.rpmLimiter.setLimit(cfg.RateLimitPerMinute)
	}
}

// clientSnapshot returns a consistent snapshot of the HTTP client under the config read lock.
// Safe to call from concurrent HTTP handlers.
func (s *Server) clientSnapshot() *http.Client {
	s.configMu.RLock()
	c := s.client
	s.configMu.RUnlock()
	return c
}

func (s *Server) ListenAddress() string {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.config.Listen
}

func (s *Server) recordModelSuccess(model string) {
	s.circuitMu.Lock()
	defer s.circuitMu.Unlock()
	s.consecutiveFailures[model] = 0
	delete(s.trippedUntil, model)
}

func (s *Server) recordModelFailure(model string) {
	s.circuitMu.Lock()
	defer s.circuitMu.Unlock()
	s.consecutiveFailures[model]++
	if s.consecutiveFailures[model] >= 3 {
		s.trippedUntil[model] = time.Now().Add(30 * time.Second)
		log.Printf("[CircuitBreaker] Model %q has failed consecutively %d times. Tripped for 30 seconds.", model, s.consecutiveFailures[model])
	}
}

func (s *Server) isModelCircuitTripped(model string) bool {
	s.circuitMu.Lock()
	defer s.circuitMu.Unlock()
	until, ok := s.trippedUntil[model]
	if !ok {
		return false
	}
	if time.Now().After(until) {
		// Cooldown period expired, reset failure counter and untrip
		s.consecutiveFailures[model] = 0
		delete(s.trippedUntil, model)
		return false
	}
	return true
}
