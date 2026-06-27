package hub

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Client Hub 同步客户端，负责向 Hub 推送本地统计数据并接收远程设备统计。
type Client struct {
	config      Config
	counters    *SyncCounters
	deviceID    string
	version     string
	httpClient  *http.Client
	ctx         context.Context
	cancel      context.CancelFunc
	pushTicker  *time.Ticker
	logger      *log.Logger
	dataDir     string
	remoteStats atomic.Value // 存储 map[string]any
	stopOnce    sync.Once
	pushMu      sync.Mutex
}

// NewClient 创建 Hub 同步客户端。
// cfg 为 Hub 配置；counters 为同步计数器实例；version 为当前应用版本号；dataDir 为存储设备 ID 等本地数据的目录。
func NewClient(cfg Config, counters *SyncCounters, version, dataDir string) (*Client, error) {
	if cfg.PushIntervalSec < MinPushIntervalSec || cfg.PushIntervalSec > MaxPushIntervalSec {
		return nil, fmt.Errorf("hub: PushIntervalSec %d out of range [%d, %d]",
			cfg.PushIntervalSec, MinPushIntervalSec, MaxPushIntervalSec)
	}

	deviceID := loadOrCreateDeviceID(dataDir)

	ctx, cancel := context.WithCancel(context.Background())

	rs := make(map[string]any)
	var rsAtomic atomic.Value
	rsAtomic.Store(rs)

	return &Client{
		config:      cfg,
		counters:    counters,
		deviceID:    deviceID,
		version:     version,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		ctx:         ctx,
		cancel:      cancel,
		logger:      log.New(os.Stderr, "[hub] ", log.LstdFlags),
		dataDir:     dataDir,
		remoteStats: rsAtomic,
	}, nil
}

// Start 启动定时推送和 SSE 监听。
// 如果 Hub 未启用或 URL 为空则直接返回无操作。
func (c *Client) Start() {
	if !c.config.Enabled || c.config.HubURL == "" {
		return
	}

	c.logger.Printf("sync started, pushing every %ds to %s", c.config.PushIntervalSec, c.config.HubURL)

	// 立即执行一次推送
	c.pushOnce()

	// 定时推送
	c.pushTicker = time.NewTicker(time.Duration(c.config.PushIntervalSec) * time.Second)
	go func() {
		for {
			select {
			case <-c.pushTicker.C:
				c.pushOnce()
			case <-c.ctx.Done():
				return
			}
		}
	}()

	// SSE 监听
	go c.listenSSE()
}

// Stop 停止同步。退出前执行一次推送确保最后数据送达。
func (c *Client) Stop() {
	c.stopOnce.Do(func() {
		if c.pushTicker != nil {
			c.pushTicker.Stop()
		}
		c.pushOnce()
		c.cancel()
	})
}

// RemoteStats 获取远程设备统计数据的只读快照。
func (c *Client) RemoteStats() map[string]any {
	v := c.remoteStats.Load()
	if v == nil {
		return nil
	}
	stats, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	return stats
}

// DeviceID 返回本机设备 ID。
func (c *Client) DeviceID() string {
	return c.deviceID
}

// SyncNow 立即执行一次数据推送。
func (c *Client) SyncNow() {
	if !c.config.Enabled || c.config.HubURL == "" {
		return
	}
	c.pushOnce()
}

// pushOnce 执行一次数据推送。
// 获取本地计数器快照，以 JSON 格式 POST 到 Hub 的 /api/ingest 端点。
func (c *Client) pushOnce() {
	c.pushMu.Lock()
	defer c.pushMu.Unlock()

	hostname, _ := os.Hostname()
	platform := runtime.GOOS

	// 构建包含设备标识和统计数据的完整载荷
	payload := c.counters.BuildPayload(c.deviceID, c.config.DeviceName, hostname, platform, c.version)

	// 无数据跳过推送
	if payload.Today.TotalTokens == 0 && payload.Month.TotalTokens == 0 && payload.AllTime.TotalTokens == 0 {
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		c.logger.Printf("push: marshal payload: %v", err)
		return
	}

	url := c.config.HubURL + "/api/ingest"
	req, err := http.NewRequestWithContext(c.ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		c.logger.Printf("push: create request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if c.config.Secret != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.Secret)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Printf("push: request failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		c.logger.Printf("push: server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
		return
	}

	// 推送成功后持久化快照
	if err := c.counters.Snapshot(); err != nil {
		c.logger.Printf("push: save snapshot: %v", err)
	}
}

// listenSSE 监听 Hub 的 SSE 流以接收远程设备统计。
// 断线后自动等待 5 秒重连。
func (c *Client) listenSSE() {
	// 使用独立的 HTTP 客户端（SSE 需要长连接，不能有超时限制）
	sseClient := &http.Client{}

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
		}

		url := c.config.HubURL + "/api/stats/stream"
		req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, url, nil)
		if err != nil {
			c.logger.Printf("sse: create request: %v, retry in 5s", err)
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}
		if c.config.Secret != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.Secret)
		}

		resp, err := sseClient.Do(req)
		if err != nil {
			c.logger.Printf("sse: connect: %v, retry in 5s", err)
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}

			data := strings.TrimPrefix(line, "data: ")
			if data == "" {
				continue
			}

			var stats map[string]any
			if err := json.Unmarshal([]byte(data), &stats); err != nil {
				c.logger.Printf("sse: parse event: %v", err)
				continue
			}
			c.remoteStats.Store(stats)
		}

		resp.Body.Close()

		if err := scanner.Err(); err != nil {
			c.logger.Printf("sse: read error: %v, retry in 5s", err)
		}

		select {
		case <-c.ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

// loadOrCreateDeviceID 加载或生成本机设备 ID。
// 设备 ID 存储在 {dataDir}/device-id 文件中，格式为 ocgt-{32hex}。
func loadOrCreateDeviceID(dataDir string) string {
	path := filepath.Join(dataDir, "device-id")
	data, err := os.ReadFile(path)
	if err == nil {
		id := strings.TrimSpace(string(data))
		if id != "" {
			return id
		}
	}

	// 生成新设备 ID
	id := generateDeviceID()
	if err := os.MkdirAll(dataDir, 0o700); err == nil {
		if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
			log.Printf("[hub] 写入设备 ID 文件失败: %v (将在下次启动时重新生成)", err)
		}
	}
	return id
}

// generateDeviceID 使用 crypto/rand 生成 ocgt-{32hex} 格式的设备 ID。
func generateDeviceID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("hub: crypto/rand failed: " + err.Error())
	}
	return "ocgt-" + hex.EncodeToString(b)
}
