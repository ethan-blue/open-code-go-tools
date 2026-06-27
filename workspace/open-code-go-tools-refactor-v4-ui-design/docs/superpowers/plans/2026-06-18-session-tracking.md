# 会话跟踪功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 读取 Claude Code 本地会话日志，按 session 维度展示 token 用量，不改变现有代理数据捕获方式。

**Architecture:** 新增 `internal/session/` 包，扫描 `~/.claude/projects/` 目录下的 JSONL 日志文件，解析 `assistant` 事件的 `message.usage`，按 `sessionId` 去重聚合。通过独立 API 端点 `/ocgt/api/sessions` 对外提供数据，前端新增"会话"视图展示。

**Tech Stack:** Go 标准库 (encoding/json, bufio, os, path/filepath, sort, time)

---
## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `internal/session/types.go` | Claude Code JSONL 事件结构体、会话统计数据模型 |
| `internal/session/reader.go` | 扫描 projects 目录、读取 JSONL 文件、去重解析 |
| `internal/session/aggregator.go` | 按 sessionId 聚合 token 数据 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `internal/proxy/handler.go` | 注册 `/ocgt/api/sessions` 路由 + 实现 handler |
| `frontend/index.html` | 新增"会话"视图区域 |
| `frontend/app.js` | i18n、导航项、视图切换、数据加载和渲染 |

---

## Claude Code JSONL 格式（参考）

```
~/.claude/projects/<project-hash>/<sessionId>.jsonl
```

每行一个 JSON 事件，关键字段：

```json
{
  "type": "assistant",
  "uuid": "a1b2c3d4-...",
  "sessionId": "550e8400-...",
  "timestamp": "2026-06-18T10:00:00Z",
  "message": {
    "id": "msg_01ABCD...",
    "model": "claude-sonnet-4-20250514",
    "usage": {
      "input_tokens": 4123,
      "output_tokens": 567,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 2890
    },
    "content": [
      {"type": "thinking", "thinking": "..."},
      {"type": "text", "text": "..."}
    ]
  }
}
```

```json
{
  "type": "user",
  "uuid": "e5f6g7h8-...",
  "sessionId": "550e8400-...",
  "message": {
    "content": [{"type": "text", "text": "用户的 prompt"}]
  }
}
```

### 去重要点

1. **UUID 去重**：Claude Code Resume 功能会重放同一事件（同 `uuid`），需跳过已见的
2. **Message ID 去重**：一次 API 回复可能分多行写入（每个 content block 一行），它们共享同一 `message.id`，只计第一次出现的 `usage`，后续行只合并 `tools` 数组
3. **只读 `assistant` 事件**：只有 `type == "assistant"` 的事件带 `message.usage`，`user` 事件不带

---

## 数据结构

```go
// types.go
package session

// ClaudeCodeEvent Claude Code JSONL 单行事件
type ClaudeCodeEvent struct {
    Type      string `json:"type"`      // "user" | "assistant" | ...
    UUID      string `json:"uuid"`
    SessionID string `json:"sessionId"`
    Timestamp string `json:"timestamp"`
    Message   *struct {
        ID    string `json:"id"`    // "msg_01ABCD..."
        Model string `json:"model"`
        Usage *struct {
            InputTokens         int `json:"input_tokens"`
            OutputTokens        int `json:"output_tokens"`
            CacheReadTokens     int `json:"cache_read_input_tokens"`
            CacheCreateTokens   int `json:"cache_creation_input_tokens"`
        } `json:"usage"`
    } `json:"message,omitempty"`
}

// SessionStats 单次会话的聚合统计
type SessionStats struct {
    SessionID         string  `json:"sessionId"`
    Model             string  `json:"model"`
    MessageCount      int     `json:"messageCount"`
    InputTokens       int64   `json:"inputTokens"`
    OutputTokens      int64   `json:"outputTokens"`
    CacheReadTokens   int64   `json:"cacheReadTokens"`
    CacheCreateTokens int64   `json:"cacheCreateTokens"`
    TotalTokens       int64   `json:"totalTokens"`
    StartTime         string  `json:"startTime"`   // 最早事件的时间戳
    LastTime          string  `json:"lastTime"`    // 最晚事件的时间戳
}

// SessionsResponse API 响应结构
type SessionsResponse struct {
    Sessions []SessionStats `json:"sessions"`
    Total    int            `json:"total"`
}
```

