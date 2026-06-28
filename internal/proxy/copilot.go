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
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Impact      string         `json:"impact,omitempty"`
	Action      *insightAction `json:"action,omitempty"`
}

type insightAction struct {
	ID      string      `json:"id"`
	Label   string      `json:"label"`
	Payload interface{} `json:"payload"`
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

	if req.Query == "" {
		http.Error(w, "query is required", http.StatusBadRequest)
		return
	}

	// Data queries: use local pattern matching
	q := strings.ToLower(req.Query)
	if isDataQuery(q) {
		s.handleLocalQuery(w, req.Query)
		return
	}

	// AI queries: forward to configured upstream via proxy
	s.handleAIQuery(w, req.Query)
}

func isDataQuery(q string) bool {
	keywords := []string{"花费", "cost", "费用", "缓存", "cache", "模型", "model", "客户端", "client", "摘要", "summary", "today"}
	for _, kw := range keywords {
		if strings.Contains(q, kw) {
			return true
		}
	}
	return false
}

func (s *Server) handleLocalQuery(w http.ResponseWriter, query string) {
	q := strings.ToLower(query)
	entries := s.readJSONLLogs(7)
	summary := aggregateStats(entries, 7)
	models := modelBreakdown(entries)

	var response copilotResponse

	switch {
	case strings.Contains(q, "花费") || strings.Contains(q, "cost") || strings.Contains(q, "费用"):
		response = copilotResponse{
			Content: fmt.Sprintf("过去 7 天的总费用为 %s，共处理 %d 个请求。",
				copilotFormatCost(summary.Summary.EstimatedCost),
				summary.Summary.TotalRequests),
			Data: map[string]interface{}{
				"table": map[string]interface{}{
					"headers": []string{"指标", "数值"},
					"rows": [][]string{
						{"总请求数", fmt.Sprintf("%d", summary.Summary.TotalRequests)},
						{"总 Token", copilotFormatTokens(summary.Summary.TotalTokens)},
						{"总费用", copilotFormatCost(summary.Summary.EstimatedCost)},
						{"平均延迟", fmt.Sprintf("%.0fms", summary.Summary.AvgLatencyMs)},
					},
				},
			},
		}

	case strings.Contains(q, "缓存") || strings.Contains(q, "cache"):
		response = copilotResponse{
			Content: fmt.Sprintf("过去 7 天的缓存命中率为 %.1f%%。读取了 %s 个缓存 Token。",
				summary.Summary.CacheHitRate,
				copilotFormatTokens(summary.Summary.TotalCacheReadTokens)),
		}

	case strings.Contains(q, "模型") || strings.Contains(q, "model"):
		if len(models) == 0 {
			response = copilotResponse{Content: "暂无模型使用数据。"}
		} else {
			sort.Slice(models, func(i, j int) bool { return models[i].TotalTokens > models[j].TotalTokens })
			top := models[0]
			rows := [][]string{}
			for i, m := range models {
				if i >= 5 {
					break
				}
				rows = append(rows, []string{m.Name, fmt.Sprintf("%d", m.Requests), copilotFormatTokens(m.TotalTokens), copilotFormatCost(m.Cost)})
			}
			response = copilotResponse{
				Content: fmt.Sprintf("使用最多的模型是 %s，共 %s Token，%d 个请求。",
					top.Name, copilotFormatTokens(top.TotalTokens), top.Requests),
				Data: map[string]interface{}{
					"table": map[string]interface{}{
						"headers": []string{"模型", "请求数", "Token", "费用"},
						"rows":    rows,
					},
				},
			}
		}

	case strings.Contains(q, "客户端") || strings.Contains(q, "client"):
		rows := [][]string{}
		for _, c := range summary.ByClient {
			rows = append(rows, []string{c.Name, fmt.Sprintf("%d", c.Requests), fmt.Sprintf("%.1f%%", c.Pct)})
		}
		response = copilotResponse{
			Content: fmt.Sprintf("过去 7 天共有 %d 个请求。", summary.Summary.TotalRequests),
			Data: map[string]interface{}{
				"table": map[string]interface{}{
					"headers": []string{"客户端", "请求数", "占比"},
					"rows":    rows,
				},
			},
		}

	case strings.Contains(q, "摘要") || strings.Contains(q, "summary") || strings.Contains(q, "today"):
		response = copilotResponse{
			Content: fmt.Sprintf("今日概览：\n• 请求数: %d\n• Token: %s\n• 费用: %s\n• 成功率: %.1f%%\n• 缓存命中: %.1f%%",
				summary.Summary.TotalRequests,
				copilotFormatTokens(summary.Summary.TotalTokens),
				copilotFormatCost(summary.Summary.EstimatedCost),
				summary.Summary.SuccessRate,
				summary.Summary.CacheHitRate),
		}

	default:
		response = copilotResponse{
			Content: "我可以帮你分析流量、成本、模型使用情况。试试问：\n• 上周哪个模型花费最多？\n• 缓存命中率怎么样？\n• 哪个客户端延迟最高？\n• 给我今天的流量摘要",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
	model := profile.DefaultModel

	if upstream == "" || apiKey == "" {
		s.handleLocalQuery(w, query)
		return
	}

	// Build chat completion request
	reqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "你是 OCGT（OpenCode Go Tools）的 AI 助手。用户正在使用 OCGT 代理网关。请用中文回答用户的问题，简洁明了。"},
			{"role": "user", "content": query},
		},
		"stream": true,
	}

	body, _ := json.Marshal(reqBody)
	url := strings.TrimRight(upstream, "/") + "/v1/chat/completions"

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		s.handleLocalQuery(w, query)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		s.handleLocalQuery(w, query)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		s.handleLocalQuery(w, query)
		return
	}

	// Stream SSE response
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
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			out, _ := json.Marshal(map[string]string{"content": chunk.Choices[0].Delta.Content})
			fmt.Fprintf(w, "data: %s\n\n", out)
			flusher.Flush()
		}
	}
}

