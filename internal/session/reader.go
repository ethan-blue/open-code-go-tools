package session

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// ClaudeProjectsRoot 返回 ~/.claude/projects 路径
func ClaudeProjectsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "projects"), nil
}

// Per-file stats cache. Re-parsing every JSONL on each request is O(total
// bytes) — with hundreds of sessions the page took seconds to open. A file's
// aggregate stats only change when the file changes, so cache by mtime+size.
type fileCacheEntry struct {
	modTime time.Time
	size    int64
	stats   *SessionStats // nil = parsed but not a valid session
}

var (
	fileCacheMu sync.Mutex
	fileCache   = map[string]fileCacheEntry{}
)

type sessionFileJob struct {
	path      string
	sessionID string
	modTime   time.Time
	size      int64
}

// ReadAllSessions 扫描目录下所有项目的 JSONL 文件，返回聚合后的会话列表。
// 未变更的文件命中缓存；新增/变更的文件用并行 worker 解析。
func ReadAllSessions(projectsRoot string) ([]SessionStats, error) {
	entries, err := os.ReadDir(projectsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read projects dir %s: %w", projectsRoot, err)
	}

	// 1. Collect every session file with its current mtime/size.
	var jobs []sessionFileJob
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		projectDir := filepath.Join(projectsRoot, entry.Name())
		files, err := os.ReadDir(projectDir)
		if err != nil {
			continue // skip unreadable projects
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			jobs = append(jobs, sessionFileJob{
				path:      filepath.Join(projectDir, f.Name()),
				sessionID: strings.TrimSuffix(f.Name(), ".jsonl"),
				modTime:   info.ModTime(),
				size:      info.Size(),
			})
		}
	}

	// 2. Resolve from cache; parse misses concurrently.
	results := make([]*SessionStats, len(jobs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxParallel())
	fileCacheMu.Lock()
	for i, job := range jobs {
		if entry, ok := fileCache[job.path]; ok && entry.modTime.Equal(job.modTime) && entry.size == job.size {
			results[i] = entry.stats
			continue
		}
		wg.Add(1)
		go func(i int, job sessionFileJob) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			stats := parseSessionFile(job.path, job.sessionID)
			fileCacheMu.Lock()
			fileCache[job.path] = fileCacheEntry{modTime: job.modTime, size: job.size, stats: stats}
			fileCacheMu.Unlock()
			results[i] = stats
		}(i, job)
	}
	fileCacheMu.Unlock()
	wg.Wait()

	// 3. Prune cache entries for deleted files so it cannot grow unbounded.
	livePaths := make(map[string]bool, len(jobs))
	for _, job := range jobs {
		livePaths[job.path] = true
	}
	fileCacheMu.Lock()
	for path := range fileCache {
		if !livePaths[path] {
			delete(fileCache, path)
		}
	}
	fileCacheMu.Unlock()

	// 4. Dedupe by session ID (first project wins, matching previous behavior).
	var all []SessionStats
	seen := map[string]bool{}
	for _, stats := range results {
		if stats == nil || seen[stats.SessionID] {
			continue
		}
		seen[stats.SessionID] = true
		all = append(all, *stats)
	}

	// 按最后活动时间倒序排列（最新在前）
	sort.Slice(all, func(i, j int) bool {
		return all[i].LastTime > all[j].LastTime
	})

	return all, nil
}

func maxParallel() int {
	n := runtime.NumCPU()
	if n > 8 {
		return 8
	}
	if n < 2 {
		return 2
	}
	return n
}

// FilterByPeriod keeps sessions whose last activity falls inside the period:
// "today" (since local midnight), "month" (since the 1st of the current
// month). Anything else — including "all" — returns the input unchanged.
func FilterByPeriod(sessions []SessionStats, period string, now time.Time) []SessionStats {
	var cutoff time.Time
	switch period {
	case "today":
		cutoff = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	case "month":
		cutoff = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	default:
		return sessions
	}
	out := make([]SessionStats, 0, len(sessions))
	for _, s := range sessions {
		ts, err := time.Parse(time.RFC3339, s.LastTime)
		if err != nil {
			out = append(out, s) // unparseable timestamps stay visible
			continue
		}
		if !ts.Before(cutoff) {
			out = append(out, s)
		}
	}
	return out
}

