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

const (
	sourceClaude = "claude"
	sourceCodex  = "codex"
)

// ClaudeProjectsRoot 返回 ~/.claude/projects 路径
func ClaudeProjectsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "projects"), nil
}

func CodexSessionsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".codex", "sessions"), nil
}

func CodexArchivedSessionsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".codex", "archived_sessions"), nil
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
	source    string
	modTime   time.Time
	size      int64
}

// ReadAllSessions 扫描目录下所有项目的 JSONL 文件，返回聚合后的会话列表。
// 未变更的文件命中缓存；新增/变更的文件用并行 worker 解析。
func ReadAllSessions(projectsRoot string) ([]SessionStats, error) {
	jobs, err := collectClaudeSessionJobs(projectsRoot)
	if err != nil {
		return nil, err
	}
	return readSessionJobs(jobs), nil
}

func ReadCodexSessions(sessionsRoot string) ([]SessionStats, error) {
	jobs, err := collectCodexSessionJobs(sessionsRoot)
	if err != nil {
		return nil, err
	}
	return readSessionJobs(jobs), nil
}

func ReadLocalSessions() ([]SessionStats, error) {
	claudeRoot, err := ClaudeProjectsRoot()
	if err != nil {
		return nil, err
	}
	codexRoot, err := CodexSessionsRoot()
	if err != nil {
		return nil, err
	}
	codexArchivedRoot, err := CodexArchivedSessionsRoot()
	if err != nil {
		return nil, err
	}
	var jobs []sessionFileJob
	claudeJobs, err := collectClaudeSessionJobs(claudeRoot)
	if err != nil {
		return nil, err
	}
	jobs = append(jobs, claudeJobs...)
	for _, root := range []string{codexRoot, codexArchivedRoot} {
		codexJobs, err := collectCodexSessionJobs(root)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, codexJobs...)
	}
	return readSessionJobs(jobs), nil
}

func collectClaudeSessionJobs(projectsRoot string) ([]sessionFileJob, error) {
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
				source:    sourceClaude,
				modTime:   info.ModTime(),
				size:      info.Size(),
			})
		}
	}
	return jobs, nil
}

func collectCodexSessionJobs(sessionsRoot string) ([]sessionFileJob, error) {
	var jobs []sessionFileJob
	err := filepath.WalkDir(sessionsRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		jobs = append(jobs, sessionFileJob{
			path:      path,
			sessionID: codexSessionIDFromFilename(path),
			source:    sourceCodex,
			modTime:   info.ModTime(),
			size:      info.Size(),
		})
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read codex sessions dir %s: %w", sessionsRoot, err)
	}
	return jobs, nil
}

