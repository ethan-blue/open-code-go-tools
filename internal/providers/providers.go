package providers

import (
	crypto_rand "crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
)

// Provider represents an upstream API provider configuration.
type Provider struct {
	ID                    string            `json:"id"`
	Name                  string            `json:"name"`
	BaseURL               string            `json:"baseUrl"`
	APIKey                string            `json:"apiKey,omitempty"`
	Models                []string          `json:"models,omitempty"`
	DefaultModel          string            `json:"defaultModel,omitempty"`
	MessageModels         []string          `json:"messageModels,omitempty"`
	FallbackChain         []string          `json:"fallbackChain,omitempty"` // Models to retry on failure, in order
	Priority              int               `json:"priority"`
	Enabled               bool              `json:"enabled"`
	Health                string            `json:"health"` // "healthy", "degraded", "down", "unknown"
	LastCheck             string            `json:"lastCheck,omitempty"`
	RequestCount          int64             `json:"requestCount"`
	ErrorCount            int64             `json:"errorCount"`
	AvgLatency            float64           `json:"avgLatency"`
	CreatedAt             int64             `json:"createdAt"`
	SortIndex             int               `json:"sortIndex,omitempty"`
	Line                  string            `json:"line,omitempty"`
	Protocol              string            `json:"protocol,omitempty"`
	RateLimitPerSecond    int               `json:"rateLimitPerSecond,omitempty"`
	RateLimitBurst        int               `json:"rateLimitBurst,omitempty"`
	RequestTimeoutSeconds int               `json:"requestTimeoutSeconds,omitempty"`
	ThinkingBudgetTokens  int               `json:"thinkingBudgetTokens,omitempty"`
	AuthMode              string            `json:"authMode,omitempty"`
	ModelAliases          map[string]string `json:"modelAliases,omitempty"`
	Headers               map[string]string `json:"headers,omitempty"`
	Env                   map[string]string `json:"env,omitempty"`
}

// Store manages provider CRUD operations with file-backed persistence.
type Store struct {
	mu        sync.RWMutex
	path      string
	Providers []Provider `json:"providers"`
}

// NewStore creates a new provider store backed by the given file path.
func NewStore(configDir string) *Store {
	return &Store{
		path: filepath.Join(configDir, "providers.json"),
	}
}

