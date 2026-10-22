# 观引 GEO · 把 AI 回答和引用变成可核对的记录

**面向品牌、产品、个人与内容团队的开源本地工作台。** 当你想知道“AI 有没有提到我、引用了哪里、发布后发生了什么”，观引帮助你整理问题、保存原回答、核对来源，再导出报告。

[开始离线演练](docs/FIRST-RUN.md) · [下载与版本选择](docs/DOWNLOAD.md) · [项目介绍](https://wenshu.tnyma.com/cases/guanyin-geo.html) · [反馈问题](https://github.com/1319974153-ui/guanyin-geo/issues/new/choose)

**自有源码免费，MIT 许可；外部模型、云服务与素材费用另计。** 离线演练不需要模型密钥或付费服务。

## 先试一次：导入回答 → 核对引用 → 导出报告

准备 Node.js 24+，在终端运行：

```sh
git clone https://github.com/1319974153-ui/guanyin-geo.git
cd guanyin-geo
node examples/first-run/run.mjs
```

无需安装 npm 依赖。程序调用本仓库的回答导入与报告逻辑，读取一份明确标注的构造样本，在系统临时目录输出回答、核对结果和 Markdown 报告；不连接外部 AI，不写入你的工作区。

你会看到：两条重复来源合并为一条、原回答与历史问题得到保留、未核对的推荐状态保持未知。**正式报告样本数为 0 是预期结果**：演练资料不会混进真实效果统计。[逐步说明与预期结果 →](docs/FIRST-RUN.md)

## 我该下载哪个版本？

截至 2026-10-22，公开发行均为**预发布版本，尚无稳定版**。

| 使用目的 | 入口 | 已知范围 |
|---|---|---|
| 体验最新公开安装包 | [0.49.0-beta.1 测试版](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.1) | Mac ARM64 包已有干净解压验证记录；Windows 桌面验收待完成 |
| 查看旧版或回查历史 | [0.48.2 旧预发布版](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.48.2) | 旧版本，不作为最新下载入口 |
| 阅读或运行源码 | [本地运行说明](docs/LOCAL-RUNNING.md) | 主分支源码仍为 0.48.2；0.49.0-beta.1 源码在对应标签 |

[下载指南](docs/DOWNLOAD.md)集中列出安装包、校验文件、升级步骤与验证边界。不要把测试版用于未经验证的生产交付。

![观引 0.48.2 界面示意，非最新测试版截图](docs/images/nocturne-0.48.2.png)

*截图来自 0.48.2，用于展示工作台布局；请以所用版本实际界面为准。*

## 哪些工作适合放进观引？

| 你的问题 | 工作台提供的记录 |
|---|---|
| 同一个问题在不同 AI 上怎么回答？ | 问题版本、平台、模式、采集时间与原回答 |
| 回答提到品牌，是否真的推荐或引用？ | 引用链接及人工核对状态；未知项保留未知 |
| API 测试与消费者搜索能否放一起算？ | 分开记录来源与用途，演练数据排除于正式指标 |
| 内容发出去了吗？ | 草稿、提交、审核、公开页面与后续核验分别记录 |

适用于产品、品牌，也适用于个人。完整能力见[使用说明](public/docs/当前版本与使用说明.md)与[验收矩阵](public/docs/功能验收矩阵.md)，具体发行差异以下载指南和该版发布说明为准。

## 使用边界

- 消费者 AI 搜索需要实际提问、采集与核对；模型 API 回答不能代替消费者端搜索。
- 平台接入目录不代表已完成全平台一键发布。0.49.0-beta.1 的最终自动提交保持关闭，部分连接器仍待实测。
- 本地版是单用户实例；不要直接把本地开发身份开放到公网。
- 发布、收录、引用、主动推荐是不同结果，观引不保证 AI 推荐或排名。

## 反馈与参与

先完成一次[离线演练](docs/FIRST-RUN.md)，再按需要尝试安装包。卡住时可[提交问题](https://github.com/1319974153-ui/guanyin-geo/issues/new/choose)，记录版本、系统、操作步骤及预期结果；不要上传密钥或客户原文。

如果项目对你有帮助，欢迎在页面右上角点 **⭐ Star** 收藏，便于以后找到。Star 不等于实际使用或客户认可，也不是获取支持的条件。[首次试用反馈说明 →](CONTRIBUTING.md)

## 维护者与许可

维护者：**温舒｜杭州 FDE · GEO 践行者**。项目职责与公开依据见[维护者说明](docs/PROJECT-AND-MAINTAINER.md)。

English: Guanyin GEO is an open-source local workbench for recording AI answers, checking citations and tracking publication receipts. Try the offline example without API keys. Public downloads are prereleases; no recommendation or ranking is guaranteed.

自有代码使用 [MIT](LICENSE)，第三方组件见[第三方声明](THIRD_PARTY_NOTICES.md)。[费用说明](docs/FREE-AND-COSTS.md)。文档由 AI 辅助整理，维护者负责核对事实与版本范围。
