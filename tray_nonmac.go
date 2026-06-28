//go:build !darwin

package main

import (
	"runtime"

	"github.com/getlantern/systray"
)

func (a *App) setupSystray() {
	a.setupTrayOnce.Do(func() {
		onReady := func() {
			if runtime.GOOS == "windows" {
				systray.SetIcon(appIconIco)
			} else {
				systray.SetIcon(appIconPng)
			}

			systray.SetTitle("ocgt")
			systray.SetTooltip("ocgt 控制面板 / Control Panel")

			mShow := systray.AddMenuItem("显示控制面板 / Show Panel", "显示主窗口 / Show Main Window")
			mHide := systray.AddMenuItem("隐藏控制面板 / Hide Panel", "隐藏主窗口 / Hide to Tray")
			mSettings := systray.AddMenuItem("打开设置 / Open Settings", "打开设置页面 / Open Settings Page")
			mAbout := systray.AddMenuItem("关于 ocgt / About", "关于此程序 / About App")
			systray.AddSeparator()
			mQuit := systray.AddMenuItem("退出程序 / Quit", "彻底退出代理服务 / Quit Application")

			go func() {
				for {
					select {
					case <-mShow.ClickedCh:
						a.enqueueTrayAction(trayActionShow)
					case <-mHide.ClickedCh:
						a.enqueueTrayAction(trayActionHide)
					case <-mSettings.ClickedCh:
						a.enqueueTrayAction(trayActionSettings)
					case <-mAbout.ClickedCh:
						a.enqueueTrayAction(trayActionAbout)
					case <-mQuit.ClickedCh:
						a.enqueueTrayAction(trayActionQuit)
					case <-a.quitCh:
						return
					}
				}
			}()
		}

		onExit := func() {}
		if runtime.GOOS == "windows" {
			go systray.Run(onReady, onExit)
			return
		}
		go systray.Run(onReady, onExit)
	})
}

func (a *App) quitSystray() {
	systray.Quit()
}