// Load reads providers from disk. Returns empty store if file doesn't exist.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.Providers = []Provider{}
			return nil
		}
		return fmt.Errorf("providers: read %s: %w", s.path, err)
	}

	var stored struct {
		Providers []Provider `json:"providers"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		return fmt.Errorf("providers: parse %s: %w", s.path, err)
	}
	s.Providers = stored.Providers
	if s.Providers == nil {
		s.Providers = []Provider{}
	}
	return nil
}

// save writes providers to disk atomically (caller must hold s.mu).
func (s *Store) save() error {
	data, err := json.MarshalIndent(struct {
		Providers []Provider `json:"providers"`
	}{Providers: s.Providers}, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(s.path, data, 0o644)
}

// List returns all providers sorted by sortIndex then priority.
func (s *Store) List() []Provider {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Provider, len(s.Providers))
	copy(out, s.Providers)
	sort.Slice(out, func(i, j int) bool {
		if out[i].SortIndex != out[j].SortIndex {
			return out[i].SortIndex < out[j].SortIndex
		}
		return out[i].Priority < out[j].Priority
	})
	return out
}

// Get returns a provider by ID.
func (s *Store) Get(id string) (*Provider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.Providers {
		if s.Providers[i].ID == id {
			return &s.Providers[i], nil
		}
	}
	return nil, fmt.Errorf("provider %q not found", id)
}

// Active returns the enabled provider for a line.
func (s *Store) Active(line string) (*Provider, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	line = strings.TrimSpace(line)
	if line == "" {
		line = "claude"
	}
	for i := range s.Providers {
		if providerLine(s.Providers[i]) == line && s.Providers[i].Enabled {
			p := s.Providers[i]
			return &p, true
		}
	}
	return nil, false
}

// HasLine reports whether any provider exists for the given line.
func (s *Store) HasLine(line string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	line = strings.TrimSpace(line)
	if line == "" {
		line = "claude"
	}
	for _, p := range s.Providers {
		if providerLine(p) == line {
			return true
		}
	}
	return false
}

// Create adds a new provider.
func (s *Store) Create(p Provider) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Generate ID if empty
	if p.ID == "" {
		p.ID = generateID()
	}
	p.CreatedAt = time.Now().UnixMilli()
	if p.Health == "" {
		p.Health = "unknown"
	}

	// Check for duplicate ID
	for _, existing := range s.Providers {
		if existing.ID == p.ID {
			return fmt.Errorf("provider %q already exists", p.ID)
		}
	}
	if p.Enabled {
		s.disableLineLocked(providerLine(p), p.ID)
	}

	s.Providers = append(s.Providers, p)
	return s.save()
}

// isMaskedKey returns true if the key is empty, a placeholder, or a masked value
// that should not overwrite the real key.
func isMaskedKey(key string) bool {
	if key == "" {
		return true
	}
	if key == "****" || key == "***" {
		return true
	}
	if strings.Contains(key, "...") {
		return true
	}
	// Check star-mask shape: starts and ends with real chars, middle is all stars
	if len(key) > 8 {
		starCount := 0
		for _, c := range key[4 : len(key)-4] {
			if c == '*' {
				starCount++
			}
		}
		if starCount == len(key)-8 {
			return true
		}
	}
	return false
}

// Update modifies an existing provider.
func (s *Store) Update(id string, p Provider) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.Providers {
		if s.Providers[i].ID == id {
			// Preserve immutable fields
			p.ID = id
			p.CreatedAt = s.Providers[i].CreatedAt
			p.RequestCount = s.Providers[i].RequestCount
			p.ErrorCount = s.Providers[i].ErrorCount
			p.AvgLatency = s.Providers[i].AvgLatency
			p.Health = s.Providers[i].Health
			p.LastCheck = s.Providers[i].LastCheck
			p.SortIndex = s.Providers[i].SortIndex
			// Preserve real API key when incoming key is masked/empty
			if isMaskedKey(p.APIKey) {
				p.APIKey = s.Providers[i].APIKey
			}
			if p.Enabled {
				s.disableLineLocked(providerLine(p), id)
			}
			s.Providers[i] = p
			return s.save()
		}
	}
	return fmt.Errorf("provider %q not found", id)
}

// Delete removes a provider by ID.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.Providers {
		if s.Providers[i].ID == id {
			s.Providers = append(s.Providers[:i], s.Providers[i+1:]...)
			return s.save()
		}
	}
	return fmt.Errorf("provider %q not found", id)
}

// Activate enables one provider and disables its siblings on the same line.
func (s *Store) Activate(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	activeLine := "claude"
	for i := range s.Providers {
		if s.Providers[i].ID == id {
			activeLine = providerLine(s.Providers[i])
			break
		}
	}
	found := false
	for i := range s.Providers {
		if s.Providers[i].ID == id {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("provider %q not found", id)
	}
	s.disableLineLocked(activeLine, id)
	return s.save()
}

func providerLine(p Provider) string {
	if p.Line == "" {
		return "claude"
	}
	return p.Line
}

func (s *Store) disableLineLocked(line, exceptID string) {
	for i := range s.Providers {
		if providerLine(s.Providers[i]) == line {
			s.Providers[i].Enabled = s.Providers[i].ID == exceptID
		}
	}
}

// SaveOrder persists a new sort order for providers.
func (s *Store) SaveOrder(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	// Assign sortIndex based on order
	for idx, id := range ids {
		for i := range s.Providers {
			if s.Providers[i].ID == id {
				s.Providers[i].SortIndex = idx
				break
			}
		}
	}

	// Assign high sortIndex to providers not in the order list
	maxIdx := len(ids)
	for i := range s.Providers {
		if !idSet[s.Providers[i].ID] {
			s.Providers[i].SortIndex = maxIdx
			maxIdx++
		}
	}

	return s.save()
}

// UpdateHealth updates the health status and metrics for a provider and persists to disk.
func (s *Store) UpdateHealth(id string, health string, latency float64, isError bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.Providers {
		if s.Providers[i].ID == id {
			s.Providers[i].Health = health
			s.Providers[i].LastCheck = time.Now().Format(time.RFC3339)
			s.Providers[i].RequestCount++
			if isError {
				s.Providers[i].ErrorCount++
			}
			// Exponential moving average for latency
			if s.Providers[i].AvgLatency == 0 {
				s.Providers[i].AvgLatency = latency
			} else {
				s.Providers[i].AvgLatency = 0.8*s.Providers[i].AvgLatency + 0.2*latency
			}
			// Persist health updates to disk
			_ = s.save()
			break
		}
	}
}

// generateID creates a cryptographically random hex ID.
func generateID() string {
	b := make([]byte, 8)
	if _, err := crypto_rand.Read(b); err != nil {
		// Fallback to time-based if crypto/rand fails (should never happen)
		for i := range b {
			b[i] = byte(time.Now().UnixNano() >> (8 * i))
		}
	}
	return fmt.Sprintf("%x", b)
}

// MaskAPIKey returns a masked version of the API key for display.
func MaskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return strings.Repeat("*", len(key))
	}
	return key[:4] + strings.Repeat("*", len(key)-8) + key[len(key)-4:]
}
