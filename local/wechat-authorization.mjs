import {reject} from '../src/access.js';
import {assertOptionalPublishAuthorization,parsePublishAuthorization,publishingContentSnapshot,publishingContentHash} from '../src/publish-authorization-core.js';
import {dispatchId} from '../src/publish-dispatch-core.js';
import {formatArticle} from '../src/article-format.js';
import {wechatPersonalCommand} from '../desktop/wechat-personal-publisher.mjs';

const CONTEXT=Object.freeze({owner:'local-owner',actor:'local-owner',role:'owner',brands:null});
const KIND='wechat-personal-intent';
// Private utility-process RPC only. Never expose this function as an HTTP
// endpoint. A readable authorization ID alone is not a dispatch capability.
export async function authorizeDesktopWechat(env,input,phase='prepare'){
 if(env.GEO_LOCAL_MODE!=='true'||!/^dw-[a-f0-9]{64}$/.test(env.GEO_DESKTOP_WECHAT_SESSION||''))reject(403,'当前服务不是公众号桌面发布服务');
 if(!['prepare','claim'].includes(phase)||!input||!/^pa-[a-f0-9]{64}$/.test(input.authorizationId||'')||!/^gy-[a-f0-9]{64}$/.test(input.taskId||'')||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.brandId||'')||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.contentId||'')||!['draft','publish'].includes(input.mode)||!(/^[a-f0-9]{64}$/).test(input.desktopToken||''))reject(403,'公众号发布缺少本次精确授权，请在原稿中重新确认');
 const row=await env.DB.prepare("SELECT state,result FROM runs WHERE owner=? AND id=? AND kind='publish-authorization'").bind(CONTEXT.owner,input.authorizationId).first();
 if(!row)reject(403,'找不到本机所有者的公众号发布授权');
 const record=parsePublishAuthorization(row);
 if(record.ownerId!==CONTEXT.owner||record.requestedBy!==CONTEXT.actor||record.desktopCapability!==input.desktopToken||record.mode!==input.mode||record.brandId!==input.brandId||record.contentId!==input.contentId||record.targets?.length!==1||record.targets[0].platform!=='wechat'||record.targets[0].accountId!=='personal-browser')reject(403,'公众号授权的工作区、本人、品牌、稿件、平台或动作不匹配');
 const workspace=await env.DB.prepare('SELECT revision,body FROM workspaces WHERE owner=?').bind(CONTEXT.owner).first();
 if(!workspace)reject(403,'找不到本机个人工作区');
 let state;try{state=JSON.parse(workspace.body)}catch{reject(409,'工作区无法读取，未执行公众号操作')}
 if(!state.brands?.some(b=>b.id===input.brandId))reject(403,'当前品牌不存在');
 await assertOptionalPublishAuthorization(env,CONTEXT,state,{authorizationId:input.authorizationId,brandId:input.brandId,contentId:input.contentId,platform:'wechat',accountId:'personal-browser',operation:input.mode,connectionRevision:env.GEO_DESKTOP_WECHAT_SESSION,execution:{media:[],executionPolicy:{frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0}},readOnly:true});
 const snapshot=publishingContentSnapshot(state,input.brandId,input.contentId),contentHash=await publishingContentHash(snapshot);
 const expected=await dispatchId({id:snapshot.contentId,brandId:input.brandId,title:snapshot.title,text:snapshot.text,ai:snapshot.ai,factSnapshots:snapshot.facts},{platform:'wechat',accountId:'personal-browser'});
 if(expected!==input.taskId)reject(409,'公众号任务与已审核稿件指纹不匹配');
 const command=wechatPersonalCommand({title:snapshot.title,html:formatArticle(snapshot.text).html,mode:input.mode,taskId:input.taskId});
 if((input.title!==undefined&&input.title!==command.title)||(input.html!==undefined&&input.html!==command.html))reject(409,'公众号待发内容与服务端已审核稿件不同');
 const intent={schema:'guanyin.wechat-intent/v1',owner:CONTEXT.owner,actor:CONTEXT.actor,brandId:input.brandId,contentId:input.contentId,contentHash,mode:input.mode,taskId:input.taskId,createdAt:new Date().toISOString()};
 if(phase==='prepare')await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,'registered',?,?)").bind(CONTEXT.owner,input.taskId,KIND,intent.createdAt,JSON.stringify(intent)).run();
 const stored=await env.DB.prepare('SELECT kind,state,result FROM runs WHERE owner=? AND id=?').bind(CONTEXT.owner,input.taskId).first();
 let prior;try{prior=JSON.parse(stored?.result||'')}catch{reject(409,'公众号原请求记录不可读，未执行操作')}
 if(stored?.kind!==KIND||prior.schema!==intent.schema||['owner','actor','brandId','contentId','contentHash','mode','taskId'].some(k=>prior[k]!==intent[k])||!['registered','requested'].includes(stored.state))reject(409,'公众号原任务已有不同动作或内容，不能重新创建');
 let claimed=false;
 if(phase==='claim'){
  // The final claim is conditional on the very workspace and approval we
  // just read, in one SQL operation. No async gap may authorize changed text
  // or resurrect a revoked/expired approval.
  const guard="EXISTS (SELECT 1 FROM workspaces w WHERE w.owner=? AND w.revision=? AND w.body=?) AND EXISTS (SELECT 1 FROM runs a WHERE a.owner=? AND a.id=? AND a.kind='publish-authorization' AND a.state='authorized' AND a.result=? AND json_extract(a.result,'$.expiresAt')>?)";
  const args=[CONTEXT.owner,workspace.revision,workspace.body,CONTEXT.owner,input.authorizationId,row.result,new Date().toISOString()];
  const result=await env.DB.prepare("UPDATE runs SET state='requested' WHERE owner=? AND id=? AND kind=? AND state='registered' AND "+guard).bind(CONTEXT.owner,input.taskId,KIND,...args).run();claimed=result.meta.changes===1;
  if(!claimed){
   const current=await env.DB.prepare('SELECT state FROM runs WHERE owner=? AND id=? AND kind=? AND '+guard).bind(CONTEXT.owner,input.taskId,KIND,...[...args.slice(0,-1),new Date().toISOString()]).first();
   if(current?.state!=='requested')reject(409,'稿件、工作区或发布授权在发送前已变化，未执行平台操作');
  }
 }
 return {command,claimed,requested:stored.state==='requested'||claimed,authorization:{authorizationId:input.authorizationId,desktopToken:input.desktopToken,brandId:input.brandId,contentId:input.contentId,mode:input.mode,taskId:input.taskId}};
}
