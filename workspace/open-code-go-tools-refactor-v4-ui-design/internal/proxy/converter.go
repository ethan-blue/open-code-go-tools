package proxy

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func anthropicToOpenAI(in anthropicRequest) openAIRequest {
	out := openAIRequest{
		Model:       in.Model,
		Stream:      in.Stream,
		MaxTokens:   in.MaxTokens,
		Temperature: in.Temperature,
		TopP:        in.TopP,
		Stop:        in.StopSequences,
	}
	if out.Stream {
		out.StreamOptions = map[string]bool{"include_usage": true}
	}
	
	// Clamp MaxTokens to prevent "Range of max_tokens should be [1, 65536]" errors
	// (common with Qwen and other non-OpenAI standard providers)
	if out.MaxTokens <= 0 {
		out.MaxTokens = 8192 // safe default if omitted
	} else if out.MaxTokens > 65536 {
		out.MaxTokens = 65536
	}

	if system := blocksToText(in.System); system != "" {
		out.Messages = append(out.Messages, openAIMessage{Role: "system", Content: system})
	}
	for _, msg := range in.Messages {
		out.Messages = append(out.Messages, anthropicMessageToOpenAI(msg)...)
	}
	allowedToolNames := map[string]bool{}
	for _, tool := range in.Tools {
		if !isConvertibleClientTool(tool) {
			continue
		}
		allowedToolNames[tool.Name] = true
		out.Tools = append(out.Tools, openAITool{
			Type: "function",
			Function: openAIFunction{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  tool.InputSchema,
			},
		})
	}
	out.ToolChoice = convertToolChoice(in.ToolChoice, allowedToolNames)
	return out
}

func anthropicMessageToOpenAI(msg anthropicMsg) []openAIMessage {
	blocks, ok := msg.Content.([]any)
	if !ok {
		return []openAIMessage{{Role: normalizeRole(msg.Role), Content: blocksToText(msg.Content)}}
	}
	var messages []openAIMessage
	var textParts []string
	var contentParts []map[string]any
	var toolCalls []toolCall
	var thinkingBlocks []string
	hasImage := false
	flushUserContent := func() {
		if hasImage {
			messages = append(messages, openAIMessage{Role: "user", Content: contentParts})
		} else if len(textParts) > 0 {
			messages = append(messages, openAIMessage{Role: "user", Content: strings.Join(textParts, "\n")})
		}
		textParts = nil
		contentParts = nil
		hasImage = false
	}
	for _, block := range blocks {
		m, ok := block.(map[string]any)
		if !ok {
			continue
		}
		switch m["type"] {
		case "text":
			if text, _ := m["text"].(string); text != "" {
				textParts = append(textParts, text)
				contentParts = append(contentParts, map[string]any{"type": "text", "text": text})
			}
		case "tool_use":
			id, _ := m["id"].(string)
			name, _ := m["name"].(string)
			args, _ := json.Marshal(m["input"])
			call := toolCall{ID: id, Type: "function"}
			call.Function.Name = name
			call.Function.Arguments = string(args)
			toolCalls = append(toolCalls, call)
		case "tool_result":
			flushUserContent()
			if len(thinkingBlocks) > 0 {
				messages = append(messages, openAIMessage{Role: "assistant", ReasoningContent: strings.Join(thinkingBlocks, "\n")})
				thinkingBlocks = nil
			}
			id, _ := m["tool_use_id"].(string)
			messages = append(messages, openAIMessage{Role: "tool", ToolCallID: id, Content: blocksToText(m["content"])})
		case "thinking":
			if text, _ := m["thinking"].(string); text != "" {
				thinkingBlocks = append(thinkingBlocks, text)
			}
		case "image":
			if source, _ := m["source"].(map[string]any); source != nil {
				stype, _ := source["type"].(string)
				switch stype {
				case "base64":
					mediaType, _ := source["media_type"].(string)
					data, _ := source["data"].(string)
					if mediaType != "" && data != "" {
						hasImage = true
						contentParts = append(contentParts, openAIImageURLPart("data:"+mediaType+";base64,"+data))
					}
				case "url":
					url, _ := source["url"].(string)
					if url != "" {
						hasImage = true
						contentParts = append(contentParts, openAIImageURLPart(url))
					}
				}
			}
			if !hasImage {
				textParts = append(textParts, "[image]")
			}
		}
	}
	if len(toolCalls) > 0 {
		content := strings.Join(textParts, "\n")
		reasoning := strings.Join(thinkingBlocks, "\n")
		messages = append(messages, openAIMessage{Role: "assistant", Content: content, ReasoningContent: reasoning, ToolCalls: toolCalls})
		return messages
	}
	if len(thinkingBlocks) > 0 {
		content := strings.Join(textParts, "\n")
		reasoning := strings.Join(thinkingBlocks, "\n")
		messages = append(messages, openAIMessage{Role: normalizeRole(msg.Role), Content: content, ReasoningContent: reasoning})
		return messages
	}
	if hasImage {
		messages = append(messages, openAIMessage{Role: normalizeRole(msg.Role), Content: contentParts})
		return messages
	}
	if len(textParts) > 0 {
		messages = append(messages, openAIMessage{Role: normalizeRole(msg.Role), Content: strings.Join(textParts, "\n")})
	}
	return messages
}

