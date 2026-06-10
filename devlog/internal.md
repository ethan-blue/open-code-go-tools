## 2026-06-02 11:20: 修复 Token 监控 Bug — 流式 InputTokens 使用估算值
- **文件:** `internal/proxy/streamer.go`, `internal/proxy/handler.go`
- **根因:** `streamOpenAIAsAnthropic` 签名 `func ... (outputTokens int)`，内部解析到上游真实 `PromptTokens` 但丢弃了，历史记录使用字符级估算值
- **决策:** 修改函数签名为 `func ... (outputTokens int, actualInputTokens int)`，调用方使用返回的真实 inputTokens
- **影响范围:** 流式请求(deepseek 等)的 InputTokens 从估算值变为真实值

## 2026-06-02 11:20: 修复 Token 监控 Bug — Messages 端点 Token 记录为 0
- **文件:** `internal/proxy/handler.go`
- **根因:** `forwardAnthropicMessages` 成功响应透传客户端但使用空 `tokenUsage{}`
- **决策:** 非流式先 `io.ReadAll` 解析 Anthropic 响应 `usage` 对象再写客户端；流式新增 `extractUsageFromAnthropicStream` tee 读取 SSE `message_delta` usage
- **影响范围:** minimax-m2.7 等 Messages 端点模型 token 记录有实际数据

## 2026-06-03 12:30: 修复 OpenAI 路径 Cache token 始终为 0
- **文件:**
  - `internal/proxy/types.go` — openAIUsage 增加 prompt_tokens_details 和 Anthropic 原生 cache 字段
  - `internal/proxy/converter.go` — usageFromOpenAI 提取 cache 字段; openAIToAnthropic usage map 包含 cache
  - `internal/proxy/streamer.go` — streamOpenAIAsAnthropic 追踪并返回 cacheRead/cacheCreate tokens
  - `internal/proxy/handler.go` — 流式 OpenAI 路径将 cache tokens 写入历史记录
  - `internal/proxy/proxy_test.go` — 适配新返回签名
- **原因:** 用户反馈监控仪表盘 Cache 字段全为空。大部分模型走 forwardChatCompletions(OpenAI 路径)，该路径未提取 cache token
- **根因:** openAIUsage 结构体只有 prompt_tokens/completion_tokens/total_tokens 三个字段，无 cache 字段；usageFromOpenAI 只返回 Input/Output；streamOpenAIAsAnthropic 不返回 cache tokens
- **决策:** 
  - 新增 promptTokensDetails 结构体捕获 prompt_tokens_details.cached_tokens（DeepSeek/Qwen 等上游返回）
  - 新增 CacheReadInputTokens / CacheCreationInputTokens 捕获 Anthropic 原生 cache 字段（部分上游在 OpenAI 格式也返回）
  - 修改 usageFromOpenAI 按优先级提取 cache（Anthropic 字段 > prompt_tokens_details）
  - 修改 streamOpenAIAsAnthropic 签名增加 cache 返回值，SSE message_delta 包含 cache 字段
  - 不影响 Messages 端点（已正确捕获 cache）
- **影响范围:** 所有使用 OpenAI 路径的模型（deepseek/qwen/glm/kimi/mimo 等）的 cache token 将被记录。依赖上游是否返回 cache 字段
- **踩坑:** streamer.go 缩进使用制表符，Edit 工具多次匹配失败改用 Python 脚本修改

## 2026-06-02 11:20: 已知限制 — Cache 字段始终为 0（已由上述 12:30 提交修复）

## 2026-06-03 13:00: 修复 code-review 发现的 7 个预存问题
- **文件:**
  - `internal/proxy/handler.go` — 断路器接入请求路径; apiRawConfig 增加 LimitReader
  - `app.go` — 配额字段 QuotaCookie/QuotaWorkspaceID 移出 claudeEnvJSON 条件块
  - `internal/fileutil/atomicwrite.go` — 新建共享包，提取公共 AtomicWriteFile
  - `atomicwrite.go` — 委托到 fileutil.AtomicWriteFile
  - `internal/config/atomicwrite.go` — 委托到 fileutil.AtomicWriteFile
  - `internal/preferences/atomicwrite.go` — 委托到 fileutil.AtomicWriteFile
  - `internal/proxy/proxy_test.go` — 两处 json.Unmarshal 增加错误检查
  - `internal/proxy/stats.go` — parseDurationFloat 改用 strconv.ParseFloat + TrimSuffix
  - `internal/proxy/helpers.go` — CORS 源检查改用 url.Parse 精确匹配 host
