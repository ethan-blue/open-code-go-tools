# Hub/Session UI 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 subagent-driven-development 按任务逐步实现。

**Goal:** 优化 Hub 跨设备同步设置布局 + 强化多设备同步页面和会话页面的 UI 和功能

**Architecture:** 后端新增 SyncNow API 和会话详情 API；前端重构 Hub 设置面板为 2×2 网格布局，强化 Hub 主页面（立即同步、设备详情），重构会话页面（搜索/筛选/排序、模型分布图、会话详情展开）

**Tech Stack:** Go (net/http) + Wails v2 + 原生 JS + Chart.js

---

### Task 1: 后端 — SyncNow API

**Files:**
- Modify: `internal/hub/client.go`
- Modify: `internal/proxy/handler.go`
- Modify: `internal/proxy/types.go`

- [ ] **Step 1: 添加 SyncNow 公开方法**

在 `internal/hub/client.go` 中添加 `SyncNow()` 方法：

```go
// SyncNow 立即执行一次数据推送。
func (c *Client) SyncNow() {
    if !c.config.Enabled || c.config.HubURL == "" {
        return
    }
    c.pushOnce()
}
```

- [ ] **Step 2: 注册 POST /ocgt/api/hub/sync 路由**

在 `internal/proxy/handler.go` 的 registerStatsRoutes (或 mux 路由注册区) 添加：
```go
mux.HandleFunc("/ocgt/api/hub/sync", s.apiHubSync)
```

在文件末尾添加 handler：
```go
func (s *Server) apiHubSync(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
        return
    }
    if s.HubClient == nil {
        writeError(w, http.StatusBadRequest, fmt.Errorf("hub client not initialized"))
        return
    }
    s.HubClient.SyncNow()
    writeJSON(w, http.StatusOK, map[string]any{"success": true})
}
```

- [ ] **Step 3: 编译验证**

Run: `cd D:/ocgt_v2.0.2 && go build ./...`
Expected: PASS

---

### Task 2: 后端 — 会话详情 API

**Files:**
- Modify: `internal/session/reader.go`
- Modify: `internal/session/types.go`
- Modify: `internal/proxy/handler.go`

- [ ] **Step 1: 添加会话事件类型和详情响应类型**

在 `internal/session/types.go` 末尾添加：

```go
// SessionEvent 单条会话事件（API 输出用）
type SessionEvent struct {
    Type      string       `json:"type"`
    UUID      string       `json:"uuid"`
    Timestamp string       `json:"timestamp"`
    Message   *EventMessage `json:"message,omitempty"`
}

type EventMessage struct {
    ID    string      `json:"id"`
    Model string      `json:"model"`
    Usage *EventUsage `json:"usage,omitempty"`
}

type EventUsage struct {
    InputTokens       int `json:"input_tokens"`
    OutputTokens      int `json:"output_tokens"`
    CacheReadTokens   int `json:"cache_read_input_tokens"`
    CacheCreateTokens int `json:"cache_creation_input_tokens"`
}

// SessionDetailResponse 会话详情 API 响应
type SessionDetailResponse struct {
    SessionID string         `json:"sessionId"`
    Events    []SessionEvent `json:"events"`
}
```

- [ ] **Step 2: 添加 ReadSessionEvents 函数**

在 `internal/session/reader.go` 末尾添加：

```go
// ReadSessionEvents 读取指定会话 ID 的 JSONL 文件，返回所有事件
func ReadSessionEvents(projectsRoot, sessionID string) (*SessionDetailResponse, error) {
    // 扫描所有项目目录查找匹配的 JSONL 文件
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
```

- [ ] **Step 3: 注册 GET /ocgt/api/sessions/{id} 路由**

在 `internal/proxy/handler.go` 中修改 `apiSessions` 以支持路径参数，或添加独立 handler。

实际上，Go 的 `http.ServeMux` 不支持路径参数，所以用查询参数方式：`GET /ocgt/api/sessions?id=xxx`

修改 `apiSessions`：

