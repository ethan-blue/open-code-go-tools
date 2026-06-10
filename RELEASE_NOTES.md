# Release Notes - v2.0.0

## 🌐 语言选择 / Language
* [简体中文 (Simplified Chinese)](#-ocgt-v203---v203-版本说明)
* [English](#-ocgt-v203---release-notes)

---

# 🇨🇳 ocgt v2.0.3 - v2.0.3 版本说明

## 修复

- **费用估算双重计费（严重）**：`EstimateCost` 对缓存读取的 tokens 既按全价计费又按缓存价计费，导致有缓存的请求费用虚高约 2-23 倍。修复后费用估算恢复正常值
- **`extractUsageFromAnthropicStream` 缺字段**：该函数只解析 `message_delta` 事件中的 usage，遗漏了 `message_start` 中的 `input_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`。修复后走 Anthropic 原生流式的请求可正确记录 input 和 cache 字段
- **重试导致请求次数虚高**：每次重试失败都写入历史记录，导致 1 次用户请求在统计中最多被计为 6 次。修复后仅在最终失败或成功时记录一次
- **`modelBreakdown` 缓存命中率误含写入**：命中率分子使用了 `CacheRead + CacheCreation`，修复后只使用 `CacheRead`
- **流式 `message_delta` 缺 `input_tokens`**：OpenAI → Anthropic 协议转换的合成 `message_delta` 未包含 `input_tokens`，下游客户端无法获取真实 input_tokens。修复后补全
- **README 已知限制过时**：原说明称 cache 字段始终为 0，现已支持

---

# 🇺🇸 ocgt v2.0.3 - Release Notes

## Fixes

- **Cost double-counting (critical)**: `EstimateCost` billed cache read tokens at both full input price and cache read price, inflating costs by 2-23x for cached requests. Fixed
- **`extractUsageFromAnthropicStream` missing fields**: Only parsed `message_delta` events, missing `input_tokens`/cache fields from `message_start`. Fixed
- **Retry entries inflating request count**: Each failed retry created a history entry, counting 1 user request as up to 6. Fixed
- **`modelBreakdown` cache hit rate included writes**: Used `CacheRead + CacheCreation` as numerator. Fixed to use `CacheRead` only
- **Streaming `message_delta` missing `input_tokens`**: OpenAI→Anthropic conversion didn't include real `input_tokens`. Fixed
- **Outdated README limitations**: Cache fields are now supported

---

# Release Notes - v2.0.0

## 🌐 语言选择 / Language
* [简体中文 (Simplified Chinese)](#-ocgt-v2.0.0---极简原生双语控制面板发布)
* [English](#-ocgt-v2.0.0---premium-bilingual-desktop-control-panel-release)

---

# 🇨🇳 ocgt v2.0.0 - 极简原生双语控制面板发布

本版本聚焦于**极致的原生中英双语优化**、**Wails 桌面客户端深度打磨**，并针对 **OpenCode Go** 服务订阅包和 **Claude Code** 工作流进行了极致的极简配置提炼。

## 🚀 核心升级与亮点

### 1. 彻底的全局中英双语切换 (Polished Bilingual Engine)
- **动态窗口标题栏 (Top-Left Title Bar)**：彻底告别静态标题！在 GUI 右下角点击 `EN / 中` 切换时，窗口左上角的系统标题栏将随语言实时改变（`ocgt 控制面板` / `ocgt Control Panel`）。
- **拉起终端完全汉化/英化 (Spawned Terminal Welcome Greetings)**：点击“一键拉起配置终端 (Launch)”拉起原生 CMD/PowerShell 窗口后，窗口首行的代理版本、注入变量提示、当前模型及调试引导语（如 `Please type 'claude' below to start coding:`）将完全契合您所选的语言！
- **极简化全局翻译机制**：补全了所有下拉菜单选择项（`<option>`）的内置中英文翻译。

### 2. 精致融合的系统托盘 (Bilingual System Tray Menu)
- **中英双语整合菜单**：系统托盘右键菜单经过重构，升级为中英双语融合的高阶样式：
  - 工具提示：`ocgt Control Panel / 控制面板 - Claude API Local Proxy`
  - 显示面板：`显示控制面板 (Show Panel)`
  - 隐藏面板：`隐藏控制面板 (Hide Panel)`
  - 退出代理：`退出程序 (Quit)`

### 3. OpenCode Go 首选项聚焦与极简化 (Simplified SaaS Preferences)
- 重构配置中心与主界面指标，隐去冗余参数，专为 OpenCode Go 代理密钥填入进行卡片与控件层面的极简式聚焦。
- **思考强度下拉选择**：提供固定且直观的思考上限选择（快速、慢速、深度、极客、关闭），从根源杜绝文本误配造成的代理闪退。

### 4. 隐式高可用机制 (Implicit Reliability Shields)
- **多模型自动轮询与 Fallback 机制**：当下游模型请求因拥堵出现高延迟或触发 `429` 频限时，代理服务将在底层自动且无感地按设置轮询切换至备用模型，保障会话绝不中断。
- **状态熔断器 (Circuit Breaker)**：增加进程内线程安全熔断，遭遇多次硬连接超时或上游断线后自动熔断故障模型 30 秒，fail-fast 及时反馈。
- **热重载监听 (Hot-Reload File Watcher)**：在后台以 2.5 秒频率实时轮询配置文件修改状态，无需重启客户端，随时随地应用配置变动。

---

## 🛠️ 本地验证与编译产物

- 已运行自动化单元测试并通过所有 Go test 工具验证：`go test ./...`
- 已构建并测试完生产环境下 Windows 原生 x64 可执行文件：
  ```text
  build\bin\ocgt_v2.0.0.exe
  ```

---

# 🇺🇸 ocgt v2.0.0 - Premium Bilingual Desktop Control Panel Release

This release focuses on **comprehensive native bilingual integration**, **polishing the Wails desktop environment**, and delivering a highly streamlined experience specifically tailored for **OpenCode Go** subscription setups and the official **Claude Code** workflow.

## 🚀 Key Upgrades & Highlights

### 1. Flawless Dynamic Bilingual Engine
- **Dynamic Window Title (Top-Left Title Bar)**: No more static titles! Clicking the `EN / 中` toggle in the sidebar footer now instantly updates Wails window title bar dynamically (`ocgt Control Panel` / `ocgt 控制面板`).
- **Bilingual Spawning Console (Spawned Terminal Greetings)**: Clicking **"Launch Pre-configured Terminal"** to open CMD/PowerShell now passes the active language parameter. The welcome banner, environment injection logs, active model outputs, and guide messages (e.g. `Please type 'claude' below to start coding:`) will dynamically render in your chosen language!
- **Complete Options Translation**: Annotated and completed translation mappings for all nested `<option>` selection elements in the configuration forms.

### 2. Harmonized Bilingual System Tray Menu
- **Bilingual System Tray**: Refined the background task menu with elegant dual-language labels for global audiences:
  - Tooltip: `ocgt Control Panel / 控制面板 - Claude API Local Proxy`
  - Show Action: `显示控制面板 (Show Panel)`
  - Hide Action: `隐藏控制面板 (Hide Panel)`
  - Quit Action: `退出程序 (Quit)`

### 3. Streamlined Preferences Tailored for OpenCode Go
- Streamlined configuration centers to focus visually and functionally on entering upstream **OpenCode Go API Keys** with maximum simplicity.
- **Reasoning Intensity Prefereces**: Replaced numeric token configurations with straight-forward Reasoning Budget options (Fast, Slow, Deep, Geek, Off) to prevent accidental typos or invalid inputs.

### 4. Under-the-Hood Reliability Shields
- **Seamless Model Fallback Chains**: If an upstream model experiences network degradation or hits rate limits (`429`), the Go proxy silently fallbacks to alternative models configured in the profile's chain with zero conversation interruption.
- **Stateful Circuit Breaker**: Thread-safe circuit breakers trip a model for 30 seconds after consecutive hard connection timeouts, implementing a fail-fast mechanism.
- **Hot-Reload Watcher**: Automatically polls the configuration file's modification times every 2.5 seconds, dynamically loading preferences into memory without restarting the executable.

---

## 🛠️ Local Verification & Build Outputs

- Successfully verified code compliance and passing Go test suites: `go test ./...`
- Compiled and tested the native Windows production binary:
  ```text
  build\bin\ocgt_v2.0.0.exe
  ```
