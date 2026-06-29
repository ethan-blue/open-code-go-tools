package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

type copilotRequest struct {
	Query string `json:"query"`
}

type copilotResponse struct {
	Content string      `json:"content,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

type insight struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Impact      string `json:"impact,omitempty"`
	When        string `json:"when,omitempty"`
}

type insightsResponse struct {
	Insights []insight `json:"insights"`
}

func (s *Server) apiCopilotAsk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req copilotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		http.Error(w, "query is required", http.StatusBadRequest)
		return
	}

	if isDataQuery(strings.ToLower(req.Query)) {
		s.handleLocalQuery(w, req.Query)
		return
	}
	s.handleAIQuery(w, req.Query)
}

func isDataQuery(q string) bool {
	keywords := []string{
		"cost", "spend", "cache", "model", "client", "latency", "summary", "today", "week",
		"费用", "花费", "成本", "缓存", "模型", "客户端", "延迟", "总结", "摘要", "今天", "本周", "上周",
	}
	for _, keyword := range keywords {
		if strings.Contains(q, keyword) {
			return true
		}
	}
	return false
}

func (s *Server) handleLocalQuery(w http.ResponseWriter, query string) {
	q := strings.ToLower(strings.TrimSpace(query))
	days := 7
	if strings.Contains(q, "today") || strings.Contains(q, "今天") {
		days = 1
	}

	entries := s.readJSONLLogs(days)
	summary := aggregateStats(entries, days)
	models := modelBreakdown(entries)

	var response copilotResponse

	switch {
	case strings.Contains(q, "cost") || strings.Contains(q, "spend") || strings.Contains(q, "费用") || strings.Contains(q, "花费") || strings.Contains(q, "成本"):
		response = copilotResponse{
			Content: fmt.Sprintf("过去 %d 天总费用 %s，共 %d 个请求。", days, copilotFormatCost(summary.Summary.EstimatedCost), summary.Summary.TotalRequests),
			Data: tablePayload(
				[]string{"指标", "数值"},
				[][]string{
					{"总请求", fmt.Sprintf("%d", summary.Summary.TotalRequests)},
					{"总 Token", copilotFormatTokens(summary.Summary.TotalTokens)},
					{"总费用", copilotFormatCost(summary.Summary.EstimatedCost)},
					{"成功率", fmt.Sprintf("%.1f%%", summary.Summary.SuccessRate)},
				},
			),
		}
	case strings.Contains(q, "cache") || strings.Contains(q, "缓存"):
		response = copilotResponse{
			Content: fmt.Sprintf("过去 %d 天缓存命中率 %.1f%%，读取缓存 Token %s。", days, summary.Summary.CacheHitRate, copilotFormatTokens(summary.Summary.TotalCacheReadTokens)),
			Data: tablePayload(
				[]string{"指标", "数值"},
				[][]string{
					{"缓存命中率", fmt.Sprintf("%.1f%%", summary.Summary.CacheHitRate)},
					{"缓存读取", copilotFormatTokens(summary.Summary.TotalCacheReadTokens)},
					{"缓存创建", copilotFormatTokens(summary.Summary.TotalCacheCreateTokens)},
				},
			),
		}
	case strings.Contains(q, "model") || strings.Contains(q, "模型"):
		if len(models) == 0 {
			response = copilotResponse{Content: "还没有模型使用数据。"}
			break
		}
		sort.Slice(models, func(i, j int) bool { return models[i].Cost > models[j].Cost })
		top := models[0]
		rows := make([][]string, 0, minInt(len(models), 5))
		for i, model := range models {
			if i >= 5 {
				break
			}
			rows = append(rows, []string{
				model.Name,
				fmt.Sprintf("%d", model.Requests),
				copilotFormatTokens(model.TotalTokens),
				copilotFormatCost(model.Cost),
			})
		}
		response = copilotResponse{
			Content: fmt.Sprintf("%s 成本最高，过去 %d 天用了 %s，处理 %d 个请求。", top.Name, days, copilotFormatCost(top.Cost), top.Requests),
			Data:    tablePayload([]string{"模型", "请求", "Token", "费用"}, rows),
		}
	case strings.Contains(q, "client") || strings.Contains(q, "客户端"):
		rows := make([][]string, 0, len(summary.ByClient))
		for _, client := range summary.ByClient {
			rows = append(rows, []string{
				client.Name,
				fmt.Sprintf("%d", client.Requests),
				fmt.Sprintf("%.1f%%", client.Pct),
			})
		}
		response = copilotResponse{
			Content: fmt.Sprintf("过去 %d 天共有 %d 个请求，按客户端分布如下。", days, summary.Summary.TotalRequests),
			Data:    tablePayload([]string{"客户端", "请求", "占比"}, rows),
		}
	case strings.Contains(q, "latency") || strings.Contains(q, "延迟"):
		response = copilotResponse{
			Content: fmt.Sprintf("过去 %d 天 P50 延迟 %.0fms，平均延迟 %.0fms。", days, summary.Summary.P50LatencyMs, summary.Summary.AvgLatencyMs),
			Data: tablePayload(
				[]string{"指标", "数值"},
				[][]string{
					{"P50", fmt.Sprintf("%.0fms", summary.Summary.P50LatencyMs)},
					{"平均延迟", fmt.Sprintf("%.0fms", summary.Summary.AvgLatencyMs)},
					{"成功率", fmt.Sprintf("%.1f%%", summary.Summary.SuccessRate)},
				},
			),
		}
	default:
		response = copilotResponse{
			Content: fmt.Sprintf("过去 %d 天共有 %d 个请求，消耗 %s，费用 %s，成功率 %.1f%%。", days, summary.Summary.TotalRequests, copilotFormatTokens(summary.Summary.TotalTokens), copilotFormatCost(summary.Summary.EstimatedCost), summary.Summary.SuccessRate),
			Data: tablePayload(
				[]string{"指标", "数值"},
				[][]string{
					{"总请求", fmt.Sprintf("%d", summary.Summary.TotalRequests)},
					{"总 Token", copilotFormatTokens(summary.Summary.TotalTokens)},
					{"总费用", copilotFormatCost(summary.Summary.EstimatedCost)},
					{"缓存命中率", fmt.Sprintf("%.1f%%", summary.Summary.CacheHitRate)},
				},
			),
		}
	}

	writeCopilotSSE(w, response)
}

func (s *Server) handleAIQuery(w http.ResponseWriter, query string) {
	cfg := s.Config()
	if cfg == nil {
		s.handleLocalQuery(w, query)
		return
	}

	profile, _, _ := cfg.Profile("")
	upstream := cfg.Upstream
	apiKey := profile.APIKeyValue()
	model := strings.TrimSpace(profile.DefaultModel)
	if model == "" {
		model = "gpt-4o-mini"
	}
	if upstream == "" || apiKey == "" {
		s.handleLocalQuery(w, query)
		return
	}

	reqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "你是 OpenCode Go 的本地运维助手。优先基于网关指标回答，中文输出，简洁直接，不编造不存在的数据。",
			},
			{"role": "user", "content": query},
		},
		"stream": true,
	}

	body, _ := json.Marshal(reqBody)
	url := strings.TrimRight(upstream, "/") + "/v1/chat/completions"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		s.handleLocalQuery(w, query)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		s.handleLocalQuery(w, query)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		s.handleLocalQuery(w, query)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		s.handleLocalQuery(w, query)
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			fmt.Fprintf(w, "data: [DONE]\n\n")
			flusher.Flush()
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 || chunk.Choices[0].Delta.Content == "" {
			continue
		}

		out, _ := json.Marshal(map[string]string{"content": chunk.Choices[0].Delta.Content})
		fmt.Fprintf(w, "data: %s\n\n", out)
		flusher.Flush()
	}
}

func (s *Server) apiCopilotInsights(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	insights := make([]insight, 0, 4)
	todaySummary := aggregateStats(s.readJSONLLogs(1), 1)
	weekModels := modelBreakdown(s.readJSONLLogs(7))

	if todaySummary.Summary.TotalRequests > 0 {
		if todaySummary.Summary.AvgLatencyMs > 2000 {
			insights = append(insights, insight{
				ID:          "high-latency",
				Type:        "anomaly",
				Title:       "延迟偏高",
				Description: fmt.Sprintf("今天平均延迟 %.0fms，已经超过 2s。", todaySummary.Summary.AvgLatencyMs),
				When:        "Today",
			})
		}
		if todaySummary.Summary.SuccessRate > 0 && todaySummary.Summary.SuccessRate < 95 {
			insights = append(insights, insight{
				ID:          "low-success-rate",
				Type:        "anomaly",
				Title:       "成功率下降",
				Description: fmt.Sprintf("今天成功率 %.1f%%，低于 95%%。", todaySummary.Summary.SuccessRate),
				When:        "Today",
			})
		}
		if todaySummary.Summary.CacheHitRate < 20 && todaySummary.Summary.TotalTokens > 100000 {
			insights = append(insights, insight{
				ID:          "low-cache-hit",
				Type:        "suggestion",
				Title:       "缓存还有空间",
				Description: fmt.Sprintf("今天缓存命中率只有 %.1f%%，重复 prompt 可以再收敛。", todaySummary.Summary.CacheHitRate),
				Impact:      "优先检查固定系统提示词和长上下文复用。",
				When:        "Today",
			})
		}
	}

	if len(weekModels) >= 2 {
		sort.Slice(weekModels, func(i, j int) bool { return weekModels[i].Cost > weekModels[j].Cost })
		top := weekModels[0]
		cheap := ""
		for _, model := range weekModels[1:] {
			if model.Cost < top.Cost*0.5 {
				cheap = model.Name
				break
			}
		}
		if top.Cost > 5 && cheap != "" {
			insights = append(insights, insight{
				ID:          "cost-optimization",
				Type:        "savings",
				Title:       "模型成本偏重",
				Description: fmt.Sprintf("%s 是近 7 天最贵的模型，累计 %s。", top.Name, copilotFormatCost(top.Cost)),
				Impact:      fmt.Sprintf("可以先把低风险请求切到 %s。", cheap),
				When:        "7d",
			})
		}
	}

	if len(insights) == 0 {
		insights = append(insights, insight{
			ID:          "steady-state",
			Type:        "digest",
			Title:       "当前没有明显异常",
			Description: "最近数据比较平稳，暂时没有需要立刻处理的告警。",
			When:        "Now",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(insightsResponse{Insights: insights})
}

func (s *Server) apiCopilotAction(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "no copilot actions available", http.StatusNotImplemented)
}

func tablePayload(headers []string, rows [][]string) map[string]interface{} {
	return map[string]interface{}{
		"table": map[string]interface{}{
			"headers": headers,
			"rows":    rows,
		},
	}
}

func writeCopilotSSE(w http.ResponseWriter, response copilotResponse) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
		return
	}

	payload, _ := json.Marshal(response)
	fmt.Fprintf(w, "data: %s\n\n", payload)
	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func copilotFormatTokens(n int64) string {
	if n >= 1000000 {
		return fmt.Sprintf("%.1fM", float64(n)/1000000)
	}
	if n >= 1000 {
		return fmt.Sprintf("%.1fK", float64(n)/1000)
	}
	return fmt.Sprintf("%d", n)
}

func copilotFormatCost(n float64) string {
	if n < 0.01 {
		return fmt.Sprintf("$%.4f", n)
	}
	return fmt.Sprintf("$%.2f", n)
}