- **原因:** code-review skill 发现 7 个预存问题，用户要求全部修复
- **决策:**
  - 断路器：请求进入 retry 循环前检查，已跳闸则直接返回 503；retry 内部不再重复检查
  - 配额字段：独立于 claudeEnvJSON 条件块，始终保存
  - LimitReader：与其他处理函数一致，MaxBodySize+1
  - atomicWriteFile：三副本统一提取到 internal/fileutil
  - parseDurationFloat：strconv.ParseFloat + strings.TrimSuffix 替代 fmt.Sscanf
  - CORS：url.Parse 解析 Origin 后精确匹配 host（localhost/127.0.0.1/::1），移除 0.0.0.0
- **影响范围:** 断路器对已跳闸模型的请求立即返回 503（之前会走完全部重试）；CORS 不再允许 0.0.0.0 Origin；其余改动为代码质量提升无外部影响

## 2026-06-03 15:30: 修复 streaming 路径未捕获 prompt_tokens_details 缓存
- **文件:** `internal/proxy/streamer.go` — 在 cache 提取中增加 PromptTokensDetails 兜底
- **原因:** 仪表盘 Cache 显示为 0。调试发现上游返回 prompt_tokens_details.cached_tokens 字段，但 streaming 路径只检查了 cache_read_input_tokens 字段（OpenAI 格式不返回该字段）
- **根因:** 上次提交(00fe266)在 openAIUsage 结构体中增加了 PromptTokensDetails 字段，usageFromOpenAI 函数中正确使用了它，但 streamOpenAIAsAnthropic 函数中忘记用它取值
- **决策:** 在 cacheReadTokens 为 0 时兜底检查 chunk.Usage.PromptTokensDetails.CachedTokens
- **影响范围:** streaming 路径（deepseek/qwen/kimi 等大部分模型）的 Cache 值将正确从上游响应中读取

## 2026-06-03 16:00: 修复 TotalTokens 双倍计算 CacheRead
- **文件:** `internal/proxy/handler.go` — TotalTokens 公式移除 CacheReadTokens
- **原因:** InputTokens 已包含 CacheReadTokens，TotalTokens 再次加入会导致重复计数
- **影响范围:** 修复后仪表盘 Token 总量恢复正确（之前有 cache 时总量虚高 2x）

## 2026-06-03 16:14: 新增 Cache 命中率计算
- **文件:**
  - `internal/proxy/stats.go` — SummaryTotals/ModelStat 增加 CacheHitRate 字段；aggregateStats/modelBreakdown 计算命中率
  - `frontend/traffic.js` — 统计卡片+模型表展示命中率
- **影响范围:** 流量监控仪表盘新增"Cache命中率"卡片，模型表 Cache 列显示命中率百分比

## 2026-06-02 11:20: 新增 OpenCode Go 套餐额度监控模块
- **文件:**
  - `internal/quota/quota.go` — 新建额度查询模块，调用 opencode.ai RPC 端点
  - `internal/proxy/handler.go` — 新增 apiQuota / apiRefreshQuota 路由 + SetQuotaData
  - `internal/proxy/types.go` — Server 增加 quota 字段
  - `internal/proxy/proxy_test.go` — 测试适配新签名
- **原因:** 参考 `@yinxe/opencode-tui-usage` 的 `OpenCodeGoQuotaProvider`
- **决策:** 复制 opencode-tui-usage RPC 调用逻辑；正则解析 rollingUsage/weeklyUsage/monthlyUsage 响应
- **影响范围:** 新增 `/ocgt/api/quota`(GET) 和 `/ocgt/api/quota/refresh`(POST) API

## 2026-06-02 12:10: 版本号更新 — internal/version
- **文件:** `internal/version/version.go`
- **原因:** 修复 Bug + 新增额度功能后需标记版本
- **决策:** version.go: 0.2.1 → 0.2.2

## 2026-06-02 14:30-15:00: 多项增强 — 后端
- **文件:**
  - `internal/proxy/handler.go` — 新增 apiQuota/resolveQuotaCredentials API
  - `internal/quota/quota.go` — OpenCode Go 额度查询模块
  - `internal/config/config.go` — Profile 增加 QuotaCookie/QuotaWorkspaceID 字段
  - `internal/proxy/history_log.go` — 0 表示无限制存储
  - `internal/preferences/preferences.go` — 允许 0 验证
