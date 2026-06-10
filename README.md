# ocgt — Claude Code 原生 GUI 控制面板与代理

`ocgt`（OpenCode Go Tools）是 **Claude Code** 的桌面控制面板，提供流量监控、套餐额度看板、配置管理和一键终端启动等功能。内置超低延迟本地代理（Anthropic ↔ OpenAI Chat Completions 协议互转），中英双语 GUI。

> 🌐 **[English Version](docs/README.en-US.md)**

---

## ✨ 核心功能

### 📊 系统状态看板
![System Status](assets/2026-05-30_213807.png)
- 实时监控代理监听端口、上游 API 状态、API Key 配置
- 可视化配置文件路径，一键打开所在文件夹
- 客户端集成状态一目了然（CLI / VS Code / Claude Desktop）

### ⚙️ 配置管理
![Configuration Settings](assets/2026-05-30_213821.png)
- 填入 API Key 即配置热重载生效
- **模型映射**：Sonnet / Haiku / Opus 自由映射上游平替
- **思考强度**：低 / 中 / 高 / 极高 / 关
- **同模型重试**：5 次指数退避 + 30s 断路器

### 💻 快速连接
![Terminal Activation](assets/2026-05-30_213831.png)
- 一键拉起已注入全部代理变量的原生终端（PowerShell / Bash / CMD）
- 四种客户端集成：CLI（全局 settings.json）、VS Code、Claude Code settings、Claude Desktop App（3P Profile）
- 一键修复所有已配置的集成

### 📡 流量监控雷达
- **多巴胺配色仪表盘**：统计卡片、Token/请求量折线图（自适应小时/天/周粒度）、模型环形图
- **流量明细**（Ctrl+5）：10 字段全维度表格、三维筛选（时间+模型+状态）、分页导航、CSV 导出、一键清除

### 📊 套餐额度看板
- Rolling / Weekly / Monthly 三级额度进度条
- 每 5 秒自动刷新，支持手动刷新

### 🧩 配套工具 — [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor)
- 独立终端监控工具，实时展示 ocgt 代理请求日志
- 彩色高亮输出，支持过滤和统计
- 与 ocgt GUI 互补使用，适合全屏终端工作流

### 🎨 偏好设置
- 主题模式：浅色 / 深色 / 跟随系统 · 5 种主题色 + 自定义色相
- 界面语言：中文 / English
- 关闭窗口行为：每次询问 / 最小化到托盘 / 退出程序

---

## 🚀 快速开始

1. **下载**：[Releases](../../releases) → 下载最新版本
2. **配置**：配置管理页（Ctrl+2）→ 填 **OpenCode Go API Key** → 选模型 → 保存
3. **启动**：快速连接（Ctrl+3）→ 选择终端类型 → 一键拉起 → 输入 `claude`

---

## 🔒 安全特性

| 特性 | 说明 |
|------|------|
| **API Key 遮蔽** | 接口返回 `sk-...xxxx`，前端不暴露完整密钥 |
| **命令注入防护** | 终端启动用环境变量引用代替字符串拼接 |
| **自动认证** | Dashboard API 自动生成随机 Token，防止局域网未授权访问 |
| **IP 识别** | 限流器以 `RemoteAddr` 为准，XFF 仅信任 localhost |
| **优雅关机** | 追踪在途流式请求，最长等待 30s 再关闭 |
| **CORS 收紧** | 仅允许 localhost 来源跨域 |

---

## 📁 配置与热重载

```text
%USERPROFILE%\.ocgt\config.json
```

- **Schema 版本化**：`version` 字段 + `Migrate()` 迁移方法
- **热重载**：ModTime 检测 + 3s 轮询，外部编辑自动生效
- **多 Profile**：`X-Ocgt-Profile` header 或默认 `active_profile`

---

## 💻 命令行参考

```powershell
ocgt init       # 初始化默认配置
ocgt serve      # 后台运行代理服务
ocgt claude-env # 打印当前 Profile 环境变量
ocgt ccswitch   # 输出 CC Switch provider JSON
ocgt version    # 查看版本
```

---

## 🛠️ 构建

需要 Go 1.22+，Wails v2.12：

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
wails dev          # 开发模式
wails build        # 生产构建
```

---

## ⚠️ 已知限制

通过 ocgt 代理时，`used_percentage` 和 usage 统计可能存在偏差：

1. **缓存统计依赖上游**：DeepSeek/Qwen 等通过 `prompt_tokens_details.cached_tokens` 返回缓存数据；部分上游可能不返回
2. **费用为估算值**：基于 go 的官方预估定价表计算，但或许与 OpenCode Go 官方账单有出入，仅供参考

**以上为架构限制，非程序 Bug。**

---

## 📄 许可证

MIT License

## 邀请链接

可以走此链接订购 go 计划：https://opencode.ai/go?ref=RRWQDE4CWW
