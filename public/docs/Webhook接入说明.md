# 观引 GEO 事件回调

在「服务连接 → 事件回调」为当前品牌配置接收地址、签名密钥和事件类型。仅工作区所有者、管理员可以管理、查看或手动发送回调；应用 API Key 不开放密钥管理。每个工作区最多 20 个配置、5,000 条发送记录。

## 开启与停止

1. 在你控制的服务端提供公开 HTTPS POST 地址，生成至少 32 字符随机密钥，并让接收端保存相同密钥。
2. 填写名称、地址、密钥，选择事件，勾选启用并保存。未启用时不会外发。地址和密钥在服务端加密；查询参数与原始密钥不回显，也不进入业务备份。
3. 只有保存配置后的新事件进入此配置。历史任务、报告不会因启用而补发。修改名称、事件、密钥、地址或启用状态都会开始新的配置版本，取消旧版本未完成的发送，不把旧消息转投新地址。
4. 本机执行器在任务空闲时推进发送。Mac 离线、执行器停止或任务繁忙时延后；可以在页面点击「处理一条回调」。这不是独立的全天候云定时服务。
5. 删除配置保留发送记录，取消未完成发送。正在外发的请求仍可能已被接收，停用或删除无法撤回对方已收到的数据。

当前尚未指定或连接真实外部接收服务；软件测试使用受控模拟接收端，不能替代客户接收系统验收。

## 事件内容

| 类型 | 触发时机 |
|---|---|
| task.complete | 持久化队列任务结果完成保存 |
| task.failed | 队列任务进入失败状态 |
| task.uncertain | 队列调用结果不明，需要核对 |
| report.created | 固定报告快照保存，包括自动周期报告 |
| publication.checked | 文章检查快照保存；不保证文章成功上线或被引用 |
| alert.opened | 新告警、告警内容变化或再次出现；确认告警不重复发出 |

直接调用旧版单篇生成/采样接口不生成队列任务事件。事件不包含问题、回答、稿件或报告正文；需要正文时使用授权 API 按资源 ID 读取。

示例结构（编号仅为示例）：

```json
{
  "schema": 1,
  "id": "report:REPORT_ID",
  "type": "report.created",
  "occurredAt": "2026-09-29T13:00:00.000Z",
  "brandId": "BRAND_ID",
  "resource": {"id": "REPORT_ID", "kind": "report_snapshots", "status": "created"}
}
```

任务事件另有 `attempt`、`planId`，文章检查另有 `publicationId`。`id` 是跨重试不变的事件编号；同一个事件可被多个已启用回调接收。

## 签名验证

- `x-guanyin-event`：事件类型。
- `x-guanyin-delivery`：此回调配置的发送记录 ID，重试不变。
- `x-guanyin-timestamp`：此次发送的 Unix 秒数。
- `x-guanyin-signature`：`v1=` 加十六进制 HMAC-SHA256。
- 签名原文为 `timestamp + "." + 原始请求正文`，UTF-8 编码。必须用原始字节，不能先解析 JSON 再序列化。

下面是 Node.js 服务端校验函数。密钥从受保护的配置中读取，时间同步后拒绝超过 5 分钟的请求。函数只校验签名，不代替持久化去重或业务权限检查。

```js
import {createHmac, timingSafeEqual} from 'node:crypto';

export function verifyWebhook(rawBody, headers, secret) {
  const timestamp = headers['x-guanyin-timestamp'];
  const signature = headers['x-guanyin-signature'];
  if (!/^\d{10,11}$/.test(timestamp || '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  if (!/^v1=[a-f0-9]{64}$/.test(signature || '')) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.').update(rawBody).digest();
  const actual = Buffer.from(signature.slice(3), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

验签后确认 `schema`、`type` 和授权品牌，按 `(来源工作区, 事件 id)` 持久化去重（来源工作区由接收端配置识别，不相信外部自报身份）。将接收记录与业务任务入队放在同一事务中，再返回 2xx；处理重复事件也可返回 2xx。正式业务处理异步执行。不要用内存 Set 代替数据库，否则重启后会再次处理。

## 发送结果与重试

HTTP 2xx 表示接收服务已确认 HTTP 请求，不代表其后续业务完成。3xx 不跟随跳转；常规 4xx 停止重试。408、429、5xx、网络中断自动重试，每轮最多 5 次，间隔为 1 分钟、5 分钟、30 分钟、2 小时。每次含 DNS 检查的发送预算约 10 秒；执行器下一次空闲才实际推进。

超时和执行租约过期可能发生在对方已经收到消息之后，系统按同一事件编号重试，提供至少一次尝试机制，不承诺恰好一次送达。达到上限后可点击失败记录的「重试」，开始新一轮最多 5 次尝试；保留最近 20 次尝试/人工重试操作。配置变化后旧记录不允许投往新配置。

记录保存 HTTP 状态、时间、耗时、错误类别，不保存响应正文或请求密钥。下表只显示最近 100 条；详情显示发送正文及最近 20 次操作。容量满时新事件不跳过，待清理后继续；可清理 30 天前已确认/取消的发送记录，失败记录不被此操作清除。事件账本当前不自动清理，长期容量治理仍需完善。

## 备份与恢复

业务备份含事件与发送回执，不含回调目的地、签名密钥或发送租约。恢复时保留更新的发送回执，不回退已经发送的状态；缺失回执只补回证据，待发送记录取消，当前回调配置停用。恢复业务表不会生成一批历史事件。重新启用后从新事件开始。删除品牌也会删除该品牌的回调目的地；恢复品牌备份不会恢复目的地和密钥。
