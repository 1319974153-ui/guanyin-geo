import {canBrand,digest,reject,requireAdmin} from './access.js';
import {publishingAccounts} from './publishing-center.js';
import {assertOptionalPublishAuthorization,publicationAuthorizationId,publishingContentHash,publishingContentSnapshot} from './publish-authorization-core.js';
import {publishingExecutionInput,publishingExecutionSnapshot} from './publish-execution-policy.js';

const KIND='publish-batch';
const SCHEMA='guanyin.publish-batch/v1';
const PLATFORMS=new Set(['wordpress','cnblogs','typecho','metaweblog','personal-site','yuque']);
const MODES=new Set(['draft','publish']);
const STAGES=new Set(['draft','publish']);
const MAX_TARGETS=12;
// A claim is deliberately short lived. It exists only to protect the small
// interval between an explicit click and the adapter's durable receipt. It is
// not a scheduler, a background sender, or a retry lease.
const CLAIM_TTL=3*60_000;
const now=()=>new Date().toISOString();

function batchId(value){
 if(typeof value!=='string'||!/^pb-[a-f0-9]{64}$/.test(value))reject(400,'发布批次编号无效，请重新确认本次操作');
 return value;
}

function claimId(value){
 if(typeof value!=='string'||!/^pl-[a-f0-9]{64}$/.test(value))reject(400,'发送确认编号无效，请重新点击发布');
 return value;
}

function parse(row){
 try{
  const record=JSON.parse(row?.result||'');
  if(!record||record.schema!==SCHEMA||typeof record.id!=='string')throw new Error();
  return record;
 }catch{reject(409,'发布批次记录无法读取，请刷新后重试');}
}

function requestedTargets(value){
 if(!Array.isArray(value)||value.length<1||value.length>MAX_TARGETS)reject(400,'请选择 1 至 '+MAX_TARGETS+' 个已连接发布账号');
 const seen=new Set(),targets=value.map(item=>{
  if(!item||typeof item!=='object'||typeof item.platform!=='string'||typeof item.accountId!=='string'||!PLATFORMS.has(item.platform)||!item.accountId||item.accountId.length>120)reject(400,'发布批次仅支持已验证的自建站或 API 发布账号');
  const key=item.platform+'\u0000'+item.accountId;if(seen.has(key))reject(400,'同一发布账号不能重复选择');seen.add(key);
  return {platform:item.platform,accountId:item.accountId};
 });
 return targets.sort((a,b)=>(a.platform+'\u0000'+a.accountId).localeCompare(b.platform+'\u0000'+b.accountId));
}

function targetKey(target){return target.platform+'\u0000'+target.accountId}
function leaseKey(target,stage){return targetKey(target)+'\u0000'+stage}
function claimStage(value,mode){
 if(!STAGES.has(value)||(mode==='draft'&&value!=='draft'))reject(400,'当前批次不支持这个发送步骤');
 return value;
}
function safeLeases(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const out={};
 for(const [key,item] of Object.entries(value)){
  if(typeof key!=='string'||key.length>400||!item||typeof item!=='object'||!/^pl-[a-f0-9]{64}$/.test(item.id||'')||!STAGES.has(item.stage)||!Number.isFinite(Date.parse(item.claimedAt||''))||!Number.isFinite(Date.parse(item.expiresAt||'')))continue;
  out[key]={id:item.id,stage:item.stage,claimedAt:new Date(item.claimedAt).toISOString(),expiresAt:new Date(item.expiresAt).toISOString()};
 }
 return out;
}
function leaseState(lease){
 if(!lease)return null;
 return Date.parse(lease.expiresAt)>Date.now()?'active':'expired';
}
function unknownNotice(stage){return (stage==='publish'?'公开提交':'保存草稿')+'在取得平台回执前中断，结果待核对；不会自动重发。'}

async function dispatchId(brandId,content,target,executionHash){
 const fields=[brandId,content.contentId,content.title,content.text,!!content.ai,content.facts||[]];
 // The current server-owned adapters publish reviewed text (or their own
 // separately verified WordPress cover reference). They do not accept the
 // generic local image list yet, so preserve their existing stable task IDs.
 if(executionHash&&target.usesGenericMedia===true)fields.push(executionHash);
 fields.push(target.platform,target.accountId);const source=JSON.stringify(fields);
 return 'gy-'+await digest(source);
}