```go
func (s *Server) apiSessions(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
        return
    }

    projectsRoot, err := session.ClaudeProjectsRoot()
    if err != nil {
        writeError(w, http.StatusInternalServerError, err)
        return
    }

    // 如果指定了 id 参数，返回会话详情
    if sessionID := r.URL.Query().Get("id"); sessionID != "" {
        detail, err := session.ReadSessionEvents(projectsRoot, sessionID)
        if err != nil {
            writeError(w, http.StatusInternalServerError, err)
            return
        }
        if detail == nil {
            writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
            return
        }
        writeJSON(w, http.StatusOK, detail)
        return
    }

    // 原有逻辑：返回会话列表
    sessions, err := session.ReadAllSessions(projectsRoot)
    if err != nil {
        writeError(w, http.StatusInternalServerError, err)
        return
    }
    if sessions == nil {
        sessions = []session.SessionStats{}
    }
    writeJSON(w, http.StatusOK, session.SessionsResponse{
        Sessions: sessions,
        Total:    len(sessions),
    })
}
```

- [ ] **Step 4: 编译验证**

Run: `cd D:/ocgt_v2.0.2 && go build ./... && go vet ./...`
Expected: PASS

---

### Task 3: 前端 — Hub 设置面板 2×2 网格

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

- [ ] **Step 1: 修改 Hub 设置面板 HTML**

将 `index.html` 中 Hub 配置字段（约 1152-1169 行）从纵向堆叠改为 2×2 网格：

```html
<div class="settings-panel-row" id="hub-config-fields" style="flex-direction:column;padding-left:52px;">
    <div class="hub-settings-grid">
        <div class="hub-settings-field">
            <label class="sp-row-label" data-i18n="pref_hub_url">Hub 地址</label>
            <input type="text" id="hub-url" placeholder="http://192.168.1.100:17321" class="hub-settings-input">
        </div>
        <div class="hub-settings-field">
            <label class="sp-row-label" data-i18n="pref_hub_secret">同步密钥</label>
            <input type="password" id="hub-secret" placeholder="(留空不修改)" class="hub-settings-input">
        </div>
        <div class="hub-settings-field">
            <label class="sp-row-label" data-i18n="pref_hub_device_name">设备名称</label>
            <input type="text" id="hub-device-name" placeholder="家里台式机" class="hub-settings-input">
        </div>
        <div class="hub-settings-field">
            <label class="sp-row-label" data-i18n="pref_hub_interval">推送间隔（秒）</label>
            <input type="number" id="hub-interval" value="120" min="30" max="1800" class="hub-settings-input">
        </div>
    </div>
</div>
```

- [ ] **Step 2: 添加 CSS 样式**

在 `style.css` 末尾添加：

```css
/* Hub 设置 2×2 网格 */
.hub-settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    width: 100%;
}
.hub-settings-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.hub-settings-input {
    height: 34px;
    padding: 0 10px;
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-0);
    font-size: 12.5px;
    font-family: var(--mono);
    outline: none;
    transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
    width: 100%;
}
.hub-settings-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
}
```

---

### Task 4: 前端 — Hub 主页面增强

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Hub 页面 HTML 增强**

替换 Hub 页面（约 806-847 行），添加 Sync Now 按钮和改进设备列表：