func openAIImageURLPart(url string) map[string]any {
	return map[string]any{
		"type": "image_url",
		"image_url": map[string]any{
			"url": url,
		},
	}
}

func openAIToAnthropic(in openAIResponse, model string, fallbackInputTokens int) map[string]any {
	content := []map[string]any{}
	stopReason := "end_turn"
	if len(in.Choices) > 0 {
		choice := in.Choices[0]
		rc := reasoningText(choice.Message.ReasoningContent, choice.Message.ThinkingContent, choice.Message.Thinking, choice.Message.Reasoning, choice.Message.ReasoningDetails)
		if rc != "" {
			content = append(content, map[string]any{
				"type":     "thinking",
				"thinking": rc,
			})
		}
		if choice.Message.Content != "" {
			content = append(content, map[string]any{"type": "text", "text": choice.Message.Content})
		}
		for _, call := range choice.Message.ToolCalls {
			content = append(content, map[string]any{
				"type":  "tool_use",
				"id":    fallbackToolID(call.ID),
				"name":  call.Function.Name,
				"input": parseJSONObj(call.Function.Arguments),
			})
		}
		reason := ""
		if choice.FinishReason != nil {
			reason = *choice.FinishReason
		}
		stopReason = finishReason(reason, len(choice.Message.ToolCalls) > 0)
	}
	// Build usage object with defensive defaults for OpenAI-to-Anthropic conversion
	// OpenAI protocol lacks Anthropic-specific cache fields (cache_creation_input_tokens,
	// cache_read_input_tokens). These remain 0 for non-Anthropic upstreams (kimi/deepseek/etc).
	// This is an architectural limitation, not a bug.
	usageInfo := usageFromOpenAI(in.Usage, fallbackInputTokens)
	usage := map[string]int{
		"input_tokens":                usageInfo.InputTokens,
		"output_tokens":               usageInfo.OutputTokens,
		"cache_creation_input_tokens": usageInfo.CacheCreationTokens,
		"cache_read_input_tokens":     usageInfo.CacheReadTokens,
	}

	return map[string]any{
		"id":            firstNonEmpty(in.ID, "msg_ocgt_"+strconv.FormatInt(time.Now().UnixNano(), 36)),
		"type":          "message",
		"role":          "assistant",
		"model":         firstNonEmpty(in.Model, model),
		"content":       content,
		"stop_reason":   stopReason,
		"stop_sequence": nil,
		"usage":         usage,
	}
}

