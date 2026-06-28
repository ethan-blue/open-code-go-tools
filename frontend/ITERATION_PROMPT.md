# OCGT v4 UI — 持续打磨迭代 Prompt

## 项目概述

你是一个前端 UI 工程师，负责将 OCGT (Open Code Go Tools) 的 React 前端打磨到与设计稿 100% 一致。

**仓库**: `D:\tmp\open-code-go-tools`
**分支**: `refactor/v4-ui-design`
**技术栈**: React 19 + TypeScript + Vite + 纯 CSS（无 Tailwind）
**设计稿**: `frontend/111111/index (1).html`（2101 行，完整的 v4 设计参考）
**CSS 系统**: `frontend/src/styles/v4-design.css`（Ink 色阶、Geist 字体）
**构建命令**: `cd frontend && npm run build`

## 核心原则

1. **设计稿是唯一真相** — 所有样式、布局、间距、颜色、字体以 `index (1).html` 为准
2. **零 Tailwind** — 只用 v4-design.css 的 class（`.btn`, `.card`, `.tag`, `.stat`, `.set-row` 等）
3. **零网络依赖** — 字体已离线打包在 `public/fonts/`
4. **CSS 变量统一** — 只用 `--ink-*`, `--line`, `--paper`, `--surface`, `--online`, `--warn`, `--danger`, `--link`, `--violet`
5. **每次改动后必须 `npm run build` 通过**

## 迭代任务清单

按优先级从高到低，每次迭代完成 1-3 个任务，提交并推送。

### P0 — 结构性差距（必须修复）

#### 1. Command Palette（⌘K 搜索面板）
设计稿有完整的 command palette（`#palette`, `.cmd`），包含：
- 搜索输入框 + ESC 提示
- Navigate 分组（Dashboard, Traffic, Sessions, Settings）
- Actions 分组（Restart proxy, Switch profile, Export, Toggle theme）
- 键盘导航（↑↓ 选择，Enter 执行）
- 背景模糊遮罩

**当前状态**: React 版只有 ShortcutsModal（快捷键列表），没有 command palette。
**修复**: 创建 `components/CommandPalette.tsx`，用 `.cmd` CSS class，接入路由切换。

#### 2. Traffic 页面 — 完整的图表
设计稿有：
- SVG 面积图（input/output tokens 趋势，带渐变填充、数据点、hover 标记）
- 圆环图（模型分布，中心数字 + 图例）
- 客户端延迟表（p50, p95, Cost 列）
- 最近请求表（Time, ID, Client, Model, In, Out, Latency, Status + 分页）

**当前状态**: 已有基础结构，但图表可能是占位符。
**修复**: 确保 SVG 图表使用真实 API 数据渲染，圆环图有百分比计算。

#### 3. Sessions — 完整的 list-detail 布局
设计稿有：
- 左侧 340px session 列表（标题、时间、预览、标签）
- 右侧 session 详情（面包屑、serif 标题、消息气泡）
- 消息角色颜色：user=绿、assistant=蓝、tool=琥珀

**当前状态**: 已重写为 list-detail，但需验证消息气泡样式。
**修复**: 确认 `.session-detail .msg .role .pill` 的 user/assistant/tool 颜色正确。

### P1 — 视觉细节（应该修复）

#### 4. Dashboard 统计卡片
设计稿的 stat 卡片有：
- `.lbl` 标签 + 在线状态点
- `.v` 大数字（mono 字体）
- `.delta` 百分比变化（↑ 12.4%）
- `.foot` 底部信息行

**修复**: 确保每个 stat 卡片都有 delta 百分比（即使数据为 0 也要显示格式）。

#### 5. Dashboard 集成列表
设计稿的 integ-row 有：
- 图标 `.ic`（30x30 圆角方块）
- 名称 + 配置路径（`.nm b` + `.nm span`）
- 状态标签（`.tag green` + `.dot online`）
- 请求计数（mono muted tiny，90px 宽，右对齐）
- 操作按钮

**修复**: 确保请求计数显示在正确位置。

#### 6. Settings — input-wrap prefix/suffix
设计稿中：
- Upstream URL 有 `https://` prefix
- API Key 有 `Keychain` suffix
- Proxy token 有 `copy` suffix

**修复**: 确认 `.input-wrap .prefix` 和 `.input-wrap .suffix` 样式正确渲染。

#### 7. Settings — Theme/Accent/Close 偏好
设计稿中 Preferences 段有：
- Theme: `.segmented` 按钮组（Light/System/Dark）
- Accent: 彩色 `.tag` 标签组（Ink/Blue/Green/Violet/Amber/Red）
- On window close: radio 按钮组

**修复**: 确认这些控件使用正确的 CSS class。

### P2 — 交互体验（可以优化）

#### 8. 侧边栏滚动跟随
设计稿 JS 中有 IntersectionObserver，根据滚动位置自动高亮侧边栏导航项。
**修复**: React 版用单页切换，不需要滚动跟随，但可以添加页面切换动画。

