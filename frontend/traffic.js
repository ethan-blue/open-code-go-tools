/* ============================================================
   traffic.js — ocgt 流量监控仪表盘 v2
   多巴胺配色 · 主题自适应 · Y 轴自适应 · 加载状态
   ============================================================ */

// ── 多巴胺色板 ──
const DOPAMINE = [
  '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8B94',
  '#95E1D3', '#F38181', '#AA96DA', '#FCBAD3', '#6BCB77',
  '#FFD93D', '#4D96FF', '#C3F0CA', '#F9ED69', '#B8E8FC'
];

// ── 主题检测 ──
function isDarkMode() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function chartColors() {
  const dark = isDarkMode();
  return {
    text: dark ? '#8b949e' : '#5b6276',
    grid: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)',
    tooltipBg: dark ? '#1c2128' : '#fff',
    tooltipBorder: dark ? '#30363d' : '#e2e6ee',
    tooltipTitle: dark ? '#e6edf3' : '#1a1d28',
    tooltipBody: dark ? '#c9d1d9' : '#5b6276',
  };
}

function applyChartTheme() {
  if (typeof Chart === 'undefined') return;
  const c = chartColors();
  Chart.defaults.color = c.text;
  Chart.defaults.borderColor = c.grid;
}
applyChartTheme();

// ── 状态 ──
let currentDays = 1;
let chartInstances = {};
let pollTimer = null;

// ── API ──
let TRAFFIC_API_BASE = 'http://127.0.0.1:8787';
window.setTrafficApiBase = function(url) { TRAFFIC_API_BASE = url; };
async function apiGet(path) {
  try {
    const headers = {};
    if (window.LOCAL_AUTH_TOKEN) headers['X-Ocgt-Local-Token'] = window.LOCAL_AUTH_TOKEN;
    const resp = await fetch(path, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('traffic API error:', path, e);
    return { _error: e.message || String(e) };
  }
}
function getBaseURL() { return TRAFFIC_API_BASE; }

// ── 加载状态 ──
function showLoading(show) {
  document.querySelectorAll('.td-loading').forEach(el => el.style.display = show ? 'flex' : 'none');
  document.querySelectorAll('.td-loaded').forEach(el => el.style.display = show ? 'none' : '');
}

// ── 加载超时保护：10秒后强制退出加载状态 ──
let loadingTimer = null;
function safeShowLoading(show) {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
  showLoading(show);
  if (show) {
    loadingTimer = setTimeout(() => {
      showLoading(false);
      const row = document.getElementById('traffic-stats-row');
      if (row && !row.hasChildNodes()) {
        row.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3);">⚠ 无法连接代理，请确认代理服务运行中</div>';
      }
    }, 10000);
  }
}

// ── 时间范围 ──
function initTimeRange() {
  const container = document.getElementById('time-range-selector');
  if (!container) return;
  const days = [
    { label: '今日', value: 1 },
    { label: '7日', value: 7 },
    { label: '30日', value: 30 },
    { label: '全部', value: 365 }
  ];
  container.innerHTML = days.map(d =>
    `<span class="tr-btn ${d.value === currentDays ? 'active' : ''}" data-days="${d.value}">${d.label}</span>`
  ).join('');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tr-btn');
    if (!btn) return;
    container.querySelectorAll('.tr-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDays = parseInt(btn.dataset.days, 10);
    refreshAll();
  });
}

// ── 格式化 ──
function fmtNum(n) {
  if (n === undefined || n === null) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}
function fmtToken(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
function fmtCost(n) {
  if (!n || n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(2);
}
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0');
}

// ── 图表空状态辅助函数（不销毁 canvas）──
function toggleChartEmpty(canvas, show) {
  if (!canvas) return;
  const container = canvas.parentElement;
  if (!container) return;
  let emptyEl = container.querySelector('.td-empty-state');
  if (show) {
    canvas.style.display = 'none';
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'td-empty-state';
      emptyEl.textContent = '暂无数据';
      container.appendChild(emptyEl);
    }
    emptyEl.style.display = '';
  } else {
    canvas.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
  }
}

// ── 趋势图标签格式化（自适应粒度）──
function fmtTrendLabel(dateStr, granularity) {
  if (!dateStr) return '-';
  // 小时级: "YYYY-MM-DD HH:mm"
  if (dateStr.includes(' ')) {
    const [datePart, timePart] = dateStr.split(' ');
    const [, m, d] = datePart.split('-');
    return m + '/' + d + ' ' + timePart.slice(0, 5);
  }
  // 周级
  if (granularity === 'week') {
    const [, m, d] = dateStr.split('-');
    return m + '/' + d + '周';
  }
  // 天级: MM/DD
  const [, m, d] = dateStr.split('-');
  return m + '/' + d;
}