func readSessionJobs(jobs []sessionFileJob) []SessionStats {
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
			stats := parseSessionJob(job)
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

	return all
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
func parseSessionJob(job sessionFileJob) *SessionStats {
	if job.source == sourceCodex {
		return parseCodexSessionFile(job.path, job.sessionID)
	}
	return parseSessionFile(job.path, job.sessionID)
}

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
		Source:            sourceClaude,
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
type codexRawEvent struct {
	Timestamp string       `json:"timestamp"`
	Type      string       `json:"type"`
	Payload   codexPayload `json:"payload"`
}

type codexPayload struct {
	Type      string          `json:"type"`
	SessionID string          `json:"session_id"`
	ID        string          `json:"id"`
	Role      string          `json:"role"`
	Model     string          `json:"model"`
	Name      string          `json:"name"`
	Content   json.RawMessage `json:"content"`
	Output    json.RawMessage `json:"output"`
	Info      *codexTokenInfo `json:"info"`
}

type codexTokenInfo struct {
	TotalTokenUsage codexTokenUsage `json:"total_token_usage"`
	LastTokenUsage  codexTokenUsage `json:"last_token_usage"`
}

type codexTokenUsage struct {
	InputTokens           int `json:"input_tokens"`
	CachedInputTokens     int `json:"cached_input_tokens"`
	OutputTokens          int `json:"output_tokens"`
	ReasoningOutputTokens int `json:"reasoning_output_tokens"`
	TotalTokens           int `json:"total_tokens"`
}

func (u codexTokenUsage) empty() bool {
	return u.InputTokens == 0 && u.CachedInputTokens == 0 && u.OutputTokens == 0 &&
		u.ReasoningOutputTokens == 0 && u.TotalTokens == 0
}

func parseCodexSessionFile(filePath, fallbackID string) *SessionStats {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	sessionID := fallbackID
	var (
		model      string
		msgCount   int
		inputTok   int64
		outputTok  int64
		cacheRead  int64
		startTime  string
		lastTime   string
		finalUsage codexTokenUsage
		hasUsage   bool
	)

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var evt codexRawEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			continue
		}
		ts := evt.Timestamp
		if ts != "" {
			if startTime == "" || ts < startTime {
				startTime = ts
			}
			if ts > lastTime {
				lastTime = ts
			}
		}
		if evt.Payload.SessionID != "" {
			sessionID = evt.Payload.SessionID
		}
		if evt.Payload.Model != "" {
			model = evt.Payload.Model
		}
		if evt.Type == "response_item" && evt.Payload.Type == "message" && evt.Payload.Role == "assistant" {
			if text, _ := codexContentText(evt.Payload.Content); strings.TrimSpace(text) != "" {
				msgCount++
			}
		}
		if evt.Type == "event_msg" && evt.Payload.Type == "token_count" && evt.Payload.Info != nil {
			if !evt.Payload.Info.LastTokenUsage.empty() {
				in, out, cached := codexUsageParts(evt.Payload.Info.LastTokenUsage)
				inputTok += in
				outputTok += out
				cacheRead += cached
				hasUsage = true
			} else if !evt.Payload.Info.TotalTokenUsage.empty() {
				finalUsage = evt.Payload.Info.TotalTokenUsage
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil
	}
	if !hasUsage && !finalUsage.empty() {
		inputTok, outputTok, cacheRead = codexUsageParts(finalUsage)
		hasUsage = true
	}
	if msgCount == 0 && !hasUsage {
		return nil
	}
	return &SessionStats{
		SessionID:         sessionID,
		Source:            sourceCodex,
		Model:             model,
		MessageCount:      msgCount,
		InputTokens:       inputTok,
		OutputTokens:      outputTok,
		CacheReadTokens:   cacheRead,
		CacheCreateTokens: 0,
		TotalTokens:       inputTok + outputTok + cacheRead,
		StartTime:         startTime,
		LastTime:          lastTime,
	}
}

func codexUsageParts(u codexTokenUsage) (input, output, cached int64) {
	cached = int64(u.CachedInputTokens)
	input = int64(u.InputTokens) - cached
	if input < 0 {
		input = int64(u.InputTokens)
	}
	output = int64(u.OutputTokens)
	return input, output, cached
}

func codexSessionIDFromFilename(path string) string {
	name := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	const prefixShape = "rollout-2006-01-02T15-04-05-"
	if strings.HasPrefix(name, "rollout-") && len(name) > len(prefixShape) {
		return name[len(prefixShape):]
	}
	return name
}

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
func ReadLocalSessionEvents(sessionID string) (*SessionDetailResponse, error) {
	claudeRoot, err := ClaudeProjectsRoot()
	if err != nil {
		return nil, err
	}
	if detail, err := ReadSessionEvents(claudeRoot, sessionID); err != nil || detail != nil {
		return detail, err
	}
	codexRoot, err := CodexSessionsRoot()
	if err != nil {
		return nil, err
	}
	if detail, err := ReadCodexSessionEvents(codexRoot, sessionID); err != nil || detail != nil {
		return detail, err
	}
	codexArchivedRoot, err := CodexArchivedSessionsRoot()
	if err != nil {
		return nil, err
	}
	return ReadCodexSessionEvents(codexArchivedRoot, sessionID)
}

func ReadCodexSessionEvents(sessionsRoot, sessionID string) (*SessionDetailResponse, error) {
	var foundPath string
	stopWalk := fmt.Errorf("found")
	err := filepath.WalkDir(sessionsRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		fallbackID := codexSessionIDFromFilename(path)
		if fallbackID == sessionID || codexSessionIDInFile(path, fallbackID) == sessionID {
			foundPath = path
			return stopWalk
		}
		return nil
	})
	if err != nil && err != stopWalk {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read codex sessions dir: %w", err)
	}
	if foundPath == "" {
		return nil, nil
	}
	return parseCodexSessionEvents(foundPath, sessionID)
}

