package proxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type blockState struct {
	index int
	vtype string
	open  bool
}

func streamOpenAIAsAnthropic(w http.ResponseWriter, body io.Reader, model string, inputTokens int, onToolCall func(id, reasoning string)) (outputTokens int, actualInputTokens int, cacheReadTokens int, cacheCreateTokens int) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	msgID := "msg_ocgt_" + strconv.FormatInt(time.Now().UnixNano(), 36)

	sendSSE(w, "message_start", map[string]any{
		"type":    "message_start",
		"message": map[string]any{"id": msgID, "type": "message", "role": "assistant", "model": model, "content": []any{}, "stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": inputTokens, "output_tokens": 0}},
	})
	if flusher != nil {
		flusher.Flush()
	}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)

	var curBlock *blockState
	var blockIdx int
	var accumulatedReasoning strings.Builder

	type streamingTool struct {
		id         string
		name       string
		blockIndex int
	}
	activeTools := make(map[int]*streamingTool)

	closeCurrentBlock := func() {
		if curBlock != nil && curBlock.open {
			sendSSE(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": curBlock.index})
			curBlock.open = false
			if flusher != nil {
				flusher.Flush()
			}
		}
		curBlock = nil
	}

	openBlock := func(vtype string) {
		if curBlock != nil && curBlock.vtype == vtype {
			return
		}
		closeCurrentBlock()
		b := &blockState{index: blockIdx, vtype: vtype, open: true}
		blockIdx++
		curBlock = b
		switch vtype {
		case "text":
			sendSSE(w, "content_block_start", map[string]any{
				"type":          "content_block_start",
				"index":         b.index,
				"content_block": map[string]string{"type": "text", "text": ""},
			})
		case "thinking":
			sendSSE(w, "content_block_start", map[string]any{
				"type":          "content_block_start",
				"index":         b.index,
				"content_block": map[string]string{"type": "thinking", "thinking": ""},
			})
		}
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk openAIChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Usage.CompletionTokens > 0 {
			outputTokens = chunk.Usage.CompletionTokens
		}
		if chunk.Usage.PromptTokens > 0 {
			inputTokens = chunk.Usage.PromptTokens
		}
		if chunk.Usage.CacheReadInputTokens > 0 {
			cacheReadTokens = chunk.Usage.CacheReadInputTokens
		}
		if chunk.Usage.CacheCreationInputTokens > 0 {
			cacheCreateTokens = chunk.Usage.CacheCreationInputTokens
		}
		if cacheReadTokens <= 0 && chunk.Usage.PromptTokensDetails != nil {
			cacheReadTokens = chunk.Usage.PromptTokensDetails.CachedTokens
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		choice := chunk.Choices[0]
		delta := choice.Delta

		rc := reasoningTextRaw(delta.ReasoningContent, delta.ThinkingContent, delta.Thinking, delta.Reasoning, delta.ReasoningDetails)
		if rc != "" {
			accumulatedReasoning.WriteString(rc)
			openBlock("thinking")
			sendSSE(w, "content_block_delta", map[string]any{
				"type":  "content_block_delta",
				"index": curBlock.index,
				"delta": map[string]string{"type": "thinking_delta", "thinking": rc},
			})
			if flusher != nil {
				flusher.Flush()
			}
			continue
		}

		if curBlock != nil && curBlock.vtype == "thinking" {
			closeCurrentBlock()
		}

		if text := delta.Content; text != "" {
			openBlock("text")
			sendSSE(w, "content_block_delta", map[string]any{
				"type":  "content_block_delta",
				"index": curBlock.index,
				"delta": map[string]string{"type": "text_delta", "text": text},
			})
			if flusher != nil {
				flusher.Flush()
			}
		}

		if len(delta.ToolCalls) > 0 {
			for _, tc := range delta.ToolCalls {
				idx := 0
				if tc.Index != nil {
					idx = *tc.Index
				}
				tool, exists := activeTools[idx]
				if !exists {
					closeCurrentBlock()
					toolIdx := blockIdx
					blockIdx++
					toolID := fallbackToolID(tc.ID)

					// Cache reasoning content for this tool call ID
					if tc.ID != "" && onToolCall != nil && accumulatedReasoning.Len() > 0 {
						onToolCall(tc.ID, accumulatedReasoning.String())
					}

					tool = &streamingTool{
						id:         toolID,
						name:       tc.Function.Name,
						blockIndex: toolIdx,
					}
					activeTools[idx] = tool

					sendSSE(w, "content_block_start", map[string]any{
						"type":  "content_block_start",
						"index": toolIdx,
						"content_block": map[string]any{
							"type":  "tool_use",
							"id":    toolID,
							"name":  tc.Function.Name,
							"input": map[string]any{},
						},
					})
					curBlock = &blockState{index: toolIdx, vtype: "tool_use", open: true}
				}

				if tc.Function.Arguments != "" {
					if curBlock == nil || curBlock.index != tool.blockIndex {
						closeCurrentBlock()
						curBlock = &blockState{index: tool.blockIndex, vtype: "tool_use", open: true}
					}
					sendSSE(w, "content_block_delta", map[string]any{
						"type":  "content_block_delta",
						"index": tool.blockIndex,
						"delta": map[string]string{"type": "input_json_delta", "partial_json": tc.Function.Arguments},
					})
					if flusher != nil {
						flusher.Flush()
					}
				}
			}
		}

		if choice.FinishReason != nil {
			closeCurrentBlock()
		}
	}

	closeCurrentBlock()

	// Send final message delta with usage statistics
	// input_tokens: 流中最后一个有 usage 的 chunk 的真实值（message_start 中是估算值）
	sendSSE(w, "message_delta", map[string]any{
		"type": "message_delta",
		"delta": map[string]any{
			"stop_reason":   "end_turn",
			"stop_sequence": nil,
		},
		"usage": map[string]int{
			"input_tokens":                inputTokens,
			"output_tokens":               outputTokens,
			"cache_creation_input_tokens": cacheCreateTokens,
			"cache_read_input_tokens":     cacheReadTokens,
		},
	})
	sendSSE(w, "message_stop", map[string]string{"type": "message_stop"})
	if flusher != nil {
		flusher.Flush()
	}
	return outputTokens, inputTokens, cacheReadTokens, cacheCreateTokens
}

func streamAnthropicMessage(w http.ResponseWriter, message map[string]any) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	sendSSE(w, "message_start", map[string]any{
		"type":    "message_start",
		"message": withoutContent(message),
	})
	blocks, _ := message["content"].([]map[string]any)
	for i, block := range blocks {
		switch block["type"] {
		case "thinking":
			thinking, _ := block["thinking"].(string)
			sendSSE(w, "content_block_start", map[string]any{
				"type":          "content_block_start",
				"index":         i,
				"content_block": map[string]string{"type": "thinking", "thinking": ""},
			})
			if thinking != "" {
				sendSSE(w, "content_block_delta", map[string]any{
					"type":  "content_block_delta",
					"index": i,
					"delta": map[string]string{"type": "thinking_delta", "thinking": thinking},
				})
			}
			sendSSE(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": i})
		case "text":
			sendSSE(w, "content_block_start", map[string]any{
				"type":          "content_block_start",
				"index":         i,
				"content_block": map[string]string{"type": "text", "text": ""},
			})
			if text, _ := block["text"].(string); text != "" {
				sendSSE(w, "content_block_delta", map[string]any{
					"type":  "content_block_delta",
					"index": i,
					"delta": map[string]string{"type": "text_delta", "text": text},
				})
			}
			sendSSE(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": i})
		case "tool_use":
			input := block["input"]
			inputJSON, _ := json.Marshal(input)
			sendSSE(w, "content_block_start", map[string]any{
				"type":  "content_block_start",
				"index": i,
				"content_block": map[string]any{
					"type":  "tool_use",
					"id":    block["id"],
					"name":  block["name"],
					"input": map[string]any{},
				},
			})
			sendSSE(w, "content_block_delta", map[string]any{
				"type":  "content_block_delta",
				"index": i,
				"delta": map[string]string{"type": "input_json_delta", "partial_json": string(inputJSON)},
			})
			sendSSE(w, "content_block_stop", map[string]any{"type": "content_block_stop", "index": i})
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	usage, _ := message["usage"].(map[string]int)
	if usage == nil {
		usage = map[string]int{"output_tokens": 0}
	}
	sendSSE(w, "message_delta", map[string]any{
		"type": "message_delta",
		"delta": map[string]any{
			"stop_reason":   message["stop_reason"],
			"stop_sequence": message["stop_sequence"],
		},
		"usage": usage,
	})
	sendSSE(w, "message_stop", map[string]string{"type": "message_stop"})
	if flusher != nil {
		flusher.Flush()
	}
}

func withoutContent(message map[string]any) map[string]any {
	out := make(map[string]any, len(message))
	for k, v := range message {
		out[k] = v
	}
	out["content"] = []any{}
	out["stop_reason"] = nil
	out["stop_sequence"] = nil
	return out
}

func writeSSE(w io.Writer, event string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal SSE payload for event %s: %w", event, err)
	}
	_, writeErr := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
	return writeErr
}

// sendSSE writes an SSE event and logs any error.
func sendSSE(w io.Writer, event string, payload any) {
	if err := writeSSE(w, event, payload); err != nil {
		log.Printf("SSE write error: event=%s: %v", event, err)
	}
}