```html
<section class="view" id="view-hub">
    <!-- 连接状态条 + 操作按钮 -->
    <div class="hub-status-bar">
        <span id="hub-status-dot" class="hub-status-dot"></span>
        <span id="hub-status-text" class="hub-status-text" data-i18n="hub_disconnected">未连接</span>
        <span class="hub-device-id" id="hub-device-id-label"></span>
        <div class="hub-actions">
            <button class="btn-secondary btn-sm" id="hub-refresh-btn" onclick="refreshHubDashboard()" title="刷新">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                <span data-i18n="hub_refresh">刷新</span>
            </button>
            <button class="btn-primary btn-sm" id="hub-sync-now-btn" data-i18n="hub_sync_now">立即同步</button>
        </div>
    </div>

    <!-- 汇总统计 -->
    <div class="dashboard-grid">
        <div class="stat-card stat-card-wide">
            ... 原有内容不变 ...
        </div>
        <div class="stat-card stat-card-wide">
            ... 原有内容不变 ...
        </div>
    </div>

    <!-- 设备列表 -->
    <div class="card hub-section">
        <div class="hub-section-header">
            <h3 data-i18n="hub_device_list">在线设备</h3>
            <span class="hub-device-count" id="hub-device-count">0</span>
        </div>
        <div id="hub-devices-list" class="hub-devices-list">
            <span class="hub-empty-hint" data-i18n="hub_no_devices">暂无设备数据</span>
        </div>
    </div>

    <!-- 模型用量分布 -->
    <div class="card hub-section">
        <div class="hub-section-header">
            <h3 data-i18n="hub_model_breakdown">模型用量分布（全部设备）</h3>
        </div>
        <canvas id="hub-model-chart" height="200"></canvas>
    </div>
</section>
```

- [ ] **Step 2: 添加 Sync Now JS 逻辑**

在 `app.js` 的 hub 相关区域添加：

```js
// 立即同步
document.getElementById('hub-sync-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('hub-sync-now-btn');
    const origText = btn.textContent;
    btn.textContent = '同步中...';
    btn.disabled = true;
    try {
        await apiFetch('/ocgt/api/hub/sync', { method: 'POST' });
        toastI18n('hub_sync_success', 'success');
        // 刷新数据
        setTimeout(() => refreshHubDashboard(), 1000);
    } catch (err) {
        toastI18n('hub_sync_failed', 'error');
        console.error('Sync failed:', err);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
});
```

- [ ] **Step 3: 改进 renderHubStats 设备列表渲染**

使用 CSS 类代替内联样式，添加设备计数和更丰富的设备信息：

```js
function renderHubStats(stats) {
    // ... 原有统计卡片逻辑 ...

    // 设备列表
    const listEl = document.getElementById('hub-devices-list');
    const countEl = document.getElementById('hub-device-count');
    const devices = stats.devices || [];
    if (countEl) countEl.textContent = devices.length + ' 台';
    
    if (devices.length === 0) {
        listEl.innerHTML = '<span class="hub-empty-hint">' + (t('hub_no_devices') || '暂无设备数据') + '</span>';
    } else {
        listEl.innerHTML = devices.map(d => {
            const isStale = d.stale;
            const dotColor = isStale ? 'var(--text-2)' : 'var(--green)';
            const statusLabel = isStale ? '离线' : '在线';
            const name = d.displayName || d.deviceId || 'Unknown';
            const dToday = d.today || {};
            const dAllTime = d.allTime || {};
            const todayTokens = dToday.totalTokens || 0;
            const allTimeTokens = dAllTime.totalTokens || 0;
            const hostname = d.hostname || '';
            const lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '';
            return '<div class="hub-device-item">' +
                '<span class="hub-device-dot" style="background:' + dotColor + ';"></span>' +
                '<div class="hub-device-info">' +
                '<div class="hub-device-name">' + escHtml(name) + '</div>' +
                (hostname ? '<div class="hub-device-meta">' + escHtml(hostname) + '</div>' : '') +
                '</div>' +
                '<div class="hub-device-stats">' +
                '<span class="hub-device-today">今日 ' + formatTokens(todayTokens) + '</span>' +
                '<span class="hub-device-total">总计 ' + formatTokens(allTimeTokens) + '</span>' +
                '</div>' +
                '<span class="hub-device-status" data-status="' + (isStale ? 'offline' : 'online') + '">' + statusLabel + '</span>' +
                '</div>';
        }).join('');
    }
    // ... chart ...
}
```

- [ ] **Step 4: 添加 CSS 样式**

