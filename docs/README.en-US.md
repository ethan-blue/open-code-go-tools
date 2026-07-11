# ocgt — Desktop Client and Local Proxy for Claude Code and Codex

ocgt (OpenCode Go Tools) is a desktop application that also runs a local HTTP proxy, forwarding Claude Code and Codex requests to the upstream provider you configure. It converts between the Anthropic, OpenAI Chat Completions, and OpenAI Responses protocols, so a client that only speaks one of them can reach any compatible provider.

The UI is bilingual (English / Simplified Chinese) and covers provider and account management, model configuration, traffic and quota monitoring, session inspection, cross-device sync, and client setup for Claude Code and Codex. Current version: `v4.0.3`.

> 中文版：[../README.md](../README.md)

## What it solves

- Claude Code speaks only the Anthropic protocol, Codex speaks only the OpenAI Responses protocol, and many third-party providers (DeepSeek, Kimi, MiniMax, Qwen, ...) expose only OpenAI Chat Completions. ocgt translates between them so these clients and providers interoperate.
- Each provider carries an account pool; when one account is rate-limited, fails auth, or runs out of quota, it fails over to the next without a config change.
- Claude and Codex each keep their own active upstream, independently.

## Features

### Protocol conversion and routing

- Forwarding is chosen by the active provider's protocol: Anthropic upstreams use `/v1/messages`, OpenAI upstreams use `/v1/chat/completions`, and native Responses upstreams pass through `/v1/responses`.
- Codex Responses API requests are translated in full: tool definitions, `tool_choice` (`auto` / `none` / `required` / a named function), `parallel_tool_calls`, multi-turn tool-call continuation, and reasoning summaries.
- Image content is stripped automatically for non-vision models to avoid upstream errors.

### Providers and accounts

- Claude and Codex each select their own active upstream provider.
- A provider can hold multiple accounts / API keys, with per-account quota lookup.
- Account rotation: on 5xx, network errors, auth failures, or rate limits, it moves to the next account in the pool (three consecutive failures trigger a 30s cooldown).
- Model-level failover: when the requested model is unavailable, candidates are tried along the configured fallback chain.
- Circuit breaker: a model that fails past a threshold is briefly tripped, so a known-bad upstream isn't hammered.
- Token-bucket rate limiting and an RPM cap, applied per client IP.
- Config hot-reloads on save; no process restart needed.

### Model configuration

- Per provider: default model, advertised model list, fallback models, message models, and aliases.
- Model lists can be synced from the upstream `/v1/models`.

### Codex integration

- One-click write to the user-level `~/.codex/config.toml`: provider id uses the Codex Desktop-compatible `custom` with display name `ocgt`.
- Root-level `model_provider = "custom"` and `model = "..."` drive Codex's default requests.
- Generates `~/.codex/ocgt-model-catalog.json` from the active Codex provider (default model, model list, fallback / message models, aliases, and the upstream `/v1/models` where available).
- Restart Codex CLI / App after changes. The Codex App picker may still show only `Custom`; the actual request uses the root-level `model` ocgt wrote.

### Claude Code integration

- Emits the environment variables Claude Code needs.
- Covers CLI, VS Code, Claude Code settings, and Claude Desktop.
- The quick-connect page can launch PowerShell, Bash, or CMD with the proxy environment variables injected.

### Traffic and quota

- Records token usage, request counts, success rate, average latency, and cost estimates.
- Traffic details filter by time, model, and status, and export to CSV.
- The quota dashboard shows Rolling / Weekly / Monthly progress.
- Request history can optionally be written to disk and pruned by retention days.

### Session inspection

- Reads Claude Code sessions (`~/.claude/projects`) and Codex sessions, including archived Codex sessions.
- Aggregates per-session stats; unchanged files hit a cache while new or changed files are parsed by parallel workers, avoiding a full rescan on every open.

### Cross-device sync (Hub)

- A Hub HTTP service, embedded or run standalone, syncs across devices.
- Device list management (view, remove), with auth.
- Updates are pushed over SSE; a companion Cloudflare Worker implementation is included.

### Companion tool

- [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor): a standalone terminal monitor for ocgt proxy request logs in real time.

## Quick start

1. Download the build for your platform from [Releases](../../releases) (Windows `ocgt-windows-amd64.exe`, macOS `ocgt-macos-universal.tar.gz`, Linux `ocgt-linux-amd64`).
2. Open provider / account settings and enter your API key or account credential.
3. Select the active provider and default model for Claude and Codex.
4. Run the Claude Code or Codex setup on the integration page.
5. Restart the client and start using it.

## Config files

```text
%USERPROFILE%\.ocgt\config.json
%USERPROFILE%\.ocgt\providers.json
%USERPROFILE%\.codex\config.toml
%USERPROFILE%\.codex\ocgt-model-catalog.json
```

- `config.json`: local proxy, preferences, quota, and Hub settings.
- `providers.json`: Claude / Codex provider and account settings.
- Files under `.codex` are written by the Codex setup.

## Command line

```powershell
ocgt init       # initialize default config
ocgt serve      # run the proxy service in the background
ocgt claude-env # print the current Claude provider's environment variables
ocgt ccswitch   # emit provider JSON in CC Switch format
ocgt version    # show version
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

Building on Linux requires the system `webkit2gtk-4.1` and the `-tags webkit2_41` build flag.

## Versions

- `main` is the current v4 line (new UI plus all features above).
- The older v2.x line is kept on the [`main-old`](../../tree/main-old) branch with full history, for the earlier UI or for reference.

## Known limitations

1. The Codex App model picker may still show only `Custom`; the actual request uses the root-level `model` ocgt wrote.
2. Usage stats depend on token / cache fields returned by the upstream; some gateways omit them.
3. Costs are estimates and may differ from the final bill.
4. Encrypted reasoning signatures are not portable across providers, so Responses encrypted reasoning is not forwarded to Anthropic upstreams (only the readable summary is kept).

## License

MIT License

## Invitation link

Subscribe to the go plan via: https://opencode.ai/go?ref=75Q34GPBZ1
