# 写作与分发
Mode: Operate
Build path: code-led
Primary target: public/article-editor.js
Related targets: public/article-distribution.js, public/article-editor.css

继承观引黑曜折光视觉和现有编辑抽屉；不替换品牌风格。用户已明确采用写文章/导入、勾选真实平台账号、保存草稿或发布、查看各平台结果的操作流程，并要求直接推进。

正文与排版预览保持首屏主体，接着是账号选择与逐平台结果。同一页面完成文章和发送，避免另开多步发布抽屉。账号按能力开放操作，不把待接入平台伪装成可发布。空状态直接引向连接账号。WordPress 支持草稿与发布；CSDN 当前仅账号核验和填稿。

保存本机草稿与保存平台草稿明确区分。发送前确认来源和 AI 声明；管理员可确认当前版本，普通编辑仍遵循审核权限。结果未知不重发，失败不掩盖其他账号成功回执。触屏和键盘可选账号，窄屏按自然顺序单列排列。

## 2026-10-19 实现证据与合规记录

本次为既有 Operate 页面的 code-led 扩展。核对 `public/article-editor.css`、`public/article-editor.js`、`public/article-distribution.js` 后，新增账号行、确认区和逐平台结果继续使用共享 surface、line、muted、accent、pale 与 hover 语义色和原有按钮；未建立新视觉体系。`DESIGN.md` 与 `.impeccable/design.json` 保持原样。

已检查截图 `output/观引一键社交发布-2026-10-19/统一写作-桌面完整.png` 与 `统一写作-手机操作.png`（位于 GEO 主工作区）。桌面证据展示正文与预览并列；手机证据展示账号、确认声明、纵向操作以及可见键盘焦点。CSDN 仅开放填入编辑器，保存平台草稿与发布操作显示禁用。截图属于隔离环境 UI 验收，不证明外部投稿或公开发布成功。最终 reviewer disposition 为 ship，仅覆盖本轮 UI 范围。

`/tmp/guanyin-distribution-detect.json` 记录 5 条字号 advisory：原编辑器已有 23px、11px 与手机标题 18px；本次分发标题 18px、账号名称 15px。11px、18px 在 DESIGN.md 正文已有用途说明，但未进入 frontmatter 字阶；23px 与 15px 仍是局部字阶偏差。新增导入/账号焦点使用 accent 与 2–3px offset，也与全局 focus-edge / 4px offset 记载不同。以上作为现存局部偏差报告，不在本次记录任务中修复或提升为系统 token。
