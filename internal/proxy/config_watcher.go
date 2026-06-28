package proxy

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

// watchConfig polls the config file for changes every 3 seconds.
// TODO: Consider using fsnotify for event-driven watching instead of polling.
// This would reduce latency and CPU usage, but would add a dependency.
// Current implementation works correctly and is simpler to maintain.
func (s *Server) watchConfig(ctx context.Context) {
	if s.configPath == "" {
		return
	}

	var lastModTime time.Time
	if info, err := os.Stat(s.configPath); err == nil {
		lastModTime = info.ModTime()
	}

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(s.configPath)
			if err != nil {
				continue
			}
			if info.ModTime().After(lastModTime) {
				lastModTime = info.ModTime()
				cfg, err := config.Load(s.configPath)
				if err != nil {
					log.Printf("ocgt: config reload error: %v", err)
				} else {
					s.ApplyConfig(cfg)
					log.Printf("ocgt: config hot-reloaded from %s", s.configPath)
				}
			}
		}
	}
}
