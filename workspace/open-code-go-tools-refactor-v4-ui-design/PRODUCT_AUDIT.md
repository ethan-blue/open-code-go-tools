# PRODUCT_AUDIT

## 1. 产品定义
- **产品名称**: open-code-go-tools (OCGT)
- **产品类型**: 跨平台桌面客户端 (基于 Wails v2 + React 18 + Go 1.21+)
- **定位**: 本地 AI API 路由代理与管理中枢，专门优化上游多模型服务并以“透明直连（PassThrough）”的形式向本地开发工具提供低延迟、无损耗的 API 网关。

## 2. 核心技术栈
- **前端**: React, TypeScript, Vite, Tailwind-free (使用一套 v4-design.css 现代卡片式风格设计)
- **后端**: Go, Wails Runtime, HTTP 代理路由器 (Sing-box 内核或自定义 Proxy)
- **存储与配置**: 本地 JSON 文件持久化，支持配置导入/导出。

## 3. 已发现的问题与半成品模块
### 前端 (TypeScript/React)
- **API 代理配置 (ApiSection.tsx)**: 「测试连接」、「复制 Token」与「替换」按钮目前缺乏真实的后端交互和 UI 状态反馈。
- **安全设置 (SecuritySection.tsx)**: 包含限流、密码验证的开关处于硬编码或挂空挡状态，未接入表单 `FormState`，亦未接入配置保存。
- **Lint 校验**: `npm run lint` 存在格式/规范报错。

### 后端 (Go)
- **构建依赖**: 单机环境需要补齐 Go 执行环境（目前已在 `/tmp` 手动部署 Go 1.21.8 规避）。
- **测试用例**: 部分集成测试可能由于缺少 Wails 运行上下文或显示服务，直接运行 `go test ./...` 挂起超时，需要指定 `-short` 或运行核心包的纯单元测试。