// ── 刷新时间戳 ──
function updateTimestamp() {
  const el = document.getElementById('td-timestamp');
  if (el) el.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
}

// ── 统计卡片 ──
function renderTopStats(summary) {
  const cards = [
    { label: '总请求', val: fmtNum(summary?.total_requests || 0), color: DOPAMINE[0], sub: '' },
    { label: '成功率', val: (summary?.success_rate || 0).toFixed(1) + '%', color: DOPAMINE[1], sub: '失败 ' + ((summary?.total_requests || 0) - (summary?.success_count || 0)) + ' 次' },
    { label: '延迟', val: (summary?.avg_latency_ms || 0).toFixed(0) + 'ms', color: DOPAMINE[2], sub: '平均' },
    { label: 'Token', val: fmtToken(summary?.total_tokens || 0), color: DOPAMINE[3], sub: '≈ ' + fmtCost(summary?.estimated_cost) },
    { label: 'Input', val: fmtToken(summary?.total_input_tokens || 0), color: DOPAMINE[4], sub: '' },
    { label: 'Output', val: fmtToken(summary?.total_output_tokens || 0), color: DOPAMINE[5], sub: '' },
    { label: 'Cache', val: fmtToken((summary?.total_cache_read_tokens || 0) + (summary?.total_cache_create_tokens || 0)), color: DOPAMINE[6], sub: '' },
    { label: 'Cache命中率', val: ((summary?.cache_hit_rate || 0)).toFixed(1) + '%', color: DOPAMINE[7], sub: (summary?.total_input_tokens || 0) > 0 ? fmtToken(summary?.total_cache_read_tokens || 0) + '/' + fmtToken(summary?.total_input_tokens) : '' },
  ];
  const el = document.getElementById('traffic-stats-row');
  if (!el) return;
  el.innerHTML = cards.map(c => `
    <div class="ts-card" style="--card-glow:${c.color}22;--card-border:${c.color}44;">
      <div class="ts-glow" style="background:${c.color};"></div>
      <div class="ts-label">${c.label}</div>
      <div class="ts-value" style="color:${c.color};">${c.val}</div>
      ${c.sub ? `<div class="ts-sub">${c.sub}</div>` : ''}
    </div>
  `).join('');
}

// ── 折线图通用选项 ──
function lineOpts(extra, maxTicks) {
  const c = chartColors();
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { color: c.text, font: { size: 11 }, usePointStyle: true, padding: 16 },
        onClick: (e, legendItem, legend) => {
          const ci = legend.chart;
          const meta = ci.getDatasetMeta(legendItem.datasetIndex);
          meta.hidden = meta.hidden === null ? !ci.data.datasets[legendItem.datasetIndex].hidden : null;
          ci.update();
        }
      },
      tooltip: {
        backgroundColor: c.tooltipBg, titleColor: c.tooltipTitle, bodyColor: c.tooltipBody,
        borderColor: c.tooltipBorder, borderWidth: 1, padding: 10, cornerRadius: 8,
      }
    },
    scales: {
      x: { grid: { color: c.grid, drawBorder: false }, ticks: { color: c.text, font: { size: 10 }, maxTicksLimit: maxTicks || 12 } },
      y: {
        beginAtZero: true,
        grid: { color: c.grid, drawBorder: false },
        ticks: { color: c.text, font: { size: 10 }, callback: v => fmtToken(v), autoSkip: true, maxTicksLimit: 8 }
      }
    },
    ...extra
  };
}

