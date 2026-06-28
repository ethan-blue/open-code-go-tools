package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestSyncCounters_Accumulate 验证计数器累加和日期变更自动重置
func TestSyncCounters_Accumulate(t *testing.T) {
	dir := t.TempDir()
	sc := NewSyncCounters(dir)

	// 初始状态应为全零
	p := sc.BuildPayload("test-device", "", "", "", "1.0")
	if p.Today.TotalTokens != 0 {
		t.Fatalf("初始 today 应为 0, got %d", p.Today.TotalTokens)
	}

	// 累加一次请求
	sc.Accumulate("deepseek-v4-flash", "anthropic", "claude-code", 100, 50, 30, 5)

	p = sc.BuildPayload("test-device", "", "", "", "1.0")
	// TotalTokens = InputTokens + OutputTokens + CacheCreateTokens (cacheRead不计入total)
	if p.Today.TotalTokens != 155 { // 100 + 50 + 5
		t.Fatalf("today.TotalTokens 应为 155, got %d", p.Today.TotalTokens)
	}
	if p.Today.InputTokens != 100 {
		t.Fatalf("today.InputTokens 应为 100, got %d", p.Today.InputTokens)
	}
	if p.Today.OutputTokens != 50 {
		t.Fatalf("today.OutputTokens 应为 50, got %d", p.Today.OutputTokens)
	}
	if p.Today.CacheReadTokens != 30 {
		t.Fatalf("today.CacheReadTokens 应为 30, got %d", p.Today.CacheReadTokens)
	}
	if p.Today.CacheCreateTokens != 5 {
		t.Fatalf("today.CacheCreateTokens 应为 5, got %d", p.Today.CacheCreateTokens)
	}

	// 验证模型维度
	dm, ok := p.Today.ByModel["deepseek-v4-flash"]
	if !ok {
		t.Fatal("缺少 byModel deepseek-v4-flash")
	}
	if dm.Tokens != 155 {
		t.Fatalf("model totals 应为 155, got %d", dm.Tokens)
	}

	// 验证路由维度
	dr, ok := p.Today.ByRoute["anthropic"]
	if !ok {
		t.Fatal("缺少 byRoute anthropic")
	}
	if dr.Tokens != 155 {
		t.Fatalf("route totals 应为 155, got %d", dr.Tokens)
	}

	// 验证客户端维度
	dc, ok := p.Today.ByClient["claude-code"]
	if !ok {
		t.Fatal("缺少 byClient claude-code")
	}
	if dc.Tokens != 155 {
		t.Fatalf("client totals 应为 155, got %d", dc.Tokens)
	}

	// 验证 allTime 和 month 也有相同值
	if p.AllTime.TotalTokens != 155 {
		t.Fatalf("allTime.TotalTokens 应为 155, got %d", p.AllTime.TotalTokens)
	}
	if p.Month.TotalTokens != 155 {
		t.Fatalf("month.TotalTokens 应为 155, got %d", p.Month.TotalTokens)
	}

	// 验证今日费用估算正确
	if p.Today.EstimatedCost <= 0 {
		t.Fatalf("today.EstimatedCost 应大于 0, got %f", p.Today.EstimatedCost)
	}
}

// TestSyncCounters_Snapshot 验证快照持久化与恢复
func TestSyncCounters_Snapshot(t *testing.T) {
	dir := t.TempDir()
	sc := NewSyncCounters(dir)

	sc.Accumulate("deepseek-v4-flash", "anthropic", "claude-code", 100, 50, 30, 5)

	// 保存快照
	if err := sc.Snapshot(); err != nil {
		t.Fatalf("Snapshot failed: %v", err)
	}

	// 验证快照文件存在
	snapPath := filepath.Join(dir, countersSnapshotFile)
	if _, err := os.Stat(snapPath); err != nil {
		t.Fatalf("快照文件不存在: %v", err)
	}

	// 创建新计数器（模拟进程重启）
	sc2 := NewSyncCounters(dir)
	p := sc2.BuildPayload("test-device", "", "", "", "1.0")

	// allTime 应该恢复了
	if p.AllTime.TotalTokens != 155 {
		t.Fatalf("重启后 allTime 应为 155, got %d", p.AllTime.TotalTokens)
	}

	// today 不应恢复（每次启动重新开始）
	if p.Today.TotalTokens != 0 {
		t.Fatalf("重启后 today 应为 0, got %d", p.Today.TotalTokens)
	}
}

