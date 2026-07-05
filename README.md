# ocgt v4 - Claude Code / Codex 桌面客户端与本地代理

`ocgt` v4 是给 Claude Code 和 Codex 使用的桌面客户端与本地代理。它负责 Anthropic ↔ OpenAI 协议转换，并提供 v4 桌面界面来管理供应商、账号、模型、流量、额度和客户端集成。当前版本是 `v4.0.1`。

> English version: [docs/README.en-US.md](docs/README.en-US.md)

## v4 重点

- 新的 v4 桌面界面。
- Claude / Codex 双供应商线：两边各自维护当前生效上游，不再绑在同一个旧 Profile 概念上。
- 账号级配置：同一供应商可维护多个账号/API Key，支持按账号查询额度。
- Codex 一键配置：写入桌面端兼容的 `custom` provider，并生成 `~/.codex/ocgt-model-catalog.json`。
- 模型目录和别名：支持默认模型、模型列表、fallback/message 模型、别名和上游 `/v1/models` 同步。
- 流量、额度和会话视图继续保留，适合同时服务 Claude Code 与 Codex。

## 核心功能

### 供应商与账号

- Claude 和 Codex 分别选择当前上游供应商。
- 同一供应商支持多个账号/API Key。
- 账号失败、鉴权失败或额度耗尽时可进行故障转移。
- 配置保存后按 v4 结构热重载。

### Codex 集成

- 一键写入用户级 `~/.codex/config.toml`。
- provider id 使用 Codex Desktop 兼容的 `custom`，显示名为 `ocgt`。
- 根级 `model_provider = "custom"` 和 `model = "..."` 控制 Codex 默认请求。
- 生成 `~/.codex/ocgt-model-catalog.json`，写入当前 ocgt Codex 供应商的模型目录。
- 配置后重启 Codex CLI / App 生效；Codex App 可能仍显示为 `Custom`，实际请求会使用 ocgt 写入的模型。

### Claude Code 集成

- 支持输出 Claude Code 环境变量。
- 支持 CLI、VS Code、Claude Code settings、Claude Desktop 等常见集成入口。
- 快速连接页可拉起 PowerShell、Bash 或 CMD，并注入代理环境变量。

### 流量与额度

- 记录 Token、请求数、成功率、平均延迟和费用估算。
- 流量明细支持按时间、模型、状态筛选，并可导出 CSV。
- 额度看板支持 Rolling / Weekly / Monthly 进度查看。
- v4.0.1 修复了已配置账号 cookie 时额度页仍提示未配置的问题。

### 配套工具

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor)：独立终端监控工具，用于实时查看 ocgt 代理请求日志。

## 快速开始

1. 从 [Releases](../../releases) 下载 `ocgt_v4.0.1` 或更新版本。
2. 打开供应商/账号配置，填入 API Key 或账号凭证。
3. 为 Claude 和 Codex 分别选择当前供应商与默认模型。
4. 在集成页执行 Claude Code 或 Codex 一键配置。
5. 重启对应客户端后开始使用。

## 配置文件

```text
%USERPROFILE%\.ocgt\config.json
%USERPROFILE%\.ocgt\providers.json
%USERPROFILE%\.codex\config.toml
%USERPROFILE%\.codex\ocgt-model-catalog.json
```

- `config.json` 保存本地代理、偏好、额度等通用配置。
- `providers.json` 保存 Claude / Codex 供应商与账号级配置。
- Codex 相关文件由一键配置写入用户级 `.codex` 目录。

## 命令行参考

```powershell
ocgt init       # 初始化默认配置
ocgt serve      # 后台运行代理服务
ocgt claude-env # 打印当前 Claude 供应商环境变量
ocgt ccswitch   # 输出 CC Switch provider JSON
ocgt version    # 查看版本
```

## 构建

需要 Go 1.22+、Node.js 和 Wails v2.12：

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
cd frontend
npm install
cd ..
wails build
```

## 已知限制

1. Codex App 的模型选择器可能仍只显示 `Custom`；实际请求以 ocgt 写入的根级 `model` 为准。
2. 用量统计依赖上游返回的 token/cache 字段，部分网关可能缺字段。
3. 费用是估算值，可能与最终账单不同。

## 许可证

MIT License

## 邀请链接

可以走此链接订购 go 计划：https://opencode.ai/go?ref=75Q34GPBZ1
