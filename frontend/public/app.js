const APP_VERSION = 'v2.2.1';
const DEFAULT_CLOSE_BEHAVIOR = 'prompt';
const CLOSE_BEHAVIORS = new Set(['prompt', 'minimize', 'exit']);
const ALLOWED_THINKING_BUDGETS = ['256', '512', '1024', '2048', '-1'];
const THEME_VALUES = new Set(['light', 'dark', 'system']);
const LANGUAGE_VALUES = new Set(['zh', 'en']);
const VIEW_VALUES = new Set(['dashboard', 'settings', 'terminal', 'history', 'traffic-detail', 'hub', 'sessions']);
const COMPACT_SHELL_VALUES = new Set(['powershell', 'cmd', 'bash']);
const INTEGRATION_IDS = ['quick', 'cli', 'vscode', 'claude-desktop', 'codex'];



// 鈹€鈹€ Model Registry (single source of truth) 鈹€鈹€

// Built-in base models 鈥?provide labels and recommended flags for well-known models.
// All <select> dropdowns update automatically from MODEL_REGISTRY.

const BUILTIN_MODELS = [
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

const BUILTIN_MODEL_MAP = Object.fromEntries(BUILTIN_MODELS.map(m => [m.id, m]));

let MODEL_REGISTRY = [...BUILTIN_MODELS];

try {
    const saved = localStorage.getItem('model_registry');
    if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const savedMap = Object.fromEntries(parsed.map(m => [m.id, m]));
            // Merge: use saved data but ensure new builtins are included
            MODEL_REGISTRY = BUILTIN_MODELS.map(m => savedMap[m.id] || m);
            // Append any saved models not in builtins
            for (const m of parsed) {
                if (!BUILTIN_MODEL_MAP[m.id]) {
                    MODEL_REGISTRY.push(m);
                }
            }
        }
    }
} catch (e) {
    console.error('Failed to load model registry from local storage', e);
}


// Default recommended model per mapping slot (overridden by config if set)

const MAPPING_DEFAULTS = {

    sonnet: 'qwen3.6-plus',

    haiku: 'deepseek-v4-flash',

    opus: 'kimi-k2.6',

};



// 鈹€鈹€ Accent color presets 鈹€鈹€

const ACCENT_PRESETS = [

    { hue: 174, name: 'Teal' },

    { hue: 212, name: 'Blue' },

    { hue: 260, name: 'Purple' },

    { hue: 25, name: 'Orange' },

    { hue: 330, name: 'Pink' },

];



let API_BASE = 'http://127.0.0.1:8787';
let systemStatus = null;
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 搂2 鈥?i18n Dictionary
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

