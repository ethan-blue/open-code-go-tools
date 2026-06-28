# ocgt 版本号管理规范

## 版本号格式

```
v<MAJOR>.<MINOR>.<PATCH>
```

| 位 | 什么时候动 | 例子 |
|---|---|---|
| **MAJOR** | 架构大改、不兼容旧配置、整体重写 | v2 → v3 |
| **MINOR** | 新功能、新模块（Hub 同步、会话追踪等） | v2.2 → v2.3 |
| **PATCH** | Bug 修复、文案改动、小调整 | v2.2.1 → v2.2.2 |

## 发版规则

### 谁能发版

只有 **Ethan（ethan-blue）** 负责打 tag 和发 Release。其他人通过 PR 提交，merge 后等 Ethan 打 tag。

> xthh（xxtt-01）有 write 权限，可以推代码和提 PR，但不要自己打 tag。

### 打 tag 前的检查清单

发版前必须确认以下 3 处版本号一致：

| 文件 | 字段 | 示例 |
|------|------|------|
| `internal/version/version.go` | `var Version` | `"2.2.1"` |
| `frontend/app.js` | `APP_VERSION` | `'v2.2.1'` |
| `wails.json` | `info.productVersion` | `"2.2.1"` |

```powershell
# 快速检查三处是否一致
Select-String -Path internal/version/version.go, frontend/app.js, wails.json -Pattern "2\.2\.1"
```

不一致就别打 tag。

### 打 tag 流程

```powershell
# 1. 确认本地是最新的（rebase 别人的提交）
git pull --rebase origin main

# 2. 确认三处版本号已改好，build 通过
go build ./...

# 3. 提交版本号变更
git add -A
git commit -m "release: vX.Y.Z - <一句话描述>"

# 4. 打 tag（不要加 --annotate 的额外信息，commit message 已经够了）
git tag vX.Y.Z

# 5. 先推 main，再推 tag
git push origin main
git push origin vX.Y.Z
```

推 tag 后 CI 会自动构建三平台并创建 Release。**不要本地手动删 tag 重打**，除非 CI 挂了。

### CI 挂了怎么办

1. 看日志：`gh run view --log-failed`
2. 如果是构建错误（代码问题）→ 修代码 → 新 commit → 删旧 tag 重打
3. 如果是 CI 配置问题（路径不对等）→ 修 workflow → 新 commit → 删旧 tag 重打
4. 删 tag：`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`

## 防撞版规则

### 发版前必须 rebase

```powershell
git pull --rebase origin main
```

有冲突就解决冲突，不要 force push 覆盖别人的工作。

### 不要跳版本号

- 远端最新是 `v2.2.0` → 下一个 PATCH 是 `v2.2.1`，不是 `v2.0.6`
- 发版前看一眼 `git tag --sort=-v:refname | head -3` 确认最新版本

### 同一时间只有一个发版人

如果 Ethan 在发版，其他人暂停推 main 分支。通过群里/频道喊一声。

## Git 提交身份规范

每个提交者应该用自己真实的 GitHub 邮箱，不要混用：

```powershell
git config user.name "xthh"
git config user.email "your-github-email@example.com"
```

如果用 AI agent 辅助开发，不要让 agent 用 `dev@xxx.local` 这种邮箱提交——改成你的名字，或者明确标注是 agent 辅助。

## 分支策略（简单版）

- **main** — 稳定发版分支，只接 PR 或 rebase 后的推送
- **feature/xxx** — 新功能分支，开发完提 PR 回 main
- **fix/xxx** — Bug 修复分支

hotfix 可以直接在 main 上改，但发版要走 tag 流程。
