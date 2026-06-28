package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testdataRoot 返回测试数据根目录
func testdataRoot(t *testing.T) string {
	t.Helper()
	// 从当前文件所在目录出发定位 testdata
	return filepath.Join("testdata", "claude-projects")
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
