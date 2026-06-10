## 2026-06-02 11:20: 新增 OpenCode Go 套餐额度监控 — 前端
- **文件:**
  - `frontend/app.js` — 前端获取/渲染额度
  - `frontend/index.html` — 额度卡片
  - `frontend/style.css` — 额度进度条样式
  - `frontend/src/wailsjs/go/main/App.d.ts` — TypeScript 类型
  - `frontend/src/wailsjs/go/main/App.js` — JS 绑定
- **原因:** 参考 `@yinxe/opencode-tui-usage`，在 ocgt GUI 显示 Rolling/Weekly/Monthly 额度
- **决策:** 前端通过 Wails `FetchQuota()` 方法调用后端 API

## 2026-06-02 12:10: 版本号更新 — frontend
- **文件:** `frontend/app.js` — APP_VERSION: v2.0.1 → v2.0.2

## 2026-06-02 14:30-15:00: 多项增强 — 前端
- **文件:**
  - `frontend/app.js` — 额度看板渲染 + 设置表单 + 无限制存储天数
  - `frontend/index.html` — 额度卡片 + 设置字段 + retention 0 提示
  - `frontend/style.css` — 额度进度条样式
- **原因:** 原版缺额度看板、存储天数不能无限制
- **决策:** 参考 opencode-tui-usage 实现额度查询；0 = 无限制

## 2026-06-02 17:20: 前端比例条增加 Cache 段 + 流量页设计方案
- **文件:**
  - `frontend/app.js` — 比例条增加 Cache 段
  - `frontend/index.html` — Cache 条元素
  - `frontend/style.css` — Cache 条样式
- **原因:** 流量页设计前置准备
- **决策:** 多巴胺配色独立于主题色

## 2026-06-02 17:35: 流量监控仪表盘前端实现
- **文件:**
  - `frontend/traffic.js` — 新建流量仪表盘 JS (Chart.js + 多巴胺配色)
  - `frontend/index.html` — 替换流量监控页 HTML，引入 Chart.js CDN
  - `frontend/style.css` — 新增仪表盘样式(~130行)
- **决策:** 多巴胺配色独立于主题色；折线图代替柱状图；Y轴自适应
- **影响范围:** 流量页全新 UI；旧 renderHistory 函数安全降级；API 向后兼容

## 2026-06-02 17:47: 分页 + 导出 + 清理旧代码
- **文件:** `frontend/traffic.js`, `frontend/index.html`, `frontend/style.css`, `frontend/app.js`
- **新增:** 分页(每页20条)、CSV导出、清除历史按钮
- **清理:** app.js 移除旧 traffic DOM 引用和 loadHistory 启动调用

## 2026-06-02 18:10: 前端主题自适应 + 加载状态 + 代码清理
- **文件:**
  - `frontend/traffic.js` — 新增主题检测(isDarkMode/chartColors/applyChartTheme)、加载状态(showLoading)、统一图表选项(lineOpts)；移除未使用的 fmtTime/fmtDuration
  - `frontend/index.html` — 新增加载 spinner 和 td-timestamp 显示元素；DOM 结构调整
  - `frontend/style.css` — 新增 td-ts(时间戳)、td-spinner(加载动画)、td-empty(空状态)样式
  - `frontend/app.js` — 旧 loadHistory 轮询改为由 traffic.js 接管
- **原因:** 上一轮开发遗留的未提交改进；亮暗色主题切换时图表颜色需自适应
- **决策:** theme 检测优先 data-theme 属性，其次 matchMedia；全部前端改动不涉及后端
- **影响范围:** 仅前端文件，无 API/后端变更

## 2026-06-03 00:30: 时间范围筛选增强 — 默认今日 + 全部选项 + 历史联动
- **文件:** `frontend/traffic.js`
  - 默认时间范围: 7 日 → 1 日(今日)
  - 新增"全部"按钮(365天)
  - 历史请求 API 调用增加 `days` 参数，与统计图表联动
- **原因:** 用户希望仪表盘默认显示当天数据，且时间范围筛选应覆盖所有模块
- **决策:** 365 作为"全部"的等效值(覆盖所有留存日志)；历史列表 API 也受时间筛选控制

## 2026-06-03 02:00: 启动错误实时反馈 — proxy-error 事件联动 loading 页
- **文件:** `frontend/app.js`
- **原因:** 后端启动失败时前端只能傻等 15s 超时才显示重试按钮
- **决策:** `proxy-error` 事件处理器检测 loading 页是否可见，若可见则立即切换为错误提示+重试按钮
- **影响范围:** 后端启动失败时用户立刻看到具体错误，无需等待 15s

