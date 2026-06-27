# ocgt 架构评审记录

## 当前结论

这次评审重点不是“简单打开 thinking”，而是把 Claude Code、ocgt 本地代理、OpenCode Go 上游之间的协议边界理顺。

Claude Code 的工作流应当是：

1. Claude Code 发起 Anthropic Messages 请求。
2. 本地 `ocgt` 接收请求并识别 profile、模型映射和 thinking 配置。
3. `ocgt` 转换为上游兼容格式，并限制 thinking budget，避免错误配置把请求拖慢。
4. 上游如果返回真实 reasoning / thinking 字段，`ocgt` 转换为 Claude Code 可识别的 thinking block。
5. GUI 只暴露少量稳定选项，不把复杂内部参数直接丢给用户。

## 已完成改进

- GUI 打开速度：缩短初始代理状态等待，去掉外部字体依赖。
- 多开问题：增加 Wails 单实例锁，重复启动会唤起已有窗口。
- 请求延迟：为流式请求设置 SSE 友好 header，禁用压缩等待，保留 HTTP/2。
- 思考显示：支持多种上游 reasoning 字段，并转换为 Anthropic thinking block。
- 思考配置：从自由数字输入改为固定“思考强度”选项。
- 乱码问题：修复 GUI 标签、`wails.json` 产品名、README/评审文档编码。
- 构建可靠性：没有全局 Wails CLI 时自动 fallback 到固定版本。
- 发布可靠性：Release workflow 固定 Wails 版本，从 tag 注入版本号，按实际产物上传。

## 设计取舍

不建议在代理里伪造 thinking。原因很直接：Claude Code 用户看到的思考过程应当来自模型或上游 API 的真实 reasoning 字段。伪造内容会让调试、性能判断和模型质量评估全部失真。

也不建议把 `budget_tokens` 做成完全自由输入。用户真正需要的是“快一点”或“想深一点”，而不是记住 `-1`、`0`、`1..8192` 的每个语义。GUI 采用固定档位，配置文件仍保留底层能力。

## 剩余风险

- 不同上游模型对 reasoning 字段的命名不完全一致，后续需要根据真实响应继续补充兼容分支。
- Claude Code 自身 UI 是否展示 thinking，不完全受 `ocgt` 控制。
- Release workflow 的跨平台 Wails 构建依赖 GitHub runner 环境，首次发布后仍需要观察 Actions 日志。
- 本地 `go.mod` 目前存在行尾状态变化，没有内容 diff，未纳入提交。

## 下一步建议

1. 增加真实 OpenCode Go 上游的集成测试样本，覆盖非流式和流式 reasoning。
2. 在 GUI 的流量监控里标记“首 token 延迟”和“总耗时”，更容易判断慢在上游还是本地代理。
3. 为 Release workflow 加一个手动触发入口，方便 tag 发布失败时重跑。
4. 增加错误日志面板，把上游 4xx/5xx 和本地转换错误分开展示。