```css
/* Hub 状态栏 */
.hub-status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 20px;
}
.hub-status-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-2); flex-shrink: 0;
}
.hub-status-text {
    color: var(--text-1); font-size: 0.9rem;
}
.hub-device-id {
    font-size: 0.8rem; color: var(--text-2);
}
.hub-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
}

/* Hub 区块 */
.hub-section {
    margin-top: 16px; padding: 20px;
}
.hub-section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
}
.hub-section-header h3 {
    font-size: 14px; font-weight: 700; color: var(--text-0);
}
.hub-device-count {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
}
.hub-empty-hint {
    color: var(--text-2); font-size: 13px;
}

/* 设备列表 */
.hub-devices-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.hub-device-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: border-color 0.2s;
}
.hub-device-item:hover {
    border-color: var(--border-hover);
}
.hub-device-dot {
    width: 8px; height: 8px; border-radius: 50%;
    flex-shrink: 0;
}
.hub-device-info {
    flex: 1;
    min-width: 0;
}
.hub-device-name {
    font-weight: 500; color: var(--text-0); font-size: 13px;
}
.hub-device-meta {
    font-size: 11px; color: var(--text-2); margin-top: 2px;
}
.hub-device-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}
.hub-device-today {
    font-size: 11px; color: var(--text-2);
}
.hub-device-total {
    font-size: 12px; color: var(--text-1); font-family: var(--mono);
}
.hub-device-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
}
.hub-device-status[data-status="online"] {
    background: var(--green-soft);
    color: var(--green);
}
.hub-device-status[data-status="offline"] {
    background: rgba(248,113,113,0.1);
    color: var(--text-2);
}
```

---

### Task 5: 前端 — 会话页面增强（搜索/筛选/排序 + 图表 + 详情展开）

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: 添加会话控制栏和模型分布图容器到 HTML**

替换 `view-sessions` 部分（约 850-876 行）：

```html
<section class="view" id="view-sessions">
    <!-- 统计卡片 -->
    <div class="dashboard-grid" id="sessions-stats">
        ... 原有 3 个 stat-card 不变 ...
    </div>

    <!-- 控制栏：搜索 + 筛选 + 排序 -->
    <div class="sessions-control-bar">
        <div class="sessions-search-wrap">
            <svg class="sessions-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="sessions-search" class="sessions-search-input" placeholder="搜索会话 ID 或模型名称..." data-i18n-placeholder="sessions_search_placeholder">
        </div>
        <select id="sessions-model-filter" class="sessions-filter-select">
            <option value="">全部模型</option>
        </select>
        <select id="sessions-sort" class="sessions-filter-select">
            <option value="time-desc" data-i18n="sessions_sort_time_desc">最新在前</option>
            <option value="time-asc" data-i18n="sessions_sort_time_asc">最早在前</option>
            <option value="tokens-desc" data-i18n="sessions_sort_tokens_desc">Token 最多</option>
            <option value="tokens-asc" data-i18n="sessions_sort_tokens_asc">Token 最少</option>
            <option value="cost-desc" data-i18n="sessions_sort_cost_desc">费用最高</option>
        </select>
    </div>

    <!-- 模型分布图 -->
    <div class="card sessions-chart-card" id="sessions-chart-container" style="display:none;">
        <div class="hub-section-header">
            <h3 data-i18n="sessions_model_chart">模型分布</h3>
        </div>
        <canvas id="sessions-model-chart" height="120"></canvas>
    </div>

    <!-- 会话列表 -->
    <div id="sessions-list"></div>

    <!-- 会话详情弹窗 -->
    <div class="modal-overlay" id="sessionDetailOverlay" aria-hidden="true">
        <div class="modal-card session-detail-modal" role="dialog" aria-modal="true">
            <div class="modal-header">
                <h3 id="session-detail-title">会话详情</h3>
                <button class="modal-close" id="sessionDetailClose" aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="modal-body" id="session-detail-body">
                <div id="session-detail-loading" style="text-align:center;padding:40px;color:var(--text-2);">加载中...</div>
                <div id="session-detail-content" style="display:none;"></div>
            </div>
        </div>
    </div>
</section>
```

