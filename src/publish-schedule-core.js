import {reject} from './access.js';
export const SCHEDULE_PLATFORMS=Object.freeze(['wordpress','cnblogs','typecho','metaweblog','personal-site','yuque']);
export const SCHEDULE_WINDOW_MS=120_000;
export const SCHEDULE_STATES={scheduled:'等待定时发送',executing:'发送中',cancel_requested:'已停止后续账号，当前账号处理中',cancelled:'已取消',missed:'已错过，不补发',needs_confirmation:'重启后待重新确认',needs_attention:'需要处理',complete:'本次处理结束'};
export function requireLocalScheduleOwner(env,ctx){if(env.GEO_LOCAL_MODE!=='true'||ctx.owner!=='local-owner'||ctx.actor!=='local-owner'||ctx.role!=='owner'||ctx.key)reject(403,'定时发送仅由本机工作区所有者在产品中明确批准');}
export function scheduleId(value){if(!/^ps-[a-f0-9]{64}$/.test(value||''))reject(400,'定时计划编号无效');return value;}
export function scheduleTime(input,clock=Date.now()){
 const stamp=Date.parse(input.dueAt||''),zone=String(input.timezone||''),local=String(input.localTime||'');
 if(!Number.isFinite(stamp)||stamp-clock<60_000||stamp-clock>30*86400_000)reject(400,'请选择 1 分钟后至 30 天内的一次发送时间');
 let parts;try{parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp));}catch{reject(400,'发送时区无效，请重新选择时间');}
 const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
 if(local!==`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`)reject(400,'发送时间与所选时区不一致，请重新选择');
 if(!Number.isInteger(input.maxPer24Hours)||input.maxPer24Hours<1||input.maxPer24Hours>10)reject(400,'请明确每个账号连续 24 小时内的定时发送上限（1 至 10 次）');
 return {dueAt:new Date(stamp).toISOString(),expiresAt:new Date(stamp+SCHEDULE_WINDOW_MS).toISOString(),timezone:zone,localTime:local,maxPer24Hours:input.maxPer24Hours};
}
export function parseSchedule(row){try{const v=JSON.parse(row.body);if(v.schema!=='guanyin.publish-schedule/v1'||v.id!==row.id)throw Error();return v;}catch{reject(409,'定时计划记录异常，未执行');}}
// A derived permission is never a bearer token that an HTTP caller can reuse.
export async function assertScheduledAuthorization(env,ctx,record,target){
 if(!record.scheduleId)return;
 if(env.GEO_LOCAL_MODE!=='true'||ctx.owner!=='local-owner'||ctx.actor!==`schedule:${record.scheduleId}`||ctx.role!=='owner'||ctx.key)reject(403,'定时许可只能由本机原计划执行，不能用作手动发布授权');
 const plan=await env.DB.prepare('SELECT id,body,state FROM publish_schedules WHERE owner=? AND id=?').bind(ctx.owner,record.scheduleId).first();
 const attempt=await env.DB.prepare('SELECT state,dispatch_id FROM publish_schedule_attempts WHERE owner=? AND schedule_id=? AND target_key=?').bind(ctx.owner,record.scheduleId,`${target.platform}:${target.accountId}`).first();
 if(!plan||!['executing','cancel_requested'].includes(plan.state)||attempt?.state!=='started'||attempt.dispatch_id!==record.scheduleDispatchId)reject(409,'原定时许可已经暂停或结束，未重复发送');
 const saved=parseSchedule(plan);
 if(saved.approvedBy!=='local-owner'||saved.contentHash!==record.contentHash||saved.brandId!==record.brandId||!saved.targets.some(t=>t.platform===target.platform&&t.accountId===target.accountId&&t.connectionRevision===target.connectionRevision))reject(409,'定时许可与原批准稿件或账号不一致');
}
