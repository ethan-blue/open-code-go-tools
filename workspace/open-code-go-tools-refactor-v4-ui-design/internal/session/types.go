package session

import "encoding/json"

// ClaudeCodeEvent 映射 Claude Code JSONL 单行事件
type ClaudeCodeEvent struct {
	Type      string          `json:"type"`
	UUID      string          `json:"uuid"`
	SessionID string          `json:"sessionId"`
	Timestamp string          `json:"timestamp"`
	Message   *claudeMessage  `json:"message,omitempty"`
}

type claudeMessage struct {
	ID      string           `json:"id"`
	Model   string           `json:"model"`
	Usage   *claudeUsage     `json:"usage,omitempty"`
	Content json.RawMessage  `json:"content,omitempty"`
}

type claudeUsage struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CacheReadTokens   int `json:"cache_read_input_tokens"`
	CacheCreateTokens int `json:"cache_creation_input_tokens"`
}

// SessionStats 单次会话的聚合统计
type SessionStats struct {
	SessionID         string `json:"sessionId"`
	Model             string `json:"model"`
	MessageCount      int    `json:"messageCount"`
	InputTokens       int64  `json:"inputTokens"`
	OutputTokens      int64  `json:"outputTokens"`
	CacheReadTokens   int64  `json:"cacheReadTokens"`
	CacheCreateTokens int64  `json:"cacheCreateTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	StartTime         string `json:"startTime"`
	LastTime          string `json:"lastTime"`
}

// SessionsResponse API 响应
type SessionsResponse struct {
	Sessions []SessionStats `json:"sessions"`
	Total    int            `json:"total"`
}

// SessionEvent 单条会话事件（API 输出用）
type SessionEvent struct {
	Type      string        `json:"type"`
	UUID      string        `json:"uuid"`
	Timestamp string        `json:"timestamp"`
	Message   *EventMessage `json:"message,omitempty"`
}

// EventMessage 会话事件中的消息信息
type EventMessage struct {
	ID    string      `json:"id"`
	Model string      `json:"model"`
	Usage *EventUsage `json:"usage,omitempty"`
	Text  string      `json:"text,omitempty"`  // 用户消息文本 / assistant 文本
	Tools []string    `json:"tools,omitempty"` // assistant 用到的工具
}

// EventUsage 会话事件中的 token 用量
type EventUsage struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CacheReadTokens   int `json:"cache_read_input_tokens"`
	CacheCreateTokens int `json:"cache_creation_input_tokens"`
}

// SessionDetailResponse 会话详情 API 响应
type SessionDetailResponse struct {
	SessionID string         `json:"sessionId"`
	Events    []SessionEvent `json:"events"`
}
