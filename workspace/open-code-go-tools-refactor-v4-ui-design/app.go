package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
	"github.com/ethan-blue/open-code-go-tools/internal/preferences"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// beforeClose is called when the user clicks the 'X' button.
// IMPORTANT: On Windows, calling wailsruntime.MessageDialog inside this callback
// is unreliable and causes deadlocks because the window is mid-close.
// Instead we always prevent the close here, then emit an event to the frontend
// which shows a premium custom HTML modal to let the user decide.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.forceQuit.Load() {
		return false
	}

	prefs, err := preferences.Load("")
	closeBehavior := preferences.DefaultCloseBehavior
	if err == nil {
		closeBehavior = prefs.CloseBehavior
	}

	switch closeBehavior {
	case "exit":
		a.forceQuit.Store(true)
		// Directly exit — no dialog needed
		return false
	case "minimize":
		// Silently hide to tray — no dialog needed
		go func() {
			time.Sleep(50 * time.Millisecond)
			a.enqueueTrayAction(trayActionHide)
		}()
		return true
	default: // "prompt"
		// Emit event to frontend so it can show its own custom HTML modal.
		// This avoids the Windows deadlock caused by OS dialogs inside OnBeforeClose.
		go func() {
			time.Sleep(50 * time.Millisecond)
			wailsruntime.EventsEmit(ctx, "show-close-dialog")
		}()
		return true // prevent OS close; frontend modal will call QuitApp or HideToTray
	}
}

// RequestClose handles the close button click from custom titlebar.
// It checks preferences and either exits, hides to tray, or shows the close dialog.
func (a *App) RequestClose() string {
	if a.forceQuit.Load() {
		a.exitNow()
		return "exit"
	}

	prefs, err := preferences.Load("")
	closeBehavior := preferences.DefaultCloseBehavior
	if err == nil {
		closeBehavior = prefs.CloseBehavior
	}

	switch closeBehavior {
	case "exit":
		a.forceQuit.Store(true)
		a.exitNow()
		return "exit"
	case "minimize":
		a.hideMainWindow()
		return "minimize"
	default: // "prompt"
		if a.ctx != nil {
			wailsruntime.EventsEmit(a.ctx, "show-close-dialog")
		}
		return "prompt"
	}
}

// QuitApp exits the application cleanly. Called from the frontend close-dialog modal.
func (a *App) QuitApp() {
	a.exitNow()
}

func (a *App) exitNow() {
	a.exitOnce.Do(func() {
		a.forceQuit.Store(true)
		if a.ctx != nil {
			wailsruntime.Quit(a.ctx)
			// Hard fallback: if Wails doesn't shut down cleanly within 2 seconds,
			// force-exit to prevent a zombie process. Also clean up the systray
			// icon to avoid orphaned notification area icons on Windows.
			time.AfterFunc(2*time.Second, func() {
				log.Println("[exit] Wails did not shut down in time, forcing exit")
				a.quitSystray()
				os.Exit(0)
			})
			return
		}
		a.shutdown(context.Background())
		os.Exit(0)
	})
}

// HideToTray hides the main window to the system tray. Called from the frontend close-dialog modal.
func (a *App) HideToTray() {
	a.forceQuit.Store(false)
	a.enqueueTrayAction(trayActionHide)
}

// ShowAboutDialog shows an about info dialog. Emits an event to the frontend
// so the display runs safely on the Wails JS thread (avoids tray-thread deadlock).
func (a *App) ShowAboutDialog() {
	a.enqueueTrayAction(trayActionAbout)
}

// SavePreferences updates preferences like window close behavior.
func (a *App) SavePreferences(closeBehavior string) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	prefs.CloseBehavior = closeBehavior
	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}
	if err := removeLegacyCloseBehaviorFromConfig(); err != nil {
		log.Println("[GUI preferences] legacy close_behavior cleanup error:", err)
	}
	return "success"
}

func (a *App) SaveUIPreferences(theme, language string, accentHue int, lastView, compactShell, expandedIntegrationsJSON string) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	if strings.TrimSpace(theme) != "" {
		prefs.Theme = theme
	}
	if strings.TrimSpace(language) != "" {
		prefs.Language = language
	}
	if accentHue >= 0 {
		prefs.AccentHue = accentHue
	}
	if strings.TrimSpace(lastView) != "" {
		prefs.LastView = lastView
	}
	if strings.TrimSpace(compactShell) != "" {
		prefs.CompactShell = compactShell
	}
	if strings.TrimSpace(expandedIntegrationsJSON) != "" {
		var expanded []string
		if err := json.Unmarshal([]byte(expandedIntegrationsJSON), &expanded); err != nil {
			return "validation error: expanded integrations must be a JSON array"
		}
		prefs.ExpandedIntegrations = expanded
	}
	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}
	return "success"
}