// ── Token 趋势 ──
function renderTokenTrend(daily, granularity) {
  const canvas = document.getElementById('chart-token-trend');
  if (!canvas) return;
  if (typeof Chart === 'undefined') return;
  if (chartInstances.tokenTrend) { chartInstances.tokenTrend.destroy(); chartInstances.tokenTrend = null; }
  if (!daily || daily.length === 0) {
    toggleChartEmpty(canvas, true); return;
  }
  toggleChartEmpty(canvas, false);

  const labels = daily.map(d => fmtTrendLabel(d.date, granularity));
  const datasets = [
    { label: 'Total', data: daily.map(d => d.total_tokens), borderColor: DOPAMINE[0], backgroundColor: DOPAMINE[0] + '18', fill: true, tension: 0.4, cubicInterpolationMode: 'monotone', pointRadius: 3, pointHoverRadius: 6 },
    { label: 'Input', data: daily.map(d => d.input_tokens), borderColor: DOPAMINE[1], backgroundColor: DOPAMINE[1] + '18', fill: true, tension: 0.4, cubicInterpolationMode: 'monotone', pointRadius: 3, pointHoverRadius: 6 },
    { label: 'Output', data: daily.map(d => d.output_tokens), borderColor: DOPAMINE[2], backgroundColor: DOPAMINE[2] + '12', fill: true, tension: 0.4, cubicInterpolationMode: 'monotone', borderDash: [4, 3], pointRadius: 2, pointHoverRadius: 5 },
  ];

  const maxTicks = daily.length <= 12 ? daily.length : Math.min(Math.ceil(daily.length / 2), 24);

  chartInstances.tokenTrend = new Chart(canvas, {
    type: 'line', data: { labels, datasets },
    options: lineOpts({
      plugins: {
        legend: { labels: { ...lineOpts().plugins.legend.labels } },
        tooltip: { ...lineOpts().plugins.tooltip, callbacks: { label: ctx => '  ' + ctx.dataset.label + ': ' + fmtToken(ctx.parsed.y) } }
      }
    }, maxTicks)
  });
}

// ── 请求量折线图 ──
function renderRequestTrend(daily, granularity) {
  const canvas = document.getElementById('chart-request-trend');
  if (!canvas) return;
  if (typeof Chart === 'undefined') return;
  if (chartInstances.requestTrend) { chartInstances.requestTrend.destroy(); chartInstances.requestTrend = null; }
  if (!daily || daily.length === 0) {
    toggleChartEmpty(canvas, true); return;
  }
  toggleChartEmpty(canvas, false);

  const maxTicks = daily.length <= 12 ? daily.length : Math.min(Math.ceil(daily.length / 2), 24);
  chartInstances.requestTrend = new Chart(canvas, {
    type: 'line',
    data: { labels: daily.map(d => fmtTrendLabel(d.date, granularity)), datasets: [{ label: '请求数', data: daily.map(d => d.requests), borderColor: DOPAMINE[7], backgroundColor: DOPAMINE[7] + '20', fill: true, tension: 0.4, cubicInterpolationMode: 'monotone', pointRadius: 3, pointHoverRadius: 6, yAxisID: 'y' }] },
    options: lineOpts({}, maxTicks)
  });
}

// ── 模型环形图 ──
function renderModelDonut(models) {
  const canvas = document.getElementById('chart-model-donut');
  if (!canvas) return;
  if (typeof Chart === 'undefined') return;
  if (chartInstances.modelDonut) { chartInstances.modelDonut.destroy(); chartInstances.modelDonut = null; }
  if (!models || models.length === 0) {
    toggleChartEmpty(canvas, true); return;
  }
  toggleChartEmpty(canvas, false);

  const c = chartColors();
  const colors = models.map((_, i) => DOPAMINE[i % DOPAMINE.length]);
  const total = models.reduce((s, m) => s + m.total_tokens, 0);

  chartInstances.modelDonut = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: models.map(m => m.name), datasets: [{ data: models.map(m => m.total_tokens), backgroundColor: colors, borderColor: isDarkMode() ? '#161b22' : '#fff', borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { color: c.text, font: { size: 10 }, usePointStyle: true, padding: 12, boxWidth: 8 } },
        tooltip: {
          backgroundColor: c.tooltipBg, titleColor: c.tooltipTitle, bodyColor: c.tooltipBody,
          borderColor: c.tooltipBorder, borderWidth: 1, padding: 10, cornerRadius: 8,
          callbacks: { label: ctx => ' ' + ctx.label + ': ' + fmtToken(ctx.parsed) + ' (' + (total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0) + '%)' }
        }
      }
    }
  });
}

