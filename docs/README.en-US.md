# ocgt - Claude Code Desktop Client & Local Proxy

`ocgt` (OpenCode Go Tools) is a desktop client and local proxy for Claude Code. It handles Anthropic ↔ OpenAI protocol conversion and provides a GUI for API keys, models, traffic, quota status, and terminal launch. The current stable version on `main` is `v2.2.5`.

> Chinese version: [../README.md](../README.md)

## v4 Preview

v4 is available. The latest tag is `v4.0.1`, and the code lives on the `refactor/v4-ui-design` branch. It includes the new v4 desktop UI, Codex one-click setup, separate Claude/Codex provider lines, account-level config, and the newer model catalog writing flow.

Use the `v2.2.5` build from `main` if you want the stable line. Use the `v4.0.1` tag or the `refactor/v4-ui-design` branch if you want to try v4.

## Core Features

### System Status

- Check the local proxy address, upstream API status, and API key state.
- See config file paths and open the containing directory quickly.
- Inspect integration status for Claude CLI, VS Code, Claude Code settings, and Claude Desktop.

### Configuration

- API key changes hot reload after saving for normal config updates.
- Map Sonnet / Haiku / Opus to upstream model names.
- Configure reasoning intensity, same-model retry, fallback chains, and multi-account rotation.
- The quota module can resolve Workspace IDs automatically and uses improved request headers for opencode.ai page capture.

### Quick Connect

- Launch PowerShell, Bash, or CMD with proxy environment variables injected.
- Repair common client integration config in one click.
- Use `ocgt claude-env` from the CLI to print the current environment variables.

### Traffic And Quota

- Track tokens, request count, success rate, average latency, and estimated cost.
- Filter traffic details by time, model, and status, then export CSV when needed.
- View Rolling / Weekly / Monthly quota progress and refresh manually.

### Companion Tool

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor): a standalone terminal monitor for real-time ocgt proxy request logs.

## Quick Start

1. Download the build for your system from [Releases](../../releases).
2. Open the config page, enter your API key, choose a model, and save.
3. Open Quick Connect, choose a terminal, launch it, then run `claude`.

## Config File

```text
%USERPROFILE%\.ocgt\config.json
```

- The `version` field is used for schema migrations.
- External edits are detected by polling and hot reloaded.
- `X-Ocgt-Profile` can select a profile; without it, `active_profile` is used.

## CLI Reference

```powershell
ocgt init       # Create default config
ocgt serve      # Run the proxy in the background
ocgt claude-env # Print current profile environment variables
ocgt ccswitch   # Output CC Switch provider JSON
ocgt version    # Show version
```

## Build

Requires Go 1.22+ and Wails v2.12:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
wails dev
wails build
```

## Known Limits

Usage statistics can be approximate during proxy forwarding:

1. Cache stats depend on upstream `prompt_tokens_details.cached_tokens` fields.
2. Costs are estimated from the built-in price table and may differ from the final bill.

## License

MIT License