function compatible(account,mode){
 const capability=mode==='publish'?'publish':'createDraft';
 if(!account?.capabilities?.[capability])reject(409,'所选账号当前不具备'+(mode==='publish'?'公开发布':'保存草稿')+'能力，请刷新账号状态');
 if(typeof account.connectionRevision!=='string'||!account.connectionRevision)reject(409,'账号连接缺少可核对版本，请重新连接后再发布');
 return account;
}

async function input(env,ctx,state,body){
 const brandId=typeof body.brandId==='string'?body.brandId:'';
 if(!state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
 if(!MODES.has(body.mode))reject(400,'发布批次仅支持保存草稿或公开发布');
 const authorizationId=publicationAuthorizationId(body.authorizationId);if(!authorizationId)reject(400,'请先确认当前稿件和账号后再创建发布批次');
 const content=publishingContentSnapshot(state,brandId,body.contentId),contentHash=await publishingContentHash(content),execution=await publishingExecutionSnapshot({media:body.media,executionPolicy:body.executionPolicy}),selected=requestedTargets(body.targets),directory=await publishingAccounts(env,ctx,brandId);
 const targets=[];
 for(const selectedTarget of selected){
  const account=compatible(directory.find(item=>item.platform===selectedTarget.platform&&item.accountId===selectedTarget.accountId),body.mode);
  await assertOptionalPublishAuthorization(env,ctx,state,{authorizationId,brandId,contentId:content.contentId,platform:account.platform,accountId:account.accountId,operation:body.mode,connectionRevision:account.connectionRevision,execution});
  targets.push({platform:account.platform,accountId:account.accountId,name:String(account.username||account.blog||account.site||account.accountId).slice(0,200),site:String(account.site||'').slice(0,1000),connectionRevision:account.connectionRevision,dispatchId:await dispatchId(brandId,content,account,execution.executionHash)});
 }
 return {brandId,content,contentHash,mode:body.mode,authorizationId,targets,execution};
}

function targetKind(target){return target.platform;}
function safeRemote(value){
 if(!value||typeof value!=='object')return null;
 const out={};
 for(const key of ['url','publicUrl','postId','docId','status','publicVerified','checkedAt','evidence'])if(typeof value[key]==='string'||typeof value[key]==='number'||typeof value[key]==='boolean')out[key]=value[key];
 return Object.keys(out).length?out:null;
}
async function targetReceipt(env,owner,target,leases={}){
 const row=await env.DB.prepare('SELECT state,result FROM runs WHERE owner=? AND id=? AND kind=?').bind(owner,target.dispatchId,targetKind(target)).first();
 const draftLease=leases[leaseKey(target,'draft')],publishLease=leases[leaseKey(target,'publish')];
 if(!row){
  const state=leaseState(draftLease);
  if(state==='active')return {platform:target.platform,accountId:target.accountId,name:target.name,dispatchId:target.dispatchId,state:'claim_pending',stage:'draft',claim:{stage:'draft',expiresAt:draftLease.expiresAt},notice:'已确认发送，正在等待原始平台回执；不会自动重试'};
  if(state==='expired')return {platform:target.platform,accountId:target.accountId,name:target.name,dispatchId:target.dispatchId,state:'result_unknown',stage:'draft',notice:unknownNotice('draft')};
  return {platform:target.platform,accountId:target.accountId,name:target.name,dispatchId:target.dispatchId,state:'not_started',stage:'未开始',notice:'批次已登记，尚未向该账号发送请求'};
 }
 let result={};try{result=JSON.parse(row.result||'{}')}catch{}
 const receipt={platform:target.platform,accountId:target.accountId,name:target.name,dispatchId:target.dispatchId,state:row.state,stage:result.stage||'',error:typeof result.error==='string'?result.error:'',remote:safeRemote(result.remote)};
 // A public release is a separate irreversible request. If the exact draft is
 // known but the later public request loses its receipt, surface that gap
 // rather than allowing a second automatic publish.
 if(row.state==='draft'){
  const state=leaseState(publishLease);
  if(state==='active')return {...receipt,pendingStage:'publish',claim:{stage:'publish',expiresAt:publishLease.expiresAt},notice:'正在等待原始公开提交回执；不会自动重试'};
  if(state==='expired')return {...receipt,state:'result_unknown',stage:'publish',notice:unknownNotice('publish')};
 }
 return receipt;
}
async function visible(env,ctx,row,state){
 const record=parse(row),targets=[],leases=safeLeases(record.targetLeases);
 for(const target of record.targets||[])targets.push(await targetReceipt(env,ctx.owner,target,leases));
 let currentRevision=false;
 try{
  const current=publishingContentSnapshot(state,record.brandId,record.contentId);
  currentRevision=record.contentHash===await publishingContentHash(current);
 }catch{}
 // The approval ID is a short-lived server-side capability. The UI only needs
 // the immutable batch ID and per-target receipts, never the approval handle
 // itself after the initial click.
 const execution=publishingExecutionInput({media:record.media,executionPolicy:record.executionPolicy});
 return {id:record.id,brandId:record.brandId,contentId:record.contentId,contentHash:record.contentHash,media:execution.media,mediaCount:execution.media.length,executionPolicy:execution.executionPolicy,currentRevision,mode:record.mode,createdAt:record.createdAt,state:row.state,targets,notice:'批次只登记一次性的已确认发送意图；不创建定时任务、不自动重试，也不调用模型或付费同步服务。若发送在回执前中断，会标记为结果待核对，绝不自动补发。各平台草稿、提交、审核与公开状态以真实回执为准'};
}

async function claimInput(env,ctx,state,record,body){
 const brandId=typeof body.brandId==='string'?body.brandId:'';
 if(record.brandId!==brandId||!state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到当前批次所属品牌');
 let current;
 try{current=publishingContentSnapshot(state,brandId,record.contentId)}catch(error){reject(error.status||409,error.message||'稿件或事实依据已变化')}
 if(await publishingContentHash(current)!==record.contentHash)reject(409,'稿件或事实依据已变化，请重新确认后再发送');
 const requested=requestedTargets([{platform:body.platform,accountId:body.accountId}])[0],stage=claimStage(body.stage,record.mode),lease=claimId(body.leaseId);
 const target=record.targets?.find(item=>item.platform===requested.platform&&item.accountId===requested.accountId);
 if(!target)reject(409,'当前批次未包含这个发布账号');
 const directory=await publishingAccounts(env,ctx,brandId),account=compatible(directory.find(item=>item.platform===target.platform&&item.accountId===target.accountId),stage);
 if(account.connectionRevision!==target.connectionRevision)reject(409,'账号连接已变化，请重新确认后再发送');
 const execution=await publishingExecutionSnapshot({media:record.media,executionPolicy:record.executionPolicy});
 await assertOptionalPublishAuthorization(env,ctx,state,{authorizationId:record.authorizationId,brandId,contentId:record.contentId,platform:target.platform,accountId:target.accountId,operation:stage,connectionRevision:target.connectionRevision,execution});
 return {target,stage,lease};
}

async function targetRun(env,owner,target){
 return env.DB.prepare('SELECT state,result FROM runs WHERE owner=? AND id=? AND kind=?').bind(owner,target.dispatchId,targetKind(target)).first();
}
function assertTargetStage(run,stage){
 if(stage==='draft'&&run)reject(409,'该账号已有原稿或发送记录，请先核对原始回执；不会重新创建');
 if(stage==='publish'&&run?.state!=='draft')reject(409,'缺少可核对的原稿，不能直接再次公开提交');
}

// The caller invokes this immediately before a real adapter write. The batch
// itself never calls a platform. A compare-and-swap protects two tabs from
// racing the same account, and an expired claim turns into an explicit
// unknown-result boundary instead of a retry trigger.
async function claimTarget(env,ctx,state,body){
 const requestId=batchId(body.id);
 for(let attempt=0;attempt<3;attempt++){
  const row=await env.DB.prepare('SELECT state,result,created FROM runs WHERE owner=? AND id=? AND kind=?').bind(ctx.owner,requestId,KIND).first();
  if(!row)reject(404,'找不到本次发布批次');
  const record=parse({...row,id:requestId}),input=await claimInput(env,ctx,state,record,body),key=leaseKey(input.target,input.stage),leases=safeLeases(record.targetLeases),prior=leases[key],priorState=leaseState(prior);
  // A receipt wins over a lingering client lease. This blocks a restarted tab
  // from turning an already-created draft or submitted release into another
  // adapter request.
  assertTargetStage(await targetRun(env,ctx.owner,input.target),input.stage);
  if(priorState==='active'){
   if(prior.id!==input.lease)reject(409,'该账号的本次发送正在进行，请先等待或查看原始回执；不会重复提交');
   return {lease:{id:prior.id,stage:prior.stage,claimedAt:prior.claimedAt,expiresAt:prior.expiresAt},existing:true,batch:await visible(env,ctx,{...row,id:requestId},state)};
  }
  if(priorState==='expired')reject(409,unknownNotice(input.stage)+'请先查看平台原稿；如需再次发送，重新确认一批新的发送操作。');
  const claimedAt=now(),lease={id:input.lease,stage:input.stage,claimedAt,expiresAt:new Date(Date.parse(claimedAt)+CLAIM_TTL).toISOString()},next={...record,targetLeases:{...leases,[key]:lease}},changed=await env.DB.prepare('UPDATE runs SET result=? WHERE owner=? AND id=? AND kind=? AND result=?').bind(JSON.stringify(next),ctx.owner,requestId,KIND,row.result).run();
  if(changed.meta.changes)return {lease:{id:lease.id,stage:lease.stage,claimedAt:lease.claimedAt,expiresAt:lease.expiresAt},existing:false,batch:await visible(env,ctx,{...row,id:requestId,result:JSON.stringify(next)},state)};
 }
 reject(409,'发布批次已变化，请刷新后再确认');
}

export async function publishBatchApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/publish-batches'))return null;
 if(ctx.key)reject(403,'请在已登录工作台创建发布批次');
 if(path==='/api/publish-batches'&&req.method==='GET'){
  const brandId=url.searchParams.get('brandId')||'',contentId=url.searchParams.get('contentId')||'',w=await h.workspace(env,ctx.owner);
  if(!w.state.brands.some(item=>item.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
  const rows=(await env.DB.prepare("SELECT id,state,created,result FROM runs WHERE owner=? AND kind='publish-batch' AND json_extract(result,'$.brandId')=? ORDER BY created DESC LIMIT 100").bind(ctx.owner,brandId).all()).results;
  const batches=[];for(const row of rows){const record=parse(row);if(!contentId||record.contentId===contentId)batches.push(await visible(env,ctx,row,w.state));}
  return h.json({batches});
 }
 if(path==='/api/publish-batches/claim'&&req.method==='POST'){
  requireAdmin(ctx);
  const body=await h.body(req),w=await h.workspace(env,ctx.owner);
  return h.json(await claimTarget(env,ctx,w.state,body));
 }
 if(path!=='/api/publish-batches'||req.method!=='POST')reject(404,'发布批次接口不存在');
 requireAdmin(ctx);
 const body=await h.body(req),w=await h.workspace(env,ctx.owner),requestId=batchId(body.id),data=await input(env,ctx,w.state,body);
 const fingerprint=await digest(JSON.stringify({brandId:data.brandId,contentHash:data.contentHash,executionHash:data.execution.executionHash,mode:data.mode,authorizationId:data.authorizationId,targets:data.targets.map(target=>({platform:target.platform,accountId:target.accountId,connectionRevision:target.connectionRevision,dispatchId:target.dispatchId}))}));
 const old=await env.DB.prepare('SELECT state,result,created FROM runs WHERE owner=? AND id=?').bind(ctx.owner,requestId).first();
 if(old){
  if(!old.result)reject(409,'此发布批次编号已被其他操作占用');
  const record=parse({...old,id:requestId});
  if(record.fingerprint!==fingerprint)reject(409,'此发布批次编号已用于其他稿件、账号或操作');
  return h.json({batch:await visible(env,ctx,{...old,id:requestId},w.state),existing:true});
 }
 const record={schema:SCHEMA,id:requestId,fingerprint,brandId:data.brandId,contentId:data.content.contentId,contentHash:data.contentHash,media:data.execution.media,executionPolicy:data.execution.executionPolicy,executionHash:data.execution.executionHash,mode:data.mode,authorizationId:data.authorizationId,targets:data.targets,targetLeases:{},createdAt:now(),requestedBy:ctx.actor};
 const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,'prepared',?,?)").bind(ctx.owner,record.id,KIND,record.createdAt,JSON.stringify(record)).run();
 if(!inserted.meta.changes){
  const concurrent=await env.DB.prepare('SELECT state,result,created FROM runs WHERE owner=? AND id=?').bind(ctx.owner,requestId).first();
  if(!concurrent?.result)reject(409,'发布批次正在保存，请重新确认');
  const existing=parse({...concurrent,id:requestId});if(existing.fingerprint!==fingerprint)reject(409,'此发布批次编号已被其他操作占用');
  return h.json({batch:await visible(env,ctx,{...concurrent,id:requestId},w.state),existing:true});
 }
 return h.json({batch:await visible(env,ctx,{id:record.id,state:'prepared',created:record.createdAt,result:JSON.stringify(record)},w.state)});
}
