package proxy

import (
	"net/http"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

type requestTarget struct {
	line           string
	name           string
	upstream       string
	profile        config.Profile
	timeoutSeconds int
	thinkingBudget int
	protocol       string
}

func (s *Server) runtimeTargetForRequest(r *http.Request) (requestTarget, error) {
	line := requestLineFromRequest(r)
	requestedProfile := requestedProfileName(r)

	s.configMu.RLock()
	activeProfile := s.config.ActiveProfile
	fallbackProfile, fallbackName, err := s.config.Profile("")
	upstream := s.config.Upstream
	timeoutSeconds := s.config.RequestTimeoutSeconds
	thinkingBudget := s.config.ThinkingBudgetTokens()
	s.configMu.RUnlock()
	if err != nil {
		return requestTarget{}, err
	}

	if requestedProfile != "" && requestedProfile != activeProfile {
		s.configMu.RLock()
		profile, name, err := s.config.Profile(requestedProfile)
		s.configMu.RUnlock()
		if err != nil {
			return requestTarget{}, err
		}
		return requestTarget{
			line:           line,
			name:           name,
			upstream:       upstream,
			profile:        profile,
			timeoutSeconds: timeoutSeconds,
			thinkingBudget: thinkingBudget,
		}, nil
	}

	if strings.TrimSpace(s.configDir) != "" {
		store := s.ensureStore()
		if provider, ok := store.Active(line); ok {
			return targetFromProvider(*provider, fallbackProfile, upstream, line, timeoutSeconds, thinkingBudget), nil
		}
	}

	return requestTarget{
		line:           line,
		name:           fallbackName,
		upstream:       upstream,
		profile:        fallbackProfile,
		timeoutSeconds: timeoutSeconds,
		thinkingBudget: thinkingBudget,
	}, nil
}

func targetFromProvider(p providers.Provider, fallback config.Profile, fallbackUpstream, line string, defaultTimeout, defaultThinking int) requestTarget {
	// Start from the fallback profile (a static default under v4 — Profile("")
	// returns an empty config.Profile{} when no profile map is configured), then
	// overlay the provider's own fields. Provider fields win wherever set.
	profile := fallback
	if strings.TrimSpace(p.APIKey) != "" && !config.IsMaskedAPIKey(p.APIKey) {
		profile.APIKey = p.APIKey
	}
	if strings.TrimSpace(p.DefaultModel) != "" {
		profile.DefaultModel = strings.TrimSpace(p.DefaultModel)
	}
	if len(p.MessageModels) > 0 {
		profile.MessageModels = append([]string(nil), p.MessageModels...)
	}
	if len(p.FallbackChain) > 0 {
		profile.FallbackChain = append([]string(nil), p.FallbackChain...)
	}
	if len(p.ModelAliases) > 0 {
		profile.ModelAliases = copyStringMap(p.ModelAliases)
	}
	if len(p.Headers) > 0 {
		profile.Headers = copyStringMap(p.Headers)
	}
	if strings.TrimSpace(p.AuthMode) != "" {
		profile.AuthMode = p.AuthMode
	}
	if strings.TrimSpace(p.BaseURL) == "" {
		p.BaseURL = fallbackUpstream
	}
	timeoutSeconds := p.RequestTimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultTimeout
	}
	thinkingBudget := p.ThinkingBudgetTokens
	if thinkingBudget == 0 {
		thinkingBudget = defaultThinking
	}
	return requestTarget{
		line:           line,
		name:           p.ID,
		upstream:       p.BaseURL,
		profile:        profile,
		timeoutSeconds: timeoutSeconds,
		thinkingBudget: thinkingBudget,
		protocol:       strings.TrimSpace(p.Protocol),
	}
}

func requestLineFromRequest(r *http.Request) string {
	if line := strings.TrimSpace(r.Header.Get("X-Ocgt-Line")); line != "" {
		return strings.ToLower(line)
	}
	if line := strings.TrimSpace(r.URL.Query().Get("ocgt_line")); line != "" {
		return strings.ToLower(line)
	}
	switch r.URL.Path {
	case "/v1/chat/completions", "/v1/responses":
		return "codex"
	case "/v1/messages", "/v1/messages/count_tokens":
		return "claude"
	}
	if isClaudeDesktopRoute(r) {
		return "claude"
	}
	client := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Ocgt-Client")))
	if strings.Contains(client, "codex") {
		return "codex"
	}
	return "claude"
}

func requestedProfileName(r *http.Request) string {
	name := strings.TrimSpace(r.Header.Get("X-Ocgt-Profile"))
	if before, _, found := strings.Cut(name, ","); found {
		name = strings.TrimSpace(before)
	}
	if name == "" {
		name = strings.TrimSpace(r.URL.Query().Get("ocgt_profile"))
	}
	return name
}

func targetUsesMessagesEndpoint(target requestTarget, model string) bool {
	switch strings.ToLower(target.protocol) {
	case "anthropic":
		return true
	case "openai-chat", "openai-responses":
		return false
	}
	return target.profile.UsesMessagesEndpoint(model)
}

func copyStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func (s *Server) doUpstream(req *http.Request, timeoutSeconds int) (*http.Response, error) {
	client := s.clientSnapshot()
	if timeoutSeconds <= 0 {
		return client.Do(req)
	}
	timeout := time.Duration(timeoutSeconds) * time.Second
	if client.Timeout == timeout {
		return client.Do(req)
	}
	override := *client
	override.Timeout = timeout
	return override.Do(req)
}
