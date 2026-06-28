// OCGT Hub Worker — 跨设备同步中心
// 接收设备推送的汇总数据，用 Durable Object SQLite 存储，通过 SSE 推送给已连接的客户端。

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-ocgt-secret'
};

function jsonResponse(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, no-transform', ...CORS_HEADERS, ...extra }
  });
}

function textResponse(status, body, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType, ...CORS_HEADERS } });
}

function requestSecret(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerSecret = String(request.headers.get('x-ocgt-secret') || '').trim();
  if (headerSecret) return headerSecret;
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get('secret') || '').trim();
  } catch (_) { return ''; }
}

function isAuthorized(request, expectedSecret) {
  if (!expectedSecret) return true;
  return requestSecret(request) === expectedSecret;
}

function sseFormat(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── PeriodStats 聚合工具 ──

function emptyPeriodStats() {
  return {
    totalTokens: 0,
    estimatedCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    byModel: {},
    byRoute: {},
    byClient: {}
  };
}

function sumPeriodStats(target, src) {
  if (!src) return target;
  target.totalTokens += (src.totalTokens || 0);
  target.estimatedCost += (src.estimatedCost || 0);
  target.inputTokens += (src.inputTokens || 0);
  target.outputTokens += (src.outputTokens || 0);
  target.cacheReadTokens += (src.cacheReadTokens || 0);
  target.cacheCreateTokens += (src.cacheCreateTokens || 0);

  // byModel: { modelName: { tokens, cost, inputTokens, outputTokens } }
  if (src.byModel && typeof src.byModel === 'object') {
    for (const [model, stat] of Object.entries(src.byModel)) {
      if (!target.byModel[model]) {
        target.byModel[model] = { tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
      }
      target.byModel[model].tokens += (stat.tokens || 0);
      target.byModel[model].cost += (stat.cost || 0);
      target.byModel[model].inputTokens += (stat.inputTokens || 0);
      target.byModel[model].outputTokens += (stat.outputTokens || 0);
    }
  }

  // byRoute: { routeName: { tokens, cost, inputTokens, outputTokens } }
  if (src.byRoute && typeof src.byRoute === 'object') {
    for (const [route, stat] of Object.entries(src.byRoute)) {
      if (!target.byRoute[route]) {
        target.byRoute[route] = { tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
      }
      target.byRoute[route].tokens += (stat.tokens || 0);
      target.byRoute[route].cost += (stat.cost || 0);
      target.byRoute[route].inputTokens += (stat.inputTokens || 0);
      target.byRoute[route].outputTokens += (stat.outputTokens || 0);
    }
  }

  // byClient: { clientName: { tokens, cost, inputTokens, outputTokens } }
  if (src.byClient && typeof src.byClient === 'object') {
    for (const [client, stat] of Object.entries(src.byClient)) {
      if (!target.byClient[client]) {
        target.byClient[client] = { tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
      }
      target.byClient[client].tokens += (stat.tokens || 0);
      target.byClient[client].cost += (stat.cost || 0);
      target.byClient[client].inputTokens += (stat.inputTokens || 0);
      target.byClient[client].outputTokens += (stat.outputTokens || 0);
    }
  }

  return target;
}

function aggregateDevices(devices) {
  const result = {
    deviceCount: devices.length,
    today: emptyPeriodStats(),
    month: emptyPeriodStats(),
    allTime: emptyPeriodStats()
  };

  for (const device of devices) {
    sumPeriodStats(result.today, device.today);
    sumPeriodStats(result.month, device.month);
    sumPeriodStats(result.allTime, device.allTime);
  }

  return result;
}

function mergeDeviceRecord(existing, payload) {
  const now = new Date().toISOString();
  const record = existing ? { ...existing } : {};

  // 设备元数据 — 每次推送覆盖
  record.deviceId = payload.deviceId || payload.id || record.deviceId;
  if (payload.displayName !== undefined) record.displayName = payload.displayName;
  if (payload.hostname !== undefined) record.hostname = payload.hostname;
  if (payload.platform !== undefined) record.platform = payload.platform;
  if (payload.version !== undefined) record.version = payload.version;

  // 保留客户端最近一次上报路径，用于远程连接确认
  if (payload.clientIp !== undefined) record.clientIp = payload.clientIp;

  // 更新时间戳
  record.updatedAt = payload.updatedAt || now;
  record.receivedAt = now;

  // 三个时间段统计 — 直接覆盖（客户端总是推送完整快照）
  if (payload.today !== undefined) record.today = payload.today;
  if (payload.month !== undefined) record.month = payload.month;
  if (payload.allTime !== undefined) record.allTime = payload.allTime;

  return record;
}

// ── Durable Object ──

export class HubDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sseClients = new Set();
    this.heartbeatTimer = null;
    this.encoder = new TextEncoder();
  }

  get secret() {
    return String(this.env.OCGT_HUB_SECRET || '').trim();
  }

  get staleAfterMs() {
    // 设备超过此时间未上报视为离线（默认 10 分钟）
    return Number(this.env.STALE_AFTER_MS || 10 * 60 * 1000);
  }

  async listDevices() {
    const entries = await this.state.storage.list({ prefix: 'dev:' });
    return Array.from(entries.values());
  }

  async getStats() {
    const devices = await this.listDevices();
    const now = Date.now();

    // 所有设备参与汇总（不过滤离线设备）
    const result = aggregateDevices(devices);
    result.updatedAt = new Date().toISOString();
    // 附加上下文
    result.devices = devices.map(d => ({
      deviceId: d.deviceId,
      displayName: d.displayName,
      hostname: d.hostname,
      platform: d.platform,
      version: d.version,
      updatedAt: d.updatedAt,
      receivedAt: d.receivedAt,
      stale: this.staleAfterMs > 0 && (now - new Date(d.receivedAt || d.updatedAt).getTime()) > this.staleAfterMs,
      today: d.today || null,
      month: d.month || null,
      allTime: d.allTime || null,
    }));

    return result;
  }

  ensureHeartbeat() {
    if (this.heartbeatTimer || this.sseClients.size === 0) return;
    this.heartbeatTimer = setInterval(() => {
      const chunk = this.encoder.encode(': hb\n\n');
      for (const writer of this.sseClients) {
        writer.write(chunk).catch(() => this.dropClient(writer));
      }
      if (this.sseClients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, 30000);
  }

  dropClient(writer) {
    this.sseClients.delete(writer);
    try { writer.close(); } catch (_) {}
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async broadcast(reason = 'update') {
    if (this.sseClients.size === 0) return;
    const stats = await this.getStats();
    const payload = this.encoder.encode(`data: ${JSON.stringify(stats)}\n\n`);
    for (const writer of this.sseClients) {
      writer.write(payload).catch(() => this.dropClient(writer));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ── Health Check (无需认证) ──
    if (url.pathname === '/api/health') {
      const devices = await this.listDevices();
      return jsonResponse(200, {
        ok: true,
        role: 'hub',
        runtime: 'cloudflare-worker',
        version: 1,
        deviceCount: devices.length,
        secretRequired: Boolean(this.secret),
        now: new Date().toISOString()
      });
    }

    // Worker 是面向公网的 URL，没有可信 LAN 回退。
    // 没有密钥时拒绝所有数据请求（health 已在上面处理）。
    if (!this.secret) {
      return jsonResponse(503, {
        error: 'secret_required',
        message: 'OCGT_HUB_SECRET must be set on the worker; unauthenticated access is refused.'
      });
    }
    if (!isAuthorized(request, this.secret)) {
      return jsonResponse(401, { error: 'unauthorized' });
    }

    // ── GET /api/stats — 获取聚合统计 ──
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/stats') {
      return jsonResponse(200, await this.getStats());
    }

    // ── GET /api/devices — 列设备 ──
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/devices') {
      const now = Date.now();
      const devices = await this.listDevices();
      const result = devices.map(d => ({
        deviceId: d.deviceId,
        displayName: d.displayName,
        hostname: d.hostname,
        platform: d.platform,
        version: d.version,
        updatedAt: d.updatedAt,
        receivedAt: d.receivedAt,
        stale: this.staleAfterMs > 0 && (now - new Date(d.receivedAt || d.updatedAt).getTime()) > this.staleAfterMs,
        today: d.today || null,
        month: d.month || null,
        allTime: d.allTime || null
      }));
      return jsonResponse(200, { devices: result });
    }

    // ── GET /api/stats/stream — SSE 实时流 ──
    if (request.method === 'GET' && url.pathname === '/api/stats/stream') {
      const stats = await this.getStats();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      writer.write(this.encoder.encode(`data: ${JSON.stringify(stats)}\n\n`))).catch(() => {});
      this.sseClients.add(writer);
      this.ensureHeartbeat();
      request.signal.addEventListener('abort', () => this.dropClient(writer));
      return new Response(readable, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
          ...CORS_HEADERS
        }
      });
    }

    // ── POST /api/ingest — 接收设备数据推送 ──
    if (request.method === 'POST' && url.pathname === '/api/ingest') {
      let payload;
      try { payload = await request.json(); }
      catch (error) { return jsonResponse(400, { error: 'bad_request', message: error.message }); }

      if (!payload.deviceId && !payload.id) {
        return jsonResponse(400, { error: 'deviceId_required' });
      }

      const deviceId = String(payload.deviceId || payload.id);
      const existing = await this.state.storage.get(`dev:${deviceId}`);
      const record = mergeDeviceRecord(existing, { ...payload, receivedAt: new Date().toISOString() });
      await this.state.storage.put(`dev:${record.deviceId}`, record);
      this.broadcast('ingest').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId: record.deviceId });
    }

    // ── DELETE /api/devices/:id — 删除设备 ──
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      await this.state.storage.delete(`dev:${deviceId}`);
      this.broadcast('delete').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId });
    }

    return jsonResponse(404, { error: 'not_found' });
  }
}

// ── Worker Entry ──

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return textResponse(204, '');
    const id = env.HUB.idFromName('hub');
    const stub = env.HUB.get(id);
    return stub.fetch(request);
  }
};
