package proxy

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/pricing"
)

// ── 响应数据结构 ──

type StatsSummary struct {
	Period     PeriodInfo         `json:"period"`
	Summary    SummaryTotals       `json:"summary"`
	ByModel    []ModelStat         `json:"by_model"`
	ByClient   []ClientStat        `json:"by_client"`
	DailyTrend []DailyStat         `json:"daily_trend,omitempty"`
  PlanUsage  pricing.PlanUsage `json:"plan_usage,omitempty"`
}

type PeriodInfo struct {
	From string `json:"from"`
	To   string `json:"to"`
	Days int    `json:"days"`
}

type SummaryTotals struct {
	TotalRequests        int     `json:"total_requests"`
	SuccessCount         int     `json:"success_count"`
	SuccessRate          float64 `json:"success_rate"`
	AvgLatencyMs         float64 `json:"avg_latency_ms"`
	TotalInputTokens     int64   `json:"total_input_tokens"`
	TotalOutputTokens    int64   `json:"total_output_tokens"`
	TotalCacheReadTokens int64   `json:"total_cache_read_tokens"`
	TotalCacheCreateTokens int64 `json:"total_cache_create_tokens"`
	TotalTokens          int64   `json:"total_tokens"`
	EstimatedCost        float64 `json:"estimated_cost"`
	CacheHitRate         float64 `json:"cache_hit_rate"`
}

type ModelStat struct {
	Name        string  `json:"name"`
	Requests    int     `json:"requests"`
	InputTokens int64   `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	CacheTokens int64   `json:"cache_tokens"`
	TotalTokens int64   `json:"total_tokens"`
	Cost        float64 `json:"cost_usd"`
	Pct         float64 `json:"pct"`
	CacheHitRate float64 `json:"cache_hit_rate"`
}

type ClientStat struct {
	Name     string `json:"name"`
	Requests int    `json:"requests"`
	Pct      float64 `json:"pct"`
}

type DailyStat struct {
	Date        string `json:"date"`
	Requests    int    `json:"requests"`
	InputTokens int64  `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens int64  `json:"total_tokens"`
}

// ── API Handlers ──

func (s *Server) apiStatsSummary(w http.ResponseWriter, r *http.Request) {
	days := parseIntParam(r, "days", 7)
	entries := s.readJSONLLogs(days)
	if len(entries) == 0 {
		writeJSON(w, http.StatusOK, emptyStats(days))
		return
	}
	summary := aggregateStats(entries, days)
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) apiStatsTrend(w http.ResponseWriter, r *http.Request) {
	days := parseIntParam(r, "days", 30)
	granularity := determineGranularity(days)
	entries := s.readJSONLLogs(days)
	if len(entries) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"period":      map[string]any{"days": days},
			"daily":       []DailyStat{},
			"granularity": granularity,
		})
		return
	}
	trend := dailyTrend(entries, days, granularity)
	writeJSON(w, http.StatusOK, map[string]any{
		"period":      map[string]any{"days": days},
		"daily":       trend,
		"granularity": granularity,
	})
}

func (s *Server) apiStatsModels(w http.ResponseWriter, r *http.Request) {
	days := parseIntParam(r, "days", 7)
	entries := s.readJSONLLogs(days)
	if len(entries) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"models": []ModelStat{}})
		return
	}
	models := modelBreakdown(entries)
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

// ── 公共方法，供前端路由注册 ──

func (s *Server) registerStatsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ocgt/api/stats/summary", s.apiStatsSummary)
	mux.HandleFunc("/ocgt/api/stats/trend", s.apiStatsTrend)
	mux.HandleFunc("/ocgt/api/stats/models", s.apiStatsModels)
}

// ── 辅助函数 ──

func parseIntParam(r *http.Request, name string, defaultVal int) int {
	val := r.URL.Query().Get(name)
	if val == "" {
		return defaultVal
	}
	n := 0
	for _, c := range val {
		if c < '0' || c > '9' {
			return defaultVal
		}
		n = n*10 + int(c-'0')
	}
	if n <= 0 || n > 365 {
		return defaultVal
	}
	return n
}

