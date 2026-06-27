# UI_GUIDELINES

本项目的视觉规范高度参考 `frontend/111111/index (1).html` 的 Geist-like 暗色卡片结构。

## 1. 布局与间距
- 页面必须保持双栏布局（左侧 `.sec-nav`，右侧滚动内容区）。
- 卡片（Card）样式统一使用 `v4-design.css` 声明的卡片边框、底色及边角弧度。

## 2. 状态反馈规范
- **Loading**: 按钮在点击（如“测试连接”、“导入备份”）时，必须显示 `Spinner` 或 `loading...` 文本，并置灰 `disabled`。
- **Success/Error**: 操作成功后，显示绿色的 Toast 或状态图标；失败时显示红色的 Inline Error 信息，避免弹窗打断用户流。
- **Unsaved State**: 如果表单 `dirty`，顶部必须滑出带 `.tag.amber` 的「未保存配置」警示条，提供「Discard」与「Save Profile」按钮。
