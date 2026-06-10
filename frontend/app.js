const APP_VERSION = 'v2.0.3';
const DEFAULT_CLOSE_BEHAVIOR = 'prompt';
const CLOSE_BEHAVIORS = new Set(['prompt', 'minimize', 'exit']);
const ALLOWED_THINKING_BUDGETS = ['256', '512', '1024', '2048', '-1'];
const THEME_VALUES = new Set(['light', 'dark', 'system']);
const LANGUAGE_VALUES = new Set(['zh', 'en']);
const VIEW_VALUES = new Set(['dashboard', 'settings', 'terminal', 'history', 'traffic-detail']);
const COMPACT_SHELL_VALUES = new Set(['powershell', 'cmd', 'bash']);
const INTEGRATION_IDS = ['quick', 'cli', 'vscode', 'claude-desktop'];



// ── Model Registry (single source of truth) ──

// Add/remove models here — all <select> dropdowns update automatically.

let MODEL_REGISTRY = [

    // { id, label, recommended?, category }

    { id: 'kimi-k2.6', label: 'kimi-k2.6', recommended: true, category: 'Kimi' },

    { id: 'kimi-k2.5', label: 'kimi-k2.5', recommended: false, category: 'Kimi' },

    { id: 'qwen3.7-max', label: 'Qwen3.7 Max', recommended: true, category: 'Qwen' },

    { id: 'qwen3.6-plus', label: 'qwen3.6-plus', recommended: false, category: 'Qwen' },

    { id: 'qwen3.5-plus', label: 'qwen3.5-plus', recommended: false, category: 'Qwen' },

    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', recommended: true, category: 'DeepSeek' },

    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', recommended: false, category: 'DeepSeek' },

    { id: 'glm-5.1', label: 'glm-5.1', recommended: true, category: 'Zhipu' },

    { id: 'glm-5', label: 'glm-5', recommended: false, category: 'Zhipu' },

    { id: 'hy3-preview', label: 'hy3-preview', recommended: false, category: 'Hunyuan' },

    { id: 'mimo-v2.5-pro', label: 'mimo-v2.5-pro', recommended: false, category: 'MiMo' },

    { id: 'mimo-v2.5', label: 'mimo-v2.5', recommended: false, category: 'MiMo' },

    { id: 'minimax-m2.7', label: 'minimax-m2.7', recommended: false, category: 'MiniMax' },

];

try {
    const savedModels = localStorage.getItem('synced_models');
    if (savedModels) {
        const parsed = JSON.parse(savedModels);
        if (Array.isArray(parsed)) {
            const existingIds = new Set(MODEL_REGISTRY.map(m => m.id));
            for (const nm of parsed) {
                if (!existingIds.has(nm.id)) {
                    MODEL_REGISTRY.push(nm);
                    existingIds.add(nm.id);
                }
            }
        }
    }
} catch (e) {
    console.error('Failed to load synced models from local storage', e);
}


// Default recommended model per mapping slot (overridden by config if set)

const MAPPING_DEFAULTS = {

    sonnet: 'qwen3.6-plus',

    haiku: 'deepseek-v4-flash',

    opus: 'kimi-k2.6',

};



// ── Accent color presets ──

const ACCENT_PRESETS = [

    { hue: 174, name: 'Teal' },

    { hue: 212, name: 'Blue' },

    { hue: 260, name: 'Purple' },

    { hue: 25, name: 'Orange' },

    { hue: 330, name: 'Pink' },

];



let API_BASE = 'http://127.0.0.1:8787';
let systemStatus = null;
let currentShell = 'powershell';
let proxyReady = false;
let currentLang = localStorage.getItem('lang') || 'zh';
let originalSettingsValues = {};
let LOCAL_AUTH_TOKEN = '';
let isLoadingDashboard = true;
let isInitializing = false;
let _consecutiveFailures = 0;
let integrationStatusChecking = false;
let integrationStatusTimer = null;
let uiPreferencesLoaded = false;
let uiPreferencesSaveTimer = null;
let activeCustomModelCancel = null;
let activeRawJsonClose = null;

// ══════════════════════════════════════════════════════
// §2 — i18n Dictionary
// ══════════════════════════════════════════════════════

