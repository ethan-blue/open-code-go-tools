package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testdataRoot 返回测试数据根目录
func testdataRoot(t *testing.T) string {
	t.Helper()
	// 从当前文件所在目录出发定位 testdata
	return filepath.Join("testdata", "claude-projects")
}

func setUserHome(t *testing.T, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if volume := filepath.VolumeName(home); volume != "" {
		t.Setenv("HOMEDRIVE", volume)
		t.Setenv("HOMEPATH", strings.TrimPrefix(home, volume))
	}
}

func TestReadAllSessions(t *testing.T) {
	root := testdataRoot(t)
	sessions, err := ReadAllSessions(root)
	if err != nil {
		t.Fatalf("ReadAllSessions failed: %v", err)
	}

	// 应当有 2 个会话
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	// 按 lastTime 倒序：sess-002 (2025-06-02) > sess-001 (2025-06-01)
	if sessions[0].SessionID != "sess-002" {
		t.Errorf("expected first session sess-002, got %s", sessions[0].SessionID)
	}
	if sessions[1].SessionID != "sess-001" {
		t.Errorf("expected second session sess-001, got %s", sessions[1].SessionID)
	}

	// 验证 sess-001 的聚合数据（2 条有效 assistant 事件）
	s1 := sessions[1]
	if s1.MessageCount != 2 {
		t.Errorf("sess-001 messageCount expected 2, got %d", s1.MessageCount)
	}
	if s1.InputTokens != 230 { // 150 + 80
		t.Errorf("sess-001 inputTokens expected 230, got %d", s1.InputTokens)
	}
	if s1.OutputTokens != 420 { // 300 + 120
		t.Errorf("sess-001 outputTokens expected 420, got %d", s1.OutputTokens)
	}
	if s1.CacheReadTokens != 70 { // 50 + 20
		t.Errorf("sess-001 cacheReadTokens expected 70, got %d", s1.CacheReadTokens)
	}
	if s1.CacheCreateTokens != 15 { // 10 + 5
		t.Errorf("sess-001 cacheCreateTokens expected 15, got %d", s1.CacheCreateTokens)
	}
	if s1.TotalTokens != 735 { // 230 + 420 + 70 + 15
		t.Errorf("sess-001 totalTokens expected 735, got %d", s1.TotalTokens)
	}
	if s1.Model != "claude-sonnet-4-20250514" {
		t.Errorf("sess-001 model expected claude-sonnet-4-20250514, got %s", s1.Model)
	}
	if s1.StartTime != "2025-06-01T10:00:05Z" {
		t.Errorf("sess-001 startTime expected 2025-06-01T10:00:05Z, got %s", s1.StartTime)
	}
	if s1.LastTime != "2025-06-01T10:01:00Z" {
		t.Errorf("sess-001 lastTime expected 2025-06-01T10:01:00Z, got %s", s1.LastTime)
	}

	// 验证 sess-002 的去重效果
	s2 := sessions[0]
	if s2.MessageCount != 2 {
		t.Errorf("sess-002 messageCount expected 2 (dedup), got %d", s2.MessageCount)
	}
	// msg-1 首次是 200+500+100+30，第二次相同 uuid 跳过，第三次相同 msg-id 跳过
	// 最终有效事件只有 msg-1(首次) + msg-2 → 250+580+110+32 = 972
	if s2.InputTokens != 250 { // 200 + 50
		t.Errorf("sess-002 inputTokens expected 250, got %d", s2.InputTokens)
	}
	if s2.OutputTokens != 580 { // 500 + 80
		t.Errorf("sess-002 outputTokens expected 580, got %d", s2.OutputTokens)
	}
	if s2.CacheReadTokens != 110 { // 100 + 10
		t.Errorf("sess-002 cacheReadTokens expected 110, got %d", s2.CacheReadTokens)
	}
	if s2.CacheCreateTokens != 32 { // 30 + 2
		t.Errorf("sess-002 cacheCreateTokens expected 32, got %d", s2.CacheCreateTokens)
	}
	if s2.TotalTokens != 972 { // 250 + 580 + 110 + 32
		t.Errorf("sess-002 totalTokens expected 972, got %d", s2.TotalTokens)
	}
}

