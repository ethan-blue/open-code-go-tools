package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/preferences"
)

const claudeDesktopProfileID = "00000000-0000-4000-8000-000000878700"
const claudeDesktopProfileName = "ocgt"

func (a *App) isClaudeSettingsConfiguredForClient(expectedClient string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return false
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return false
	}
	envMap, _ := settings["env"].(map[string]any)
	if envMap == nil {
		return false
	}

	baseURL, ok := envMap["ANTHROPIC_BASE_URL"].(string)
	if !ok {
		return false
	}
	expected := "http://" + a.GetListenAddress()
	if strings.TrimRight(baseURL, "/") != strings.TrimRight(expected, "/") {
		return false
	}

	if token, ok := envMap["ANTHROPIC_AUTH_TOKEN"].(string); ok && token != "" {
		// A non-empty token means ocgt wrote this target before. The current
		// launch will refresh it if the persisted token changed.
	} else if apiKey, ok := envMap["ANTHROPIC_API_KEY"].(string); !ok || apiKey != "ocgt-local-proxy" {
		return false
	}

	customHeaders, ok := envMap["ANTHROPIC_CUSTOM_HEADERS"].(string)
	if !ok || !strings.Contains(customHeaders, "X-Ocgt-Profile:") {
		return false
	}
	if expectedClient != "" && !strings.Contains(customHeaders, "X-Ocgt-Client: "+expectedClient) {
		return false
	}
	return true
}

func (a *App) ClearSystemEnv() string {
	// Clean up legacy environment variables to ensure we cleanly migrate to JSON-only config
	for _, name := range legacyClaudeEnvNames() {
		_ = unsetUserEnvironment(name)
	}

	if err := clearClaudeSettings(); err != nil {
		return "clear Claude settings error: " + err.Error()
	}

	return "success"
}

func (a *App) IsSystemEnvConfigured() bool {
	return a.isClaudeSettingsConfiguredForClient("claude-code-cli")
}

func claudeDesktopPaths() (normalConfig, threepConfig, profilePath, metaPath string, err error) {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			home, homeErr := os.UserHomeDir()
			if homeErr != nil {
				err = homeErr
				return
			}
			base = filepath.Join(home, "AppData", "Local")
		}
		normalDir := filepath.Join(base, "Claude")
		threepDir := filepath.Join(base, "Claude-3p")
		configLibrary := filepath.Join(threepDir, "configLibrary")
		normalConfig = filepath.Join(normalDir, "claude_desktop_config.json")
		threepConfig = filepath.Join(threepDir, "claude_desktop_config.json")
		profilePath = filepath.Join(configLibrary, claudeDesktopProfileID+".json")
		metaPath = filepath.Join(configLibrary, "_meta.json")
		return
	case "darwin":
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			err = homeErr
			return
		}
		appSupport := filepath.Join(home, "Library", "Application Support")
		normalDir := filepath.Join(appSupport, "Claude")
		threepDir := filepath.Join(appSupport, "Claude-3p")
		configLibrary := filepath.Join(threepDir, "configLibrary")
		normalConfig = filepath.Join(normalDir, "claude_desktop_config.json")
		threepConfig = filepath.Join(threepDir, "claude_desktop_config.json")
		profilePath = filepath.Join(configLibrary, claudeDesktopProfileID+".json")
		metaPath = filepath.Join(configLibrary, "_meta.json")
		return
	default:
		err = fmt.Errorf("unsupported operating system")
		return
	}
}

func writeJSONFile(path string, value map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	out, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(path, append(out, '\n'), 0o600)
}

func readJSONObject(path string) map[string]any {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]any{}
	}
	var obj map[string]any
	if json.Unmarshal(stripCommentsAndTrailingCommas(data), &obj) != nil || obj == nil {
		return map[string]any{}
	}
	return obj
}

func writeDeploymentMode(path, mode string) error {
	obj := readJSONObject(path)
	obj["deploymentMode"] = mode
	return writeJSONFile(path, obj)
}

