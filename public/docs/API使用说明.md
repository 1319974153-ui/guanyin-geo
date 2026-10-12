# 观引 GEO 开放 API · 0.21

在「服务连接 → 开放 API」创建限品牌、限权限、限每日请求次数的 Key。原始 Key 仅显示一次；撤销立即生效，轮换新 Key 时旧 Key 同事务撤销。有效期最长 365 天。所有请求计入当日限额（UTC 日期）。

## 私有站点访问

此网站仍为私有。外部程序必须先通过 Sites 的服务访问边界，另在应用层传 `Authorization: Bearer <GEO_API_KEY>`。仅拥有 GEO Key 不会绕过网站登录保护。平台服务凭据只在受信任的服务端保管，不写入前端、源码、报告或聊天。

已登录的网页可在同源请求中使用 `x-geo-request: 1`；成员以服务端验证的登录邮箱识别，不接受客户端自报用户身份。`x-geo-workspace` 仅选择工作区，不授予权限。

## 读取授权资料

`GET /api/v1/state`，需要 `read` 权限。返回 `state` 与 `revision`，仅包含所授权品牌；不返回服务密钥、团队邮箱、审计或备份。

## 导入原始回答

`POST /api/v1/answers`，需要 `write` 权限。Content-Type 为 application/json。必要字段：

```json
{
  "brandId": "工作区内真实品牌 ID",
  "questionId": "该品牌的问题 ID",
  "externalId": "采集器生成的唯一记录 ID",
  "platform": "实际来源平台",
  "entry": "web",
  "mode": "快速 / 深度等实际模式",
  "region": "实际地区",
  "language": "zh-CN",
  "collectedAt": "2026-09-29T01:00:00.000Z",
  "text": "原回答全文",
  "citationKnown": true,
  "citations": [{"url":"https://实际被引用的页面","title":"原引用标题"}],
  "publicSearchProcess": "仅填前台公开展示的检索词/过程摘要"
}
```

entry 只支持 web / app / api。Web/App 进入导入样本层，API 进入模型测试层；不自动验证导入内容真实性。引用字段未观察到时 `citationKnown:false` 并留空 citations；不要把无权限读取当作零引用。推荐与情感标签默认待复核。相同品牌和 externalId 重复提交返回原 id，不新增样本。

## 错误与配额

- 400：字段不完整；401：密钥失效；403：无权限；404：授权范围内找不到记录；409：并发冲突；429：当日 Key 或工作区调用/容量限额；503：服务暂不可用。
- 工作区配额与 API 请求配额分别计算。模型调用失败和验证也计入限额，防止无限重试产生费用。
- 日志记录时间、操作者、路由、结果码，不记录 Key 或正文。
- Webhook 已提供管理员界面，配置管理不开放给应用 Key，详见 [Webhook 接入说明](Webhook接入说明.md)。消费端自动采样仍待接入；任务执行接口见下文。

## 0.6 任务 API

- GET /api/v1/tasks?brandId=…：读取授权范围内任务与进度，需要 read。
- GET /api/v1/tasks/items?planId=…：读取任务原始回执，需要 read。
- POST /api/v1/tasks：创建任务，需要 write。字段 id 为幂等标识，brandId、kind(sample/generate)、name、questionIds、providers、repeats、intervalMinutes 必填；可填 style、brief、firstAt、region、language。intervalMinutes 支持 0/60/360/1440/4320/10080；写作任务只支持 0。
- POST /api/v1/tasks/action：planId、action(pause/resume/cancel/retry/recover)，重试与恢复还需 itemId；结果不确定时 retry 必须传 confirmCost:true。需要 write。
- POST /api/v1/tasks/tick：领取并执行一条到期任务，需要独立 run 权限。可传 planId 或 brandId 限定范围。不传时仅处理 Key 授权品牌。可能产生供应商费用。

返回 state 区分 complete/idle/busy/deferred/retry_wait/failed/uncertain/save_pending。HTTP 200 表示本次调度请求已处理，不能直接当成模型执行成功；必须检查 state。轮询执行器根据 available/next_at 与退避调度，不要把 uncertain 当作普通重试。