const i18n = {
    zh: {
        nav_dashboard: "系统状态",
        nav_settings: "配置管理",
        nav_terminal: "快速连接",
        nav_history: "流量监控",
        status_running: "代理运行中",
        status_connecting: "代理连接中",
        status_online: "代理已连接",
        status_offline: "代理未连接",
        status_api_key_configured: "已配置",
        status_api_key_not_configured: "未配置",
        status_model_unset: "未设定",
        status_not_configured: "未配置",
        status_saving: "保存中...",
        status_success: "已保存 ✓",
        service_normal: "服务正常",
        service_connecting: "服务连接中",
        service_offline: "服务离线",
        title_dashboard: "系统状态监控",
        subtitle_dashboard: "查看当前代理服务运行指标与后台状态",
        title_settings: "一键配置管理中心",
        subtitle_settings: "快速设置您的 API 密钥与高阶 Claude 模型代理映射",
        title_terminal: "快速连接",

        subtitle_terminal: "一键将代理接入终端、编辑器与 Claude 客户端",
        hint_desktop_config_short: "一键将 ocgt 代理配置写入 Claude Code settings.json",
        title_history: "流量雷达监控",
        subtitle_history: "实时捕获并通过仪表盘统计来自 Claude Code 的 API 请求日志",
        lbl_listen: "监听地址",
        lbl_upstream: "上游 API 节点",
        lbl_timeout: "请求超时",
        lbl_api_key: "API Key 状态",
        lbl_profile: "当前活跃 Profile",
        lbl_model: "默认解析模型",
        dash_integrations: "客户端集成状态",
        dash_cli: "CLI",
        dash_vscode: "VS Code",
        dash_claude_desktop: "Claude Desktop",
        lbl_config_path: "本地配置文件路径",
        lbl_desktop_config: "Claude Code settings 配置",
        lbl_last_updated: "刚刚更新",
        btn_open_folder: "打开所在文件夹",
        sett_title: "一键配置管理中心",
        sett_section_api: "API 代理配置",
        sett_section_api_desc: "Profile、API Key、默认模型与超时",
        sett_section_network: "网络与限流",
        sett_section_network_desc: "上游 API 地址、监听端口与请求限制",
        sett_section_model: "模型策略设置",
        sett_section_model_desc: "思考强度与 Claude 模型别名映射",
        sett_section_prefs: "偏好设置",
        sett_profile: "当前配置 Profile",
        sett_default_model: "全局默认模型",
        sett_api_key: "代理 API 密钥",
        placeholder_api_key: "请输入您的 sk-... 密钥",
        sett_upstream: "上游 API 地址",
        sett_timeout: "请求超时（秒，1-3600）",
        sett_rate_minute: "每分钟请求上限",
        sett_thinking: "思考强度（支持模型生效）",
        opt_thinking_256: "低",
        opt_thinking_512: "中",
        opt_thinking_1024: "高",
        opt_thinking_2048: "极高",
        opt_thinking_off: "关",
        sett_mapping_title: "Claude 模型映射",

        sett_mapping_sonnet: "Sonnet",

        sett_mapping_haiku: "Haiku",

        sett_mapping_opus: "Opus",
        sett_advanced_title: "高级代理参数",
        sett_rate_limit: "每秒请求上限",
        sett_rate_burst: "突发请求容量",
        sett_claude_env_template: "Claude Code 环境变量模板",
        sett_advanced_summary: "监听、限流、环境变量与 JSON",
        sett_log_title: "日志存储",
        sett_log_desc: "日志保存路径与保留周期",
        sett_env_title: "高级环境变量",
        sett_env_desc: "Claude Code 环境参数开关与自定义 JSON 配置",
        env_disable_nonessential: "禁用非必要流量",
        env_enable_tool_search: "Tool Search",
        env_disable_attribution: "禁用 Attribution",
        env_disable_thinking: "禁用 Thinking",
        env_max_output_tokens: "Max Output Tokens",
        env_max_mcp_tokens: "Max MCP Tokens",
        env_api_timeout: "API Timeout (ms)",
        env_mcp_timeout: "MCP Timeout (ms)",
        btn_edit_settings_json: "编辑 settings.json",
        btn_sync_models: "同步上游模型",
        opt_custom: "自定义模型...",
        btn_save_config: "保存配置",
        btn_repair_env: "一键修复 Claude Code 系统环境变量",
        btn_reset_defaults: "重置为默认值",
        btn_about_app: "关于 ocgt",
        btn_clear_history: "清除历史记录",
        hint_save: "保存只更新代理配置和当前已配置的目标；未配置的 CLI、VS Code 或 Claude Desktop 不会被写入。",
        hint_tip: "💡 提示：只需在“客户端集成”中一键激活或配置您的终端，新建窗口即可开箱即用，无需在此做重复修改。",
        hint_changes_detected: "检测到未保存的更改",
        btn_cancel_changes: "取消更改",
        sync_profile: "Profile",
        sync_listen: "监听",
        sync_cli: "CLI",
        sync_vscode: "VS Code",
        sync_claude: "Claude Desktop",
        sync_active: "已配置",
        token_log_on: "日志开启",
        token_log_off: "日志关闭",
        term_title: "一键唤醒代理控制台",
        term_shell_type: "目标命令行类型",
        btn_launch_term: "一键拉起配置终端 (Launch)",
        btn_persistent_env: "修复以后所有新终端环境变量",

        btn_setup_desktop: "配置 Claude Code settings",

        status_configuring: "配置中...",
        btn_setup_desktop_configured: "✓ 已配置 | 重新配置",
        btn_clear_desktop_config: "清除配置",
        status_clearing: "清除中...",

        toast_desktop_setup_fail: "配置失败",

        hint_launch: "一键注入当前 Profile 代理变量并打开原生 shell。直接打 <code>claude</code> 即可开始运行！",
        guide_title: "💡 快捷运行极简指南",
        guide_1: "在上方选项卡选择您常用的命令终端。",
        guide_2: "点击 <b>\"一键拉起配置终端\"</b>，系统会自动唤醒控制台。",
        guide_3: "直接在拉起的窗口中键入 <code>claude</code> 即可启动 AI 代码对话。",
        guide_4: "（可选）若要在已有终端中工作，可点击右侧的复制按钮导入配置。",
        guide_5: "<b>提示</b>：终端类型只需选择并一键启动任意一个即可，无需全部配置或启动。",
        code_env_title: "Claude Code 环境变量",
        code_ccswitch_title: "CC Switch 提供商配置",
        btn_copy: "复制",
        btn_copied: "已复制 ✓",
        traf_total: "总吞吐请求量",

        traf_rate: "请求成功率",

        traf_latency: "平均响应延时",

        traf_tokens: "Token 消耗",

        traf_limit: "请求限制",

        traf_token_detail: "Token 消耗明细",

        traf_input_output: "input + output",

        traf_rpm_hint: "RPM / 配额",
        traf_filter_source: "来源",
        traf_filter_all: "全部来源",
        traf_filter_cli: "CLI",
        traf_filter_vscode: "VS Code",
        traf_filter_desktop: "Claude Desktop",
        traf_filter_count: "显示 {{shown}} / {{total}} 条",

        th_tokens: "Tokens",
        th_client: "来源",
        client_unknown: "未知",

        th_time: "时间",
        th_method: "方法",
        th_path: "路由路径",
        th_model: "解析模型",
        th_status: "状态码",
        th_duration: "耗时",
        th_error: "错误原因",
        traf_empty: "暂无流量记录。请使用一键终端或在其他 Shell 中向代理发送请求...",
        traf_empty_filtered: "当前来源筛选下没有流量记录。切换为“全部来源”可查看其他请求。",
        traf_listening: "实时流量雷达持续监听中",
        opt_model_kimi_26: "kimi-k2.6",

        opt_model_qwen_36: "qwen3.6-plus",

        opt_model_deepseek_pro: "deepseek-v4-pro",

        opt_model_deepseek_flash: "deepseek-v4-flash",

        opt_model_glm_51: "glm-5.1",

        opt_model_hy3_preview: "hy3-preview",

        opt_mapping_sonnet_default: "qwen3.6-plus (recommended)",

        opt_mapping_haiku_default: "deepseek-v4-flash (recommended)",

        opt_mapping_opus_default: "kimi-k2.6 (recommended)",
        sett_close_behavior: "关闭窗口行为",
        opt_close_prompt: "每次询问",
        opt_close_minimize: "隐藏到托盘，代理继续运行",
        opt_close_exit: "退出程序，停止代理",
        close_dialog_title: "关闭窗口",
        close_dialog_msg: "隐藏到托盘会继续代理请求；退出程序会停止本地代理。",
        close_dialog_exit: "退出并停止代理",
        close_dialog_minimize: "隐藏到托盘并继续代理",
        close_dialog_cancel: "取消",
        about_desc: "专为 Claude Code 与 OpenCode Go 打造的极简桌面控制面板与代理",
        about_author: "作者",
        about_license: "许可证",
        about_project: "项目地址",
        about_close: "关闭",
        err_api_key_required: "请输入 API Key",
        err_upstream_url: "请输入有效的 http(s) 地址",
        err_listen_addr: "请输入有效的监听地址，例如 127.0.0.1:8787 或 :8787",
        err_timeout_range: "超时必须在 1-3600 秒之间",
        err_rate_limit_range: "范围必须在 1-10000 之间",
        err_rate_burst_range: "范围必须在 1-100000 之间",
        err_rate_minute_range: "范围必须在 0-100000 之间，0 表示不限量",
        err_claude_env_json: "必须是 JSON 对象，键和值都必须是字符串",
        toast_saved: "配置已保存；已配置目标已同步刷新",
        toast_save_failed: "保存失败",
        toast_env_repaired: "环境变量已修复并写入系统",
        toast_env_repair_failed: "环境变量修复失败",
        toast_copy_success: "已复制到剪贴板",
        toast_copy_failed: "复制失败",
        toast_profile_changed: "Profile 已切换",
        toast_launch_failed: "终端启动失败",
        toast_launch_success: "终端已成功启动",

        toast_desktop_setup_success: "✓ Claude Code settings 已配置。重新打开 Claude Code 后生效。验证方式：发送一条消息，观察 ocgt 日志中的请求记录。",
        toast_desktop_verify_hint: "验证方式：启动桌面版后发送一条消息，观察 ocgt 日志中的请求记录。",
        toast_desktop_cleared: "Claude Code settings 配置已清除",

        toast_history_cleared: "历史记录已清除",
        toast_validation_error: "请检查表单中的错误",
        toast_custom_model_prompt: "请输入自定义模型名称",
        custom_model_title: "添加自定义模型",
        custom_model_desc: "输入上游支持的模型 ID，保存后会写入当前 Profile。",
        custom_model_label: "模型名称",
        custom_model_placeholder: "例如 qwen3.6-plus 或 vendor/model-name",
        custom_model_cancel: "取消",
        custom_model_confirm: "使用此模型",
        custom_model_required: "模型名称不能为空",
        custom_model_too_long: "模型名称不能超过 128 个字符",
        toast_reset_confirm: "确定要重置所有设置为默认值吗？",
        toast_reset_done: "设置已重置为默认值",
        toast_confirm: "确认重置",
        // Terminal launch states
        term_launching: "启动中...",
        term_launched: "已启动终端 ✓",
        // Desktop-only warnings
        warn_desktop_only_launch: "一键启动终端仅在桌面版 app 客户端可用，请在桌面端中点击使用！",
        warn_desktop_only_env: "Claude Code settings 配置接口未初始化，请尝试重启 ocgt",
        warn_desktop_only_folder: "该功能仅在桌面客户端可用。您的配置文件夹通常在您的个人用户目录下的 .ocgt 文件夹中。",
        // Env repair states
        env_repairing: "修复中...",
        env_repaired_hint: "已修复，重新打开终端生效",
        // Connection status with unconfigured key
        status_connected_no_key: "代理已连接，密钥未配置",
        // Open folder errors
        err_open_folder: "打开失败",
        err_open_folder_generic: "无法打开文件夹",
        // Footer
        footer_text: "ocgt \u00A9 2026 \u00B7 MIT Licensed \u00B7 Official OpenCode Go Companion Center",
        // Preferences popover
        pref_title: "偏好设置",
        pref_language: "界面语言",
        pref_appearance: "外观",
        pref_appearance_desc: "主题模式与界面语言",
        pref_theme: "主题模式",
        pref_theme_light: "浅色",
        pref_theme_dark: "深色",
        pref_theme_system: "跟随系统",

        pref_accent_color: "主题色",

        pref_network: "网络",

        pref_network_desc: "代理监听地址与端口",

        pref_listen_addr: "监听地址",

        btn_apply_restart: "应用并重启",

        pref_behavior: "行为",

        pref_behavior_desc: "关闭窗口与系统交互",
        pref_logs: "日志",
        pref_logs_desc: "日志保存路径与保留周期",
        pref_log_save: "GUI 日志保存",
        pref_log_dir: "日志目录",
        pref_log_retention: "保留天数",
        btn_open_log_dir: "打开",
        btn_save_log_prefs: "保存日志设置",
        toast_log_prefs_saved: "日志设置已保存",
        toast_log_prefs_failed: "日志设置保存失败",
        raw_json_title: "编辑 Claude Code settings.json",
        raw_json_desc: "高级入口：只修改 ~/.claude/settings.json。保存前请确认 JSON 格式有效。",
        raw_json_cancel: "取消",
        raw_json_save: "保存 settings.json",
        raw_json_loading: "加载中...",
        raw_json_load_failed: "加载 settings.json 失败: ",
        raw_json_save_failed: "解析或保存 settings.json 失败: ",
        raw_json_saved: "Claude Code settings.json 已保存",
        pref_danger: "重置与关于",
        pref_danger_desc: "恢复默认设置或查看版本信息",
        badge_not_configured: "未配置",
        badge_active: "已配置 ✓",
        badge_inactive: "未配置",
        badge_recommended: "推荐",
        integration_reapply_hint: "已配置；可再次点击补写当前 Profile 的代理配置。",
        int_quick_title: "快速开始：临时终端",
        int_quick_desc: "只为当前新开的终端窗口临时注入代理变量，不写入系统配置；可以连续打开多个窗口。",
        btn_launch_temp_term: "打开临时终端",
        repair_title: "一键修复",
        repair_desc: "修复 Claude Code settings、基础环境变量，并刷新已配置过的 VS Code / Claude Desktop 集成。",
        btn_repair_all: "一键修复",
        toast_repair_all_success: "基础配置和已配置集成已修复",
        toast_repair_all_failed: "一键修复失败",
        int_sys_title: "Claude Code CLI",
        btn_sys_install: "一键激活",
        btn_sys_remove: "移除配置",
        int_sys_desc: "将代理地址自动写入 ~/.claude/settings.json，Claude Code 在任意终端均可直接使用代理，移除时自动恢复原配置。",
        toast_sys_installed: "全局 JSON 配置已写入！Claude Code 现在将通过代理运行。",
        toast_sys_removed: "已移除代理配置并还原。 (如果有的话)",
        lbl_temp_import: "临时导入 (当前窗口生效):",
        int_vscode_title: "VS Code Claude Code 插件",
        int_vscode_desc: "自动向 VS Code 用户配置注入 ocgt 代理变量。插件或其启动的 Claude Code 进程会继承这些变量，新建会话即可走本地代理。",
        btn_vscode_install: "一键激活",

        btn_vscode_remove: "移除配置",
        int_vscode_tip: "注入后重新打开 VS Code 内的 Claude Code 会话即可验证。",
        int_claude_title: "Claude Code settings",
        int_claude_desc: "将 ocgt 代理写入 <code>~/.claude/settings.json</code>，用于 Claude Code 本地客户端读取代理环境；真实 Claude Desktop App 请使用下方 3P profile。",
        btn_setup_desktop_full: "一键激活",

        btn_clear_desktop_full: "移除配置",
        lbl_desktop_help_title: "Claude Code settings",
        lbl_desktop_help_desc: "这里只写入 Claude Code 读取的 settings.json 环境块，不修改 Claude Desktop 登录状态。",
        int_claude_desktop_title: "Claude Desktop App",
        int_claude_desktop_desc: "按 cc-switch 的 3P profile 方式写入 Claude Desktop 配置，重启 Claude Desktop 后通过 ocgt 本地路由转发。",
        btn_setup_claude_desktop_app: "一键激活",
        btn_clear_claude_desktop_app: "移除配置",
        toast_claude_desktop_app_setup_success: "Claude Desktop App 3P 配置已写入，重启 Claude Desktop 后生效。",
        toast_claude_desktop_app_cleared: "Claude Desktop App 3P 配置已移除。",
        toast_vscode_installed: "VS Code Claude Code 插件配置已注入！",
        toast_vscode_removed: "VS Code Claude Code 插件配置已清除！",
        toast_vscode_failed: "配置 VS Code 失败",
        loading_title: "正在连接本地代理",
        loading_init: "正在初始化代理服务...",
        loading_unavailable_title: "代理暂时不可用",
        loading_unavailable_desc: "本地代理未响应。请检查监听地址、端口占用或配置后重试。",
        proxy_health_timeout: "代理端口未响应 /healthz",
        btn_retry_connection: "重试连接",
        token_total_label: "总计: {{count}} tokens"
    },
    en: {
        nav_dashboard: "Status",
        nav_settings: "Configuration",
        nav_terminal: "Quick Connect",
        nav_history: "Traffic Radar",
        status_running: "Proxy Running",
        status_connecting: "Connecting...",
        status_online: "Connected",
        status_offline: "Disconnected",
        status_api_key_configured: "Configured",
        status_api_key_not_configured: "Unconfigured",
        status_model_unset: "Unset",
        status_not_configured: "Not configured",
        status_saving: "Saving...",
        status_success: "Saved ✓",
        service_normal: "Normal",
        service_connecting: "Connecting...",
        service_offline: "Offline",
        title_dashboard: "System Status Radar",
        subtitle_dashboard: "Monitor real-time proxy metrics and server status",
        title_settings: "Configuration Center",
        subtitle_settings: "Manage your upstream API keys, timeouts, and Claude model aliases",
        title_terminal: "Quick Connect",

        subtitle_terminal: "One-click proxy setup for terminals, editors, and Claude clients",
        hint_desktop_config_short: "One-click write ocgt proxy config into Claude Code settings.json",
        title_history: "Traffic Monitoring Radar",
        subtitle_history: "Real-time capture of API logs and metrics received from Claude Code",
        lbl_listen: "Listen Address",
        lbl_upstream: "Upstream Node",
        lbl_timeout: "Request Timeout",
        lbl_api_key: "API Key Status",
        lbl_profile: "Active Profile",
        lbl_model: "Default Model",
        dash_integrations: "Client Integrations",
        dash_cli: "CLI",
        dash_vscode: "VS Code",
        dash_claude_desktop: "Claude Desktop",
        lbl_config_path: "Local Config Path",
        lbl_desktop_config: "Claude Code settings Config",
        lbl_last_updated: "Updated just now",
        btn_open_folder: "Open Directory",
        sett_title: "Easy Configuration Center",
        sett_section_api: "API Configuration",
        sett_section_api_desc: "Profile, API key, default model, and timeout",
        sett_section_network: "Network & Rate Limiting",
        sett_section_network_desc: "Upstream API URL, listen address, and request limits",
        sett_section_model: "Model Settings",
        sett_section_model_desc: "Reasoning intensity and Claude model alias mapping",
        sett_section_prefs: "Application Preferences",
        sett_profile: "Current Profile",
        sett_default_model: "Global Default Model",
        sett_api_key: "OpenCode Go API Key",
        placeholder_api_key: "Enter your OpenCode sk-... API Key",
        sett_upstream: "Upstream API URL",
        sett_timeout: "Request Timeout (Seconds, 1-3600)",
        sett_rate_minute: "Requests Per Minute",
        sett_thinking: "Reasoning Intensity (Supported Models)",
        opt_thinking_256: "Low",
        opt_thinking_512: "Medium",
        opt_thinking_1024: "High",
        opt_thinking_2048: "Max",
        opt_thinking_off: "Off",
        sett_mapping_title: "Model Alias Mapping",

        sett_mapping_sonnet: "Sonnet",

        sett_mapping_haiku: "Haiku",

        sett_mapping_opus: "Opus",
        sett_advanced_title: "Advanced Proxy Parameters",
        sett_rate_limit: "Requests Per Second",
        sett_rate_burst: "Burst Capacity",
        sett_claude_env_template: "Claude Code Env Template",
        sett_advanced_summary: "Listen, limits, environment variables, and JSON",
        sett_log_title: "Log Storage",
        sett_log_desc: "Log directory and retention policy",
        sett_env_title: "Advanced Environment",
        sett_env_desc: "Claude Code environment toggles and custom JSON",
        env_disable_nonessential: "Disable nonessential traffic",
        env_enable_tool_search: "Tool Search",
        env_disable_attribution: "Disable Attribution",
        env_disable_thinking: "Disable Thinking",
        env_max_output_tokens: "Max Output Tokens",
        env_max_mcp_tokens: "Max MCP Tokens",
        env_api_timeout: "API Timeout (ms)",
        env_mcp_timeout: "MCP Timeout (ms)",
        btn_edit_settings_json: "Edit settings.json",
        btn_sync_models: "Sync Models",
        opt_custom: "Custom model...",
        btn_save_config: "Save Configuration",
        btn_repair_env: "One-click Repair Claude Code System Env",
        btn_reset_defaults: "Reset to defaults",
        btn_about_app: "About ocgt Dashboard",
        btn_clear_history: "Clear history",
        hint_save: "Saving updates proxy configuration and refreshes only already configured targets; unconfigured CLI, VS Code, or Claude Desktop targets are not written.",
        hint_tip: "💡 Tip: Just select and launch any terminal shell of your choice. No need to repeatedly configure all shells.",
        hint_changes_detected: "Unsaved changes detected",
        btn_cancel_changes: "Cancel Changes",
        sync_profile: "Profile",
        sync_listen: "Listen",
        sync_cli: "CLI",
        sync_vscode: "VS Code",
        sync_claude: "Claude Desktop",
        sync_active: "Configured",
        token_log_on: "Log on",
        token_log_off: "Log off",
        term_title: "Spawn Pre-configured Console",
        term_shell_type: "Target Shell / Console Type",
        btn_launch_term: "Launch Pre-configured Terminal",
        btn_persistent_env: "Repair System Env (Persistent for future shells)",

        btn_setup_desktop: "Setup Claude Code settings",

        status_configuring: "Configuring...",
        btn_setup_desktop_configured: "✓ Configured | Reconfigure",
        btn_clear_desktop_config: "Clear Config",
        status_clearing: "Clearing...",

        toast_desktop_setup_fail: "Setup failed",

        hint_launch: "Injects proxy environment variables and spawns a native shell. Directly run <code>claude</code> to begin!",
        guide_title: "💡 Quick Start Guide",
        guide_1: "Select your preferred shell type in the tabs above.",
        guide_2: "Click \"Launch Pre-configured Terminal\" to summon the console.",
        guide_3: "Directly type <code>claude</code> and press Enter inside the shell to start coding!",
        guide_4: "(Optional) Copy env variables on the right if using an existing IDE terminal.",
        guide_5: "Note: You only need to choose and start one shell type, no need to configure all of them.",
        code_env_title: "Claude Code Env Variables",
        code_ccswitch_title: "CC Switch Provider Config (JSON Import)",
        btn_copy: "Copy",
        btn_copied: "Copied ✓",
        traf_total: "Total Requests",

        traf_rate: "Success Rate",

        traf_latency: "Average Latency",

        traf_tokens: "Token Usage",

        traf_limit: "Rate Limit",

        traf_token_detail: "Token Usage Breakdown",

        traf_input_output: "input + output",

        traf_rpm_hint: "RPM / Quota",
        traf_filter_source: "Source",
        traf_filter_all: "All sources",
        traf_filter_cli: "CLI",
        traf_filter_vscode: "VS Code",
        traf_filter_desktop: "Claude Desktop",
        traf_filter_count: "Showing {{shown}} / {{total}}",

        th_tokens: "Tokens",
        th_client: "Source",
        client_unknown: "Unknown",

        th_time: "Time",
        th_method: "Method",
        th_path: "Request Path",
        th_model: "Resolved Model",
        th_status: "Status",
        th_duration: "Duration",
        th_error: "Error Details",
        traf_empty: "No traffic captured yet. Launch a terminal or make API requests through the proxy...",
        traf_empty_filtered: "No traffic records match this source filter. Switch to All sources to see other requests.",
        traf_listening: "Live Traffic Radar Active & Listening",
        opt_model_kimi_26: "kimi-k2.6",
        opt_model_qwen_36: "qwen3.6-plus",
        opt_model_deepseek_pro: "deepseek-v4-pro",
        opt_model_deepseek_flash: "deepseek-v4-flash",
        opt_model_glm_51: "glm-5.1",
        opt_model_hy3_preview: "hy3-preview",
        opt_mapping_sonnet_default: "qwen3.6-plus (recommended)",
        opt_mapping_haiku_default: "deepseek-v4-flash (recommended)",
        opt_mapping_opus_default: "kimi-k2.6 (recommended)",
        sett_close_behavior: "Close Window Behavior",
        opt_close_prompt: "Prompt Every Time",
        opt_close_minimize: "Hide to tray; proxy keeps running",
        opt_close_exit: "Exit app; stop proxy",
        close_dialog_title: "Close Window",
        close_dialog_msg: "Hiding to tray keeps proxy requests running. Exiting stops the local proxy.",
        close_dialog_exit: "Exit and Stop Proxy",
        close_dialog_minimize: "Hide to Tray and Keep Proxy",
        close_dialog_cancel: "Cancel",
        about_desc: "Premium native companion for Claude Code & OpenCode Go",
        about_author: "Author",
        about_license: "License",
        about_project: "Project",
        about_close: "Close",
        err_api_key_required: "API Key is required",
        err_upstream_url: "Enter a valid http(s) URL",
        err_listen_addr: "Enter a valid listen address, for example 127.0.0.1:8787 or :8787",
        err_timeout_range: "Timeout must be 1-3600 seconds",
        err_rate_limit_range: "Range must be 1-10000",
        err_rate_burst_range: "Range must be 1-100000",
        err_rate_minute_range: "Range must be 0-100000; 0 means unlimited",
        err_claude_env_json: "Must be a JSON object with string keys and values",
        toast_saved: "Configuration saved; configured targets refreshed.",
        toast_save_failed: "Save failed",
        toast_env_repaired: "Environment variables written to system",
        toast_env_repair_failed: "Environment repair failed",
        toast_copy_success: "Copied to clipboard",
        toast_copy_failed: "Copy failed",
        toast_profile_changed: "Profile switched",
        toast_launch_failed: "Terminal launch failed",
        toast_launch_success: "Terminal launched successfully",

        toast_desktop_setup_success: "✓ Claude Code settings configured. Reopen Claude Code to apply. Verify: send a message and check ocgt logs for request records.",
        toast_desktop_verify_hint: "Verify: send a message and check ocgt logs for request records.",
        toast_desktop_cleared: "Desktop configuration cleared",

        toast_history_cleared: "History cleared",
        toast_validation_error: "Please check form errors",
        toast_custom_model_prompt: "Enter custom model name",
        custom_model_title: "Add Custom Model",
        custom_model_desc: "Enter a model ID supported by your upstream provider. It will be saved to the current profile.",
        custom_model_label: "Model name",
        custom_model_placeholder: "e.g. qwen3.6-plus or vendor/model-name",
        custom_model_cancel: "Cancel",
        custom_model_confirm: "Use Model",
        custom_model_required: "Model name is required",
        custom_model_too_long: "Model name must be 128 characters or less",
        toast_reset_confirm: "Reset all settings to defaults?",
        toast_reset_done: "Settings reset to defaults",
        toast_confirm: "Confirm Reset",
        term_launching: "Launching...",
        term_launched: "Terminal Launched ✓",
        warn_desktop_only_launch: "One-click launch is only available in the desktop app!",
        warn_desktop_only_env: "Desktop config interface not initialized. Please try restarting ocgt.",
        warn_desktop_only_folder: "Only available in the desktop client. Config is typically under ~/.ocgt directory.",
        env_repairing: "Repairing...",
        env_repaired_hint: "Repaired! Reopen terminals to apply",
        status_connected_no_key: "Connected, API Key Unconfigured",
        err_open_folder: "Open failed",
        err_open_folder_generic: "Cannot open folder",
        footer_text: "ocgt \u00A9 2026 \u00B7 MIT Licensed \u00B7 Official OpenCode Go Companion Center",
        pref_title: "Preferences",
        pref_language: "Language",
        pref_appearance: "Appearance",
        pref_appearance_desc: "Theme mode and interface language",
        pref_theme: "Theme",
        pref_theme_light: "Light",
        pref_theme_dark: "Dark",
        pref_theme_system: "System",

        pref_accent_color: "Accent Color",

        pref_network: "Network",

        pref_network_desc: "Proxy listen address and port",

        pref_listen_addr: "Listen Address",

        btn_apply_restart: "Apply & Restart",

        pref_behavior: "Behavior",

        pref_behavior_desc: "Window close and system interaction",
        pref_logs: "Logs",
        pref_logs_desc: "Log directory and retention policy",
        pref_log_save: "GUI Log Saving",
        pref_log_dir: "Log Directory",
        pref_log_retention: "Retention Days",
        btn_open_log_dir: "Open",
        btn_save_log_prefs: "Save Log Settings",
        toast_log_prefs_saved: "Log settings saved",
        toast_log_prefs_failed: "Failed to save log settings",
        raw_json_title: "Edit Claude Code settings.json",
        raw_json_desc: "Advanced entry: edits only ~/.claude/settings.json. Confirm the JSON is valid before saving.",
        raw_json_cancel: "Cancel",
        raw_json_save: "Save settings.json",
        raw_json_loading: "Loading...",
        raw_json_load_failed: "Failed to load settings.json: ",
        raw_json_save_failed: "Failed to parse or save settings.json: ",
        raw_json_saved: "Claude Code settings.json saved",
        pref_danger: "Reset & About",
        pref_danger_desc: "Reset defaults or view version info",
        badge_not_configured: "Not configured",
        badge_active: "Configured ✓",
        badge_inactive: "Not configured",
        badge_recommended: "Recommended",
        integration_reapply_hint: "Configured; click again to reapply the current profile proxy config.",
        int_quick_title: "Quick Start: Temporary Terminal",
        int_quick_desc: "Temporarily injects proxy variables only into the newly opened terminal window. It does not write persistent config, and you can open multiple windows.",
        btn_launch_temp_term: "Open Temporary Terminal",
        repair_title: "One-click Repair",
        repair_desc: "Repairs Claude Code settings, base environment variables, and any already configured VS Code / Claude Desktop integrations.",
        btn_repair_all: "Repair All",
        toast_repair_all_success: "Base configuration and configured integrations repaired",
        toast_repair_all_failed: "Repair failed",
        int_sys_title: "Claude Code CLI",
        int_sys_desc: "Writes proxy address to ~/.claude/settings.json. Claude Code will route through proxy in any terminal, automatically restoring on remove.",
        btn_sys_install: "Activate",

        btn_sys_remove: "Remove Config",
        lbl_temp_import: "Temp Import (Current window only):",
        int_vscode_title: "VS Code Claude Code Extension",
        int_vscode_desc: "Inject ocgt proxy variables into VS Code user settings. The Claude Code extension, or the Claude Code process it launches, can inherit the local proxy environment.",
        btn_vscode_install: "Activate",

        btn_vscode_remove: "Remove",
        int_vscode_tip: "Reopen a VS Code Claude Code session after injection to verify the route.",
        int_claude_title: "Claude Code settings",
        int_claude_desc: "Writes ocgt proxy variables into <code>~/.claude/settings.json</code> for local Claude Code clients. Use the separate 3P profile action below for the real Claude Desktop App.",
        btn_setup_desktop_full: "Activate",

        btn_clear_desktop_full: "Remove",
        lbl_desktop_help_title: "Claude Code settings",
        lbl_desktop_help_desc: "Writes only the settings.json env block read by Claude Code; Claude Desktop sign-in is unchanged.",
        int_claude_desktop_title: "Claude Desktop App",
        int_claude_desktop_desc: "Writes Claude Desktop config using the same 3P profile approach as cc-switch. Restart Claude Desktop to route requests through ocgt.",
        btn_setup_claude_desktop_app: "Activate",
        btn_clear_claude_desktop_app: "Remove Config",
        toast_claude_desktop_app_setup_success: "Claude Desktop App 3P config written. Restart Claude Desktop to apply.",
        toast_claude_desktop_app_cleared: "Claude Desktop App 3P config removed.",
        toast_vscode_installed: "VS Code Claude Code extension configuration injected!",
        toast_vscode_removed: "VS Code Claude Code extension configuration cleared!",
        toast_sys_installed: "Global JSON configured! Claude Code will now route through proxy.",
        toast_sys_removed: "Proxy configuration restored from ~/.claude/settings.json.",
        toast_vscode_failed: "Failed to configure VS Code",
        loading_title: "Connecting local proxy",
        loading_init: "Initializing proxy service...",
        loading_unavailable_title: "Proxy unavailable",
        loading_unavailable_desc: "The local proxy did not respond. Check the listen address, port usage, or configuration, then retry.",
        proxy_health_timeout: "Proxy port did not respond to /healthz",
        btn_retry_connection: "Retry Connection",
        token_total_label: "Total: {{count}} tokens"
    }
};

