//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const (
	hwndBroadcast      = 0xffff
	wmSettingChange    = 0x001A
	smtoAbortIfHung    = 0x0002
	environmentMessage = "Environment"
)

var (
	user32                 = syscall.NewLazyDLL("user32.dll")
	procSendMessageTimeout = user32.NewProc("SendMessageTimeoutW")
)

func setWindowsUserEnvironment(name, value string) error {
	return setWindowsUserEnvironmentBatch(map[string]string{name: value})
}

func setWindowsUserEnvironmentBatch(values map[string]string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	for name, value := range values {
		if err := key.SetStringValue(name, value); err != nil {
			return err
		}
	}
	broadcastEnvironmentChange()
	return nil
}

func unsetWindowsUserEnvironment(name string) error {
	return unsetWindowsUserEnvironmentBatch([]string{name})
}

func unsetWindowsUserEnvironmentBatch(names []string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	changed := false
	for _, name := range names {
		err := key.DeleteValue(name)
		if err == nil {
			changed = true
			continue
		}
		if err != registry.ErrNotExist {
			return err
		}
	}
	if changed {
		broadcastEnvironmentChange()
	}
	return nil
}

func getWindowsUserEnvironment(name string) (string, bool) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer key.Close()

	value, _, err := key.GetStringValue(name)
	if err != nil {
		return "", false
	}
	return value, true
}

func broadcastEnvironmentChange() {
	msg, err := syscall.UTF16PtrFromString(environmentMessage)
	if err != nil {
		return
	}
	procSendMessageTimeout.Call(
		uintptr(hwndBroadcast),
		uintptr(wmSettingChange),
		0,
		uintptr(unsafe.Pointer(msg)),
		uintptr(smtoAbortIfHung),
		uintptr(1000),
		0,
	)
}
