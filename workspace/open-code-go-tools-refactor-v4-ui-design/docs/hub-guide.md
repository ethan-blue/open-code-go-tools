# Hub 跨设备同步 — 使用指南

> 适用版本: ocgt v2.1.0+

---

## 概述

Hub 跨设备同步功能让你在多台电脑上运行 OCGT 时，能够在一台设备上查看所有设备的 Token 使用量汇总。

**工作原理：**

```
每台 OCGT 实例在内存中实时累加 token 用量
        ↓ 每 N 分钟推送一次
        中央 Hub（收集所有设备的汇总数据）
        ↓ SSE 实时推送
  各设备的 OCGT 仪表盘查看总汇总
```

**隐私说明：** 只同步聚合数字（总 tokens、总费用），**不传输任何请求明细、对话内容或 API Key**。

---

## 三种部署方案对比

| 方案 | 名称 | 适用场景 | 需要额外设备？ | 成本 |
|------|------|---------|--------------|------|
| **A** | 内嵌 Hub | 所有设备在同一个局域网 | 不需要 | ¥0 |
| **B** | 独立 Hub 进程 | 有一台 VPS/服务器 | 需要一台服务器 | ¥30~99/年 |
| **C** | Cloudflare Worker | 不想维护服务器 | 需要 Cloudflare 账号 | ¥0（免费额度够用） |

---

## 快速开始（方案 A：内嵌 Hub）

**适用场景：** 台式机、笔记本都在家里同一个 WiFi 下。

### 步骤 1：在主设备上启用 Hub

1. 打开 OCGT 桌面端
2. 点击右下角齿轮图标 → **偏好设置**
3. 找到 **跨设备同步** 区域
4. 勾选 **启用同步**
5. **Hub 地址** 留空（留空 = 本机作为 Hub）
6. 设置一个 **同步密钥**（如 `mypassword123`，其他设备连接时需要）
7. 设置 **设备名称**（如"家里台式机"）
8. 点击 **保存同步设置**
9. 重启 OCGT（当前版本保存配置后需要重启生效）

### 步骤 2：查看主设备 IP

在主设备上打开命令提示符（Win+R → 输入 `cmd`），运行：

```bash
ipconfig
```

找到 `IPv4 地址`，类似 `192.168.1.100`。

### 步骤 3：在其他设备上连接

1. 打开另一台电脑的 OCGT
2. 偏好设置 → **跨设备同步**
3. 勾选 **启用同步**
4. **Hub 地址** 填：`http://192.168.1.100:17321`（换成主设备的实际 IP）
5. 输入同样的 **同步密钥**
6. 设置不同 **设备名称**（如"办公笔记本"）
7. 保存 → 重启 OCGT

### 步骤 4：查看多设备数据

点击左侧导航栏的 **多设备同步**（Ctrl+6），即可看到所有设备的汇总数据：

- 多设备 Token 总计
- 多设备费用总计
- 在线设备列表（绿点 = 在线，灰点 = 离线）
- 模型用量分布柱状图

---

## 独立 Hub（方案 B：VPS/服务器）

**适用场景：** 有多台设备在不同网络（家里、办公室），有一台云服务器。

### 步骤 1：在服务器上启动 Hub

```bash
# 上传 OCGT 到服务器，然后运行：
./ocgt hub --port 17321 --secret "your-strong-secret"

# 推荐用 pm2 守护进程（断线自动重启）：
npm install -g pm2
pm2 start ./ocgt -- hub --port 17321 --secret "your-strong-secret"
```

### 步骤 2：配置防火墙

确保服务器的 17321 端口已放行：

```bash
# 腾讯云/阿里云等：在安全组中添加入站规则，TCP 17321
# 或使用 ufw：
ufw allow 17321
```

### 步骤 3：在各设备上连接

所有设备的 OCGT → 偏好设置 → 跨设备同步：
- **Hub 地址** 填：`http://你的服务器IP:17321`
- **同步密钥** 填：启动时设置的 secret
- 保存 → 重启

### 可选：配置 HTTPS（推荐）

使用 Nginx 反向代理 + Let's Encrypt：

```nginx
server {
    listen 443 ssl;
    server_name hub.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:17321;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Cloudflare Worker（方案 C）

**适用场景：** 不想维护服务器，全球可用，零费用。

### 前置条件

1. 注册 Cloudflare 账号：https://dash.cloudflare.com/signup（国内可访问，无需梯子）
2. Node.js 环境（用于部署工具）

### 部署步骤

```bash
# 1. 进入 Worker 目录
cd ocgt/worker

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare（浏览器会弹出授权窗口）
npx wrangler login

# 4. 设置同步密钥
npx wrangler secret put OCGT_HUB_SECRET
# 输入你的密钥（如 my-secret-key-2024）

