import {attachCaptureBaseline} from './capture-core.js';
import {importedAnswer,importIdentity} from './answer-import-core.js';
import {access,accessibleWorkspaces,visibleState,mergeVisibleState,requireAdmin,requireOwner,canBrand,policy,DEFAULT_POLICY,reject,digest,elevated} from './access.js';
import {createBackup,trimBackups,downloadBackup,restoreBackup,deleteBrand} from './governance.js';
const stamp=()=>new Date().toISOString();
const keyColumns='id,name,prefix,scopes,brands,daily_limit,created,expires,revoked,last_used';
function ids(value,state){if(!Array.isArray(value)||!value.length||value.length>50||value.some(id=>!state.brands.some(b=>b.id===id)))reject(400,'请选择现有品牌授权');return [...new Set(value)];}
function cleanName(value){const s=String(value||'').trim();if(!s||s.length>120)reject(400,'请填写不超过 120 字的名称');return s;}
export async function management(req,env,ctx,h){
 const path=new URL(req.url).pathname,method=req.method,{json,body,loadWorkspace,putState,appendResult}=h,owner=ctx.owner;
 if(path==='/api/workspaces'&&method==='GET')return json({current:{owner,role:ctx.role,brands:ctx.brands,actor:ctx.actor},workspaces:await accessibleWorkspaces(env,ctx)});
 if(path==='/api/manage'&&method==='GET'){
  requireAdmin(ctx);
  const [members,keys,events,copies,p,used]=await Promise.all([
   env.DB.prepare('SELECT email,role,brands,created,updated FROM members WHERE owner=? ORDER BY created').bind(owner).all(),
   env.DB.prepare('SELECT '+keyColumns+' FROM api_keys WHERE owner=? ORDER BY created DESC').bind(owner).all(),
   env.DB.prepare('SELECT actor,action,status,detail,created FROM audit_events WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner).all(),
   env.DB.prepare('SELECT id,label,kind,revision,created,length(body)+(SELECT coalesce(sum(length(body)),0) FROM backup_assets WHERE owner=backups.owner AND backup_id=backups.id) AS bytes FROM backups WHERE owner=? ORDER BY created DESC').bind(owner).all(),
   policy(env,owner),env.DB.prepare('SELECT kind,state,count(*) AS count FROM runs WHERE owner=? AND created>=? GROUP BY kind,state').bind(owner,stamp().slice(0,10)).all()
  ]);
  return json({members:members.results.map(x=>({...x,brands:JSON.parse(x.brands)})),keys:keys.results.map(x=>({...x,scopes:JSON.parse(x.scopes),brands:JSON.parse(x.brands)})),audit:events.results,backups:copies.results,policy:p,usage:used.results,context:{owner,role:ctx.role}});
 }
 if(path==='/api/manage/members'&&['POST','DELETE'].includes(method)){
  requireOwner(ctx);const b=await body(req),email=String(b.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)reject(400,'请输入成员的登录邮箱');if(email===ctx.email)reject(400,'所有者不需要重复授权');
  if(method==='DELETE'){await env.DB.prepare('DELETE FROM members WHERE owner=? AND email=?').bind(owner,email).run();return json({revoked:true})}
  if(!['admin','editor','reviewer','viewer'].includes(b.role))reject(400,'角色不正确');
  const w=await loadWorkspace(env,owner),brands=b.role==='admin'?[]:ids(b.brands,w.state);
  await env.DB.prepare('INSERT INTO members(owner,email,role,brands,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,email) DO UPDATE SET role=excluded.role,brands=excluded.brands,updated=excluded.updated').bind(owner,email,b.role,JSON.stringify(brands),stamp(),stamp()).run();
  return json({saved:true,accessNote:'成员需先获得此网站访问权并用这个邮箱登录。此操作保存工作区授权，不会发送邀请邮件或改变网站访问策略。'});
 }
 if(path==='/api/manage/policy'&&method==='PUT'){
  requireOwner(ctx);const b=await body(req),limits={brands:[1,500],questions:[1,10000],dailyModelCalls:[1,1000],dsoDailyModelCalls:[0,1000],platformsPerJob:[1,6],repeatsPerJob:[1,20],jobs:[1,1000]},p={};
  if(b.dsoDailyModelCalls===undefined)b.dsoDailyModelCalls=(await policy(env,owner)).dsoDailyModelCalls;
  for(const[k,[min,max]]of Object.entries(limits)){if(!Number.isInteger(b[k])||b[k]<min||b[k]>max)reject(400,`${k} 必须在 ${min} 至 ${max} 之间`);p[k]=b[k]}
  await env.DB.prepare('INSERT INTO policies(owner,body,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated=excluded.updated').bind(owner,JSON.stringify(p),stamp()).run();return json({policy:p});
 }
 if(path==='/api/manage/keys'&&method==='POST'){
  requireOwner(ctx);const b=await body(req),w=await loadWorkspace(env,owner),brands=ids(b.brands,w.state),name=cleanName(b.name);
  if(!Array.isArray(b.scopes)||!b.scopes.length||b.scopes.some(x=>!['read','write','run'].includes(x)))reject(400,'请选择 read / write / run 权限');
  if(!Number.isInteger(b.dailyLimit)||b.dailyLimit<1||b.dailyLimit>10000)reject(400,'每日请求上限为 1 至 10000');
  if(!Number.isInteger(b.days)||b.days<1||b.days>365)reject(400,'有效期为 1 至 365 天');
  const key='geo_'+[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),expires=new Date(Date.now()+b.days*86400000).toISOString();
  if(b.rotateId&&!await env.DB.prepare('SELECT id FROM api_keys WHERE owner=? AND id=? AND revoked IS NULL').bind(owner,b.rotateId).first())reject(404,'找不到待轮换的有效密钥');
  const insert=env.DB.prepare('INSERT INTO api_keys(id,owner,name,digest,prefix,scopes,brands,daily_limit,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,owner,name,await digest(key),key.slice(0,12),JSON.stringify([...new Set(b.scopes)]),JSON.stringify(brands),b.dailyLimit,stamp(),expires);
  if(b.rotateId)await env.DB.batch([insert,env.DB.prepare('UPDATE api_keys SET revoked=? WHERE owner=? AND id=?').bind(stamp(),owner,b.rotateId)]);else await insert.run();
  return json({id,key,expires,note:'密钥仅显示这一次。私有网站的外部请求还需要 Sites 的服务访问授权。'});
 }
 if(path==='/api/manage/keys'&&method==='DELETE'){requireOwner(ctx);const b=await body(req);await env.DB.prepare('UPDATE api_keys SET revoked=? WHERE owner=? AND id=? AND revoked IS NULL').bind(stamp(),owner,b.id).run();return json({revoked:true})}
 if(path==='/api/manage/backups'&&method==='POST'){
  requireOwner(ctx);const b=await body(req);await loadWorkspace(env,owner);const result=await createBackup(env,owner,cleanName(b.label||'手动备份'));await trimBackups(env,owner);return json(result);
 }
 if(path==='/api/manage/backups/download'&&method==='POST'){requireOwner(ctx);const b=await body(req);return json(await downloadBackup(env,owner,b.id));}
 if(path==='/api/manage/backups/restore'&&method==='POST'){requireOwner(ctx);const b=await body(req);return json(await restoreBackup(env,owner,b.id,b.revision,h));}
 if(path==='/api/manage/brands/delete'&&method==='POST'){requireOwner(ctx);const b=await body(req);return json(await deleteBrand(env,owner,b.brandId,b.confirmName,h));}
 if(path==='/api/v1/state'&&method==='GET'){return json(await h.workspace(env,owner));}
 if(path==='/api/v1/answers'&&method==='POST'){
  if(!ctx.key&&!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能导入回答');
  const b=await body(req),w=await h.workspace(env,owner),brand=w.state.brands.find(x=>x.id===b.brandId),question=w.state.questions.find(x=>x.brandId===b.brandId&&x.id===b.questionId);
  if(!brand||!question)reject(404,'品牌或问题不存在');
  const record=attachCaptureBaseline(importedAnswer(b,brand,question),b,w.state),importHash=await digest(importIdentity(record));
  let id,existing=false;
  await appendResult(env,owner,s=>{
   const previous=s.answers.find(x=>x.brandId===brand.id&&x.externalId===record.externalId);
   if(previous){
    if(previous.importHash?previous.importHash!==importHash:importIdentity(previous)!==importIdentity(record))reject(409,'采集编号已有不同内容，请保留原记录并为新采样使用新编号');
    id=previous.id;existing=true;return;
   }
   const currentBrand=s.brands.find(x=>x.id===brand.id),currentQuestion=s.questions.find(x=>x.id===question.id&&x.brandId===brand.id);
   if(!currentBrand||!currentQuestion)reject(409,'品牌或问题已移除，请重新载入');
   const current=attachCaptureBaseline(importedAnswer({...b,questionVersion:record.questionVersion},currentBrand,currentQuestion),b,s);
   if(importIdentity(current)!==importIdentity(record))reject(409,'问题资料已更新，请重新载入后核对版本');
   id=crypto.randomUUID();s.answers.push({...current,id,importHash,source:ctx.key?'api-import':'manual-import',receivedAt:stamp(),receivedBy:ctx.actor});
  });
  return json({id,existing});
 }

 return null;
}
