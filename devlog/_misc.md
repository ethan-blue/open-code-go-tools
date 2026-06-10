## 2026-06-02 11:20: app.go — 新增 Wails FetchQuota 绑定
- **文件:** `app.go` — Wails FetchQuota 绑定
- **原因:** 新增额度监控模块后需暴露给前端
- **决策:** 参考 @yinxe/opencode-tui-usage 的 RPC 调用逻辑

## 2026-06-02 12:10: 版本号统一更新至 2.0.2
- **文件:** `wails.json` — productVersion: 2.0.1 → 2.0.2
- **原因:** 修复 Bug + 新增额度监控功能后需标记版本
- **影响:** 无功能影响；对应 internal/version/version.go 和 frontend/app.js 同步更新

## 2026-06-02 14:30-15:00: app.go — FetchQuota + resolveQuotaCredentials
- **文件:** `app.go` — FetchQuota + resolveQuotaCredentials
- **原因:** 原版缺额度看板
- **决策:** 凭据优先级：Profile 配置 → 环境变量

## 2026-06-02 17:20: 设计文档 — 流量监控页 UI 方案
- **文件:** `设计文档-流量监控页UI方案.html` — 多巴胺配色 UI 方案
- **原因:** 流量监控页设计前置
- **决策:** 多巴胺配色独立于主题色

## 2026-06-03 02:00: 启动失败通过 Wails 事件通知前端
- **文件:** `app.go`
- **原因:** 后端 proxy 启动失败 goroutine 静默退出，前端完全不知情
- **决策:** `startup()` goroutine 中所有错误路径调用 `wailsruntime.EventsEmit` 发 `proxy-error` 事件
- **影响范围:** 启动失败时前端能立即看到具体错误原因

## 2026-06-10 15:20: 更新 README 描述和已知限制
- **文件:** `README.md`
- **原因:** 已知限制中关于 cache 字段的说明已过时（现已支持 OpenAI 路径的 cache 捕获）；项目描述可更精炼；构建命令修正
- **决策:** 删除过时的"cache 始终为 0"限制，改为缓存统计依赖上游；费用说明改为"基于官方预估定价表，与官方账单可能有出入，仅供参考"；构建命令从 build.bat 改为 wails build
- **影响范围:** 仅 README.md

## 2026-06-10 16:00: 版本号更新 v0.2.2 → v0.2.3 + 发布说明更新
- **文件:**
  - `internal/version/version.go` — 0.2.2 → 0.2.3
  - `wails.json` — productVersion 2.0.2 → 2.0.3
  - `frontend/app.js` — APP_VERSION v2.0.2 → v2.0.3
  - `RELEASE_NOTES.md` — 新增 v2.0.3 中英文发布说明（修复清单）
  - `RELEASE_NOTE.txt` — 更新为 v2.0.3
- **原因:** 本次会话完成了多项 Bug 修复，需标记版本并更新发布说明
- **影响范围:** 仅版本号和文档
