import {canBrand,reject} from './access.js';
import {importedAnswer} from './answer-import-core.js';
import {contentDisclosureConflict} from './knowledge-core.js';

export const LIVE_PLATFORMS=['豆包','腾讯元宝','通义千问','DeepSeek','Kimi'];
export async function liveSearchApi(req,env,ctx,{body,json,workspace,appendResult}){
 const url=new URL(req.url);
 if(url.pathname!=='/api/live-search')return null;
 if(!env.LOCAL_CONSUMER_SEARCH)reject(503,'此服务尚未连接消费端查询，请在本机观引中打开');
 const read=req.method==='GET',input=read?Object.fromEntries(url.searchParams):await body(req);
 const {brandId,runId}=input;
 if(!canBrand(ctx,brandId)||!brandId)reject(404,'品牌不存在');
 if(!/^[\w-]{16,80}$/.test(runId||''))reject(400,'查询编号无效');
 if(read)return json({rows:env.LOCAL_CONSUMER_SEARCH.rows(ctx.owner,brandId,runId)});
 if(req.method!=='POST'||!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能执行平台查询');
 const {state}=await workspace(env,ctx.owner),brand=state.brands.find(b=>b.id===brandId),q=state.questions.find(q=>q.brandId===brandId&&q.id===input.questionId);
 if(!brand||!q||q.text!==input.text||(q.version||'v1')!==input.version)reject(409,'当前问题已更新，请重新选择');
 if(contentDisclosureConflict(state,{brandId,productId:q.productId||'',text:q.text}))reject(409,'问题含内部资料，请改用可公开发送的问题');
 const platforms=input.platforms;
 if(!Array.isArray(platforms)||!platforms.length||platforms.length>LIVE_PLATFORMS.length||new Set(platforms).size!==platforms.length||platforms.some(p=>!LIVE_PLATFORMS.includes(p)))reject(400,'请选择支持实时查询的平台');
 const save=async(result,platform)=>{
  const id=crypto.randomUUID(),externalId='live-'+runId+'-'+platform;
  let savedId;
  await appendResult(env,ctx.owner,s=>{
   const b=s.brands.find(b=>b.id===brandId),question=s.questions.find(x=>x.brandId===brandId&&x.id===q.id);
   if(!b||!question)reject(409,'品牌或问题已移除');
   const existing=s.answers.find(a=>a.brandId===brandId&&a.externalId===externalId);
   if(existing){savedId=existing.id;return}
   const row=importedAnswer({...result,externalId,entry:'web',platform,region:'未记录',language:'未记录',mode:'未记录',questionVersion:q.version||'v1',citationKnown:false,dataPurpose:(brand.demo||q.demo)?'trial':'formal'},b,question);
   if(row.questionText!==q.text||(question.version||'v1')!==(q.version||'v1')||(q.productId||'')!==(question.productId||''))reject(409,'提问时的问题版本已变化');
   savedId=id;s.answers.push({...row,id,source:'consumer-web',loginPromptVisible:result.loginPromptVisible===true,receivedAt:new Date().toISOString(),receivedBy:ctx.actor});
  });
  return savedId;
 };
 try{return json({rows:env.LOCAL_CONSUMER_SEARCH.start({owner:ctx.owner,brand:brandId,run:runId,question:q,platforms,retry:input.retry===true},save)})}catch(e){reject(409,e.message)}
}
