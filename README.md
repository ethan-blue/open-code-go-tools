# ocgt - Claude Code 桌面客户端 & 本地代理

`ocgt` 是给 Claude Code 用的桌面客户端和本地代理。它负责 Anthropic ↔ OpenAI 协议转换，并提供 GUI 面板管理 API Key、模型、流量、额度和终端启动。当前 `main` 稳定版是 `v2.2.5`。

> English version: [docs/README.en-US.md](docs/README.en-US.md)

## v4 预览

v4 已经可用，最新标签是 `v4.0.1`，代码在 `refactor/v4-ui-design` 分支。它主要包含新的 v4 桌面界面、Codex 一键配置、Claude/Codex 双供应商线、账号级配置和新的模型目录写入逻辑。

如果你只是想稳定使用，继续下载 `main` 对应的 `v2.2.5` 版本。如果你想试 v4，请看 `v4.0.1` 标签或 `refactor/v4-ui-design` 分支。

## 核心功能

### 系统状态

- 实时查看本地代理监听地址、上游 API 状态和 API Key 配置状态。
- 显示配置文件路径，并支持快速打开所在目录。
- 检查 Claude CLI、VS Code、Claude Code settings、Claude Desktop 等集成状态。

### 配置管理

- API Key 保存后热重载生效，常规配置不需要重启。
- 支持 Sonnet / Haiku / Opus 到上游模型的映射。
- 支持思考强度、同模型重试、fallback chain 和多账号轮换。
- 套餐额度模块会自动解析 Workspace ID，并改进 opencode.ai 页面抓取请求头。

### 快速连接

- 一键拉起 PowerShell、Bash 或 CMD，并注入代理环境变量。
- 支持修复常见客户端集成配置。
- 命令行仍可通过 `ocgt claude-env` 输出当前环境变量。

### 流量与额度

- 记录 Token、请求数、成功率、平均延迟和费用估算。
- 流量明细支持按时间、模型和状态筛选，并可导出 CSV。
- 额度看板支持 Rolling / Weekly / Monthly 进度查看和手动刷新。

### 配套工具

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor)：独立终端监控工具，用于实时查看 ocgt 代理请求日志。

## 快速开始

1. 从 [Releases](../../releases) 下载适合你系统的版本。
2. 打开配置页，填入 API Key，选择模型并保存。
3. 打开快速连接页，选择终端并启动，然后运行 `claude`。

## 配置文件

```text
%USERPROFILE%\.ocgt\config.json
```

- `version` 字段用于 schema 迁移。
- 文件修改会被轮询检测，外部编辑后自动热重载。
- `X-Ocgt-Profile` header 可指定 profile；不指定时使用 `active_profile`。

## 命令行参考

```powershell
ocgt init       # 初始化默认配置
ocgt serve      # 后台运行代理服务
ocgt claude-env # 打印当前 Profile 环境变量
ocgt ccswitch   # 输出 CC Switch provider JSON
ocgt version    # 查看版本
```

## 构建

需要 Go 1.22+ 和 Wails v2.12：

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
wails dev
wails build
```

## 已知限制

代理转发时，用量统计可能存在偏差：

1. 缓存统计依赖上游返回 `prompt_tokens_details.cached_tokens`。
2. 费用按内置价格表估算，可能与实际账单有差异。

## 许可证

MIT License

## 邀请链接

可以走此链接订购 go 计划：https://opencode.ai/go?ref=75Q34GPBZ1