func TestReadAllSessions_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	emptyDir := filepath.Join(tmpDir, "empty")
	if err := os.MkdirAll(emptyDir, 0755); err != nil {
		t.Fatal(err)
	}

	sessions, err := ReadAllSessions(emptyDir)
	if err != nil {
		t.Fatalf("ReadAllSessions on empty dir failed: %v", err)
	}
	// An empty directory with no project subdirectories returns nil
	if sessions != nil {
		t.Errorf("expected nil for empty dir, got %v (len=%d)", sessions, len(sessions))
	}
}

func TestReadAllSessions_NonExistentDir(t *testing.T) {
	sessions, err := ReadAllSessions("/tmp/nonexistent-ocgt-test-dir-12345")
	if err != nil {
		t.Fatalf("ReadAllSessions on non-existent dir should return nil, got error: %v", err)
	}
	if sessions != nil {
		t.Errorf("expected nil for non-existent dir, got %v", sessions)
	}
}

func TestClaudeProjectsRoot(t *testing.T) {
	root, err := ClaudeProjectsRoot()
	if err != nil {
		t.Fatalf("ClaudeProjectsRoot failed: %v", err)
	}
	if !strings.HasSuffix(root, "claude"+string(filepath.Separator)+"projects") &&
		!strings.HasSuffix(root, ".claude/projects") {
		t.Errorf("unexpected root suffix: %s", root)
	}
	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, ".claude", "projects")
	if root != expected {
		t.Errorf("expected %s, got %s", expected, root)
	}
}

// ── Period filtering & file cache ──

// The 今日/本月/全部 selector was previously decorative — the backend ignored
// the period entirely, so "today" showed months of history. FilterByPeriod
// must cut by last-activity time relative to local midnight / month start.
func TestFilterByPeriod(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2026-07-04T15:00:00Z")
	sessions := []SessionStats{
		{SessionID: "today", LastTime: "2026-07-04T09:00:00Z"},
		{SessionID: "this-month", LastTime: "2026-07-01T12:00:00Z"},
		{SessionID: "last-month", LastTime: "2026-06-20T12:00:00Z"},
		{SessionID: "bad-ts", LastTime: "not-a-timestamp"},
	}

	got := FilterByPeriod(sessions, "today", now.UTC())
	ids := func(list []SessionStats) []string {
		out := make([]string, len(list))
		for i, s := range list {
			out[i] = s.SessionID
		}
		return out
	}
	if want := []string{"today", "bad-ts"}; strings.Join(ids(got), ",") != strings.Join(want, ",") {
		t.Fatalf("today filter: expected %v, got %v", want, ids(got))
	}

	got = FilterByPeriod(sessions, "month", now.UTC())
	if want := []string{"today", "this-month", "bad-ts"}; strings.Join(ids(got), ",") != strings.Join(want, ",") {
		t.Fatalf("month filter: expected %v, got %v", want, ids(got))
	}

	if got = FilterByPeriod(sessions, "all", now.UTC()); len(got) != len(sessions) {
		t.Fatalf("all/unknown period must return everything, got %d", len(got))
	}
}

// The per-file cache must serve unchanged files without re-reading them, but
// a modified file (new mtime/size) must be re-parsed — otherwise the sessions
// page would show stale token counts for the active session.
func TestReadAllSessionsCacheInvalidation(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(root, "proj-a")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatal(err)
	}
	line1 := `{"type":"assistant","uuid":"u1","timestamp":"2026-07-04T10:00:00Z","message":{"id":"m1","model":"test-model","usage":{"input_tokens":10,"output_tokens":5}}}` + "\n"
	file := filepath.Join(projectDir, "sess-cache.jsonl")
	if err := os.WriteFile(file, []byte(line1), 0o644); err != nil {
		t.Fatal(err)
	}

	first, err := ReadAllSessions(root)
	if err != nil || len(first) != 1 {
		t.Fatalf("first read: err=%v sessions=%d", err, len(first))
	}
	if first[0].InputTokens != 10 {
		t.Fatalf("expected 10 input tokens, got %d", first[0].InputTokens)
	}

	// Append a second event; bump mtime explicitly (coarse FS timestamps).
	line2 := `{"type":"assistant","uuid":"u2","timestamp":"2026-07-04T11:00:00Z","message":{"id":"m2","model":"test-model","usage":{"input_tokens":30,"output_tokens":5}}}` + "\n"
	if err := os.WriteFile(file, []byte(line1+line2), 0o644); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(file, future, future); err != nil {
		t.Fatal(err)
	}

	second, err := ReadAllSessions(root)
	if err != nil || len(second) != 1 {
		t.Fatalf("second read: err=%v sessions=%d", err, len(second))
	}
	if second[0].InputTokens != 40 {
		t.Fatalf("modified file must be re-parsed: expected 40 input tokens, got %d", second[0].InputTokens)
	}
}

