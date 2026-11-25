# 安装与使用 · Install and use Guanyin GEO

**桌面预览 · Desktop preview 0.49.0-beta.7**<br>
[下载安装包与 SHA-256 校验文件 · Download packages and checksums](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.7)

| 系统 · System | 打开方式 · How to launch |
| --- | --- |
| Apple Silicon Mac | 完整解压，打开 `观引桌面预览.app`。Extract the ZIP and open the app. 此预览包未经 Apple 公证。The preview is not notarized. |
| Windows x64 | 完整解压，双击 `启动观引.cmd`。Extract the ZIP and double-click the launcher. 已做静态校验，Windows 真机启动待验收。The package passed static checks. Launch on a Windows machine is pending verification. |

安装包自带运行环境。The desktop packages include the runtime.<br>
[Intel Mac / Linux 源码运行指南 · Run from source](LOCAL-RUNNING.md)

## 第一次使用 · Your first session

1. **建立品牌 · Add a brand**<br>
   输入名称和一句介绍，个人、产品或企业都可以作为品牌。<br>
   Enter a name and a one-line description for a person, product, or company.

2. **查询回答 · Look up a question**<br>
   在「快速搜索」输入客户会问的问题，选择可用平台并开始查询。若平台要求登录，请在其官方窗口完成。点击查询结果，在「对话详情」中对照回答原文和引用链接。<br>
   In **快速搜索** (Quick Search), enter a customer question and select a supported AI platform. Sign in to its official window if prompted. Open a result to read the answer and follow its source links.

3. **写稿与质检 · Draft and review**<br>
   添加至少一条已确认、有出处的品牌资料。在「AI 写作模型」选择本机 Ollama 已安装的文本模型，或连接自己的云端模型。从查询结果点击「生成文章并质检」，查看调用计划并确认，再核对草稿和事实依据。<br>
   Add at least one verified brand fact with a source. In **AI 写作模型** (Writing Model), choose an installed Ollama model or connect your cloud provider. From a query result, select **生成文章并质检** (Generate and review), confirm the model calls, and review the draft against the evidence.

4. **发布与回执 · Publish and track**<br>
   审核稿件后进入「多平台发布」。首次使用先连接账号，再勾选支持所选操作的渠道，保存草稿或提交发布。结果不明时，先查看原任务的回执，以免重复发送。<br>
   After review, open **多平台发布** (Multi-platform Publishing). Connect an account and select channels that support your action. Save a draft or submit it, then check the original task’s receipt before retrying.

目录列出 36 个目标渠道，各渠道支持的操作取决于版本和账号权限，公众号完整自动发表仍待验收。客户模型的实际写作质量需用自己的品牌资料核对。<br>
The catalog lists 36 target channels. Available actions depend on the release and account permissions. End-to-end automatic publishing to WeChat Official Accounts is pending verification. Review the output of your chosen model against your own brand materials.<br>
[查看逐平台能力 · Check channel support](平台能力与验收状态.md)

## 更新与备份 · Updates and backups

- **更新 · Update.** 保存内容，正常退出旧版，再打开新版。同一系统用户继续使用 `GuanyinGEO-Desktop-Preview` 资料目录。请在桌面版内登录平台，密钥和登录资料仅由你管理。<br>
  Save your work and quit the old version before opening the new one. The same OS user keeps the same data directory. Sign in to each platform inside the desktop app and keep credentials private.
- **备份 · Back up.** 使用完整 ZIP 备份保留文章配图和附件。恢复到原工作区需要相应验证信息，跨电脑迁移请按随包说明操作。<br>
  Use the full ZIP backup to include images and attachments. Restoring the original workspace requires its verification details. Follow the packaged instructions when moving to a new computer.
- **定时发送 · Scheduling.** 六类 API 账号支持单次定时任务。正常重启后保留待执行任务，错过预定时间超过两分钟会跳过。真实平台到点发送待验收。<br>
  Six types of API-connected accounts support one-time scheduling. Pending jobs survive a normal restart. Jobs more than two minutes late are skipped. Live timed delivery still awaits verification.

[桌面使用手册 · Desktop manual](免插件桌面版使用说明.md) · [当前源码说明 · Source guide](../public/docs/当前版本与使用说明.md) · [历史下载说明 · Earlier download notes](history/DOWNLOAD-2026-11-13修订前.md)