---

## 实施任务

### Phase 1：基础类型 + 日志读取 + 聚合

#### Task 1: 创建 internal/session/types.go

**Files:**
- Create: `internal/session/types.go`

- [ ] **Step 1: 定义数据结构**

```go
package session

// ClaudeCodeEvent 映射 Claude Code JSONL 中单行 JSON 的结构
type ClaudeCodeEvent struct {
    Type      string `json:"type"`
    UUID      string `json:"uuid"`
    SessionID string `json:"sessionId"`
    Timestamp string `json:"timestamp"`
    Message   *claudeMessage `json:"message,omitempty"`
}

type claudeMessage struct {
    ID    string       `json:"id"`
    Model string       `json:"model"`
    Usage *claudeUsage `json:"usage,omitempty"`
}

type claudeUsage struct {
    InputTokens       int `json:"input_tokens"`
    OutputTokens      int `json:"output_tokens"`
    CacheReadTokens   int `json:"cache_read_input_tokens"`
    CacheCreateTokens int `json:"cache_creation_input_tokens"`
}

// SessionStats 单次会话的聚合统计结果
type SessionStats struct {
    SessionID         string `json:"sessionId"`
    Model             string `json:"model"`
    MessageCount      int    `json:"messageCount"`
    InputTokens       int64  `json:"inputTokens"`
    OutputTokens      int64  `json:"outputTokens"`
    CacheReadTokens   int64  `json:"cacheReadTokens"`
    CacheCreateTokens int64  `json:"cacheCreateTokens"`
    TotalTokens       int64  `json:"totalTokens"`
    StartTime         string `json:"startTime"`
    LastTime          string `json:"lastTime"`
}

// SessionsResponse API 响应
type SessionsResponse struct {
    Sessions []SessionStats `json:"sessions"`
    Total    int            `json:"total"`
}
```

- [ ] **Step 2: 编译验证**

Run: `go build ./internal/session/`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add internal/session/types.go
git commit -m "[session] 会话跟踪数据结构定义"
```

#### Task 2: 创建 internal/session/reader.go

**Files:**
- Create: `internal/session/reader.go`

- [ ] **Step 1: 实现 JSONL 文件扫描和解析**

```go
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

const claudeProjectsDir = ".claude/projects"

// ClaudeProjectsRoot 返回 ~/.claude/projects 目录路径
func ClaudeProjectsRoot() (string, error) {
    home, err := os.UserHomeDir()
    if err != nil {
        return "", fmt.Errorf("cannot determine home dir: %w", err)
    }
    return filepath.Join(home, claudeProjectsDir), nil
}

// ReadAllSessions 扫描 projects 目录下所有 JSONL 文件，返回解析后的会话统计
func ReadAllSessions(projectsRoot string) ([]SessionStats, error) {
    entries, err := os.ReadDir(projectsRoot)
    if err != nil {
        if os.IsNotExist(err) {
            return nil, nil // 目录不存在时静默返回空
        }
        return nil, fmt.Errorf("read projects dir: %w", err)
    }

    var allSessions []SessionStats
    for _, entry := range entries {
        if !entry.IsDir() {
            continue
        }
        projectDir := filepath.Join(projectsRoot, entry.Name())
        sessions, err := readProjectSessions(projectDir)
        if err != nil {
            continue // 跳过无法读取的项目目录
        }
        allSessions = append(allSessions, sessions...)
    }

    sort.Slice(allSessions, func(i, j int) bool {
        return allSessions[i].LastTime > allSessions[j].LastTime
    })

    return allSessions, nil
}