本机安装器使用单独的只执行凭据访问 /api/runner/tick，不能用它读取工作区或创建任务。平台外层私有访问凭据仍然必需。

## 0.7 站内问题管理接口

以下接口供已登录用户使用，沿用同源防护及成员品牌权限，尚不属于 `/api/v1` Key 接口。

- POST `/api/questions/discover`：brandId、provider、runId、seeds、count。runId 为本次请求幂等标识，重试使用同一值；已有完整回执优先恢复。模型调用按日限额。
- POST `/api/questions/import`：brandId + questions（最多 100 条），或 discoveryId + candidateIds 导入候选；全程去重。
- POST `/api/questions/edit`：brandId、id、version、text、topic、intent、tags；version 必须与现有版本相同。
- POST `/api/questions/tags`：brandId、ids（最多 100 条）、tags；追加标签并保存历史。
- 问题历史由服务端维护。完整工作区 PUT 也会生成历史，不接受伪造历史和篡改挖掘回执；备份恢复按所有者专用流程进行。

## 0.8 站内报告接口

- GET `/api/reports/current?brandId=...`：返回服务端计算的当前报告。筛选字段 period（7/30/90/custom/all）、from/to（YYYY-MM-DD UTC）、surface（import/api）、platform、entry（web/app/api）、mode、version（current/all）。
- POST `/api/reports/archive`：传 id（幂等标识）、brandId、options；报告由服务端从当前授权工作区生成，不接受客户端提交的统计或报告正文。
- GET `/api/reports?brandId=...`：当前品牌最近 50 份归档元数据。
- GET `/api/reports/snapshot?id=...`：固定快照及 Markdown 原文；按工作区及品牌权限验证。
- 以上接口供登录用户使用，尚未开放为 Key API。归档不调用模型，不证明公开平台覆盖或商业效果。


## 0.13 站内自动报告接口

- GET `/api/reports?brandId=...` 同时返回 `schedules`。
- POST `/api/reports/schedule`：brandId、frequency（weekly/monthly）、surface（import/api）、enabled、revision；options 可填 platform、entry、mode、version。新计划 revision 为 0，每品牌/周期/数据类型一个计划；已有计划使用返回的 revision。
- POST `/api/reports/schedule/run`：brandId、id、revision；立即归档上一完整周期，同一筛选和窗口幂等。只有编辑或管理员可设置/执行，普通 Key 不能调用。
- 所有者绑定的 `/api/runner/tick` 同时返回 `reports.results`。每次最多两份到期报告，不调用模型、不发送外部消息；原有模型任务 `state` 与报告结果分别判断。
- 电脑离线不执行。自动报告日期按 UTC、错过周期只生成最近完整一期；备份恢复后计划暂停，失败延后至少一小时。


## 0.14 站内文章复测接口

- 发布记录可保存 autoRetest（布尔）、retestEveryHours（6/24/168）、retestWindowDays（7/30/90）。网页表单创建新记录时默认 true/24/30，旧记录保持原值。自动任务取服务端当前配置。
- GET `/api/publication-checks?brandId=...`：授权品牌的计划状态与最近摘要，不返回执行租约。
- GET `/api/publication-checks/history?brandId=...&publicationId=...`：最近 100 次记录摘要。
- GET `/api/publication-checks/detail?brandId=...&id=...`：固定证据快照。
- POST `/api/publication-checks/run`：brandId、publicationId、runId（16–80 字母/数字/连字符）；同一 runId 幂等。编辑或管理员可执行，只读和审核人可查看，普通 Key 尚不能调用这些站内接口。
- 成功保存的失败网页检查也返回 HTTP 200，须读 `check.page.status`（response_ok/access_gate/request_failed）及正文匹配提示。网页状态、引用与推荐互不替代。
- 专用 `/api/runner/tick` 在模型队列 idle 时附带 `articles` 结果。每次最多一篇，含失败原因；不改变模型任务 state 的含义，不新增模型请求。

