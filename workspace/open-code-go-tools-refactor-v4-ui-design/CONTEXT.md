# Project Context — OCGT (Open Code Go Tools)

## Glossary

### SyncData（同步数据）
各 OCGT 实例推送到 Hub 的**汇总使用数据**，仅包含聚合数值，不包含请求明细。按 `today`（当日 00:00 起）、`month`（当月 1 日起）、`allTime`（首次使用起累计）三个时间段组织，每个时间段内按 `model`、`route`、`client` 三个维度拆分统计。

### Hub（同步中心）
接收各设备推送的 SyncData，汇总后通过 SSE 实时分发给已连接的设备。有三种部署形态：内嵌 Hub（嵌入 OCGT 进程）、独立 Hub（独立 Go 二进制进程）、Cloudflare Worker Hub。

### Device（同步设备）
每个运行 OCGT 并启用了同步功能的实例。通过 `deviceId`（自动生成 UUID）唯一标识，可选 `displayName`（自定义名称，如"家里台式机"）用于界面展示。设备超过 `staleAfterMs`（默认 10 分钟）未推送数据时标记为离线，但历史数据不删除，重新上线后自动恢复活跃状态。

### Device Display Name（设备显示名称）
用户在 OCGT 设置中为设备自定义的人类可读名称（如"家里台式机"、"MacBook Pro"）。与 `deviceId`（UUID）解耦，可随时修改不影响数据归属。

### Stale Device（离线设备）
超过 `staleAfterMs` 时间未向 Hub 推送数据的设备。数据仍保留，统计汇总中仍计入，但界面显示离线标记。设备重新推送后自动变为在线。

### Push Interval（推送间隔）
设备向 Hub 推送 SyncData 的时间间隔。默认 2 分钟，可在 30 秒到 30 分钟之间配置。

### Sync Counter（同步计数器）
OCGT 进程中维护的内存计数器，每处理完一个代理请求后递增。包含 today/month/allTime 三个时间段的累计值，按 model/route/client 维度细分。周期性持久化到磁盘文件以支持进程重启恢复。**allTime 永不重置，只增不减。**

### Auth Secret（同步密钥）
设备连接 Hub 时使用的共享密钥，通过 `Authorization: Bearer <secret>` 或 `X-OCGT-Secret` 请求头传递。

### Session（会话）
属于同一轮对话的一组请求。OCGT 通过读取工具日志文件（如 `~/.claude/projects/*.jsonl`）中的 `sessionId` 字段来获取真实会话 ID，而非从代理请求中推断。会话数据作为现有代理数据的补充维度，不替代现有的请求级记录。
