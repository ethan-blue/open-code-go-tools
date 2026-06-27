//go:build darwin

package main

func (a *App) setupSystray() {
	// No-op on macOS to avoid duplicate symbol conflicts between Wails and getlantern/systray
}

func (a *App) quitSystray() {
	// No-op
}
