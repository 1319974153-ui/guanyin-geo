import {assertArticleMediaDelivery} from './article-media-core.js';
import {canBrand,digest,reject,requireAdmin} from './access.js';
import {publishingAccounts} from './publishing-center.js';
import {parsePublishAuthorization,publishingContentHash,publishingContentSnapshot} from './publish-authorization-core.js';
import {publishingExecutionInput,publishingExecutionSnapshot} from './publish-execution-policy.js';

const now=()=>new Date().toISOString();
const SERVER_OWNED_PLATFORMS=new Set(['wordpress','cnblogs','typecho','metaweblog','personal-site','yuque','wechat']);
const MODES=new Set(['draft','publish']);
const MAX_TARGETS=12;
const MIN_TTL=30_000;
const MAX_TTL=15*60_000;

function id(value){
 if(typeof value!=='string'||!/^pa-[a-f0-9]{64}$/.test(value))reject(400,'发布授权编号无效，请重新确认本次操作');
 return value;
}

function mode(value){
 if(!MODES.has(value))reject(400,'发布授权仅适用于保存草稿或公开发布');
 return value;
}

function expiresAt(value){
 const time=Date.parse(value||'');
 if(!Number.isFinite(time)||time-Date.now()<MIN_TTL||time-Date.now()>MAX_TTL)reject(400,'发布授权有效期应在 30 秒至 15 分钟之间');
 return new Date(time).toISOString();
}

function requestedTargets(value){
 if(!Array.isArray(value)||value.length<1||value.length>MAX_TARGETS)reject(400,'请选择 1 至 '+MAX_TARGETS+' 个发布账号');
 const seen=new Set();
 const targets=value.map(item=>{
  if(!item||typeof item!=='object'||typeof item.platform!=='string'||typeof item.accountId!=='string'||!SERVER_OWNED_PLATFORMS.has(item.platform)||item.accountId.length<1||item.accountId.length>120)reject(400,'发布授权仅支持已验证的自建站或 API 发布账号');
  const key=item.platform+'\u0000'+item.accountId;
  if(seen.has(key))reject(400,'同一发布账号不能重复选择');
  seen.add(key);
  return {platform:item.platform,accountId:item.accountId};
 });
 return targets.sort((a,b)=>(a.platform+'\u0000'+a.accountId).localeCompare(b.platform+'\u0000'+b.accountId));
}

function safeAccount(account,operation){
 const capability=operation==='draft'?'createDraft':'publish';
 if(!account?.capabilities?.[capability])reject(409,'所选账号当前不具备'+(operation==='draft'?'保存草稿':'公开发布')+'能力，请刷新账号状态');
 if(typeof account.connectionRevision!=='string'||!account.connectionRevision)reject(409,'账号连接缺少可核对版本，请重新连接后再发布');
 return {platform:account.platform,accountId:account.accountId,name:String(account.username||account.blog||account.site||account.accountId).slice(0,200),site:String(account.site||'').slice(0,1000),connectionRevision:account.connectionRevision,operation};
}

