package proxy

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

const maxProviderBodySize = 1 << 20 // 1 MiB

// ensureStore lazily initializes the provider store (thread-safe via sync.Once).
func (s *Server) ensureStore() *providers.Store {
	s.storeOnce.Do(func() {
		s.providerStore = providers.NewStore(s.configDir)
		if err := s.providerStore.Load(); err != nil {
			log.Printf("providers: load error: %v", err)
		}
	})
	return s.providerStore
}

// apiProvidersList handles GET /ocgt/api/providers
func (s *Server) apiProvidersList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	store := s.ensureStore()

	// Mask API keys for response
	list := store.List()
	for i := range list {
		list[i].APIKey = providers.MaskAPIKey(list[i].APIKey)
	}

	writeJSON(w, http.StatusOK, map[string]any{"providers": list})
}

// apiProvidersCreate handles POST /ocgt/api/providers
func (s *Server) apiProvidersCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var p providers.Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&p); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if p.Name == "" || p.BaseURL == "" {
		http.Error(w, "Name and baseUrl are required", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Create(p); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

// apiProvidersUpdate handles PUT /ocgt/api/providers/{id}
func (s *Server) apiProvidersUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	if id == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	var p providers.Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&p); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Update(id, p); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// apiProvidersDelete handles DELETE /ocgt/api/providers/{id}
func (s *Server) apiProvidersDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	if id == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Delete(id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// apiProvidersToggle handles PATCH /ocgt/api/providers/{id}/toggle
func (s *Server) apiProvidersToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from path: /ocgt/api/providers/{id}/toggle
	path := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	path = strings.TrimSuffix(path, "/toggle")
	if path == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	enabled, err := store.Toggle(path)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled})
}

// apiProvidersSort handles POST /ocgt/api/providers/sort
func (s *Server) apiProvidersSort(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.SaveOrder(req.IDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// registerProvidersRoutes registers all provider API routes.
func (s *Server) registerProvidersRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ocgt/api/providers/sort", s.apiProvidersSort)
	mux.HandleFunc("/ocgt/api/providers", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.apiProvidersList(w, r)
		case http.MethodPost:
			s.apiProvidersCreate(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/ocgt/api/providers/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
		if strings.HasSuffix(path, "/toggle") {
			s.apiProvidersToggle(w, r)
			return
		}
		switch r.Method {
		case http.MethodPut:
			s.apiProvidersUpdate(w, r)
		case http.MethodDelete:
			s.apiProvidersDelete(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
