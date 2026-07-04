//go:build windows

package procutil

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// HideConsole prevents a child process from flashing a console window when
// the parent is a GUI (-H windowsgui) binary. Must be called before Start/Run.
func HideConsole(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