// TestServerIngest 验证 Hub 服务器接收推送并正确聚合
func TestServerIngest(t *testing.T) {
	dir := t.TempDir()

	srv, err := NewHubServer(ServerOption{
		Port:    0,
		DataDir: dir,
		Secret:  "test-secret",
	})
	if err != nil {
		t.Fatalf("NewHubServer failed: %v", err)
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer srv.Stop()

	addr := srv.Addr().String()

	// 推送测试数据
	payload := SyncPayload{
		DeviceID:    "test-device-1",
		DisplayName: "测试设备",
		Hostname:    "test-pc",
		Platform:    "linux-amd64",
		Version:     "1.0.0",
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
		Today: PeriodStats{
			TotalTokens:       1000,
			EstimatedCost:     0.05,
			InputTokens:       600,
			OutputTokens:      300,
			CacheReadTokens:   100,
			CacheCreateTokens: 0,
			ByModel:           map[string]DimStats{"deepseek-v4-flash": {Tokens: 1000, Cost: 0.05, InputTokens: 600, OutputTokens: 300}},
			ByRoute:           map[string]DimStats{"anthropic": {Tokens: 1000, Cost: 0.05, InputTokens: 600, OutputTokens: 300}},
			ByClient:          map[string]DimStats{"claude-code": {Tokens: 1000, Cost: 0.05, InputTokens: 600, OutputTokens: 300}},
		},
		Month:   PeriodStats{TotalTokens: 30000, EstimatedCost: 1.50},
		AllTime: PeriodStats{TotalTokens: 100000, EstimatedCost: 5.00},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://%s/api/ingest", addr), bytes.NewReader(body))
	if err != nil {
		t.Fatalf("创建请求失败: %v", err)
	}
	req.Header.Set("Authorization", "Bearer test-secret")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("推送请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("推送返回 %d, 期望 200", resp.StatusCode)
	}

	// 查询 stats 验证数据已聚合
	statsReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	if err != nil {
		t.Fatalf("create stats request: %v", err)
	}
	statsReq.Header.Set("Authorization", "Bearer test-secret")
	statsResp, err := http.DefaultClient.Do(statsReq)
	if err != nil {
		t.Fatalf("查询 stats 失败: %v", err)
	}
	defer statsResp.Body.Close()

	var result map[string]any
	json.NewDecoder(statsResp.Body).Decode(&result)

	allTime, ok := result["allTime"].(map[string]any)
	if !ok {
		t.Fatal("响应中缺少 allTime")
	}
	totalTokens := allTime["totalTokens"].(float64)
	if totalTokens != 100000 {
		t.Fatalf("allTime.totalTokens 应为 100000, got %f", totalTokens)
	}

	today, ok := result["today"].(map[string]any)
	if !ok {
		t.Fatal("响应中缺少 today")
	}
	if today["totalTokens"].(float64) != 1000 {
		t.Fatalf("today.totalTokens 应为 1000, got %f", today["totalTokens"].(float64))
	}

	// 验证设备列表
	devices, ok := result["devices"].([]any)
	if !ok || len(devices) != 1 {
		t.Fatalf("设备列表应为 1 个, got %d", len(devices))
	}
	dev := devices[0].(map[string]any)
	if dev["deviceId"] != "test-device-1" {
		t.Fatalf("deviceId 应为 test-device-1, got %v", dev["deviceId"])
	}

	t.Log("✅ 推送 + 查询链路验证通过")
}

// TestAuth 验证 Hub 鉴权机制
func TestAuth(t *testing.T) {
	dir := t.TempDir()

	srv, err := NewHubServer(ServerOption{
		Port:    0,
		DataDir: dir,
		Secret:  "my-secret",
	})
	if err != nil {
		t.Fatalf("NewHubServer failed: %v", err)
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer srv.Stop()

	addr := srv.Addr().String()

	// 健康检查不需要认证
	healthResp, err := http.Get(fmt.Sprintf("http://%s/api/health", addr))
	if err != nil {
		t.Fatalf("health check 失败: %v", err)
	}
	healthResp.Body.Close()
	if healthResp.StatusCode != http.StatusOK {
		t.Fatalf("health should be 200, got %d", healthResp.StatusCode)
	}

	// 无 token 的请求应该返回 401
	statsReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	if err != nil {
		t.Fatalf("create stats request: %v", err)
	}
	statsResp, err := http.DefaultClient.Do(statsReq)
	if err != nil {
		t.Fatalf("stats request failed: %v", err)
	}
	statsResp.Body.Close()
	if statsResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无认证时应返回 401, got %d", statsResp.StatusCode)
	}

	// Bearer token 应该通过
	authReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	if err != nil {
		t.Fatalf("create auth request: %v", err)
	}
	authReq.Header.Set("Authorization", "Bearer my-secret")
	authResp, err := http.DefaultClient.Do(authReq)
	if err != nil {
		t.Fatalf("auth stats failed: %v", err)
	}
	authResp.Body.Close()
	if authResp.StatusCode != http.StatusOK {
		t.Fatalf("Bearer 认证应返回 200, got %d", authResp.StatusCode)
	}

	// X-OCGT-Secret header 也应该通过
	altReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	if err != nil {
		t.Fatalf("create alt request: %v", err)
	}
	altReq.Header.Set("X-OCGT-Secret", "my-secret")
	altResp, err := http.DefaultClient.Do(altReq)
	if err != nil {
		t.Fatalf("alt auth failed: %v", err)
	}
	altResp.Body.Close()
	if altResp.StatusCode != http.StatusOK {
		t.Fatalf("X-OCGT-Secret 认证应返回 200, got %d", altResp.StatusCode)
	}

	t.Log("✅ 鉴权机制验证通过")
}

// TestServerIngest_StaleAfterMs 验证离线设备标记
func TestServerIngest_StaleAfterMs(t *testing.T) {
	dir := t.TempDir()

	srv, err := NewHubServer(ServerOption{
		Port:         0,
		DataDir:      dir,
		Secret:       "",
		StaleAfterMs: 1, // 1ms, 推送完立刻过期
	})
	if err != nil {
		t.Fatalf("NewHubServer failed: %v", err)
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer srv.Stop()

	addr := srv.Addr().String()

	// 推送数据
	payload := SyncPayload{
		DeviceID: "stale-device",
		Today:    PeriodStats{TotalTokens: 100},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://%s/api/ingest", addr), bytes.NewReader(body))
	if err != nil {
		t.Fatalf("create ingest request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("ingest failed: %v", err)
	}
	resp.Body.Close()

	// 等待足够时间让设备过期
	time.Sleep(50 * time.Millisecond)

	// 查询 stats 检查设备标记
	statsReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	if err != nil {
		t.Fatalf("create stats request: %v", err)
	}
	statsResp, err := http.DefaultClient.Do(statsReq)
	if err != nil {
		t.Fatalf("query stats: %v", err)
	}
	defer statsResp.Body.Close()

	var result map[string]any
	json.NewDecoder(statsResp.Body).Decode(&result)
	devices := result["devices"].([]any)
	if len(devices) != 1 {
		t.Fatalf("应该有 1 台设备, got %d", len(devices))
	}
	dev := devices[0].(map[string]any)
	isStale, _ := dev["stale"].(bool)
	if !isStale {
		t.Fatal("设备应被标记为 stale=true")
	}

	// 统计数据仍应包含该设备（today 应该有值）
	today := result["today"].(map[string]any)
	if today["totalTokens"].(float64) != 100 {
		t.Fatal("stale 设备的今日数据仍应计入汇总")
	}

	t.Log("✅ 离线设备标记验证通过")
}
