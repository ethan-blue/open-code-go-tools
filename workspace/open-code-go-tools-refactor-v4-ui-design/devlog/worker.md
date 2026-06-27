## 2026-06-18 12:20: Hub Worker 创建 — Cloudflare Worker 跨设备同步
- **文件:**
  - `worker/package.json` — 项目配置
  - `worker/wrangler.toml` — Worker 配置与 Durable Object 绑定
  - `worker/src/index.js` — 完整 Worker + HubDO 实现
- **原因:** 实现 OCGT Hub 跨设备同步功能的服务端组件
- **决策:** 参考 Token Monitor Worker 架构，适配 OCGT 数据模型（PeriodStats 三段式：today/month/allTime，无 sessions/clients 嵌套）。直接覆盖式合并（客户端推送完整快照），而不是增量合并。SSE 通过 HubDO 广播给所有已连接客户端。
- **影响范围:** 新增 `worker/` 目录，不影响现有代码
- **API 端点:**
  - `GET /api/health` — 健康检查（无认证）
  - `POST /api/ingest` — 接收设备推送
  - `GET /api/stats` — 聚合统计
  - `GET /api/stats/stream` — SSE 实时流
  - `GET /api/devices` — 设备列表
  - `DELETE /api/devices/:id` — 删除设备
- **踩坑:** 认证头同时支持 `Authorization: Bearer <secret>` 和 `X-OCGT-Secret` 两种方式

## 2026-06-18 13:36: Worker SSE 格式与 Go Server 一致 + 离线设备标记修复
- **文件:**
  - `worker/src/index.js` — Worker 核心实现
- **原因:** Worker Hub 与 Go Server Hub 返回的 SSE 数据和设备列表格式不一致，导致客户端无法正确解析
- **根因:** Worker SSE 使用了包裹格式 `{type, reason, stats, at}` 而非 Go Server 的直接 `data: <stats_json>` 格式；离线设备被完全排除而非标记 `stale`
- **决策:**
  1. `broadcast()` 和 SSE 流初次写入改为直接 `data: ${JSON.stringify(stats)}\n\n`（与 Go Server 一致）
  2. `getStats()` 不再过滤离线设备，所有设备参与汇总，仅标记 `stale` 字段
  3. `GET /api/devices` 中 `online` 字段替换为 `stale`（与 Go Server 一致）
- **影响范围:** Worker SSE 推送格式、设备统计逻辑、设备列表 API 响应
- **踩坑:** `sseFormat` 函数保留不动，其他 SSE 场景可能仍会用到

## 2026-06-18 14:30: Worker getStats 增加 updatedAt 和设备统计数据字段
- **文件:** `worker/src/index.js`
- **原因:** Worker 的 getStats 返回的设备列表缺少 today/month/allTime 数据，与 Go Server 响应结构不一致，前端无法显示设备级用量
- **影响范围:** Worker /api/stats 和 SSE 响应结构
