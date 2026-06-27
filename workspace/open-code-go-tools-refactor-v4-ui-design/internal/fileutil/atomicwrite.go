package fileutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// AtomicWriteFile writes data to a file atomically by writing to a temporary
// file in the same directory first, then renaming it to the target path.
// This prevents partial writes and ensures the file is either fully old or
// fully new, even if the process crashes or another process is reading.
//
// On Windows, os.Rename is atomic when source and destination are on the same volume.
// On Unix, rename(2) is guaranteed atomic by POSIX when both paths are on the same filesystem.
//
// NOTE: This does NOT prevent TOCTOU race conditions on read-modify-write patterns.
// It only ensures atomicity of the write itself. For true mutual exclusion,
// file locking would be needed (e.g., syscall.Flock on Unix, LockFileEx on Windows).
func AtomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)

	// Create temp file in the same directory as the target (required for atomic rename)
	tmp, err := os.CreateTemp(dir, ".atomic-*")
	if err != nil {
		return fmt.Errorf("atomic write: create temp file: %w", err)
	}
	tmpPath := tmp.Name()

	// Clean up temp file on any error
	defer func() {
		if err != nil {
			os.Remove(tmpPath)
		}
	}()

	// Set permissions before writing content
	if err = os.Chmod(tmpPath, perm); err != nil {
		tmp.Close()
		return fmt.Errorf("atomic write: chmod temp file: %w", err)
	}

	// Write content
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("atomic write: write temp file: %w", err)
	}

	// Sync to ensure data hits disk before rename
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("atomic write: sync temp file: %w", err)
	}

	if err = tmp.Close(); err != nil {
		return fmt.Errorf("atomic write: close temp file: %w", err)
	}

	// Atomic rename
	if err = os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("atomic write: rename temp file: %w", err)
	}

	return nil
}
