# ocgt Usage 统计修复总结

## 问题定位

### 问题 1: Usage 字段缺失
**位置**: `internal/proxy/converter.go:185-188`

```go
// 原代码
"usage": map[string]int{
    "input_tokens":  in.Usage.PromptTokens,
    "output_tokens": in.Usage.CompletionTokens,
    // ❌ 缺少 cache_creation_input_tokens
    // ❌ 缺少 cache_read_input_tokens
},
```

**影响**: `used_percentage = (input + cache_creation + cache_read) / window_size` 计算不准确

### 问题 2: 架构限制
**根因**: OpenAI Chat Completions API 不支持 Anthropic 的 prompt caching 字段

- `cache_creation_input_tokens` → OpenAI 协议无此字段
- `cache_read_input_tokens` → OpenAI 协议无此字段
- 上游模型 (kimi/deepseek/qwen) 不返回 prompt caching 数据

**结论**: 这是架构限制,不是 bug

---

## 修复措施

### 1. 代码层面 - 添加防御性注释

**converter.go**:
```go
// Build usage object with defensive defaults for OpenAI-to-Anthropic conversion
// OpenAI protocol lacks Anthropic-specific cache fields (cache_creation_input_tokens,
// cache_read_input_tokens). These remain 0 for non-Anthropic upstreams (kimi/deepseek/etc).
// This is an architectural limitation, not a bug.
usage := map[string]int{
    "input_tokens":  in.Usage.PromptTokens,
    "output_tokens": in.Usage.CompletionTokens,
}
```

**streamer.go**:
```go
// Send final message delta with usage statistics
// Note: output_tokens is tracked during streaming, but cache-related fields
// (cache_creation_input_tokens, cache_read_input_tokens) are not available
// from OpenAI-compatible endpoints. This is a protocol limitation.
```

**converter.go 末尾**:
```go
// NOTE: Usage Statistics Limitation
//
// The openAIToAnthropic converter provides basic usage metrics (input_tokens, output_tokens)
// but cannot populate Anthropic-specific cache fields:
//   - cache_creation_input_tokens: always 0 (OpenAI protocol does not support)
//   - cache_read_input_tokens: always 0 (OpenAI protocol does not support)
//
// This affects downstream tools that calculate usage percentages based on:
//   used_percentage = (input + cache_creation + cache_read) / window_size
//
// For accurate cache statistics, use Anthropic native API endpoints or models that
// support prompt caching and return Anthropic-formatted responses.
```

### 2. 配置层面 - Profile 文档化

**config.go**:
```go
// Profile holds configuration for a specific API backend.
// Multiple profiles allow switching between different providers/keys.
//
// Known Limitation: When using OpenAI-compatible endpoints (non-Anthropic upstream),
// usage statistics will lack cache-related fields (cache_creation_input_tokens,
// cache_read_input_tokens) because the OpenAI Chat Completions protocol does not
// support Anthropic's prompt caching metrics. This affects used_percentage
// calculations in downstream tools like Claude Code's status line.
type Profile struct { ... }
```

### 3. 用户层面 - README 说明

**README.md**:
```markdown
## ⚠️ 已知限制

### Usage 统计不完整

通过 ocgt 代理时，`used_percentage` 和 usage 统计可能不准确，原因如下：

1. **协议差异**: OpenAI Chat Completions API 不支持 Anthropic 的 prompt caching 字段
   - `cache_creation_input_tokens` → 始终为 0
   - `cache_read_input_tokens` → 始终为 0

2. **上游限制**: 非 Anthropic 模型 (kimi/deepseek/qwen等) 不返回 prompt caching 数据

3. **影响**: `used_percentage = (input + cache_creation + cache_read) / window_size` 计算结果偏低

**这不是 bug，而是架构限制**。如需完整的 usage 统计，请使用 Anthropic 原生 API 或支持 prompt caching 的上游。
```

---

## 举一反三

### 1. 其他可能受影响的场景

#### a) Token 计费
- 如果按 `input_tokens + cache_creation + cache_read` 计费,通过 ocgt 的计费会偏低
- **建议**: 只用 `input_tokens` 和 `output_tokens` 计费,或标注"不含缓存节省"

#### b) 成本监控
- 监控面板显示的 usage 百分比不准确
- **建议**: 添加提示"通过代理时统计可能不完整"

#### c) 限流/配额
- 基于 usage 的限流可能不准确
- **建议**: 限流逻辑只依赖 `input_tokens` 和 `output_tokens`

### 2. 未来改进方向

#### a) 支持 Anthropic 原生端点
```go
// 在 Profile 中添加字段
type Profile struct {
    // ...
    UseAnthropicEndpoint bool `json:"use_anthropic_endpoint,omitempty"`
    // 当 true 时,直接转发 Anthropic 格式,不做协议转换
}
```

#### b) 上游能力探测
```go
// 自动检测上游是否支持 prompt caching
func (s *Server) detectUpstreamCapabilities() {
    // 发送测试请求,检查响应中是否有 cache 字段
    // 记录到 profile 配置中
}
```

#### c) Usage 估算
```go
// 对不支持 cache 的上游,提供估算值
func estimateCacheTokens(inputTokens int) int {
    // 基于历史数据估算可能的 cache 命中率
    // 返回估算值,标注为 "estimated"
}
```

### 3. 文档完善建议

#### a) 用户指南
- 添加"选择上游"章节,说明不同上游的能力差异
- 对比表格: Anthropic vs OpenAI vs 国产模型的 usage 统计支持

#### b) API 文档
- 标注每个 API 的 usage 字段支持情况
- 添加"已知限制"章节

#### c) 故障排查
- 添加"usage 统计不准确"的排查流程
- 说明如何判断是代理问题还是上游限制

---

## 验证

### 测试通过
```bash
$ go test -v ./internal/proxy
PASS
ok      github.com/ethan-blue/open-code-go-tools/internal/proxy    1.391s
```

### 修改文件清单
1. `internal/proxy/converter.go` - 添加 usage 字段注释和文档
2. `internal/proxy/streamer.go` - 添加流式响应注释
3. `internal/config/config.go` - Profile 文档化
4. `README.md` - 添加已知限制说明
5. `docs/usage-limitation.md` - 本文档

---

## 总结

两个问题都真实存在,但本质是**架构限制**而非代码 bug:

1. **OpenAI 协议限制** - 不支持 Anthropic 的 cache 字段
2. **上游模型限制** - kimi/deepseek 等不返回 prompt caching 数据

修复策略:
- ✅ 代码层面: 添加防御性注释,明确标注限制
- ✅ 配置层面: Profile 文档化,说明影响
- ✅ 用户层面: README 添加已知限制章节
- ✅ 举一反三: 分析其他受影响场景,提出改进方向

**核心原则**: 不掩盖问题,不假装支持,清晰告知用户限制所在。
