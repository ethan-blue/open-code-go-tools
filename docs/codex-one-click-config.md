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

ocgt exposes an OpenAI-compatible `/v1/responses` client endpoint for Codex.
Codex always talks Responses API to ocgt; ocgt then routes to the active Codex
provider's configured upstream protocol.

## Files

- `AGENTS.md`: durable AI-readable repo rules, commands, and acceptance.
- `.codex/config.toml`: project-scoped Codex defaults only.
- Global user config writer: updates `~/.codex/config.toml`, not this repo.

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
- The one-click button writes only user-level Codex provider config after
  explicit user action.

## VS Code / IDE Extension

Acceptance:

- Opening this repo in VS Code/Cursor/Windsurf with the Codex extension loads
  `AGENTS.md`.
- The extension shares the same Codex config layers as CLI.
- No VS Code `settings.json` mutation is required for normal Codex behavior.

## One-Click Writer

The "Codex CLI / App" action must:

1. Read `~/.codex/config.toml`; create it if missing.
2. Create `~/.codex/config.toml.ocgt-bak` before the first mutation.
3. Merge only the ocgt-owned block and strip stale root `model`,
   `model_provider`, and `model_catalog_json` keys so Codex does not see TOML
   duplicate-key errors.
4. Write atomically with `0600` permissions.
5. Provide undo that restores the backup or removes only the ocgt-owned block.
6. Write `~/.codex/ocgt-model-catalog.json` from the active Codex provider's
   default model, configured model list, fallback chain, message models, aliases,
   and any upstream `/v1/models` response.
7. Verify Codex can start without config warnings.
8. Tell the user to restart Codex after setup; `model_catalog_json` is read at
   startup.

Example user-level block:

```toml
# ocgt-managed-begin
model_provider = "custom"
model = "kimi-k2.6"
model_catalog_json = "C:\\Users\\you\\.codex\\ocgt-model-catalog.json"

[model_providers.custom]
name = "ocgt"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OCGT_CODEX_API_KEY"
wire_api = "responses"
# ocgt-managed-end
```

Codex Desktop currently treats third-party providers as `Custom` in the model
picker. ocgt therefore writes the provider id as `custom` for desktop
compatibility, while the provider display `name` remains `ocgt`. The important
runtime values are the root-level `model_provider = "custom"` and
`model = "..."`; the desktop UI may still show only `Custom`, but requests are
sent to the configured ocgt local proxy and default model after restart.