func usageFromOpenAI(in openAIUsage, fallbackInputTokens int) tokenUsage {
	inputTokens := in.PromptTokens
	if inputTokens <= 0 {
		inputTokens = fallbackInputTokens
	}
	outputTokens := in.CompletionTokens
	if outputTokens <= 0 && in.TotalTokens > inputTokens {
		outputTokens = in.TotalTokens - inputTokens
	}
	// 提取 cache tokens：优先取 Anthropic 原生字段，其次取 prompt_tokens_details
	cacheRead := in.CacheReadInputTokens
	if cacheRead <= 0 && in.PromptTokensDetails != nil {
		cacheRead = in.PromptTokensDetails.CachedTokens
	}
	return tokenUsage{
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		CacheReadTokens: cacheRead,
		CacheCreationTokens: in.CacheCreationInputTokens,
	}
}

func blocksToText(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []any:
		parts := make([]string, 0, len(x))
		for _, item := range x {
			if m, ok := item.(map[string]any); ok {
				switch m["type"] {
				case "text":
					if text, _ := m["text"].(string); text != "" {
						parts = append(parts, text)
					}
				case "tool_result":
					if text := blocksToText(m["content"]); text != "" {
						parts = append(parts, text)
					}
				case "image":
					parts = append(parts, "[image]")
				}
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		return blocksToText([]any{x})
	default:
		return fmt.Sprint(x)
	}
}

func normalizeRole(role string) string {
	if role == "assistant" || role == "tool" || role == "system" {
		return role
	}
	return "user"
}

func isConvertibleClientTool(tool anthropicTool) bool {
	if tool.Name == "" || tool.InputSchema == nil {
		return false
	}
	if tool.Type != "" && tool.Type != "custom" && tool.Type != "function" {
		return false
	}
	return true
}

func convertToolChoice(choice any, allowedToolNames map[string]bool) any {
	if len(allowedToolNames) == 0 {
		return nil
	}
	m, ok := choice.(map[string]any)
	if !ok {
		return nil
	}
	switch m["type"] {
	case "auto":
		return "auto"
	case "any":
		return "required"
	case "tool":
		name, _ := m["name"].(string)
		if !allowedToolNames[name] {
			return nil
		}
		return map[string]any{"type": "function", "function": map[string]string{"name": name}}
	default:
		return nil
	}
}

func parseJSONObj(s string) map[string]any {
	var out map[string]any
	if err := json.Unmarshal([]byte(s), &out); err == nil {
		return out
	}
	return map[string]any{"arguments": s}
}

func finishReason(reason string, hasTool bool) string {
	if hasTool || reason == "tool_calls" {
		return "tool_use"
	}
	switch reason {
	case "length":
		return "max_tokens"
	case "stop":
		return "end_turn"
	default:
		return "end_turn"
	}
}

func fallbackToolID(id string) string {
	if id != "" {
		return id
	}
	return "toolu_ocgt_" + strconv.FormatInt(time.Now().UnixNano(), 36)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func reasoningText(values ...any) string {
	for _, value := range values {
		if text := reasoningTextValue(value); text != "" {
			return text
		}
	}
	return ""
}

// reasoningTextRaw is like reasoningText but preserves leading/trailing spaces.
// Use for streaming chunks to avoid losing word boundaries when content is split across SSE events.
func reasoningTextRaw(values ...any) string {
	for _, value := range values {
		if text := reasoningTextValueRaw(value); text != "" {
			return text
		}
	}
	return ""
}

func reasoningTextValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if text := reasoningTextValue(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		keys := []string{"reasoning_content", "thinking_content", "thinking", "reasoning", "content", "text", "summary"}
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			if text := reasoningTextValue(v[key]); text != "" {
				parts = append(parts, text)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

// reasoningTextValueRaw is like reasoningTextValue but preserves leading/trailing spaces.
// Use for streaming chunks to avoid losing word boundaries when content is split across SSE events.
func reasoningTextValueRaw(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v // No TrimSpace - preserve original spacing
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if text := reasoningTextValueRaw(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		keys := []string{"reasoning_content", "thinking_content", "thinking", "reasoning", "content", "text", "summary"}
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			if text := reasoningTextValueRaw(v[key]); text != "" {
				parts = append(parts, text)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

func boundedThinkingPayload(thinking any, maxBudgetTokens int) any {
	if thinking == nil || maxBudgetTokens < 0 {
		return nil
	}
	if maxBudgetTokens == 0 {
		return thinking
	}
	switch v := thinking.(type) {
	case bool:
		if !v {
			return nil
		}
		return map[string]any{"type": "enabled", "budget_tokens": maxBudgetTokens}
	case string:
		if strings.EqualFold(v, "disabled") || strings.EqualFold(v, "false") {
			return nil
		}
		return map[string]any{"type": v, "budget_tokens": maxBudgetTokens}
	case map[string]any:
		out := make(map[string]any, len(v)+1)
		for key, value := range v {
			out[key] = value
		}
		if typ, _ := out["type"].(string); strings.EqualFold(typ, "disabled") {
			return out
		}
		out["budget_tokens"] = clampThinkingBudget(out["budget_tokens"], maxBudgetTokens)
		return out
	default:
		return map[string]any{"type": "enabled", "budget_tokens": maxBudgetTokens}
	}
}

func chatCompletionThinkingControls(model string, thinking any, maxBudgetTokens int) (any, string) {
	if !supportsDeepSeekV4ThinkingRequest(model) {
		return nil, ""
	}
	if isThinkingDisabled(thinking) || maxBudgetTokens < 0 {
		return map[string]any{"type": "disabled"}, ""
	}
	if thinking == nil {
		return nil, ""
	}
	return map[string]any{"type": "enabled"}, deepSeekReasoningEffort(thinking, maxBudgetTokens)
}

func isThinkingDisabled(thinking any) bool {
	switch v := thinking.(type) {
	case bool:
		return !v
	case string:
		return strings.EqualFold(v, "disabled") || strings.EqualFold(v, "false") || strings.EqualFold(v, "off")
	case map[string]any:
		typ, _ := v["type"].(string)
		return strings.EqualFold(typ, "disabled")
	default:
		return false
	}
}

func deepSeekReasoningEffort(thinking any, maxBudgetTokens int) string {
	budget := thinkingBudgetValue(thinking)
	if budget <= 0 {
		budget = maxBudgetTokens
	}
	if budget >= 1024 {
		return "max"
	}
	return "high"
}

func thinkingBudgetValue(thinking any) int {
	switch v := thinking.(type) {
	case map[string]any:
		return intFromJSONNumber(v["budget_tokens"])
	default:
		return 0
	}
}

func clampThinkingBudget(value any, maxBudgetTokens int) int {
	budget := intFromJSONNumber(value)
	if budget <= 0 || budget > maxBudgetTokens {
		return maxBudgetTokens
	}
	return budget
}

func intFromJSONNumber(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}

func singleJoin(base, path string) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return path
	}
	return base + "/" + strings.TrimLeft(path, "/")
}

// Model capability detection.
// Uses prefix matching to avoid false positives from substring matches.
// These are conservative heuristics — exact capabilities are defined by the upstream.

func supportsDeepSeekV4ThinkingRequest(model string) bool {
	return isDeepSeekModel(model)
}

func supportsAnthropicThinkingRequest(model string) bool {
	lower := strings.ToLower(model)
	return modelPrefixMatch(lower, []string{
		"claude-3-7",
		"claude-sonnet-4",
		"claude-opus-4",
		"claude-4",
	})
}

func supportsReasoningContentReplay(model string) bool {
	return isDeepSeekModel(model)
}

func isDeepSeekModel(model string) bool {
	lower := strings.ToLower(model)
	return modelPrefixMatch(lower, []string{
		"deepseek",
		"ds-r1",
	}) || strings.HasSuffix(lower, "/r1") ||
		strings.HasSuffix(lower, "-r1")
}

// supportsVisionInput returns true if the model is known to support image/multimodal inputs.
func supportsVisionInput(model string) bool {
	lower := strings.ToLower(model)
	return strings.HasPrefix(lower, "kimi") ||
		strings.HasPrefix(lower, "glm") ||
		strings.HasPrefix(lower, "qwen") ||
		strings.HasPrefix(lower, "minimax") ||
		strings.HasPrefix(lower, "mimo") ||
		strings.HasPrefix(lower, "hy") ||
		strings.HasPrefix(lower, "hunyuan") ||
		strings.HasPrefix(lower, "claude") ||
		strings.HasPrefix(lower, "gemini") ||
		strings.HasPrefix(lower, "gpt") ||
		strings.HasPrefix(lower, "grok") ||
		strings.HasPrefix(lower, "o1") ||
		strings.HasPrefix(lower, "o3") ||
		strings.HasPrefix(lower, "o4") ||
		strings.Contains(lower, "vision") ||
		strings.Contains(lower, "vl")
}

// sanitizeContentBlocksForNonVision replaces image blocks with text placeholders
// when the target model doesn't support vision. Returns true if any blocks were modified.
func sanitizeContentBlocksForNonVision(messages []anthropicMsg) bool {
	modified := false
	for i := range messages {
		blocks, ok := messages[i].Content.([]interface{})
		if !ok {
			continue
		}
		filtered := make([]interface{}, 0, len(blocks))
		for _, block := range blocks {
			m, ok := block.(map[string]interface{})
			if !ok {
				filtered = append(filtered, block)
				continue
			}
			blockType, _ := m["type"].(string)
			if blockType == "image" {
				// Replace image with a text placeholder
				filtered = append(filtered, map[string]interface{}{
					"type": "text",
					"text": "[image]",
				})
				modified = true
			} else if blockType == "tool_result" {
				// Also check tool_result content for images
				content, ok := m["content"].([]interface{})
				if ok {
					cleanContent := sanitizeContentList(content)
					if cleanContent != nil {
						m["content"] = cleanContent
						modified = true
					}
				}
				filtered = append(filtered, block)
			} else {
				filtered = append(filtered, block)
			}
		}
		messages[i].Content = filtered
	}
	return modified
}

func sanitizeContentList(blocks []interface{}) []interface{} {
	needsClean := false
	for _, b := range blocks {
		m, ok := b.(map[string]interface{})
		if ok && m["type"] == "image" {
			needsClean = true
			break
		}
	}
	if !needsClean {
		return nil
	}
	filtered := make([]interface{}, 0, len(blocks))
	for _, b := range blocks {
		m, ok := b.(map[string]interface{})
		if ok && m["type"] == "image" {
			filtered = append(filtered, map[string]interface{}{
				"type": "text",
				"text": "[image]",
			})
		} else {
			filtered = append(filtered, b)
		}
	}
	return filtered
}

// modelPrefixMatch checks if model starts with any of the given prefixes.
// Prevents false positives from substring matching (e.g. "nouveau-3-7" not matching "claude-3-7").
func modelPrefixMatch(lowerModel string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(lowerModel, p) {
			// Only match at word boundaries to avoid substring false positives
			rest := lowerModel[len(p):]
			if rest == "" || rest[0] == '-' || rest[0] == '.' || rest[0] == '/' || rest[0] == '@' || rest[0] == ':' {
				return true
			}
		}
	}
	return false
}

// NOTE: Usage Statistics Limitation
//
// The openAIToAnthropic converter provides basic usage metrics (input_tokens, output_tokens)
// but cannot populate Anthropic-specific cache fields:
//   - cache_creation_input_tokens: always 0 (OpenAI protocol does not support)
//   - cache_read_input_tokens: always 0 (OpenAI protocol does not support)
//
// This affects downstream tools that calculate usage percentages based on:
//   used_percentage = (input + cache_creation + cache_read) / window_size
//
// For accurate cache statistics, use Anthropic native API endpoints or models that
// support prompt caching and return Anthropic-formatted responses.
//
// Related: internal/config/config.go Profile documentation