// parseSessionFile 解析单个 JSONL 文件
func parseSessionFile(filePath, sessionID string) *SessionStats {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var (
		model       string
		msgCount    int
		inputTok    int64
		outputTok   int64
		cacheRead   int64
		cacheCreate int64
		startTime   string
		lastTime    string
	)

	seenUUID := map[string]bool{}
	seenMsgID := map[string]bool{}

	scanner := bufio.NewScanner(f)
	// Allow for large lines (deeply nested JSON)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)

	hasAssistant := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var evt ClaudeCodeEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			continue
		}

		if evt.Type != "assistant" {
			continue
		}

		hasAssistant = true

		// UUID 去重：相同 uuid 的事件只处理一次
		if evt.UUID != "" {
			if seenUUID[evt.UUID] {
				continue
			}
			seenUUID[evt.UUID] = true
		}

		if evt.Message == nil || evt.Message.Usage == nil {
			continue
		}

		// Message ID 去重：相同 message.id 只计第一次 usage
		if evt.Message.ID != "" {
			if seenMsgID[evt.Message.ID] {
				continue
			}
			seenMsgID[evt.Message.ID] = true
		}

		usage := evt.Message.Usage
		msgCount++
		inputTok += int64(usage.InputTokens)
		outputTok += int64(usage.OutputTokens)
		cacheRead += int64(usage.CacheReadTokens)
		cacheCreate += int64(usage.CacheCreateTokens)

		if model == "" && evt.Message.Model != "" {
			model = evt.Message.Model
		}

		if startTime == "" || evt.Timestamp < startTime {
			startTime = evt.Timestamp
		}
		if evt.Timestamp > lastTime {
			lastTime = evt.Timestamp
		}
	}

	if err := scanner.Err(); err != nil {
		return nil
	}

	if !hasAssistant || msgCount == 0 {
		return nil
	}

	return &SessionStats{
		SessionID:         sessionID,
		Model:             model,
		MessageCount:      msgCount,
		InputTokens:       inputTok,
		OutputTokens:      outputTok,
		CacheReadTokens:   cacheRead,
		CacheCreateTokens: cacheCreate,
		TotalTokens:       inputTok + outputTok + cacheRead + cacheCreate,
		StartTime:         startTime,
		LastTime:          lastTime,
	}
}

// ReadSessionEvents 读取指定会话 ID 的 JSONL 文件，返回所有事件
func ReadSessionEvents(projectsRoot, sessionID string) (*SessionDetailResponse, error) {
	entries, err := os.ReadDir(projectsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read projects dir: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		projectDir := filepath.Join(projectsRoot, entry.Name())
		filePath := filepath.Join(projectDir, sessionID+".jsonl")
		if _, err := os.Stat(filePath); err != nil {
			continue
		}
		return parseSessionEvents(filePath, sessionID)
	}
	return nil, nil
}

// parseSessionEvents 解析 JSONL 文件中的所有事件
func parseSessionEvents(filePath, sessionID string) (*SessionDetailResponse, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var events []SessionEvent
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var raw ClaudeCodeEvent
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		evt := SessionEvent{
			Type:      raw.Type,
			UUID:      raw.UUID,
			Timestamp: raw.Timestamp,
		}
		if raw.Message != nil {
			evt.Message = &EventMessage{
				ID:    raw.Message.ID,
				Model: raw.Message.Model,
			}
			if raw.Message.Usage != nil {
				evt.Message.Usage = &EventUsage{
					InputTokens:       raw.Message.Usage.InputTokens,
					OutputTokens:      raw.Message.Usage.OutputTokens,
					CacheReadTokens:   raw.Message.Usage.CacheReadTokens,
					CacheCreateTokens: raw.Message.Usage.CacheCreateTokens,
				}
			}
			// 提取文本和工具名
			if len(raw.Message.Content) > 0 {
				text, tools := extractContent(raw.Message.Content, raw.Type)
				evt.Message.Text = text
				evt.Message.Tools = tools
			}
		}
		events = append(events, evt)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return &SessionDetailResponse{
		SessionID: sessionID,
		Events:    events,
	}, nil
}

// contentPart JSONL message.content 中的单个元素
type contentPart struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Name string `json:"name,omitempty"`
}

// extractContent 从 raw JSON 中提取文本内容和工具名
func extractContent(raw json.RawMessage, eventType string) (text string, tools []string) {
	// 尝试解析为字符串
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		// 用户消息合成提示词过滤
		if eventType == "user" && isSyntheticPrompt(s) {
			return "", nil
		}
		return s, nil
	}

	// 尝试解析为 content 数组
	var parts []contentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return "", nil
	}

	var texts []string
	for _, p := range parts {
		switch p.Type {
		case "text":
			if p.Text != "" {
				texts = append(texts, p.Text)
			}
		case "tool_use":
			if p.Name != "" {
				tools = append(tools, p.Name)
			}
		// thinking / tool_result 等跳过
		}
	}
	text = strings.Join(texts, "\n")
	// 用户消息合成提示词过滤
	if eventType == "user" && isSyntheticPrompt(text) {
	return "", nil
	}
	return
	}

// isSyntheticPrompt 判断是否为 Claude Code 注入的合成提示词
func isSyntheticPrompt(text string) bool {
	if text == "" {
		return true
	}
	if strings.HasPrefix(text, "[Request interrupted") {
		return true
	}
	if strings.HasPrefix(text, "Base directory for this skill:") {
		return true
	}
	if strings.Contains(text, "<command-name>") {
		return true
	}
	if strings.Contains(text, "<warning>") {
		return true
	}
	return false
}