func (a *App) SetupClaudeDesktopApp() string {
	normalConfig, threepConfig, profilePath, metaPath, err := claudeDesktopPaths()
	if err != nil {
		return err.Error()
	}
	token := a.localProxyAuthToken()
	if token == "" {
		return "local auth token is not ready"
	}
	listen := a.GetListenAddress()
	profile := map[string]any{
		"coworkEgressAllowedHosts":     []string{"*"},
		"disableDeploymentModeChooser": true,
		"inferenceGatewayApiKey":       token,
		"inferenceGatewayAuthScheme":   "bearer",
		"inferenceGatewayBaseUrl":      "http://" + listen + "/claude-desktop",
		"inferenceProvider":            "gateway",
		"inferenceModels": []map[string]any{
			{"name": "claude-sonnet-4-5", "labelOverride": "Sonnet"},
			{"name": "claude-opus-4-7", "labelOverride": "Opus"},
			{"name": "claude-haiku-4-5", "labelOverride": "Haiku"},
		},
	}
	meta := readJSONObject(metaPath)
	meta["appliedId"] = claudeDesktopProfileID
	entries, _ := meta["entries"].([]any)
	found := false
	for _, entry := range entries {
		if m, ok := entry.(map[string]any); ok && m["id"] == claudeDesktopProfileID {
			m["name"] = claudeDesktopProfileName
			found = true
		}
	}
	if !found {
		entries = append(entries, map[string]any{"id": claudeDesktopProfileID, "name": claudeDesktopProfileName})
	}
	meta["entries"] = entries
	if err := writeDeploymentMode(normalConfig, "3p"); err != nil {
		return "write Claude Desktop normal config error: " + err.Error()
	}
	if err := writeDeploymentMode(threepConfig, "3p"); err != nil {
		return "write Claude Desktop 3p config error: " + err.Error()
	}
	if err := writeJSONFile(profilePath, profile); err != nil {
		return "write Claude Desktop profile error: " + err.Error()
	}
	if err := writeJSONFile(metaPath, meta); err != nil {
		return "write Claude Desktop meta error: " + err.Error()
	}
	return "success"
}

func (a *App) ClearClaudeDesktopApp() string {
	normalConfig, threepConfig, profilePath, metaPath, err := claudeDesktopPaths()
	if err != nil {
		return err.Error()
	}
	if err := writeDeploymentMode(normalConfig, "1p"); err != nil {
		return "write Claude Desktop normal config error: " + err.Error()
	}
	if err := writeDeploymentMode(threepConfig, "1p"); err != nil {
		return "write Claude Desktop 3p config error: " + err.Error()
	}
	_ = os.Remove(profilePath)
	meta := readJSONObject(metaPath)
	delete(meta, "appliedId")
	if rawEntries, ok := meta["entries"].([]any); ok {
		entries := make([]any, 0, len(rawEntries))
		for _, entry := range rawEntries {
			if m, ok := entry.(map[string]any); ok && m["id"] == claudeDesktopProfileID {
				continue
			}
			entries = append(entries, entry)
		}
		meta["entries"] = entries
	}
	if err := writeJSONFile(metaPath, meta); err != nil {
		return "write Claude Desktop meta error: " + err.Error()
	}
	return "success"
}

func (a *App) IsClaudeDesktopAppConfigured() bool {
	_, threepConfig, profilePath, metaPath, err := claudeDesktopPaths()
	if err != nil {
		return false
	}
	profile := readJSONObject(profilePath)
	baseURL, _ := profile["inferenceGatewayBaseUrl"].(string)
	if strings.TrimRight(baseURL, "/") != strings.TrimRight("http://"+a.GetListenAddress()+"/claude-desktop", "/") {
		return false
	}
	if profile["inferenceProvider"] != "gateway" {
		return false
	}
	if profile["inferenceGatewayAuthScheme"] != "bearer" {
		return false
	}
	if token, _ := profile["inferenceGatewayApiKey"].(string); token == "" {
		return false
	}
	if readJSONObject(threepConfig)["deploymentMode"] != "3p" {
		return false
	}
	meta := readJSONObject(metaPath)
	return meta["appliedId"] == claudeDesktopProfileID
}

func getVSCodeSettingsPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv("OCGT_TEST_VSCODE_PATH")); path != "" {
		return path, nil
	}
	var configDir string
	switch runtime.GOOS {
	case "windows":
		configDir = os.Getenv("APPDATA")
		if configDir == "" {
			return "", fmt.Errorf("APPDATA not set")
		}
		configDir = filepath.Join(configDir, "Code", "User")
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		configDir = filepath.Join(home, "Library", "Application Support", "Code", "User")
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		configDir = filepath.Join(home, ".config", "Code", "User")
	}
	return filepath.Join(configDir, "settings.json"), nil
}

func stripCommentsAndTrailingCommas(data []byte) []byte {
	out := make([]byte, 0, len(data))
	inString := false
	escaped := false
	for i := 0; i < len(data); i++ {
		ch := data[i]
		if inString {
			out = append(out, ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}

		if ch == '"' {
			inString = true
			out = append(out, ch)
			continue
		}
		if ch == '/' && i+1 < len(data) && data[i+1] == '/' {
			i += 2
			for i < len(data) && data[i] != '\n' && data[i] != '\r' {
				i++
			}
			if i < len(data) {
				out = append(out, data[i])
			}
			continue
		}
		if ch == '/' && i+1 < len(data) && data[i+1] == '*' {
			i += 2
			for i+1 < len(data) && !(data[i] == '*' && data[i+1] == '/') {
				if data[i] == '\n' || data[i] == '\r' {
					out = append(out, data[i])
				}
				i++
			}
			if i+1 < len(data) {
				i++
			}
			continue
		}
		out = append(out, ch)
	}
	return stripTrailingJSONCommas(out)
}

func stripComments(input string) string {
	return string(stripCommentsAndTrailingCommas([]byte(input)))
}

func stripTrailingJSONCommas(data []byte) []byte {
	out := make([]byte, 0, len(data))
	inString := false
	escaped := false
	for i := 0; i < len(data); i++ {
		ch := data[i]
		if inString {
			out = append(out, ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}

		if ch == '"' {
			inString = true
			out = append(out, ch)
			continue
		}
		if ch == ',' {
			j := i + 1
			for j < len(data) && (data[j] == ' ' || data[j] == '\t' || data[j] == '\n' || data[j] == '\r') {
				j++
			}
			if j < len(data) && (data[j] == '}' || data[j] == ']') {
				continue
			}
		}
		out = append(out, ch)
	}
	return out
}

func vscodeBackupPath(settingsPath string) string {
	return settingsPath + ".ocgt-bak"
}

func backupVSCodeEnv(settingsPath string, settings map[string]any) error {
	backupPath := vscodeBackupPath(settingsPath)
	if _, err := os.Stat(backupPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	backup := map[string]map[string]any{}
	for _, osKey := range []string{"terminal.integrated.env.windows", "terminal.integrated.env.osx", "terminal.integrated.env.linux"} {
		termEnv, _ := settings[osKey].(map[string]any)
		keyBackup := map[string]any{}
		for _, k := range legacyClaudeEnvNames() {
			if termEnv != nil {
				if value, exists := termEnv[k]; exists {
					keyBackup[k] = value
				}
			}
		}
		backup[osKey] = keyBackup
	}

	out, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(backupPath, append(out, '\n'), 0600)
}

func restoreVSCodeEnvFromBackup(settingsPath string, settings map[string]any) bool {
	data, err := os.ReadFile(vscodeBackupPath(settingsPath))
	if err != nil {
		return false
	}
	backup := map[string]map[string]any{}
	if err := json.Unmarshal(data, &backup); err != nil {
		return false
	}

	changed := false
	for _, osKey := range []string{"terminal.integrated.env.windows", "terminal.integrated.env.osx", "terminal.integrated.env.linux"} {
		termEnv, ok := settings[osKey].(map[string]any)
		if !ok || termEnv == nil {
			termEnv = map[string]any{}
		}
		keyBackup := backup[osKey]
		for _, k := range legacyClaudeEnvNames() {
			if value, exists := keyBackup[k]; exists {
				termEnv[k] = value
			} else {
				delete(termEnv, k)
			}
			changed = true
		}
		if len(termEnv) == 0 {
			delete(settings, osKey)
		} else {
			settings[osKey] = termEnv
		}
	}
	return changed
}

func (a *App) InstallVSCodeEnv() string {
	path, err := getVSCodeSettingsPath()
	if err != nil {
		return "error getting settings path: " + err.Error()
	}

	var settings map[string]any
	data, err := os.ReadFile(path)
	if err == nil {
		data = stripCommentsAndTrailingCommas(data)
		if err := json.Unmarshal(data, &settings); err != nil {
			return "Error parsing VS Code settings.json (please ensure it's valid JSON): " + err.Error()
		}
	} else if !os.IsNotExist(err) {
		return "error reading settings: " + err.Error()
	}

	if settings == nil {
		settings = map[string]any{}
	}
	if err := backupVSCodeEnv(path, settings); err != nil {
		return "error creating ocgt backup: " + err.Error()
	}

	env := a.claudeCodeEnvForClient("vscode")

	for _, osKey := range []string{"terminal.integrated.env.windows", "terminal.integrated.env.osx", "terminal.integrated.env.linux"} {
		termEnv, ok := settings[osKey].(map[string]any)
		if !ok || termEnv == nil {
			termEnv = map[string]any{}
		}
		for k, v := range env {
			termEnv[k] = v
		}
		settings[osKey] = termEnv
	}

	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "error marshaling settings: " + err.Error()
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "error creating directory: " + err.Error()
	}
	if err := atomicWriteFile(path, out, 0600); err != nil {
		return "error writing settings: " + err.Error()
	}
	return "success"
}

func (a *App) RemoveVSCodeEnv() string {
	path, err := getVSCodeSettingsPath()
	if err != nil {
		return "error getting settings path: " + err.Error()
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "success"
		}
		return "error reading settings: " + err.Error()
	}

	var settings map[string]any
	if err := json.Unmarshal(stripCommentsAndTrailingCommas(data), &settings); err != nil {
		return "error parsing settings (ensure it is valid JSON): " + err.Error()
	}

	changed := restoreVSCodeEnvFromBackup(path, settings)
	keysToRemove := legacyClaudeEnvNames()

	if !changed {
		for _, osKey := range []string{"terminal.integrated.env.windows", "terminal.integrated.env.osx", "terminal.integrated.env.linux"} {
			if termEnv, ok := settings[osKey].(map[string]any); ok && termEnv != nil {
				for _, k := range keysToRemove {
					if _, exists := termEnv[k]; exists {
						delete(termEnv, k)
						changed = true
					}
				}
				if len(termEnv) == 0 {
					delete(settings, osKey)
					changed = true
				} else {
					settings[osKey] = termEnv
				}
			}
		}
	}

	if !changed {
		return "success"
	}

	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "error marshaling settings: " + err.Error()
	}
	if err := atomicWriteFile(path, out, 0600); err != nil {
		return "error writing settings: " + err.Error()
	}
	_ = os.Remove(vscodeBackupPath(path))
	return "success"
}