// GetPreferences returns GUI-only preferences. These are intentionally kept
// outside the proxy config so CLI/server config stays portable.
func (a *App) GetPreferences() map[string]string {
	prefs, err := preferences.Load("")
	if err != nil {
		log.Println("[GUI preferences] load error:", err)
		prefs = preferences.Preferences{
			CloseBehavior:        preferences.DefaultCloseBehavior,
			LogEnabled:           preferences.DefaultLogEnabled,
			LogRetentionDays:     preferences.DefaultLogRetentionDays,
			Theme:                preferences.DefaultTheme,
			Language:             preferences.DefaultLanguage,
			AccentHue:            preferences.DefaultAccentHue,
			LastView:             preferences.DefaultLastView,
			CompactShell:         preferences.DefaultCompactShell,
			ExpandedIntegrations: []string{},
		}
		if dir, dirErr := preferences.DefaultLogDirectory(); dirErr == nil {
			prefs.LogDirectory = dir
		}
	}
	expanded, _ := json.Marshal(prefs.ExpandedIntegrations)
	return map[string]string{
		"close_behavior":        prefs.CloseBehavior,
		"log_enabled":           strconv.FormatBool(prefs.LogEnabled),
		"log_directory":         prefs.LogDirectory,
		"log_retention_days":    strconv.Itoa(prefs.LogRetentionDays),
		"theme":                 prefs.Theme,
		"language":              prefs.Language,
		"accent_hue":            strconv.Itoa(prefs.AccentHue),
		"last_view":             prefs.LastView,
		"compact_shell":         prefs.CompactShell,
		"expanded_integrations": string(expanded),
	}
}

// FetchQuota queries OpenCode Go quota from the opencode.ai RPC endpoint.
// Called from the frontend via Wails binding. Returns JSON-serializable result.
// Credentials are resolved in this order: Profile config → env vars.
func (a *App) FetchQuota() map[string]any {
	cookie, workspaceID := a.resolveQuotaCredentials()
	data, err := quota.FetchOpenCodeGoQuota(cookie, workspaceID)
	if err != nil {
		return map[string]any{
			"success":       false,
			"provider_name": "opencode-go",
			"error":         err.Error(),
		}
	}

	// Also cache in the proxy server so /ocgt/api/quota returns it
	if a.srv != nil {
		a.srv.SetQuotaData(data)
	}

	return map[string]any{
		"success":       true,
		"provider_name": "opencode-go",
		"data":          data,
	}
}

// FetchUpstreamModels fetches the upstream model list through the proxy server
// (no CORS, carries the configured API key for the active profile).
// Returns {"success": true, "data": <normalized models>} or {"success": false, "error": "..."}.
func (a *App) FetchUpstreamModels() map[string]any {
	if a.srv == nil {
		return map[string]any{"success": false, "error": "proxy server not started"}
	}
	data, err := a.srv.FetchUpstreamModels(context.Background())
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}
	}
	return map[string]any{"success": true, "data": data}
}

// TestUpstreamConnection tests connectivity to the given upstream URL using
// the provided API key — without modifying the running server config.
// This lets the frontend test draft (unsaved) credentials before committing.
func (a *App) TestUpstreamConnection(upstream, apiKey string) map[string]any {
	if a.srv == nil {
		return map[string]any{"success": false, "error": "proxy server not started"}
	}
	data, err := a.srv.TestConnection(context.Background(), upstream, apiKey)
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}
	}
	return map[string]any{"success": true, "data": data}
}

// resolveQuotaCredentials resolves quota credentials from config or env vars.
// Priority: Profile.QuotaCookie/QuotaWorkspaceID → env vars.
func (a *App) resolveQuotaCredentials() (cookie, workspaceID string) {
	cookie = os.Getenv("OPENCODE_GO_AUTH_COOKIE")
	workspaceID = os.Getenv("OPENCODE_GO_WORKSPACE_ID")
	if cookie != "" && workspaceID != "" {
		return
	}

	path, err := config.DefaultPath()
	if err == nil {
		cfg, err := config.Load(path)
		if err == nil {
			if profile, _, err := cfg.Profile(""); err == nil {
				if cookie == "" && profile.QuotaCookie != "" {
					cookie = profile.QuotaCookie
				}
				if workspaceID == "" && profile.QuotaWorkspaceID != "" {
					workspaceID = profile.QuotaWorkspaceID
				}
			}
		}
	}
	return
}

func isMaskedAPIKey(key string) bool {
	return key == "****" || strings.Contains(key, "...")
}

func removeLegacyCloseBehaviorFromConfig() error {
	path, err := config.DefaultPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if _, ok := raw["close_behavior"]; !ok {
		return nil
	}
	delete(raw, "close_behavior")
	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(path, append(out, '\n'), 0o600)
}