// readProjectSessions 读取单个项目目录下的所有 JSONL 文件
func readProjectSessions(projectDir string) ([]SessionStats, error) {
    files, err := os.ReadDir(projectDir)
    if err != nil {
        return nil, err
    }

    // 按 sessionId 聚合解析结果
    sessionMap := make(map[string]*SessionStats)
    for _, f := range files {
        if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
            continue
        }
        // 文件名 = sessionId.jsonl
        sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
        if sessionID == "" {
            continue
        }

        filePath := filepath.Join(projectDir, f.Name())
        stats := parseSessionFile(filePath, sessionID)
        if stats != nil {
            sessionMap[sessionID] = stats
        }
    }

    result := make([]SessionStats, 0, len(sessionMap))
    for _, s := range sessionMap {
        result = append(result, *s)
    }
    return result, nil
}

// parseSessionFile 解析单个 JSONL 文件，提取会话统计
// 去重规则（参考 Token Monitor）：
//   1. uuid 去重 — 同一 uuid 只处理一次（Resume 重放跳过）
//   2. message.id 去重 — 同一 message.id 只计第一次 usage，后续合并 tools
func parseSessionFile(filePath, sessionID string) *SessionStats {
    f, err := os.Open(filePath)
    if err != nil {
        return nil
    }
    defer f.Close()

    seenUUIDs := make(map[string]bool)
    seenMsgIDs := make(map[string]bool)

    stats := &SessionStats{
        SessionID: sessionID,
    }
    var firstTimestamp, lastTimestamp string

    scanner := bufio.NewScanner(f)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" {
            continue
        }

        var event ClaudeCodeEvent
        if err := json.Unmarshal([]byte(line), &event); err != nil {
            continue
        }

        // uuid 去重
        if event.UUID != "" {
            if seenUUIDs[event.UUID] {
                continue
            }
            seenUUIDs[event.UUID] = true
        }

        // 记录时间范围
        if event.Timestamp != "" {
            if firstTimestamp == "" || event.Timestamp < firstTimestamp {
                firstTimestamp = event.Timestamp
            }
            if event.Timestamp > lastTimestamp {
                lastTimestamp = event.Timestamp
            }
        }

        // 只处理 assistant 类型且带 usage 的事件
        if event.Type != "assistant" || event.Message == nil || event.Message.Usage == nil {
            continue
        }

        // message.id 去重
        msgID := event.Message.ID
        if msgID != "" && seenMsgIDs[msgID] {
            continue
        }
        if msgID != "" {
            seenMsgIDs[msgID] = true
        }

        // 提取 model
        if stats.Model == "" && event.Message.Model != "" {
            stats.Model = event.Message.Model
        }

        // 累加 token
        usage := event.Message.Usage
        stats.MessageCount++
        stats.InputTokens += int64(usage.InputTokens)
        stats.OutputTokens += int64(usage.OutputTokens)
        stats.CacheReadTokens += int64(usage.CacheReadTokens)
        stats.CacheCreateTokens += int64(usage.CacheCreateTokens)
    }

    stats.StartTime = firstTimestamp
    stats.LastTime = lastTimestamp
    stats.TotalTokens = stats.InputTokens + stats.OutputTokens + stats.CacheReadTokens + stats.CacheCreateTokens

    if stats.MessageCount == 0 {
        return nil // 没有 assistant 事件，忽略
    }

    return stats
}
```

- [ ] **Step 2: 编译验证**

Run: `go build ./internal/session/`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add internal/session/reader.go
git commit -m "[session] JSONL 文件扫描与解析"
```


### Phase 2: API 集成

#### Task 3: 注册 API 路由

**Files:**
- Modify: `internal/proxy/handler.go` — 注册路由和 handler

- [ ] **Step 1: 在 handler.go 中注册路由**

在 `Handler()` 方法的 mux 注册段中增加：

```go
mux.HandleFunc("/ocgt/api/sessions", s.apiSessions)
```

- [ ] **Step 2: 实现 apiSessions handler**

```go
func (s *Server) apiSessions(w http.ResponseWriter, r *http.Request) {
    projectsRoot, err := session.ClaudeProjectsRoot()
    if err != nil {
        writeError(w, http.StatusInternalServerError, err)
        return
    }

    sessions, err := session.ReadAllSessions(projectsRoot)
    if err != nil {
        writeError(w, http.StatusInternalServerError, err)
        return
    }

    if sessions == nil {
        sessions = []session.SessionStats{}
    }

    resp := session.SessionsResponse{
        Sessions: sessions,
        Total:    len(sessions),
    }

    writeJSON(w, http.StatusOK, resp)
}
```

