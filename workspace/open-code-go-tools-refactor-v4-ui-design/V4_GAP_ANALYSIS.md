# V4 分支不足分析报告（已更新）

> 分析时间: 2026-06-27 | 分支: refactor/v4-ui-design | 最新 commit: 7e69b6d

---

## 修复状态总览

### ✅ 已修复 (P0 — Critical)

| # | 问题 | 修复 commit |
|---|------|------------|
| 1 | `/v1/responses` 非流式返回错误格式 | fc33ad2 — 新增 `forwardResponses` |
| 2 | `/v1/responses` 流式 SSE 事件格式错误 | fc33ad2 — 新增 `streamResponses` |
| 3 | `/v1/responses` 无 usage 统计和历史记录 | fc33ad2 — 非流式和流式都加了 |
| 4 | `/v1/chat/completions` 流式不做 usage 统计 | 6257bec — 新增 `pipeOpenAIStream` |
| 5 | `SavePlugins` Wails binding 缺失 | fc33ad2 — 加到 app.go |
| 6 | `responsesRequest` 缺字段 | fc33ad2 — 加了 Instructions/Tools/Temperature/MaxOutputTokens |
| 7 | 前端 closeBehavior desync | fc33ad2 — 统一用 form.closeBehavior |
| 8 | 前端 NetworkSection 重复 rate-limit 字段 | fc33ad2 — 已移除 |
| 9 | 前端 TrafficMonitor recentRequests 硬编码空 | fc33ad2 — 接入 history API |
| 10 | 12 个 i18n key 缺失 | fc33ad2 — 补齐 |
| 11 | Dead code (_ = client, _ = start) | fc33ad2 — 已清除 |

### ✅ 已修复 (P1 — Tests)

| # | 问题 | 修复 commit |
|---|------|------------|
| 12 | chat/completions 和 responses 端点零测试 | 7e69b6d — 8 个新测试全 PASS |

### 🟡 待处理 (P2 — 后续迭代)

| # | 问题 | 原因 |
|---|------|------|
| 13 | handler.go 仍是 2513 行 God File | 结构重构风险高，适合独立 PR |
| 14 | 配置热重载用 3 秒轮询 | 低优先级，fsinfo 需要跨平台测试 |
| 15 | 前端页面零测试覆盖 | 9 pages + 10 settings sections 工作量大 |
| 16 | REVIEW.md 4 条建议未做 | 首 token 延迟/错误面板/workflow_dispatch/集成测试 |

---

## 验证结果

| 验证项 | 结果 |
|--------|------|
| `go build ./...` | ✅ 通过 |
| `go test ./internal/config/...` | ✅ 通过 |
| `go test ./internal/proxy/... -run TestChat\|TestResponses` | ✅ 8 tests PASS |
| `npx tsc --noEmit` | ✅ 0 errors |
| `vite build` | ✅ 构建成功 |

---

## God File 现状 (handler.go)

2513 行，包含：
- 核心路由 + 中间件 (~170 行)
- Anthropic messages 转发 (~600 行)
- OpenAI chat/completions (~150 行)
- Responses API 转发 (~500 行)
- Dashboard API handlers (~500 行)
- 流式 usage 提取 (~200 行)
- Reasoning 缓存 (~150 行)
- 配置热重载 (~50 行)
- 辅助函数 (~200 行)

建议拆分方案（适合后续 PR）：
- `handler.go` — 路由 + 中间件 (~300 行)
- `messages.go` — Anthropic messages 处理
- `chat_completions.go` — OpenAI chat/completions
- `responses.go` — Responses API
- `dashboard_api.go` — /ocgt/api/* 管理接口
- `reasoning.go` — Reasoning/thinking 内容管理