func TestReadCodexSessions(t *testing.T) {
	root := t.TempDir()
	dayDir := filepath.Join(root, "2026", "07", "05")
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dayDir, "rollout-2026-07-05T10-00-00-codex-session.jsonl")
	lines := strings.Join([]string{
		`{"timestamp":"2026-07-05T10:00:00Z","type":"session_meta","payload":{"session_id":"codex-session","model_provider":"custom"}}`,
		`{"timestamp":"2026-07-05T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","model":"deepseek-v4-pro"}}`,
		`{"timestamp":"2026-07-05T10:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}`,
		`{"timestamp":"2026-07-05T10:00:03Z","type":"response_item","payload":{"type":"message","id":"msg1","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}`,
		`{"timestamp":"2026-07-05T10:00:04Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":7,"reasoning_output_tokens":3,"total_tokens":107},"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":7,"reasoning_output_tokens":3,"total_tokens":107}}}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(file, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}

	sessions, err := ReadCodexSessions(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 codex session, got %d", len(sessions))
	}
	got := sessions[0]
	if got.SessionID != "codex-session" || got.Source != sourceCodex || got.Model != "deepseek-v4-pro" {
		t.Fatalf("unexpected codex session identity: %+v", got)
	}
	if got.MessageCount != 1 || got.InputTokens != 80 || got.CacheReadTokens != 20 || got.OutputTokens != 7 || got.TotalTokens != 107 {
		t.Fatalf("unexpected codex token stats: %+v", got)
	}

	detail, err := ReadCodexSessionEvents(root, "codex-session")
	if err != nil {
		t.Fatal(err)
	}
	if detail == nil || len(detail.Events) != 2 {
		t.Fatalf("expected 2 codex detail events, got %#v", detail)
	}
	if detail.Events[0].Type != "user" || detail.Events[0].Message.Text != "hello" {
		t.Fatalf("unexpected first detail event: %+v", detail.Events[0])
	}
	if detail.Events[1].Type != "assistant" || detail.Events[1].Message.Text != "hi" {
		t.Fatalf("unexpected second detail event: %+v", detail.Events[1])
	}
}

func TestReadLocalSessionsIncludesArchivedCodex(t *testing.T) {
	home := t.TempDir()
	setUserHome(t, home)
	root := filepath.Join(home, ".codex", "archived_sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "rollout-2026-07-05T11-00-00-archived-codex-session.jsonl")
	lines := strings.Join([]string{
		`{"timestamp":"2026-07-05T11:00:00Z","type":"session_meta","payload":{"session_id":"archived-codex-session","model_provider":"custom"}}`,
		`{"timestamp":"2026-07-05T11:00:01Z","type":"turn_context","payload":{"model":"deepseek-v4-flash"}}`,
		`{"timestamp":"2026-07-05T11:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello archived"}]}}`,
		`{"timestamp":"2026-07-05T11:00:03Z","type":"response_item","payload":{"type":"message","id":"msg1","role":"assistant","content":[{"type":"output_text","text":"archived hi"}]}}`,
		`{"timestamp":"2026-07-05T11:00:04Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":40,"cached_input_tokens":10,"output_tokens":5,"total_tokens":45}}}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(file, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}

	sessions, err := ReadLocalSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 archived codex session, got %d", len(sessions))
	}
	got := sessions[0]
	if got.SessionID != "archived-codex-session" || got.Source != sourceCodex || got.Model != "deepseek-v4-flash" {
		t.Fatalf("unexpected archived codex session: %+v", got)
	}
	if got.InputTokens != 30 || got.CacheReadTokens != 10 || got.OutputTokens != 5 || got.TotalTokens != 45 {
		t.Fatalf("unexpected archived codex token stats: %+v", got)
	}

	detail, err := ReadLocalSessionEvents("archived-codex-session")
	if err != nil {
		t.Fatal(err)
	}
	if detail == nil || len(detail.Events) != 2 {
		t.Fatalf("expected archived codex detail events, got %#v", detail)
	}
	if detail.Events[0].Message.Text != "hello archived" || detail.Events[1].Message.Text != "archived hi" {
		t.Fatalf("unexpected archived codex detail: %+v", detail.Events)
	}
}