- **原因:** 原版缺额度看板、Token 监控有 Bug、存储天数不能无限制
- **决策:** 参考 opencode-tui-usage 实现额度查询；修复流式/Messages Token 记录；0 = 无限制
- **影响范围:** 新增 `/ocgt/api/quota` 端点；日志可永久保留

## 2026-06-02 17:20: JSONL 统计 API + 定价模块
- **文件:**
  - `internal/proxy/stats.go` — 新增 /summary /trend /models 三个统计 API
  - `internal/pricing/pricing.go` — 模型定价表 + Go 套餐计算 + PlanUsage
  - `internal/proxy/handler.go` — 注册统计路由
- **决策:** 多巴胺配色独立于主题色；Cost 按模型分别计算再求和；JSONL 全量读取
- **影响范围:** 新增 3 个后端统计 API

## 2026-06-02 18:45: 修复模型定价数据 — 全部改用 OpenCode Go 官方定价
- **文件:**
  - `internal/pricing/pricing.go` — 重写全部模型定价(13个模型)，新增缓存定价支持，套餐改为额度限制体系
  - `internal/proxy/stats.go` — EstimateCost 调用增加缓存参数，新增套餐额度计算
- **原因:** 原先的模型定价数据是全凭猜测的错误数据(偏差 2-10 倍)，套餐信息也完全错误
- **决策:** 按用户提供的 OpenCode Go 官方定价表逐一修正；新增 MiMo V2.5/Pro、MiniMax M3；移除 hy3-preview、qwen3.5-plus(不在官方表中)；缓存读写价格一并纳入成本计算
- **影响范围:** 仅 pricing.go 和 stats.go，API 返回的 estimated_cost 和 plan_usage 数据将更准确
- **踩坑:** ModelPrices 的键名需小写匹配，default 兜底使用 DeepSeek V4 Flash 价格而非原来虚高的 $1/$2

## 2026-06-02 19:05: 修复统计 API 字段名不匹配
- **文件:** `internal/proxy/stats.go` — SummaryTotals.EstimatedCost JSON tag `estimated_cost_usd` → `estimated_cost`
- **原因:** Go 端返回 `estimated_cost_usd` 但前端 traffic.js 读取 `estimated_cost`，导致费用卡片始终显示 $0
- **决策:** 统一为 `estimated_cost` 以保持 snake_case 命名一致性
- **影响范围:** 修复后前端 Token 卡片将正确显示估算费用

## 2026-06-02 23:40: 新增端口自动释放功能
- **文件:** `internal/proxy/handler.go` — 新增 ensurePortAvailable/findPIDByPort/killPID 三个方法
- **原因:** 新版启动时若端口被旧版占用，代理启动失败，前端卡在"正在连接本地代理"
- **决策:** 启动前 probe 端口，若被占用则自动查找并 kill 占用进程后重试
- **技术细节:**
  - `net.Listen("tcp", addr)` 探测端口可用性
  - Windows 用 `netstat -ano` 查找 PID，Unix 用 `lsof -ti :PORT`
  - `taskkill /F /PID` (Windows) / `kill -9` (Unix) 杀进程
  - 杀进程后等待 500ms 再验证端口已释放
- **影响范围:** 仅 handler.go，替换旧版时无需手动关进程

## 2026-06-03 00:30: 历史 API 支持时间范围筛选
- **文件:** `internal/proxy/handler.go` — apiHistory GET 新增 `days` 查询参数
- **原因:** 前端时间范围筛选器需要联动历史请求列表
- **决策:** `days>0` 按截断时间过滤记录；`days=0`(无参数)返回全部，向后兼容

## 2026-06-03 01:30: 删除 Fallback 链，改为同模型重试机制
- **文件:**
  - `internal/proxy/handler.go` — `forwardAnthropicMessages` / `forwardChatCompletions`
  - `internal/proxy/proxy_test.go` — `TestFallbackChain` → `TestRetryMechanism`
