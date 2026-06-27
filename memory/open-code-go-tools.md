---
name: open-code-go-tools
description: Team project - ocgt desktop client, Go + Wails v2, Bram = code implementation
metadata:
  type: project
---

## 项目：open-code-go-tools (ocgt)

**仓库**：https://github.com/ethan-blue/open-code-go-tools.git
**分支**：refactor/v4-ui-design（UI 重设计分支，SHA 657c1f3）

**技术栈**：
- 后端：Go + Wails v2
- 前端：HTML + CSS + JS 单页应用
- 构建：Wails dev / wails build

**项目功能**：
- 本地代理：Anthropic ↔ OpenAI 协议转换
- 配置管理：API Key、模型映射、思考强度
- 流量监控：Token/请求数/成功率/延迟统计
- 快速连接：CLI/VS Code/Claude Desktop 集成
- Hub 跨设备同步
- 会话记录查看

**团队分工**：
- 🔧 Bram（我）：代码实现
- 🎨 Iris：UI 设计
- 🏗️ Orion：架构梳理
- 🔍 Atlas：需求研究
- 🛠️ Forge：构建部署
- ✅ Sentinel：质量保障

**UI 风格**：Geist-like 暗色卡片风格，双栏布局

**设计系统**：
- 参考：Linear, Raycast, Vercel Dashboard
- 色彩：Surface Tiers (bg-0/1/2/3), Text Tiers (text-0/1/2/3), Accent System (HSL 可旋转)
- 字体：Inter (UI) + JetBrains Mono (数据)
- 间距：4px 网格系统，卡片 20px 内边距
- 圆角：4px/6px/8px/12px/16px
- 阴影：barely-there 风格
- 动画：200ms ease-out
- 响应式：≥1200px (3-4列), 900-1199px (2列), <900px (1列)

**Status as of 2026-06-27**：
- ✅ Bram 通过 HTTP 下载成功获得 main 和 v4-ui-design 分支代码
- ✅ 已熟悉项目结构和技术栈
- v4-ui-design 分支前端已迁移到 React + TypeScript + Vite
- 新增 9 个页面和 8 个组件
- ✅ 开发环境设置完成（npm install + npm run build）
- ✅ 已完成 UI_AUDIT.md 中的所有关键任务：
  1. Command Palette (⌘K) — 已存在并正确集成
  2. Account Popover — 已存在并正确集成
  3. Design Footer (#footprint) — 已集成到 Dashboard
  4. TrafficDetail 瀑布流 — 已添加 6 步瀑布流时间线
  5. Dashboard 统计卡片增量显示 — 已实现
  6. Toast 退出动画 — 已实现
  7. CSS .modal-overlay 冲突 — 已检查，无冲突
- ✅ 前端构建成功，无错误
- ✅ 已与 Iris 对齐 React 组件实现方案：
  - CSS 变量 + v4-design.css 类名 + cn() 工具函数
  - 新增组件样式加到 v4-design.css 末尾
  - 类名命名遵循现有模式
  - 组件状态用 class 控制
- ✅ 已与 Atlas 对齐需求梳理（Command Palette 已存在，AI Copilot 未接 LLM）
- ✅ 已与 Forge 对齐构建配置（CI 缺口已分析，PR workflow 已建好）
- ✅ 已收到 Iris 的 spec 文档（v4-design-spec.md、v4-component-specs.md、v4-design-tokens-quickref.md）
- ✅ 已回复 Atlas 的需求研究报告（确认 Command Palette 已存在，macOS 适配已完成）
- ✅ 已搭建 Vitest + Testing Library 基础设施
- ✅ P0 完成！前端测试用例（75 个测试全部通过）：
  - CommandPalette：9 个测试
  - AccountPopover：8 个测试
  - DesignFootprint：9 个测试
  - OnboardingWizard：11 个测试
  - Toast：8 个测试
  - ShortcutsModal：11 个测试
  - NotificationDrawer：6 个测试
  - UpgradeModal：9 个测试
  - ErrorBoundary：4 个测试
- ✅ 已完成所有硬编码颜色修复（20/20）：
  - HIGH：Providers.tsx, EnvironmentSection.tsx, NetworkSection.tsx
  - MEDIUM：TrafficMonitor.tsx (5处), QuickConnect.tsx, App.tsx, Hub.tsx
- ✅ Sentinel 设计合规审查通过
- ✅ 设计规范违规清零
- ✅ Nova 任务分配确认：P0（测试）、P1（app.go 拆分）、P2（handler.go 重构）
- ✅ P1 完成！app.go 拆分为 6 个文件（40 个函数）：
  - app.go（320行）— 8 个函数，窗口管理 + 偏好设置 + Quota
  - lifecycle.go（290行）— 7 个函数，App struct + 生命周期
  - gui_config.go（223行）— 6 个函数，GUI API 绑定
  - integration.go（166行）— 7 个函数，集成管理
  - terminal.go（297行）— 7 个函数，终端启动
  - settings_sync.go（159行）— 5 个函数，settings 同步
- ✅ Forge 检查完成：import 完整、函数边界正确、gui_config.go 闭合括号已修复
- ✅ 与 Orion 确认 handler.go 拆分方案（8 个文件）
- ✅ P1 Push 成功！分支 `refactor/app-go-split` 已推送到远程
- ⏳ 等待 CI 验证（go build + go vet）

**Why:** 这是当前团队的核心项目，Ethan 指示全员聚焦 24 小时工作。
**How to apply:** 代码实现时参考 UI_GUIDELINES.md 和 Iris 的设计规范。协调 Atlas 获取需求细节。

**Config Refactoring Progress (2026-06-27)**:
- ✅ Step 1: profiles.go (L2 user config) — ProfilesConfig, Profile, Preset, BuiltInPresets
- ✅ Step 2: hub.go (L4 Hub config) — HubConfig
- ✅ Step 3: migrate.go (migration logic) — MigrateLegacyConfig, NeedsMigration, EnsureMigration
- ✅ Step 4: config.go (auto-migration) — Load() calls EnsureMigration()
- ✅ Step 5: handler.go (system-info endpoint) — /ocgt/api/system-info
- ⏳ Step 6: app.go / gui_config.go — update config read/write calls
- ⏳ Step 7: tests — update + new
