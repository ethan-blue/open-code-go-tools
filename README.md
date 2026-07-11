# ocgt — Claude Code 与 Codex 的桌面客户端与本地代理

ocgt（OpenCode Go Tools）主要是为 **OpenCode Go 套餐**（[opencode.ai/go](https://opencode.ai/go?ref=75Q34GPBZ1)）打造的桌面客户端与本地代理：默认上游就是 OpenCode Go，内置针对 OpenCode Go 的额度看板，让 Claude Code 和 Codex 直接接到你的 OpenCode Go 订阅上。

同时它也支持其他 OpenAI / Anthropic 兼容的上游供应商——作为一个本地 HTTP 代理，它在 Anthropic、OpenAI Chat Completions、OpenAI Responses 三种协议之间做转换，让原本只认某一种协议的客户端也能接到任意兼容供应商上。

界面提供中英双语，覆盖供应商与账号管理、模型配置、流量与额度监控、会话查看、跨设备同步，以及 Claude Code / Codex 的客户端接入配置。当前版本 `v4.0.3`。

> English: [docs/README.en-US.md](docs/README.en-US.md)

## 它解决什么问题

- 把 Claude Code 和 Codex 接到 OpenCode Go 订阅上，并在同一个界面里看 OpenCode Go 的额度用量（Rolling / Weekly / Monthly）——这是它的主要用途。
- Claude Code 只说 Anthropic 协议，Codex 只说 OpenAI Responses 协议，而很多第三方供应商（DeepSeek、Kimi、MiniMax、Qwen 等）只提供 OpenAI Chat Completions 接口。ocgt 在中间做协议转换，让这些客户端和供应商互通。
- 一个供应商配一套账号池，某个账号被限流、鉴权失败或额度耗尽时自动切换到下一个，不用手动改配置。
- Claude 和 Codex 各自维护当前生效的上游，互不干扰。

## 功能

### 协议转换与请求路由

- 按当前供应商的协议自动选择转发方式：Anthropic 上游走 `/v1/messages`，OpenAI 上游走 `/v1/chat/completions`，原生 Responses 上游直接透传 `/v1/responses`。
- Codex 的 Responses API 请求会被完整翻译：工具定义、`tool_choice`（`auto` / `none` / `required` / 指定函数）、`parallel_tool_calls`、多轮工具调用的续传，以及推理摘要。
- 非视觉模型会自动清洗掉图片内容，避免上游报错。

### 供应商与账号

- Claude 和 Codex 分别选择各自当前生效的上游供应商。
- 同一供应商下可维护多个账号 / API Key，按账号分别查询额度。
- 账号轮换：某账号遇到 5xx、网络错误、鉴权失败或限流时，按策略切换到账号池里的下一个（连续 3 次失败进入 30 秒冷却）。
- 模型级故障转移：请求的模型不可用时，沿配置的 fallback 链依次尝试候选模型。
- 熔断器：某个模型连续失败到阈值后短暂熔断，避免对已知故障上游反复打请求。
- 令牌桶限流与 RPM 限制，按客户端 IP 生效。
- 配置保存后热重载，无需重启进程。

### 模型配置

- 每个供应商可配置默认模型、对外通告的模型列表、fallback 模型、message 模型和别名。
- 支持从上游 `/v1/models` 同步模型列表。

### Codex 接入

- 一键写入用户级 `~/.codex/config.toml`：provider id 使用 Codex Desktop 兼容的 `custom`，显示名为 `ocgt`。
- 根级 `model_provider = "custom"` 与 `model = "..."` 决定 Codex 的默认请求走向。
- 生成 `~/.codex/ocgt-model-catalog.json`，写入当前 Codex 供应商的模型目录（默认模型、模型列表、fallback / message 模型、别名，以及可获取到的上游 `/v1/models`）。
- 改配置后重启 Codex CLI / App 生效。Codex App 的选择器可能仍只显示 `Custom`，实际请求以 ocgt 写入的根级 `model` 为准。

### Claude Code 接入

- 输出 Claude Code 所需的环境变量。
- 覆盖 CLI、VS Code、Claude Code settings、Claude Desktop 等常见接入方式。
- 快速连接页可直接拉起 PowerShell、Bash 或 CMD，并注入代理相关环境变量。

### 流量与额度

- 记录 token 用量、请求数、成功率、平均延迟和费用估算。
- 流量明细支持按时间、模型、状态筛选，可导出 CSV。
- 额度看板支持 Rolling / Weekly / Monthly 三种周期查看。
- 请求历史可选择落盘，并按保留天数清理。

### 会话查看

- 读取 Claude Code（`~/.claude/projects`）与 Codex 的会话记录，包含 Codex 已归档会话。
- 聚合每个会话的统计信息；未变更的文件命中缓存，新增或变更的文件用并行 worker 解析，避免每次打开都全量重扫。

### 跨设备同步（Hub）

- 内置或独立运行的 Hub HTTP 服务，用于在多台设备之间同步。
- 设备列表管理（查看、移除设备），带鉴权。
- 通过 SSE 推送更新；提供配套的 Cloudflare Worker 实现。

### 配套工具

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor)：独立终端监控工具，实时查看 ocgt 代理的请求日志。

## 快速开始

1. 从 [Releases](../../releases) 下载对应平台的构建（Windows `ocgt-windows-amd64.exe`、macOS `ocgt-macos-universal.tar.gz`、Linux `ocgt-linux-amd64`）。
2. 打开供应商 / 账号配置，填入 API Key 或账号凭证。
3. 为 Claude 和 Codex 分别选择当前供应商与默认模型。
4. 在集成页执行 Claude Code 或 Codex 的接入配置。
5. 重启对应客户端后开始使用。

## 配置文件

```text
%USERPROFILE%\.ocgt\config.json
%USERPROFILE%\.ocgt\providers.json
%USERPROFILE%\.codex\config.toml
%USERPROFILE%\.codex\ocgt-model-catalog.json
```

- `config.json`：本地代理、偏好、额度、Hub 等通用配置。
- `providers.json`：Claude / Codex 的供应商与账号级配置。
- `.codex` 目录下的文件由 Codex 接入配置写入。

## 命令行

```powershell
ocgt init       # 初始化默认配置
ocgt serve      # 后台运行代理服务
ocgt claude-env # 打印当前 Claude 供应商的环境变量
ocgt ccswitch   # 输出 CC Switch 格式的 provider JSON
ocgt version    # 查看版本
```

## 构建

需要 Go 1.22+、Node.js 与 Wails v2.12：

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
cd frontend
npm install
cd ..
wails build
```

Linux 上构建需要系统安装 `webkit2gtk-4.1`，并加构建标志 `-tags webkit2_41`。

## 版本说明

- `main` 分支是当前的 v4 主线（新界面 + 上述全部功能）。
- 旧的 v2.x 版本保留在 [`main-old`](../../tree/main-old) 分支，历史完整保留，供需要旧版界面或对照时使用。

## 已知限制

1. Codex App 的模型选择器可能仍只显示 `Custom`，实际请求以 ocgt 写入的根级 `model` 为准。
2. 用量统计依赖上游返回的 token / cache 字段，部分网关可能不返回这些字段。
3. 费用为估算值，可能与最终账单有出入。
4. 跨供应商的加密推理签名无法通用，Responses 的加密推理内容不会透传到 Anthropic 上游（仅保留可读摘要）。

## 许可证

MIT License

## 邀请链接

可通过此链接订购 go 计划：https://opencode.ai/go?ref=75Q34GPBZ1