# 5. 部署
npm run deploy
```

部署成功后，会输出一个 URL，如：
```
https://ocgt-hub.your-name.workers.dev
```

### 在各设备上连接

OCGT → 偏好设置 → 跨设备同步：
- **Hub 地址** 填：`https://ocgt-hub.your-name.workers.dev`
- **同步密钥** 填：上面设置的 `OCGT_HUB_SECRET`
- 保存 → 重启

### 如果 wrangler login 被墙

通过 Cloudflare Dashboard 手动部署：

1. 登录 https://dash.cloudflare.com
2. 进入 **Workers & Pages**
3. 点击 **创建 Worker**
4. 在编辑器中删除默认代码，粘贴 `worker/src/index.js` 的全部内容
5. 点击 **保存并部署**
6. 进入 **设置 → 变量**，添加 `OCGT_HUB_SECRET` 环境变量
7. 记下分配的 `*.workers.dev` 地址

---

## CLI 命令参考

### hub 子命令

```bash
# 启动独立 Hub
ocgt hub --port 17321 --host 0.0.0.0 --secret "your-secret"

# 参数说明：
#   --port    监听端口（默认 17321）
#   --host    监听地址（无 secret 时自动绑定 127.0.0.1）
#   --secret  认证密钥（建议设置，否则只允许本机连接）
#   --data    数据存储目录（默认 ~/.ocgt/）

# 查看帮助
ocgt hub --help
```

### 安全说明

- **不设 secret**：Hub 只监听 `127.0.0.1`，仅本机能连接
- **设了 secret**：Hub 监听 `0.0.0.0`，局域网/公网可连接
- 密钥长度建议 8 位以上

---

## 常见问题

### Q: 启用同步后需要重启 OCGT 吗？

是的，当前版本保存 Hub 配置后需要重启应用才能生效。后续版本会支持热重载。

### Q: 推送间隔设多长合适？

| 场景 | 推荐间隔 | 说明 |
|------|---------|------|
| 局域网 | 30 秒 | 网络开销极小，实时性高 |
| 公网 VPS | 2 分钟 | 兼顾实时性和带宽 |
| Cloudflare Worker | 2~5 分钟 | 减少 Worker 请求次数 |
| 有免费额度限制 | 5 分钟+ | 按需调整 |

### Q: 设备离线了数据会丢吗？

不会。设备标记为"离线"但历史数据永久保留。设备重新上线后自动恢复活跃状态。

### Q: Hub 服务器上的数据存在哪里？

- **方案 A/B**：`~/.ocgt/devices.json`（JSON 文件，可直接备份）
- **方案 C**：Cloudflare Durable Object SQLite（自动备份）

### Q: 可以同时使用多个 Hub 吗？

每台设备只能连接一个 Hub。但你可以在不同设备上运行不同的 Hub（互相独立）。

### Q: 我关了 OCGT，Hub 还能接收数据吗？

- **方案 A**：OCGT 关闭后 Hub 也停止，其他设备无法推送
- **方案 B**：独立进程不受影响
- **方案 C**：永远在线，不受任何设备影响

---

## 数据格式参考

### 推送的数据内容

每台设备向 Hub 发送的数据格式：

```json
{
  "deviceId": "ocgt-a1b2c3d4e5f6...",
  "displayName": "家里台式机",
  "hostname": "DESKTOP-PC",
  "platform": "windows",
  "version": "2.1.0",
  "today": {
    "totalTokens": 50000,
    "estimatedCost": 0.15,
    "byModel": { "deepseek-v4-flash": { "tokens": 30000, "cost": 0.05 } },
    "byRoute": { "anthropic": { "tokens": 50000, "cost": 0.15 } },
    "byClient": { "claude-code": { "tokens": 50000, "cost": 0.15 } }
  },
  "month": { "totalTokens": 500000, "estimatedCost": 2.50 },
  "allTime": { "totalTokens": 2000000, "estimatedCost": 10.00 }
}
```

**关键：** 推送的是 **汇总数字**，不是请求明细。隐私安全。

### Hub API 端点

| 端点 | 方法 | 说明 | 需认证 |
|------|------|------|--------|
| `/api/health` | GET | 健康检查 | 否 |
| `/api/stats` | GET | 聚合统计 | 是 |
| `/api/stats/stream` | GET | SSE 实时流 | 是 |
| `/api/devices` | GET | 设备列表 | 是 |
| `/api/devices/{id}` | DELETE | 删除设备 | 是 |
| `/api/ingest` | POST | 推送数据 | 是 |

---

## 升级注意事项

- 从 v2.0.x 升级到 v2.1.0 后，Hub 功能默认**不启用**
- 需要在偏好设置中手动开启
- 不影响现有代理功能