// TestExtractContentTextBlock verifies plain text blocks are extracted.
func TestExtractContentTextBlock(t *testing.T) {
	raw := []byte(`[{"type":"text","text":"hello world"}]`)
	text, tools := extractContent(raw, "assistant")
	if text != "hello world" {
		t.Fatalf("expected text %q, got %q", "hello world", text)
	}
	if len(tools) != 0 {
		t.Fatalf("expected no tools, got %v", tools)
	}
}

// TestExtractContentToolUse verifies tool_use blocks record the tool name and
// emit a [Tool: name] placeholder (cc-switch style).
func TestExtractContentToolUse(t *testing.T) {
	raw := []byte(`[{"type":"tool_use","id":"t1","name":"Read","input":{"path":"/x"}}]`)
	text, tools := extractContent(raw, "assistant")
	if len(tools) != 1 || tools[0] != "Read" {
		t.Fatalf("expected tools [Read], got %v", tools)
	}
	if !strings.Contains(text, "[Tool: Read]") {
		t.Fatalf("expected text to contain [Tool: Read] placeholder, got %q", text)
	}
}

// TestExtractContentToolResult verifies tool_result content is recursively
// extracted — this was the main source of empty "--" messages before.
func TestExtractContentToolResult(t *testing.T) {
	// tool_result with string content
	raw := []byte(`[{"type":"tool_result","tool_use_id":"t1","content":"file contents here"}]`)
	text, _ := extractContent(raw, "user")
	if !strings.Contains(text, "file contents here") {
		t.Fatalf("expected tool_result content extracted, got %q", text)
	}

	// tool_result with array content (text blocks inside)
	rawArr := []byte(`[{"type":"tool_result","tool_use_id":"t2","content":[{"type":"text","text":"nested result"}]}]`)
	textArr, _ := extractContent(rawArr, "user")
	if !strings.Contains(textArr, "nested result") {
		t.Fatalf("expected nested tool_result content extracted, got %q", textArr)
	}
}

// TestExtractContentMixed verifies a realistic mix of block types.
func TestExtractContentMixed(t *testing.T) {
	raw := []byte(`[
		{"type":"thinking","thinking":"let me think"},
		{"type":"text","text":"here is my answer"},
		{"type":"tool_use","id":"t1","name":"Bash","input":{}}
	]`)
	text, tools := extractContent(raw, "assistant")
	if !strings.Contains(text, "here is my answer") {
		t.Fatalf("expected text block content, got %q", text)
	}
	if !strings.Contains(text, "let me think") {
		t.Fatalf("expected thinking content as fallback, got %q", text)
	}
	if !strings.Contains(text, "[Tool: Bash]") {
		t.Fatalf("expected tool placeholder, got %q", text)
	}
	if len(tools) != 1 || tools[0] != "Bash" {
		t.Fatalf("expected tools [Bash], got %v", tools)
	}
}

// TestParseSessionEventsSkipsEmptyContent verifies that events with no
// extractable content (no text, no tools) are skipped — aligning with
// cc-switch which filters these out so the UI never shows "--".
func TestParseSessionEventsSkipsEmptyContent(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "sess-empty.jsonl")
	// assistant event with usage but empty content → should be skipped
	// assistant event with real text → should be kept
	// isMeta event → should be skipped
	lines := strings.Join([]string{
		`{"type":"assistant","uuid":"u1","timestamp":"2026-07-04T10:00:00Z","message":{"id":"m1","model":"x","content":[],"usage":{"input_tokens":10,"output_tokens":5}}}`,
		`{"type":"assistant","uuid":"u2","timestamp":"2026-07-04T10:01:00Z","message":{"id":"m2","model":"x","content":[{"type":"text","text":"real reply"}]}}`,
		`{"type":"user","uuid":"u3","isMeta":true,"timestamp":"2026-07-04T10:02:00Z","message":{"role":"user","content":"meta junk"}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(file, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}

	resp, err := parseSessionEvents(file, "sess-empty")
	if err != nil {
		t.Fatal(err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	// Only the event with "real reply" should survive.
	if len(resp.Events) != 1 {
		t.Fatalf("expected 1 event (empty + isMeta filtered), got %d: %+v", len(resp.Events), resp.Events)
	}
	if resp.Events[0].Message.Text != "real reply" {
		t.Fatalf("expected the real-reply event to remain, got %q", resp.Events[0].Message.Text)
	}
}