func (a *App) IsVSCodeConfigured() bool {
	path, err := getVSCodeSettingsPath()
	if err != nil {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var settings map[string]any
	if err := json.Unmarshal(stripCommentsAndTrailingCommas(data), &settings); err != nil {
		return false
	}

	osKey := "terminal.integrated.env.windows"
	if runtime.GOOS == "darwin" {
		osKey = "terminal.integrated.env.osx"
	} else if runtime.GOOS == "linux" {
		osKey = "terminal.integrated.env.linux"
	}

	termEnv, ok := settings[osKey].(map[string]any)
	if !ok || termEnv == nil {
		return false
	}

	baseURL, ok := termEnv["ANTHROPIC_BASE_URL"].(string)
	if !ok {
		return false
	}
	expected := "http://" + a.GetListenAddress()
	if strings.TrimRight(baseURL, "/") != strings.TrimRight(expected, "/") {
		return false
	}

	customHeaders, ok := termEnv["ANTHROPIC_CUSTOM_HEADERS"].(string)
	if !ok || !strings.Contains(customHeaders, "X-Ocgt-Client: vscode") {
		return false
	}

	return true
}

func (a *App) SaveLogPreferences(enabled bool, directory string, retention int) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	prefs.LogEnabled = enabled
	prefs.LogDirectory = directory
	prefs.LogRetentionDays = retention

	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}
	if a.srv != nil {
		a.srv.ConfigureHistoryLog(prefs.LogEnabled, prefs.LogDirectory, prefs.LogRetentionDays)
	}
	return "success"
}

