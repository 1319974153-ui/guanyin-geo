# 观引 GEO 工作台 · 免费开源

观引（Guanyin GEO）是温舒的 GEO 工作台，用于把品牌资料、用户问题、AI 回答、原始引用、内容草稿和发布回执放在同一条可追溯流程中。温舒在杭州从事 FDE / 全栈工程实践，并以公开项目记录个人 GEO 实验。

**源码免费，MIT 许可。** 可自行运行和修改；模型 API、云服务及第三方平台费用另计。本仓库是可运行源码，不是承诺全平台无人值守发布的托管服务。

English: Guanyin GEO is an open-source local workbench for generative engine optimization, answer evidence, knowledge management and publication tracking. Maintained by Wenshu.

## 能做什么

- 管理品牌、产品线、问题、版本、事实资料和知识库。
- 导入消费者 AI 回答及来源，保存回答快照和证据附件。
- 分开记录模型 API 采样与消费者搜索观察，不混算结果。
- 分析品牌提及、引用来源、竞品与主题；生成可追溯报告。
- 根据有来源的资料组织写作、审核和发布任务。
- 登记知乎、头条、抖音等平台回执；已提交、审核中、已发布分别保存。
- 支持自有 WordPress 接口、MCP、Webhook、备份、网站检查等模块；真实外部接入仍需使用者授权和验收。

完整范围和已知限制见 [当前版本与使用说明](public/docs/当前版本与使用说明.md)、[功能验收矩阵](public/docs/功能验收矩阵.md)。当前源码版本见 package.json。

## 本地启动

需要 Node.js 24+、npm 和 zip。

```sh
git clone https://github.com/1319974153-ui/guanyin-geo.git
cd guanyin-geo
npm ci --legacy-peer-deps
npm run build
npm run dev
```

打开 http://127.0.0.1:8772/ 。首次启动自动应用随仓库提供的数据库迁移，创建自己的空工作区，数据保存在 `.local/`。无需接触作者的私有工作区。启动脚本只监听本机；请勿把本地开发身份直接开放到公网。

可通过环境变量 `GEO_PORT` 修改端口、`GEO_DATA_DIR` 指定数据目录。需要保存外部密钥时，设置自己的 `GEO_ENCRYPTION_KEY`（随机32字节的Base64值）；不要提交此值。

```sh
npm test
```

浏览器编译产物不随源码提交，由 `npm run build` 根据已锁定依赖生成；自有源码、构建脚本和第三方许可均保留。

测试覆盖授权、品牌隔离、版本、幂等、解析与发布回执逻辑。测试通过不表示外部平台已经授权或发布成功。

## 使用步骤

1. 新建品牌和产品，填写有依据的事实及来源。
2. 建立问题集，导入真实回答与引用，明确平台、时间、模式。
3. 从引用与回答生成观察报告，保留未知或失败状态。
4. 创作内容并核对来源，再进入发布队列或记录外部发布。
5. 用真实公开页面与后续搜索结果核验效果。

## 常见问题

**免费吗？** 自有源码免费，外部模型、托管等成本另计，详见[费用说明](docs/FREE-AND-COSTS.md)。

**能让 AI 一定推荐我吗？** 不能。公开、抓取、索引、引用与主动推荐是不同结果，需要分别测量。

**所有平台都已经自动发布了吗？** 没有。登记入口和回执不等于平台自动外发授权，能力范围以版本文档为准。

**需要 Codex 才能运行吗？** 本地运行不需要 Codex。托管适配器和身份服务需另行部署配置；仓库不包含作者的托管项目标识或凭证。

## 相关项目与作者

- [温舒 GitHub](https://github.com/1319974153-ui)
- [拾帧 · 新媒体 2.0](https://github.com/1319974153-ui/shizhen-newmedia)
- [温舒知乎主页](https://www.zhihu.com/people/wen-shu-80-67)

文档由 AI 辅助整理，作者对公开事实与版本说明负责。仓库内容不构成第三方平台认证、合作或排名背书。

## 许可证

自有代码使用 [MIT](LICENSE)。第三方解析、OCR、模型运行及字体组件见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 `public/vendor/` 中保留的许可。