## 助手及报告接口（0.15）

`POST /api/v1/mcp` 为 MCP Streamable HTTP 入口，须使用独立的应用 Key。按 read / write / run 过滤工具；Sites 外层服务授权继续保留。详见[助手接入说明](助手接入说明.md)。

`GET /api/v1/reports?brandId=...`、`GET /api/v1/reports/snapshot?id=...`、`GET /api/v1/reports/current?brandId=...` 需要 read；`POST /api/v1/reports/archive` 需要 write，提交 `{id,brandId,options}`。options 支持 surface、period、from/to、platform、entry、mode、version；与报告中心相同，固定档案最多 1000 份。

创建已启用任务与恢复暂停任务现在同时需要 write + run，因为本机执行器可能在下一次心跳自动发起付费请求。只读调用和报告归档不会调用模型。


## 产品归属与诊断范围

问题导入、编辑、挖掘接受当前品牌的 `productId`，空字符串表示品牌通用。`POST /api/questions/product` 接受 `{brandId, ids, productId}`，每批 1–100 个问题，原子记录新版本。归档或外品牌产品不能新关联。

回答导入可传 `questionVersion`，必须是已记录版本；服务端根据该版本和采集时间确定产品范围，不采纳客户端自报的产品 ID。历史范围无法确认时保持未记录。已有回答/稿件的产品快照不得改写。

报告、MCP 品牌诊断/报告归档与周期报告的 `options.productId`：空或省略表示全部，产品 ID 表示该产品，`@brand` 表示明确品牌通用，`@unknown` 表示归属未记录。产品必须属于当前品牌。报告返回 `productScope` 和 `productCoverage`。按产品划分周月报不占用其他产品或原品牌总览的计划槽位。

工作区 PUT 返回 `productLinks` 中的服务端归属、问题版本与原问题文字元数据，客户端应合并后再连续保存；不得用旧的客户端快照覆盖这些字段。


## 转化记录接口

站内 `/api/attribution` 和外部 `/api/v1/attribution` 共用授权。外部接口需应用 Key（读取用 read，导入/作废用 write），私有 Sites 仍需服务访问授权。API Key 不可放在浏览器埋点。

- `GET /api/v1/attribution?brandId=...&from=2026-09-01&to=2026-09-30&lookbackDays=30`：汇总、最多 100 条明细、total、nextOffset；用 offset 分页。from 为空表示全部，省略表示近 30 天。支持 productId（产品 ID、@brand、@unknown 或空）。分页时若其他客户端新增/作废，请刷新或用 export 取得单次完整结果。
- `GET /api/v1/attribution/export`：同筛选，返回完整记录与关联证据。
- `POST /api/v1/attribution/preview`：只校验，不保存。
- `POST /api/v1/attribution/import`：整批保存，返回 added / skipped / recordIds / fingerprint。
- `POST /api/v1/attribution/void`：`{brandId,id,revision,reason}`；作废原记录，保留依据，重新计算后续转化。

预检/导入载荷：

```json
{
  "id": "f2b9c462-6a82-4db6-a653-a68d3a7f9132",
  "brandId": "实际品牌ID",
  "sourceSystem": "客户CRM",
  "records": [{
    "externalId": "CRM中唯一记录编号",
    "kind": "deal",
    "occurredAt": "2026-09-29T10:00:00+08:00",
    "leadId": "CRM_001",
    "productId": "@unknown",
    "evidence": "对应CRM记录或客户原话的核对依据",
    "touchExternalId": "已有咨询或访问编号",
    "touchSourceSystem": "客户CRM",
    "amount": "199.00",
    "currency": "CNY"
  }]
}
```

类型为 visit / self_report / inquiry / deal。所有记录需 externalId、kind、带时区 occurredAt、evidence；除访问外需非空 leadId。visit 需 landingUrl，referrerUrl 可空；self_report 需 channel；deal 需金额及币种。咨询类型使用 inquiry。可通过 touchExternalId 关联来源；touchSourceSystem 留空沿用本批来源。记录编号区分大小写；同批允许前后引用，但不允许重复编号。产品未记录用 @unknown 或省略，品牌通用用 @brand / 空字符串。归档产品允许导入历史事件。