func codexSessionIDInFile(filePath, fallbackID string) string {
	f, err := os.Open(filePath)
	if err != nil {
		return fallbackID
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		var evt codexRawEvent
		if json.Unmarshal([]byte(scanner.Text()), &evt) == nil && evt.Payload.SessionID != "" {
			return evt.Payload.SessionID
		}
	}
	return fallbackID
}

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

		// 跳过 isMeta 行（Claude Code 内部元数据，非真实对话）。
		if raw.IsMeta {
			continue
		}

		// 没有 message 字段的行（summary / file-history-snapshot 等）跳过。
		if raw.Message == nil {
			continue
		}

		evt := SessionEvent{
			Type:      raw.Type,
			UUID:      raw.UUID,
			Timestamp: raw.Timestamp,
		}
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

		// 对齐 cc-switch：内容完全为空的事件不展示（避免满屏 "--"）。
		// 有 usage 但没内容的 assistant 事件（纯 usage 计费行）也跳过。
		if strings.TrimSpace(evt.Message.Text) == "" && len(evt.Message.Tools) == 0 {
			continue
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
// parseCodexSessionEvents extracts displayable turns from Codex session JSONL.
func parseCodexSessionEvents(filePath, sessionID string) (*SessionDetailResponse, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var events []SessionEvent
	model := ""
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var raw codexRawEvent
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}
		if raw.Payload.Model != "" {
			model = raw.Payload.Model
		}
		if raw.Type != "response_item" {
			continue
		}
		switch raw.Payload.Type {
		case "message":
			role := raw.Payload.Role
			if role != "user" && role != "assistant" {
				continue
			}
			text, tools := codexContentText(raw.Payload.Content)
			if strings.TrimSpace(text) == "" && len(tools) == 0 {
				continue
			}
			events = append(events, SessionEvent{
				Type:      role,
				UUID:      raw.Payload.ID,
				Timestamp: raw.Timestamp,
				Message: &EventMessage{
					ID:    raw.Payload.ID,
					Model: model,
					Text:  text,
					Tools: tools,
				},
			})
		case "function_call":
			if raw.Payload.Name == "" {
				continue
			}
			events = append(events, SessionEvent{
				Type:      "assistant",
				UUID:      raw.Payload.ID,
				Timestamp: raw.Timestamp,
				Message: &EventMessage{
					ID:    raw.Payload.ID,
					Model: model,
					Text:  fmt.Sprintf("[Tool: %s]", raw.Payload.Name),
					Tools: []string{raw.Payload.Name},
				},
			})
		case "function_call_output":
			text, _ := codexContentText(raw.Payload.Output)
			if strings.TrimSpace(text) == "" {
				continue
			}
			events = append(events, SessionEvent{
				Type:      "user",
				UUID:      raw.Payload.ID,
				Timestamp: raw.Timestamp,
				Message: &EventMessage{
					ID:    raw.Payload.ID,
					Model: model,
					Text:  text,
				},
			})
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return &SessionDetailResponse{
		SessionID: sessionID,
		Events:    events,
	}, nil
}

type codexContentPart struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Name string `json:"name,omitempty"`
}

func codexContentText(raw json.RawMessage) (string, []string) {
	if len(raw) == 0 {
		return "", nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s, nil
	}
	var parts []codexContentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return "", nil
	}
	var texts []string
	var tools []string
	for _, part := range parts {
		switch part.Type {
		case "input_text", "output_text", "text":
			if part.Text != "" {
				texts = append(texts, part.Text)
			}
		case "tool_use", "function_call":
			if part.Name != "" {
				tools = append(tools, part.Name)
				texts = append(texts, fmt.Sprintf("[Tool: %s]", part.Name))
			}
		}
	}
	return strings.Join(texts, "\n"), tools
}

type contentPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
	Name     string `json:"name,omitempty"`
	// tool_result 的 content 可能是字符串，也可能是 content 块数组。
	Content json.RawMessage `json:"content,omitempty"`
}

// extractContent 从 raw JSON 中提取文本内容和工具名。
// 对齐 cc-switch 的 extract_text 逻辑：
//   - 纯字符串 → 直接返回
//   - text 块 → 提取 text 字段
//   - thinking 块 → 提取 thinking 字段（cc-switch 不提取，我们保留作 fallback）
//   - tool_use 块 → 记录工具名，并输出 [Tool: {name}] 占位（cc-switch 风格）
//   - tool_result 块 → 递归提取其 content（字符串或数组都支持）
func extractContent(raw json.RawMessage, eventType string) (text string, tools []string) {
	// 尝试解析为字符串（user 消息的 content 常是纯字符串）
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
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
		case "thinking":
			// cc-switch 跳过 thinking；我们保留作 fallback，避免纯思考消息变空白。
			if p.Thinking != "" {
				texts = append(texts, p.Thinking)
			}
		case "tool_use":
			if p.Name != "" {
				tools = append(tools, p.Name)
				// cc-switch 风格：用占位标记让用户看到「这里调用了工具」。
				texts = append(texts, fmt.Sprintf("[Tool: %s]", p.Name))
			}
		case "tool_result":
			// 递归提取 tool_result 的 content（可能是字符串或块数组）。
			if len(p.Content) > 0 {
				if sub, _ := extractContent(p.Content, ""); sub != "" {
					texts = append(texts, sub)
				}
			}
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