// readJSONLLogs 从 JSONL 日志目录读取指定天数内的所有记录
func (s *Server) readJSONLLogs(days int) []requestLogEntry {
	s.historyLogMu.Lock()
	dir := s.historyLogDir
	s.historyLogMu.Unlock()
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".ocgt", "log")
	}

	cutoff := time.Now().AddDate(0, 0, -days)
	var allEntries []requestLogEntry

	files, err := os.ReadDir(dir)
	if err != nil {
			log.Printf("[stats] readJSONLLogs: cannot read dir %q: %v", dir, err)
		return nil
	}
log.Printf("[stats] readJSONLLogs: reading %q, found %d files, cutoff %s", dir, len(files), cutoff.Format("2006-01-02"))

	for _, f := range files {
		if f.IsDir() || !strings.HasPrefix(f.Name(), "ocgt-") || !strings.HasSuffix(f.Name(), ".jsonl") {
			continue
		}
		filePath := filepath.Join(dir, f.Name())
		entries := readJSONLFile(filePath, cutoff)
		allEntries = append(allEntries, entries...)
	}

	sort.Slice(allEntries, func(i, j int) bool {
		return allEntries[i].Time.After(allEntries[j].Time)
	})

		// 不限制返回条数，全量数据返回给前端做本地筛选和分页

	// Fallback: 如果 JSONL 文件没有数据（日志未启用或目录不存在），
	// 从内存历史记录读取，确保 stats API 总有数据可返回
	if len(allEntries) == 0 {
		s.historyMu.RLock()
		hist := make([]requestLogEntry, len(s.history))
		copy(hist, s.history)
		s.historyMu.RUnlock()
		if len(hist) > 0 {
			cutoff := time.Now().AddDate(0, 0, -days)
			for _, e := range hist {
				if e.Time.After(cutoff) {
					allEntries = append(allEntries, e)
				}
			}
			log.Printf("[stats] JSONL empty, falling back to in-memory history: %d entries after filter", len(allEntries))
		}
	}

	return allEntries
}