// ══════════════════════════════════════════════════════
// §3 — Utility Helpers
// ══════════════════════════════════════════════════════

/** Get the current language dictionary */
function t(key) {
    const dict = i18n[currentLang];
    return dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
}

/** Safely access the Wails App binding. Returns null when not in desktop mode. */
function getWailsApp() {
    return (window.go && window.go.main && window.go.main.App) || null;
}

/** Call a Wails App method if available, returns null otherwise. */
async function callWails(method, ...args) {
    const app = getWailsApp();
    if (!app || typeof app[method] !== 'function') return null;
    return app[method](...args);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function apiFetch(path, options, timeoutMs) {
    options = options || {};
    timeoutMs = timeoutMs || 8000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // Add auth token header if available
        const headers = options.headers || {};
        if (LOCAL_AUTH_TOKEN) {
            headers['X-Ocgt-Local-Token'] = LOCAL_AUTH_TOKEN;
        }
        return await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeCloseBehavior(value) {
    return CLOSE_BEHAVIORS.has(value) ? value : DEFAULT_CLOSE_BEHAVIOR;
}

function normalizeTheme(value) {
    return THEME_VALUES.has(value) ? value : 'system';
}

function normalizeLanguage(value) {
    return LANGUAGE_VALUES.has(value) ? value : 'zh';
}

function normalizeHue(value) {
    const hue = Number(value);
    if (!Number.isFinite(hue)) return 174;
    return Math.max(0, Math.min(360, Math.round(hue)));
}

function normalizeView(value) {
    return VIEW_VALUES.has(value) ? value : 'dashboard';
}

function normalizeCompactShell(value) {
    return COMPACT_SHELL_VALUES.has(value) ? value : 'powershell';
}

function parseExpandedIntegrations(value) {
    let raw = value;
    if (typeof raw === 'string' && raw.trim()) {
        try { raw = JSON.parse(raw); } catch (_) { raw = []; }
    }
    if (!Array.isArray(raw)) raw = [];
    return raw.filter(id => INTEGRATION_IDS.includes(id));
}

function padTwo(n) { return n.toString().padStart(2, '0'); }
// ══════════════════════════════════════════════════════

// Lazily cached DOM references (populated in bootstrap)
const dom = {};

function cacheDom() {
    // Dashboard
    dom.elListen = document.getElementById('status-listen');
    dom.elUpstream = document.getElementById('status-upstream');
    dom.elProfile = document.getElementById('status-profile');
    dom.elModel = document.getElementById('status-model');
    dom.elTimeout = document.getElementById('status-timeout');
    dom.elApiKey = document.getElementById('status-api-key');
    dom.dashboardSkeletons = document.getElementById('dashboard-skeletons');
    dom.dashboardContent = document.getElementById('dashboard-content');

    // Settings
    dom.selectProfile = document.getElementById('profile-select');
    dom.inputApiKey = document.getElementById('api-key-input');
    dom.inputUpstream = document.getElementById('upstream-input');
    dom.inputTimeout = document.getElementById('timeout-input');
    dom.inputListen = document.getElementById('listen-input');
    dom.inputUpstream = document.getElementById('upstream-input');
    dom.inputThinkingBudget = document.getElementById('thinking-budget-input');
    dom.inputRateLimit = document.getElementById('rate-limit-input');
    dom.inputQuotaCookie = document.getElementById('quota-cookie-input');
    dom.inputQuotaWorkspace = document.getElementById('quota-workspace-input');
    dom.inputRateBurst = document.getElementById('rate-burst-input');
    dom.inputRateMinute = document.getElementById('rate-minute-input');
    dom.inputClaudeEnvTemplate = document.getElementById('claude-env-template-input');
    dom.envDisableNonEssential = document.getElementById('env-disable-nonessential');
    dom.envEnableToolSearch = document.getElementById('env-enable-tool-search');
    dom.envDisableAttribution = document.getElementById('env-disable-attribution');
    dom.envDisableThinking = document.getElementById('env-disable-thinking');
    dom.envMaxOutputTokens = document.getElementById('env-max-output-tokens');
    dom.envMaxMcpTokens = document.getElementById('env-max-mcp-tokens');
    dom.envApiTimeout = document.getElementById('env-api-timeout');
    dom.envMcpTimeout = document.getElementById('env-mcp-timeout');
    dom.inputDefaultModel = document.getElementById('default-model-input');
    dom.inputSonnetMapping = document.getElementById('mapping-sonnet-input');
    dom.inputHaikuMapping = document.getElementById('mapping-haiku-input');
    dom.inputOpusMapping = document.getElementById('mapping-opus-input');
    dom.inputCloseBehavior = document.getElementById('close-behavior-input');
    dom.inputLogEnabled = document.getElementById('log-enabled-input');
    dom.inputLogDirectory = document.getElementById('log-directory-input');
    dom.inputLogRetention = document.getElementById('log-retention-input');
    dom.btnSaveLogPrefs = document.getElementById('save-log-prefs-btn');
    dom.btnOpenLogDir = document.getElementById('open-log-dir-btn');
    dom.btnSaveAllConfig = document.getElementById('save-all-config-btn');

    const syncModelsBtn = document.getElementById('btn-sync-models');
    if (syncModelsBtn) {
        syncModelsBtn.addEventListener('click', async () => {
            try {
                syncModelsBtn.disabled = true;
                const oldText = syncModelsBtn.textContent;
                syncModelsBtn.textContent = '...';
                const res = await fetch(`https://opencode.ai/zen/go/v1/models`);
                if (!res.ok) throw new Error('API failed');
                const data = await res.json();
                if (data && data.data && Array.isArray(data.data)) {
                    const newModels = data.data.map(m => ({
                        id: m.id,
                        label: m.id,
                        recommended: false,
                        category: 'Synced'
                    }));
                    // Keep original recommended models if not in the list, or just append new ones
                    const existingIds = new Set(MODEL_REGISTRY.map(m => m.id));
                    let added = 0;
                    const syncedToSave = [];
                    for (const nm of newModels) {
                        if (!existingIds.has(nm.id)) {
                            MODEL_REGISTRY.push(nm);
                            added++;
                        }
                        syncedToSave.push(nm);
                    }
                    localStorage.setItem('synced_models', JSON.stringify(syncedToSave));
                    populateModelSelects();
                    showToast(`同步成功，新增 ${added} 个模型`);
                }
            } catch (err) {
                console.error(err);
                showToast('获取模型失败，请检查上游 API Key 与网络连接', 'error');
            } finally {
                syncModelsBtn.disabled = false;
                syncModelsBtn.textContent = t('btn_sync_models');
            }
        });
    }
    dom.btnCancelConfig = document.getElementById('cancel-config-btn');
    dom.btnRepairAll = document.getElementById('repair-all-btn');

    // System Environment Card
    dom.btnSysEnvInstall = document.getElementById('sys-env-install-btn');
    dom.btnSysEnvRemove = document.getElementById('sys-env-remove-btn');
    dom.sysEnvBadge = document.getElementById('sys-env-badge');
    dom.btnLaunchTerminal = document.getElementById('launch-temp-terminal-btn');
    dom.compactShellTabs = document.getElementById('compact-shell-tabs');
    dom.compactEnvCode = document.getElementById('compact-env-code');
    dom.compactCopyBtn = document.getElementById('compact-copy-btn');

    // VS Code Integration Card
    dom.btnVscodeInstall = document.getElementById('vscode-install-btn');
    dom.btnVscodeRemove = document.getElementById('vscode-remove-btn');
    dom.vscodeBadge = document.getElementById('vscode-badge');

    // Claude CLI / Desktop Card
    dom.btnSetupDesktop = document.getElementById('setup-desktop-btn');
    dom.btnSetupDesktopText = dom.btnSetupDesktop ? dom.btnSetupDesktop : null; // matches old binding safely
    dom.btnClearDesktop = document.getElementById('clear-desktop-btn');
    dom.claudeDesktopBadge = document.getElementById('claude-desktop-badge');
    dom.btnSetupClaudeDesktopApp = document.getElementById('setup-claude-desktop-app-btn');
    dom.btnClearClaudeDesktopApp = document.getElementById('clear-claude-desktop-app-btn');
    dom.claudeDesktopAppBadge = document.getElementById('claude-desktop-app-badge');
    // Desktop client activation moved from dashboard to the Quick Connect page.

    dom.btnToggleVisibility = document.getElementById('toggle-key-visibility');
    dom.settingsForm = document.getElementById('settings-form');
    dom.configActions = document.getElementById('config-actions');
    dom.resetDefaultsBtn = document.getElementById('reset-defaults-btn');
    dom.btnAboutApp = document.getElementById('about-app-btn');
    dom.syncProfileName = document.getElementById('sync-profile-name');
    dom.syncListenAddress = document.getElementById('sync-listen-address');
    dom.syncCliState = document.getElementById('sync-cli-state');
    dom.syncVscodeState = document.getElementById('sync-vscode-state');
    dom.syncClaudeState = document.getElementById('sync-claude-state');
    dom.syncCliDot = document.getElementById('sync-cli-dot');
    dom.syncVscodeDot = document.getElementById('sync-vscode-dot');
    dom.syncClaudeDot = document.getElementById('sync-claude-dot');

    // Header & footer
    dom.statusPill = document.getElementById('statusPill');
    dom.uptimeBadge = document.querySelector('.uptime-badge');
    dom.lastUpdated = document.getElementById('lastUpdated');
    dom.toastContainer = document.getElementById('toastContainer');
    dom.footerText = document.getElementById('footer-text');

    // Preferences trigger
    dom.prefsToggleBtn = document.getElementById('prefsToggleBtn');
    dom.prefLangSelect = document.getElementById('pref-lang-select');

    // Version stamps
    dom.appVersion = document.getElementById('app-version');
    dom.aboutVersion = document.getElementById('about-version');

    // Loading overlay
    dom.loadingOverlay = document.getElementById('loadingOverlay');
    dom.loadingSpinner = document.getElementById('loadingSpinner');
    dom.loadingTitle = document.getElementById('loadingTitle');
    dom.loadingText = document.getElementById('loadingText');
    dom.loadingRetryBtn = document.getElementById('loadingRetryBtn');

    // Modals
    dom.closeDialogOverlay = document.getElementById('closeDialogOverlay');
    dom.closeDialogExit = document.getElementById('closeDialogExit');
    dom.closeDialogMinimize = document.getElementById('closeDialogMinimize');
    dom.closeDialogCancel = document.getElementById('closeDialogCancel');
    dom.aboutDialogOverlay = document.getElementById('aboutDialogOverlay');
    dom.aboutDialogClose = document.getElementById('aboutDialogClose');
    dom.customModelModalOverlay = document.getElementById('customModelModalOverlay');
    dom.customModelInput = document.getElementById('customModelInput');
    dom.customModelError = document.getElementById('customModelError');
    dom.customModelClose = document.getElementById('customModelClose');
    dom.customModelCancelBtn = document.getElementById('customModelCancelBtn');
    dom.customModelConfirmBtn = document.getElementById('customModelConfirmBtn');
}
// ══════════════════════════════════════════════════════

const TOAST_ICONS = {
    success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function toast(message, type, options) {
    type = type || 'info';
    options = options || {};
    const duration = options.duration || (type === 'error' ? 5000 : 3500);
    const actionCallback = options.actionCallback || null;
    const actionLabel = options.actionLabel || '';

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    // Build toast DOM safely using DOM API instead of innerHTML
    const iconContainer = document.createElement('span');
    iconContainer.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    const svg = iconContainer.querySelector('svg');
    if (svg) {
        el.appendChild(svg);
    }

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-msg';
    msgSpan.textContent = message;
    el.appendChild(msgSpan);

    let actionBtn = null;
    if (actionCallback) {
        actionBtn = document.createElement('button');
        actionBtn.className = 'toast-action';
        actionBtn.textContent = actionLabel;
        el.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Close notification');
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('fill', 'none');
    closeSvg.setAttribute('stroke', 'currentColor');
    closeSvg.setAttribute('stroke-width', '2');
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '18');
    line1.setAttribute('y1', '6');
    line1.setAttribute('x2', '6');
    line1.setAttribute('y2', '18');
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '6');
    line2.setAttribute('y1', '6');
    line2.setAttribute('x2', '18');
    line2.setAttribute('y2', '18');
    closeSvg.appendChild(line1);
    closeSvg.appendChild(line2);
    closeBtn.appendChild(closeSvg);
    el.appendChild(closeBtn);

    let activeTimer = null;
    const dismiss = () => {
        if (el.classList.contains('toast-out')) return;
        if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => { if (el.parentNode) el.remove(); }, { once: true });
    };

    closeBtn.addEventListener('click', dismiss);
    if (actionBtn && actionCallback) {
        actionBtn.addEventListener('click', () => { actionCallback(); dismiss(); });
    }

    // Timer management: properly cancel previous timer on re-enter
    activeTimer = setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => {
        if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
    });
    el.addEventListener('mouseleave', () => {
        activeTimer = setTimeout(dismiss, 2000);
    });

    dom.toastContainer.appendChild(el);
    return el;
}

function toastI18n(key, type, options) {
    return toast(t(key), type, options);
}
// ══════════════════════════════════════════════════════

function showModal(overlayEl) {
    if (!overlayEl) return;
    overlayEl.classList.add('active');
    overlayEl.setAttribute('aria-hidden', 'false');
}
function hideModal(overlayEl) {
    if (!overlayEl) return;
    overlayEl.classList.remove('active');
    overlayEl.setAttribute('aria-hidden', 'true');
}

function setCustomModelError(message) {
    if (!dom.customModelError) return;
    dom.customModelError.textContent = message || '';
    dom.customModelError.hidden = !message;
}

