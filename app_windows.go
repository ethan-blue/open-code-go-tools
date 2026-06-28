//go:build windows

package main

import (
	"unsafe"
)

var (
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procReleaseCapture      = user32.NewProc("ReleaseCapture")
	procGetCursorPos        = user32.NewProc("GetCursorPos")
)

const (
	wmNCLBUTTONDOWN = 0x00A1
	htCaption       = 2
)

func startWindowDragNative() {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return
	}
	procReleaseCapture.Call()
	procSendMessageW.Call(hwnd, wmNCLBUTTONDOWN, htCaption, 0)
}

func getMousePos() (x, y int) {
	type point struct {
		x, y int32
	}
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	return int(pt.x), int(pt.y)
}