## 2026-06-03 02:30: 修复 app.js 语法错误导致页面永远卡在加载
- **文件:** `frontend/app.js`
- **根因:** `updateTrafficStats` 函数末尾多了一个 `}`，导致整个 `app.js` 解析失败，initializeApp() 等所有 JS 代码均不执行
- **影响范围:** 修复后前端能正常启动，不再卡在"正在连接本地代理"

## 2026-06-03 02:40: 修复 CSS 未闭合注释
- **文件:** `frontend/style.css`
- **根因:** 第 1962 行的 `/*` 缺少配对的 `*/`，导致其后 CSS 规则被注释掉
- **影响范围:** INTEGRATION ROWS 等样式规则恢复正常

## 2026-06-03 10:00: 四项增强 — 流量数据修复 + 快速连接恢复 + 额度美化 + 请求历史优化
- **文件:**
  - `frontend/traffic.js` — 修复 API 基础 URL 从 `window.location.origin` 改为指向代理端口
  - `frontend/app.js` — 额度多巴胺配色、5s 轮询、与 traffic.js 同步代理地址
  - `frontend/index.html` — 新增快速连接页面(CLI一键配置+临时终端)、导航标签改为"快速连接"、请求历史增加导出标签
  - `frontend/style.css` — 配额进度条改用多巴胺渐变色、新增 `--quota-bar-bg` 变量修复浅色模式黑色背景
- **原因:**
  - 流量雷达无数据根因：traffic.js 使用 `window.location.origin`(Wails 前端服务器)而非代理端口(8787)，API 调用全部失败
  - 快速连接页面缺失：v2.0.2 重构时遗漏了 `#view-terminal` HTML 结构，JS/CSS 代码已存在
  - 额度卡片不够多巴胺：配色为 GitHub 风格非多巴胺色板，进度条在浅色模式为黑色
  - 请求历史缺少明确的导出引导