function requestCustomModelName() {
    if (!dom.customModelModalOverlay || !dom.customModelInput) {
        toastI18n('toast_custom_model_prompt', 'warning');
        return Promise.resolve('');
    }
    setCustomModelError('');
    dom.customModelInput.value = '';
    showModal(dom.customModelModalOverlay);
    window.setTimeout(() => dom.customModelInput.focus(), 40);

    return new Promise(resolve => {
        let settled = false;
        const cleanup = () => {
            if (dom.customModelConfirmBtn) dom.customModelConfirmBtn.removeEventListener('click', confirm);
            if (dom.customModelCancelBtn) dom.customModelCancelBtn.removeEventListener('click', cancel);
            if (dom.customModelClose) dom.customModelClose.removeEventListener('click', cancel);
            if (dom.customModelModalOverlay) dom.customModelModalOverlay.removeEventListener('click', onOverlayClick);
            if (dom.customModelInput) dom.customModelInput.removeEventListener('keydown', onKeydown);
            if (activeCustomModelCancel === cancel) activeCustomModelCancel = null;
        };
        const finish = value => {
            if (settled) return;
            settled = true;
            cleanup();
            hideModal(dom.customModelModalOverlay);
            resolve(value);
        };
        const confirm = () => {
            const value = dom.customModelInput.value.trim();
            if (!value) {
                setCustomModelError(t('custom_model_required'));
                dom.customModelInput.focus();
                return;
            }
            if (value.length > 128) {
                setCustomModelError(t('custom_model_too_long'));
                dom.customModelInput.focus();
                return;
            }
            finish(value);
        };
        const cancel = () => finish('');
        activeCustomModelCancel = cancel;
        const onOverlayClick = (e) => {
            if (e.target === dom.customModelModalOverlay) cancel();
        };
        const onKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };

        if (dom.customModelConfirmBtn) dom.customModelConfirmBtn.addEventListener('click', confirm);
        if (dom.customModelCancelBtn) dom.customModelCancelBtn.addEventListener('click', cancel);
        if (dom.customModelClose) dom.customModelClose.addEventListener('click', cancel);
        dom.customModelModalOverlay.addEventListener('click', onOverlayClick);
        dom.customModelInput.addEventListener('keydown', onKeydown);
    });
}
// ══════════════════════════════════════════════════════

function setProxyConnectionState(state, detail) {
    const meta = {
        connecting: { text: t('status_connecting'), className: 'connecting' },
        online: { text: t('status_online'), className: 'online' },
        offline: { text: t('status_offline'), className: 'offline' }
    }[state];
    if (!meta) return;

    [dom.statusPill, dom.uptimeBadge].forEach(el => {
        if (!el) return;
        el.classList.remove('online', 'offline', 'connecting');
        el.classList.add(meta.className);
        const textSpan = el.querySelector('span:last-child');
        if (textSpan) textSpan.textContent = detail || meta.text;
    });
}

function showDashboardContent() {
    if (dom.dashboardSkeletons) dom.dashboardSkeletons.classList.add('hidden');
    if (dom.dashboardContent) dom.dashboardContent.classList.remove('hidden');
    isLoadingDashboard = false;
}

function showLoadingOverlay(show, showRetry, detail) {
    const overlay = dom.loadingOverlay || document.getElementById('loadingOverlay');
    const retryBtn = dom.loadingRetryBtn || document.getElementById('loadingRetryBtn');
    const titleEl = dom.loadingTitle || document.getElementById('loadingTitle');
    const textEl = dom.loadingText || document.getElementById('loadingText');
    const spinner = dom.loadingSpinner || document.getElementById('loadingSpinner');
    if (!overlay) return;
    const retryMode = Boolean(showRetry);
    const visible = Boolean(show) || retryMode;

    if (titleEl) {
        titleEl.textContent = retryMode ? t('loading_unavailable_title') : t('loading_title');
    }
    if (textEl) {
        textEl.textContent = retryMode ? (detail || t('loading_unavailable_desc')) : t('loading_init');
    }
    if (spinner) {
        spinner.classList.toggle('hidden', retryMode);
    }
    if (retryBtn) {
        retryBtn.classList.toggle('hidden', !retryMode);
        retryBtn.disabled = false;
    }

    if (visible) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

async function fetchAndDisplayVersion() {
    try {
        const resp = await apiFetch('/ocgt/api/version');
        if (!resp.ok) return;
        const data = await resp.json();
        const ver = data.version || APP_VERSION;
        if (dom.appVersion) dom.appVersion.textContent = `v${ver}`;
        if (dom.aboutVersion) dom.aboutVersion.textContent = `v${ver}`;
    } catch (_) {
        // fallback to hardcoded version
        if (dom.appVersion) dom.appVersion.textContent = APP_VERSION;
        if (dom.aboutVersion) dom.aboutVersion.textContent = APP_VERSION;
    }
}

async function resolveApiBase() {

    // Wait for Wails binding to be injected (up to 5s)

    for (let i = 0; i < 50; i++) {

        if (window.go && window.go.main && window.go.main.App) break;

        await delay(100);

    }

    try {

        const addr = await callWails('GetListenAddress');

        if (addr) API_BASE = `http://${addr}`;
        if (window.setTrafficApiBase) window.setTrafficApiBase(API_BASE);

    } catch (err) { console.error('Wails GetListenAddress error:', err); }

}

async function waitForProxyReady(timeoutMs) {

    timeoutMs = timeoutMs || 15000;

    const started = Date.now();

    while (Date.now() - started < timeoutMs) {

        try {

            const resp = await apiFetch('/healthz', { cache: 'no-store' }, 1000);

            if (resp.ok) return true;

        } catch (_) { /* retry */ }

        await delay(500);

    }

    return false;

}

async function isProxyHealthy() {
    try {
        const resp = await apiFetch('/healthz', { cache: 'no-store' }, 1200);
        return resp.ok;
    } catch (_) {
        return false;
    }
}

async function getProxyStartupDetail() {
    try {
        const diagnostics = await callWails('GetProxyStartupStatus');
        if (!diagnostics) return '';
        if (diagnostics.listen && dom.elListen) {
            dom.elListen.textContent = diagnostics.listen;
        }
        if (diagnostics.last_error) {
            return diagnostics.last_error;
        }
        if (diagnostics.healthy === false) {
            return t('proxy_health_timeout');
        }
    } catch (err) {
        console.error('Proxy diagnostics failed:', err);
    }
    return '';
}

// ── Dynamic Model Select Rendering ──
function populateModelSelects() {
    const i18nKey = (m) => `opt_model_${m.id.replace(/[.-]/g, '_')}`;
    document.querySelectorAll('select[data-model-source]').forEach(sel => {
        const source = sel.dataset.modelSource;
        const saved = sel.value;
        sel.innerHTML = '';

        if (source === 'default') {

            // Default model selector — flat list grouped by category

            MODEL_REGISTRY.forEach(m => {

                const opt = document.createElement('option');

                opt.value = m.id;

                opt.textContent = m.label;

                sel.appendChild(opt);

            });

            const custom = document.createElement('option');
            custom.value = 'custom';
            custom.textContent = t('opt_custom');
            sel.appendChild(custom);
        } else {
            // Mapping selector — only high-tier models + custom
            const mappingTargets = MODEL_REGISTRY.filter(m => m.recommended || ['minimax-m2.7', 'mimo-v2.5-pro', 'mimo-v2.5', 'kimi-k2.5', 'glm-5', 'qwen3.5-plus', 'deepseek-v4-flash', 'kimi-k2.6', 'qwen3.6-plus', 'deepseek-v4-pro', 'glm-5.1'].includes(m.id));
            const defaultId = MAPPING_DEFAULTS[source];
            // Deduplicate by id
            const seen = new Set();
            // Put default first
            const ordered = [];
            if (defaultId) {
                const def = mappingTargets.find(m => m.id === defaultId);
                if (def) ordered.push(def);
            }
            mappingTargets.forEach(m => { if (!seen.has(m.id) && m.id !== defaultId) { seen.add(m.id); ordered.push(m); } });
            // Fallback: if defaultId not in mappingTargets, still add it
            if (defaultId && !ordered.find(m => m.id === defaultId)) {
                const def = MODEL_REGISTRY.find(m => m.id === defaultId);
                if (def) ordered.unshift(def);
            }
            ordered.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.label;
                sel.appendChild(opt);
            });

            const custom = document.createElement('option');
            custom.value = 'custom';
            custom.textContent = t('opt_custom');
            sel.appendChild(custom);
        }
        // Restore previous value
        if (saved) setSelectValue(sel, saved);
    });
}

// ── Accent Color System ──
function persistUIPreferencesSoon() {
    if (!uiPreferencesLoaded) return;
    if (uiPreferencesSaveTimer) clearTimeout(uiPreferencesSaveTimer);
    uiPreferencesSaveTimer = window.setTimeout(() => {
        saveUIPreferences().catch(err => console.error('Failed to save UI preferences:', err));
    }, 250);
}

function getActiveViewId() {
    const activeItem = document.querySelector('.nav-item.active');
    return normalizeView(activeItem ? activeItem.dataset.view : localStorage.getItem('last-view'));
}

function getExpandedIntegrationIds() {
    return Array.from(document.querySelectorAll('.integration-row.expanded'))
        .map(row => row.dataset.integration)
        .filter(id => INTEGRATION_IDS.includes(id));
}

function applyExpandedIntegrationIds(ids) {
    const expanded = new Set(parseExpandedIntegrations(ids));
    document.querySelectorAll('.integration-row').forEach(row => {
        const isExpanded = expanded.has(row.dataset.integration);
        row.classList.toggle('expanded', isExpanded);
        const btn = row.querySelector('.ir-expand-btn');
        if (btn) btn.setAttribute('aria-expanded', String(isExpanded));
    });
}

async function saveUIPreferences() {
    const theme = normalizeTheme(localStorage.getItem('theme') || 'system');
    const language = normalizeLanguage(currentLang);
    const accentHue = normalizeHue(localStorage.getItem('accent-hue') || '174');
    const lastView = getActiveViewId();
    const shell = normalizeCompactShell(compactShell);
    const expanded = JSON.stringify(getExpandedIntegrationIds());
    localStorage.setItem('last-view', lastView);
    localStorage.setItem('compact-shell', shell);
    localStorage.setItem('expanded-integrations', expanded);

    const app = getWailsApp();
    if (app && typeof app.SaveUIPreferences === 'function') {
        const res = await app.SaveUIPreferences(theme, language, accentHue, lastView, shell, expanded);
        if (res && res !== 'success') console.warn('SaveUIPreferences:', res);
    }
}

function applyAccentHue(hue, options = {}) {
    hue = normalizeHue(hue);
    document.documentElement.style.setProperty('--accent-h', hue);
    localStorage.setItem('accent-hue', hue);
    syncAccentDots(hue);
    if (options.persist !== false) persistUIPreferencesSoon();
}

function syncAccentDots(hue) {

    document.querySelectorAll('.sp-accent-dot').forEach(d => {

        d.classList.toggle('active', d.dataset.accentHue === String(hue));

    });

    // Update custom input if hue doesn't match any preset

    const presetHues = ACCENT_PRESETS.map(p => String(p.hue));

    const accentInput = document.getElementById('accentCustomInput');

    if (accentInput) {

        accentInput.value = presetHues.includes(String(hue)) ? '' : hue;

    }

}

function initAccentColor() {
    const saved = localStorage.getItem('accent-hue');
    const hue = saved != null ? Number(saved) : 174; // default teal
    applyAccentHue(hue, { persist: false });
}

async function initializeApp() {

    if (isInitializing) return;

    isInitializing = true;


    setProxyConnectionState('connecting');

    showLoadingOverlay(true);

    await resolveApiBase();




    // Fetch local auth token from Wails (silently fails in browser mode)

    try { const t = await callWails('GetLocalToken'); if (t) { LOCAL_AUTH_TOKEN = t; window.LOCAL_AUTH_TOKEN = t; } } catch (_) { }



    proxyReady = await waitForProxyReady();


    if (!proxyReady) {

        const detail = await getProxyStartupDetail();

        setProxyConnectionState('offline', detail);

        showDashboardContent();

        showLoadingOverlay(false, true, detail || t('loading_unavailable_desc'));

        isInitializing = false;

        return;

    }
    setProxyConnectionState('online');
    try {
        const results = await Promise.allSettled([loadStatus(), loadProfiles(), loadPreferences()]);
        const statusOK = results[0].status === 'fulfilled' && results[0].value;
        if (!statusOK) {
            const healthy = await isProxyHealthy();
            proxyReady = healthy;
            setProxyConnectionState(healthy ? 'online' : 'offline');
        }
        await fetchAndDisplayVersion();
        _consecutiveFailures = 0;
    } catch (err) {
        console.error('Error during initial load:', err);
        _consecutiveFailures++;
        // Only go offline after 3 consecutive failures to tolerate transient errors
        if (_consecutiveFailures >= 3) {
            const healthy = await isProxyHealthy();
            proxyReady = healthy;
            setProxyConnectionState(healthy ? 'online' : 'offline');
        }
    } finally {
        isInitializing = false;
        showLoadingOverlay(false, false);
    }
}

function updateLastUpdated() {
    if (!dom.lastUpdated) return;
    const now = new Date();
    const timeStr = `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}:${padTwo(now.getSeconds())}`;
    const span = dom.lastUpdated.querySelector('span:last-child');
    if (span) span.textContent = `${t('lbl_last_updated')}: ${timeStr}`;
}
// ══════════════════════════════════════════════════════

function setSelectValue(selectEl, value) {
    if (!selectEl) return;
    if (!value) { selectEl.selectedIndex = 0; return; }
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === value) { selectEl.value = value; return; }
    }
    // Value not found — add it before the last option (custom)
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    selectEl.insertBefore(opt, selectEl.lastElementChild);
    selectEl.value = value;
}