func readJSONLFile(path string, cutoff time.Time) []requestLogEntry {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var entries []requestLogEntry
	scanner := bufio.NewScanner(io.LimitReader(f, 50<<20)) // 最多读 50MB
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry requestLogEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry.Time.Before(cutoff) {
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

func emptyStats(days int) StatsSummary {
	return StatsSummary{
		Period: PeriodInfo{
			From: time.Now().AddDate(0, 0, -days).Format("2006-01-02"),
			To:   time.Now().Format("2006-01-02"),
			Days: days,
		},
	}
}

func aggregateStats(entries []requestLogEntry, days int) StatsSummary {
	result := StatsSummary{
		Period: PeriodInfo{
			From: time.Now().AddDate(0, 0, -days).Format("2006-01-02"),
			To:   time.Now().Format("2006-01-02"),
			Days: days,
		},
	}

	modelMap := make(map[string]*ModelStat)
	clientMap := make(map[string]*ClientStat)
	dayMap := make(map[string]*DailyStat)

	for _, e := range entries {
		// Summary
		result.Summary.TotalRequests++
		if e.Status >= 200 && e.Status < 300 {
			result.Summary.SuccessCount++
		}
		result.Summary.TotalInputTokens += int64(e.InputTokens)
		result.Summary.TotalOutputTokens += int64(e.OutputTokens)
		result.Summary.TotalCacheReadTokens += int64(e.CacheReadTokens)
		result.Summary.TotalCacheCreateTokens += int64(e.CacheCreationTokens)
		result.Summary.TotalTokens += int64(e.TotalTokens)
		result.Summary.AvgLatencyMs += parseDurationFloat(e.Duration)

		// By model
		model := e.Model
		if model == "" {
			model = "unknown"
		}
		if _, ok := modelMap[model]; !ok {
			modelMap[model] = &ModelStat{Name: model}
		}
		ms := modelMap[model]
		ms.Requests++
		ms.InputTokens += int64(e.InputTokens)
		ms.OutputTokens += int64(e.OutputTokens)
		ms.CacheTokens += int64(e.CacheReadTokens + e.CacheCreationTokens)
		ms.TotalTokens += int64(e.TotalTokens)
		ms.Cost += pricing.EstimateCost(model, e.InputTokens, e.OutputTokens, e.CacheReadTokens, e.CacheCreationTokens)

		// By client
		client := e.Client
		if client == "" {
			client = "Unknown"
		}
		if _, ok := clientMap[client]; !ok {
			clientMap[client] = &ClientStat{Name: client}
		}
		clientMap[client].Requests++

		// Daily trend
		dateKey := e.Time.Format("2006-01-02")
		if _, ok := dayMap[dateKey]; !ok {
			dayMap[dateKey] = &DailyStat{Date: dateKey}
		}
		ds := dayMap[dateKey]
		ds.Requests++
		ds.InputTokens += int64(e.InputTokens)
		ds.OutputTokens += int64(e.OutputTokens)
		ds.TotalTokens += int64(e.TotalTokens)
	}

	// Finalize summary
	if result.Summary.TotalRequests > 0 {
		result.Summary.SuccessRate = float64(result.Summary.SuccessCount) / float64(result.Summary.TotalRequests) * 100
		result.Summary.AvgLatencyMs = result.Summary.AvgLatencyMs / float64(result.Summary.TotalRequests)
	}
	if result.Summary.TotalInputTokens > 0 {
		result.Summary.CacheHitRate = float64(result.Summary.TotalCacheReadTokens) / float64(result.Summary.TotalInputTokens) * 100
	}
	result.Summary.EstimatedCost = 0

	// By model — calculate percentages and total cost
	var totalTokens float64
	for _, ms := range modelMap {
		totalTokens += float64(ms.TotalTokens)
		result.Summary.EstimatedCost += ms.Cost
	}
	for _, ms := range modelMap {
		if totalTokens > 0 {
			ms.Pct = float64(ms.TotalTokens) / totalTokens * 100
		}
		result.ByModel = append(result.ByModel, *ms)
	}
	sort.Slice(result.ByModel, func(i, j int) bool {
		return result.ByModel[i].TotalTokens > result.ByModel[j].TotalTokens
	})

	// By client
	var totalReq float64
	for _, cs := range clientMap {
		totalReq += float64(cs.Requests)
	}
	for _, cs := range clientMap {
		if totalReq > 0 {
			cs.Pct = float64(cs.Requests) / totalReq * 100
		}
		result.ByClient = append(result.ByClient, *cs)
	}
	sort.Slice(result.ByClient, func(i, j int) bool {
		return result.ByClient[i].Requests > result.ByClient[j].Requests
	})

	// Daily trend
	for _, ds := range dayMap {
		result.DailyTrend = append(result.DailyTrend, *ds)
	}
	sort.Slice(result.DailyTrend, func(i, j int) bool {
		return result.DailyTrend[i].Date < result.DailyTrend[j].Date
	})

	// Plan usage based on total estimated cost
	result.PlanUsage = pricing.EstimateSpendingUsage(result.Summary.EstimatedCost)

	return result
}

func determineGranularity(days int) string {
	switch {
	case days <= 2:
		return "hour"
	case days <= 90:
		return "day"
	default:
		return "week"
	}
}

func timeKey(t time.Time, granularity string) string {
	switch granularity {
	case "hour":
		return t.Format("2006-01-02 15:00")
	case "week":
		// Monday as start of week
		weekday := t.Weekday()
		daysFromMonday := int(weekday - time.Monday)
		if daysFromMonday < 0 {
			daysFromMonday += 7
		}
		monday := t.AddDate(0, 0, -daysFromMonday)
		return monday.Format("2006-01-02")
	default: // "day"
		return t.Format("2006-01-02")
	}
}

func dailyTrend(entries []requestLogEntry, days int, granularity string) []DailyStat {
	dayMap := make(map[string]*DailyStat)
	for _, e := range entries {
		dateKey := timeKey(e.Time, granularity)
		if _, ok := dayMap[dateKey]; !ok {
			dayMap[dateKey] = &DailyStat{Date: dateKey}
		}
		ds := dayMap[dateKey]
		ds.Requests++
		ds.InputTokens += int64(e.InputTokens)
		ds.OutputTokens += int64(e.OutputTokens)
		ds.TotalTokens += int64(e.TotalTokens)
	}
	var trend []DailyStat
	for _, ds := range dayMap {
		trend = append(trend, *ds)
	}
	sort.Slice(trend, func(i, j int) bool {
		return trend[i].Date < trend[j].Date
	})
	return trend
}

func modelBreakdown(entries []requestLogEntry) []ModelStat {
	modelMap := make(map[string]*modelBreakdownAccum)
	for _, e := range entries {
		model := e.Model
		if model == "" {
			model = "unknown"
		}
		if _, ok := modelMap[model]; !ok {
			modelMap[model] = &modelBreakdownAccum{Name: model}
		}
		ms := modelMap[model]
		ms.Requests++
		ms.InputTokens += int64(e.InputTokens)
		ms.OutputTokens += int64(e.OutputTokens)
		ms.CacheReadTokens += int64(e.CacheReadTokens)
		ms.CacheCreationTokens += int64(e.CacheCreationTokens)
		ms.TotalTokens += int64(e.TotalTokens)
		ms.Cost += pricing.EstimateCost(model, e.InputTokens, e.OutputTokens, e.CacheReadTokens, e.CacheCreationTokens)
	}

	var totalTokens float64
	for _, ms := range modelMap {
		totalTokens += float64(ms.TotalTokens)
	}
	var result []ModelStat
	for _, ms := range modelMap {
		pct := 0.0
		if totalTokens > 0 {
			pct = float64(ms.TotalTokens) / totalTokens * 100
		}
		cacheHitRate := 0.0
		if ms.InputTokens > 0 {
			cacheHitRate = float64(ms.CacheReadTokens) / float64(ms.InputTokens) * 100
		}
		result = append(result, ModelStat{
			Name:        ms.Name,
			Requests:    ms.Requests,
			InputTokens: ms.InputTokens,
			OutputTokens: ms.OutputTokens,
			CacheTokens: ms.CacheReadTokens + ms.CacheCreationTokens,
			TotalTokens: ms.TotalTokens,
			Cost:        ms.Cost,
			Pct:         pct,
			CacheHitRate: cacheHitRate,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TotalTokens > result[j].TotalTokens
	})
	return result
}

// modelBreakdownAccum 是 modelBreakdown 内部使用的累加器
type modelBreakdownAccum struct {
	Name              string
	Requests          int
	InputTokens       int64
	OutputTokens      int64
	CacheReadTokens   int64
	CacheCreationTokens int64
	TotalTokens       int64
	Cost              float64
}

func parseDurationFloat(str string) float64 {
	if str == "" {
		return 0
	}
	str = strings.TrimSpace(strings.ToLower(str))
	if strings.HasSuffix(str, "ms") {
		v, err := strconv.ParseFloat(strings.TrimSuffix(str, "ms"), 64)
		if err != nil {
			return 0
		}
		return v
	}
	if strings.HasSuffix(str, "s") {
		v, err := strconv.ParseFloat(strings.TrimSuffix(str, "s"), 64)
		if err != nil {
			return 0
		}
		return v * 1000
	}
	v, err := strconv.ParseFloat(str, 64)
	if err != nil {
		return 0
	}
	return v
}
