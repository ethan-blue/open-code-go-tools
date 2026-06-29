package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthMiddleware_AllowsStaticAssetsWithoutToken(t *testing.T) {
	var hit bool
	handler := authMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/assets/app.css", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !hit {
		t.Fatal("expected static asset request to reach next handler")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_StillProtectsAPI(t *testing.T) {
	handler := authMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/ocgt/api/status", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