function setThinkingBudgetValue(value) {
    if (!dom.inputThinkingBudget) return;
    if (ALLOWED_THINKING_BUDGETS.includes(value)) {
        dom.inputThinkingBudget.value = value;
        syncThinkingSegmentControl(value);
        return;
    }
    let opt = Array.from(dom.inputThinkingBudget.options).find(o => o.value === value);
    if (!opt) {
        opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${value} · ${t('opt_custom')}`;
        dom.inputThinkingBudget.insertBefore(opt, dom.inputThinkingBudget.lastElementChild);
    }
    dom.inputThinkingBudget.value = value;
    syncThinkingSegmentControl(value);
}

function syncThinkingSegmentControl(value) {
    const segControl = document.getElementById('thinking-seg-control');
    if (!segControl) return;
    segControl.querySelectorAll('.sett-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === value);
    });
}

function orderedJSONString(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
    const ordered = {};
    Object.keys(value).sort().forEach(key => {
        ordered[key] = String(value[key]);
    });
    return JSON.stringify(ordered, null, 2);
}

function parseClaudeEnvTemplate() {
    if (!dom.inputClaudeEnvTemplate) {
        return { ...((systemStatus && systemStatus.claude_env) || {}) };
    }
    const raw = dom.inputClaudeEnvTemplate.value.trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('err_claude_env_json'));
    }
    const out = {};
    Object.entries(parsed).forEach(([key, value]) => {
        if (typeof key !== 'string' || typeof value !== 'string') {
            throw new Error(t('err_claude_env_json'));
        }
        out[key] = value;
    });
    return out;
}

function applyDynamicClaudeEnv(env, client) {
    const listen = systemStatus && systemStatus.listen ? systemStatus.listen : '127.0.0.1:8787';
    const profile = dom.selectProfile && dom.selectProfile.value ? dom.selectProfile.value : (systemStatus && systemStatus.active_profile) || 'opencode-go';
    const sonnet = dom.inputSonnetMapping && dom.inputSonnetMapping.value ? dom.inputSonnetMapping.value : '';
    const haiku = dom.inputHaikuMapping && dom.inputHaikuMapping.value ? dom.inputHaikuMapping.value : '';
    const opus = dom.inputOpusMapping && dom.inputOpusMapping.value ? dom.inputOpusMapping.value : '';
    const thinkingBudget = dom.inputThinkingBudget && dom.inputThinkingBudget.value ? Number(dom.inputThinkingBudget.value) : 2048;

    if (opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (haiku) {
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
        env.ANTHROPIC_SMALL_FAST_MODEL = haiku;
        env.CLAUDE_CODE_SUBAGENT_MODEL = haiku;
    }
    
    // Write dynamic advanced values back to the env
    if (dom.envDisableNonEssential) {
        env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = dom.envDisableNonEssential.checked ? "1" : "0";
        env.DISABLE_NON_ESSENTIAL_MODEL_CALLS = dom.envDisableNonEssential.checked ? "1" : "0";
    }
    if (dom.envEnableToolSearch) env.ENABLE_TOOL_SEARCH = dom.envEnableToolSearch.checked ? "true" : "false";
    if (dom.envDisableAttribution) env.CLAUDE_CODE_ATTRIBUTION_HEADER = dom.envDisableAttribution.checked ? "0" : "1";
    if (dom.envDisableThinking && dom.envDisableThinking.checked) {
        env.CLAUDE_CODE_DISABLE_THINKING = "1";
        env.MAX_THINKING_TOKENS = "0";
    } else {
        if (thinkingBudget < 0) {
            env.MAX_THINKING_TOKENS = '0';
            env.CLAUDE_CODE_DISABLE_THINKING = '1';
        } else {
            env.MAX_THINKING_TOKENS = String(thinkingBudget || 2048);
            delete env.CLAUDE_CODE_DISABLE_THINKING;
        }
    }
    if (dom.envMaxOutputTokens && dom.envMaxOutputTokens.value) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = dom.envMaxOutputTokens.value;
    if (dom.envMaxMcpTokens && dom.envMaxMcpTokens.value) env.MAX_MCP_OUTPUT_TOKENS = dom.envMaxMcpTokens.value;
    if (dom.envApiTimeout && dom.envApiTimeout.value) env.API_TIMEOUT_MS = dom.envApiTimeout.value;
    if (dom.envMcpTimeout && dom.envMcpTimeout.value) {
        env.MCP_TIMEOUT = dom.envMcpTimeout.value;
        env.MCP_TOOL_TIMEOUT = dom.envMcpTimeout.value;
    }

    env.ANTHROPIC_BASE_URL = `http://${listen}`;
    env.ANTHROPIC_CUSTOM_HEADERS = `X-Ocgt-Profile: ${profile}, X-Ocgt-Client: ${client}`;
    env.OCGT_PROFILE = profile;
    if (LOCAL_AUTH_TOKEN) {
        env.ANTHROPIC_AUTH_TOKEN = LOCAL_AUTH_TOKEN;
        delete env.ANTHROPIC_API_KEY;
    } else {
        env.ANTHROPIC_API_KEY = 'ocgt-local-proxy';
    }
    
    return env;
}

function buildClaudeEnvForClient(client) {
    const env = parseClaudeEnvTemplate();
    return applyDynamicClaudeEnv(env, client || 'claude-code-cli');
}

function shellQuotePowerShell(value) {
    return `"${String(value).replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"')}"`;
}

function shellQuoteBash(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function loadStatus() {
    try {
        const resp = await apiFetch('/ocgt/api/status');
        if (!resp.ok) throw new Error('Failed');
        systemStatus = await resp.json();

        dom.elListen.textContent = systemStatus.listen;
        dom.elUpstream.textContent = systemStatus.upstream;
        dom.elProfile.textContent = systemStatus.active_profile;
        if (dom.inputUpstream && !document.activeElement.isSameNode(dom.inputUpstream)) {
            dom.inputUpstream.value = systemStatus.upstream || '';
        }
        if (dom.inputRateLimit && !document.activeElement.isSameNode(dom.inputRateLimit)) {
            dom.inputRateLimit.value = systemStatus.rate_limit_per_second || '';
        }
        if (dom.inputRateBurst && !document.activeElement.isSameNode(dom.inputRateBurst)) {
            dom.inputRateBurst.value = systemStatus.rate_limit_burst || '';
        }
        if (dom.inputRateMinute && !document.activeElement.isSameNode(dom.inputRateMinute)) {
            dom.inputRateMinute.value = systemStatus.rate_limit_per_minute || '';
        }
        if (dom.inputClaudeEnvTemplate && !document.activeElement.isSameNode(dom.inputClaudeEnvTemplate)) {
            const envTemplate = { ...(systemStatus.claude_env || {}) };
            dom.inputClaudeEnvTemplate.value = orderedJSONString(applyDynamicClaudeEnv(envTemplate, 'claude-code-cli'));
        }

        // Model
        if (systemStatus.default_model) {
            dom.elModel.textContent = systemStatus.default_model;
            dom.elModel.classList.remove('not-configured');
        } else {
            dom.elModel.textContent = t('status_not_configured');
            dom.elModel.classList.add('not-configured');
        }

        // API Key
        if (dom.elApiKey) {
            const configured = systemStatus.api_key_configured !== false;
            dom.elApiKey.textContent = configured ? t('status_api_key_configured') : t('status_api_key_not_configured');
            dom.elApiKey.style.color = configured ? 'var(--green)' : 'var(--yellow)';
        }

        // Timeout
        if (dom.elTimeout) {
            const seconds = Number(systemStatus.request_timeout_seconds || 300);
            dom.elTimeout.textContent = `${seconds}s`;
            if (dom.inputTimeout && !document.activeElement.isSameNode(dom.inputTimeout)) {
                dom.inputTimeout.value = seconds.toString();
            }
            if (dom.inputListen && !document.activeElement.isSameNode(dom.inputListen)) {
                dom.inputListen.value = systemStatus.listen || '';
            }
            if (dom.inputUpstream && !document.activeElement.isSameNode(dom.inputUpstream)) {
                dom.inputUpstream.value = systemStatus.upstream || '';
            }
        }

        // Claude Env Toggles
        if (systemStatus && systemStatus.claude_env) {
            const env = systemStatus.claude_env;
            if (dom.envDisableNonEssential && !document.activeElement.isSameNode(dom.envDisableNonEssential)) dom.envDisableNonEssential.checked = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== "0";
            if (dom.envEnableToolSearch && !document.activeElement.isSameNode(dom.envEnableToolSearch)) dom.envEnableToolSearch.checked = env.ENABLE_TOOL_SEARCH !== "false";
            if (dom.envDisableAttribution && !document.activeElement.isSameNode(dom.envDisableAttribution)) dom.envDisableAttribution.checked = env.CLAUDE_CODE_ATTRIBUTION_HEADER === "0";
            if (dom.envDisableThinking && !document.activeElement.isSameNode(dom.envDisableThinking)) dom.envDisableThinking.checked = env.CLAUDE_CODE_DISABLE_THINKING === "1";
            if (dom.envMaxOutputTokens && !document.activeElement.isSameNode(dom.envMaxOutputTokens)) dom.envMaxOutputTokens.value = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '131072';
            if (dom.envMaxMcpTokens && !document.activeElement.isSameNode(dom.envMaxMcpTokens)) dom.envMaxMcpTokens.value = env.MAX_MCP_OUTPUT_TOKENS || '200000';
            if (dom.envApiTimeout && !document.activeElement.isSameNode(dom.envApiTimeout)) dom.envApiTimeout.value = env.API_TIMEOUT_MS || '600000';
            if (dom.envMcpTimeout && !document.activeElement.isSameNode(dom.envMcpTimeout)) dom.envMcpTimeout.value = env.MCP_TIMEOUT || '600000';
        }

        // Thinking budget
        if (dom.inputThinkingBudget) {
            const budget = Number(systemStatus.max_thinking_budget_tokens ?? 2048);
            if (!document.activeElement.isSameNode(dom.inputThinkingBudget)) {
                setThinkingBudgetValue(budget.toString());
            }
        }

        renderCompactEnvCode();
        updateConfigSyncStrip();
        updateRateLimitDisplay();
        updateLastUpdated();
        showDashboardContent();
        setProxyConnectionState('online');

        // Show unconfigured key warning in badge

        if (systemStatus.api_key_configured === false && dom.uptimeBadge) {

            const textSpan = dom.uptimeBadge.querySelector('span:last-child');

            if (textSpan) textSpan.textContent = t('status_connected_no_key');

        }

        return true;

    } catch (err) {

        console.error('Error fetching status:', err);

        const healthy = await isProxyHealthy();
        proxyReady = healthy;
        setProxyConnectionState(healthy ? 'online' : 'offline');

        showDashboardContent();

        return false;

    }

}

let currentHistoryData = [];


async function loadProfiles() {
    try {
        const resp = await apiFetch('/ocgt/api/profiles');
        if (!resp.ok) throw new Error('Failed');
        const data = await resp.json();
        dom.selectProfile.innerHTML = '';
        Object.keys(data.profiles).forEach(pName => {
            const opt = document.createElement('option');
            opt.value = pName;
            opt.textContent = pName;
            if (pName === data.active_profile) opt.selected = true;
            dom.selectProfile.appendChild(opt);
        });
        const activeProfile = data.profiles[data.active_profile];
        if (activeProfile) {
            dom.inputApiKey.value = activeProfile.api_key || '';
            setSelectValue(dom.inputDefaultModel, activeProfile.default_model || '');
            const aliases = activeProfile.model_aliases || {};
            setSelectValue(dom.inputSonnetMapping, aliases.sonnet || '');
            setSelectValue(dom.inputHaikuMapping, aliases.haiku || '');
            setSelectValue(dom.inputOpusMapping, aliases.opus || '');
            if (dom.inputQuotaCookie) dom.inputQuotaCookie.value = activeProfile.quota_cookie || ''; 
            if (dom.inputQuotaWorkspace) dom.inputQuotaWorkspace.value = activeProfile.quota_workspace_id || '';
        }
        captureOriginalSettings();

        clearChangesDetected();

        return true;

    } catch (err) {

        console.error('Error loading profiles:', err);

        if (!(await isProxyHealthy())) {
            proxyReady = false;
            setProxyConnectionState('offline');
        }

        return false;

    }

}

async function loadPreferences() {
    if (!dom.inputCloseBehavior && !dom.inputLogEnabled) return;
    try {
        const prefs = await callWails('GetPreferences');
        if (dom.inputCloseBehavior) {
            dom.inputCloseBehavior.value = normalizeCloseBehavior(prefs && prefs.close_behavior);
        }
        if (dom.inputLogEnabled) {
            dom.inputLogEnabled.checked = !prefs || prefs.log_enabled !== 'false';
        }
        if (dom.inputLogDirectory) {
            dom.inputLogDirectory.value = (prefs && prefs.log_directory) || '';
        }
        if (dom.inputLogRetention) {
            const savedVal = prefs && prefs.log_retention_days;
            dom.inputLogRetention.value = (savedVal !== undefined && savedVal !== null && savedVal !== '' && savedVal !== false) ? String(savedVal) : '14';
        }
        applyUIPreferences(prefs || {});
        captureOriginalSettings();
    } catch (err) {
        console.error('Failed to load preferences:', err);
        if (dom.inputCloseBehavior) dom.inputCloseBehavior.value = DEFAULT_CLOSE_BEHAVIOR;
        if (dom.inputLogEnabled) dom.inputLogEnabled.checked = true;
        if (dom.inputLogRetention) dom.inputLogRetention.value = '14';
        applyUIPreferences({});
    }
}

function applyUIPreferences(prefs) {
    uiPreferencesLoaded = false;
    const theme = normalizeTheme(prefs.theme || localStorage.getItem('theme') || 'system');
    const language = normalizeLanguage(prefs.language || localStorage.getItem('lang') || currentLang);
    const accentHue = normalizeHue(prefs.accent_hue || localStorage.getItem('accent-hue') || 174);
    const lastView = normalizeView(prefs.last_view || localStorage.getItem('last-view') || 'dashboard');
    const shell = normalizeCompactShell(prefs.compact_shell || localStorage.getItem('compact-shell') || compactShell);
    const expanded = parseExpandedIntegrations(prefs.expanded_integrations || localStorage.getItem('expanded-integrations') || '[]');

    applyTheme(theme, { persist: false });
    applyAccentHue(accentHue, { persist: false });
    currentLang = language;
    localStorage.setItem('lang', language);
    if (dom.prefLangSelect) dom.prefLangSelect.value = language;
    updateLanguageDOM();
    setActiveView(lastView, { persist: false });
    setCompactShell(shell, { persist: false });
    applyExpandedIntegrationIds(expanded);
    uiPreferencesLoaded = true;
}
// ══════════════════════════════════════════════════════

function getSettingsSnapshot() {
    return {
        profile: dom.selectProfile ? dom.selectProfile.value : '',
        apiKey: dom.inputApiKey ? dom.inputApiKey.value : '',
        upstream: dom.inputUpstream ? dom.inputUpstream.value : '',
        defaultModel: dom.inputDefaultModel ? dom.inputDefaultModel.value : '',
        sonnet: dom.inputSonnetMapping ? dom.inputSonnetMapping.value : '',
        haiku: dom.inputHaikuMapping ? dom.inputHaikuMapping.value : '',
        opus: dom.inputOpusMapping ? dom.inputOpusMapping.value : '',
        timeout: dom.inputTimeout ? dom.inputTimeout.value : '',
        listen: dom.inputListen ? dom.inputListen.value : '',
        thinkingBudget: dom.inputThinkingBudget ? dom.inputThinkingBudget.value : '',
        rateLimit: dom.inputRateLimit ? dom.inputRateLimit.value : '',
        rateBurst: dom.inputRateBurst ? dom.inputRateBurst.value : '',
        rateMinute: dom.inputRateMinute ? dom.inputRateMinute.value : '',
        quotaCookie: dom.inputQuotaCookie ? dom.inputQuotaCookie.value : '',
        quotaWorkspace: dom.inputQuotaWorkspace ? dom.inputQuotaWorkspace.value : '',
        claudeEnvTemplate: dom.inputClaudeEnvTemplate ? dom.inputClaudeEnvTemplate.value : '',
        envDisableNonEssential: dom.envDisableNonEssential ? dom.envDisableNonEssential.checked : true,
        envEnableToolSearch: dom.envEnableToolSearch ? dom.envEnableToolSearch.checked : true,
        envDisableAttribution: dom.envDisableAttribution ? dom.envDisableAttribution.checked : true,
        envDisableThinking: dom.envDisableThinking ? dom.envDisableThinking.checked : false,
        envMaxOutputTokens: dom.envMaxOutputTokens ? dom.envMaxOutputTokens.value : '',
        envMaxMcpTokens: dom.envMaxMcpTokens ? dom.envMaxMcpTokens.value : '',
        envApiTimeout: dom.envApiTimeout ? dom.envApiTimeout.value : '',
        envMcpTimeout: dom.envMcpTimeout ? dom.envMcpTimeout.value : '',
        closeBehavior: dom.inputCloseBehavior ? dom.inputCloseBehavior.value : ''
    };
}

function captureOriginalSettings() {
    originalSettingsValues = getSettingsSnapshot();
}

function restoreSettingsFromSnapshot(snapshot) {
    if (!snapshot) return;
    if (dom.selectProfile) dom.selectProfile.value = snapshot.profile || '';
    if (dom.inputApiKey) dom.inputApiKey.value = snapshot.apiKey || '';
    if (dom.inputUpstream) dom.inputUpstream.value = snapshot.upstream || '';
    if (dom.inputDefaultModel) setSelectValue(dom.inputDefaultModel, snapshot.defaultModel || '');
    if (dom.inputSonnetMapping) setSelectValue(dom.inputSonnetMapping, snapshot.sonnet || '');
    if (dom.inputHaikuMapping) setSelectValue(dom.inputHaikuMapping, snapshot.haiku || '');
    if (dom.inputOpusMapping) setSelectValue(dom.inputOpusMapping, snapshot.opus || '');
    if (dom.inputTimeout) dom.inputTimeout.value = snapshot.timeout || '300';
    if (dom.inputListen) dom.inputListen.value = snapshot.listen || '127.0.0.1:8787';
    if (dom.inputThinkingBudget) setThinkingBudgetValue(snapshot.thinkingBudget || '2048');
    if (dom.inputRateLimit) dom.inputRateLimit.value = snapshot.rateLimit || '';
    if (dom.inputRateBurst) dom.inputRateBurst.value = snapshot.rateBurst || '';
    if (dom.inputRateMinute) dom.inputRateMinute.value = snapshot.rateMinute || '';
    if (dom.inputQuotaCookie) dom.inputQuotaCookie.value = snapshot.quotaCookie || '';
    if (dom.inputQuotaWorkspace) dom.inputQuotaWorkspace.value = snapshot.quotaWorkspace || '';
    if (dom.inputClaudeEnvTemplate) dom.inputClaudeEnvTemplate.value = snapshot.claudeEnvTemplate || '{}';
    if (dom.inputCloseBehavior) dom.inputCloseBehavior.value = normalizeCloseBehavior(snapshot.closeBehavior);
    clearFieldErrors();
    clearChangesDetected();
    renderCompactEnvCode();
}

function updateConfigSyncStrip() {
    if (dom.syncProfileName) dom.syncProfileName.textContent = systemStatus && systemStatus.active_profile ? systemStatus.active_profile : '';
    if (dom.syncListenAddress) dom.syncListenAddress.textContent = systemStatus && systemStatus.listen ? systemStatus.listen : '';
}

function setSyncState(textEl, dotEl, active, label) {
    if (textEl) {
        textEl.textContent = '';
        textEl.style.color = active ? 'var(--green)' : 'var(--text-2)';
        const stateLabel = active ? t('sync_active') : '';
        textEl.title = label && stateLabel ? `${label}: ${stateLabel}` : (label || '');
    }
    if (dotEl) {
        dotEl.classList.toggle('inactive', !active);
        if (active) {
            dotEl.style.background = 'var(--green)';
            dotEl.style.boxShadow = '0 0 6px var(--green)';
        } else {
            dotEl.style.background = '';
            dotEl.style.boxShadow = '';
        }
    }
}

function updateRateLimitDisplay() {
    const limitEl = document.getElementById('traffic-stat-limit');
    if (!limitEl) return;
    const perSecond = Number(systemStatus && systemStatus.rate_limit_per_second);
    const burst = Number(systemStatus && systemStatus.rate_limit_burst);
    if (perSecond > 0 && burst > 0) {
        limitEl.textContent = `${perSecond}/s`;
        limitEl.title = `burst ${burst}`;
    } else {
        limitEl.textContent = '--';
        limitEl.removeAttribute('title');
    }
}

function checkForChanges() {
    const current = getSettingsSnapshot();
    const hasChanges = Object.keys(originalSettingsValues).some(k => current[k] !== originalSettingsValues[k]);
    renderCompactEnvCode();

    if (hasChanges && dom.configActions) {
        dom.configActions.classList.add('changes-detected');
        dom.btnSaveAllConfig.textContent = `\u26A1 ${t('btn_save_config')} \u00B7 ${t('hint_changes_detected')}`;
        if (dom.btnCancelConfig) dom.btnCancelConfig.disabled = false;
    } else if (dom.configActions) {
        dom.configActions.classList.remove('changes-detected');
        dom.btnSaveAllConfig.textContent = t('btn_save_config');
        if (dom.btnCancelConfig) dom.btnCancelConfig.disabled = true;
    }
}

function clearChangesDetected() {
    if (dom.configActions) {
        dom.configActions.classList.remove('changes-detected');
        dom.btnSaveAllConfig.textContent = t('btn_save_config');
        if (dom.btnCancelConfig) dom.btnCancelConfig.disabled = true;
    }
    captureOriginalSettings();
}
// ══════════════════════════════════════════════════════

// Client integrations code renderers are handled dynamically inside integrations-grid section







function setButtonState(btn, state) {
    if (state === 'saving') {
        btn.disabled = true;
        btn.textContent = t('status_saving');
        btn.classList.add('btn-saving');
    } else if (state === 'success') {
        btn.disabled = true;
        btn.classList.add('btn-success');
        btn.classList.remove('btn-saving');
        btn.textContent = t('status_success');
    } else { // idle
        btn.disabled = false;
        btn.classList.remove('btn-success', 'btn-saving');
        btn.textContent = t('btn_save_config');
    }
}

function copyText(text, btn) {
    const tooltip = btn.querySelector('.copied-tooltip');
    const showTooltip = () => {
        if (tooltip) {
            tooltip.textContent = t('btn_copied');
            tooltip.classList.add('show');
            btn.style.borderColor = 'var(--green-border)';
            btn.style.color = 'var(--green)';
            setTimeout(() => {
                tooltip.classList.remove('show');
                btn.style.borderColor = '';
                btn.style.color = '';
            }, 1500);
        }
    };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(showTooltip).catch(e => {
            console.error(e);
            toastI18n('toast_copy_failed', 'error');
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showTooltip(); } catch (e) { console.error(e); }
        document.body.removeChild(ta);
    }
}

function setFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.classList.add('error');
    const hiddenParent = field.closest('details:not([open])');
    if (hiddenParent) hiddenParent.open = true;
    const errorText = field.querySelector('.field-error-text');
    if (errorText) errorText.textContent = message;
}

function clearFieldErrors() {
    document.querySelectorAll('.field.error').forEach(f => f.classList.remove('error'));
}

function isValidListenAddress(value) {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/^(?:\[[^\]]+\]|[^:\s]+)?:([0-9]{1,5})$/);
    if (!match) return false;
    const port = Number(match[1]);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}
