package proxy

import (
	"io/fs"
	"net/http"
	"strings"
)

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if s.webAssets == nil {
		http.Error(w, "Web assets not available", http.StatusNotFound)
		return
	}

	subFS, err := fs.Sub(*s.webAssets, "frontend")
	if err != nil {
		http.Error(w, "Internal asset error", http.StatusInternalServerError)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	// Only fallback to index.html for non-API routes if the file doesn't exist (client-side routing)
	if !strings.HasPrefix(path, "v1/") && !strings.HasPrefix(path, "ocgt/") {
		_, err = subFS.Open(path)
		if err != nil {
			r.URL.Path = "/"
		}
	}

	http.FileServer(http.FS(subFS)).ServeHTTP(w, r)
}
