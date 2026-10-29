# 下载与使用

更新：2026-10-28。发行页仅保留 **0.49.0-beta.2 · Mac 桌面预览 r63**；当前没有稳定版。

## 下载安装

| 文件 | 用途 |
|---|---|
| [Mac Apple Silicon 安装包](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.2/GuanyinGEO-0.49.0-beta.2-mac-arm64-r63.zip) | M 系列芯片 Mac，解压后打开“观引桌面预览.app” |
| [SHA-256 校验文件](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.2/GuanyinGEO-0.49.0-beta.2-mac-arm64-r63.zip.sha256) | 检查下载完整性，普通使用无需打开此文件 |
| [验证记录](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.2/verification-0.49.0-beta.2.json) | 构建版本、测试范围和限制 |

[完整发行说明](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.2) · [对应源码](https://github.com/1319974153-ui/guanyin-geo/tree/v0.49.0-beta.2) · [桌面使用说明](https://github.com/1319974153-ui/guanyin-geo/blob/v0.49.0-beta.2/docs/免插件桌面版使用说明.md)

包内已含运行时，不需要安装 npm、Codex 或浏览器扩展。本版尚未公证，属于开发预览；如果系统阻止打开，请保留提示反馈，不关闭系统安全保护。

Windows、Intel Mac、Windows ARM 与 Linux 本轮没有对应的新桌面包；旧版安装包已从发行页移除。源码仍可按[本地运行说明](LOCAL-RUNNING.md)使用，不把旧版当成本轮已验收的新版。

## 首次使用

1. 填写品牌名称与一句介绍；个人、产品和企业都可作为品牌。
2. 补充事实和来源；需要自动写稿时，在产品内连接自己的文本模型。
3. 查看生成计划及费用，确认后生成内容并核对稿件。
4. 登录支持的发布账号，勾选渠道并选择保存草稿或发布。
5. 查看逐平台结果；审核中或结果未知时先核对原任务，不重复投稿。

模型密钥不要提交到 GitHub 或发送给维护者。未配置模型也可使用离线演练，或导入自己已有的内容。

## 升级与资料

- **已有免插件桌面预览**：先保存稿件并退出旧程序，再打开新版。默认复用系统应用数据目录中的 `GuanyinGEO-Desktop-Preview`，保留原账号记录、稿件和回执。
- **旧版浏览器启动包**：先通过产品导出业务备份，再在新桌面版恢复支持的业务资料；不同运行环境的登录状态不能当作自动通用，必要时在新应用登录自己的账号。
- 不把程序目录中的源码备份当作业务备份，也不要公开资料目录或其中的密钥。

Mac 校验命令：

```sh
shasum -a 256 GuanyinGEO-0.49.0-beta.2-mac-arm64-r63.zip
```

期望 SHA-256：`f09c652617d1475a4489eb4ea7de93839d2becede0b37b0790fc2c417c55bd07`。

## 本版验证范围

941 项完整回归测试通过；最终知乎图标兼容修复另有 10 项定向测试通过。Mac 最终归档完成干净解压、启动、品牌保存、重启、未配置模型阻断和退出检查。Windows 本轮未构建、未验收。

各平台能力分别验收。知乎新增匿名核验仍待取得真实通过结果；CSDN 原公开任务仍为结果未知；阿里云当前仅草稿能力，头条、抖音、小红书等仍有账号或实机限制。**35 个目录项不等于 35 个平台均可一键公开发布。**

## 源码版本

主分支保留 0.48.2 代码与离线演练，桌面测试版实现尚在 PR #2。复现本下载包请使用 `v0.49.0-beta.2` 标签，对应提交 `03a3eb4edf4c9eb17dac0b147cdded8deb0fdf9f`。删除旧 Release 不会清除源码提交历史。
