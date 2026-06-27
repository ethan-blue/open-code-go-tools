# ocgt 重构计划

## Sprint 1: 仓库清理 + 代码健康 (安全、可逆)
> 目标：清掉垃圾、统一重复代码、修复测试 hang，不改变任何运行时行为

### 1.1 仓库清理
- 删除 `frontend/111111/` 目录
- 删除根目录 Python 脚本：`clean_docs.py`, `extract_missing_css.py`, `update_docs.py`
- 删除 `AI_EXECUTION_PROMPT.md`
- 将 `frontend/dist/`, `frontend/package.json.md5` 加入 .gitignore
- 将 `*.md5` 加入 .gitignore
- 将 `frontend/111111/` 加入 .gitignore（防止再次出现）
- 处理已暂存的删除：`append_missing_css.py`, `compare_css.py`, `missing_components.css`, `patch_app.py`

### 1.2 统一 atomicwrite.go
- 保留 `internal/fileutil/atomicwrite.go` 作为唯一实现
- 删除 `./atomicwrite.go`（根目录）、`internal/config/atomicwrite.go`、`internal/preferences/atomicwrite.go`
- 将所有引用改为 `fileutil.AtomicWrite`
- 确认编译通过

### 1.3 修复 panic → error
- `internal/hub/client.go:290` — 将 `panic()` 改为返回 error

### 1.4 修复 proxy 测试 timeout
- 给 proxy_test.go 中的集成测试加 context timeout
- 确保测试在 30s 内完成

### 1.5 提交 untracked 测试文件
- `internal/providers/providers_test.go` 已经写好，git add 并确认通过

## Sprint 2: God File 拆分 (中等风险)
> 目标：将超大文件拆成逻辑清晰的多个文件，不改 API/行为

### 2.1 拆分 handler.go (1900行 → 多文件)
- `routes.go` — Handler() 路由注册 + ensurePortAvailable
- `middleware.go` — authMiddleware, rateLimitMiddleware, rpmLimitMiddleware, securityHeadersMiddleware, requestLogger
- `api_handlers.go` — apiStatus, apiProfiles, apiHistory, apiQuota 等 /ocgt/api/* handler
- `proxy_core.go` — messages, models, countTokens, profile, health 等核心代理逻辑
- `static.go` — serveStatic

### 2.2 拆分 app.go (1389行 → 多文件)
- `app_tray.go` — tray 相关（setupTray, trayAction 处理）
- `app_window.go` — showMainWindow, hideMainWindow, beforeClose, RequestClose, QuitApp
- `app_config.go` — OpenConfigLocation, SavePreferences, SaveUIPreferences, GetPreferences
- `app_env.go` — setUserEnvironment, syncClaudeSettings, Claude 环境变量管理
- app.go 只保留 App struct 定义和 NewApp

## Sprint 3: CI/CD + 质量保障 (增量)
> 目标：建立持续质量门禁

### 3.1 CI test workflow
- 新增 `.github/workflows/ci.yml`
- PR/push 触发：go vet + go test + frontend build check

### 3.2 golangci-lint
- 添加 `.golangci.yml` 配置
- 启用：errcheck, govet, staticcheck, ineffassign, unused

### 3.3 前端基础保障
- 确认 `npm run build` 通过
- 添加 TypeScript 类型检查到 CI