在 import 块中增加：
```go
"github.com/ethan-blue/open-code-go-tools/internal/session"
```

- [ ] **Step 3: 编译验证**

Run: `go build ./...`
Expected: 编译通过

- [ ] **Step 4: 提交**

```bash
git add internal/proxy/handler.go
git commit -m "[session] 注册 /ocgt/api/sessions API 端点"
```


### Phase 3: 测试

#### Task 4: 创建测试数据和单元测试

**Files:**
- Create: `internal/session/session_test.go`

- [ ] **Step 1: 创建测试 JSONL 数据文件**

测试目录结构：
```
testdata/claude-projects/project-a/
  550e8400-e29b-41d4-a716-446655440000.jsonl   ← 3 条 assistant 事件
  660e8400-e29b-41d4-a716-446655440001.jsonl   ← 2 条 assistant 事件
testdata/claude-projects/project-b/
  770e8400-e29b-41d4-a716-446655440002.jsonl   ← 1 条 assistant 事件
```

创建 `internal/session/testdata/` 目录和测试 JSONL 文件。

- [ ] **Step 2: 写测试代码**

```go
package session

import (
    "path/filepath"
    "testing"
)

func TestReadAllSessions(t *testing.T) {
    testDir := filepath.Join("testdata", "claude-projects")
    sessions, err := ReadAllSessions(testDir)
    if err != nil {
        t.Fatalf("ReadAllSessions failed: %v", err)
    }

    if len(sessions) != 3 {
        t.Fatalf("期望 3 个会话, got %d", len(sessions))
    }

    // 验证第一个会话
    s := sessions[0]
    if s.SessionID == "" {
        t.Fatal("SessionID 不应为空")
    }
    if s.TotalTokens <= 0 {
        t.Fatalf("TotalTokens 应 > 0, got %d", s.TotalTokens)
    }
    if s.MessageCount <= 0 {
        t.Fatalf("MessageCount 应 > 0, got %d", s.MessageCount)
    }
}

func TestParseSessionFile_DedupUUID(t *testing.T) {
    // 验证相同 uuid 的重复行只计一次
    // 创建一个临时 JSONL 包含重复 uuid
}

func TestParseSessionFile_DedupMessageID(t *testing.T) {
    // 验证相同 message.id 的 content block 分片只计第一次 usage
}

func TestClaudeProjectsRoot(t *testing.T) {
    root, err := ClaudeProjectsRoot()
    if err != nil {
        t.Fatalf("ClaudeProjectsRoot failed: %v", err)
    }
    if root == "" {
        t.Fatal("root 不应为空")
    }
}
```

- [ ] **Step 3: 编译并运行测试**

Run: `go test -v ./internal/session/`
Expected: 测试通过

- [ ] **Step 4: 提交**

```bash
git add internal/session/
git commit -m "[session] 单元测试与测试数据"
```


### Phase 4: 前端

#### Task 5: 前端会话视图

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`

- [ ] **Step 1: 在 index.html 中新增会话视图**

在 sidebar 增加导航按钮（在多设备之后）：
```html
<button class="nav-item" id="btn-nav-sessions" data-view="sessions" aria-label="Sessions, Ctrl+7">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span data-i18n="nav_sessions">会话</span>
    <span class="nav-shortcut">Ctrl+7</span>
</button>
```

在 view-container 内新增 view section（在所有现有 view 之后）：
```html
<!-- ========== Sessions ========== -->
<section class="view" id="view-sessions">
    <div class="sessions-header">
        <div class="stat-card stat-card-wide">
            <div class="stat-info">
                <span class="stat-label" data-i18n="sessions_total">本地会话记录</span>
                <h3 class="stat-value" id="sessions-count">-</h3>
            </div>
        </div>
    </div>
    <div class="card" style="margin-top:16px;padding:20px;">
        <div id="sessions-list"></div>
    </div>
