# Codex One-Click Config Spec

## Goal

Add a Codex setup path that works consistently from Codex CLI, Codex app, and the
Codex VS Code/IDE extension.

## Current Boundary

Codex does not use `ANTHROPIC_*` settings. It reads `AGENTS.md` plus
`config.toml`. Provider/auth settings such as `model_provider`,
`model_providers`, and `openai_base_url` belong in the user-level
`~/.codex/config.toml`; Codex ignores those keys in project-local
`.codex/config.toml`.

This repo's local proxy currently serves Anthropic-compatible `/v1/messages`.
Do not point Codex at `http://127.0.0.1:8787` unless ocgt also exposes an
OpenAI-compatible Responses or Chat Completions client endpoint.

## Files

- `AGENTS.md`: durable AI-readable repo rules, commands, and acceptance.
- `.codex/config.toml`: project-scoped Codex defaults only.
- Future global user config writer: updates `~/.codex/config.toml`, not this repo.

## CLI

Acceptance:

- `codex` launched from repo root loads `AGENTS.md`.
- `codex status` reports this repo as the workspace root.
- `codex exec "summarize project rules"` mentions the Go/Wails checks from
  `AGENTS.md`.
- No startup warning says project `.codex/config.toml` ignored provider keys.

## Codex App

Acceptance:

- Opening this folder in the Codex app applies the same `AGENTS.md` rules.
- App agent settings inherit project `.codex/config.toml`.
- Any future one-click button writes only user-level Codex provider config after
  explicit user action.

## VS Code / IDE Extension

Acceptance:

- Opening this repo in VS Code/Cursor/Windsurf with the Codex extension loads
  `AGENTS.md`.
- The extension shares the same Codex config layers as CLI.
- No VS Code `settings.json` mutation is required for normal Codex behavior.

## Future One-Click Writer

If ocgt adds a "Configure Codex" app/CLI action, it must:

1. Read `~/.codex/config.toml`; create it if missing.
2. Create `~/.codex/config.toml.ocgt-bak` before the first mutation.
3. Merge only the ocgt-owned block; preserve all unknown keys and comments if a
   TOML-preserving parser exists, otherwise document that comments may be lost.
4. Write atomically with `0600` permissions.
5. Provide undo that restores the backup or removes only the ocgt-owned block.
6. Verify Codex can start without config warnings.

Example user-level block, only after ocgt has an OpenAI-compatible client API:

```toml
model_provider = "ocgt"
model = "kimi-k2.6"

[model_providers.ocgt]
name = "ocgt"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OCGT_CODEX_API_KEY"
wire_api = "responses"
```

ponytail: this spec stops before implementing a writer because the current proxy
does not expose a Codex-compatible client API; add the writer after that endpoint
exists.

