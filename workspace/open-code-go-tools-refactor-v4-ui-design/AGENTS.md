# AGENTS.md

## Project

`ocgt` is a Go + Wails desktop app and local proxy for Claude-compatible clients.
It exposes an Anthropic-compatible local API, forwards to OpenAI-compatible
upstreams, and provides GUI/CLI helpers for Claude Code, VS Code terminals, and
Claude Desktop.

## Working Rules

- Keep changes small and boring. Delete or reuse before adding new code.
- Do not add dependencies unless the standard library or existing code cannot do it.
- Preserve user settings and secrets. Any config writer must merge existing files,
  create a backup before first mutation, and never print full API keys or tokens.
- Use atomic writes for config files. This repo already has helpers for that.
- Keep CLI, Wails app, and VS Code behavior sharing the same underlying config
  logic where possible.
- Do not claim Codex support through `ANTHROPIC_*`; Codex uses its own
  `config.toml` and provider settings.

## Commands

```powershell
go test ./...
go run . help
go run . init --config .\.tmp\ocgt-config.json --force
```

For Wails UI changes, run the smallest build/dev check available locally:

```powershell
wails dev
```

## Acceptance

- Non-trivial behavior changes include one focused test or a runnable self-check.
- Config changes preserve existing unknown fields and user-owned settings.
- CLI help and docs stay aligned when adding commands.
- UI labels, Wails bindings, and generated frontend bindings stay aligned when
  adding app actions.