export async function authorizationInputs(env,ctx,state,body){
 const brandId=typeof body.brandId==='string'?body.brandId:'';
 if(!state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
 const operation=mode(body.mode),content=publishingContentSnapshot(state,brandId,body.contentId);
 const contentHash=await publishingContentHash(content);
 const selected=requestedTargets(body.targets);
 const directory=await publishingAccounts(env,ctx,brandId);
 const targets=selected.map(target=>{
  if(target.platform!=='wechat')return safeAccount(directory.find(account=>account.platform===target.platform&&account.accountId===target.accountId),operation);
  // The isolated personal-account browser belongs only to this desktop's
  // local owner. Team roles and hosted sessions cannot borrow its login.
  if(env.GEO_LOCAL_MODE!=='true'||!/^dw-[a-f0-9]{64}$/.test(env.GEO_DESKTOP_WECHAT_SESSION||'')||ctx.owner!=='local-owner'||ctx.actor!=='local-owner'||ctx.role!=='owner'||ctx.key||target.accountId!=='personal-browser'||selected.length!==1)reject(403,'公众号桌面发布只能由本机个人工作区所有者单独确认');
  if([...content.title.trim()].length>64)reject(400,'公众号当前桌面连接器标题最多 64 字，请调整后再确认');
  return {platform:'wechat',accountId:'personal-browser',name:'本机公众号官方窗口',site:'https://mp.weixin.qq.com/',connectionRevision:env.GEO_DESKTOP_WECHAT_SESSION,operation};
 });
 const execution=await publishingExecutionSnapshot({media:body.media,executionPolicy:body.executionPolicy});
 assertArticleMediaDelivery(content,execution.media);
 if(targets.some(target=>target.platform==='wechat')&&execution.media.length)reject(400,'公众号桌面连接器尚不支持本次附加图片，请单独确认无附加图片的稿件');
 return {brandId,operation,content,contentHash,targets,execution};
}

function visible(record,state){
 const execution=publishingExecutionInput({media:record.media,executionPolicy:record.executionPolicy});
 return {id:record.id,brandId:record.brandId,contentId:record.contentId,contentHash:record.contentHash,media:execution.media,mediaCount:execution.media.length,executionPolicy:execution.executionPolicy,targets:record.targets,mode:record.mode,createdAt:record.createdAt,expiresAt:record.expiresAt,state,scope:record.targets?.some(t=>t.platform==='wechat')?'本机个人公众号官方窗口':'已验证的自建站与 API 发布账号',notice:'本次仅发送一次，不创建定时任务、不自动重试，也不调用模型或付费同步服务；实际平台结果仍以回执为准'};
}
function createdAuthorization(record,state){return {...visible(record,state),...(record.desktopCapability?{desktopToken:record.desktopCapability}:{})}}

async function saveState(env,ctx,row,record,state,reason=''){
 if(row.state===state&&record.invalidReason===reason)return;
 const next={...record,...(reason?{invalidReason:reason,invalidatedAt:now()}:{}),lastValidatedAt:now()};
 await env.DB.prepare('UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind=?').bind(state,JSON.stringify(next),ctx.owner,record.id,'publish-authorization').run();
 Object.assign(record,next);
}

async function validateRecord(env,ctx,state,row,record){
 const expires=Date.parse(record.expiresAt||'');
 if(!Number.isFinite(expires)||expires<=Date.now()){
  await saveState(env,ctx,row,record,'expired','授权已过期');
  reject(409,'本次发布授权已过期，请重新确认再发送');
 }
 if(row.state!=='authorized')reject(409,'本次发布授权不可用，请重新确认再发送');
 let current;
 try{current=await authorizationInputs(env,ctx,state,{brandId:record.brandId,contentId:record.contentId,mode:record.mode,targets:record.targets,media:record.media,executionPolicy:record.executionPolicy});}
 catch(error){
  await saveState(env,ctx,row,record,'stale',error.message||'稿件或账号状态已变化');
  throw error;
 }
 const storedExecution=await publishingExecutionSnapshot({media:record.media,executionPolicy:record.executionPolicy});
 if(current.contentHash!==record.contentHash||JSON.stringify(current.targets)!==JSON.stringify(record.targets)||current.execution.executionHash!==storedExecution.executionHash){
  await saveState(env,ctx,row,record,'stale','稿件、事实依据、图片、执行范围或账号连接已变化');
  reject(409,'稿件、事实依据、图片、执行范围或账号连接已变化，请重新确认再发送');
 }
 await saveState(env,ctx,row,record,'authorized');
 return visible(record,'authorized');
}

function brandFrom(url,body){
 const value=url.searchParams.get('brandId')||body?.brandId;
 if(typeof value!=='string'||!value)return '';
 return value;
}

export async function publishAuthorizationApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/publish-authorizations'))return null;
 if(ctx.key)reject(403,'请在已登录工作台确认发布授权');
 if(path==='/api/publish-authorizations'&&req.method==='GET'){
  const brandId=brandFrom(url);const w=await h.workspace(env,ctx.owner);
  if(!w.state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
  const contentId=url.searchParams.get('contentId')||'';
  const rows=(await env.DB.prepare("SELECT id,state,created,result FROM runs WHERE owner=? AND kind='publish-authorization' AND json_extract(result,'$.brandId')=? ORDER BY created DESC LIMIT 100").bind(ctx.owner,brandId).all()).results;
  return h.json({authorizations:rows.map(row=>{const record=parsePublishAuthorization(row);return visible(record,row.state)}).filter(record=>!contentId||record.contentId===contentId)});
 }
 if(req.method!=='POST')reject(405,'发布授权接口仅支持读取、确认与核验');
 requireAdmin(ctx);
 const body=await h.body(req),w=await h.workspace(env,ctx.owner);
 if(path==='/api/publish-authorizations'){
  if(body.confirmed!==true)reject(400,'请确认当前稿件、事实依据和发布账号后再发送');
  const requestId=id(body.id),expiration=expiresAt(body.expiresAt),input=await authorizationInputs(env,ctx,w.state,body);
  const fingerprint=await digest(JSON.stringify({brandId:input.brandId,contentHash:input.contentHash,executionHash:input.execution.executionHash,targets:input.targets,mode:input.operation,expiresAt:expiration}));
  const old=await env.DB.prepare('SELECT state,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,requestId).first();
  if(old){
   if(old.state===undefined||!old.result)reject(409,'此发布授权编号已被其他操作占用');
   const existing=parsePublishAuthorization({...old,id:requestId});
   if(existing.fingerprint!==fingerprint)reject(409,'此发布授权编号已用于其他稿件、账号或有效期');
   if(old.state!=='authorized'||Date.parse(existing.expiresAt)<=Date.now())reject(409,'此发布授权已经失效，请重新确认本次操作');
   return h.json({authorization:createdAuthorization(existing,old.state),existing:true});
  }
  const record={schema:'guanyin.publish-authorization/v1',id:requestId,fingerprint,brandId:input.brandId,contentId:input.content.contentId,contentHash:input.contentHash,media:input.execution.media,executionPolicy:input.execution.executionPolicy,executionHash:input.execution.executionHash,targets:input.targets,mode:input.operation,createdAt:now(),expiresAt:expiration,requestedBy:ctx.actor,ownerId:ctx.owner,...(input.targets.some(t=>t.platform==='wechat')?{desktopCapability:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')}:{})};
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,'authorized',?,?)").bind(ctx.owner,requestId,'publish-authorization',record.createdAt,JSON.stringify(record)).run();
  if(!inserted.meta.changes){
   const concurrent=await env.DB.prepare('SELECT state,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,requestId).first();
   if(!concurrent)reject(409,'发布授权正在保存，请重新确认');
   const existing=parsePublishAuthorization({...concurrent,id:requestId});
   if(existing.fingerprint!==fingerprint||concurrent.state!=='authorized')reject(409,'此发布授权编号已被其他操作占用');
   return h.json({authorization:createdAuthorization(existing,concurrent.state),existing:true});
  }
  return h.json({authorization:createdAuthorization(record,'authorized')});
 }
 if(path==='/api/publish-authorizations/validate'){
  const requestId=id(body.id),brandId=brandFrom(url,body);
  if(!w.state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
  const row=await env.DB.prepare("SELECT state,result FROM runs WHERE owner=? AND id=? AND kind='publish-authorization'").bind(ctx.owner,requestId).first();
  if(!row)reject(404,'找不到本次发布授权');
  const record=parsePublishAuthorization({...row,id:requestId});
  if(record.brandId!==brandId)reject(404,'找不到本次发布授权');
  return h.json({authorization:await validateRecord(env,ctx,w.state,{...row,id:requestId},record),valid:true});
 }
 reject(404,'发布授权接口不存在');
}