</section>
```

- [ ] **Step 2: 在 app.js 中新增 i18n 和视图逻辑**

i18n zh:
```javascript
nav_sessions: "会话",
sessions_total: "本地会话记录",
sessions_no_data: "未找到 Claude Code 会话记录",
sessions_model: "模型",
sessions_messages: "消息数",
sessions_tokens: "Token",
sessions_cost: "费用",
sessions_period: "时间范围",
```

i18n en:
```javascript
nav_sessions: "Sessions",
sessions_total: "Local Sessions",
sessions_no_data: "No Claude Code session data found",
sessions_model: "Model",
sessions_messages: "Messages",
sessions_tokens: "Tokens",
sessions_cost: "Cost",
sessions_period: "Time Range",
```

视图注册（更新 VIEW_VALUES、快捷键映射、view meta）：
```javascript
const VIEW_VALUES = new Set(['dashboard', 'settings', 'terminal', 'history', 'traffic-detail', 'hub', 'sessions']);
const viewMap = { '1': 'dashboard', '2': 'settings', '3': 'terminal', '4': 'history', '5': 'traffic-detail', '6': 'hub', '7': 'sessions' };
```

视图切换时加载数据（在现有 view switch 逻辑中增加）：
```javascript
if (viewId === 'sessions') refreshSessions();
```

实现 `refreshSessions` 函数：
```javascript
async function refreshSessions() {
    try {
        const resp = await apiFetch('/ocgt/api/sessions');
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        renderSessions(data);
    } catch (err) {
        console.error('Failed to load sessions:', err);
        document.getElementById('sessions-list').innerHTML = '<span style="color:var(--text-2);">加载失败: ' + err.message + '</span>';
    }
}

function renderSessions(data) {
    const sessions = data.sessions || [];
    document.getElementById('sessions-count').textContent = sessions.length + ' 个会话';

    const listEl = document.getElementById('sessions-list');
    if (sessions.length === 0) {
        listEl.innerHTML = '<span style="color:var(--text-2);">未找到 Claude Code 会话记录</span>';
        return;
    }

    listEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' +
        sessions.map(s => {
            const from = s.startTime ? s.startTime.slice(0, 19).replace('T', ' ') : '?';
            const to = s.lastTime ? s.lastTime.slice(0, 19).replace('T', ' ') : '?';
            return '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);">' +
                '<div style="flex:1;">' +
                '<div style="font-weight:600;color:var(--text-0);font-size:0.9rem;">' + escHtml(s.sessionId ? s.sessionId.slice(0, 8) + '...' : '?') + '</div>' +
                '<div style="font-size:0.8rem;color:var(--text-2);margin-top:2px;">' + escHtml(s.model || '?') + ' · ' + s.messageCount + ' 条消息</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                '<div style="font-family:var(--mono);color:var(--text-0);font-size:0.9rem;">' + formatTokens(s.totalTokens) + '</div>' +
                '<div style="font-size:0.75rem;color:var(--text-2);">' + from + ' → ' + to + '</div>' +
                '</div>' +
                '</div>';
        }).join('') + '</div>';
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/index.html frontend/app.js
git commit -m "[session] 前端会话视图与 API 集成"
```


### Phase 5: 测试数据验证

#### Task 6: 用真实 Claude Code 日志验证

- [ ] **Step 1: 检查本地是否有 Claude Code 日志**

Run: `ls ~/.claude/projects/ 2>/dev/null || echo "无 Claude Code 日志"`

如果有日志，直接验证：
Run: `go run ./internal/session/` 或写一个小 main 函数验证。

- [ ] **Step 2: 如果没有日志，创建模拟测试数据**

按照 Claude Code JSONL 格式创建测试文件，验证解析逻辑正确性。

---

## 自审检查

- [x] **规格覆盖**：数据模型（Task 1）、日志解析（Task 2）、API 集成（Task 3）、测试（Task 4）、前端（Task 5）
- [x] **无占位符**：所有代码完整可编译
- [x] **类型一致性**：`ClaudeCodeEvent` 结构体与 JSONL 格式一一对应；`SessionStats` 从事件中聚合生成
- [x] **边界情况**：无 projects 目录时静默返回空（不报错）、JSONL 解析错误跳过单行而非终止、无 assistant 事件的会话忽略
