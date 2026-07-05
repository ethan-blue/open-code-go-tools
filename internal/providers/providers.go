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

// Account is a single credential inside a provider's account pool. The proxy
// rotates across accounts on failure (429 / auth errors / persistent 5xx),
// which lets several OpenCode Go subscriptions back one provider entry.
type Account struct {
	ID               string `json:"id"`
	Label            string `json:"label,omitempty"`
	APIKey           string `json:"apiKey"`
	QuotaCookie      string `json:"quotaCookie,omitempty"`      // per-account opencode.ai session cookie for quota display
	QuotaWorkspaceID string `json:"quotaWorkspaceId,omitempty"` // per-account workspace id (wrk_xxx), optional
	Disabled         bool   `json:"disabled,omitempty"`         // excluded from rotation when true
}

// Provider represents an upstream API provider configuration.
type Provider struct {
	ID                    string            `json:"id"`
	Name                  string            `json:"name"`
	BaseURL               string            `json:"baseUrl"`
	APIKey                string            `json:"apiKey,omitempty"` // legacy single key; superseded by Accounts when non-empty
	Accounts              []Account         `json:"accounts,omitempty"`
	Models                []string          `json:"models,omitempty"`
	DefaultModel          string            `json:"defaultModel,omitempty"`
	MessageModels         []string          `json:"messageModels,omitempty"`
	FallbackChain         []string          `json:"fallbackChain,omitempty"` // Models to retry on failure, in order
	Enabled               bool              `json:"enabled"`
	CreatedAt             int64             `json:"createdAt"`
	SortIndex             int               `json:"sortIndex,omitempty"`
	Line                  string            `json:"line,omitempty"`
	Protocol              string            `json:"protocol,omitempty"`
	RequestTimeoutSeconds int               `json:"requestTimeoutSeconds,omitempty"`
	ThinkingBudgetTokens  int               `json:"thinkingBudgetTokens,omitempty"`
	AuthMode              string            `json:"authMode,omitempty"`
	ModelAliases          map[string]string `json:"modelAliases,omitempty"`
	ModelProtocols        map[string]string `json:"modelProtocols,omitempty"`
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
	// Legacy migration: fold a single-key provider into a one-account pool so
	// the rotation engine has a uniform view. Persisting is deferred until the
	// next save — Load stays read-only.
	for i := range s.Providers {
		migrateLegacyAccounts(&s.Providers[i])
	}
	return nil
}

// migrateLegacyAccounts synthesizes Accounts from the legacy single APIKey and
// guarantees every account has an ID.
func migrateLegacyAccounts(p *Provider) {
	if len(p.Accounts) == 0 && strings.TrimSpace(p.APIKey) != "" {
		p.Accounts = []Account{{ID: "acc-primary", APIKey: p.APIKey}}
	}
	for i := range p.Accounts {
		if strings.TrimSpace(p.Accounts[i].ID) == "" {
			p.Accounts[i].ID = generateID()
		}
	}
}

// EnabledAccounts returns the accounts eligible for rotation, in priority
// order. Falls back to a pseudo-account wrapping the legacy APIKey so callers
// never need to special-case old configs.
func (p Provider) EnabledAccounts() []Account {
	out := make([]Account, 0, len(p.Accounts))
	for _, acc := range p.Accounts {
		if !acc.Disabled && strings.TrimSpace(acc.APIKey) != "" {
			out = append(out, acc)
		}
	}
	if len(out) == 0 && strings.TrimSpace(p.APIKey) != "" {
		out = append(out, Account{ID: "acc-primary", APIKey: p.APIKey})
	}
	return out
}

// HasCredential reports whether the provider carries at least one usable API key.
func (p Provider) HasCredential() bool {
	return len(p.EnabledAccounts()) > 0
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

// List returns all providers sorted by sortIndex.
func (s *Store) List() []Provider {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Provider, len(s.Providers))
	copy(out, s.Providers)
	sort.Slice(out, func(i, j int) bool {
		return out[i].SortIndex < out[j].SortIndex
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
	migrateLegacyAccounts(&p)

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

func IsMaskedKey(key string) bool {
	return isMaskedKey(key)
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
			p.SortIndex = s.Providers[i].SortIndex
			// Preserve real API key when incoming key is masked/empty
			if isMaskedKey(p.APIKey) {
				p.APIKey = s.Providers[i].APIKey
			}
			p.Accounts = mergeAccountSecrets(p.Accounts, s.Providers[i].Accounts)
			// The account pool is the source of truth: keep the legacy single
			// key mirroring the primary account so old readers stay correct,
			// and treat an explicitly emptied pool as "remove all credentials".
			if len(p.Accounts) > 0 {
				p.APIKey = p.Accounts[0].APIKey
			} else if p.Accounts != nil {
				p.APIKey = ""
			}
			migrateLegacyAccounts(&p)
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

// mergeAccountSecrets restores real secrets for incoming accounts whose values
// are masked round-trips from the UI. Keys: masked or empty → keep existing.
// Quota cookies: masked → keep existing; empty → explicit clear.
func mergeAccountSecrets(incoming, existing []Account) []Account {
	if len(incoming) == 0 {
		return incoming
	}
	byID := make(map[string]Account, len(existing))
	for _, acc := range existing {
		byID[acc.ID] = acc
	}
	for i := range incoming {
		prev, ok := byID[incoming[i].ID]
		if !ok {
			continue
		}
		if isMaskedKey(incoming[i].APIKey) {
			incoming[i].APIKey = prev.APIKey
		}
		if incoming[i].QuotaCookie != "" && isMaskedKey(incoming[i].QuotaCookie) {
			incoming[i].QuotaCookie = prev.QuotaCookie
		}
	}
	return incoming
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

// MaskProviderSecrets returns a copy of the provider with every secret
// (legacy key, account keys, quota cookies) masked for API responses.
func MaskProviderSecrets(p Provider) Provider {
	p.APIKey = MaskAPIKey(p.APIKey)
	if len(p.Accounts) > 0 {
		accounts := make([]Account, len(p.Accounts))
		copy(accounts, p.Accounts)
		for i := range accounts {
			accounts[i].APIKey = MaskAPIKey(accounts[i].APIKey)
			accounts[i].QuotaCookie = MaskAPIKey(accounts[i].QuotaCookie)
		}
		p.Accounts = accounts
	}
	return p
}
