# Bram 工作计划 - open-code-go-tools 项目

## 角色
🔧 工程师 (Engineer) — 代码实现

## 当前状态
- **代码拉取**: ✅ 已通过 HTTP 下载获得 main 和 v4-ui-design 分支代码
- **项目理解**: ✅ 已熟悉项目结构和技术栈

## 项目技术栈
- **后端**: Go + Wails v2
- **前端**: React + TypeScript + Vite（v4-ui-design 分支）
- **旧前端**: HTML + CSS + JS（main 分支）

## v4-ui-design 分支新特性
1. **主题系统**: 深色/浅色/系统主题切换，5 种预设强调色
2. **自定义标题栏**: 无边框窗口，可拖拽，窗口控制按钮
3. **键盘快捷键系统**: ⌘1-8 导航，⌘K 命令面板，⌘, 偏好设置
4. **通知中心**: 智能通知（API Key、配额、成本、缓存）
5. **应用内升级**: 升级模态框，Changelog 展示
6. **首次使用向导**: 三步引导流程
7. **AI Copilot 页面**: 自然语言查询，自动洞察，智能操作

## 前端组件结构
### 组件 (frontend/src/components/)
- AccountPopover.tsx
- CommandPalette.tsx
- DesignFootprint.tsx
- ErrorBoundary.tsx
- NotificationDrawer.tsx
- OnboardingWizard.tsx
- ShortcutsModal.tsx
- UpgradeModal.tsx
- ui.tsx（共享 UI 组件）

### 页面 (frontend/src/pages/)
- Copilot.tsx
- Dashboard.tsx
- Hub.tsx
- Providers.tsx
- QuickConnect.tsx
- Sessions.tsx
- SettingsPage.tsx
- TrafficDetail.tsx
- TrafficMonitor.tsx

## 工作计划

### 第一阶段：环境准备 ✅
1. [x] 下载代码（main 和 v4-ui-design 分支）
2. [x] 熟悉项目结构和代码
3. [x] 设置开发环境（npm install）
4. [x] 验证前端构建（npm run build 成功）

### 第二阶段：代码实现 ✅
根据 Atlas 的需求梳理和 Iris 的设计规范进行代码实现：
1. [x] 对照 UI_GUIDELINES.md 实现设计
2. [x] 实现 Geist-like 暗色卡片风格
3. [x] 实现双栏布局
4. [x] 实现状态反馈规范（Loading/Success/Error/Unsaved State）
5. [x] 集成 Design Footer (#footprint)
6. [x] 添加 TrafficDetail 瀑布流时间线
7. [x] 添加 Dashboard 统计卡片增量显示
8. [x] 实现 Toast 退出动画

### 第三阶段：协作
- 与 Atlas 对齐需求细节
- 与 Iris 确认设计实现
- 配合 Sentinel 进行质量保障

## 关键依赖
- Atlas 的需求梳理完成
- Iris 的设计规范确认

## 备注
- **UI 风格**: Geist-like 暗色卡片风格，双栏布局
- **参考文档**: UI_GUIDELINES.md, DESIGN.md
- **构建命令**: `cd frontend && npm run build` + `go build -o ocgt.exe`