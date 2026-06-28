package hub

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ── 内置简化版价格估算（避免跨包循环依赖） ──

type hubModelPrice struct {
	InputPricePer1M  float64
	OutputPricePer1M float64
}

// hubPrices 简化版模型定价表，覆盖 Hub 同步中最常见的模型。
// 选用 kimi/qwen 等热门模型的典型价格作为 default 兜底。
var hubPrices = map[string]hubModelPrice{
	"deepseek-v4-flash": {InputPricePer1M: 0.3, OutputPricePer1M: 1.1},
	"deepseek-v4-pro":   {InputPricePer1M: 1.2, OutputPricePer1M: 4.0},
	"claude-sonnet-4-7": {InputPricePer1M: 3.0, OutputPricePer1M: 15.0},
	"kimi-k2.6":         {InputPricePer1M: 3.0, OutputPricePer1M: 15.0},
	"qwen3.6-plus":      {InputPricePer1M: 3.0, OutputPricePer1M: 15.0},
	"default":           {InputPricePer1M: 3.0, OutputPricePer1M: 15.0},
}

// hubEstimateCost 估算单次请求的费用（仅 input + output，不含缓存折扣）。
func hubEstimateCost(model string, inputTokens, outputTokens int64) float64 {
	price, ok := hubPrices[model]
	if !ok {
		price = hubPrices["default"]
	}
	inputCost := (float64(inputTokens) / 1_000_000) * price.InputPricePer1M
	outputCost := (float64(outputTokens) / 1_000_000) * price.OutputPricePer1M
	return inputCost + outputCost
}

// ── 快照持久化 ──

// countersSnapshot 写入磁盘的持久化快照结构。
type countersSnapshot struct {
	Version  int         `json:"version"`
	SavedAt  string      `json:"savedAt"`
	AllTime  PeriodStats `json:"allTime"`
	Month    PeriodStats `json:"month"`
	MonthKey string      `json:"monthKey"` // "2006-01"，用于检测跨月
}

const (
	countersSnapshotVersion = 1
	countersSnapshotFile    = "hub_counters.json"
)

// SyncCounters 内存同步计数器，按 model/route/client 三维累加。
//
// 自动感知日期/月份变更，重置对应时间段：
//   - today：日期变更（跨天）时自动清零
//   - month：月份变更（跨月）时自动清零
//   - allTime：永不重置
//
// allTime 和 month 会持久化到磁盘，进程重启后恢复。
// today 每次启动重新开始。
type SyncCounters struct {
	mu sync.RWMutex

	today   PeriodStats
	month   PeriodStats
	allTime PeriodStats

	todayDate string // "2006-01-02"，记录 today 所属日期
	monthKey  string // "2006-01"，记录 month 所属月份

	snapshotDir string // 持久化目录，推荐 ~/.ocgt/
}

// NewSyncCounters 创建并初始化计数器，从磁盘恢复持久化数据。
// snapshotDir 推荐为 ~/.ocgt/。
func NewSyncCounters(snapshotDir string) *SyncCounters {
	now := time.Now()
	sc := &SyncCounters{
		todayDate:   now.Format("2006-01-02"),
		monthKey:    now.Format("2006-01"),
		snapshotDir: snapshotDir,
		today: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
		month: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
		allTime: PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		},
	}
	sc.load()
	return sc
}

// Accumulate 累加一次 API 调用的计数到三个时间段（today / month / allTime）。
// 自动检测日期和月份变更，重置对应的统计周期。
func (sc *SyncCounters) Accumulate(model, route, client string, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens int64) {
	totalTokens := inputTokens + outputTokens + cacheCreateTokens
	cost := hubEstimateCost(model, inputTokens, outputTokens)

	sc.mu.Lock()
	defer sc.mu.Unlock()

	now := time.Now()
	todayDate := now.Format("2006-01-02")
	mkey := now.Format("2006-01")

	// 日期变更 → 重置 today
	if todayDate != sc.todayDate {
		sc.today = PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		}
		sc.todayDate = todayDate
	}

	// 月份变更 → 重置 month
	if mkey != sc.monthKey {
		sc.month = PeriodStats{
			ByModel:  make(map[string]DimStats),
			ByRoute:  make(map[string]DimStats),
			ByClient: make(map[string]DimStats),
		}
		sc.monthKey = mkey
	}

	accumulatePeriod(&sc.today, model, route, client, totalTokens, cost, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens)
	accumulatePeriod(&sc.month, model, route, client, totalTokens, cost, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens)
	accumulatePeriod(&sc.allTime, model, route, client, totalTokens, cost, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens)
}