- [ ] **Step 2: 重构 renderSessions 函数（使用 CSS 类 + 搜索/筛选/排序）**

```js
let allSessionsData = [];

function renderSessions(data) {
    allSessionsData = data.sessions || [];
    applySessionsFilters();
    populateModelFilter();
    renderSessionsChart();
}

function applySessionsFilters() {
    const searchVal = (document.getElementById('sessions-search')?.value || '').toLowerCase();
    const modelFilter = document.getElementById('sessions-model-filter')?.value || '';
    const sortVal = document.getElementById('sessions-sort')?.value || 'time-desc';

    let filtered = allSessionsData.filter(s => {
        if (searchVal && !s.sessionId.toLowerCase().includes(searchVal) && !(s.model || '').toLowerCase().includes(searchVal)) {
            return false;
        }
        if (modelFilter && s.model !== modelFilter) return false;
        return true;
    });

    // 排序
    filtered.sort((a, b) => {
        switch (sortVal) {
            case 'time-asc': return (a.startTime || '').localeCompare(b.startTime || '');
            case 'tokens-desc': return (b.totalTokens || 0) - (a.totalTokens || 0);
            case 'tokens-asc': return (a.totalTokens || 0) - (b.totalTokens || 0);
            case 'cost-desc': return sessionCost(b.model, b.inputTokens, b.outputTokens) - sessionCost(a.model, a.inputTokens, a.outputTokens);
            default: return (b.lastTime || '').localeCompare(a.lastTime || '');
        }
    });

    renderSessionsList(filtered);
    renderSessionsStats(filtered);
}

function renderSessionsList(sessions) {
    const listEl = document.getElementById('sessions-list');
    if (!listEl) return;

    if (sessions.length === 0) {
        listEl.innerHTML = '<div class="sessions-empty">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="sessions-empty-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<div>' + (t('sessions_no_data') || '未找到 Claude Code 会话记录') + '</div>' +
            '<div class="sessions-empty-hint">使用 Claude Code 后会自动产生会话记录</div>' +
            '</div>';
        return;
    }

    listEl.innerHTML = '<div class="sessions-list">' +
        sessions.map(s => {
            const shortId = s.sessionId.length > 12 ? s.sessionId.slice(0, 12) + '…' : s.sessionId;
            const from = s.startTime ? s.startTime.slice(0, 16).replace('T', ' ') : '?';
            const to = s.lastTime ? s.lastTime.slice(0, 16).replace('T', ' ') : '?';
            let durStr = '';
            if (s.startTime && s.lastTime) {
                const t1 = new Date(s.startTime).getTime();
                const t2 = new Date(s.lastTime).getTime();
                if (t1 && t2 && t2 > t1) {
                    const min = Math.round((t2 - t1) / 60000);
                    durStr = min >= 60 ? (Math.floor(min / 60) + 'h ' + (min % 60) + 'm') : min + 'm';
                }
            }
            const maxTokens = sessions.reduce((m, s) => Math.max(m, s.totalTokens || 0), 1);
            const ratio = (s.totalTokens || 0) / maxTokens;
            const dotColor = ratio > 0.5 ? 'var(--red)' : ratio > 0.15 ? 'var(--yellow)' : 'var(--green)';
            const cost = sessionCost(s.model, s.inputTokens, s.outputTokens);
            const modelShort = (s.model || '?').replace(/^claude-/i, '');

            return '<div class="session-card" data-session-id="' + escHtml(s.sessionId) + '">' +
                '<span class="session-dot" style="background:' + dotColor + ';"></span>' +
                '<div class="session-card-body">' +
                '<div class="session-card-top">' +
                '<span class="session-id" title="' + escHtml(s.sessionId) + '">' + escHtml(shortId) + '</span>' +
                '<span class="session-model-badge">' + escHtml(modelShort) + '</span>' +
                '<span class="session-duration">' + (durStr ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="session-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + durStr : '') + '</span>' +
                '</div>' +
                '<div class="session-card-meta">' +
                '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="session-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' + s.messageCount + ' 条</span>' +
                '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="session-icon"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' + formatTokens(s.totalTokens) + '</span>' +
                '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="session-icon"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/></svg>$' + cost.toFixed(2) + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="session-card-time">' +
                '<span>' + from + '</span>' +
                '<span>' + to + '</span>' +
                '</div>' +
                '<button class="session-detail-btn" title="查看详情" data-sid="' + escHtml(s.sessionId) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="9 18 15 12 9 6"/></svg>' +
                '</button>' +
                '</div>';
        }).join('') + '</div>';

    // 绑定详情按钮事件
    listEl.querySelectorAll('.session-detail-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSessionDetail(btn.dataset.sid);
        });
    });
}

function renderSessionsStats(sessions) {
    let totalTokens = 0, totalCost = 0, totalMsgs = 0;
    for (const s of sessions) {
        totalTokens += s.totalTokens || 0;
        totalMsgs += s.messageCount || 0;
        totalCost += sessionCost(s.model, s.inputTokens, s.outputTokens);
    }
    const countEl = document.getElementById('sessions-count');
    const totalTokEl = document.getElementById('sessions-total-tokens');
    const totalCostEl = document.getElementById('sessions-total-cost');
    if (countEl) countEl.textContent = sessions.length + ' 个';
    if (totalTokEl) totalTokEl.textContent = formatTokens(totalTokens);
    if (totalCostEl) totalCostEl.textContent = '$' + totalCost.toFixed(2);
}
```

