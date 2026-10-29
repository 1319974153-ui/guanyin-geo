# 下载与使用

更新：2026-10-29。当前推荐 **0.49.0-beta.3 · Mac 桌面开发预览**，没有稳定版。

## 下载

- [Mac Apple Silicon 安装包](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.3/GuanyinGEO-0.49.0-beta.3-mac-arm64.zip)
- [SHA-256 校验文件](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.3/GuanyinGEO-0.49.0-beta.3-mac-arm64.zip.sha256)
- [最终包验证记录](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.3/verification-0.49.0-beta.3.json)
- [发行说明](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.3) · [对应源码](https://github.com/1319974153-ui/guanyin-geo/tree/v0.49.0-beta.3)

包内含运行时，解压后打开“观引桌面预览.app”，无需 npm、Codex 或浏览器插件。未公证；系统阻止打开时请保留提示反馈，不关闭安全保护。Windows、Intel Mac、Linux 本轮没有新桌面包。

## 使用

1. 填写品牌名称和介绍。
2. 在产品内连接自己的文本模型，确认费用后自动生成文章并核对。未配置模型不调用。
3. 登录已支持的平台账号，勾选可用账号，保存平台草稿或发布。
4. 查看原稿与各平台状态。草稿、已提交、公开已核验是不同结果；未知结果先核对，不重复投稿。

正常升级：先保存内容并退出旧桌面，再打开新版。默认复用系统应用数据目录中的 GuanyinGEO-Desktop-Preview，保留原账号、稿件和回执。不要把个人数据目录、密钥、令牌上传 GitHub。旧浏览器版需通过业务备份迁移，登录不在不同运行环境间自动通用。

## 本版验证范围

1014 项自动测试通过。最终 ZIP 已完成中文空格路径解压、启动、品牌保存、模型未配置提示、正常退出释放端口和重启保留。安装更新后原 8 个账号记录、6 篇内容和 13 条发布任务保留。

新增掘金纯文本草稿实测、通用 MetaWeblog 接口和账号布局优化；掘金公开发布与图片未开放，MetaWeblog、WordPress、Typecho 真实兼容站点仍待验收。静态个人官网使用独立已配置的通道。其余平台能力见对应版本的逐平台文档，36 个目录入口不等于全部支持自动发布。

SHA-256：`32322aa3c79273a7437e677259dab2b29698991eadede8c6a571a5953468975f`。大小 123,618,976 字节。

桌面实现仍在 PR #2，未合并主分支。复现本安装包请使用 v0.49.0-beta.3 标签，对应提交 f82c9af39c7998813e78bada8efc0cfbc45e9191。旧 beta.2 暂留作回退。