- **决策:** traffic.js 独立维护 `TRAFFIC_API_BASE`，`app.js` 通过 `window.setTrafficApiBase` 同步；额度配色改用 DOPAMINE 色板 (#FF6B6B/#FFE66D/#4ECDC4)；5s 轮询额度；CLI 一键配置复用现有 app_integration.go 的 Wails 绑定

## 2026-06-03 11:00: 修复流量数据请求 URL 双倍叠加 Bug + 移除请求历史模块
- **文件:**
  - `frontend/traffic.js` — 移除 `apiGet` 中的 `TRAFFIC_API_BASE +` 前缀（调用方已通过 `getBaseURL()` 构造完整 URL），同时移除请求历史相关全部函数(200+行)
  - `frontend/index.html` — 移除“请求历史”整个 section
- **根因(流量无数据):** `apiGet` 中写死 `TRAFFIC_API_BASE + path`，但所有调用方已拼接 `getBaseURL() + path`，导致 URL 双倍叠加(如 `http://127.0.0.1:8787http://127.0.0.1:8787/...`)，fetch 全部 TypeError
- **影响范围:** 修正后流量监控各 API 请求 URL 正常，统计数据应正确显示

## 2026-06-03 11:10: 流量监控加载超时保护 + 渲染异常容错
- **文件:** `frontend/traffic.js`
- **原因:** 无数据时页面永远卡在"加载中"；渲染异常导致全部空白
- **决策:** 新增 `safeShowLoading` 10s 超时保护 + API 错误 `{_error}` 区分 + render try-catch

## 2026-06-03 12:00: 修复流量监控 API 请求被 authMiddleware 401 拦截
- **文件:** `frontend/traffic.js`, `frontend/app.js`
- **根因:** `traffic.js` 的 `apiGet` 未发送 `X-Ocgt-Local-Token` 头，而 `app.go` 在 `proxy.New()` 前已生成 auth token 写入配置，`authMiddleware` 始终生效，stats 全部 API 返回 401
- **决策:** `app.js` 获取 token 后写入 `window.LOCAL_AUTH_TOKEN`；`traffic.js` 的 `apiGet` 读取此值并加入请求头
- **影响范围:** 流量监控 all 数据正常显示（确认 5669 条请求可正确返回）

## 2026-06-03 12:30: 修复环形卡片排版 + 预置 auth token 等待
- **文件:**
  - `frontend/index.html` — 删除环形图 canvas 固定 height 和内联 flex 居中样式
  - `frontend/style.css` — 新增 `.td-chart-body-donut` 类: height:240px，上下 padding 调整
  - `frontend/traffic.js` — refreshAll 增加 auth token 等待逻辑
- **原因:** 
  - 环形图整体偏上：canvas 固定 200px 高度在 220px 容器中垂直居中，但 Chart.js legend 在 canvas 底部渲染，导致环形视觉偏上
  - auth token：refreshAll 可能在 token 就绪前调用，导致 API 请求无认证头
- **决策:** 移除 canvas height 属性和 flex 居中，用 `responsive:true` + `maintainAspectRatio:false` 让 Chart.js 自动填充容器；padding 16px 顶部留白；refreshAll 最多等 10 秒 token 就绪

## 2026-06-03 16:14: 新增 Cache 命中率展示
- **文件:** `frontend/traffic.js` — 统计卡片增加"Cache命中率"；模型表 Cache 列增加命中率百分比
- **原因:** Cache 数据已可获取，用户希望直观看到命中率
- **影响范围:** 流量监控仪表盘新增命中率卡片和模型表子信息

## 2026-06-03 16:30: 折线图横轴自适应粒度 — 按时间范围智能分组
- **文件:** `frontend/traffic.js`
- **原因:** 趋势数据按天分组导致折线过于生硬，窄时间范围（如当日）无法看到小时级变化
- **决策:**
  - 新增 `fmtTrendLabel` 按粒度格式化标签（小时→"MM/DD HH:mm"、天→"MM/DD"、周→"MM/DD周"）
  - `renderTokenTrend`/`renderRequestTrend` 接受 `granularity` 参数使用对应标签格式
  - `lineOpts` 新增 `maxTicks` 参数实现横轴刻度自适应密度
  - `refreshAll` 透传 `trendData.granularity` 到渲染函数
- **影响范围:** 流量监控两个折线图的横轴标签随时间范围自动调整；向后兼容（缺失 granularity 时默认 day）

## 2026-06-03 16:45: 折线平滑度优化 — tension 0.3→0.4 + monotone 插值
- **文件:** `frontend/traffic.js`
- **原因:** 折线在数据点之间转折生硬，需要更柔和曲线
- **决策:** 全部 4 条折线的 `tension: 0.3` 提升至 `0.4`，新增 `cubicInterpolationMode: 'monotone'` 防止过冲

## 2026-06-03 17:00: 新增「流量明细」Tab — 分页表格 + 多维筛选 + CSV导出
- **文件:**
  - `frontend/index.html` — 新增导航按钮(Ctrl+5)和 `view-traffic-detail` 视图 HTML
  - `frontend/app.js` — VIEW_VALUES 注册、导航元信息、快捷键映射、切换时触发初始化
  - `frontend/traffic.js` — 完整流量明细逻辑：数据加载/筛选/分页/导出/清除
  - `frontend/style.css` — 新增 `.td-btn`/`.td-btn-danger`/`.td-detail-controls` 样式
- **原因:** 旧版移除的请求历史表格需要恢复并以新 Tab 形式独立呈现
- **决策:**
  - 复用 `/ocgt/api/history` API（内存历史，支持 `days` 参数和 DELETE 清除）
  - 表格字段：时间/模型/状态/Input/Output/Cache/总计/延迟/来源/错误
  - 筛选器：时间范围(今日/7日/30日/全部) + 模型下拉(自动从数据提取) + 状态(成功/4xx/5xx)
  - 分页：每页20条，页面编号跳转，显示总条数和页码
  - 附加功能：CSV 导出(含 BOM 头兼容 Excel)、一键清除历史(confirm 确认)
  - 惰性初始化：首次切换到该 Tab 时绑定控件，后续切换只刷新数据
- **影响范围:** 侧边栏新增第5个 Tab；流量明细与流量监控仪表盘独立，筛选互不干扰

## 2026-06-03 18:00: 修复日志保留天数 0 报错 — 前端验证拦截 0 值
- **文件:** `frontend/app.js` — saveLogPreferences 验证条件
- **根因:** `retention < 1` 将 0（无限制）拦在验证门外，报错 "日志设置保存失败: 1-365"
- **决策:** 改为 `retention < 0`，允许 0 通过验证（后端已正确处理 0 = 永久保存）
- **影响范围:** 日志保留天数输入 0 后可正常保存

## 2026-06-03 18:10: 修复快速连接页面缺失 VS Code / Claude Code settings / Claude Desktop App 集成卡片
- **文件:** `frontend/index.html`
- **原因:** v2.0.2 重构快速连接页面时只恢复了 CLI 和临时终端两张卡片，遗漏了 VS Code、Claude Code settings、Claude Desktop App、一键修复四张卡片。后端 Go 方法和前端 JS 事件处理器已完整实现，但 HTML DOM 元素缺失导致用户无法从 UI 操作这些集成
- **根因:** `view-terminal` 的 `.integrations-stack` 中只保留了两个 integration-row（CLI + 快速开始），其余 3 张卡片（vscode / claude / claude-desktop）和 repair-all 在重构时被移除
- **决策:** 参考旧版 HTML 结构，补全 4 个缺失的 integration-row，保持与 JS 绑定的 ID 一致
- **影响范围:** 快速连接页面现在完整显示全部 5 个集成卡片（一键修复 / 快速开始 / CLI / VS Code / Claude Code settings / Claude Desktop App）

## 2026-06-03 18:30: 清理 app.js 死亡代码 — 旧流量统计函数 + syslog 未完成功能
- **文件:** `frontend/app.js`
- **原因:** 一致性检查发现 app.js 中有大量引用不存在 DOM 元素的死亡代码
- **清理:**
  - 移除旧流量统计 `renderHistory`/`updateTrafficStats`/`parseDurationToMs`/`formatTime`/`statusBadge` 函数（~200 行，traffic.js 重写后的遗留物）
  - 移除 `updateTokenContext` 函数及 3 处调用（引用的 DOM 元素在新版已删除）
  - 移除 `install-env-btn` DOM 缓存（从未使用）
  - 移除 syslog 模态框 JS 代码（HTML 从未创建对应元素，属未完成功能）
- **影响范围:** 仅清理死亡代码，无功能影响。构建验证通过 ✓

## 2026-06-03 19:00: 修复流量监控 Tab 嵌套结构 + 优化快速连接卡片 UI
- **文件:** `frontend/index.html`, `frontend/style.css`
- **修复:** `view-history` HTML 嵌套严重错误（多余 `</div>` + 图表内容在 td-wrap 之外 + 额外闭合标签），导致浏览器解析混乱使 `view-traffic-detail` 无法正确渲染
- **UI 优化:** 集成卡片重新设计 — 间距加大（gap 12→16px）、卡片内边距增加（16/20→18/22px）、图标放大（36→42px）、圆角优化（8→10px）、阴影更细腻、hover 加轻微上浮效果、展开/折叠动画更平滑、新增 `.ic-tip` 辅助文字样式、左下角色标加粗（3→4px）
- **影响范围:** 流量明细 Tab 恢复正常显示；快速连接页面视觉更精致通透

## 2026-06-03 19:30: 修复流量明细无数据 + 优化表格/分页/筛选器样式
- **文件:** `frontend/traffic.js`, `frontend/style.css`
- **根因(无数据):** `loadDetailData()` 未等待 `window.LOCAL_AUTH_TOKEN` 就绪即发起 API 请求，authMiddleware 返回 401。`refreshAll()` 仪表盘有相同等待逻辑但明细 tab 遗漏
- **修复:** `loadDetailData()` 开头增加 auth token 等待循环（最多 10s），与 `refreshAll()` 一致
- **样式优化:**
  - 表格: `border-collapse:separate` + `border-spacing:0` 替代 collapse，圆角 8px 容器，表头 sticky 定位，偶数行浅色斑马纹，hover 红色微光
  - 分页: 按钮加大(30px min)，hover 上浮效果，激活态加红色阴影光晕，间距优化
  - 筛选器: `.td-select` 聚焦态边框变色，`.td-btn` 背景色加深，危险按钮改用柔和红边（非实心红底）
  - `.td-err` 列宽 180→200px
- **影响范围:** 流量明细 Tab 数据正常加载，表格/分页视觉精致度提升

## 2026-06-03 20:00: 流量明细状态码徽标 + 路由显示 + 后现代风格使用指南
- **文件:** `frontend/traffic.js` — 状态码渲染逻辑
- **修复:**
  - 状态码改为圆角徽标样式 (红/绿/橙背景 + 对应文字色)，替代纯文字
  - 模型列增加路由信息 (`route`) 作为辅助行
  - 错误列增加 `title` 属性，hover 可查看完整错误文本
- **影响范围:** 流量明细表格视觉效果显著提升，错误信息可读性改善

## 2026-06-03 17:10: 修复流量明细 — 缺少 td-btn-sm 样式 + 模型筛选残留
- **文件:** `frontend/style.css`, `frontend/traffic.js`
- **原因:** `td-btn-sm` 类在 HTML 中使用但未定义 CSS；切换时间范围后模型筛选可能残留无效值
- **决策:** 新增 `.td-btn-sm` 样式规则；`updateModelFilterOptions` 在模型不在新数据中时自动重置筛选

## 2026-06-10 16:00: 版本号同步更新 v2.0.2 → v2.0.3
- **文件:** `frontend/app.js` — APP_VERSION 更新
- **原因:** 后端版本号升级后前端同步更新显示版本号