- [ ] **Step 3: 模型分布图表**

```js
function renderSessionsChart() {
    const canvas = document.getElementById('sessions-model-chart');
    if (!canvas) return;
    const container = document.getElementById('sessions-chart-container');
    
    // 按模型聚合
    const modelCounts = {};
    for (const s of allSessionsData) {
        const m = s.model || 'unknown';
        modelCounts[m] = (modelCounts[m] || 0) + 1;
    }
    const labels = Object.keys(modelCounts);
    if (labels.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    
    if (window.__sessionsChart) window.__sessionsChart.destroy();
    
    const colors = ['#34d399','#60a5fa','#fbbf24','#f87171','#a78bfa','#fb923c','#22d3ee','#e879f9'];
    window.__sessionsChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels.map(m => m.replace(/^claude-/i, '')),
            datasets: [{
                data: labels.map(m => modelCounts[m]),
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 }
                }
            },
            cutout: '55%'
        }
    });
}
```

- [ ] **Step 4: 搜索/筛选绑定 + 详情弹窗**

```js
// 搜索输入防抖
let sessionsFilterTimer;
document.getElementById('sessions-search')?.addEventListener('input', () => {
    clearTimeout(sessionsFilterTimer);
    sessionsFilterTimer = setTimeout(applySessionsFilters, 200);
});
document.getElementById('sessions-model-filter')?.addEventListener('change', applySessionsFilters);
document.getElementById('sessions-sort')?.addEventListener('change', applySessionsFilters);

// 详情弹窗
async function openSessionDetail(sessionId) {
    const overlay = document.getElementById('sessionDetailOverlay');
    const loading = document.getElementById('session-detail-loading');
    const content = document.getElementById('session-detail-content');
    const title = document.getElementById('session-detail-title');
    if (!overlay || !loading || !content) return;
    
    overlay.classList.add('active');
    loading.style.display = '';
    content.style.display = 'none';
    title.textContent = '会话: ' + sessionId;
    
    try {
        const resp = await apiFetch('/ocgt/api/sessions?id=' + encodeURIComponent(sessionId));
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        renderSessionDetail(data, content);
    } catch (err) {
        content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">加载失败: ' + escHtml(err.message) + '</div>';
    } finally {
        loading.style.display = 'none';
        content.style.display = '';
    }
}

function renderSessionDetail(data, container) {
    const events = data.events || [];
    // 分组: user 事件作为 exchange 边界
    let html = '<div class="session-detail-exchanges">';
    let currentExchange = null;
    let exchangeIdx = 0;
    
    for (const evt of events) {
        if (evt.type === 'user') {
            if (currentExchange) {
                html += currentExchange;
            }
            currentExchange = '<div class="sd-exchange">' +
                '<div class="sd-exchange-head" onclick="toggleExchange(this)">' +
                '<span class="sd-chevron">▶</span>' +
                '<span class="sd-role-badge sd-role-user">你</span>' +
                '<span class="sd-exchange-time">' + formatEventTime(evt.timestamp) + '</span>' +
                '</div>' +
                '<div class="sd-exchange-body" style="display:none;">';
            exchangeIdx++;
        } else if (evt.type === 'assistant' && currentExchange) {
            const usage = evt.message?.usage || {};
            const inTok = usage.input_tokens || 0;
            const outTok = usage.output_tokens || 0;
            const model = evt.message?.model || '';
            currentExchange += '<div class="sd-turn">' +
                '<div class="sd-turn-header">' +
                '<span class="sd-role-badge sd-role-ai">AI</span>' +
                '<span class="sd-turn-model">' + escHtml(model) + '</span>' +
                '</div>' +
                '<div class="sd-turn-tokens">' +
                '↘ 输入 ' + inTok + ' · ↗ 输出 ' + outTok +
                '</div>' +
                '</div>';
        }
    }
    if (currentExchange) html += currentExchange;
    html += '</div>';
    
    if (events.length === 0) {
        html = '<div class="sd-empty">无事件数据</div>';
    }
    container.innerHTML = html;
}

function toggleExchange(head) {
    const body = head.nextElementSibling;
    const chevron = head.querySelector('.sd-chevron');
    if (body && chevron) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        chevron.textContent = isHidden ? '▼' : '▶';
        // 关闭其他已展开的
        if (isHidden) {
            head.closest('.session-detail-exchanges')?.querySelectorAll('.sd-exchange-body')?.forEach(b => {
                if (b !== body) { b.style.display = 'none'; b.parentElement.querySelector('.sd-chevron').textContent = '▶'; }
            });
        }
    }
}

function formatEventTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 5: 添加 CSS**

```css
/* 会话控制栏 */
.sessions-control-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 0;
}
.sessions-search-wrap {
    position: relative;
    flex: 1;
    max-width: 320px;
}
.sessions-search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 15px;
    height: 15px;
    color: var(--text-2);
    pointer-events: none;
}
.sessions-search-input {
    width: 100%;
    height: 34px;
    padding: 0 10px 0 32px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-0);
    font-size: 12.5px;
    font-family: var(--sans);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
}
.sessions-search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
}
.sessions-search-input::placeholder {
    color: var(--text-2);
}
.sessions-filter-select {
    height: 34px;
    padding: 0 28px 0 10px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-1);
    font-size: 12px;
    font-family: var(--sans);
    outline: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    min-width: 120px;
}
.sessions-filter-select:focus {
    border-color: var(--accent);
}
.session-chart-card { margin-top: 16px; padding: 20px; }

