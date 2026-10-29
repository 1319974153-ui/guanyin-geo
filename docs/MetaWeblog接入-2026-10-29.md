# MetaWeblog 接入（开发验收）

用户目标：自有博客连接一次后，在观引勾选账号保存平台草稿或发布；用户自己的凭据加密保存在工作区，不依赖 Codex 或浏览器插件。

本轮范围：复用 Typecho 的单次写入、回执保存及失败恢复机制，支持同源 HTTPS 的 MetaWeblog XML-RPC 接口。先用模拟 RPC 回执的隔离自动测试验收；没有真实兼容站点时明确标注待实测。温舒个人官网是静态发布通道，不替换为 WordPress/Typecho。

兼容条件：blogger.getUsersBlogs、blogger.getUserInfo、metaWeblog.newPost/getPost/getRecentPosts/editPost；必须提供文章作者、标题、完整正文、明确 draft/publish 状态。仅有通用接口名称不能保证所有实现兼容。图片上传暂不纳入。

公开发布先创建非公开草稿并核对，随后只修改该草稿；写入结果未知只读核对，不再次写入。编辑成功回执不等于公开成功；匿名页完整正文核对通过才显示发布成功。主题不匹配时保留已提交状态。

协议依据：WordPress 官方 mw_newPost 与 mw_editPost 文档；通用 editPost 成功返回布尔 true，Typecho 保留其文章编号回执差异。
- https://developer.wordpress.org/reference/classes/wp_xmlrpc_server/mw_newpost/
- https://developer.wordpress.org/reference/classes/wp_xmlrpc_server/mw_editpost/

## 本轮验证与交付边界

- 完整自动测试：1012 项通过；随后增加大整数文章编号拒绝用例并复测博客协议与队列相关测试。
- 桌面开发构建通过；未替换正在运行的用户桌面，未发布新的安装包。
- 独立工作区浏览器验收：品牌建档、账号管理、连接其他博客表单与按钮布局通过。
- MetaWeblog 真实网站：待验收；所有本轮 RPC 回执由测试夹具提供，没有公开发文。
- 个人官网沿用既有静态网站发布适配器，现有桌面显示历史发布成功回执；不把它算作 WordPress 或 Typecho 验收。
- 同时修复掘金在发布中心缺少连接按钮的问题。