- **原因:** 实际日志显示所有 fallback 模型全部 502 失败，换模型无用；且循环内 `defer resp.Body.Close()` 有连接泄漏
- **决策:**
  - 重试同一模型最多 5 次，指数退避 0.5s→1s→2s→4s→8s
  - 4xx(除 429)不重试，立即返回
  - 5xx/429/网络错误触发重试
  - `defer` 改为显式 `resp.Body.Close()`，修复循环内 defer 泄漏
  - 移除熔断器跳过逻辑（重试不应被熔断器阻止）
  - `buildCandidateModels` 保留定义但不调用
- **影响范围:** 所有非流式和流式请求的失败处理逻辑；测试耗时从 ~2s 增至 ~15s（退避导致）

## 2026-06-03 02:00: 增强端口释放可靠性 — 超时+重试
- **文件:** `internal/proxy/handler.go`
- **原因:** `findPIDByPort` 执行 `netstat -ano` 可能长时间阻塞；`killPID` 失败后不重试
- **决策:**
  - `findPIDByPort` 加 3s 超时（`exec.CommandContext`）
  - `ensurePortAvailable` 杀进程失败后等 1s 重试一次
- **影响范围:** Windows 上端口自动释放更可靠，不会因 netstat 慢而卡住

## 2026-06-03 11:30: 流量监控调试增强 — 加载超时保护 + 后端日志
- **文件:**
  - `frontend/traffic.js` — 新增 `safeShowLoading` 10s 加载超时保护 + API 错误返回值区分 + render 异常 try-catch
  - `internal/proxy/stats.go` — `readJSONLLogs` 增加 `log.Printf` 输出目录/文件数/错误信息
- **原因:** 用户反馈流量雷达仍无数据，需提供运行时诊断能力
- **决策:** 前端 10s 后强制退出加载态并显示错误提示；后端打印日志目录路径和文件数

## 2026-06-03 11:40: 流量监控 stats API 增加内存历史回退
- **文件:** `internal/proxy/stats.go`, `internal/proxy/history_log.go`
- **原因:** stats API 只读 JSONL 文件，若日志未启用或配置失败则永远返回空数据；但请求历史始终在内存中
- **决策:** `readJSONLLogs` 在 JSONL 无数据时回退到 `s.history` 内存历史；`ConfigureHistoryLog` 增加日志输出配置值
- **影响范围:** stats API 现在即使 JSONL 不存在也有数据可返回

## 2026-06-03 16:30: 折线图横轴自适应粒度 — 后端趋势 API 支持动态分组
- **文件:** `internal/proxy/stats.go`
- **原因:** dailyTrend 固定按天分组，前端需求随时间范围自动切换粒度（今日→小时、7-30天→天、365天→周）
- **决策:**
  - 新增 `determineGranularity(days)` 函数: ≤2天→hour、≤90天→day、>90天→week
  - 新增 `timeKey(t, granularity)` 函数: 按粒度截断时间并格式化为字符串键
  - `dailyTrend` 签名增加 `granularity string` 参数，内部使用 `timeKey`
  - `apiStatsTrend` 响应体增加 `granularity` 字段
- **影响范围:** 趋势 API 返回的数据粒度随 days 参数自适应；旧客户端忽略新增 granularity 字段

## 2026-06-03 20:30: 修复流量明细每次启动数据为空 — apiHistory 不读 JSONL 文件
- **文件:** `internal/proxy/handler.go`
- **根因:** `apiHistory`（`/ocgt/api/history`）只读 `s.history` 内存环形缓冲区（最多 100 条），启动时 nil，只显示当前会话新产生的请求。而统计 API（`/summary`/`/trend`/`/models`）已使用 `readJSONLLogs()` 从持久化 JSONL 文件读取
- **决策:** `apiHistory` 改为：先读 `readJSONLLogs(days)`（从 JSONL 持久日志读），再用内存中的新增条目补充去重，最后按时间倒序合并输出。与统计 API 保持一致的持久化策略
- **影响范围:** 重启程序后流量明细 Tab 仍能显示历史日志数据

## 2026-06-10 14:35: 修复价格和 Token 重复计算问题
- **文件:**
  - `internal/proxy/handler.go` — 重试循环不再记录历史（仅在最终失败或成功时记录）；TotalTokens 公式加入 CacheReadTokens
  - `internal/proxy/proxy_test.go` — 适配 history 断言从 6 条改为 1 条
