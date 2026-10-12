import {requireAdmin,requireOwner,reject,digest} from './access.js';
import {backupStatements,trimBackups} from './governance.js';
const stamp=()=>new Date().toISOString();
const defaults={enabled:true,hours:24,keep:7,revision:0,nextAt:null,lastSuccess:null,lastBackupId:null,lastError:null,history:[],attempts:0};
const read=(env,owner)=>env.DB.prepare('SELECT * FROM backup_schedules WHERE owner=?').bind(owner).first();
function view(r){return r?{enabled:!!r.enabled,hours:r.hours,keep:r.keep,revision:r.revision,nextAt:r.next_at,lastSuccess:r.last_success,lastBackupId:r.last_backup_id,lastError:r.last_error,attempts:r.attempts,history:JSON.parse(r.history),running:!!r.lease_token&&r.lease_until>stamp()}:defaults}
export async function backupScheduleApi(req,env,ctx,h){
 if(new URL(req.url).pathname!=='/api/manage/backup-schedule')return null;
 if(req.method==='GET'){requireAdmin(ctx);return h.json({schedule:view(await read(env,ctx.owner))});}
 if(req.method!=='POST')reject(405,'不支持此请求方法');requireOwner(ctx);const b=await h.body(req);
 if(typeof b.enabled!=='boolean'||![6,24,168].includes(b.hours)||!Number.isInteger(b.keep)||b.keep<3||b.keep>30||!Number.isInteger(b.revision)||b.revision<0||!/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId||''))reject(400,'请提供有效的备份周期、保留数量和请求版本');
 const fingerprint=await digest(JSON.stringify({enabled:b.enabled,hours:b.hours,keep:b.keep})),row=await read(env,ctx.owner);if(row?.request_id===b.requestId){if(row.fingerprint!==fingerprint)reject(409,'请求编号已用于其他设置');return h.json({schedule:view(row),existing:true});}if((row?.revision||0)!==b.revision)reject(409,'备份计划已变化，请刷新');
 const at=stamp(),next=b.enabled?(row?.enabled&&row.hours===b.hours?row.next_at||at:at):null;
 const r=row?await env.DB.prepare('UPDATE backup_schedules SET enabled=?,hours=?,keep=?,next_at=?,revision=revision+1,lease_token=NULL,lease_until=NULL,pending_id=NULL,attempts=0,last_error=NULL,request_id=?,fingerprint=?,updated=? WHERE owner=? AND revision=?').bind(b.enabled?1:0,b.hours,b.keep,next,b.requestId,fingerprint,at,ctx.owner,b.revision).run():await env.DB.prepare('INSERT OR IGNORE INTO backup_schedules(owner,enabled,hours,keep,next_at,request_id,fingerprint,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(ctx.owner,b.enabled?1:0,b.hours,b.keep,next,b.requestId,fingerprint,at,at).run();
 if(!r.meta.changes){const current=await read(env,ctx.owner);if(current?.request_id!==b.requestId||current.fingerprint!==fingerprint)reject(409,'备份计划被并发更新，请刷新');}
 return h.json({schedule:view(await read(env,ctx.owner)),existing:false});
}
export async function tickBackupSchedule(env,ctx,clock=new Date()){
 const owner=ctx.owner,at=clock.toISOString();const w=await env.DB.prepare("SELECT owner FROM workspaces WHERE owner=? AND json_array_length(body,'$.brands')>0").bind(owner).first();if(!w)return{state:'empty'};
 // Built-in workspace protection: first eligible heartbeat takes a snapshot, then every 24 hours.
 await env.DB.prepare('INSERT OR IGNORE INTO backup_schedules(owner,next_at,created,updated) VALUES(?,?,?,?)').bind(owner,at,at,at).run();
 let row=await read(env,owner);if(!row.enabled)return{state:'paused'};if(row.next_at>at)return{state:'scheduled',nextAt:row.next_at};if(row.lease_token&&row.lease_until>at)return{state:'running'};
 const token=crypto.randomUUID(),id=row.pending_id||crypto.randomUUID(),until=new Date(clock.getTime()+300000).toISOString();
 const claim=await env.DB.prepare('UPDATE backup_schedules SET lease_token=?,lease_until=?,pending_id=?,updated=? WHERE owner=? AND enabled=1 AND revision=? AND next_at<=? AND (lease_until IS NULL OR lease_until<=?)').bind(token,until,id,at,owner,row.revision,at,at).run();if(!claim.meta.changes)return{state:'contended'};
 try{
  const next=new Date(clock.getTime()+row.hours*3600000).toISOString(),history=[...JSON.parse(row.history),{at,state:'complete',backupId:id}].slice(-30);
  const statements=backupStatements(env,owner,'自动备份 · '+at.slice(0,16).replace('T',' ')+' UTC',id,at,{token,revision:row.revision});
  statements.push(env.DB.prepare("UPDATE backup_schedules SET revision=revision+1,next_at=?,last_success=?,last_backup_id=?,last_error=NULL,attempts=0,pending_id=NULL,lease_token=NULL,lease_until=NULL,history=?,updated=? WHERE owner=? AND lease_token=? AND revision=? AND EXISTS(SELECT 1 FROM backups WHERE owner=? AND id=?)").bind(next,at,id,JSON.stringify(history),at,owner,token,row.revision,owner,id));
  const result=await env.DB.batch(statements);if(!result[0].meta.changes)return{state:'canceled'};
  let cleanupError=false;try{await trimBackups(env,owner)}catch{cleanupError=true}
  return{state:'complete',backupId:id,created:at,nextAt:next,...(cleanupError?{warning:'快照已保存，旧副本清理未完成，将在下一次成功备份后重试'}:{})};
 }catch{
  // A lost batch response may follow a committed transaction. Never turn that success into a retry.
  const existing=await env.DB.prepare('SELECT id,created FROM backups WHERE owner=? AND id=?').bind(owner,id).first(),current=await read(env,owner);if(existing&&current.last_backup_id===id)return{state:'complete',backupId:id,created:existing.created,recovered:true,nextAt:current.next_at};
  if(current.lease_token!==token||current.revision!==row.revision)return{state:'canceled'};
  const attempts=row.attempts+1,error=attempts>=5?'自动备份连续失败 5 次，已暂停；请检查后重新启用':'自动备份失败，5 分钟后重试；最近成功副本保留',next=new Date(clock.getTime()+300000).toISOString(),history=[...JSON.parse(row.history),{at,state:'failed',error}].slice(-30);
  await env.DB.prepare('UPDATE backup_schedules SET revision=revision+1,enabled=?,next_at=?,attempts=?,last_error=?,history=?,lease_token=NULL,lease_until=NULL,updated=? WHERE owner=? AND lease_token=? AND revision=?').bind(attempts<5?1:0,attempts<5?next:null,attempts,error,JSON.stringify(history),at,owner,token,row.revision).run();return{state:'failed',error,attempts};
 }
}
