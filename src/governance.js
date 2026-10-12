import {reject,digest,checkQuota} from './access.js';
const now=()=>new Date().toISOString();
// Business assets only. Credentials, memberships, permissions and API request counters stay live.
export const ASSET_TABLES={
 webhook_events:['id','brand_id','type','payload','created'],
 webhook_deliveries:['id','brand_id','hook_id','hook_revision','event_id','type','payload','state','attempts','next_at','lease_token','lease_until','http_status','error','history','created','updated'],
 attribution_events:['id','brand_id','source_system','external_id','kind','occurred_at','fingerprint','body','revision','created','updated'],
 publication_checks:['id','brand_id','publication_id','body','created'],
 task_plans:['id','brand_id','name','kind','spec','status','next_at','created','updated'],
 task_items:['id','plan_id','brand_id','spec','status','attempts','available','lease_until','lease_token','result','error','created','updated'],
 report_snapshots:['id','brand_id','title','body','source_revision','created'],
 operation_records:['id','brand_id','kind','body','revision','created','updated'],
 runs:['id','kind','state','created','result']
};
export async function enterOperation(env,owner,exclusive=false){
 const id=crypto.randomUUID(),at=now(),expires=new Date(Date.now()+600000).toISOString();
 await env.DB.prepare('DELETE FROM operation_leases WHERE owner=? AND expires<=?').bind(owner,at).run();
 const r=await env.DB.prepare('INSERT INTO operation_leases(id,owner,exclusive,expires) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=? AND expires>? AND (exclusive=1 OR ?=1))').bind(id,owner,exclusive?1:0,expires,owner,at,exclusive?1:0).run();
 if(!r.meta.changes)reject(409,exclusive?'工作区仍有操作执行中，请等其完成后恢复或清理。':'工作区正在恢复或清理资料，请稍后再试。');return id;
}
export async function leaveOperation(env,id){await env.DB.prepare('DELETE FROM operation_leases WHERE id=?').bind(id).run();}
export async function trimBackups(env,owner){await env.DB.batch([
 env.DB.prepare("DELETE FROM backups WHERE owner=? AND kind!='automatic' AND id NOT IN (SELECT id FROM backups WHERE owner=? AND kind!='automatic' ORDER BY created DESC,id DESC LIMIT 10)").bind(owner,owner),
 env.DB.prepare("DELETE FROM backups WHERE owner=? AND kind='automatic' AND id NOT IN (SELECT id FROM backups WHERE owner=? AND kind='automatic' ORDER BY created DESC,id DESC LIMIT COALESCE((SELECT keep FROM backup_schedules WHERE owner=?),7))").bind(owner,owner,owner),
 env.DB.prepare('DELETE FROM backup_assets WHERE owner=? AND backup_id NOT IN (SELECT id FROM backups WHERE owner=?)').bind(owner,owner)
]);}
export async function createBackup(env,owner,label){
 const id=crypto.randomUUID(),at=now();await env.DB.batch(backupStatements(env,owner,label,id,at));return {id,created:at};
}
export function backupStatements(env,owner,label,id,at,guard=null){
 const statements=[env.DB.prepare("INSERT INTO backups(id,owner,label,body,revision,created,kind) SELECT ?,?,?,json_object('format','guanyin-backup-v2','state',json(body)),revision,?,? FROM workspaces WHERE owner=?"+(guard?" AND EXISTS(SELECT 1 FROM backup_schedules WHERE owner=? AND enabled=1 AND lease_token=? AND revision=?)":"")).bind(id,owner,label,at,guard?'automatic':'manual',owner,...(guard?[owner,guard.token,guard.revision]:[]))];
 for(const[table,columns]of Object.entries(ASSET_TABLES)){
  const values=columns.map(c=>`'${c}',${c==='lease_token'||c==='lease_until'?'NULL':table==='operation_records'&&c==='body'?"CASE WHEN kind IN ('publication_watch','site_audit') THEN CAST(json_remove(body,'$.leaseToken','$.leaseUntil') AS TEXT) ELSE body END":c}`).join(',');
  statements.push(env.DB.prepare(`INSERT INTO backup_assets(owner,backup_id,table_name,record_id,body) SELECT ?,?,?,id,json_object(${values}) FROM ${table} WHERE owner=? AND EXISTS(SELECT 1 FROM backups WHERE owner=? AND id=?)`).bind(owner,id,table,owner,owner,id));
 }
 return statements;
}
export async function downloadBackup(env,owner,id){
 const copy=await env.DB.prepare('SELECT * FROM backups WHERE owner=? AND id=?').bind(owner,id).first();if(!copy)reject(404,'备份不存在');
 const parsed=JSON.parse(copy.body),state=parsed.format==='guanyin-backup-v2'?parsed.state:parsed;
 const rows=(await env.DB.prepare('SELECT table_name,body FROM backup_assets WHERE owner=? AND backup_id=? ORDER BY table_name,record_id').bind(owner,id).all()).results;
 const tables=Object.fromEntries(Object.keys(ASSET_TABLES).map(t=>[t,rows.filter(r=>r.table_name===t).map(r=>JSON.parse(r.body))]));
 const bundle={format:parsed.format||'guanyin-legacy-assets',created:copy.created,label:copy.label,revision:copy.revision,state,tables};return {...bundle,checksum:await digest(JSON.stringify(bundle))};
}
export async function restoreBackup(env,owner,id,revision,h){
 const copy=await env.DB.prepare('SELECT body FROM backups WHERE owner=? AND id=?').bind(owner,id).first();if(!copy)reject(404,'备份不存在');
 const current=await h.loadWorkspace(env,owner);if(current.revision!==revision)reject(409,'当前资料已改变，请刷新后再恢复');
 const parsed=JSON.parse(copy.body),full=parsed.format==='guanyin-backup-v2',state=full?parsed.state:parsed;for(const p of state.publications||[])p.autoRetest=false;h.validateState(state);await checkQuota(env,owner,state);
 const protection=await createBackup(env,owner,'恢复前自动保护');
 const statements=[env.DB.prepare('UPDATE workspaces SET body=?,revision=revision+1,updated=? WHERE owner=? AND revision=?').bind(JSON.stringify(state),now(),owner,revision)];
 statements.push(env.DB.prepare("INSERT INTO backup_schedules(owner,enabled,created,updated,last_error) VALUES(?,0,?,?,'恢复后自动备份已暂停，请核对后重新启用') ON CONFLICT(owner) DO UPDATE SET enabled=0,next_at=NULL,lease_token=NULL,lease_until=NULL,pending_id=NULL,revision=revision+1,last_error=excluded.last_error,updated=excluded.updated").bind(owner,now(),now()));
 if(full){
  // Paid calls and their usage never roll back. Lost ledger entries can be restored, newer ones win.
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,json_extract(body,'$.id'),json_extract(body,'$.kind'),json_extract(body,'$.state'),json_extract(body,'$.created'),json_extract(body,'$.result') FROM backup_assets WHERE owner=? AND backup_id=? AND table_name='runs'").bind(owner,owner,id));
  for(const[table,columns]of Object.entries(ASSET_TABLES).filter(([t])=>!['runs','webhook_events','webhook_deliveries'].includes(t))){
   statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE owner=?`).bind(owner));
   const values=columns.map(c=>{
    if(table==='operation_records'&&c==='body')return "CASE WHEN json_extract(a.body,'$.kind')='report_schedule' THEN json_set(json_extract(a.body,'$.body'),'$.enabled',json('false'),'$.nextAt',NULL,'$.retryAt',NULL,'$.lastError','备份恢复后已暂停，请核对筛选条件后重新启用。') WHEN json_extract(a.body,'$.kind')='site_audit' THEN json_set(json_extract(a.body,'$.body'),'$.status',CASE WHEN json_extract(json_extract(a.body,'$.body'),'$.status')='running' THEN 'paused' ELSE json_extract(json_extract(a.body,'$.body'),'$.status') END,'$.leaseToken',NULL,'$.leaseUntil',NULL,'$.nextAt',NULL) WHEN json_extract(a.body,'$.kind')='publication_watch' THEN json_set(json_extract(a.body,'$.body'),'$.leaseToken',NULL,'$.leaseUntil',NULL,'$.nextAt',NULL) ELSE json_extract(a.body,'$.body') END";
    if(table==='task_plans'&&c==='status')return "CASE WHEN json_extract(a.body,'$.status') IN ('complete','canceled') THEN json_extract(a.body,'$.status') ELSE 'paused' END";
    if(table==='task_items'){
     const latest="(SELECT r.result FROM runs r WHERE r.owner=a.owner AND r.id LIKE json_extract(a.body,'$.id')||'-%' AND r.state='complete' AND json_extract(r.result,'$.record.id')=json_extract(a.body,'$.id') ORDER BY length(r.id) DESC,r.id DESC LIMIT 1)";
     const attempts="MAX(COALESCE(json_extract(a.body,'$.attempts'),0),COALESCE((SELECT max(CAST(substr(r.id,length(json_extract(a.body,'$.id'))+2) AS INTEGER)) FROM runs r WHERE r.owner=a.owner AND r.id LIKE json_extract(a.body,'$.id')||'-%'),0))";
     if(c==='lease_token'||c==='lease_until')return 'NULL';
     if(c==='attempts')return attempts;
     if(c==='result')return `COALESCE(${latest},json_extract(a.body,'$.result'))`;
     if(c==='status')return `CASE WHEN json_extract(a.body,'$.status') IN ('complete','canceled') THEN json_extract(a.body,'$.status') WHEN COALESCE(${latest},json_extract(a.body,'$.result')) IS NOT NULL THEN 'ready' WHEN ${attempts}>0 OR json_extract(a.body,'$.status') IN ('running','persisting','uncertain') THEN 'uncertain' ELSE 'queued' END`;
     if(c==='error')return "'备份恢复后已暂停计划；已返回结果可恢复，未知调用需核对供应商用量。'";
    }
    return `json_extract(a.body,'$.${c}')`;
   });
   statements.push(env.DB.prepare(`INSERT INTO ${table}(owner,${columns.join(',')}) SELECT ?,${values.join(',')} FROM backup_assets a WHERE a.owner=? AND a.backup_id=? AND a.table_name=?`).bind(owner,owner,id,table));
  }
 }else{
  statements.push(env.DB.prepare("UPDATE operation_records SET body=json_set(body,'$.enabled',json('false'),'$.nextAt',NULL,'$.retryAt',NULL),revision=revision+1,updated=? WHERE owner=? AND kind='report_schedule'").bind(now(),owner));
  // Legacy snapshots did not contain task/report tables. Keep them, but pause execution before reconciling.
  statements.push(env.DB.prepare("UPDATE task_plans SET status='paused',updated=? WHERE owner=? AND status='active'").bind(now(),owner));
 }
 // External receipts are monotonic. Restoring business history never resends callbacks.
 if(full)for(const table of ['webhook_events','webhook_deliveries']){
  const columns=ASSET_TABLES[table],values=columns.map(c=>c==='lease_token'||c==='lease_until'?'NULL':table==='webhook_deliveries'&&c==='state'?"CASE WHEN json_extract(body,'$.state')='delivered' THEN 'delivered' ELSE 'canceled' END":`json_extract(body,'$.${c}')`);
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ${table}(owner,${columns.join(',')}) SELECT ?,${values.join(',')} FROM backup_assets WHERE owner=? AND backup_id=? AND table_name=?`).bind(owner,owner,id,table));
 }
 statements.push(env.DB.prepare("DELETE FROM webhook_configs WHERE owner=? AND brand_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.brands'))").bind(owner,JSON.stringify(state)));
 statements.push(env.DB.prepare('UPDATE webhook_configs SET enabled=0,revision=revision+1,enqueue_token=NULL,updated=? WHERE owner=?').bind(now(),owner));
 statements.push(env.DB.prepare("UPDATE webhook_deliveries SET state='canceled',lease_token=NULL,lease_until=NULL,error='备份恢复后取消待发送回调；历史事件不自动重发',updated=? WHERE owner=? AND state IN ('queued','retry','sending')").bind(now(),owner));
 statements.push(env.DB.prepare("UPDATE connections SET model=json_set(model,'$.enabled',json('false'),'$.verifiedAt',NULL,'$.canPublish',json('false'),'$.revision',?),updated=? WHERE owner=? AND provider LIKE 'wordpress:%'").bind(crypto.randomUUID(),now(),owner));
 const result=await env.DB.batch(statements);if(!result[0].meta.changes)reject(409,'恢复期间工作区版本改变，保护副本已保留');await trimBackups(env,owner);
 return {state,revision:revision+1,backupId:protection.id,full,notice:full?'资料、任务、报告和执行记录已恢复。未完成计划已暂停，调用记录和已用配额保持累计。':'旧版备份仅恢复品牌资产；现有任务和报告保留，活动任务已暂停，请人工核对关联。'};
}
export async function deleteBrand(env,owner,brandId,confirmName,h){
 const w=await h.loadWorkspace(env,owner),b=w.state.brands.find(b=>b.id===brandId);if(!b)reject(404,'品牌不存在');if(confirmName!==b.name)reject(400,'请输入完整品牌名称以确认删除');
 const backup=await createBackup(env,owner,'删除品牌前：'+b.name),state=structuredClone(w.state);
 state.brands=state.brands.filter(b=>b.id!==brandId);for(const[k,v]of Object.entries(state))if(k!=='brands'&&Array.isArray(v))state[k]=v.filter(x=>x.brandId!==brandId);if(state.currentBrand===brandId)state.currentBrand=state.brands[0]?.id||'';h.validateState(state);
 await env.DB.batch([env.DB.prepare('UPDATE workspaces SET body=?,revision=revision+1,updated=? WHERE owner=? AND revision=?').bind(JSON.stringify(state),now(),owner,w.revision),env.DB.prepare('DELETE FROM connections WHERE owner=? AND provider=?').bind(owner,'wordpress:'+brandId),...['task_items','task_plans','report_snapshots','operation_records','publication_checks','attribution_events','webhook_configs','webhook_events','webhook_deliveries'].map(t=>env.DB.prepare(`DELETE FROM ${t} WHERE owner=? AND brand_id=?`).bind(owner,brandId))]);
 await trimBackups(env,owner);return {backupId:backup.id,state,revision:w.revision+1};
}