// ── 模型明细表 ──
function renderModelTable(models) {
  const container = document.getElementById('model-table-body');
  if (!container) return;
  if (!models || models.length === 0) {
    container.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:24px;">暂无数据</td></tr>'; return;
  }
  const totalTokens = models.reduce((s, m) => s + m.total_tokens, 0);
  const totalCost = models.reduce((s, m) => s + (m.cost_usd || 0), 0);
  container.innerHTML = models.map((m, i) => {
    const color = DOPAMINE[i % DOPAMINE.length];
    const pct = totalTokens > 0 ? ((m.total_tokens / totalTokens) * 100).toFixed(1) : 0;
    return `<tr>
      <td><span class="dot" style="background:${color};"></span> ${m.name}</td>
      <td class="tar">${m.requests}</td>
      <td class="tar">${fmtToken(m.input_tokens)}</td>
      <td class="tar">${fmtToken(m.output_tokens)}</td>
      <td class="tar">${fmtToken(m.cache_tokens)}${m.cache_tokens > 0 ? '<br><span class="td-mono" style="font-size:10px;color:var(--text-3);">' + m.cache_hit_rate.toFixed(1) + '%</span>' : ''}</td>
      <td class="tar fwb">${fmtToken(m.total_tokens)}</td>
      <td><div class="pct-bar"><div class="pct-fill" style="width:${pct}%;background:${color};"></div></div><span class="pct-label">${pct}%</span></td>
      <td class="tar cost-cell" title="Input: ${fmtCost(m.cost_usd * (m.input_tokens/(m.total_tokens||1)))} / Output: ${fmtCost(m.cost_usd * (m.output_tokens/(m.total_tokens||1)))}" style="color:${color};">${fmtCost(m.cost_usd)}</td>
    </tr>`;
  }).join('') + `<tr class="total-row">
    <td class="fwb">总计</td>
    <td class="tar fwb">${models.reduce((s, m) => s + m.requests, 0)}</td>
    <td class="tar fwb">${fmtToken(models.reduce((s, m) => s + m.input_tokens, 0))}</td>
    <td class="tar fwb">${fmtToken(models.reduce((s, m) => s + m.output_tokens, 0))}</td>
    <td class="tar fwb">${fmtToken(models.reduce((s, m) => s + m.cache_tokens, 0))}</td>
    <td class="tar fwb">${fmtToken(totalTokens)}</td>
    <td>—</td>
    <td class="tar fwb" style="color:${DOPAMINE[0]};">${fmtCost(totalCost)}</td>
  </tr>`;
}

