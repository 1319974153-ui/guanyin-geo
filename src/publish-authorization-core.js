import {assertScheduledAuthorization} from './publish-schedule-core.js';
import {articleMediaSnapshot,assertArticleMediaDelivery} from './article-media-core.js';
import {digest,reject} from './access.js';
import {factUsable,contentDisclosureConflict} from './knowledge-core.js';
import {publishingExecutionSnapshot} from './publish-execution-policy.js';

const now=()=>new Date().toISOString();
const AUTHORIZATION_KIND='publish-authorization';
const AUTHORIZATION_SCHEMA='guanyin.publish-authorization/v1';

export function publicationAuthorizationId(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^pa-[a-f0-9]{64}$/.test(value))reject(400,'发布授权编号无效，请重新确认本次操作');
 return value;
}

// This snapshot deliberately contains only the reviewed fields that influence
// a release. It never includes credentials, platform cookies, or local files.
export function publishingContentSnapshot(state,brandId,contentId){
 const content=state.contents.find(item=>item.id===contentId&&item.brandId===brandId);
 if(!content||content.demo||content.status!=='已审核'||!content.title?.trim()||!content.text?.trim())reject(400,'请选择完整、已审核的真实稿件');
 if(contentDisclosureConflict(state,content))reject(409,'稿件含仅内部使用资料，请移除或取得公开授权后重新审核');
 if(content.productId&&state.brands.find(item=>item.id===brandId)?.productLines?.find(item=>item.id===content.productId)?.status!=='active')reject(409,'稿件所属产品线已归档，请重新审核后发布');
 for(const snapshot of content.factSnapshots||[]){
  const fact=state.facts.find(item=>item.id===snapshot.id&&item.brandId===brandId);
  if(!fact||!factUsable(fact)||fact.value!==snapshot.value||fact.source!==snapshot.source||(fact.version||1)!==(snapshot.version||1))reject(409,'稿件事实依据已变化，请重新审核后发布');
 }
 return {contentId:content.id,title:content.title,text:content.text,ai:!!content.ai,facts:content.factSnapshots||[],...articleMediaSnapshot(content)};
}

export const publishingContentHash=content=>digest(JSON.stringify(content));

export function parsePublishAuthorization(row){
 try{
  const record=JSON.parse(row?.result||'');
  if(!record||record.schema!==AUTHORIZATION_SCHEMA||typeof record.id!=='string')throw new Error();
  return record;
 }catch{reject(409,'发布授权记录无法读取，请重新确认本次操作');}
}

async function markAuthorization(env,ctx,row,record,state,reason=''){
 if(row.state===state&&record.invalidReason===reason)return;
 const next={...record,...(reason?{invalidReason:reason,invalidatedAt:now()}:{}),lastValidatedAt:now()};
 await env.DB.prepare('UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind=?').bind(state,JSON.stringify(next),ctx.owner,record.id,AUTHORIZATION_KIND).run();
 Object.assign(record,next);
}

// The distribution page passes an authorization ID to a server-owned adapter.
// Legacy single-site screens may omit it, so this intentionally validates when
// present rather than silently inventing an approval. The adapter still owns
// its normal preview, duplicate and remote-receipt checks.
export async function assertOptionalPublishAuthorization(env,ctx,state,{authorizationId,brandId,contentId,platform,accountId,operation,connectionRevision,execution,readOnly=false}){
 const id=publicationAuthorizationId(authorizationId);
 if(!id)return null;
 if(!['draft','publish'].includes(operation))reject(400,'发布授权操作类型无效');
 if(typeof platform!=='string'||typeof accountId!=='string'||typeof connectionRevision!=='string'||!connectionRevision)reject(409,'发布账号缺少可核对版本，请重新连接后再发布');
 const row=await env.DB.prepare('SELECT state,result FROM runs WHERE owner=? AND id=? AND kind=?').bind(ctx.owner,id,AUTHORIZATION_KIND).first();
 if(!row)reject(404,'找不到本次发布授权');
 const record=parsePublishAuthorization({...row,id});
 const mark=(state,reason='')=>readOnly?Promise.resolve():markAuthorization(env,ctx,row,record,state,reason);
 if(record.brandId!==brandId||record.contentId!==contentId)reject(409,'发布授权不属于当前稿件或品牌，请重新确认再发送');
 const expiry=Date.parse(record.expiresAt||'');
 if(!Number.isFinite(expiry)||expiry<=Date.now()){
  await mark('expired','授权已过期');
  reject(409,'本次发布授权已过期，请重新确认再发送');
 }
 // A public-release approval also covers creating the exact remote draft that
 // is required before that same release. A draft-only approval never covers a
 // later public release.
 if(row.state!=='authorized'||!(record.mode===operation||(record.mode==='publish'&&operation==='draft')))reject(409,'本次发布授权不适用于当前操作，请重新确认再发送');
 const target=record.targets?.find(item=>item.platform===platform&&item.accountId===accountId);
 if(!target||!(target.operation===operation||(target.operation==='publish'&&operation==='draft')))reject(409,'发布授权不包含当前账号或操作，请重新确认再发送');
 await assertScheduledAuthorization(env,ctx,record,{platform,accountId,connectionRevision});
 if(target.connectionRevision!==connectionRevision){
  await mark('stale','账号连接已变化');
  reject(409,'账号连接已变化，请重新确认再发送');
 }
 const storedExecution=await publishingExecutionSnapshot({media:record.media,executionPolicy:record.executionPolicy});
 if(execution!==undefined){
  const currentExecution=await publishingExecutionSnapshot(execution);
  if(currentExecution.executionHash!==storedExecution.executionHash){
   await mark('stale','发布图片或执行范围已变化');
   reject(409,'发布图片或执行范围已变化，请重新确认再发送');
  }
 }else if(storedExecution.media.length){
  // An adapter that does not carry the approved media reference must never
  // silently publish a text-only or different-image variant.
  await mark('stale','发布图片未随原授权传递');
  reject(409,'发布图片未随原授权传递，请重新确认再发送');
 }
 try{
  const current=publishingContentSnapshot(state,brandId,contentId);
  assertArticleMediaDelivery(current,storedExecution.media);
  if(await publishingContentHash(current)!==record.contentHash)throw Error('稿件或事实依据已变化');
 }catch(error){
  const reason=error.message||'稿件或事实依据已变化';
  await mark('stale',reason);
  reject(error.status||409,reason);
 }
 await mark('authorized');
 return {id:record.id,expiresAt:record.expiresAt,mode:record.mode,executionPolicy:storedExecution.executionPolicy,executionHash:storedExecution.executionHash};
}