/* 会话列表 */
.sessions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.session-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: all 0.2s var(--ease);
    cursor: pointer;
}
.session-card:hover {
    border-color: var(--border-hover);
    box-shadow: var(--shadow);
    transform: translateY(-1px);
}
.session-dot {
    width: 10px; height: 10px; border-radius: 50%;
    flex-shrink: 0; opacity: 0.8;
}
.session-card-body {
    flex: 1;
    min-width: 0;
}
.session-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.session-id {
    font-weight: 600; color: var(--text-0); font-size: 0.9rem;
    font-family: var(--mono); cursor: default;
}
.session-model-badge {
    font-size: 0.7rem;
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
}
.session-duration {
    font-size: 0.75rem;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 3px;
}
.session-card-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 6px;
    font-size: 0.8rem;
    color: var(--text-2);
    flex-wrap: wrap;
}
.session-card-meta span {
    display: flex;
    align-items: center;
    gap: 4px;
}
.session-icon {
    width: 13px; height: 13px;
    flex-shrink: 0;
    opacity: 0.6;
}
.session-card-time {
    text-align: right;
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-2);
    line-height: 1.4;
}
.session-detail-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    cursor: pointer;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
}
.session-detail-btn:hover {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent-glow);
}

/* 空状态 */
.sessions-empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-2);
}
.sessions-empty-icon {
    width: 48px; height: 48px;
    opacity: 0.3;
    margin-bottom: 12px;
}
.sessions-empty-hint {
    font-size: 0.8rem; margin-top: 6px; opacity: 0.6;
}