const i18n = {
    zh: {
        nav_dashboard: "绯荤粺鐘舵€?,
        nav_settings: "閰嶇疆绠＄悊",
        nav_terminal: "蹇€熻繛鎺?,
        nav_history: "娴侀噺鐩戞帶",
        status_running: "浠ｇ悊杩愯涓?,
        status_connecting: "浠ｇ悊杩炴帴涓?,
        status_online: "浠ｇ悊宸茶繛鎺?,
        status_offline: "浠ｇ悊鏈繛鎺?,
        status_api_key_configured: "宸查厤缃?,
        status_api_key_not_configured: "鏈厤缃?,
        status_model_unset: "鏈瀹?,
        status_not_configured: "鏈厤缃?,
        status_saving: "淇濆瓨涓?..",
        status_success: "宸蹭繚瀛?鉁?,
        service_normal: "鏈嶅姟姝ｅ父",
        service_connecting: "鏈嶅姟杩炴帴涓?,
        service_offline: "鏈嶅姟绂荤嚎",
        title_dashboard: "绯荤粺鐘舵€佺洃鎺?,
        subtitle_dashboard: "鏌ョ湅褰撳墠浠ｇ悊鏈嶅姟杩愯鎸囨爣涓庡悗鍙扮姸鎬?,
        title_settings: "涓€閿厤缃鐞嗕腑蹇?,
        subtitle_settings: "蹇€熻缃偍鐨?API 瀵嗛挜涓庨珮闃?Claude 妯″瀷浠ｇ悊鏄犲皠",
        title_terminal: "蹇€熻繛鎺?,

        subtitle_terminal: "涓€閿皢浠ｇ悊鎺ュ叆缁堢銆佺紪杈戝櫒涓?Claude 瀹㈡埛绔?,
        hint_desktop_config_short: "涓€閿皢 ocgt 浠ｇ悊閰嶇疆鍐欏叆 Claude Code settings.json",
        title_history: "娴侀噺闆疯揪鐩戞帶",
        subtitle_history: "瀹炴椂鎹曡幏骞堕€氳繃浠〃鐩樼粺璁℃潵鑷?Claude Code 鐨?API 璇锋眰鏃ュ織",
        lbl_listen: "鐩戝惉鍦板潃",
        lbl_upstream: "涓婃父 API 鑺傜偣",
        lbl_timeout: "璇锋眰瓒呮椂",
        lbl_api_key: "API Key 鐘舵€?,
        lbl_profile: "褰撳墠娲昏穬 Profile",
        lbl_model: "榛樿瑙ｆ瀽妯″瀷",
        dash_integrations: "瀹㈡埛绔泦鎴愮姸鎬?,
        dash_cli: "CLI",
        dash_vscode: "VS Code",
        dash_claude_desktop: "Claude Desktop",
        lbl_config_path: "鏈湴閰嶇疆鏂囦欢璺緞",
        lbl_desktop_config: "Claude Code settings 閰嶇疆",
        lbl_last_updated: "鍒氬垰鏇存柊",
        btn_open_folder: "鎵撳紑鎵€鍦ㄦ枃浠跺す",
        sett_title: "涓€閿厤缃鐞嗕腑蹇?,
        sett_section_api: "API 浠ｇ悊閰嶇疆",
        sett_section_api_desc: "Profile銆丄PI Key銆侀粯璁ゆā鍨嬩笌瓒呮椂",
        sett_section_network: "缃戠粶涓庨檺娴?,
        sett_section_network_desc: "涓婃父 API 鍦板潃銆佺洃鍚鍙ｄ笌璇锋眰闄愬埗",
        sett_section_model: "妯″瀷绛栫暐璁剧疆",
        sett_section_model_desc: "鎬濊€冨己搴︿笌 Claude 妯″瀷鍒悕鏄犲皠",
        sett_section_prefs: "鍋忓ソ璁剧疆",
        sett_profile: "褰撳墠閰嶇疆 Profile",
        sett_default_model: "鍏ㄥ眬榛樿妯″瀷",
        sett_api_key: "浠ｇ悊 API 瀵嗛挜",
        placeholder_api_key: "璇疯緭鍏ユ偍鐨?sk-... 瀵嗛挜",
        sett_upstream: "涓婃父 API 鍦板潃",
        sett_timeout: "璇锋眰瓒呮椂锛堢锛?-3600锛?,
        sett_rate_minute: "姣忓垎閽熻姹備笂闄?,
        sett_thinking: "鎬濊€冨己搴︼紙鏀寔妯″瀷鐢熸晥锛?,
        opt_thinking_256: "浣?,
        opt_thinking_512: "涓?,
        opt_thinking_1024: "楂?,
        opt_thinking_2048: "鏋侀珮",
        opt_thinking_off: "鍏?,
        sett_mapping_title: "Claude 妯″瀷鏄犲皠",

        sett_mapping_sonnet: "Sonnet",

        sett_mapping_haiku: "Haiku",

        sett_mapping_opus: "Opus",
        sett_advanced_title: "楂樼骇浠ｇ悊鍙傛暟",
        sett_rate_limit: "姣忕璇锋眰涓婇檺",
        sett_rate_burst: "绐佸彂璇锋眰瀹归噺",
        sett_claude_env_template: "Claude Code 鐜鍙橀噺妯℃澘",
        sett_advanced_summary: "鐩戝惉銆侀檺娴併€佺幆澧冨彉閲忎笌 JSON",
        sett_log_title: "鏃ュ織瀛樺偍",
        sett_log_desc: "鏃ュ織淇濆瓨璺緞涓庝繚鐣欏懆鏈?,
        sett_env_title: "楂樼骇鐜鍙橀噺",
        sett_env_desc: "Claude Code 鐜鍙傛暟寮€鍏充笌鑷畾涔?JSON 閰嶇疆",
        env_disable_nonessential: "绂佺敤闈炲繀瑕佹祦閲?,
        env_enable_tool_search: "Tool Search",
        env_disable_attribution: "绂佺敤 Attribution",
        env_disable_thinking: "绂佺敤 Thinking",
        env_max_output_tokens: "Max Output Tokens",
        env_max_mcp_tokens: "Max MCP Tokens",
        env_api_timeout: "API Timeout (ms)",
        env_mcp_timeout: "MCP Timeout (ms)",
        btn_edit_settings_json: "缂栬緫 settings.json",
        btn_sync_models: "鍚屾涓婃父妯″瀷",
        opt_custom: "鑷畾涔夋ā鍨?..",
        btn_save_config: "淇濆瓨閰嶇疆",
        btn_repair_env: "涓€閿慨澶?Claude Code 绯荤粺鐜鍙橀噺",
        btn_reset_defaults: "閲嶇疆涓洪粯璁ゅ€?,
        btn_about_app: "鍏充簬 ocgt",
        btn_clear_history: "娓呴櫎鍘嗗彶璁板綍",
        hint_save: "淇濆瓨鍙洿鏂颁唬鐞嗛厤缃拰褰撳墠宸查厤缃殑鐩爣锛涙湭閰嶇疆鐨?CLI銆乂S Code 鎴?Claude Desktop 涓嶄細琚啓鍏ャ€?,
        hint_tip: "馃挕 鎻愮ず锛氬彧闇€鍦ㄢ€滃鎴风闆嗘垚鈥濅腑涓€閿縺娲绘垨閰嶇疆鎮ㄧ殑缁堢锛屾柊寤虹獥鍙ｅ嵆鍙紑绠卞嵆鐢紝鏃犻渶鍦ㄦ鍋氶噸澶嶄慨鏀广€?,
        hint_changes_detected: "妫€娴嬪埌鏈繚瀛樼殑鏇存敼",
        btn_cancel_changes: "鍙栨秷鏇存敼",
        sync_profile: "Profile",
        sync_listen: "鐩戝惉",
        sync_cli: "CLI",
        sync_vscode: "VS Code",
        sync_claude: "Claude Desktop",
        sync_active: "宸查厤缃?,
        token_log_on: "鏃ュ織寮€鍚?,
        token_log_off: "鏃ュ織鍏抽棴",
        term_title: "涓€閿敜閱掍唬鐞嗘帶鍒跺彴",
        term_shell_type: "鐩爣鍛戒护琛岀被鍨?,
        btn_launch_term: "涓€閿媺璧烽厤缃粓绔?(Launch)",
        btn_persistent_env: "淇浠ュ悗鎵€鏈夋柊缁堢鐜鍙橀噺",

        btn_setup_desktop: "閰嶇疆 Claude Code settings",

        status_configuring: "閰嶇疆涓?..",
        btn_setup_desktop_configured: "鉁?宸查厤缃?| 閲嶆柊閰嶇疆",
        btn_clear_desktop_config: "娓呴櫎閰嶇疆",
        status_clearing: "娓呴櫎涓?..",

        toast_desktop_setup_fail: "閰嶇疆澶辫触",

        hint_launch: "涓€閿敞鍏ュ綋鍓?Profile 浠ｇ悊鍙橀噺骞舵墦寮€鍘熺敓 shell銆傜洿鎺ユ墦 <code>claude</code> 鍗冲彲寮€濮嬭繍琛岋紒",
        guide_title: "馃挕 蹇嵎杩愯鏋佺畝鎸囧崡",
        guide_1: "鍦ㄤ笂鏂归€夐」鍗￠€夋嫨鎮ㄥ父鐢ㄧ殑鍛戒护缁堢銆?,
        guide_2: "鐐瑰嚮 <b>\"涓€閿媺璧烽厤缃粓绔痋"</b>锛岀郴缁熶細鑷姩鍞ら啋鎺у埗鍙般€?,
        guide_3: "鐩存帴鍦ㄦ媺璧风殑绐楀彛涓敭鍏?<code>claude</code> 鍗冲彲鍚姩 AI 浠ｇ爜瀵硅瘽銆?,
        guide_4: "锛堝彲閫夛級鑻ヨ鍦ㄥ凡鏈夌粓绔腑宸ヤ綔锛屽彲鐐瑰嚮鍙充晶鐨勫鍒舵寜閽鍏ラ厤缃€?,
        guide_5: "<b>鎻愮ず</b>锛氱粓绔被鍨嬪彧闇€閫夋嫨骞朵竴閿惎鍔ㄤ换鎰忎竴涓嵆鍙紝鏃犻渶鍏ㄩ儴閰嶇疆鎴栧惎鍔ㄣ€?,
        code_env_title: "Claude Code 鐜鍙橀噺",
        code_ccswitch_title: "CC Switch 鎻愪緵鍟嗛厤缃?,
        btn_copy: "澶嶅埗",
        btn_copied: "宸插鍒?鉁?,
        traf_total: "鎬诲悶鍚愯姹傞噺",

        traf_rate: "璇锋眰鎴愬姛鐜?,

        traf_latency: "骞冲潎鍝嶅簲寤舵椂",

        traf_tokens: "Token 娑堣€?,

        traf_limit: "璇锋眰闄愬埗",

        traf_token_detail: "Token 娑堣€楁槑缁?,

        traf_input_output: "input + output",

        traf_rpm_hint: "RPM / 閰嶉",
        traf_filter_source: "鏉ユ簮",
        traf_filter_all: "鍏ㄩ儴鏉ユ簮",
        traf_filter_cli: "CLI",
        traf_filter_vscode: "VS Code",
        traf_filter_desktop: "Claude Desktop",
        traf_filter_count: "鏄剧ず {{shown}} / {{total}} 鏉?,

        th_tokens: "Tokens",
        th_client: "鏉ユ簮",
        client_unknown: "鏈煡",

        th_time: "鏃堕棿",
        th_method: "鏂规硶",
        th_path: "璺敱璺緞",
        th_model: "瑙ｆ瀽妯″瀷",
        th_status: "鐘舵€佺爜",
        th_duration: "鑰楁椂",
        th_error: "閿欒鍘熷洜",
        traf_empty: "鏆傛棤娴侀噺璁板綍銆傝浣跨敤涓€閿粓绔垨鍦ㄥ叾浠?Shell 涓悜浠ｇ悊鍙戦€佽姹?..",
        traf_empty_filtered: "褰撳墠鏉ユ簮绛涢€変笅娌℃湁娴侀噺璁板綍銆傚垏鎹负鈥滃叏閮ㄦ潵婧愨€濆彲鏌ョ湅鍏朵粬璇锋眰銆?,
        traf_listening: "瀹炴椂娴侀噺闆疯揪鎸佺画鐩戝惉涓?,
        opt_model_kimi_26: "kimi-k2.6",

        opt_model_qwen_36: "qwen3.6-plus",

        opt_model_deepseek_pro: "deepseek-v4-pro",

        opt_model_deepseek_flash: "deepseek-v4-flash",

        opt_model_glm_51: "glm-5.1",

        opt_model_hy3_preview: "hy3-preview",

        opt_mapping_sonnet_default: "qwen3.6-plus (recommended)",

        opt_mapping_haiku_default: "deepseek-v4-flash (recommended)",

        opt_mapping_opus_default: "kimi-k2.6 (recommended)",
        sett_close_behavior: "鍏抽棴绐楀彛琛屼负",
        opt_close_prompt: "姣忔璇㈤棶",
        opt_close_minimize: "闅愯棌鍒版墭鐩橈紝浠ｇ悊缁х画杩愯",
        opt_close_exit: "閫€鍑虹▼搴忥紝鍋滄浠ｇ悊",
        close_dialog_title: "鍏抽棴绐楀彛",
        close_dialog_msg: "闅愯棌鍒版墭鐩樹細缁х画浠ｇ悊璇锋眰锛涢€€鍑虹▼搴忎細鍋滄鏈湴浠ｇ悊銆?,
        close_dialog_exit: "閫€鍑哄苟鍋滄浠ｇ悊",
        close_dialog_minimize: "闅愯棌鍒版墭鐩樺苟缁х画浠ｇ悊",
        close_dialog_cancel: "鍙栨秷",
        about_desc: "涓撲负 Claude Code 涓?OpenCode Go 鎵撻€犵殑鏋佺畝妗岄潰鎺у埗闈㈡澘涓庝唬鐞?,
        about_author: "浣滆€?,
        about_license: "璁稿彲璇?,
        about_project: "椤圭洰鍦板潃",
        about_close: "鍏抽棴",
        err_api_key_required: "璇疯緭鍏?API Key",
        err_upstream_url: "璇疯緭鍏ユ湁鏁堢殑 http(s) 鍦板潃",
        err_listen_addr: "璇疯緭鍏ユ湁鏁堢殑鐩戝惉鍦板潃锛屼緥濡?127.0.0.1:8787 鎴?:8787",
        err_timeout_range: "瓒呮椂蹇呴』鍦?1-3600 绉掍箣闂?,
        err_rate_limit_range: "鑼冨洿蹇呴』鍦?1-10000 涔嬮棿",
        err_rate_burst_range: "鑼冨洿蹇呴』鍦?1-100000 涔嬮棿",
        err_rate_minute_range: "鑼冨洿蹇呴』鍦?0-100000 涔嬮棿锛? 琛ㄧず涓嶉檺閲?,
        err_claude_env_json: "蹇呴』鏄?JSON 瀵硅薄锛岄敭鍜屽€奸兘蹇呴』鏄瓧绗︿覆",
        toast_saved: "閰嶇疆宸蹭繚瀛橈紱宸查厤缃洰鏍囧凡鍚屾鍒锋柊",
        toast_save_failed: "淇濆瓨澶辫触",
        toast_env_repaired: "鐜鍙橀噺宸蹭慨澶嶅苟鍐欏叆绯荤粺",
        toast_env_repair_failed: "鐜鍙橀噺淇澶辫触",
        toast_copy_success: "宸插鍒跺埌鍓创鏉?,
        toast_copy_failed: "澶嶅埗澶辫触",
        toast_profile_changed: "Profile 宸插垏鎹?,
        toast_launch_failed: "缁堢鍚姩澶辫触",
        toast_launch_success: "缁堢宸叉垚鍔熷惎鍔?,

        toast_desktop_setup_success: "鉁?Claude Code settings 宸查厤缃€傞噸鏂版墦寮€ Claude Code 鍚庣敓鏁堛€傞獙璇佹柟寮忥細鍙戦€佷竴鏉℃秷鎭紝瑙傚療 ocgt 鏃ュ織涓殑璇锋眰璁板綍銆?,
        toast_desktop_verify_hint: "楠岃瘉鏂瑰紡锛氬惎鍔ㄦ闈㈢増鍚庡彂閫佷竴鏉℃秷鎭紝瑙傚療 ocgt 鏃ュ織涓殑璇锋眰璁板綍銆?,
        toast_desktop_cleared: "Claude Code settings 閰嶇疆宸叉竻闄?,

        toast_history_cleared: "鍘嗗彶璁板綍宸叉竻闄?,
        toast_validation_error: "璇锋鏌ヨ〃鍗曚腑鐨勯敊璇?,
        toast_custom_model_prompt: "璇疯緭鍏ヨ嚜瀹氫箟妯″瀷鍚嶇О",
        custom_model_title: "娣诲姞鑷畾涔夋ā鍨?,
        custom_model_desc: "杈撳叆涓婃父鏀寔鐨勬ā鍨?ID锛屼繚瀛樺悗浼氬啓鍏ュ綋鍓?Profile銆?,
        custom_model_label: "妯″瀷鍚嶇О",
        custom_model_placeholder: "渚嬪 qwen3.6-plus 鎴?vendor/model-name",
        custom_model_cancel: "鍙栨秷",
        custom_model_confirm: "浣跨敤姝ゆā鍨?,
        custom_model_required: "妯″瀷鍚嶇О涓嶈兘涓虹┖",
        custom_model_too_long: "妯″瀷鍚嶇О涓嶈兘瓒呰繃 128 涓瓧绗?,
        toast_reset_confirm: "纭畾瑕侀噸缃墍鏈夎缃负榛樿鍊煎悧锛?,
        toast_reset_done: "璁剧疆宸查噸缃负榛樿鍊?,
        toast_confirm: "纭閲嶇疆",
        // Terminal launch states
        term_launching: "鍚姩涓?..",
        term_launched: "宸插惎鍔ㄧ粓绔?鉁?,
        // Desktop-only warnings
        warn_desktop_only_launch: "涓€閿惎鍔ㄧ粓绔粎鍦ㄦ闈㈢増 app 瀹㈡埛绔彲鐢紝璇峰湪妗岄潰绔腑鐐瑰嚮浣跨敤锛?,
        warn_desktop_only_env: "Claude Code settings 閰嶇疆鎺ュ彛鏈垵濮嬪寲锛岃灏濊瘯閲嶅惎 ocgt",
        warn_desktop_only_folder: "璇ュ姛鑳戒粎鍦ㄦ闈㈠鎴风鍙敤銆傛偍鐨勯厤缃枃浠跺す閫氬父鍦ㄦ偍鐨勪釜浜虹敤鎴风洰褰曚笅鐨?.ocgt 鏂囦欢澶逛腑銆?,
        // Env repair states
        env_repairing: "淇涓?..",
        env_repaired_hint: "宸蹭慨澶嶏紝閲嶆柊鎵撳紑缁堢鐢熸晥",
        // Connection status with unconfigured key
        status_connected_no_key: "浠ｇ悊宸茶繛鎺ワ紝瀵嗛挜鏈厤缃?,
        // Open folder errors
        err_open_folder: "鎵撳紑澶辫触",
        err_open_folder_generic: "鏃犳硶鎵撳紑鏂囦欢澶?,
        // Footer
        footer_text: "ocgt \u00A9 2026 \u00B7 MIT Licensed \u00B7 Official OpenCode Go Companion Center",
        // Preferences popover
        pref_title: "鍋忓ソ璁剧疆",
        pref_language: "鐣岄潰璇█",
        pref_appearance: "澶栬",
        pref_appearance_desc: "涓婚妯″紡涓庣晫闈㈣瑷€",
        pref_theme: "涓婚妯″紡",
        pref_theme_light: "娴呰壊",
        pref_theme_dark: "娣辫壊",
        pref_theme_system: "璺熼殢绯荤粺",

        pref_accent_color: "涓婚鑹?,

        pref_network: "缃戠粶",

        pref_network_desc: "浠ｇ悊鐩戝惉鍦板潃涓庣鍙?,

        pref_listen_addr: "鐩戝惉鍦板潃",

        btn_apply_restart: "搴旂敤骞堕噸鍚?,

        pref_behavior: "琛屼负",

        pref_behavior_desc: "鍏抽棴绐楀彛涓庣郴缁熶氦浜?,
        pref_logs: "鏃ュ織",
        pref_logs_desc: "鏃ュ織淇濆瓨璺緞涓庝繚鐣欏懆鏈?,
        pref_log_save: "GUI 鏃ュ織淇濆瓨",
        pref_log_dir: "鏃ュ織鐩綍",
        pref_log_retention: "淇濈暀澶╂暟",
        btn_open_log_dir: "鎵撳紑",
        btn_save_log_prefs: "淇濆瓨鏃ュ織璁剧疆",
        toast_log_prefs_saved: "鏃ュ織璁剧疆宸蹭繚瀛?,
        toast_log_prefs_failed: "鏃ュ織璁剧疆淇濆瓨澶辫触",
        raw_json_title: "缂栬緫 Claude Code settings.json",
        raw_json_desc: "楂樼骇鍏ュ彛锛氬彧淇敼 ~/.claude/settings.json銆備繚瀛樺墠璇风‘璁?JSON 鏍煎紡鏈夋晥銆?,
        raw_json_cancel: "鍙栨秷",
        raw_json_save: "淇濆瓨 settings.json",
        raw_json_loading: "鍔犺浇涓?..",
        raw_json_load_failed: "鍔犺浇 settings.json 澶辫触: ",
        raw_json_save_failed: "瑙ｆ瀽鎴栦繚瀛?settings.json 澶辫触: ",
        raw_json_saved: "Claude Code settings.json 宸蹭繚瀛?,
        pref_danger: "閲嶇疆涓庡叧浜?,
        pref_danger_desc: "鎭㈠榛樿璁剧疆鎴栨煡鐪嬬増鏈俊鎭?,
        badge_not_configured: "鏈厤缃?,
        badge_active: "宸查厤缃?鉁?,
        badge_inactive: "鏈厤缃?,
        badge_recommended: "鎺ㄨ崘",
        integration_reapply_hint: "宸查厤缃紱鍙啀娆＄偣鍑昏ˉ鍐欏綋鍓?Profile 鐨勪唬鐞嗛厤缃€?,
        int_quick_title: "蹇€熷紑濮嬶細涓存椂缁堢",
        int_quick_desc: "鍙负褰撳墠鏂板紑鐨勭粓绔獥鍙ｄ复鏃舵敞鍏ヤ唬鐞嗗彉閲忥紝涓嶅啓鍏ョ郴缁熼厤缃紱鍙互杩炵画鎵撳紑澶氫釜绐楀彛銆?,
        btn_launch_temp_term: "鎵撳紑涓存椂缁堢",
        repair_title: "涓€閿慨澶?,
        repair_desc: "淇 Claude Code settings銆佸熀纭€鐜鍙橀噺锛屽苟鍒锋柊宸查厤缃繃鐨?VS Code / Claude Desktop 闆嗘垚銆?,
        btn_repair_all: "涓€閿慨澶?,
        toast_repair_all_success: "鍩虹閰嶇疆鍜屽凡閰嶇疆闆嗘垚宸蹭慨澶?,
        toast_repair_all_failed: "涓€閿慨澶嶅け璐?,
        int_sys_title: "Claude Code CLI",
        btn_sys_install: "涓€閿縺娲?,
        btn_sys_remove: "绉婚櫎閰嶇疆",
        int_sys_desc: "灏嗕唬鐞嗗湴鍧€鑷姩鍐欏叆 ~/.claude/settings.json锛孋laude Code 鍦ㄤ换鎰忕粓绔潎鍙洿鎺ヤ娇鐢ㄤ唬鐞嗭紝绉婚櫎鏃惰嚜鍔ㄦ仮澶嶅師閰嶇疆銆?,
        toast_sys_installed: "鍏ㄥ眬 JSON 閰嶇疆宸插啓鍏ワ紒Claude Code 鐜板湪灏嗛€氳繃浠ｇ悊杩愯銆?,
        toast_sys_removed: "宸茬Щ闄や唬鐞嗛厤缃苟杩樺師銆?(濡傛灉鏈夌殑璇?",
        lbl_temp_import: "涓存椂瀵煎叆 (褰撳墠绐楀彛鐢熸晥):",
        int_vscode_title: "VS Code Claude Code 鎻掍欢",
        int_vscode_desc: "鑷姩鍚?VS Code 鐢ㄦ埛閰嶇疆娉ㄥ叆 ocgt 浠ｇ悊鍙橀噺銆傛彃浠舵垨鍏跺惎鍔ㄧ殑 Claude Code 杩涚▼浼氱户鎵胯繖浜涘彉閲忥紝鏂板缓浼氳瘽鍗冲彲璧版湰鍦颁唬鐞嗐€?,
        btn_vscode_install: "涓€閿縺娲?,

        btn_vscode_remove: "绉婚櫎閰嶇疆",
        int_vscode_tip: "娉ㄥ叆鍚庨噸鏂版墦寮€ VS Code 鍐呯殑 Claude Code 浼氳瘽鍗冲彲楠岃瘉銆?,
        int_claude_title: "Claude Code settings",
        int_claude_desc: "灏?ocgt 浠ｇ悊鍐欏叆 <code>~/.claude/settings.json</code>锛岀敤浜?Claude Code 鏈湴瀹㈡埛绔鍙栦唬鐞嗙幆澧冿紱鐪熷疄 Claude Desktop App 璇蜂娇鐢ㄤ笅鏂?3P profile銆?,
        btn_setup_desktop_full: "涓€閿縺娲?,

        btn_clear_desktop_full: "绉婚櫎閰嶇疆",
        lbl_desktop_help_title: "Claude Code settings",
        lbl_desktop_help_desc: "杩欓噷鍙啓鍏?Claude Code 璇诲彇鐨?settings.json 鐜鍧楋紝涓嶄慨鏀?Claude Desktop 鐧诲綍鐘舵€併€?,
        int_claude_desktop_title: "Claude Desktop App",
        int_claude_desktop_desc: "鎸?cc-switch 鐨?3P profile 鏂瑰紡鍐欏叆 Claude Desktop 閰嶇疆锛岄噸鍚?Claude Desktop 鍚庨€氳繃 ocgt 鏈湴璺敱杞彂銆?,
        btn_setup_claude_desktop_app: "涓€閿縺娲?,
        btn_clear_claude_desktop_app: "绉婚櫎閰嶇疆",
        toast_claude_desktop_app_setup_success: "Claude Desktop App 3P 閰嶇疆宸插啓鍏ワ紝閲嶅惎 Claude Desktop 鍚庣敓鏁堛€?,
        toast_claude_desktop_app_cleared: "Claude Desktop App 3P 閰嶇疆宸茬Щ闄ゃ€?,
        dash_codex: "Codex",
        int_codex_title: "Codex CLI",
        int_codex_desc: "灏?ocgt 浠ｇ悊鍐欏叆 <code>~/.codex/config.toml</code>锛孋odex CLI 灏嗛€氳繃 ocgt 鏈湴璺敱杞彂璇锋眰銆傞噸鍚?Codex 鍚庣敓鏁堛€?,
        btn_setup_codex: "涓€閿縺娲?,
        btn_clear_codex: "绉婚櫎閰嶇疆",
        toast_codex_setup_success: "Codex 閰嶇疆宸插啓鍏?~/.codex/config.toml锛岄噸鍚?Codex 鍚庣敓鏁堛€?,
        toast_codex_cleared: "Codex 閰嶇疆宸茬Щ闄ゃ€?,
        toast_codex_failed: "Codex 閰嶇疆澶辫触",
        toast_vscode_installed: "VS Code Claude Code 鎻掍欢閰嶇疆宸叉敞鍏ワ紒",
        toast_vscode_removed: "VS Code Claude Code 鎻掍欢閰嶇疆宸叉竻闄わ紒",
        toast_vscode_failed: "閰嶇疆 VS Code 澶辫触",
        loading_title: "姝ｅ湪杩炴帴鏈湴浠ｇ悊",
        loading_init: "姝ｅ湪鍒濆鍖栦唬鐞嗘湇鍔?..",
        loading_unavailable_title: "浠ｇ悊鏆傛椂涓嶅彲鐢?,
        loading_unavailable_desc: "鏈湴浠ｇ悊鏈搷搴斻€傝妫€鏌ョ洃鍚湴鍧€銆佺鍙ｅ崰鐢ㄦ垨閰嶇疆鍚庨噸璇曘€?,
        proxy_health_timeout: "浠ｇ悊绔彛鏈搷搴?/healthz",
        btn_retry_connection: "閲嶈瘯杩炴帴",
        token_total_label: "鎬昏: {{count}} tokens",
        nav_hub: "澶氳澶囧悓姝?,
        nav_sessions: "浼氳瘽",
        sessions_total: "鏈湴浼氳瘽",
        sessions_total_tokens: "浼氳瘽 Token 鎬昏",
        sessions_total_cost: "浼氳瘽璐圭敤浼扮畻",
        sessions_loading: "鍔犺浇涓?..",
        sessions_no_data: "鏈壘鍒?Claude Code 浼氳瘽璁板綍",
        sessions_search_placeholder: "鎼滅储浼氳瘽 ID 鎴栨ā鍨嬪悕绉?..",
        sessions_filter_all: "鍏ㄩ儴妯″瀷",
        sessions_period_today: "浠婃棩",
        sessions_period_month: "鏈湀",
        sessions_period_all: "鍏ㄩ儴",
        sessions_sort_time_desc: "鏈€鏂板湪鍓?,
        sessions_sort_time_asc: "鏈€鏃╁湪鍓?,
        sessions_sort_tokens_desc: "Token 鏈€澶?,
        sessions_sort_tokens_asc: "Token 鏈€灏?,
        sessions_sort_cost_desc: "璐圭敤鏈€楂?,
        sessions_show_content: "鍐呭",
        sd_sort_time: "鎸夋椂闂?,
        sd_sort_tokens: "鎸?Token",
        sessions_model_chart: "妯″瀷鍒嗗竷",
        title_hub: "澶氳澶囧悓姝?,
        subtitle_hub: "璺ㄨ澶?Hub 閰嶇疆鍚屾涓庣姸鎬佺洃鎺?,
        hub_disconnected: "鏈繛鎺?,
        hub_connected: "宸茶繛鎺?,
        hub_total_tokens: "澶氳澶?Token 鎬昏",
        hub_total_cost: "澶氳澶囪垂鐢ㄦ€昏",
        hub_today_tokens: "",
        hub_today_cost: "",
        hub_device_list: "鍦ㄧ嚎璁惧",
        hub_no_devices: "鏆傛棤璁惧鏁版嵁",
        hub_model_breakdown: "妯″瀷鐢ㄩ噺鍒嗗竷锛堝叏閮ㄨ澶囷級",
        hub_refresh: "鍒锋柊",
        hub_sync_now: "绔嬪嵆鍚屾",
        hub_sync_success: "鍚屾鎴愬姛",
        hub_sync_failed: "鍚屾澶辫触",
        hub_syncing: "鍚屾涓?..",
        pref_hub_title: "璺ㄨ澶囧悓姝?,
        pref_hub_desc: "灏嗕娇鐢ㄧ粺璁″悓姝ュ埌 Hub锛屽湪澶氬彴璁惧闂存煡鐪嬫眹鎬绘暟鎹?,
        pref_hub_enable: "鍚敤鍚屾",
        pref_hub_url: "Hub 鍦板潃",
        pref_hub_secret: "鍚屾瀵嗛挜",
        pref_hub_device_name: "璁惧鍚嶇О",
        pref_hub_interval: "鎺ㄩ€侀棿闅旓紙绉掞級",
        pref_hub_save: "淇濆瓨鍚屾璁剧疆",
        td_today: "浠婃棩",
        td_7d: "7鏃?,
        td_30d: "30鏃?,
        td_updated: "鏇存柊浜?,
        td_no_data: "鏆傛棤鏁版嵁",
        td_no_match: "鏆傛棤鍖归厤璁板綍",
        td_total: "鎬昏",
        td_prev: "涓婁竴椤?,
        td_next: "涓嬩竴椤?,
        td_records: "鏉?,
        td_time: "鏃堕棿",
        td_load_failed: "鍔犺浇澶辫触",
        td_clear_confirm: "纭畾娓呴櫎鎵€鏈夊巻鍙茶褰曪紵姝ゆ搷浣滀笉鍙仮澶嶃€?,
        td_proxy_offline: "鏃犳硶杩炴帴浠ｇ悊锛岃纭浠ｇ悊鏈嶅姟杩愯涓?,
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
        status_success: "Saved 鉁?,
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
        hint_tip: "馃挕 Tip: Just select and launch any terminal shell of your choice. No need to repeatedly configure all shells.",
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
        btn_setup_desktop_configured: "鉁?Configured | Reconfigure",
        btn_clear_desktop_config: "Clear Config",
        status_clearing: "Clearing...",

        toast_desktop_setup_fail: "Setup failed",

        hint_launch: "Injects proxy environment variables and spawns a native shell. Directly run <code>claude</code> to begin!",
        guide_title: "馃挕 Quick Start Guide",
        guide_1: "Select your preferred shell type in the tabs above.",
        guide_2: "Click \"Launch Pre-configured Terminal\" to summon the console.",
        guide_3: "Directly type <code>claude</code> and press Enter inside the shell to start coding!",
        guide_4: "(Optional) Copy env variables on the right if using an existing IDE terminal.",
        guide_5: "Note: You only need to choose and start one shell type, no need to configure all of them.",
        code_env_title: "Claude Code Env Variables",
        code_ccswitch_title: "CC Switch Provider Config (JSON Import)",
        btn_copy: "Copy",
        btn_copied: "Copied 鉁?,
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

        toast_desktop_setup_success: "鉁?Claude Code settings configured. Reopen Claude Code to apply. Verify: send a message and check ocgt logs for request records.",
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
        term_launched: "Terminal Launched 鉁?,
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
        badge_active: "Configured 鉁?,
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
        dash_codex: "Codex",
        int_codex_title: "Codex CLI",
        int_codex_desc: "Writes ocgt proxy into <code>~/.codex/config.toml</code>. Codex CLI will route requests through ocgt. Restart Codex to apply.",
        btn_setup_codex: "Activate",
        btn_clear_codex: "Remove Config",
        toast_codex_setup_success: "Codex config written to ~/.codex/config.toml. Restart Codex to apply.",
        toast_codex_cleared: "Codex config removed.",
        toast_codex_failed: "Codex config failed",
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
        token_total_label: "Total: {{count}} tokens",
        nav_hub: "Multi-Device",
        nav_sessions: "Sessions",
        sessions_total: "Local Sessions",
        sessions_total_tokens: "Session Total Tokens",
        sessions_total_cost: "Session Estimated Cost",
        sessions_loading: "Loading...",
        sessions_no_data: "No Claude Code session data found",
        sessions_search_placeholder: "Search session ID or model...",
        sessions_filter_all: "All Models",
        sessions_period_today: "Today",
        sessions_period_month: "Month",
        sessions_period_all: "All",
        sessions_sort_time_desc: "Newest First",
        sessions_sort_time_asc: "Oldest First",
        sessions_sort_tokens_desc: "Most Tokens",
        sessions_sort_tokens_asc: "Fewest Tokens",
        sessions_sort_cost_desc: "Highest Cost",
        sessions_show_content: "Content",
        sd_sort_time: "By Time",
        sd_sort_tokens: "By Tokens",
        sessions_model_chart: "Model Distribution",
        title_hub: "Multi-Device Sync",
        subtitle_hub: "Cross-device usage statistics aggregation",
        hub_disconnected: "Disconnected",
        hub_connected: "Connected",
        hub_total_tokens: "Multi-Device Total Tokens",
        hub_total_cost: "Multi-Device Total Cost",
        hub_today_tokens: "",
        hub_today_cost: "",
        hub_device_list: "Online Devices",
        hub_no_devices: "No device data",
        hub_model_breakdown: "Model Usage (All Devices)",
        hub_refresh: "Refresh",
        hub_sync_now: "Sync Now",
        hub_sync_success: "Sync successful",
        hub_sync_failed: "Sync failed",
        hub_syncing: "Syncing...",
        pref_hub_title: "Cross-Device Sync",
        pref_hub_desc: "Sync usage stats to Hub for cross-device aggregation",
        pref_hub_enable: "Enable Sync",
        pref_hub_url: "Hub URL",
        pref_hub_secret: "Sync Secret",
        pref_hub_device_name: "Device Name",
        pref_hub_interval: "Push Interval (sec)",
        pref_hub_save: "Save Sync Settings",
        hub_server_url: "Hub Server URL",
        btn_save_hub: "Save",
        td_today: "Today",
        td_7d: "7d",
        td_30d: "30d",
        td_updated: "Updated",
        td_no_data: "No data",
        td_no_match: "No matching records",
        td_total: "Total",
        td_prev: "Prev",
        td_next: "Next",
        td_records: "records",
        td_time: "Time",
        td_load_failed: "Load failed",
        td_clear_confirm: "Clear all history? This cannot be undone.",
        td_proxy_offline: "Proxy not responding. Please check the proxy service.",
    }
};

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 搂3 鈥?Utility Helpers
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
const escHtml = escapeHtml;

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
                const result = await window['go']['main']['App']['FetchUpstreamModels']();
                if (!result || !result.success) {
                    throw new Error(result && result.error ? result.error : 'API failed');
                }
                const data = result.data;
                if (data && data.data && Array.isArray(data.data)) {
                    // Build new registry from upstream, inheriting built-in metadata
                    const upstreamMap = new Map();
                    for (const m of data.data) {
                        const builtin = BUILTIN_MODEL_MAP[m.id];
                        upstreamMap.set(m.id, {
                            id: m.id,
                            label: (builtin && builtin.label) || m.id,
                            recommended: !!(builtin && builtin.recommended),
                            category: (builtin && builtin.category) || 'Synced'
                        });
                    }
                    // Also keep built-in models not returned by upstream
                    for (const m of BUILTIN_MODELS) {
                        if (!upstreamMap.has(m.id)) {
                            upstreamMap.set(m.id, { ...m });
                        }
                    }
                    MODEL_REGISTRY = [...upstreamMap.values()];
                    localStorage.setItem('model_registry', JSON.stringify(MODEL_REGISTRY));
                    populateModelSelects();
                    toast(`鍚屾鎴愬姛锛屽叡 ${MODEL_REGISTRY.length} 涓ā鍨媊);
                } else {
                    toast('涓婃父杩斿洖鐨勬暟鎹牸寮忓紓甯?, 'error');
                }
            } catch (err) {
                console.error(err);
                toast('鑾峰彇妯″瀷澶辫触锛? + (err && err.message ? err.message : '璇锋鏌?API Key 涓庣綉缁滆繛鎺?), 'error');
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
    dom.btnSetupCodex = document.getElementById('setup-codex-btn');
    dom.btnClearCodex = document.getElementById('clear-codex-btn');
    dom.codexBadge = document.getElementById('codex-badge');
    // Desktop client activation moved from dashboard to the Quick Connect page.

    dom.btnToggleVisibility = document.getElementById('toggle-key-visibility');
    dom.settingsForm = document.getElementById('settings-form');
    dom.configActions = document.getElementById('config-actions');
    dom.resetDefaultsBtn = document.getElementById('reset-defaults-btn');
    dom.btnAboutApp = document.getElementById('about-app-btn');
    dom.btnNavHistory = document.getElementById('btn-nav-history');
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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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

// 鈹€鈹€ Dynamic Model Select Rendering 鈹€鈹€
function populateModelSelects() {
    const i18nKey = (m) => `opt_model_${m.id.replace(/[.-]/g, '_')}`;
    document.querySelectorAll('select[data-model-source]').forEach(sel => {
        const source = sel.dataset.modelSource;
        const saved = sel.value;
        sel.innerHTML = '';

        if (source === 'default') {

            // Default model selector 鈥?flat list grouped by category

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
            // Mapping selector 鈥?show all models + custom
            const mappingTargets = MODEL_REGISTRY.slice();
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

// 鈹€鈹€ Accent Color System 鈹€鈹€
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

        setProxyConnectionState('offline', '');

        showDashboardContent();

        showLoadingOverlay(false, true, t('loading_unavailable_desc'));

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

function setSelectValue(selectEl, value) {
    if (!selectEl) return;
    if (!value) { selectEl.selectedIndex = 0; return; }
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === value) { selectEl.value = value; return; }
    }
    // Value not found 鈥?add it before the last option (custom)
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
        opt.textContent = `${value} 路 ${t('opt_custom')}`;
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
        if (dom.inputUpstream && !isElementFocused(dom.inputUpstream)) {
            dom.inputUpstream.value = systemStatus.upstream || '';
        }
        if (dom.inputRateLimit && !isElementFocused(dom.inputRateLimit)) {
            dom.inputRateLimit.value = systemStatus.rate_limit_per_second || '';
        }
        if (dom.inputRateBurst && !isElementFocused(dom.inputRateBurst)) {
            dom.inputRateBurst.value = systemStatus.rate_limit_burst || '';
        }
        if (dom.inputRateMinute && !isElementFocused(dom.inputRateMinute)) {
            dom.inputRateMinute.value = systemStatus.rate_limit_per_minute || '';
        }
        if (dom.inputClaudeEnvTemplate && !isElementFocused(dom.inputClaudeEnvTemplate)) {
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
            if (dom.inputTimeout && !isElementFocused(dom.inputTimeout)) {
                dom.inputTimeout.value = seconds.toString();
            }
            if (dom.inputListen && !isElementFocused(dom.inputListen)) {
                dom.inputListen.value = systemStatus.listen || '';
            }
            if (dom.inputUpstream && !isElementFocused(dom.inputUpstream)) {
                dom.inputUpstream.value = systemStatus.upstream || '';
            }
        }

        // Claude Env Toggles
        if (systemStatus && systemStatus.claude_env) {
            const env = systemStatus.claude_env;
            if (dom.envDisableNonEssential && !isElementFocused(dom.envDisableNonEssential)) dom.envDisableNonEssential.checked = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== "0";
            if (dom.envEnableToolSearch && !isElementFocused(dom.envEnableToolSearch)) dom.envEnableToolSearch.checked = env.ENABLE_TOOL_SEARCH !== "false";
            if (dom.envDisableAttribution && !isElementFocused(dom.envDisableAttribution)) dom.envDisableAttribution.checked = env.CLAUDE_CODE_ATTRIBUTION_HEADER === "0";
            if (dom.envDisableThinking && !isElementFocused(dom.envDisableThinking)) dom.envDisableThinking.checked = env.CLAUDE_CODE_DISABLE_THINKING === "1";
            if (dom.envMaxOutputTokens && !isElementFocused(dom.envMaxOutputTokens)) dom.envMaxOutputTokens.value = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '131072';
            if (dom.envMaxMcpTokens && !isElementFocused(dom.envMaxMcpTokens)) dom.envMaxMcpTokens.value = env.MAX_MCP_OUTPUT_TOKENS || '200000';
            if (dom.envApiTimeout && !isElementFocused(dom.envApiTimeout)) dom.envApiTimeout.value = env.API_TIMEOUT_MS || '600000';
            if (dom.envMcpTimeout && !isElementFocused(dom.envMcpTimeout)) dom.envMcpTimeout.value = env.MCP_TIMEOUT || '600000';
        }

        // Thinking budget
        if (dom.inputThinkingBudget) {
            const budget = Number(systemStatus.max_thinking_budget_tokens ?? 2048);
            if (!isElementFocused(dom.inputThinkingBudget)) {
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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

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
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

function updateLanguageDOM() {
    const lang = currentLang;
    const dict = i18n[lang];
    if (!dict) return;

    // Sync language selector
    if (dom.prefLangSelect) dom.prefLangSelect.value = lang;

    if (dom.prefsToggleBtn) {
        dom.prefsToggleBtn.setAttribute('title', lang === 'zh' ? '鍋忓ソ璁剧疆' : 'Preferences');
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
        'traffic-detail': { title: '娴侀噺鏄庣粏', subtitle: '鏌ョ湅鎵€鏈夎姹傜殑璇︾粏璁板綍' },
        hub: { title: t('title_hub'), subtitle: t('subtitle_hub') },
        sessions: { title: t('nav_sessions'), subtitle: 'Claude Code 鏈湴浼氳瘽璁板綍' }
    }[viewId];
    if (meta) {
        titleEl.textContent = meta.title;
        subtitleEl.textContent = meta.subtitle;
    }
}
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

// 鈹€鈹€ 12a: Navigation 鈹€鈹€
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
    // Refresh traffic dashboard when switching to history view
    if (viewId === 'history' && typeof refreshTrafficDashboard === 'function') {
      refreshTrafficDashboard();
    }
    if (viewId === 'hub' && typeof refreshHubDashboard === 'function') {
      refreshHubDashboard();
    }
    if (viewId === 'sessions' && typeof refreshSessions === 'function') {
      refreshSessions();
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

    // Status pill 鈫?dashboard
    if (dom.statusPill) {
        dom.statusPill.addEventListener('click', () => {
            const dashBtn = document.getElementById('btn-nav-dashboard');
            if (dashBtn) dashBtn.click();
        });
    }

    // Sidebar brand 鈫?dashboard
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
            const viewMap = { '1': 'dashboard', '2': 'settings', '3': 'terminal', '4': 'history', '5': 'traffic-detail', '6': 'hub', '7': 'sessions' };
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

// 鈹€鈹€ 12b: Settings form 鈹€鈹€
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

    // Reset defaults 鈥?fixed: "Confirm" action now correctly triggers the reset
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

// 鈹€鈹€ 12c: Terminal 鈹€鈹€
// 鈹€鈹€ 12c: Client Integrations (formerly Terminal) 鈹€鈹€
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
    if (dom.btnSetupCodex) {
        dom.btnSetupCodex.addEventListener('click', handleSetupCodex);
    }
    if (dom.btnClearCodex) {
        dom.btnClearCodex.addEventListener('click', handleClearCodex);
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
            typeof app.IsCodexConfigured === 'function' ? app.IsCodexConfigured().then(configured => ({ key: 'codex', configured })).catch(err => ({ key: 'codex', err })) : null,
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
    } else if (key === 'codex') {
        updateIntegrationBadge(dom.codexBadge, configured);
        setSyncState(null, document.getElementById('dash-codex-dot'), configured, 'Codex');
        setInstallButtonReapplyState(dom.btnSetupCodex, configured);
        setButtonDisabledIfIdle(dom.btnClearCodex, !configured);
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

// 鈹€鈹€ Actions 鈹€鈹€

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
            toast(t('toast_desktop_setup_fail') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Setup desktop error:', err);
        toast(t('toast_desktop_setup_fail') + ': ' + err.message, 'error');
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

async function handleSetupCodex() {
    const app = getWailsApp();
    if (!app || typeof app.SetupCodex !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnSetupCodex, true, 'status_configuring');
    try {
        const res = await app.SetupCodex();
        if (res === 'success') {
            toastI18n('toast_codex_setup_success', 'success');
            nextStatus = true;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_codex_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Setup Codex error:', err);
        toast(t('toast_codex_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnSetupCodex, false);
        if (nextStatus !== null) applyIntegrationStatus('codex', nextStatus);
    }
}

async function handleClearCodex() {
    const app = getWailsApp();
    if (!app || typeof app.ClearCodex !== 'function') {
        toast(t('warn_desktop_only_env'), 'info');
        return;
    }
    let nextStatus = null;
    setButtonBusy(dom.btnClearCodex, true, 'status_clearing');
    try {
        const res = await app.ClearCodex();
        if (res === 'success') {
            toastI18n('toast_codex_cleared', 'success');
            nextStatus = false;
            refreshIntegrationsSoon();
        } else {
            toast(t('toast_codex_failed') + ': ' + res, 'error');
        }
    } catch (err) {
        console.error('Clear Codex error:', err);
        toast(t('toast_codex_failed') + ': ' + err.message, 'error');
    } finally {
        setButtonBusy(dom.btnClearCodex, false);
        if (nextStatus !== null) applyIntegrationStatus('codex', nextStatus);
    }
}

// 鈹€鈹€ 12e: History 鈹€鈹€
function setupHistoryHandlers() {
}

// 鈹€鈹€ 12f: Theme & preferences center panel 鈹€鈹€
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

        // Load Hub config
        if (typeof loadHubConfig === 'function') loadHubConfig();

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

    // Hub config save button
    const saveHubBtn = document.getElementById('save-hub-config-btn');
    if (saveHubBtn) {
        saveHubBtn.addEventListener('click', saveHubConfig);
    }
}



// Re-populate model selects when language changes (labels stay same but i18n updates)

function refreshModelSelects() {

    populateModelSelects();

}

// 鈹€鈹€ 12g: Dashboard actions 鈹€鈹€

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

// 鈹€鈹€ 12h: Modals 鈹€鈹€
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

// 鈹€鈹€ 12i: Wails runtime events 鈹€鈹€
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

/** Master event handler setup 鈥?delegates to focused sub-functions */

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

    // Hub: Sync Now button
    const syncBtn = document.getElementById('hub-sync-now-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            const origText = syncBtn.textContent;
            syncBtn.textContent = t('hub_syncing') || '鍚屾涓?..';
            syncBtn.disabled = true;
            try {
                const resp = await apiFetch('/ocgt/api/hub/sync', { method: 'POST' }, 10000);
                if (!resp.ok) throw new Error(await resp.text());
                toastI18n('hub_sync_success', 'success');
                setTimeout(() => refreshHubDashboard(), 1500);
            } catch (err) {
                console.error('Sync failed:', err);
                toastI18n('hub_sync_failed', 'error');
            } finally {
                syncBtn.textContent = origText;
                syncBtn.disabled = false;
            }
        });
    }

    // Hub: Refresh button
    const refreshBtn = document.getElementById('hub-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshHubDashboard());
    }

    // Sessions: search/filter/sort controls
    setupSessionsControls();
}



function setupEnvRepairHandlers() {

    // Env repair UI is handled through integration buttons

}
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

// 鈹€鈹€ Hub cross-device sync 鈹€鈹€

/** Load hub config from backend and populate the settings form */
async function loadHubConfig() {
    try {
        const raw = await callWails('GetHubConfig');
        if (!raw) return;
        const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val != null ? val : ''; };
        setChecked('hub-enabled', cfg.enabled);
        setVal('hub-url', cfg.hubUrl || '');
        setVal('hub-device-name', cfg.deviceName || '');
        setVal('hub-interval', cfg.pushIntervalSec || 120);
        if (cfg.hasSecret) {
            const el = document.getElementById('hub-secret');
            if (el) el.placeholder = '鈥⑩€⑩€⑩€⑩€⑩€⑩€⑩€?(宸茶缃?';
        }
    } catch (err) {
        console.error('Failed to load hub config:', err);
    }
}

/** Save hub config from settings form */
async function saveHubConfig() {
    const enabled = document.getElementById('hub-enabled')?.checked || false;
    const hubUrl = document.getElementById('hub-url')?.value?.trim() || '';
    const secret = document.getElementById('hub-secret')?.value || '';
    const deviceName = document.getElementById('hub-device-name')?.value?.trim() || '';
    const interval = parseInt(document.getElementById('hub-interval')?.value) || 120;

    const statusEl = document.getElementById('hub-config-status');
    if (statusEl) statusEl.textContent = '淇濆瓨涓?..';

    try {
        const res = await callWails('SaveHubConfig', enabled, hubUrl, secret, deviceName, interval);
        if (statusEl) {
            statusEl.textContent = res === 'success' ? '鉁?宸蹭繚瀛? : '鉁?' + (res || '');
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        }
    } catch (err) {
        if (statusEl) statusEl.textContent = '鉁?' + err.message;
    }
}

/** Fetch hub status and refresh entire hub dashboard */
async function refreshHubDashboard() {
    try {
        const raw = await callWails('GetHubStatus');
        if (!raw) return;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const statusDot = document.getElementById('hub-status-dot');
        const statusText = document.getElementById('hub-status-text');
        const deviceIdLabel = document.getElementById('hub-device-id-label');

        if (data && data.connected && data.remoteStats) {
            if (statusDot) statusDot.style.background = 'var(--green)';
            if (statusText) statusText.textContent = t('hub_connected') || '宸茶繛鎺?;
            if (deviceIdLabel) deviceIdLabel.textContent = 'ID: ' + (data.deviceId || '');
            renderHubStats(data.remoteStats);
        } else {
            if (statusDot) statusDot.style.background = 'var(--text-2)';
            if (statusText) statusText.textContent = t('hub_disconnected') || '鏈繛鎺?;
            if (deviceIdLabel) deviceIdLabel.textContent = '';
            document.getElementById('hub-total-tokens').textContent = '-';
            document.getElementById('hub-total-cost').textContent = '-';
            document.getElementById('hub-today-tokens').textContent = '';
            document.getElementById('hub-today-cost').textContent = '';
            document.getElementById('hub-devices-list').innerHTML = '<span>' + (t('hub_no_devices') || '鏆傛棤璁惧鏁版嵁') + '</span>';
        }
    } catch (err) {
        console.error('Failed to refresh hub dashboard:', err);
    }
}

/** Render hub stat cards and device list from aggregated stats */
function renderHubStats(stats) {
    if (!stats) return;

    // Aggregate cards
    const totalTokens = stats.allTime?.totalTokens || 0;
    const totalCost = stats.allTime?.estimatedCost || 0;
    const todayTokens = stats.today?.totalTokens || 0;
    const todayCost = stats.today?.estimatedCost || 0;

    document.getElementById('hub-total-tokens').textContent = formatTokens(totalTokens);
    document.getElementById('hub-total-cost').textContent = '$' + Number(totalCost).toFixed(2);
    document.getElementById('hub-today-tokens').textContent = '浠婃棩: ' + formatTokens(todayTokens);
    document.getElementById('hub-today-cost').textContent = '浠婃棩: $' + Number(todayCost).toFixed(2);

    // Device list
    const listEl = document.getElementById('hub-devices-list');
    const countEl = document.getElementById('hub-device-count');
    const devices = stats.devices || [];
    if (countEl) countEl.textContent = devices.length + ' 鍙?;

    if (devices.length === 0) {
        listEl.innerHTML = '<span class="hub-empty-hint">' + (t('hub_no_devices') || '鏆傛棤璁惧鏁版嵁') + '</span>';
    } else {
        listEl.innerHTML = devices.map(d => {
            const isStale = d.stale;
            const dotColor = isStale ? 'var(--text-2)' : 'var(--green)';
            const statusLabel = isStale ? '绂荤嚎' : '鍦ㄧ嚎';
            const name = d.displayName || d.deviceId || 'Unknown';
            const dToday = d.today || {};
            const dAllTime = d.allTime || {};
            const todayT = dToday.totalTokens || 0;
            const allTimeT = dAllTime.totalTokens || 0;
            const hostname = d.hostname || '';
            return '<div class="hub-device-item">' +
                '<span class="hub-device-dot" style="background:' + dotColor + ';"></span>' +
                '<div class="hub-device-info">' +
                '<div class="hub-device-name">' + escHtml(name) + '</div>' +
                (hostname ? '<div class="hub-device-meta">' + escHtml(hostname) + '</div>' : '') +
                '</div>' +
                '<div class="hub-device-stats">' +
                '<span class="hub-device-today">浠婃棩 ' + formatTokens(todayT) + '</span>' +
                '<span class="hub-device-total">鎬昏 ' + formatTokens(allTimeT) + '</span>' +
                '</div>' +
                '<span class="hub-device-status" data-status="' + (isStale ? 'offline' : 'online') + '">' + statusLabel + '</span>' +
                '</div>';
        }).join('');
    }

    // Model chart
    renderHubModelChart(stats);
}

/** Render model usage bar chart using Chart.js */
function renderHubModelChart(stats) {
    const canvas = document.getElementById('hub-model-chart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') return;

    // Aggregate byModel across all devices
    const modelTotals = {};
    const devices = stats.devices || [];
    for (const d of devices) {
        const allTime = d.allTime || d.periods?.allTime;
        if (allTime?.byModel) {
            for (const [model, dim] of Object.entries(allTime.byModel)) {
                modelTotals[model] = (modelTotals[model] || 0) + (dim.tokens || 0);
            }
        }
    }

    const labels = Object.keys(modelTotals).slice(0, 8);
    const values = labels.map(m => modelTotals[m]);
    if (labels.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (window.__hubChart) { window.__hubChart.destroy(); }
    const colors = ['#34d399','#60a5fa','#fbbf24','#f87171','#a78bfa','#fb923c','#22d3ee','#e879f9'];

    window.__hubChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tokens',
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => formatTokens(v) } }
            }
        }
    });
}

/** Returns true when el is the currently focused element. Safe when nothing is focused. */
function isElementFocused(el) {
    return document.activeElement && document.activeElement.isSameNode(el);
}

/** Format large numbers with K/M suffix */
function formatTokens(n) {
    n = Number(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// 鈹€鈹€ Sessions 鈹€鈹€

let allSessionsData = [];
let sCurrentPeriod = 'today';

async function refreshSessions() {
    const listEl = document.getElementById('sessions-list');
    if (!listEl) return;
    try {
        listEl.innerHTML = '<div class="s-loading">鍔犺浇涓?..</div>';
        const resp = await apiFetch('/ocgt/api/sessions');
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        allSessionsData = data.sessions || [];
        populateModelFilter();
        applySessionsFilters();
        renderSessionsChart();
    } catch (err) {
        console.error('Failed to load sessions:', err);
        if (listEl) listEl.innerHTML = '<div class="s-loading" style="color:var(--red);">鍔犺浇澶辫触: ' + escHtml(err.message) + '</div>';
    }
}

function populateModelFilter() {
    const sel = document.getElementById('sessions-model-filter');
    if (!sel) return;
    const models = new Set();
    for (const s of allSessionsData) {
        if (s.model) models.add(s.model);
    }
    const current = sel.value;
    sel.innerHTML = '<option value="">' + (t('sessions_filter_all') || '鍏ㄩ儴妯″瀷') + '</option>';
    [...models].sort().forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        sel.appendChild(opt);
    });
    sel.value = current;
}

/** 鎸夋椂娈佃繃婊?*/
function filterByPeriod(sessions, period) {
    if (period === 'all') return sessions;
    const now = new Date();
    let cutoff;
    if (period === 'today') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else { // month
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const cutoffMs = cutoff.getTime();
    return sessions.filter(s => {
        const t = s.lastTime ? new Date(s.lastTime).getTime() : 0;
        return t >= cutoffMs;
    });
}

/** 绠€鍖栦細璇?ID 鈥斺€?鍘绘帀甯歌鍓嶇紑 */
function shortSessionId(id) {
    if (!id) return '';
    // 鍘绘帀 rollout-YYYY-MM-DDTHH-MM-SS- 鎴栫被浼煎墠缂€
    const cleaned = id.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}[\-:]\d{2}[\-:]\d{2}-/i, '');
    if (cleaned.length <= 14) return cleaned;
    return cleaned.slice(0, 14) + '鈥?;
}

let sessionsFilterTimer;
function setupSessionsControls() {
    const searchInput = document.getElementById('sessions-search');
    const modelFilter = document.getElementById('sessions-model-filter');
    const sortSelect = document.getElementById('sessions-sort');
    if (searchInput) searchInput.addEventListener('input', () => {
        clearTimeout(sessionsFilterTimer);
        sessionsFilterTimer = setTimeout(applySessionsFilters, 200);
    });
    if (modelFilter) modelFilter.addEventListener('change', applySessionsFilters);
    if (sortSelect) sortSelect.addEventListener('change', applySessionsFilters);

    // 鏃舵鍒囨崲
    document.querySelectorAll('.s-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.s-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            sCurrentPeriod = btn.dataset.period;
            applySessionsFilters();
        });
    });

    // 妯″瀷鍒嗗竷鍥炬姌鍙?
    const chartToggle = document.getElementById('s-chart-toggle');
    if (chartToggle) {
        chartToggle.addEventListener('click', () => {
            const body = document.getElementById('s-chart-body');
            const chevron = chartToggle.querySelector('.s-chart-chevron');
            if (body && chevron) {
                const hidden = body.style.display === 'none';
                body.style.display = hidden ? '' : 'none';
                chevron.style.transform = hidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
        });
    }

    // 鍐呭鏄剧ず鍒囨崲 鈥?瀹炴椂鏇存柊璇︽儏寮圭獥
    const contentToggle = document.getElementById('sessions-content-toggle');
    if (contentToggle) {
        const saved = localStorage.getItem('sessions_show_content');
        if (saved === 'true') contentToggle.checked = true;
        contentToggle.addEventListener('change', () => {
            localStorage.setItem('sessions_show_content', contentToggle.checked);
            // 璇︽儏寮圭獥鎵撳紑鏃跺疄鏃堕噸娓叉煋
            const content = document.getElementById('session-detail-content');
            if (content?._detailData && content.style.display !== 'none') {
                renderSessionDetail(content._detailData, content);
            }
        });
    }

    // 璇︽儏鎺掑簭鎸夐挳
    const sortBtn = document.getElementById('sd-sort-btn');
    if (sortBtn) {
        sortBtn.dataset.sort = 'time';
        sortBtn.addEventListener('click', toggleDetailSort);
    }

    // Close session detail modal
    const closeBtn = document.getElementById('sessionDetailClose');
    const overlay = document.getElementById('sessionDetailOverlay');
    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    }
}

function applySessionsFilters() {
    const searchVal = (document.getElementById('sessions-search')?.value || '').toLowerCase();
    const modelFilter = document.getElementById('sessions-model-filter')?.value || '';
    const sortVal = document.getElementById('sessions-sort')?.value || 'time-desc';

    // 1. 鏃舵杩囨护
    let filtered = filterByPeriod(allSessionsData, sCurrentPeriod);

    // 2. 鎼滅储杩囨护
    if (searchVal) {
        filtered = filtered.filter(s =>
            s.sessionId.toLowerCase().includes(searchVal) ||
            (s.model || '').toLowerCase().includes(searchVal)
        );
    }

    // 3. 妯″瀷杩囨护
    if (modelFilter) {
        filtered = filtered.filter(s => s.model === modelFilter);
    }

    // 4. 鎺掑簭
    filtered.sort((a, b) => {
        switch (sortVal) {
            case 'time-asc': return (a.startTime || '').localeCompare(b.startTime || '');
            case 'tokens-desc': return (b.totalTokens || 0) - (a.totalTokens || 0);
            case 'tokens-asc': return (a.totalTokens || 0) - (b.totalTokens || 0);
            case 'cost-desc': return sessionCost(b.model, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheCreateTokens) - sessionCost(a.model, a.inputTokens, a.outputTokens, a.cacheReadTokens, a.cacheCreateTokens);
            default: return (b.lastTime || '').localeCompare(a.lastTime || '');
        }
    });

    renderSessionsList(filtered);
    renderSessionsStats(filtered);
}

function renderSessionsStats(sessions) {
    let totalTokens = 0, totalCost = 0;
    for (const s of sessions) {
        totalTokens += s.totalTokens || 0;
        totalCost += sessionCost(s.model, s.inputTokens, s.outputTokens, s.cacheReadTokens, s.cacheCreateTokens);
    }
    const countEl = document.getElementById('sessions-count');
    const totalTokEl = document.getElementById('sessions-total-tokens');
    const totalCostEl = document.getElementById('sessions-total-cost');
    if (countEl) countEl.textContent = sessions.length;
    if (totalTokEl) totalTokEl.textContent = formatTokens(totalTokens);
    if (totalCostEl) totalCostEl.textContent = totalCost.toFixed(2);
}

function renderSessionsList(sessions) {
    const listEl = document.getElementById('sessions-list');
    if (!listEl) return;

    if (sessions.length === 0) {
        listEl.innerHTML = '<div class="s-empty">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="s-empty-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<div>' + (t('sessions_no_data') || '鏆傛棤浼氳瘽璁板綍') + '</div>' +
            '</div>';
        return;
    }

    const maxTokens = sessions.reduce((m, s) => Math.max(m, s.totalTokens || 0), 1);

    listEl.innerHTML = sessions.map(s => {
        const ratio = (s.totalTokens || 0) / maxTokens;
        const dotColor = ratio > 0.5 ? 'var(--red)' : ratio > 0.15 ? 'var(--yellow)' : 'var(--green)';
        const cost = sessionCost(s.model, s.inputTokens, s.outputTokens, s.cacheReadTokens, s.cacheCreateTokens);
        const modelShort = (s.model || '?').replace(/^claude-/i, '');
        const sidShort = shortSessionId(s.sessionId);

        // 鏃堕棿鏄剧ず
        const timeStr = s.lastTime ? formatSessionTime(s.lastTime) : '';
        const msgLabel = s.messageCount + ' 鏉?;

        return '<div class="s-row" data-session-id="' + escHtml(s.sessionId) + '">' +
            '<div class="s-row-main">' +
            '<div class="s-row-left">' +
            '<span class="s-row-dot" style="background:' + dotColor + ';"></span>' +
            '<div class="s-row-info">' +
            '<span class="s-row-title">' + escHtml(modelShort) + '</span>' +
            '<span class="s-row-meta">' + timeStr + ' 路 ' + msgLabel + ' 路 ' + escHtml(sidShort) + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="s-row-right">' +
            '<span class="s-row-value">' + formatTokens(s.totalTokens) + '</span>' +
            '<span class="s-row-cost">$' + cost.toFixed(2) + '</span>' +
            '<span class="s-row-chevron">鈥?/span>' +
            '</div>' +
            '</div>' +
            '<div class="s-row-bar">' +
            '<div class="s-row-bar-fill" style="width:' + (ratio * 100).toFixed(1) + '%;background:' + dotColor + ';"></div>' +
            '</div>' +
            '</div>';
    }).join('');

    // 鐐瑰嚮琛?鈫?璇︽儏
    listEl.querySelectorAll('.s-row').forEach(row => {
        row.addEventListener('click', () => {
            const sid = row.dataset.sessionId;
            if (sid) openSessionDetail(sid);
        });
    });
}

function formatSessionTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const now = new Date();
        const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        if (isToday) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return iso; }
}

function renderSessionsChart() {
    const canvas = document.getElementById('sessions-model-chart');
    if (!canvas) return;
    const container = document.getElementById('sessions-chart-container');
    const countLabel = document.getElementById('s-chart-model-count');
    if (typeof Chart === 'undefined') {
        container.style.display = 'none';
        return;
    }

    // 鍙褰撳墠杩囨护鍚庣殑浼氳瘽鍋氱粺璁?鈥斺€?浣嗗浘琛ㄦ樉绀哄叏閮ㄦ暟鎹?
    // 浣跨敤 allSessionsData锛堝師濮嬫暟鎹級
    const modelCounts = {};
    let totalSessions = 0;
    for (const s of allSessionsData) {
        const m = s.model || 'unknown';
        modelCounts[m] = (modelCounts[m] || 0) + 1;
        totalSessions++;
    }
    const labels = Object.keys(modelCounts);
    if (labels.length === 0 || totalSessions === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    if (countLabel) countLabel.textContent = labels.length + ' 妯″瀷';

    if (window.__sessionsChart) window.__sessionsChart.destroy();

    const colors = ['#34d399','#60a5fa','#fbbf24','#f87171','#a78bfa','#fb923c','#22d3ee','#e879f9','#f9a8d4','#94a3b8'];
    window.__sessionsChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels.map(m => m.replace(/^claude-/i, '')),
            datasets: [{
                data: labels.map(m => modelCounts[m]),
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#94a3b8', font: { size: 10 }, padding: 10, boxWidth: 10 }
                }
            },
            cutout: '60%'
        }
    });
}

/** 璐圭敤浼扮畻 */
function sessionCost(model, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens) {
    const rates = {
        'deepseek-v4-flash': { in: 0.3e-6, out: 1.1e-6, cr: 0, cc: 0 },
        'deepseek-v4-pro':   { in: 1.2e-6, out: 4e-6,   cr: 0, cc: 0 },
        'claude-sonnet':     { in: 3e-6,   out: 15e-6,  cr: 0.3e-6,  cc: 3.75e-6 },
        'claude-opus':       { in: 15e-6,  out: 75e-6,  cr: 1.5e-6,  cc: 18.75e-6 },
        'claude-haiku':      { in: 0.8e-6, out: 4e-6,   cr: 0.08e-6, cc: 1.0e-6 },
        'kimi':              { in: 3e-6,   out: 15e-6,  cr: 0, cc: 0 },
        'qwen':              { in: 3e-6,   out: 15e-6,  cr: 0, cc: 0 },
        'glm':               { in: 0.5e-6, out: 1.5e-6, cr: 0, cc: 0 },
        'hy3':               { in: 0.5e-6, out: 1.5e-6, cr: 0, cc: 0 },
        'mimo':              { in: 1e-6,   out: 2e-6,   cr: 0, cc: 0 },
        'minimax':           { in: 0.8e-6, out: 2e-6,   cr: 0, cc: 0 },
    };
    const key = Object.keys(rates).find(k => (model || '').toLowerCase().includes(k)) || 'claude-sonnet';
    const r = rates[key];
    const cr = cacheReadTokens || 0;
    const cc = cacheCreateTokens || 0;
    return inputTokens * r.in + outputTokens * r.out + cr * r.cr + cc * r.cc;
}

/** 鎵撳紑浼氳瘽璇︽儏寮圭獥 */
async function openSessionDetail(sessionId) {
    const overlay = document.getElementById('sessionDetailOverlay');
    const loading = document.getElementById('session-detail-loading');
    const content = document.getElementById('session-detail-content');
    const title = document.getElementById('session-detail-title');
    if (!overlay || !loading || !content) return;

    overlay.classList.add('active');
    loading.style.display = '';
    content.style.display = 'none';
    title.textContent = '浼氳瘽: ' + sessionId;

    try {
        const resp = await apiFetch('/ocgt/api/sessions?id=' + encodeURIComponent(sessionId));
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        content._detailData = data; // 缂撳瓨渚涙帓搴忛噸娓叉煋
        renderSessionDetail(data, content);
    } catch (err) {
        content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">鍔犺浇澶辫触: ' + escHtml(err.message) + '</div>';
    } finally {
        loading.style.display = 'none';
        content.style.display = '';
    }
}

/** 娓叉煋浼氳瘽璇︽儏锛堟敮鎸佹帓搴忥級 */
function renderSessionDetail(data, container) {
    const events = data.events || [];
    const showContent = document.getElementById('sessions-content-toggle')?.checked || false;

    // 1. 鏋勫缓 exchange 瀵硅薄鏁扮粍
    const exchanges = [];
    let currentEx = null;

    for (const evt of events) {
        if (evt.type === 'user') {
            if (currentEx) exchanges.push(currentEx);
            const text = showContent && evt.message?.text ? evt.message.text : '';
            currentEx = {
                time: evt.timestamp || '',
                tokens: 0,
                text: text,
                turns: []
            };
        } else if (evt.type === 'assistant') {
            if (!currentEx) {
                // 鏃犲墠瀵?user 浜嬩欢锛屽垱寤哄崰浣?exchange
                currentEx = { time: evt.timestamp || '', tokens: 0, text: '', turns: [] };
            }
            const usage = evt.message?.usage || {};
            const inTok = usage.input_tokens || 0;
            const outTok = usage.output_tokens || 0;
            currentEx.turns.push({
                time: evt.timestamp || '',
                model: evt.message?.model || '',
                inTok, outTok,
                tools: showContent && evt.message?.tools ? evt.message.tools : []
            });
            currentEx.tokens += inTok + outTok;
        }
    }
    if (currentEx) exchanges.push(currentEx);

    // 杩囨护鎺夋棤 turn 鐨勭┖ exchange
    const valid = exchanges.filter(ex => ex.turns.length > 0);

    // 2. 鎺掑簭
    const sortBtn = document.getElementById('sd-sort-btn');
    const sortBy = sortBtn?.dataset?.sort || 'time';
    if (sortBy === 'tokens') {
        valid.sort((a, b) => (b.tokens || 0) - (a.tokens || 0) || a.time.localeCompare(b.time));
    } else {
        valid.sort((a, b) => b.time.localeCompare(a.time) || (b.tokens || 0) - (a.tokens || 0));
    }

    // 3. 娓叉煋
    if (valid.length === 0) {
        container.innerHTML = '<div class="sd-empty">鏃犱簨浠舵暟鎹?/div>';
        return;
    }

    const maxTokens = valid.reduce((m, e) => Math.max(m, e.tokens || 0), 1);
    const totalTokens = valid.reduce((s, e) => s + (e.tokens || 0), 0);
    let html = '<div class="session-detail-exchanges">';
    for (const ex of valid) {
        let preview = '';
        if (ex.text) {
            if (/\[Image #?\d*\]/i.test(ex.text)) {
                preview = ' 馃柤锔?' + escHtml(ex.text.replace(/\[Image #?\d*\]/gi, '').trim().slice(0, 80));
                if (!preview.trim()) preview = ' 馃柤锔?[鍥剧墖]';
            } else {
                preview = '锛? + escHtml(ex.text.slice(0, 200));
            }
        }
        const barPct = ((ex.tokens || 0) / maxTokens * 100).toFixed(1);
        const totalPct = totalTokens > 0 ? ((ex.tokens || 0) / totalTokens * 100).toFixed(1) : 0;

        html += '<div class="sd-exchange">' +
            '<div class="sd-exchange-head" onclick="toggleExchange(this)">' +
            '<span class="sd-chevron">鈻?/span>' +
            '<span class="sd-role-badge sd-role-user">浣?/span>' +
            (preview ? '<span class="sd-preview">' + preview + '</span>' : '') +
            '<span class="sd-ex-metrics">' +
            '<span class="sd-ex-value">' + formatTokens(ex.tokens) + '</span>' +
            '<span class="sd-ex-pct">' + totalPct + '%</span>' +
            '</span>' +
            '<span class="sd-exchange-time">' + formatEventTime(ex.time) + '</span>' +
            '</div>' +
            '<div class="sd-exchange-bar"><div class="sd-exchange-bar-fill" style="width:' + barPct + '%;background:var(--accent);"></div></div>' +
            '<div class="sd-exchange-body" style="display:none;">';

        for (const turn of ex.turns) {
            const tokStr = '鈫?' + turn.inTok + ' 路 鈫?' + turn.outTok;
            const tToolStr = turn.tools.length ? ' 路 鈯?' + turn.tools.join(' ') : '';
            html += '<div class="sd-turn">' +
                '<div class="sd-turn-header">' +
                '<span class="sd-role-badge sd-role-ai">AI</span>' +
                '<span class="sd-turn-model">' + escHtml(turn.model) + '</span>' +
                '</div>' +
                '<div class="sd-turn-tokens">' + tokStr + tToolStr + '</div>' +
                '</div>';
        }

        html += '</div></div>';
    }
    html += '</div>';

    container.innerHTML = html;
}

/** 鍒囨崲浼氳瘽璇︽儏鎺掑簭 */
function toggleDetailSort() {
    const btn = document.getElementById('sd-sort-btn');
    if (!btn) return;
    const current = btn.dataset.sort || 'time';
    const newSort = current === 'time' ? 'tokens' : 'time';
    btn.dataset.sort = newSort;
    btn.textContent = newSort === 'time' ? (t('sd_sort_time') || '鎸夋椂闂?) : (t('sd_sort_tokens') || '鎸?Token');
    // 閲嶆柊娓叉煋
    const content = document.getElementById('session-detail-content');
    const data = content?._detailData;
    if (data) renderSessionDetail(data, content);
}

function toggleExchange(head) {
    const body = head.nextElementSibling && head.nextElementSibling.nextElementSibling;
    const chevron = head.querySelector('.sd-chevron');
    if (body && chevron) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        chevron.textContent = isHidden ? '鈻? : '鈻?;
        if (isHidden) {
            const exchanges = head.closest('.session-detail-exchanges');
            if (exchanges) {
                exchanges.querySelectorAll('.sd-exchange-body').forEach(b => {
                    if (b !== body) {
                        b.style.display = 'none';
                        if (b.parentElement) {
                            const ch = b.parentElement.querySelector('.sd-chevron');
                            if (ch) ch.textContent = '鈻?;
                        }
                    }
                });
            }
        }
    }
}

function formatEventTime(ts) {
    if (!ts) return '';
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ts; }
}

// Quota fetching and rendering
async function fetchAndRenderQuota() {
    const bars = document.getElementById('quota-bars');
    const time = document.getElementById('quota-refresh-time');
    const label = document.getElementById('quota-label');
    if (!bars) return;

    try {
        const result = await window['go']['main']['App']['FetchQuota']();
        if (!result.success) {
            bars.innerHTML = `<span class="quota-error">${result.error || '鏈煡閿欒'}</span>`;
            if (time) time.textContent = '';
            return;
        }
        const d = result.data;
        if (!d) {
            bars.innerHTML = '<span class="quota-loading">鏃犳暟鎹?/span>';
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
        if (label) label.textContent = 'OpenCode Go 濂楅棰濆害';
    } catch (e) {
        bars.innerHTML = `<span class="quota-error">鑾峰彇棰濆害澶辫触: ${e}</span>`;
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
