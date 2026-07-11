# ocgt v4 - Claude Code / Codex Desktop Client And Local Proxy

`ocgt` v4 is a desktop client and local proxy for Claude Code and Codex. It handles Anthropic ↔ OpenAI protocol conversion and provides the v4 desktop UI for providers, accounts, models, traffic, quota status, and client integrations. The current version is `v4.0.3`.

> Chinese version: [../README.md](../README.md)

## v4 Highlights

- New v4 desktop UI.
- Separate Claude / Codex provider lines, replacing the old shared Profile-facing workflow.
- Account-level config: one provider can hold multiple accounts/API keys and query quota per account.
- Codex one-click setup writes a desktop-compatible `custom` provider and generates `~/.codex/ocgt-model-catalog.json`.
- Model catalog and aliases include default model, configured models, fallback/message models, aliases, and upstream `/v1/models` where available.
- Traffic, quota, and session views remain available for Claude Code and Codex workflows.

## Core Features

### Providers And Accounts

- Claude and Codex can each use their own active upstream provider.
- One provider can hold multiple accounts/API keys.
- Account failures, auth failures, and quota exhaustion can fail over to another account.
- Saved config hot reloads through the v4 provider structure.

### Codex Integration

- One-click setup writes user-level `~/.codex/config.toml`.
- The provider id is Codex Desktop-compatible `custom`, with display name `ocgt`.
- Root-level `model_provider = "custom"` and `model = "..."` control Codex default requests.
- `~/.codex/ocgt-model-catalog.json` is generated from the active ocgt Codex provider.
- Restart Codex CLI / App after setup. The Codex app may still show `Custom`, but requests use the model written by ocgt.

### Claude Code Integration

- Print Claude Code environment variables for the active Claude provider.
- Configure CLI, VS Code, Claude Code settings, and Claude Desktop entry points.
- Quick Connect can launch PowerShell, Bash, or CMD with proxy environment variables injected.

### Traffic And Quota

- Track tokens, request count, success rate, average latency, and estimated cost.
- Filter traffic details by time, model, and status, then export CSV.
- View Rolling / Weekly / Monthly quota progress.
- v4.0.3 completes Codex Responses API tool calling: `tool_choice`, `parallel_tool_calls`, multi-turn tool-call continuation, and reasoning-summary passthrough, across the openai-chat / anthropic / openai-responses upstream protocols.
- v4.0.1 fixes quota status incorrectly reporting an unset cookie when the active provider account already has one.

### Companion Tool

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor): a standalone terminal monitor for real-time ocgt proxy request logs.

## Quick Start

1. Download `ocgt_v4.0.3` or a newer build from [Releases](../../releases).
2. Open provider/account settings and enter your API key or account credential.
3. Choose the active provider and default model separately for Claude and Codex.
4. Run the Claude Code or Codex one-click integration.
5. Restart the target client and start using it.

## Config Files

```text
%USERPROFILE%\.ocgt\config.json
%USERPROFILE%\.ocgt\providers.json
%USERPROFILE%\.codex\config.toml
%USERPROFILE%\.codex\ocgt-model-catalog.json
```

- `config.json` stores local proxy, preferences, quota, and shared settings.
- `providers.json` stores Claude / Codex providers and account-level config.
- Codex files are written to the user-level `.codex` directory by one-click setup.

## CLI Reference

```powershell
ocgt init       # Create default config
ocgt serve      # Run the proxy in the background
ocgt claude-env # Print current Claude provider environment variables
ocgt ccswitch   # Output CC Switch provider JSON
ocgt version    # Show version
```

## Build

Requires Go 1.22+, Node.js, and Wails v2.12:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
cd frontend
npm install
cd ..
wails build
```

## Known Limits

1. The Codex app may still show `Custom` in its model picker; actual requests use the root-level `model` written by ocgt.
2. Usage stats depend on upstream token/cache fields, and some gateways may omit them.
3. Costs are estimates and may differ from the final bill.

## License

MIT License