// ══════════════════════════════════════════════════════

function updateLanguageDOM() {
    const lang = currentLang;
    const dict = i18n[lang];
    if (!dict) return;

    // Sync language selector
    if (dom.prefLangSelect) dom.prefLangSelect.value = lang;

    if (dom.prefsToggleBtn) {
        dom.prefsToggleBtn.setAttribute('title', lang === 'zh' ? '偏好设置' : 'Preferences');
    }

    // data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (!Object.prototype.hasOwnProperty.call(dict, key)) return;
        const tag = el.tagName;
        if (['SPAN', 'BUTTON', 'H2', 'H3', 'H4', 'LABEL', 'P', 'TH', 'LI', 'OPTION'].includes(tag)) {
            const value = dict[key];
            // Use textContent for plain text; only allow specific safe HTML tags via DOM API
            const containsHTML = /<[a-z]/i.test(value);
            if (containsHTML) {
                // Parse HTML safely: only allow <b>, <i>, <code>, <br>, strong>, <em>
                el.textContent = '';
                const temp = document.createElement('div');
                temp.innerHTML = value;
                // Move only allowed child nodes
                Array.from(temp.childNodes).forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        el.appendChild(document.createTextNode(node.textContent));
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const allowed = ['B', 'I', 'CODE', 'BR', 'STRONG', 'EM'];
                        if (allowed.includes(node.tagName)) {
                            const clone = node.cloneNode(true);
                            el.appendChild(clone);
                        } else {
                            // For disallowed tags, just append text content
                            el.appendChild(document.createTextNode(node.textContent));
                        }
                    }
                });
            } else {
                el.textContent = value;
            }
        } else {
            el.textContent = dict[key];
        }
    });

    // Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (Object.prototype.hasOwnProperty.call(dict, key)) el.setAttribute('placeholder', dict[key]);
    });

    // Footer
    if (dom.footerText) dom.footerText.textContent = dict.footer_text;

    updateActiveViewHeaders();
}

function updateActiveViewHeaders() {
    const activeItem = document.querySelector('.nav-item.active');
    if (!activeItem) return;
    const viewId = activeItem.dataset.view;
    const titleEl = document.getElementById('current-view-title');
    const subtitleEl = document.getElementById('current-view-subtitle');
    if (!titleEl || !subtitleEl) return;
    const meta = {
        dashboard: { title: t('title_dashboard'), subtitle: t('subtitle_dashboard') },
        settings: { title: t('title_settings'), subtitle: t('subtitle_settings') },
        terminal: { title: t('title_terminal'), subtitle: t('subtitle_terminal') },
        history: { title: t('title_history'), subtitle: t('subtitle_history') },
        'traffic-detail': { title: '流量明细', subtitle: '查看所有请求的详细记录' }
    }[viewId];
    if (meta) {
        titleEl.textContent = meta.title;
        subtitleEl.textContent = meta.subtitle;
    }
}
// ══════════════════════════════════════════════════════

// ── 12a: Navigation ──
function setActiveView(viewId, options = {}) {
    viewId = normalizeView(viewId);
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    navItems.forEach(nav => nav.classList.toggle('active', nav.dataset.view === viewId));
    views.forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) targetView.classList.add('active');
    updateActiveViewHeaders();
    // Init traffic detail on first activation
    if (viewId === 'traffic-detail' && typeof initTrafficDetail === 'function') {
      initTrafficDetail();
    }
    if (options.persist !== false) {
        localStorage.setItem('last-view', viewId);
        persistUIPreferencesSoon();
    }
}

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.view) setActiveView(item.dataset.view);
        });
    });

    // Status pill → dashboard
    if (dom.statusPill) {
        dom.statusPill.addEventListener('click', () => {
            const dashBtn = document.getElementById('btn-nav-dashboard');
            if (dashBtn) dashBtn.click();
        });
    }

    // Sidebar brand → dashboard
    const sidebarBrand = document.getElementById('sidebarBrand');
    if (sidebarBrand) {
        sidebarBrand.addEventListener('click', () => {
            const dashBtn = document.getElementById('btn-nav-dashboard');
            if (dashBtn) dashBtn.click();
        });
        sidebarBrand.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const dashBtn = document.getElementById('btn-nav-dashboard');
                if (dashBtn) dashBtn.click();
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            const viewMap = { '1': 'dashboard', '2': 'settings', '3': 'terminal', '4': 'history', '5': 'traffic-detail' };
            const viewId = viewMap[e.key];
            if (viewId) {
                e.preventDefault();
                const btn = document.querySelector(`[data-view="${viewId}"]`);
                if (btn) btn.click();
            }
        }
        if (e.key === 'Escape') {
            if (activeCustomModelCancel) activeCustomModelCancel();
            if (activeRawJsonClose) activeRawJsonClose();
            hideModal(dom.closeDialogOverlay);
            hideModal(dom.aboutDialogOverlay);
            closeSettingsPanel();
        }
    });

    if (dom.btnNavHistory) {
        dom.btnNavHistory.addEventListener('click', () => setActiveView('history'));
    }
}

// ── 12b: Settings form ──
function setupSettingsHandlers() {
    const segControl = document.getElementById('thinking-seg-control');
    if (segControl && dom.inputThinkingBudget) {
        segControl.querySelectorAll('.sett-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setThinkingBudgetValue(btn.dataset.val);
                dom.inputThinkingBudget.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
        dom.inputThinkingBudget.addEventListener('change', () => {
            syncThinkingSegmentControl(dom.inputThinkingBudget.value);
        });
        syncThinkingSegmentControl(dom.inputThinkingBudget.value);
    }

    // Profile change
    if (dom.selectProfile) {
        dom.selectProfile.addEventListener('change', async (e) => {
            try {
                const resp = await apiFetch('/ocgt/api/profiles/active', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: e.target.value })
                });
                if (resp.ok) {
                    toastI18n('toast_profile_changed', 'success');
                    await loadStatus();
                    await loadProfiles();
                }
            } catch (err) { console.error('Failed to change profile:', err); }
        });
    }

    // Toggle password visibility
    if (dom.btnToggleVisibility) {
        dom.btnToggleVisibility.addEventListener('click', () => {
            dom.inputApiKey.type = dom.inputApiKey.type === 'password' ? 'text' : 'password';
        });
    }

    // Save config
    if (dom.btnSaveAllConfig) {
        dom.btnSaveAllConfig.addEventListener('click', handleSaveConfig);
    }
    if (dom.btnCancelConfig) {
        dom.btnCancelConfig.disabled = true;
        dom.btnCancelConfig.addEventListener('click', () => restoreSettingsFromSnapshot(originalSettingsValues));
    }

    // Change detection on all settings inputs
    const settingsInputs = [
        dom.selectProfile, dom.inputApiKey, dom.inputUpstream, dom.inputDefaultModel, dom.inputSonnetMapping,
        dom.inputHaikuMapping, dom.inputOpusMapping, dom.inputTimeout, dom.inputThinkingBudget, dom.inputListen,
        dom.inputRateLimit, dom.inputRateBurst, dom.inputRateMinute, dom.inputClaudeEnvTemplate,
        dom.envDisableNonEssential, dom.envEnableToolSearch, dom.envDisableAttribution, dom.envDisableThinking,
        dom.envMaxOutputTokens, dom.envMaxMcpTokens, dom.envApiTimeout, dom.envMcpTimeout,
        dom.inputCloseBehavior
    ];
    settingsInputs.forEach(el => {
        if (!el) return;
        el.addEventListener('input', checkForChanges);
        el.addEventListener('change', checkForChanges);
    });

    // Custom model select handling

    [dom.inputDefaultModel, dom.inputSonnetMapping, dom.inputHaikuMapping, dom.inputOpusMapping].forEach(selectEl => {

        if (!selectEl) return;

        const capturePreviousValue = () => {
            if (selectEl.value && selectEl.value !== 'custom') selectEl.dataset.previousValue = selectEl.value;
        };

        selectEl.addEventListener('focus', capturePreviousValue);
        selectEl.addEventListener('pointerdown', capturePreviousValue);

        selectEl.addEventListener('change', async (e) => {

            if (e.target.value !== 'custom') return;

            const previousValue = selectEl.dataset.previousValue || selectEl.options[0].value;

            const newVal = await requestCustomModelName();

            if (newVal && newVal.trim()) {

                const value = newVal.trim();

                let exists = false;

                for (let i = 0; i < selectEl.options.length; i++) {

                    if (selectEl.options[i].value === value) { selectEl.selectedIndex = i; exists = true; break; }

                }

                if (!exists) {

                    const opt = document.createElement('option');

                    opt.value = value;

                    opt.textContent = value;

                    selectEl.insertBefore(opt, selectEl.lastElementChild);

                    selectEl.value = value;

                }

                selectEl.dataset.previousValue = value;

            } else {

                selectEl.value = previousValue || selectEl.options[0].value;

            }

            checkForChanges();

        });

    });

    // Reset defaults — fixed: "Confirm" action now correctly triggers the reset
    if (dom.resetDefaultsBtn) {
        dom.resetDefaultsBtn.addEventListener('click', () => {
            toast(t('toast_reset_confirm'), 'warning', {
                duration: 5000,
                actionLabel: t('toast_confirm'),
                actionCallback: () => {
                    if (dom.inputTimeout) dom.inputTimeout.value = '300';
                    if (dom.inputListen) dom.inputListen.value = '127.0.0.1:8787';
                    if (dom.inputUpstream) dom.inputUpstream.value = 'https://opencode.ai/zen/go';
                    if (dom.inputThinkingBudget) setThinkingBudgetValue('2048');
                    if (dom.inputRateLimit) dom.inputRateLimit.value = '100';
                    if (dom.inputRateBurst) dom.inputRateBurst.value = '200';
                    if (dom.inputClaudeEnvTemplate && systemStatus) dom.inputClaudeEnvTemplate.value = orderedJSONString(systemStatus.claude_env || {});
                    if (dom.inputDefaultModel) setSelectValue(dom.inputDefaultModel, 'kimi-k2.6');
                    if (dom.inputSonnetMapping) setSelectValue(dom.inputSonnetMapping, 'qwen3.6-plus');
                    if (dom.inputHaikuMapping) setSelectValue(dom.inputHaikuMapping, 'deepseek-v4-flash');
                    if (dom.inputOpusMapping) setSelectValue(dom.inputOpusMapping, 'kimi-k2.6');
                    if (dom.inputCloseBehavior) dom.inputCloseBehavior.value = 'prompt';
                    applyTheme('system');
                    applyAccentHue(174);
                    currentLang = 'zh';
                    localStorage.setItem('lang', currentLang);
                    if (dom.prefLangSelect) dom.prefLangSelect.value = currentLang;
                    updateLanguageDOM();
                    setActiveView('dashboard');
                    setCompactShell('powershell');
                    applyExpandedIntegrationIds([]);
                    checkForChanges();
                    saveUIPreferences().catch(err => console.error('Failed to save reset UI preferences:', err));
                    toastI18n('toast_reset_done', 'success');
                }
            });
        });
    }

    // Close behavior auto-save
    if (dom.inputCloseBehavior) {
        dom.inputCloseBehavior.addEventListener('change', async () => {
            checkForChanges();
            try { await callWails('SavePreferences', normalizeCloseBehavior(dom.inputCloseBehavior.value)); }
            catch (err) { console.error('Failed to save close behavior:', err); }
        });
    }

    if (dom.btnSaveLogPrefs) {
        dom.btnSaveLogPrefs.addEventListener('click', () => saveLogPreferences(true));
    }
    if (dom.btnOpenLogDir) {
        dom.btnOpenLogDir.addEventListener('click', async () => {
            const res = await callWails('OpenLogLocation');
            if (res && res !== 'success') toast(res, 'error');
        });
    }
}

async function saveLogPreferences(showToast) {
    const app = getWailsApp();
    if (!app || typeof app.SaveLogPreferences !== 'function') return true;
    const enabled = !!(dom.inputLogEnabled && dom.inputLogEnabled.checked);
    const directory = dom.inputLogDirectory ? dom.inputLogDirectory.value.trim() : '';
    const retention = Number(dom.inputLogRetention ? dom.inputLogRetention.value : 14);
    if (!Number.isInteger(retention) || retention < 0 || retention > 365) {
        if (showToast) toast(t('toast_log_prefs_failed') + ': 1-365', 'error');
        return false;
    }
    try {
        const res = await app.SaveLogPreferences(enabled, directory, retention);
        if (res === 'success') {
            if (showToast) toastI18n('toast_log_prefs_saved', 'success');
            await loadPreferences();
            return true;
        } else if (showToast) {
            toast(t('toast_log_prefs_failed') + ': ' + res, 'error');
        }
        return false;
    } catch (err) {
        console.error('Failed to save log preferences:', err);
        if (showToast) toast(t('toast_log_prefs_failed') + ': ' + err.message, 'error');
        return false;
    }
}