#### 9. Toast 自动消失 + 关闭按钮
设计稿 toast 有关闭按钮和自动消失动画。
**修复**: 确认 toast.tsx 的 `dismiss` 和 `setTimeout` 逻辑正确。

#### 10. 暗色主题
设计稿有完整的 `[data-theme="dark"]` 样式。
**修复**: 确认 v4-design.css 的暗色主题覆盖所有组件。

#### 11. 响应式布局
设计稿有 `@media (max-width:1100px)` 断点。
**修复**: 确认 v4-design.css 的媒体查询生效。

#### 12. 滚动条样式
设计稿有自定义滚动条（5px 宽，圆角，主题适配）。
**修复**: 确认 `::-webkit-scrollbar` 样式在 globals.css 中。

### P3 — 参考其他开源项目

参考以下 GitHub 项目的设计和实现，提取可借鉴的模式：

1. **Linear App** (linear.app 风格)
   - 仓库: https://github.com/calcom/cal.com
   - 借鉴: 极简 sidebar、command palette、keyboard-first 交互

2. **Raycast** (aycast 风格)
   - 仓库: https://github.com/raycast/extensions
   - 借鉴: 搜索面板、列表-detail 布局

3. **Vercel Dashboard**
   - 仓库: https://github.com/vercel/next.js (dashboard 部分)
   - 借鉴: stat 卡片、图表配色、间距系统

4. **shadcn/ui**
   - 仓库: https://github.com/shadcn-ui/ui
   - 借鉴: 组件 API 设计、主题变量命名

5. **Dub.co**
   - 仓库: https://github.com/dubinc/dub
   - 借鉴: 设置页面布局、表单结构

## 单次迭代流程

```
1. 从任务清单选 1-3 个任务
2. 读取设计稿 index (1).html 对应部分
3. 读取当前 React 实现
4. 对比差距，编写代码
5. npm run build 验证
6. git add + commit + push
7. 更新任务清单状态
8. 重复
```

## 提交规范

```
<type>(ui): <description>

type: refactor / fix / feat / polish / chore
```

示例：
```
feat(ui): add command palette (⌘K) with keyboard navigation
polish(ui): add delta percentages to dashboard stat cards
fix(ui): correct session message bubble role colors
```

## 文件结构

```
frontend/
├── index.html                    # 入口（无 CDN 依赖）
├── src/
│   ├── main.tsx                  # 入口（导入 fonts.css + v4-design.css + globals.css）
│   ├── App.tsx                   # Shell（标题栏 + 侧边栏 + 顶栏 + 页面路由）
│   ├── lib/
│   │   ├── platform.ts           # OS 检测（Windows/macOS/Linux）
│   │   ├── utils.ts              # cn() + 格式化工具
│   │   └── wails.ts              # Wails API 桥接
│   ├── components/
│   │   ├── ui.tsx                # 基础组件（Button/Card/Badge/Input/Select/Toggle）
│   │   ├── ShortcutsModal.tsx    # 快捷键弹窗
│   │   ├── NotificationDrawer.tsx # 通知抽屉
│   │   ├── UpgradeModal.tsx      # 升级弹窗
│   │   └── OnboardingWizard.tsx  # 引导向导
│   ├── pages/
│   │   ├── Dashboard.tsx         # 页 1 — 系统状态
│   │   ├── QuickConnect.tsx      # 页 2 — 快速连接
│   │   ├── TrafficMonitor.tsx    # 页 3 — 流量监控
│   │   ├── TrafficDetail.tsx     # 页 3.5 — 请求详情
│   │   ├── Sessions.tsx          # 页 4 — 会话
│   │   ├── Copilot.tsx           # 页 5 — AI 副驾驶
│   │   ├── Hub.tsx               # 页 6 — 多设备同步
│   │   └── SettingsPage.tsx      # 页 7 — 配置管理
│   ├── hooks/
│   │   └── toast.tsx             # Toast 通知
│   ├── i18n/
│   │   └── index.tsx             # 国际化
│   └── styles/
│       ├── fonts.css             # @font-face（Geist + Instrument Serif）
│       ├── v4-design.css         # 主题变量 + 所有组件样式
│       └── globals.css           # 基础重置 + modal/loading/toast 样式
├── public/
│   └── fonts/                    # 离线字体文件
└── 111111/
    └── index (1).html            # 设计稿参考（2101 行）
```

## 质量标准

- [ ] `npm run build` 零错误零警告
- [ ] 零 Tailwind class
- [ ] 零旧 CSS 变量（`--border`, `--bg-*`, `--text-*`）
- [ ] 零网络字体依赖
- [ ] 所有页面与设计稿结构一致
- [ ] 所有 CSS class 在 v4-design.css 中有定义
- [ ] 暗色主题完整覆盖
- [ ] 所有交互（hover/active/focus）状态正确