/* 会话详情弹窗 */
.session-detail-modal {
    width: min(680px, 92vw);
    max-height: 80vh;
}
.session-detail-exchanges {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.sd-exchange {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
}
.sd-exchange-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    background: var(--surface);
    transition: background 0.15s;
}
.sd-exchange-head:hover {
    background: var(--surface-hover);
}
.sd-chevron {
    font-size: 10px;
    color: var(--text-2);
    width: 12px;
    flex-shrink: 0;
}
.sd-role-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 8px;
}
.sd-role-user {
    background: var(--accent-soft);
    color: var(--accent-text);
}
.sd-role-ai {
    background: rgba(52,211,153,0.15);
    color: var(--green);
}
.sd-exchange-time {
    font-size: 11px;
    color: var(--text-2);
    margin-left: auto;
}
.sd-exchange-body {
    padding: 8px 14px 14px 36px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.sd-turn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border);
}
.sd-turn-header {
    display: flex;
    align-items: center;
    gap: 8px;
}
.sd-turn-model {
    font-size: 11px;
    color: var(--text-2);
    font-family: var(--mono);
}
.sd-turn-tokens {
    font-size: 11px;
    color: var(--text-2);
    font-family: var(--mono);
}
.sd-empty {
    text-align: center;
    padding: 40px;
    color: var(--text-2);
}
```

- [ ] **Step 6: i18n 词条添加**

在 app.js 的 zh/en i18n 对象中添加：

```js
// zh:
sessions_search_placeholder: "搜索会话 ID 或模型名称...",
sessions_sort_time_desc: "最新在前",
sessions_sort_time_asc: "最早在前",
sessions_sort_tokens_desc: "Token 最多",
sessions_sort_tokens_asc: "Token 最少",
sessions_sort_cost_desc: "费用最高",
sessions_model_chart: "模型分布",
hub_refresh: "刷新",
hub_sync_now: "立即同步",
hub_sync_success: "同步成功",
hub_sync_failed: "同步失败",

// en:
sessions_search_placeholder: "Search session ID or model...",
sessions_sort_time_desc: "Newest First",
sessions_sort_time_asc: "Oldest First",  
sessions_sort_tokens_desc: "Most Tokens",
sessions_sort_tokens_asc: "Fewest Tokens",
sessions_sort_cost_desc: "Highest Cost",
sessions_model_chart: "Model Distribution",
hub_refresh: "Refresh",
hub_sync_now: "Sync Now",
hub_sync_success: "Sync successful",
hub_sync_failed: "Sync failed",
```

---

### Task 6: 修复 IsValidView 缺少 sessions

**Files:**
- Modify: `internal/preferences/preferences.go:216-222`

- [ ] **Step 1: 添加 "sessions" 到验证列表**

```go
func IsValidView(value string) bool {
    switch value {
    case "dashboard", "settings", "terminal", "history", "traffic-detail", "hub", "sessions":
        return true
    default:
        return false
    }
}
```

---

### Task 7: 编译 + 测试验证

- [ ] **Step 1: 编译**

```bash
cd D:/ocgt_v2.0.2 && go build ./... && go vet ./...
```

- [ ] **Step 2: 运行测试**

```bash
go test ./internal/session/... ./internal/hub/... -v
```

- [ ] **Step 3: Wails 构建**

```bash
cd D:/ocgt_v2.0.2 && wails build -clean -platform windows/amd64
```
