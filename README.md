<p align="center"><img src="docs/images/guanyin-banner.svg" alt="观引 GEO：品牌资料、AI 写作、内容发布、结果追踪" width="100%"></p>

<p align="center"><strong>把品牌资料、内容创作与发布结果，放进一个工作台。</strong></p>
<p align="center"><a href="https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.3">下载 Mac 桌面测试版</a> · <a href="docs/DOWNLOAD.md">安装与使用</a> · <a href="https://wenshu.tnyma.com/cases/guanyin-geo.html">了解观引</a> · <a href="https://github.com/1319974153-ui/guanyin-geo/issues/new/choose">问题反馈</a></p>

## 观引是什么？

观引是面向品牌、产品与个人的开源 GEO 工作台：整理真实资料，用自己的模型辅助写稿，选择已接入的账号发送内容，再核对平台回执和 AI 回答中的引用。

**源码免费，MIT 许可。** 模型调用、云服务与第三方平台费用按你自己的账号计费；本地运行不需要 Codex。

## 从资料到结果，四步完成

| 步骤 | 你可以做什么 |
|---|---|
| **01 建立品牌** | 填写名称与介绍，补充可公开核实的项目、资料和来源 |
| **02 准备内容** | 连接自己的文本模型，确认调用费用后生成稿件与检查结果 |
| **03 选择平台** | 在免插件桌面版登录账号，勾选支持的渠道，保存草稿或发布 |
| **04 查看结果** | 分别查看草稿、已提交、公开已核验状态，保存真实 AI 回答与引用 |

**各平台能力不同。** 平台目录不代表全部已接通；遇到登录验证、审核或结果未知时，保留原任务，不自动重复发布。具体状态见[平台能力与验收状态](docs/平台能力与验收状态.md)；下载包以对应发行说明为准。

当前开发分支为 **0.49.0-beta.5**，正在完善对话选题、文章质检与改稿、统一平台发送、GEO 诊断和配图备份。**分支里的实现与隔离测试不等于已发布安装包或全平台真实验收。**

## 下载与开始

当前已公开的最新安装包：**0.49.0-beta.3 · Mac 桌面预览**。开发分支的 beta.5 功能尚未作为正式发行包发布。

- **Apple Silicon Mac：**[下载安装包](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.3/GuanyinGEO-0.49.0-beta.3-mac-arm64.zip)，解压后打开“观引桌面预览.app”。
- **Windows x64：**开发分支已具备桌面构建与打包，仍待本轮真机验收；当前没有该版公开下载。Intel Mac / Linux 暂无本轮桌面包，可查看[源码运行说明](docs/LOCAL-RUNNING.md)。
- **先看看工作方式：**[离线演练](docs/FIRST-RUN.md)不需要模型密钥，不消耗付费调用。

这是尚未公证的开发测试版，没有稳定版。下载校验、升级步骤与当前验证范围集中在[下载指南](docs/DOWNLOAD.md)。

## 数据和效果如何判断？

- 资料、模型配置与发布账号由你管理；正常桌面更新保留原本机资料。
- 模型 API 测试与消费者 AI 搜索分开记录，演练数据不进入正式效果统计。
- 发布、收录、引用、主动推荐是不同结果；观引帮助记录和验证，不保证排名或推荐。

<details>
<summary><strong>开发者入口与详细文档</strong></summary>

- [本地源码运行](docs/LOCAL-RUNNING.md) · [离线演练](docs/FIRST-RUN.md)
- [桌面测试版对应源码](https://github.com/1319974153-ui/guanyin-geo/tree/v0.49.0-beta.3) · [桌面版使用说明](https://github.com/1319974153-ui/guanyin-geo/blob/v0.49.0-beta.3/docs/免插件桌面版使用说明.md)
- [主分支使用说明](public/docs/当前版本与使用说明.md) · [主分支验收矩阵](public/docs/功能验收矩阵.md)
- [费用说明](docs/FREE-AND-COSTS.md) · [参与贡献](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

既有免插件桌面改造见 [PR #2](https://github.com/1319974153-ui/guanyin-geo/pull/2)。当前开发分支的后续改进以[完整落地计划](docs/产品完整落地开发计划.md)与验收记录为准；复现已公开安装包时，请使用对应版本标签。

</details>

---

由 **[温舒｜杭州 FDE · GEO 践行者](https://github.com/1319974153-ui)** 维护。 [项目职责](docs/PROJECT-AND-MAINTAINER.md) · [个人官网](https://wenshu.tnyma.com/) · [沟通合作](https://wenshu.tnyma.com/contact.html)

自有代码遵循 [MIT 许可证](LICENSE)。文档由 AI 辅助整理，维护者负责核对公开内容。