// accumulatePeriod 将单次请求的计数累加到指定的 PeriodStats 上。
func accumulatePeriod(p *PeriodStats, model, route, client string, totalTokens int64, cost float64, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens int64) {
	p.TotalTokens += totalTokens
	p.EstimatedCost += cost
	p.InputTokens += inputTokens
	p.OutputTokens += outputTokens
	p.CacheReadTokens += cacheReadTokens
	p.CacheCreateTokens += cacheCreateTokens

	if p.ByModel == nil {
		p.ByModel = make(map[string]DimStats)
	}
	addDim(p.ByModel, model, totalTokens, cost, inputTokens, outputTokens)

	if p.ByRoute == nil {
		p.ByRoute = make(map[string]DimStats)
	}
	addDim(p.ByRoute, route, totalTokens, cost, inputTokens, outputTokens)

	if p.ByClient == nil {
		p.ByClient = make(map[string]DimStats)
	}
	addDim(p.ByClient, client, totalTokens, cost, inputTokens, outputTokens)
}

// addDim 更新某个维度（model/route/client）的累计统计。
func addDim(m map[string]DimStats, key string, totalTokens int64, cost float64, inputTokens, outputTokens int64) {
	if key == "" {
		key = "unknown"
	}
	d := m[key]
	d.Tokens += totalTokens
	d.Cost += cost
	d.InputTokens += inputTokens
	d.OutputTokens += outputTokens
	m[key] = d
}

// Today 返回当前日期计数快照。
func (sc *SyncCounters) Today() PeriodStats {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.today
}

// Month 返回当前月份计数快照。
func (sc *SyncCounters) Month() PeriodStats {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.month
}

// AllTime 返回全量计数快照。
func (sc *SyncCounters) AllTime() PeriodStats {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.allTime
}

// BuildPayload 构建推送到 Hub 服务器的完整载荷。
// 包含 device 标识信息和三个时间段的统计快照。
func (sc *SyncCounters) BuildPayload(deviceID, displayName, hostname, platform, version string) SyncPayload {
	sc.mu.RLock()
	defer sc.mu.RUnlock()

	return SyncPayload{
		DeviceID:    deviceID,
		DisplayName: displayName,
		Hostname:    hostname,
		Platform:    platform,
		Version:     version,
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
		Today:       sc.today,
		Month:       sc.month,
		AllTime:     sc.allTime,
	}
}

// ── 快照持久化 ──

// snapshotPath 返回快照文件的完整路径。
func (sc *SyncCounters) snapshotPath() string {
	return filepath.Join(sc.snapshotDir, countersSnapshotFile)
}

// Snapshot 将 allTime 和 month 持久化到磁盘。
// 使用原子写入（临时文件 + 重命名）防止写入过程中崩溃导致文件损坏。
func (sc *SyncCounters) Snapshot() error {
	sc.mu.RLock()
	snap := countersSnapshot{
		Version:  countersSnapshotVersion,
		SavedAt:  time.Now().UTC().Format(time.RFC3339),
		AllTime:  sc.allTime,
		Month:    sc.month,
		MonthKey: sc.monthKey,
	}
	sc.mu.RUnlock()

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("hub: marshal snapshot: %w", err)
	}

	path := sc.snapshotPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("hub: create snapshot dir: %w", err)
	}

	// 原子写入：先写临时文件，再 rename
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return fmt.Errorf("hub: write snapshot tmp: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath) // 清理临时文件
		return fmt.Errorf("hub: rename snapshot: %w", err)
	}

	return nil
}

// load 从磁盘恢复持久化数据。
// - allTime 无条件恢复
// - month 仅在月份匹配时恢复（否则按新月份重新开始）
// - today 不恢复，每次启动重新开始
func (sc *SyncCounters) load() {
	path := sc.snapshotPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return // 首次运行或文件不存在，保持默认空值
	}

	var snap countersSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return // 文件损坏，忽略
	}

	// allTime 无条件恢复
	sc.allTime = snap.AllTime
	if sc.allTime.ByModel == nil {
		sc.allTime.ByModel = make(map[string]DimStats)
	}
	if sc.allTime.ByRoute == nil {
		sc.allTime.ByRoute = make(map[string]DimStats)
	}
	if sc.allTime.ByClient == nil {
		sc.allTime.ByClient = make(map[string]DimStats)
	}

	// 月份匹配时才恢复 month，否则保持当前（新）月份的空值
	if snap.MonthKey == sc.monthKey {
		sc.month = snap.Month
	}
	if sc.month.ByModel == nil {
		sc.month.ByModel = make(map[string]DimStats)
	}
	if sc.month.ByRoute == nil {
		sc.month.ByRoute = make(map[string]DimStats)
	}
	if sc.month.ByClient == nil {
		sc.month.ByClient = make(map[string]DimStats)
	}
}