async function handleSaveConfig() {
    const pName = dom.selectProfile.value;
    const key = dom.inputApiKey.value.trim();
    const defModel = dom.inputDefaultModel.value.trim();
    const sonnet = dom.inputSonnetMapping.value.trim();
    const haiku = dom.inputHaikuMapping.value.trim();
    const opus = dom.inputOpusMapping.value.trim();
    const upstream = dom.inputUpstream ? dom.inputUpstream.value.trim() : '';
    const timeoutSeconds = dom.inputTimeout ? dom.inputTimeout.value.trim() : '300';
    const listenAddr = dom.inputListen ? dom.inputListen.value.trim() : '127.0.0.1:8787';
    const thinkingBudget = dom.inputThinkingBudget ? dom.inputThinkingBudget.value.trim() : '2048';
    const rateLimit = dom.inputRateLimit ? dom.inputRateLimit.value.trim() : '';
    const rateBurst = dom.inputRateBurst ? dom.inputRateBurst.value.trim() : '';
    const rateMinute = dom.inputRateMinute ? dom.inputRateMinute.value.trim() : '';
    const quotaCookie = dom.inputQuotaCookie ? dom.inputQuotaCookie.value.trim() : '';
    const quotaWorkspace = dom.inputQuotaWorkspace ? dom.inputQuotaWorkspace.value.trim() : '';
    const timeoutNumber = Number(timeoutSeconds);
    const rateLimitNumber = rateLimit ? Number(rateLimit) : 0;
    const rateBurstNumber = rateBurst ? Number(rateBurst) : 0;
    const rateMinuteNumber = rateMinute ? Number(rateMinute) : 0;
    let claudeEnvTemplate = {};

    // Validation
    let hasErrors = false;
    clearFieldErrors();
    if (upstream) {
        try {
            const parsedUpstream = new URL(upstream);
            if (!['http:', 'https:'].includes(parsedUpstream.protocol)) throw new Error('invalid protocol');
        } catch (_) {
            setFieldError('field-upstream', t('err_upstream_url'));
            hasErrors = true;
        }
    }
    if (!isValidListenAddress(listenAddr)) {
        setFieldError('field-listen', t('err_listen_addr'));
        hasErrors = true;
    }
    if (!Number.isInteger(timeoutNumber) || timeoutNumber < 1 || timeoutNumber > 3600) {
        setFieldError('field-timeout', t('err_timeout_range'));
        hasErrors = true;
    }
    if (rateLimit && (!Number.isInteger(rateLimitNumber) || rateLimitNumber < 1 || rateLimitNumber > 10000)) {
        setFieldError('field-rate-limit', t('err_rate_limit_range'));
        hasErrors = true;
    }
    if (rateBurst && (!Number.isInteger(rateBurstNumber) || rateBurstNumber < 1 || rateBurstNumber > 100000)) {
        setFieldError('field-rate-burst', t('err_rate_burst_range'));
        hasErrors = true;
    }
    if (rateMinute && (!Number.isInteger(rateMinuteNumber) || rateMinuteNumber < 0 || rateMinuteNumber > 100000)) {
        setFieldError('field-rate-minute', t('err_rate_minute_range'));
        hasErrors = true;
    }
    if (!ALLOWED_THINKING_BUDGETS.includes(thinkingBudget)) {
        hasErrors = true;
    }
    try {
        claudeEnvTemplate = buildClaudeEnvForClient('claude-code-cli');
    } catch (err) {
        setFieldError('field-claude-env-template', err.message || t('err_claude_env_json'));
        hasErrors = true;
    }
    if (hasErrors) {
        toastI18n('toast_validation_error', 'error');
        const firstError = document.querySelector('.field.error');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const focusTarget = firstError.querySelector('input, select, textarea, button');
            if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
        }
        return;
    }

    setButtonState(dom.btnSaveAllConfig, 'saving');
    const app = getWailsApp();
    if (dom.inputClaudeEnvTemplate) {
        dom.inputClaudeEnvTemplate.value = orderedJSONString(claudeEnvTemplate);
    }

    if (app) {
        try {
            const claudeEnvJSON = JSON.stringify(claudeEnvTemplate);
            const res = await app.SaveProfileConfig(pName, key, defModel, sonnet, haiku, opus, timeoutSeconds, thinkingBudget, listenAddr, upstream, rateLimit, rateBurst, rateMinute || '0', claudeEnvJSON, quotaCookie, quotaWorkspace);
            if (res === 'success') {
                if (dom.inputCloseBehavior && typeof app.SavePreferences === 'function') {
                    const prefRes = await app.SavePreferences(normalizeCloseBehavior(dom.inputCloseBehavior.value));
                    if (prefRes !== 'success') throw new Error(prefRes);
                }
                setButtonState(dom.btnSaveAllConfig, 'success');
                clearChangesDetected();
                toastI18n('toast_saved', 'success');
                await loadStatus();
                await loadPreferences();
                await loadProfiles();
                setTimeout(() => setButtonState(dom.btnSaveAllConfig, 'idle'), 1500);
            } else {
                setButtonState(dom.btnSaveAllConfig, 'idle');
                toast(t('toast_save_failed') + ': ' + res, 'error');
            }
        } catch (err) {
            console.error('Failed to save config via Wails:', err);
            setButtonState(dom.btnSaveAllConfig, 'idle');
            toast(t('toast_save_failed') + ': ' + err.message, 'error');
        }
    } else {
        // Fallback: HTTP API
        try {
            const resp = await apiFetch('/ocgt/api/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profile: pName, api_key: key, default_model: defModel,
                    model_aliases: { sonnet, haiku, opus },
                    request_timeout_seconds: timeoutNumber,
                    max_thinking_budget_tokens: Number(thinkingBudget),
                    upstream,
                    listen: listenAddr,
                    rate_limit_per_second: rateLimitNumber,
                    rate_limit_burst: rateBurstNumber,
                    rate_limit_per_minute: rateMinuteNumber,
                    claude_env: claudeEnvTemplate
                })
            });
            if (resp.ok) {
                setButtonState(dom.btnSaveAllConfig, 'success');
                clearChangesDetected();
                toastI18n('toast_saved', 'success');
                await loadStatus();
                await loadProfiles();
                setTimeout(() => setButtonState(dom.btnSaveAllConfig, 'idle'), 1500);
            } else {
                setButtonState(dom.btnSaveAllConfig, 'idle');
                const message = await resp.text();
                toast(t('toast_save_failed') + (message ? ': ' + message : ''), 'error');
            }
        } catch (err) {
            console.error('Fallback save error:', err);
            setButtonState(dom.btnSaveAllConfig, 'idle');
            toast(t('toast_save_failed') + ': ' + err.message, 'error');
        }
    }
}

// ── 12c: Terminal ──
// ── 12c: Client Integrations (formerly Terminal) ──
let compactShell = 'powershell';

function setCompactShell(shell, options = {}) {
    compactShell = normalizeCompactShell(shell);
    if (dom.compactShellTabs) {
        dom.compactShellTabs.querySelectorAll('.compact-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.shell === compactShell);
        });
    }
    localStorage.setItem('compact-shell', compactShell);
    renderCompactEnvCode();
    if (options.persist !== false) persistUIPreferencesSoon();
}

function setupTerminalHandlers() {
    const toggleIntegrationRow = (row) => {
        if (!row) return;
        const btn = row.querySelector('.ir-expand-btn');
        const expanded = !row.classList.contains('expanded');
        row.classList.toggle('expanded', expanded);
        if (btn) btn.setAttribute('aria-expanded', String(expanded));
        persistUIPreferencesSoon();
    };

    document.querySelectorAll('.integration-row .ir-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            toggleIntegrationRow(btn.closest('.integration-row'));
        });
    });
    document.querySelectorAll('.integration-row .ir-main').forEach(rowMain => {
        rowMain.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, textarea, pre, code')) return;
            toggleIntegrationRow(rowMain.closest('.integration-row'));
        });
        rowMain.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('button, a, input, select, textarea')) return;
            e.preventDefault();
            toggleIntegrationRow(rowMain.closest('.integration-row'));
        });
        rowMain.tabIndex = 0;
        rowMain.setAttribute('role', 'button');
    });

    if (dom.btnRepairAll) {
        dom.btnRepairAll.addEventListener('click', handleRepairAll);
    }

    // System Env Buttons
    if (dom.btnSysEnvInstall) {
        dom.btnSysEnvInstall.addEventListener('click', handleSysEnvInstall);
    }
    if (dom.btnSysEnvRemove) {
        dom.btnSysEnvRemove.addEventListener('click', handleSysEnvRemove);
    }

    // VS Code Buttons
    if (dom.btnVscodeInstall) {
        dom.btnVscodeInstall.addEventListener('click', handleVscodeInstall);
    }
    if (dom.btnVscodeRemove) {
        dom.btnVscodeRemove.addEventListener('click', handleVscodeRemove);
    }

    // Claude CLI Buttons
    if (dom.btnSetupDesktop) {
        dom.btnSetupDesktop.addEventListener('click', handleSetupDesktop);
    }
    if (dom.btnClearDesktop) {
        dom.btnClearDesktop.addEventListener('click', handleClearDesktopConfig);
    }
    if (dom.btnSetupClaudeDesktopApp) {
        dom.btnSetupClaudeDesktopApp.addEventListener('click', handleSetupClaudeDesktopApp);
    }
    if (dom.btnClearClaudeDesktopApp) {
        dom.btnClearClaudeDesktopApp.addEventListener('click', handleClearClaudeDesktopApp);
    }
    if (dom.btnLaunchTerminal) {
        dom.btnLaunchTerminal.addEventListener('click', handleLaunchTerminal);
    }

    // Compact Shell Tabs
    if (dom.compactShellTabs) {
        dom.compactShellTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.compact-tab');
            if (!btn) return;
            setCompactShell(btn.dataset.shell);
        });
    }

    // Compact Copy Button
    if (dom.compactCopyBtn) {
        dom.compactCopyBtn.addEventListener('click', () => {
            if (dom.compactEnvCode) {
                copyText(dom.compactEnvCode.innerText, dom.compactCopyBtn);
            }
        });
    }

    // Periodic integration status updates

    checkIntegrationsStatus();

    if (getWailsApp()) {

        integrationStatusTimer = setInterval(checkIntegrationsStatus, 12000);

    }

}

async function checkIntegrationsStatus() {
    const app = getWailsApp();
    if (!app) return;
    if (integrationStatusChecking) return;
    integrationStatusChecking = true;

    try {
        const checks = await Promise.all([
            typeof app.IsSystemEnvConfigured === 'function' ? app.IsSystemEnvConfigured().then(configured => ({ key: 'cli', configured })).catch(err => ({ key: 'cli', err })) : null,
            typeof app.IsVSCodeConfigured === 'function' ? app.IsVSCodeConfigured().then(configured => ({ key: 'vscode', configured })).catch(err => ({ key: 'vscode', err })) : null,
            typeof app.IsClaudeDesktopConfigured === 'function' ? app.IsClaudeDesktopConfigured().then(configured => ({ key: 'claude', configured })).catch(err => ({ key: 'claude', err })) : null,
            typeof app.IsClaudeDesktopAppConfigured === 'function' ? app.IsClaudeDesktopAppConfigured().then(configured => ({ key: 'claudeDesktopApp', configured })).catch(err => ({ key: 'claudeDesktopApp', err })) : null,
        ]);
        checks.filter(Boolean).forEach(({ key, configured, err }) => {
            if (err) {
                console.warn(`Failed to check ${key} integration:`, err);
                return;
            }
            applyIntegrationStatus(key, configured);
        });
    } catch (err) {
        console.error('Failed to check integrations status:', err);
    } finally {
        integrationStatusChecking = false;
    }
}

function applyIntegrationStatus(key, configured) {
    const chip = document.getElementById(`chip-${key}`);
    if (chip) {
        chip.style.display = configured ? 'flex' : 'none';
    }

    if (key === 'cli') {
        updateIntegrationBadge(dom.sysEnvBadge, configured);
        setSyncState(dom.syncCliState, dom.syncCliDot, configured, 'CLI');
        setSyncState(null, document.getElementById('dash-cli-dot'), configured, 'CLI');
        setInstallButtonReapplyState(dom.btnSysEnvInstall, configured);
        setButtonDisabledIfIdle(dom.btnSysEnvRemove, !configured);
    } else if (key === 'vscode') {
        updateIntegrationBadge(dom.vscodeBadge, configured);
        setSyncState(dom.syncVscodeState, dom.syncVscodeDot, configured, 'VS Code');
        setSyncState(null, document.getElementById('dash-vscode-dot'), configured, 'VS Code');
        setInstallButtonReapplyState(dom.btnVscodeInstall, configured);
        setButtonDisabledIfIdle(dom.btnVscodeRemove, !configured);
    } else if (key === 'claude') {
        updateIntegrationBadge(dom.claudeDesktopBadge, configured);
        setInstallButtonReapplyState(dom.btnSetupDesktop, configured);
        setButtonDisabledIfIdle(dom.btnClearDesktop, !configured);
    } else if (key === 'claudeDesktopApp') {
        updateIntegrationBadge(dom.claudeDesktopAppBadge, configured);
        setSyncState(dom.syncClaudeState, dom.syncClaudeDot, configured, 'Claude Desktop');
        setSyncState(null, document.getElementById('dash-claude-dot'), configured, 'Claude Desktop');
        setInstallButtonReapplyState(dom.btnSetupClaudeDesktopApp, configured);
        setButtonDisabledIfIdle(dom.btnClearClaudeDesktopApp, !configured);
    }
}

function refreshIntegrationsSoon() {
    window.setTimeout(checkIntegrationsStatus, 350);
}

function isButtonBusy(btn) {
    return !!(btn && btn.dataset.busy === 'true');
}

function setButtonDisabledIfIdle(btn, disabled) {
    if (!btn || isButtonBusy(btn)) return;
    btn.disabled = disabled;
}

function setInstallButtonReapplyState(btn, configured) {
    if (!btn) return;
    setButtonDisabledIfIdle(btn, false);
    if (configured) {
        btn.title = t('integration_reapply_hint');
        btn.setAttribute('aria-label', t('integration_reapply_hint'));
    } else {
        btn.removeAttribute('title');
        btn.removeAttribute('aria-label');
    }
}

function setButtonBusy(btn, busy, labelKey) {
    if (!btn) return;
    if (busy) {
        btn.dataset.busy = 'true';
        btn.dataset.idleText = btn.textContent;
        btn.textContent = t(labelKey);
        btn.disabled = true;
        return;
    }
    if (btn.dataset.idleText) {
        btn.textContent = btn.dataset.idleText;
        delete btn.dataset.idleText;
    }
    delete btn.dataset.busy;
    btn.disabled = false;
}

function updateIntegrationBadge(el, active) {
    if (!el) return;
    el.textContent = active ? t('badge_active') : t('badge_inactive');
    el.className = `integration-badge ${active ? 'active' : 'inactive'}`;
}

function renderCompactEnvCode() {
    if (!dom.compactEnvCode) return;
    let env = {};
    try {
        env = buildClaudeEnvForClient('claude-code-cli');
    } catch (_) {
        env = {
            ANTHROPIC_BASE_URL: `http://${(systemStatus && systemStatus.listen) || '127.0.0.1:8787'}`,
            ANTHROPIC_API_KEY: 'ocgt-local-proxy',
        };
    }
    const entries = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
    if (compactShell === 'powershell') {
        dom.compactEnvCode.textContent = entries.map(([key, value]) => `$env:${key}=${shellQuotePowerShell(value)}`).join('\n');
    } else if (compactShell === 'cmd') {
        dom.compactEnvCode.textContent = entries.map(([key, value]) => `set "${key}=${String(value).replace(/"/g, '\\"')}"`).join('\n');
    } else {
        dom.compactEnvCode.textContent = entries.map(([key, value]) => `export ${key}=${shellQuoteBash(value)}`).join('\n');
    }
}

// ── Actions ──

