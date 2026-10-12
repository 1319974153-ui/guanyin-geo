import {requireAdmin,canBrand,reject,digest} from './access.js';
export const WEBHOOK_TYPES=['task.complete','task.failed','task.uncertain','report.created','publication.checked','alert.opened'];
const now=()=>new Date().toISOString(),pending="('queued','retry','sending')";
const configView=r=>({id:r.id,brandId:r.brand_id,name:r.name,endpoint:r.endpoint_label,types:JSON.parse(r.types),enabled:!!r.enabled,revision:r.revision,created:r.created,updated:r.updated});
const deliveryView=r=>({id:r.id,hookId:r.hook_id,eventId:r.event_id,type:r.type,state:r.state,attempts:r.attempts,nextAt:r.next_at,httpStatus:r.http_status,error:r.error,history:JSON.parse(r.history),created:r.created,updated:r.updated});
export async function webhookSignature(secret,timestamp,body){const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return 'v1='+[...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(timestamp+'.'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function config(env,ctx,id){const row=await env.DB.prepare('SELECT * FROM webhook_configs WHERE owner=? AND id=?').bind(ctx.owner,id).first();if(!row||!canBrand(ctx,row.brand_id))reject(404,'找不到回调配置');return row;}
export async function enqueueWebhooks(env,ctx){
 const hooks=(await env.DB.prepare('SELECT * FROM webhook_configs WHERE owner=? AND enabled=1 ORDER BY id').bind(ctx.owner).all()).results;let queued=0,limited=false;
 for(const hook of hooks){if(!canBrand(ctx,hook.brand_id))continue;
  const events=(await env.DB.prepare('SELECT * FROM webhook_events WHERE owner=? AND brand_id=? AND seq>? ORDER BY seq LIMIT 50').bind(ctx.owner,hook.brand_id,hook.cursor).all()).results;if(!events.length)continue;
  const types=JSON.parse(hook.types),selected=events.filter(e=>types.includes(e.type)),token=crypto.randomUUID(),at=now();
  const statements=[env.DB.prepare('UPDATE webhook_configs SET cursor=?,enqueue_token=? WHERE owner=? AND id=? AND revision=? AND cursor=? AND enabled=1 AND (SELECT count(*) FROM webhook_deliveries WHERE owner=?) + ? <= 5000').bind(events.at(-1).seq,token,ctx.owner,hook.id,hook.revision,hook.cursor,ctx.owner,selected.length)];
  for(const event of selected){const id=await digest(ctx.owner+':'+hook.id+':'+event.id);statements.push(env.DB.prepare("INSERT OR IGNORE INTO webhook_deliveries(id,owner,brand_id,hook_id,hook_revision,event_id,type,payload,state,attempts,history,created,updated) SELECT ?,?,?,?,?,?,?,?,'queued',0,'[]',?,? WHERE EXISTS(SELECT 1 FROM webhook_configs WHERE owner=? AND id=? AND enqueue_token=? AND enabled=1 AND revision=?)").bind(id,ctx.owner,hook.brand_id,hook.id,hook.revision,event.id,event.type,event.payload,at,at,ctx.owner,hook.id,token,hook.revision));}
  const result=await env.DB.batch(statements);if(!result[0].meta.changes)limited=true;queued+=result.slice(1).reduce((n,r)=>n+r.meta.changes,0);
 }return {queued,limited};
}
export async function tickWebhooks(env,ctx,h){
 const enqueued=await enqueueWebhooks(env,ctx),at=now(),scope=ctx.brands===null?'':' AND brand_id IN ('+ctx.brands.map(()=>'?').join(',')+')';
 // An expired send may have reached the receiver. Retry with the same event ID.
 await env.DB.prepare("UPDATE webhook_deliveries SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,error='发送租约超时，接收结果未知；接收方须按事件 ID 去重',lease_token=NULL,lease_until=NULL,next_at=? WHERE owner=? AND state='sending' AND lease_until<=?"+scope).bind(at,ctx.owner,at,...(ctx.brands||[])).run();
 const rows=(await env.DB.prepare("SELECT d.* FROM webhook_deliveries d JOIN webhook_configs c ON c.owner=d.owner AND c.id=d.hook_id WHERE d.owner=? AND d.state IN ('queued','retry') AND (d.next_at IS NULL OR d.next_at<=?) AND c.enabled=1 AND c.revision=d.hook_revision"+scope.replace('brand_id','d.brand_id')+" ORDER BY d.created,d.id LIMIT 50").bind(ctx.owner,at,...(ctx.brands||[])).all()).results;
 const row=rows.find(r=>canBrand(ctx,r.brand_id));if(!row)return {state:'idle',...enqueued};
 const token=crypto.randomUUID(),claim=await env.DB.prepare("UPDATE webhook_deliveries SET state='sending',attempts=attempts+1,lease_token=?,lease_until=?,updated=? WHERE owner=? AND id=? AND state IN ('queued','retry') AND attempts<5 AND EXISTS(SELECT 1 FROM webhook_configs c WHERE c.owner=webhook_deliveries.owner AND c.id=hook_id AND c.enabled=1 AND c.revision=hook_revision)").bind(token,new Date(Date.now()+60000).toISOString(),at,ctx.owner,row.id).run();if(!claim.meta.changes)return {state:'busy',...enqueued};
 let status=null,error=null,retry=false,success=false;const started=Date.now(),attempt=row.attempts+1;
 try{
  const hook=await config(env,ctx,row.hook_id);if(!hook.enabled||hook.revision!==row.hook_revision)return {state:'changed',...enqueued};
  const secret=JSON.parse(await h.decrypt(hook.secret,env)),u=h.publicUrl(secret.url);if(u.protocol!=='https:')throw new Error('invalid');const deadline=Date.now()+10000;await h.checkDNS(u,deadline);if(Date.now()>=deadline)throw new Error('timeout');
  // Configuration may be disabled while DNS is pending. Check before the external side effect.
  const fresh=await config(env,ctx,row.hook_id);if(!fresh.enabled||fresh.revision!==row.hook_revision)return {state:'changed',...enqueued};
  const timestamp=String(Math.floor(Date.now()/1000)),signature=await webhookSignature(secret.signingSecret,timestamp,row.payload);
  const r=await fetch(u,{method:'POST',redirect:'manual',headers:{'content-type':'application/json','x-guanyin-event':row.type,'x-guanyin-delivery':row.id,'x-guanyin-timestamp':timestamp,'x-guanyin-signature':signature},body:row.payload,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});status=r.status;await r.body?.cancel().catch(()=>{});success=r.ok;retry=[408,429].includes(status)||status>=500;error=success?null:status>=300&&status<400?'接收端返回跳转，未跟随跳转':'接收端 HTTP '+status;
 }catch(e){retry=!e.status||e.status>=500;error=e.status&&e.status<500?'地址未通过公开网络检查':'连接或发送中断，接收结果未知；接收方须按事件 ID 去重';}
 const state=success?'delivered':retry&&attempt<5?'retry':'failed',nextAt=state==='retry'?new Date(Date.now()+[60000,300000,1800000,7200000][Math.min(attempt-1,3)]).toISOString():null;
 const history=[...JSON.parse(row.history),{attempt,at,status,error,durationMs:Date.now()-started}].slice(-20);
 const saved=await env.DB.prepare("UPDATE webhook_deliveries SET state=?,next_at=?,http_status=?,error=?,history=?,lease_token=NULL,lease_until=NULL,updated=? WHERE owner=? AND id=? AND state='sending' AND lease_token=?").bind(state,nextAt,status,error,JSON.stringify(history),now(),ctx.owner,row.id,token).run();
 return {state:saved.meta.changes?state:'changed',id:row.id,...enqueued};
}
export async function webhooksApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace('/api/v1/','/api/');if(!['/api/webhooks','/api/webhooks/tick','/api/webhooks/retry','/api/webhooks/detail','/api/webhooks/cleanup'].includes(path))return null;requireAdmin(ctx);
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req);if(!b||Array.isArray(b))reject(400,'回调请求格式无效');
 const w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 const scoped={...ctx,brands:[b.brandId]};
 if(path==='/api/webhooks'&&req.method==='GET'){
  const hooks=(await env.DB.prepare('SELECT * FROM webhook_configs WHERE owner=? AND brand_id=? ORDER BY created DESC').bind(ctx.owner,b.brandId).all()).results;
  const deliveries=(await env.DB.prepare('SELECT * FROM webhook_deliveries WHERE owner=? AND brand_id=? ORDER BY created DESC,id DESC LIMIT 100').bind(ctx.owner,b.brandId).all()).results;
  const counts=(await env.DB.prepare('SELECT state,count(*) AS count FROM webhook_deliveries WHERE owner=? AND brand_id=? GROUP BY state').bind(ctx.owner,b.brandId).all()).results;
  return h.json({hooks:hooks.map(configView),deliveries:deliveries.map(deliveryView),counts,types:WEBHOOK_TYPES});
 }
 if(path==='/api/webhooks'&&req.method==='POST'){
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(b.id||'')||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.enabled!=='boolean'||!Array.isArray(b.types)||!b.types.length||b.types.some(t=>!WEBHOOK_TYPES.includes(t)))reject(400,'请填写名称并选择有效事件');
  const old=await env.DB.prepare('SELECT * FROM webhook_configs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(old&&old.brand_id!==b.brandId)reject(404,'回调不属于此品牌');
  const previous=old?JSON.parse(await h.decrypt(old.secret,env)):null,url=b.url||previous?.url,signingSecret=b.signingSecret||previous?.signingSecret;
  if(typeof url!=='string'||url.length>2048||typeof signingSecret!=='string'||signingSecret.length<32||signingSecret.length>256||/[\r\n]/.test(signingSecret))reject(400,'请填写 HTTPS 回调地址及 32 至 256 字符签名密钥');
  const endpoint=h.publicUrl(url);if(endpoint.protocol!=='https:')reject(400,'回调地址必须使用 HTTPS');const types=JSON.stringify([...new Set(b.types)].sort()),name=b.name.trim(),secretValue={url:endpoint.href,signingSecret};
  if(old&&name===old.name&&types===old.types&&b.enabled===!!old.enabled&&JSON.stringify(secretValue)===JSON.stringify(previous))return h.json({hook:configView(old),existing:true});
  if(old&&old.revision!==b.revision)reject(409,'回调已被其他操作修改，请刷新后重试');
  const encrypted=await h.encrypt(JSON.stringify(secretValue),env),at=now(),label=endpoint.origin+endpoint.pathname;
  const maxSeq="COALESCE((SELECT max(seq) FROM webhook_events WHERE owner=?),0)";
  if(old){const result=await env.DB.batch([
   env.DB.prepare(`UPDATE webhook_configs SET name=?,endpoint_label=?,secret=?,types=?,enabled=?,revision=revision+1,cursor=${maxSeq},enqueue_token=NULL,updated=? WHERE owner=? AND id=? AND revision=?`).bind(name,label,encrypted,types,b.enabled?1:0,ctx.owner,at,ctx.owner,b.id,b.revision),
   env.DB.prepare(`UPDATE webhook_deliveries SET state='canceled',error='回调配置已变更或停用；旧事件未转投新配置',lease_token=NULL,lease_until=NULL,updated=? WHERE owner=? AND hook_id=? AND state IN ${pending} AND EXISTS(SELECT 1 FROM webhook_configs WHERE owner=? AND id=? AND revision=?)`).bind(at,ctx.owner,b.id,ctx.owner,b.id,b.revision+1)
  ]);if(!result[0].meta.changes)reject(409,'回调配置发生冲突，请刷新');}
  else{const r=await env.DB.prepare(`INSERT OR IGNORE INTO webhook_configs(id,owner,brand_id,name,endpoint_label,secret,types,enabled,cursor,revision,created,updated) SELECT ?,?,?,?,?,?,?,?,${maxSeq},1,?,? WHERE (SELECT count(*) FROM webhook_configs WHERE owner=?)<20`).bind(b.id,ctx.owner,b.brandId,name,label,encrypted,types,b.enabled?1:0,ctx.owner,at,at,ctx.owner).run();if(!r.meta.changes)reject(409,'回调已存在或工作区已达到 20 个配置上限，请刷新');}
  return h.json({hook:configView(await config(env,scoped,b.id))});
 }
 if(path==='/api/webhooks'&&req.method==='DELETE'){
  const hook=await config(env,scoped,b.id);if(hook.revision!==b.revision)reject(409,'配置已改变，请刷新');
  const removed=await env.DB.batch([
   env.DB.prepare('DELETE FROM webhook_configs WHERE owner=? AND id=? AND revision=?').bind(ctx.owner,b.id,b.revision),
   env.DB.prepare("UPDATE webhook_deliveries SET state='canceled',lease_token=NULL,lease_until=NULL,error='回调配置已删除，历史发送记录保留',updated=? WHERE owner=? AND hook_id=? AND state IN ('queued','retry','sending') AND NOT EXISTS(SELECT 1 FROM webhook_configs WHERE owner=? AND id=?)").bind(now(),ctx.owner,b.id,ctx.owner,b.id)
  ]);if(!removed[0].meta.changes)reject(409,'配置已改变，请刷新');return h.json({removed:true});
 }
 if(path==='/api/webhooks/tick'&&req.method==='POST')return h.json(await tickWebhooks(env,scoped,h));
 if(path==='/api/webhooks/cleanup'&&req.method==='POST'){
  const cutoff=new Date(Date.now()-30*86400000).toISOString();const r=await env.DB.prepare("DELETE FROM webhook_deliveries WHERE owner=? AND brand_id=? AND state IN ('delivered','canceled') AND updated<?").bind(ctx.owner,b.brandId,cutoff).run();return h.json({removed:r.meta.changes});
 }
 if(['/api/webhooks/retry','/api/webhooks/detail'].includes(path)){
  const d=await env.DB.prepare('SELECT * FROM webhook_deliveries WHERE owner=? AND brand_id=? AND id=?').bind(ctx.owner,b.brandId,b.id).first();if(!d)reject(404,'没有此回调记录');
  if(path==='/api/webhooks/detail'&&req.method==='GET')return h.json({delivery:deliveryView(d),event:JSON.parse(d.payload)});
  if(path==='/api/webhooks/retry'&&req.method==='POST'){
   const hook=await config(env,scoped,d.hook_id);if(d.state!=='failed'||!hook.enabled||hook.revision!==d.hook_revision)reject(409,'只能重试当前有效配置下的失败记录');
   // Manual retry opens a new five-attempt window; preserve all recent attempt receipts.
   const r=await env.DB.prepare("UPDATE webhook_deliveries SET state='retry',attempts=0,history=?,next_at=?,updated=? WHERE owner=? AND id=? AND state='failed' AND updated=?").bind(JSON.stringify([...JSON.parse(d.history),{at:now(),action:'manual_retry'}].slice(-20)),now(),now(),ctx.owner,d.id,b.updated).run();if(!r.meta.changes)reject(409,'发送状态已改变，请刷新');return h.json({state:'retry'});
  }
 }reject(405,'不支持的回调操作');
}
