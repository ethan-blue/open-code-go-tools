package proxy

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultHistoryLogRetentionDays = 14

func (s *Server) ConfigureHistoryLog(enabled bool, dir string, retentionDays int) {
	s.historyLogMu.Lock()
	defer s.historyLogMu.Unlock()
	s.historyLogEnabled = enabled
	s.historyLogDir = strings.TrimSpace(dir)
	if retentionDays < 0 {
		retentionDays = defaultHistoryLogRetentionDays
	}
	s.historyLogRetentionDays = retentionDays
	log.Printf("[history] ConfigureHistoryLog: enabled=%v dir=%q retention=%d", enabled, dir, retentionDays)
}

func (s *Server) persistHistoryEntry(entry requestLogEntry) {
	s.historyLogMu.Lock()
	defer s.historyLogMu.Unlock()
	if !s.historyLogEnabled || strings.TrimSpace(s.historyLogDir) == "" {
		return
	}
	if err := os.MkdirAll(s.historyLogDir, 0o700); err != nil {
		log.Printf("ocgt: failed to create history log directory: %v", err)
		return
	}
	s.cleanupHistoryLogsLocked(time.Now())
	path := filepath.Join(s.historyLogDir, "ocgt-"+entry.Time.Format("2006-01-02")+".jsonl")
	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("ocgt: failed to serialize history log entry: %v", err)
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		log.Printf("ocgt: failed to open history log file: %v", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(append(data, '\n')); err != nil {
		log.Printf("ocgt: failed to write history log entry: %v", err)
	}
}

func (s *Server) cleanupHistoryLogsLocked(now time.Time) {
	if s.historyLogRetentionDays <= 0 {
		return
	}
	if now.Sub(s.historyLogLastCleanup) < time.Hour {
		return
	}
	s.historyLogLastCleanup = now
	cutoff := now.AddDate(0, 0, -s.historyLogRetentionDays)
	entries, err := os.ReadDir(s.historyLogDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "ocgt-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(s.historyLogDir, name)); err != nil {
				log.Printf("ocgt: failed to remove old history log %s: %v", name, err)
			}
		}
	}
}
