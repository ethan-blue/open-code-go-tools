package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
	"github.com/ethan-blue/open-code-go-tools/internal/hub"
	"github.com/ethan-blue/open-code-go-tools/internal/preferences"
	"github.com/ethan-blue/open-code-go-tools/internal/proxy"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	"github.com/ethan-blue/open-code-go-tools/internal/version"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx        context.Context
	srv        *proxy.Server
	cancelFunc context.CancelFunc
	actionCh   chan trayAction
	quitCh     chan struct{} // signals menu click listener goroutine to exit

	// Allows explicit quit actions to bypass the close-to-tray prompt.
	forceQuit     atomic.Bool
	setupTrayOnce sync.Once
	exitOnce      sync.Once
}

type trayAction int

const (
	trayActionShow trayAction = iota + 1
	trayActionHide
	trayActionSettings
	trayActionAbout
	trayActionQuit
)

// NewApp creates a new App struct instance
func NewApp() *App {
	return &App{actionCh: make(chan trayAction, 16), quitCh: make(chan struct{})}
}

//go:embed build/appicon.png
var appIconPng []byte

//go:embed build/windows/icon.ico
var appIconIco []byte

func (a *App) showMainWindow(center bool) {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowShow(a.ctx)
	if wailsruntime.WindowIsMinimised(a.ctx) {
		wailsruntime.WindowUnminimise(a.ctx)
	}
	if center {
		wailsruntime.WindowCenter(a.ctx)
	}
}

func (a *App) hideMainWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowMinimise(a.ctx)
	wailsruntime.WindowHide(a.ctx)
}

// StartWindowDrag initiates window dragging for frameless windows
func (a *App) StartWindowDrag() {
	if a.ctx == nil {
		return
	}
	startWindowDragNative()
}

func (a *App) enqueueTrayAction(action trayAction) {
	select {
	case a.actionCh <- action:
	default:
		go func() { a.actionCh <- action }()
	}
}

func (a *App) actionLoop() {
	for action := range a.actionCh {
		switch action {
		case trayActionShow:
			a.showMainWindow(false)
		case trayActionHide:
			a.hideMainWindow()
		case trayActionSettings:
			a.showMainWindow(false)
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, "nav-to-settings")
			}
		case trayActionAbout:
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, "show-about-dialog")
			}
		case trayActionQuit:
			a.exitNow()
		}
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.actionLoop()

	// Start Go proxy server in the background!
	go func() {
		emitError := func(msg string) {
			log.Println("[GUI proxy]", msg)
			wailsruntime.EventsEmit(a.ctx, "proxy-error", msg)
		}

		// 1. Auto-init config if it doesn't exist
		defaultPath, err := config.DefaultPath()
		if err == nil {
			if _, err := os.Stat(defaultPath); os.IsNotExist(err) {
				_, _ = config.WriteExample("", false)
			}
		}

		// 2. Load config
		cfg, err := config.Load("")
		if err != nil {
			emitError("配置加载失败: " + err.Error())
			return
		}
		if strings.TrimSpace(cfg.LocalAuthToken) == "" {
			token, err := generateLocalAuthToken()
			if err != nil {
				emitError("认证令牌生成失败: " + err.Error())
				return
			}
			cfg.LocalAuthToken = token
			if err := cfg.Save(defaultPath); err != nil {
				emitError("认证令牌保存失败: " + err.Error())
				return
			}
		}

		// 3. Create server
		srv, err := proxy.New(cfg, &Assets)
		if err != nil {
			emitError("代理创建失败: " + err.Error())
			return
		}
		if prefs, err := preferences.Load(""); err == nil {
			srv.ConfigureHistoryLog(prefs.LogEnabled, prefs.LogDirectory, prefs.LogRetentionDays)
		} else {
			log.Println("[GUI proxy] preferences load error:", err)
		}
		srv.SetConfigPath(defaultPath)

		// ── 初始化 Hub 同步 ──
		homeDir, _ := os.UserHomeDir()
		dataDir := filepath.Join(homeDir, ".ocgt")

		// 创建同步计数器
		counters := hub.NewSyncCounters(dataDir)
		srv.SetHubCounters(counters)

		// 读取 Hub 配置
		hubPrefs, hubErr := preferences.Load("")
		if hubErr == nil && hubPrefs.HubEnabled {
			// 读取密钥（独立文件，不写入 preferences.json）
			hubSecret := hubPrefs.HubSecret
			if hubSecret == "" {
				secretPath := filepath.Join(dataDir, "hub-secret")
				if secretData, err := os.ReadFile(secretPath); err == nil {
					hubSecret = strings.TrimSpace(string(secretData))
				}
			}

			// 无远程 Hub URL 时启动内嵌 Hub 服务器
			if hubPrefs.HubURL == "" {
				if hubSecret == "" {
					secretPath := filepath.Join(dataDir, "hub-secret")
					if secretData, err := os.ReadFile(secretPath); err == nil {
						hubSecret = strings.TrimSpace(string(secretData))
					}
				}

				hubSrv, err := hub.NewHubServer(hub.ServerOption{
					Port:    hub.DefaultHubPort,
					Host:    "0.0.0.0",
					Secret:  hubSecret,
					DataDir: dataDir,
				})
				if err == nil {
					go func() {
						if err := hubSrv.Start(); err != nil {
							log.Println("[hub] 内嵌 Hub 停止:", err)
							return
						}
						log.Println("[hub] 内嵌 Hub 启动于", hubSrv.Addr())
					}()
				}
			} else {
				// 有远程 Hub URL，创建并启动同步客户端
				hubClient, err := hub.NewClient(hub.Config{
					Enabled:         hubPrefs.HubEnabled,
					HubURL:          hubPrefs.HubURL,
					Secret:          hubSecret,
					DeviceName:      hubPrefs.HubDeviceName,
					PushIntervalSec: hubPrefs.HubPushIntervalSec,
				}, counters, version.Version, dataDir)
				if err == nil {
					hubClient.Start()
					srv.SetHubClient(hubClient)
				}
			}
		}

		a.srv = srv
		if errStr := a.SyncConfiguredIntegrations(); errStr != "success" {
			log.Println("[GUI proxy] integration resync error:", errStr)
		}

		// 4. Listen and Serve with cancellation context
		proxyCtx, cancel := context.WithCancel(context.Background())
		a.cancelFunc = cancel

		log.Println("[GUI proxy] starting background proxy server on http://" + cfg.Listen)
		if err := srv.ListenAndServe(proxyCtx); err != nil {
			emitError("代理停止: " + err.Error())
		}
	}()
}

func generateLocalAuthToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// domReady is called when the frontend DOM is fully loaded and ready.
func (a *App) domReady(ctx context.Context) {
	a.ctx = ctx
	// Force the main window to be shown, unminimized, centered and focused on startup
	a.showMainWindow(true)

	// Initialize the system tray after the Wails WebView2 is fully loaded.
	// A short delay prevents Windows message pump race conditions on startup.
	// Note: setupSystray uses systray.Run() which manages its own dedicated
	// OS thread — no LockOSThread needed here.
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.setupSystray()
	}()
}

// shutdown is called when the app closes
func (a *App) shutdown(ctx context.Context) {
	// Signal menu click listener goroutine to exit
	close(a.quitCh)
	// Quit systray if supported
	a.quitSystray()
	if a.cancelFunc != nil {
		log.Println("[GUI proxy] shutting down background proxy server...")
		a.cancelFunc()
	}
}

// GetListenAddress returns the actual proxy listen address dynamically
