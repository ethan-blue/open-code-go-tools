# MVP Fix Queue

## P0: 前端构建与代码可用性保证
- **影响**: 代码需要没有 TS/构建错。
- **涉及文件**: `frontend/package.json`, 涉及报错的前端 ts/tsx。
- **修复方式**: 运行 `npx tsc --noEmit` & `npm run build`。
- **验证方式**: 已验证：`tsc --noEmit` exit 0, `npm run build` exit 0 且生成 dist。 (已通过测试，本阶段跳过，接下来修复 P1)

## P1: 安全设置（启用验证、请求限流）表单状态绑定与持久化
- **影响**: 前端 SecuritySection.tsx 开关处于静态硬编码，用户修改安全选项无法生效，保存也无法持久化。
- **涉及文件**: `frontend/src/pages/settings/SecuritySection.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/settings/types.ts`
- **修复方式**: 
  - 将 `auth_enabled` 和 `rate_limit` 相关的字段引入 FormState。
  - 在 SecuritySection.tsx 中将开关控件绑定至相应的 state 属性及 `onChange` 事件，废除硬编码的 `true` 和空函数。
- **验证方式**: `npm run build` 成功，打开设置页面时读取配置，修改后点击 Save 能保存，并在配置文件中能看到相应值被修改。

## P2: API 代理配置中的点击复制 Token 与替换 API 连接测试
- **影响**: 前端 ApiSection.tsx 中的「测试连接」、「复制」等按钮为硬编码或未完成状态，用户体验受损，无法获知代理是否可用。
- **涉及文件**: `frontend/src/pages/settings/ApiSection.tsx`
- **修复方式**: 
  - 实现 Clipboard API 复制 Token 并在成功后短暂提示已复制。
  - 调用 Wails API 测试当前 API 连通性，按钮处于 loading 状态，完成后显示 success/error 状态。
- **验证方式**: 界面能复制 Token，测试连接按钮有 Loading/Success/Error 的完整状态流。