// ── 客户端来源表 ──
function renderClientTable(clients) {
  const container = document.getElementById('client-table-body');
  if (!container) return;
  if (!clients || clients.length === 0) {
    container.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:16px;">暂无数据</td></tr>'; return;
  }
  container.innerHTML = clients.map((c, i) => {
    const color = DOPAMINE[(i + 5) % DOPAMINE.length];
    return `<tr><td><span class="dot" style="background:${color};"></span> ${c.name}</td><td class="tar">${c.requests}</td><td class="tar">${c.pct.toFixed(1)}%</td></tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  主刷新
// ═══════════════════════════════════════════════════════════

async function refreshAll() {
  // 等待 auth token 就绪（app.js 异步获取），最多等 10 秒
  if (!window.LOCAL_AUTH_TOKEN) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (window.LOCAL_AUTH_TOKEN) break;
    }
  }
  safeShowLoading(true);
  const base = getBaseURL();
  const [summary, trendData, modelData] = await Promise.all([
    apiGet(`${base}/ocgt/api/stats/summary?days=${currentDays}`),
    apiGet(`${base}/ocgt/api/stats/trend?days=${currentDays}`),
    apiGet(`${base}/ocgt/api/stats/models?days=${currentDays}`)
  ]);
  try {
    if (summary && !summary._error) {
      renderTopStats(summary.summary);
      if (summary.by_client) renderClientTable(summary.by_client);
    }
    if (trendData && !trendData._error && trendData.daily) {
      renderTokenTrend(trendData.daily, trendData.granularity || 'day');
      renderRequestTrend(trendData.daily, trendData.granularity || 'day');
    }
    if (modelData && !modelData._error && modelData.models) {
      renderModelDonut(modelData.models);
      renderModelTable(modelData.models);
    }
  } catch (e) { console.error('traffic render error:', e); }
  safeShowLoading(false);
}

// ── 初始化 ──
function initTrafficDashboard() {
  initTimeRange();
  refreshAll();

  // 主题变化监听
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyChartTheme();
    // 重建图表
    refreshAll();
  });

  // 轮询刷新统计数据
  setInterval(refreshAll, 300000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTrafficDashboard);
else initTrafficDashboard();

// ═══════════════════════════════════════════════════════════
//  流量明细 Tab
// ═══════════════════════════════════════════════════════════

let _detailInit = false;
const _detailState = {
  days: 7,
  page: 1,
  pageSize: 20,
  filterModel: '',
  filterStatus: '',
  data: [],
  filtered: []
};

function initTrafficDetail() {
  if (!_detailInit) {
    _detailInit = true;
    initDetailTimeRange();
    bindDetailControls();
  }
  loadDetailData();
}

function initDetailTimeRange() {
  const container = document.getElementById('detail-time-range');
  if (!container) return;
  const days = [
    { label: '今日', value: 1 },
    { label: '7日', value: 7 },
    { label: '30日', value: 30 },
    { label: '全部', value: 365 }
  ];
  container.innerHTML = days.map(d =>
    `<span class="tr-btn ${d.value === _detailState.days ? 'active' : ''}" data-days="${d.value}">${d.label}</span>`
  ).join('');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tr-btn');
    if (!btn) return;
    container.querySelectorAll('.tr-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _detailState.days = parseInt(btn.dataset.days, 10);
    _detailState.page = 1;
    loadDetailData();
  });
}

function bindDetailControls() {
  const modelSel = document.getElementById('filter-model');
  if (modelSel) modelSel.addEventListener('change', () => {
    _detailState.filterModel = modelSel.value;
    _detailState.page = 1;
    renderDetailTable();
  });

  const statusSel = document.getElementById('filter-status');
  if (statusSel) statusSel.addEventListener('change', () => {
    _detailState.filterStatus = statusSel.value;
    _detailState.page = 1;
    renderDetailTable();
  });

  document.getElementById('btn-refresh-detail')?.addEventListener('click', loadDetailData);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportDetailCSV);
  document.getElementById('btn-clear-history')?.addEventListener('click', clearDetailHistory);
}

async function loadDetailData() {
  // 等待 auth token 就绪（app.js 异步获取），最多等 10 秒
  if (!window.LOCAL_AUTH_TOKEN) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (window.LOCAL_AUTH_TOKEN) break;
    }
  }
  const tbody = document.getElementById('detail-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-3);padding:24px;"><span class="td-spinner"></span> 加载中...</td></tr>';

  const base = getBaseURL();
  const data = await apiGet(`${base}/ocgt/api/history?days=${_detailState.days}`);

  if (data && data._error) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--red);padding:24px;">加载失败: ${data._error}</td></tr>`;
    return;
  }

  _detailState.data = Array.isArray(data) ? data : [];
  updateModelFilterOptions();
  applyDetailFilters();

  const ts = document.getElementById('detail-timestamp');
  if (ts) ts.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
}

function updateModelFilterOptions() {
  const sel = document.getElementById('filter-model');
  if (!sel) return;
  const models = [...new Set(_detailState.data.map(e => e.model).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">全部模型</option>' + models.map(m =>
    `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`
  ).join('');
  // Reset model filter if current selection no longer valid in new data
  if (current && !models.includes(current)) {
    _detailState.filterModel = '';
  }
}

function applyDetailFilters() {
  let filtered = _detailState.data;
  if (_detailState.filterModel) {
    filtered = filtered.filter(e => e.model === _detailState.filterModel);
  }
  if (_detailState.filterStatus) {
    const s = _detailState.filterStatus;
    if (s === 'success') filtered = filtered.filter(e => e.status >= 200 && e.status < 300);
    else if (s === '4xx') filtered = filtered.filter(e => e.status >= 400 && e.status < 500);
    else if (s === '5xx') filtered = filtered.filter(e => e.status >= 500);
  }
  _detailState.filtered = filtered;
  _detailState.page = 1;
  renderDetailTable();
}

function renderDetailTable() {
  const tbody = document.getElementById('detail-table-body');
  if (!tbody) return;
  const { page, pageSize, filtered } = _detailState;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-3);padding:24px;">暂无匹配记录</td></tr>';
    const pg = document.getElementById('detail-pagination');
    if (pg) pg.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(filtered.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageData = filtered.slice(start, start + pageSize);

  tbody.innerHTML = pageData.map(e => {
    const sc = e.status >= 200 && e.status < 300 ? 'var(--green)' : e.status >= 500 ? 'var(--red)' : 'var(--orange)';
    const sbg = e.status >= 200 && e.status < 300 ? 'rgba(46,160,67,0.1)' : e.status >= 500 ? 'rgba(248,81,73,0.1)' : 'rgba(242,159,57,0.12)';
    const cacheTotal = (e.cache_read_tokens || 0) + (e.cache_creation_tokens || 0);
    return `<tr>
      <td class="td-mono">${fmtDetailTime(e.time)}</td>
      <td>${e.model || '-'}${e.route ? `<br><span class="td-mono" style="font-size:10px;color:var(--text-3);">${e.route}</span>` : ''}</td>
      <td><span class="status-badge" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-weight:700;background:${sbg};color:${sc};">${e.status}</span></td>
      <td class="tar td-mono">${e.input_tokens != null ? fmtToken(e.input_tokens) : '-'}</td>
      <td class="tar td-mono">${e.output_tokens != null ? fmtToken(e.output_tokens) : '-'}</td>
      <td class="tar td-mono">${cacheTotal > 0 ? fmtToken(cacheTotal) : '-'}</td>
      <td class="tar td-mono fwb">${e.total_tokens != null ? fmtToken(e.total_tokens) : '-'}</td>
      <td class="tar td-mono">${e.duration || '-'}</td>
      <td>${e.client || '-'}</td>
      <td class="td-err" title="${(e.error || '').replace(/"/g, '&quot;')}">${e.error || ''}</td>
    </tr>`;
  }).join('');

  renderDetailPagination(totalPages);
}

function renderDetailPagination(totalPages) {
  const container = document.getElementById('detail-pagination');
  if (!container) return;
  const { page, filtered } = _detailState;

  let html = '<span class="pg-btn" data-page="' + (page - 1) + '" style="' + (page <= 1 ? 'opacity:0.3;pointer-events:none;' : '') + '">‹ 上一页</span>';

  const maxShow = 7;
  let sp = Math.max(1, page - Math.floor(maxShow / 2));
  let ep = Math.min(totalPages, sp + maxShow - 1);
  if (ep - sp < maxShow - 1) sp = Math.max(1, ep - maxShow + 1);

  if (sp > 1) {
    html += '<span class="pg-btn" data-page="1">1</span>';
    if (sp > 2) html += '<span class="pg-dots">…</span>';
  }
  for (let i = sp; i <= ep; i++) {
    html += '<span class="pg-btn' + (i === page ? ' pg-active' : '') + '" data-page="' + i + '">' + i + '</span>';
  }
  if (ep < totalPages) {
    if (ep < totalPages - 1) html += '<span class="pg-dots">…</span>';
    html += '<span class="pg-btn" data-page="' + totalPages + '">' + totalPages + '</span>';
  }

  html += '<span class="pg-btn" data-page="' + (page + 1) + '" style="' + (page >= totalPages ? 'opacity:0.3;pointer-events:none;' : '') + '">下一页 ›</span>';
  html += '<span style="font-size:11px;color:var(--text-3);margin-left:8px;">共 ' + filtered.length + ' 条 · 第 ' + page + '/' + totalPages + ' 页</span>';

  container.innerHTML = html;

  container.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= totalPages) {
        _detailState.page = p;
        renderDetailTable();
      }
    });
  });
}

function fmtDetailTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0') + ' ' +
    d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function exportDetailCSV() {
  const { filtered } = _detailState;
  if (!filtered || filtered.length === 0) return;

  const headers = ['时间', '模型', '状态', 'Input', 'Output', 'CacheRead', 'CacheCreate', 'Total', '延迟', '来源', '路由', '错误'];
  const rows = filtered.map(e => [
    e.time || '', e.model || '', e.status || '',
    e.input_tokens || 0, e.output_tokens || 0,
    e.cache_read_tokens || 0, e.cache_creation_tokens || 0,
    e.total_tokens || 0, e.duration || '',
    e.client || '', e.route || '',
    (e.error || '').replace(/"/g, '""')
  ]);

  const csv = '﻿' + [headers.join(','), ...rows.map(r => r.map(v => typeof v === 'string' && v.includes(',') ? '"' + v + '"' : v).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ocgt-history-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function clearDetailHistory() {
  if (!confirm('确定清除所有历史记录？此操作不可恢复。')) return;
  const base = getBaseURL();
  const headers = {};
  if (window.LOCAL_AUTH_TOKEN) headers['X-Ocgt-Local-Token'] = window.LOCAL_AUTH_TOKEN;
  const resp = await fetch(base + '/ocgt/api/history', { method: 'DELETE', headers });
  if (resp.ok) {
    _detailState.data = [];
    _detailState.filtered = [];
    renderDetailTable();
    const pg = document.getElementById('detail-pagination');
    if (pg) pg.innerHTML = '';
  }
}