每批 1–200 条，每工作区 5000 条。相同请求 id 和内容可恢复原回执；即使改用新请求 id，相同来源系统和记录编号也不会新增。内容冲突、无效关联或容量不足时整批拒绝。预检通过不预留编号，实际写入会再次检查。重试保留请求 id 与内容。

单条记录接收时间、操作者、产品快照由服务端保存。发生时间允许 5 分钟时钟偏差，不接受未来事件、无时区时间、私下推算的关联。写入成功仅代表保存来源系统提供的记录，不代表独立核实客户行为。

## 来源分类与行业核对

`POST /api/v1/sources/classify` 需要 write 权限与对应品牌授权。请求包含 `brandId`、`scope`（domain/page）、已记录引用的 `url`、`category`、`relevance`（unknown/relevant/irrelevant）、`availability`（unknown/available/unavailable）、8–1000 字 `note`、整数 `revision`（首次为 0）及稳定 `requestId`（16–80 位字母数字、下划线或连字符）。分类可选：待分类、品牌官网、行业媒体、综合资讯、社区与问答、电商与产品目录、研究与公共资料、其他。

同一请求成功后重试返回 existing，不新增历史；相同 ID 改内容或旧版本提交返回 409。只能核对该品牌已存成功回答中的来源；不访问提交网址。每品牌 100 条，每条 40 个版本，超限 429。工作区整体 PUT 不能改写核对历史。结果含 record、工作区 state/revision；当前报告和归档的 `sourceAnalysis` 含当前分类快照、UTC 趋势及带回答 ID 的候选。

## 站内检查 API

以下接口同时支持 `/api/` 登录调用与 `/api/v1/` 限品牌应用 Key。GET 需 read；创建、执行和控制需 write，只有所有者/管理员/编辑可执行网页登录写操作。

- `POST /api/v1/site-audits`：`id`（稳定 16–80 位请求标识）、`brandId`、公开 `url`、`limit`（1/5/20/50）。同一请求相同参数恢复已有任务，参数冲突返回 409。
- `GET /api/v1/site-audits?brandId=...`：最近 30 个任务及摘要。
- `GET /api/v1/site-audits/detail?brandId=...&id=...`：全部已保存节点、状态、发现路径和响应证据；不返回执行租约。
- `POST /api/v1/site-audits/tick`：`brandId`、`id`，推进一个资源。返回 running / deferred / busy / complete / paused / failed / stopped / changed 等实际状态；等待抓取延迟时不会发起网络请求。
- `POST /api/v1/site-audits/control`：`brandId`、`id`、当前 `revision`、`action`（pause/resume/stop）；旧版本 409，终态不可恢复，需新建检查。

请求起始地址及每次跳转都受公开域名、DNS、同源和 robots 限制；不发送登录 Cookie 或模型密钥。检查 HTTP/HTML 不调用模型。私有 Sites 服务访问边界保持不变。

## 关联改进待办的复测

单次 `sample` 任务支持 `actionId`、`actionRevision`，创建与关联原子提交，完整结果自动附回待办等待人工复核。任务 Key 仍需 `write` 与 `run`。详见 [改进与复测说明](改进与复测说明.md)。


## 文件题库预检与导入

新增 `/api/v1/question-imports/preview`、`/commit`、`/receipts`、`/receipt`，分别用于预检、事务提交及回执查询；POST 需 write，GET 需 read，均按品牌授权。参数、逐行结果和幂等要求见 [问题文件导入说明](问题文件导入说明.md)。

0.26 增加 `format: "xlsx"` 与必填 `sheet: {name, headerRow}`；工作表身份参与导入幂等核对，回执与历史列表保留该信息。`importError` 标记无法采用的映射单元格，在预检时显示错误并禁止提交。源文件仍由本地浏览器读取，接口仅接收已映射字段。