- **根因:**
  1. **请求次数虚高：** retry 循环中每次失败的重试都调用 `addHistoryEntryWithUsageAndError`，导致 1 次用户请求在 JSONL 中产生最多 6 条记录，stats 统计时全部计入 `TotalRequests++`
  2. **TotalTokens 漏字段：** `handler.go:1162` 的 TotalTokens 公式 `Input + Output + CacheCreation` 漏了 `CacheReadTokens`
  3. **注释误导：** `apiHistory` 注释声称 "readJSONLLogs 内部有去重"，实际该函数并无去重逻辑
- **决策:**
  - 重试失败改为仅在最后一次尝试（break 前）写入历史，中间的重试尝试不记录
  - 4xx 非 429 的即时返回仍保留单次记录（正确）
  - 成功路径记录不变
  - TotalTokens 公式增加 `+ usage.CacheReadTokens`
  - 删除不实的去重注释
- **影响范围:** 修复后 1 次用户请求不再因重试产生多条记录，请求次数统计恢复正常

## 2026-06-10 14:50: 修复 EstimateCost 双重计费 + TotalTokens 回退 + 模型 Cache 命中率修正
- **文件:**
  - `internal/pricing/pricing.go` — EstimateCost 将 cacheReadTokens 从 inputTokens 中减去再计 input 价
  - `internal/proxy/handler.go` — TotalTokens 回退为 `Input+Output+CacheCreation`（CacheRead 已包含在 Input 中）
  - `internal/proxy/stats.go` — modelBreakdown 改用独立累加器，CacheHitRate 使用纯 CacheReadTokens
- **根因:**
  1. **EstimateCost 双重计费（严重）：** `input_tokens` 已包含 `cache_read_tokens`（后者是子集），但原来对全部 input 按全价计费，又对 cache_read 按缓存价计费，导致缓存读取部分被计了两次。以 deepseek-v4-flash 为例，输入价 $0.14、缓存价 $0.0028，有 cache 时费用虚高约 2x
  2. **TotalTokens 多加了 CacheReadTokens：** 上一轮修复中错误地加入了 CacheReadTokens，但 InputTokens 已包含它。回退到 `Input+Output+CacheCreation`
  3. **modelBreakdown 命中率不准：** 使用 `CacheRead + CacheCreation` 做分子计算命中率，创建（写入）不应计入命中
- **决策:**
  - EstimateCost: `nonCacheInput = inputTokens - cacheReadTokens` 后按全价计，cacheReadTokens 单独按缓存价计
  - TotalTokens: 回退到 `Input+Output+CacheCreation`（与 6-3 的修复一致）
  - modelBreakdown: 新建 `modelBreakdownAccum` 结构体，分别累加 CacheRead 和 CacheCreation，命中率只用 CacheRead
- **影响范围:** 费用估算降低（修复前有 cache 请求被虚高）；TotalTokens 恢复正确；模型表 Cache 命中率略微降低（之前误含 CacheCreation）

## 2026-06-10 15:45: 修复 extractUsageFromAnthropicStream 遗漏 message_start + 优化流式 message_delta 补全 input_tokens
- **文件:**
  - `internal/proxy/handler.go` — extractUsageFromAnthropicStream 增加 message_start 事件解析（input_tokens/cache 字段）
  - `internal/proxy/streamer.go` — 合成 message_delta 增加 input_tokens 字段
- **原因:**
  1. **extractUsageFromAnthropicStream 缺字段：** 该函数只捕获 `message_delta` 事件，但 Anthropic 流式协议中 `input_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` 在 `message_start.message.usage` 中（非 `message_delta.usage`），导致走 Anthropic 原生流式的请求丢失了 input 和 cache 字段
  2. **流式 message_delta 缺 input_tokens：** `streamOpenAIAsAnthropic` 的合成 `message_delta` 只发了 output/cache 字段，下游客户端收不到真实 input_tokens
- **决策:**
  - extractUsageFromAnthropicStream 同时捕获 `message_start` 和 `message_delta`，按事件类型分别从 `message.usage`（嵌套）和 `usage`（顶层）解析
  - streamOpenAIAsAnthropic 的 `message_delta` 增加 `input_tokens` 字段，值为流中最后 chunk 的真实 prompt_tokens（或估计值兜底）
  - message_start 的 input_tokens 仍为估算值（流式特点决定无法在首帧发送真实值）
- **影响范围:** Anthropic 原生流式请求的 input/cache 字段现在可被正确记录；下游客户端能通过 message_delta 拿到真实 input_tokens