async function handleLaunchTerminal() {
    const app = getWailsApp();
    if (!app || typeof app.LaunchClaudeTerminal !== 'function') {
        toast(t('warn_desktop_only_launch'), 'info');
        return;
    }
    const btn = dom.btnLaunchTerminal;
    const idleText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = t('term_launching');
    }
    try {
        const res = await app.LaunchClaudeTerminal(compactShell || 'powershell', currentLang || 'zh');
        if (res === 'success') {
            toastI18n('toast_launch_success', 'success');
        } else {
            toast(t('toast_launch_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Launch terminal error:', err);
        toast(t('toast_launch_failed') + ': ' + err.message, 'error');
    } finally {
        if (btn) {
            window.setTimeout(() => {
                btn.disabled = false;
                btn.textContent = idleText || t('btn_launch_temp_term');
            }, 500);
        }
    }
}

async function handleRepairAll() {
    const app = getWailsApp();
    if (!app) {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    const repairFn = typeof app.RepairAllConfigurations === 'function'
        ? app.RepairAllConfigurations
        : app.SyncConfiguredIntegrations;
    if (typeof repairFn !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    setButtonBusy(dom.btnRepairAll, true, 'env_repairing');
    try {
        const res = await repairFn();
        if (res === 'success') {
            toastI18n('toast_repair_all_success', 'success');
            await loadStatus();
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_repair_all_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Repair all error:', err);
        toast(t('toast_repair_all_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnRepairAll, false);
    }
}

async function handleSysEnvInstall() {
    const app = getWailsApp();
    if (!app || typeof app.InstallClaudeUserEnv !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnSysEnvInstall, true, 'status_configuring');
    try {
        const res = await app.InstallClaudeUserEnv();
        if (res === 'success') {
            toastI18n('toast_sys_installed', 'success');
            nextStatus = true;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_env_repair_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('SysEnvInstall error:', err);
        toast(t('toast_env_repair_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnSysEnvInstall, false);
        if (nextStatus !== null) applyIntegrationStatus('cli', nextStatus);
    }
}

async function handleSysEnvRemove() {
    const app = getWailsApp();
    if (!app || typeof app.ClearSystemEnv !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnSysEnvRemove, true, 'status_clearing');
    try {
        const res = await app.ClearSystemEnv();
        if (res === 'success') {
            toastI18n('toast_sys_removed', 'success');
            nextStatus = false;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_env_repair_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('SysEnvRemove error:', err);
        toast(t('toast_env_repair_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnSysEnvRemove, false);
        if (nextStatus !== null) applyIntegrationStatus('cli', nextStatus);
    }
}

async function handleVscodeInstall() {
    const app = getWailsApp();
    if (!app || typeof app.InstallVSCodeEnv !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnVscodeInstall, true, 'status_configuring');
    try {
        const res = await app.InstallVSCodeEnv();
        if (res === 'success') {
            toastI18n('toast_vscode_installed', 'success');
            nextStatus = true;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_vscode_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('VscodeInstall error:', err);
        toast(t('toast_vscode_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnVscodeInstall, false);
        if (nextStatus !== null) applyIntegrationStatus('vscode', nextStatus);
    }
}

async function handleVscodeRemove() {
    const app = getWailsApp();
    if (!app || typeof app.RemoveVSCodeEnv !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnVscodeRemove, true, 'status_clearing');
    try {
        const res = await app.RemoveVSCodeEnv();
        if (res === 'success') {
            toastI18n('toast_vscode_removed', 'success');
            nextStatus = false;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_vscode_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('VscodeRemove error:', err);
        toast(t('toast_vscode_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnVscodeRemove, false);
        if (nextStatus !== null) applyIntegrationStatus('vscode', nextStatus);
    }
}

async function handleSetupDesktop() {
    const app = getWailsApp();
    if (!app || typeof app.SetupClaudeDesktop !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }

    let nextStatus = null;
    setButtonBusy(dom.btnSetupDesktop, true, 'status_configuring');
    try {
        const res = await app.SetupClaudeDesktop();
        if (res === 'success') {
            toastI18n('toast_desktop_setup_success', 'success');
            nextStatus = true;
            refreshIntegrationsSoon();
        } else {
            toastI18n('toast_desktop_setup_fail', 'error');
        }
    } catch (err) {
        console.error('Setup desktop error:', err);
        toastI18n('toast_desktop_setup_fail', 'error');
    } finally {
        setButtonBusy(dom.btnSetupDesktop, false);
        if (nextStatus !== null) applyIntegrationStatus('claude', nextStatus);
    }
}

async function handleClearDesktopConfig() {
    const app = getWailsApp();
    if (!app || typeof app.ClearClaudeDesktop !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }

    let nextStatus = null;
    setButtonBusy(dom.btnClearDesktop, true, 'status_clearing');
    try {
        const res = await app.ClearClaudeDesktop();
        if (res === 'success') {
            toastI18n('toast_desktop_cleared', 'success');
            nextStatus = false;
            refreshIntegrationsSoon();
        } else {
            toastI18n('toast_desktop_setup_fail', 'error');
        }
    } catch (err) {
        console.error('Clear desktop config error:', err);
        toastI18n('toast_desktop_setup_fail', 'error');
    } finally {
        setButtonBusy(dom.btnClearDesktop, false);
        if (nextStatus !== null) applyIntegrationStatus('claude', nextStatus);
    }
}

async function handleSetupClaudeDesktopApp() {
    const app = getWailsApp();
    if (!app || typeof app.SetupClaudeDesktopApp !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnSetupClaudeDesktopApp, true, 'status_configuring');
    try {
        const res = await app.SetupClaudeDesktopApp();
        if (res === 'success') {
            toastI18n('toast_claude_desktop_app_setup_success', 'success');
            nextStatus = true;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_desktop_setup_fail') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Setup Claude Desktop App error:', err);
        toast(t('toast_desktop_setup_fail') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnSetupClaudeDesktopApp, false);
        if (nextStatus !== null) applyIntegrationStatus('claudeDesktopApp', nextStatus);
    }
}

async function handleClearClaudeDesktopApp() {
    const app = getWailsApp();
    if (!app || typeof app.ClearClaudeDesktopApp !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnClearClaudeDesktopApp, true, 'status_clearing');
    try {
        const res = await app.ClearClaudeDesktopApp();
        if (res === 'success') {
            toastI18n('toast_claude_desktop_app_cleared', 'success');
            nextStatus = false;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_desktop_setup_fail') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Clear Claude Desktop App error:', err);
        toast(t('toast_desktop_setup_fail') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnClearClaudeDesktopApp, false);
        if (nextStatus !== null) applyIntegrationStatus('claudeDesktopApp', nextStatus);
    }
}

// ── 12e: History ──
function setupHistoryHandlers() {
}

// ── 12f: Theme & preferences center panel ──
function applyTheme(theme, options = {}) {
    theme = normalizeTheme(theme);
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('theme', theme);
    syncThemeButtons(theme);
    if (options.persist !== false) persistUIPreferencesSoon();
}

function syncThemeButtons(theme) {
    document.querySelectorAll('.sp-theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.themeValue === theme);
    });
}

function openSettingsPanel() {

    const overlay = document.getElementById('settingsPanelOverlay');

    if (overlay) {

        overlay.classList.add('active');

        overlay.setAttribute('aria-hidden', 'false');

        // Sync current state

        const currentTheme = localStorage.getItem('theme') || 'light';

        syncThemeButtons(currentTheme);

        const currentHue = localStorage.getItem('accent-hue') || '174';

        syncAccentDots(currentHue);

    }

}

function closeSettingsPanel() {
    const overlay = document.getElementById('settingsPanelOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }
}

function setupThemeLangHandlers() {
    // Settings panel open/close
    if (dom.prefsToggleBtn) {
        dom.prefsToggleBtn.addEventListener('click', () => openSettingsPanel());
    }

    const settingsPanelClose = document.getElementById('settingsPanelClose');
    if (settingsPanelClose) {
        settingsPanelClose.addEventListener('click', () => closeSettingsPanel());
    }

    const settingsPanelOverlay = document.getElementById('settingsPanelOverlay');
    if (settingsPanelOverlay) {
        settingsPanelOverlay.addEventListener('click', (e) => {
            if (e.target === settingsPanelOverlay) closeSettingsPanel();
        });
    }

    // Theme toggle group
    document.querySelectorAll('.sp-theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.themeValue;
            applyTheme(theme);
        });
    });

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (localStorage.getItem('theme') === 'system') {
            applyTheme('system');
        }
    });

    // Accent color dots

    document.querySelectorAll('.sp-accent-dot').forEach(dot => {

        dot.addEventListener('click', () => {

            const hue = Number(dot.dataset.accentHue);

            applyAccentHue(hue);

            const accentInput = document.getElementById('accentCustomInput');
            if (accentInput) accentInput.value = '';

        });

    });

    // Custom accent hue input
    const accentInput = document.getElementById('accentCustomInput');
    if (accentInput) {
        const applyCustomAccent = () => {
            let hue = parseInt(accentInput.value, 10);
            if (isNaN(hue)) return;
            hue = Math.max(0, Math.min(360, hue));
            accentInput.value = String(hue);
            applyAccentHue(hue);
        };
        accentInput.addEventListener('change', applyCustomAccent);
        accentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCustomAccent();
            }
        });
    }

    // Sync current accent dot state on panel open

    const origOpen = openSettingsPanel;

    // (accent dot sync happens in openSettingsPanel via syncAccentDots)



    // Language select inside settings panel

    if (dom.prefLangSelect) {

        dom.prefLangSelect.value = currentLang;

        dom.prefLangSelect.addEventListener('change', (e) => {

            currentLang = e.target.value;

            localStorage.setItem('lang', currentLang);

            updateLanguageDOM();

            loadStatus();
            persistUIPreferencesSoon();

        });

    }

}



// Re-populate model selects when language changes (labels stay same but i18n updates)

function refreshModelSelects() {

    populateModelSelects();

}

// ── 12g: Dashboard actions ──

function setupDashboardHandlers() {

    // Dashboard is informational only; client activation lives on the Quick Connect page.

}

function setupRawJsonHandlers() {
    const btnEditJson = document.getElementById('btn-edit-json');
    const rawJsonModalOverlay = document.getElementById('rawJsonModalOverlay');
    const rawJsonTextarea = document.getElementById('rawJsonTextarea');
    const rawJsonError = document.getElementById('rawJsonError');
    const rawJsonModalClose = document.getElementById('rawJsonModalClose');
    const rawJsonCancelBtn = document.getElementById('rawJsonCancelBtn');
    const rawJsonSaveBtn = document.getElementById('rawJsonSaveBtn');

    if (!btnEditJson || !rawJsonModalOverlay || !rawJsonTextarea || !rawJsonError) return;

    const setRawJsonError = (message) => {
        rawJsonError.textContent = message;
        rawJsonError.hidden = !message;
    };
    const closeRawJsonModal = () => {
        hideModal(rawJsonModalOverlay);
        if (activeRawJsonClose === closeRawJsonModal) activeRawJsonClose = null;
    };

    btnEditJson.addEventListener('click', async () => {
        setRawJsonError('');
        rawJsonTextarea.value = t('raw_json_loading');
        showModal(rawJsonModalOverlay);
        activeRawJsonClose = closeRawJsonModal;
        try {
            const resp = await apiFetch('/ocgt/api/config/raw');
            if (!resp.ok) throw new Error(await resp.text());
            const data = await resp.json();
            rawJsonTextarea.value = JSON.stringify(data, null, 2);
        } catch (err) {
            setRawJsonError(t('raw_json_load_failed') + err.message);
        }
    });

    if (rawJsonModalClose) rawJsonModalClose.addEventListener('click', closeRawJsonModal);
    if (rawJsonCancelBtn) rawJsonCancelBtn.addEventListener('click', closeRawJsonModal);
    rawJsonModalOverlay.addEventListener('click', (e) => {
        if (e.target === rawJsonModalOverlay) closeRawJsonModal();
    });

    if (rawJsonSaveBtn) {
        rawJsonSaveBtn.addEventListener('click', async () => {
            setRawJsonError('');
            try {
                const parsed = JSON.parse(rawJsonTextarea.value);
                const resp = await apiFetch('/ocgt/api/config/raw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                });
                if (!resp.ok) throw new Error(await resp.text());
                closeRawJsonModal();
                toast(t('raw_json_saved'), 'success');
                await loadStatus();
                refreshIntegrationsSoon();
            } catch (err) {
                setRawJsonError(t('raw_json_save_failed') + err.message);
            }
        });
    }
}

// ── 12h: Modals ──
function setupModalHandlers() {
    setupRawJsonHandlers();

    if (dom.btnAboutApp) {
        dom.btnAboutApp.addEventListener('click', () => {
            const app = getWailsApp();
            if (app && typeof app.ShowAboutDialog === 'function') {
                app.ShowAboutDialog();
            } else {
                showModal(dom.aboutDialogOverlay);
            }
        });
    }

    if (dom.closeDialogExit) dom.closeDialogExit.addEventListener('click', async () => {
        hideModal(dom.closeDialogOverlay);
        try { await callWails('QuitApp'); } catch (e) { console.error('QuitApp error:', e); }
    });
    if (dom.closeDialogMinimize) dom.closeDialogMinimize.addEventListener('click', async () => {
        hideModal(dom.closeDialogOverlay);
        try { await callWails('HideToTray'); } catch (e) { console.error('HideToTray error:', e); }
    });
    if (dom.closeDialogCancel) dom.closeDialogCancel.addEventListener('click', () => hideModal(dom.closeDialogOverlay));
    if (dom.aboutDialogClose) dom.aboutDialogClose.addEventListener('click', () => hideModal(dom.aboutDialogOverlay));

    // Click outside modal to close
    [dom.closeDialogOverlay, dom.aboutDialogOverlay].forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal(overlay); });
    });
}

// ── 12i: Wails runtime events ──
function setupWailsEvents() {

    if (!(window.runtime && typeof window.runtime.EventsOn === 'function')) return;

    window.runtime.EventsOn('nav-to-settings', () => {

        const settingsNavBtn = document.getElementById('btn-nav-settings');

        if (settingsNavBtn) settingsNavBtn.click();

    });

    window.runtime.EventsOn('show-close-dialog', () => showModal(dom.closeDialogOverlay));

    window.runtime.EventsOn('show-about-dialog', () => showModal(dom.aboutDialogOverlay));

    // Proxy lifecycle events from Go backend

    window.runtime.EventsOn('proxy-restarted', (addr) => {

        API_BASE = `http://${addr}`;
        if (window.setTrafficApiBase) window.setTrafficApiBase(API_BASE);

        proxyReady = false;

        _consecutiveFailures = 0;

        initializeApp();

    });

	    window.runtime.EventsOn('proxy-error', (errMsg) => {

	        console.error('[ocgt] proxy error:', errMsg);

	        proxyReady = false;

	        setProxyConnectionState('offline', errMsg);

	        // If loading overlay is still showing, show error immediately
	        const overlay = dom.loadingOverlay || document.getElementById('loadingOverlay');
	        if (overlay && !overlay.classList.contains('hidden')) {
	            showLoadingOverlay(false, true, errMsg);
	        }

	    });

}

/** Master event handler setup — delegates to focused sub-functions */

function setupEventHandlers() {

    setupNavigation();

    setupSettingsHandlers();

    setupTerminalHandlers();

    setupEnvRepairHandlers();

    setupHistoryHandlers();

    setupThemeLangHandlers();

    setupDashboardHandlers();

    setupModalHandlers();

    setupWailsEvents();

    // Retry connection button
    if (dom.loadingRetryBtn) {
        dom.loadingRetryBtn.addEventListener('click', () => {
            dom.loadingRetryBtn.disabled = true;
            showLoadingOverlay(true, false);
            initializeApp();
        });
    }
}



function setupEnvRepairHandlers() {

    // Env repair UI is handled through integration buttons

}
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════

// Quota fetching and rendering
async function fetchAndRenderQuota() {
    const bars = document.getElementById('quota-bars');
    const time = document.getElementById('quota-refresh-time');
    const label = document.getElementById('quota-label');
    if (!bars) return;

    try {
        const result = await window['go']['main']['App']['FetchQuota']();
        if (!result.success) {
            bars.innerHTML = `<span class="quota-error">${result.error || '未知错误'}</span>`;
            if (time) time.textContent = '';
            return;
        }
        const d = result.data;
        if (!d) {
            bars.innerHTML = '<span class="quota-loading">无数据</span>';
            return;
        }
        let html = '';
        html += buildQuotaRow('Rolling', 'rolling', d.rolling.usage_percent, d.rolling.reset_display);
        html += buildQuotaRow('Weekly', 'weekly', d.weekly.usage_percent, d.weekly.reset_display);
        if (d.monthly) {
            html += buildQuotaRow('Monthly', 'monthly', d.monthly.usage_percent, d.monthly.reset_display);
        } else {
            html += `<div class="quota-row"><span class="quota-row-label" style="color:#4ECDC4">Monthly</span><span style="color:var(--text-muted, #8b949e);font-size:13px">Unlimited</span></div>`;
        }
        bars.innerHTML = html;
        if (time) {
            const t = new Date(d.fetched_at);
            time.textContent = t.toLocaleTimeString();
        }
        if (label) label.textContent = 'OpenCode Go 套餐额度';
    } catch (e) {
        bars.innerHTML = `<span class="quota-error">获取额度失败: ${e}</span>`;
        if (time) time.textContent = '';
    }
}

function buildQuotaRow(name, cls, pct, reset) {
    const colors = { rolling: '#FF6B6B', weekly: '#FFE66D', monthly: '#4ECDC4' };
    const c = colors[cls] || '#888';
    return `<div class="quota-row">
        <span class="quota-row-label" style="color:${c}">${name}</span>
        <div class="quota-row-bar"><div class="quota-row-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="quota-row-pct">${pct}%</span>
        <span class="quota-row-reset">${reset}</span>
    </div>`;
}

document.addEventListener('DOMContentLoaded', () => {

    cacheDom();

    initAccentColor();

    populateModelSelects();



    // Stamp version from single source of truth

    if (dom.appVersion) dom.appVersion.textContent = APP_VERSION;

    if (dom.aboutVersion) dom.aboutVersion.textContent = APP_VERSION;

    if (dom.footerText) dom.footerText.textContent = t('footer_text');



    setupEventHandlers();

    updateLanguageDOM();

    initializeApp();

    // Polling: refresh history when online, otherwise try to reconnect
    const pollInterval = setInterval(async () => {
        if (proxyReady) { /* handled by traffic.js */ }
        else { await initializeApp(); }
    }, 5000);

    // Quota: auto-fetch on startup and every 60s, plus manual refresh button
    let quotaInterval = null;
    async function initQuotaPolling() {
        if (typeof window['go'] !== 'undefined' && window['go']['main'] && window['go']['main']['App']['FetchQuota']) {
            await fetchAndRenderQuota();
            quotaInterval = setInterval(fetchAndRenderQuota, 5000);
        }
    }
    setTimeout(initQuotaPolling, 3000);

    const quotaBtn = document.getElementById('btn-refresh-quota');
    if (quotaBtn) quotaBtn.addEventListener('click', fetchAndRenderQuota);

    // Clean up interval on page unload
    window.addEventListener('beforeunload', () => {
        clearInterval(pollInterval);
        if (quotaInterval) clearInterval(quotaInterval);
    });
});