func (s *Server) apiCopilotInsights(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	insights := []insight{}

	entries := s.readJSONLLogs(1)
	summary := aggregateStats(entries, 1)

	if summary.Summary.TotalRequests > 0 {
		if summary.Summary.AvgLatencyMs > 2000 {
			insights = append(insights, insight{
				ID:          "high-latency",
				Type:        "anomaly",
				Title:       "延迟偏高",
				Description: fmt.Sprintf("今日平均延迟 %.0fms，超过 2 秒阈值。", summary.Summary.AvgLatencyMs),
			})
		}

		if summary.Summary.SuccessRate < 95 {
			insights = append(insights, insight{
				ID:          "low-success-rate",
				Type:        "anomaly",
				Title:       "成功率偏低",
				Description: fmt.Sprintf("今日成功率 %.1f%%，低于 95%% 阈值。", summary.Summary.SuccessRate),
			})
		}

		if summary.Summary.CacheHitRate < 20 && summary.Summary.TotalTokens > 100000 {
			insights = append(insights, insight{
				ID:          "low-cache-hit",
				Type:        "suggestion",
				Title:       "缓存优化建议",
				Description: fmt.Sprintf("缓存命中率仅 %.1f%%。考虑启用 prompt caching 以降低成本。", summary.Summary.CacheHitRate),
			})
		}
	}

	models := modelBreakdown(s.readJSONLLogs(7))
	if len(models) >= 2 {
		sort.Slice(models, func(i, j int) bool { return models[i].Cost > models[j].Cost })
		mostExpensive := models[0]
		if mostExpensive.Cost > 5 {
			cheaper := ""
			for _, m := range models[1:] {
				if m.Cost < mostExpensive.Cost*0.5 {
					cheaper = m.Name
					break
				}
			}
			if cheaper != "" {
				insights = append(insights, insight{
					ID:          "cost-optimization",
					Type:        "savings",
					Title:       "成本优化机会",
					Description: fmt.Sprintf("%s 是最昂贵的模型（%s）。考虑将部分请求路由到 %s。", mostExpensive.Name, copilotFormatCost(mostExpensive.Cost), cheaper),
					Impact:      fmt.Sprintf("预计可节省 %s/周", copilotFormatCost(mostExpensive.Cost*0.3)),
					Action: &insightAction{
						ID:    "update-haiku-alias",
						Label: "更新 Haiku 别名",
						Payload: map[string]string{
							"alias": cheaper,
						},
					},
				})
			}
		}
	}

	if len(insights) == 0 {
		insights = append(insights, insight{
			ID:          "all-good",
			Type:        "digest",
			Title:       "一切正常",
			Description: "没有发现异常或优化机会。继续使用代理吧！",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(insightsResponse{Insights: insights})
}

func (s *Server) apiCopilotAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	actionID := r.PathValue("id")
	if actionID == "" {
		http.Error(w, "action id required", http.StatusBadRequest)
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	switch actionID {
	case "update-haiku-alias":
		alias, _ := payload["alias"].(string)
		if alias == "" {
			http.Error(w, "alias required", http.StatusBadRequest)
			return
		}

		cfg := s.Config()
		if cfg == nil {
			http.Error(w, "config not loaded", http.StatusInternalServerError)
			return
		}

		_, profileName, _ := cfg.Profile("")
		profile := cfg.Profiles[profileName]
		if profile.ModelAliases == nil {
			profile.ModelAliases = make(map[string]string)
		}
		profile.ModelAliases["haiku"] = alias
		cfg.Profiles[profileName] = profile

		s.ApplyConfig(*cfg)

		if s.configPath != "" {
			if err := cfg.Save(s.configPath); err != nil {
				http.Error(w, "failed to save: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})

	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
	}
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
