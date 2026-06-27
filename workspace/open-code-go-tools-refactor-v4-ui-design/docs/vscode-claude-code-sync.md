# VS Code Claude Code 集成与同步方案

## 结论

只要 ocgt 正在运行，并且已执行过“保存并应用配置”或“一键修复 Claude Code 系统环境变量”，VS Code 里的 Claude Code 扩展可以直接走 ocgt 本地代理使用。

核心原因是 Claude Code 官方支持两种稳定入口：

- 通过环境变量设置 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_CUSTOM_HEADERS`。
- 通过 `~/.claude/settings.json` 的 `env` 字段把这些变量应用到每次 Claude Code 启动。

ocgt 应优先同步 `~/.claude/settings.json`，同时写入用户级环境变量作为兼容兜底。VS Code 扩展和 Claude Code CLI 共享 Claude Code settings，因此这条链路可以同时覆盖 VS Code 图形面板、VS Code 集成终端和外部终端。

## 用户流程

1. 启动 ocgt，确保本地代理处于运行状态，例如 `http://127.0.0.1:8787`。
2. 在 ocgt 配置页填写 OpenCode Go API Key、模型映射和思考强度。
3. 点击保存，ocgt 自动应用代理配置，并同步 Claude Code 环境到 `~/.claude/settings.json`。
4. 打开或重载 VS Code 的 Claude Code 扩展。
5. 在 VS Code Claude Code 面板或集成终端里使用 Claude Code。

如果 VS Code 已经打开但没有生效，重载 VS Code 窗口或重启 Claude Code 会话。Claude Code 在启动时读取环境变量和 settings，运行中的会话不会自动重新读取所有配置。

## 同步内容

ocgt 同步到 Claude Code 的最小环境变量集合：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787",
    "ANTHROPIC_API_KEY": "ocgt-local-proxy",
    "ANTHROPIC_AUTH_TOKEN": "<ocgt-local-auth-token>",
    "ANTHROPIC_CUSTOM_HEADERS": "X-Ocgt-Profile: opencode-go",
    "OCGT_PROFILE": "opencode-go",
    "MAX_THINKING_TOKENS": "512"
  }
}
```

其中 `ANTHROPIC_AUTH_TOKEN` 用于通过 ocgt 本地代理认证。Claude Code 会把它转换为 `Authorization: Bearer <token>`，而 ocgt 代理已经支持读取这个头。

## 需要保留的 Claude Code 配置

同步时不能覆盖用户已有的 Claude Code 设置。应保留这些顶层字段：

- `permissions`
- `model`
- `enabledPlugins`
- `statusLine`
- `allowedTools`

ocgt 当前策略是合并 `env`，并保留一份 `settings.json.ocgt-bak`，用于在其他工具覆盖 settings 后恢复关键字段。

## VS Code Settings Sync 的边界

VS Code Settings Sync 会同步 VS Code 自己的设置、快捷键、扩展、UI 状态和 profiles，但它不等同于同步 `~/.claude/settings.json`。因此：

- 同一台机器：ocgt 同步一次即可覆盖 VS Code 扩展和 CLI。
- 多台机器：每台机器都需要运行 ocgt 并写入本机 `~/.claude/settings.json`。
- 不建议把带 token 或 API Key 的 `~/.claude/settings.json` 直接提交到仓库。

## 后续可优化

1. 增加“打开 VS Code Claude Code”按钮，调用 `vscode://anthropic.claude-code/open`。
2. 在状态页显示 Claude Code settings 同步状态：已同步、需重载、同步失败。
3. 给 CLI 增加 `ocgt sync-claude` 命令，让无 GUI 用户也能写入 `~/.claude/settings.json`。
4. 给 `claude-env` 和 `ccswitch` 命令增加 `--auth-token` 或从配置读取 `local_auth_token` 的能力。
5. 增加集成测试：启动代理后，用 `Authorization: Bearer <token>` 请求 `/v1/models`，确认 Claude Code 路径不会 401。

## 参考资料

- Claude Code VS Code 扩展文档：https://code.claude.com/docs/en/vs-code
- Claude Code settings 文档：https://code.claude.com/docs/en/settings
- Claude Code 环境变量文档：https://code.claude.com/docs/en/env-vars
- VS Code Settings Sync 文档：https://code.visualstudio.com/docs/configure/settings-sync
