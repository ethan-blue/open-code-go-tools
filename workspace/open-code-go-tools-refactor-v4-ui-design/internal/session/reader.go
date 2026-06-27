package session

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ClaudeProjectsRoot 返回 ~/.claude/projects 路径
func ClaudeProjectsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "projects"), nil
}

// ReadAllSessions 扫描目录下所有项目的 JSONL 文件，返回聚合后的会话列表
func ReadAllSessions(projectsRoot string) ([]SessionStats, error) {
	entries, err := os.ReadDir(projectsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read projects dir %s: %w", projectsRoot, err)
	}

	var all []SessionStats
	seen := map[string]bool{} // sessionID -> already appended

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		projectDir := filepath.Join(projectsRoot, entry.Name())
		sessions, err := readProjectSessions(projectDir)
		if err != nil {
			// skip unreadable projects
			continue
		}
		for _, s := range sessions {
			if !seen[s.SessionID] {
				seen[s.SessionID] = true
				all = append(all, s)
			}
		}
	}

	// 按最后活动时间倒序排列（最新在前）
	sort.Slice(all, func(i, j int) bool {
		return all[i].LastTime > all[j].LastTime
	})

	return all, nil
}

// readProjectSessions 读取一个项目目录下的所有 JSONL
func readProjectSessions(projectDir string) ([]SessionStats, error) {
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, err
	}

	var sessions []SessionStats
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		sessionID := strings.TrimSuffix(entry.Name(), ".jsonl")
		filePath := filepath.Join(projectDir, entry.Name())
		stats := parseSessionFile(filePath, sessionID)
		if stats != nil {
			sessions = append(sessions, *stats)
		}
	}
	return sessions, nil
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
