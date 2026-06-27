# ocgt - Claude Code Desktop Client & Local Proxy



> 🌐 **[简体中文版 (Chinese Version)](../README.md)**



`ocgt` (OpenCode Go Tools) is a desktop app for Claude Code. Two things at its core: a local proxy that handles Anthropic ↔ OpenAI protocol conversion, and a GUI panel for managing your API Key, monitoring traffic, and launching terminals. Supports Chinese and English. Current version v2.2.1.



No need to mess with environment variables or edit system hosts. Open the app, paste your API Key, pick a model, and you're coding.

---

## 🖥️ Core Features & Showcases

### 📊 System Status Dashboard

![System Status](../assets/2026-05-30_213807.png)

* **Real-time Monitoring**: Check proxy listening ports (default `127.0.0.1:8787`), upstream API status, and API Key configuration.

* **Quick Access**: See config file paths and open the directory in one click.



### ⚙️ Configuration Management

![Configuration Settings](../assets/2026-05-30_213821.png)

* **Hot Reload**: Enter your API Key and save — changes take effect immediately, no restart needed.

* **Model Mapping**: Map Claude Sonnet / Haiku / Opus to whichever upstream models you want.

* **Reasoning Intensity**: Fast / Slow / Deep / Geek / Off — fixed thinking budget settings.

* **Same-model Retry**: 5 exponential backoff retries + 30s circuit breaker.



### 💻 Quick Connect

![Terminal Activation](../assets/2026-05-30_213831.png)

* **One-click Terminal**: Pick a shell (PowerShell / Bash / CMD) and launch it with all proxy env vars injected.

* **Client Integration**: Four options — CLI (global settings.json), VS Code, Claude Code settings, Claude Desktop App (3P Profile).

* **One-click Repair**: Fix all configured integrations at once.



### 📡 Traffic Stats

* Token count / requests / success rate / average latency, with auto-adapting hour/day/week granularity.

* **Traffic Details** (Ctrl+5): Full-field table with 3-axis filtering (time + model + status), pagination, CSV export.



### 📊 Quota Dashboard

* Rolling / Weekly / Monthly quota progress bars.

* Auto-refresh every 5 seconds, or refresh manually.



### 🧩 Companion Tool — [ocgt-monitor](https://github.com/xxtt-01/ocgt-monitor)

* Standalone terminal monitor for ocgt proxy request logs.

* Color-coded output with filtering and stats.

* Pairs well with ocgt GUI for full-screen terminal workflows.



### 🎨 Preferences

* Theme: Light / Dark / System · 5 presets + custom hue slider.

* Language: 中文 / English.

* Window close: Ask every time / Minimize to tray / Quit.

---

## 🚦 Quick Start



1. **Download**: Grab the latest build from [Releases](../../releases) for your OS.

2. **Configure**: Open the **Configuration** page (Ctrl+2) → enter your **API Key** → pick a model → save.

3. **Launch**: Go to **Quick Connect** (Ctrl+3) → choose a shell → click **Launch** → type:

   ```bash

   claude

   ```

---

## 📁 Configuration & Hot Reload



Config is stored locally:

```text

%USERPROFILE%\.ocgt\config.json

```

Edit this file externally and the proxy picks up changes automatically within ~3 seconds — no restart needed.

---

## 💻 CLI Reference

Prefer the GUI? Skip this. But `ocgt` also has CLI commands:

```powershell
ocgt init       # Create default config
ocgt serve      # Run proxy in the background
ocgt claude-env # Print current profile env vars
ocgt ccswitch   # Output CC Switch provider JSON
ocgt version    # Show version
```

---

## 🛠️ Build & Development

Requires Go 1.22+ and Wails CLI for compilation.

**Install Wails CLI**:
```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

**Run Development Mode**:
```powershell
wails dev
```

**Build Production Executable**:
```powershell
.\build.bat
```

---

## 📄 License

This project is licensed under the **MIT License**.