func (a *App) OpenLogLocation() string {
	prefs, err := preferences.Load("")
	if err != nil || prefs.LogDirectory == "" {
		dir, err := preferences.DefaultLogDirectory()
		if err != nil {
			return "error getting default log directory: " + err.Error()
		}
		prefs.LogDirectory = dir
	}

	if err := os.MkdirAll(prefs.LogDirectory, 0700); err != nil {
		return "error creating log directory: " + err.Error()
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", prefs.LogDirectory)
	case "darwin":
		cmd = exec.Command("open", prefs.LogDirectory)
	default:
		cmd = exec.Command("xdg-open", prefs.LogDirectory)
	}

	if err := cmd.Start(); err != nil {
		return "error opening directory: " + err.Error()
	}
	return "success"
}

func (a *App) SaveHubConfig(enabled bool, hubURL, secret, deviceName string, pushIntervalSec int) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	prefs.HubEnabled = enabled
	prefs.HubURL = hubURL
	prefs.HubDeviceName = deviceName
	prefs.HubPushIntervalSec = pushIntervalSec

	// 持久化密钥到独立文件（避免写入 preferences.json）
	if secret != "" {
		home, err := os.UserHomeDir()
		if err == nil {
			secretPath := filepath.Join(home, ".ocgt", "hub-secret")
			if err := os.MkdirAll(filepath.Dir(secretPath), 0700); err == nil {
				os.WriteFile(secretPath, []byte(strings.TrimSpace(secret)), 0600)
			}
		}
	}
	prefs.HubSecret = secret // 用于本次会话

	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}

	// 通知后端重启 Hub 客户端（如果有 srv）
	if a.srv != nil {
		log.Println("[hub] 配置已保存，需重启应用以应用新配置")
	}

	return "success"
}

func (a *App) GetHubConfig() string {
	prefs, err := preferences.Load("")
	if err != nil {
		return `{"error":"` + err.Error() + `"}`
	}

	home, _ := os.UserHomeDir()
	secretPath := filepath.Join(home, ".ocgt", "hub-secret")
	secretData, _ := os.ReadFile(secretPath)
	hasSecret := len(strings.TrimSpace(string(secretData))) > 0

	data, _ := json.Marshal(map[string]any{
		"enabled":         prefs.HubEnabled,
		"hubUrl":          prefs.HubURL,
		"deviceName":      prefs.HubDeviceName,
		"pushIntervalSec": prefs.HubPushIntervalSec,
		"hasSecret":       hasSecret,
	})
	return string(data)
}

func (a *App) GetHubStatus() string {
	status := map[string]any{
		"connected":   false,
		"deviceId":    "",
		"remoteStats": nil,
	}

	if a.srv != nil && a.srv.HubClient != nil {
		status["connected"] = true
		status["deviceId"] = a.srv.HubClient.DeviceID()
		status["remoteStats"] = a.srv.HubClient.RemoteStats()
	}

	data, _ := json.Marshal(status)
	return string(data)
}
