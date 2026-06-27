package hub

// Config 用户配置的 Hub 同步设置
type Config struct {
	Enabled         bool   `json:"enabled"`
	HubURL          string `json:"hubUrl"`
	Secret          string `json:"secret,omitempty"`
	DeviceName      string `json:"deviceName"`
	PushIntervalSec int    `json:"pushIntervalSec"` // 30-1800
}

// SyncPayload 设备推送到 Hub 的载荷
type SyncPayload struct {
	DeviceID    string      `json:"deviceId"`
	DisplayName string      `json:"displayName,omitempty"`
	Hostname    string      `json:"hostname,omitempty"`
	Platform    string      `json:"platform,omitempty"`
	Version     string      `json:"version,omitempty"`
	UpdatedAt   string      `json:"updatedAt"`
	Today       PeriodStats `json:"today"`
	Month       PeriodStats `json:"month"`
	AllTime     PeriodStats `json:"allTime"`
}

// PeriodStats 单个时间段的聚合统计数据
type PeriodStats struct {
	TotalTokens       int64               `json:"totalTokens"`
	EstimatedCost     float64             `json:"estimatedCost"`
	InputTokens       int64               `json:"inputTokens"`
	OutputTokens      int64               `json:"outputTokens"`
	CacheReadTokens   int64               `json:"cacheReadTokens"`
	CacheCreateTokens int64               `json:"cacheCreateTokens"`
	ByModel           map[string]DimStats `json:"byModel,omitempty"`
	ByRoute           map[string]DimStats `json:"byRoute,omitempty"`
	ByClient          map[string]DimStats `json:"byClient,omitempty"`
}

// DimStats 按某个维度（model/route/client）拆分的统计数据
type DimStats struct {
	Tokens       int64   `json:"tokens"`
	Cost         float64 `json:"cost"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
}

// ── Hub 服务器端存储 ──

// HubStore Hub 服务器上的完整数据存储结构
type HubStore struct {
	Version int                     `json:"version"`
	SavedAt string                  `json:"savedAt"`
	Devices map[string]DeviceRecord `json:"devices"`
}

// DeviceRecord Hub 服务器上单台设备的记录
type DeviceRecord struct {
	DeviceID    string                 `json:"deviceId"`
	DisplayName string                 `json:"displayName,omitempty"`
	Hostname    string                 `json:"hostname,omitempty"`
	Platform    string                 `json:"platform,omitempty"`
	Version     string                 `json:"version,omitempty"`
	UpdatedAt   string                 `json:"updatedAt"`
	ReceivedAt  string                 `json:"receivedAt"`
	Periods     map[string]PeriodStats `json:"periods"`
}

const (
	PeriodToday   = "today"
	PeriodMonth   = "month"
	PeriodAllTime = "allTime"

	DefaultPushIntervalSec = 120
	MinPushIntervalSec     = 30
	MaxPushIntervalSec     = 1800
	DefaultStaleAfterMs    = 10 * 60 * 1000
	DefaultHubPort         = 17321
)
