import {requireAdmin,canBrand,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {tasksApi} from './tasks.js';
const stamp=()=>new Date().toISOString();
export const SIMPLE_PLATFORMS=['豆包','DeepSeek','Kimi','腾讯元宝','通义千问','文心','ChatGPT'];
export function starterQuestions(name,description){
 const topic=String(description||name).split(/[。\n！？]/)[0].slice(0,65);
 return [`想了解${topic}，应该先确认哪些条件？`,`选择这类产品或服务时，应该比较哪些方案？`,`这类产品或服务的费用和使用限制有哪些？`,`有哪些适合不同需求的相关产品或服务？`,`${name}适合哪些人，使用前需要核实什么？`];
}
const value=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const callTasks=(env,ctx,h,data,path='/api/tasks')=>tasksApi(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}),env,ctx,h);
async function rows(env,ctx,brandId){const r=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND kind='simple_flow' ORDER BY created DESC LIMIT 100").bind(ctx.owner).all();return r.results.filter(r=>canBrand(ctx,r.brand_id)&&(!brandId||r.brand_id===brandId));}
async function update(env,ctx,r,data){return env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),stamp(),ctx.owner,r.id,r.revision).run();}
export async function advanceSimpleFlows(env,ctx,h){
 for(const row of await rows(env,ctx)){
  const flow=JSON.parse(row.body);if(!['writing','checking'].includes(flow.stage)||flow.paused)continue;
  const planId=flow.stage==='writing'?flow.planId:flow.checkId;
  const plan=await env.DB.prepare('SELECT status FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,planId).first();if(plan?.status!=='complete')continue;
  try{
   if(flow.stage==='writing'){
    const w=await h.workspace(env,ctx.owner),ids=w.state.contents.filter(c=>c.brandId===row.brand_id&&c.taskId===flow.planId).map(c=>c.id);if(!ids.length)reject(409,'没有取得稿件，请查看任务记录');
    const actor=ctx.key==='local-runner'?{...ctx,key:null,role:'editor'}:ctx;
    await callTasks(env,actor,h,{id:flow.checkId,brandId:row.brand_id,kind:'check',name:'简单模式 · 草稿质检',checkKind:'content',targetIds:ids,provider:flow.provider,onlyPending:true});
    const latest=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,row.id).first();
    const current=JSON.parse(latest.body);if(current.paused)await callTasks(env,actor,h,{planId:flow.checkId,action:'pause'},'/api/tasks/action');
    await update(env,ctx,latest,{...current,stage:'checking',contentIds:ids,error:''});
   }else {const w=await h.workspace(env,ctx.owner);const checks=w.state.analysisChecks.filter(c=>c.taskId===flow.checkId);await update(env,ctx,row,{...flow,stage:'review',error:checks.some(c=>c.parseError)?'质检返回无法解析，请查看检查结果并人工核对稿件。':''});}
  }catch(e){await update(env,ctx,row,{...flow,error:e.status?e.message:'后续任务未能创建，请重试',stage:'needs_attention'});}
 }
}
export async function simpleFlowApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/simple/'))return null;
 if(path==='/api/simple/flows'&&req.method==='GET'){
  const list=[];for(const row of await rows(env,ctx,url.searchParams.get('brandId'))){const d=JSON.parse(row.body);const plans=await env.DB.prepare('SELECT id,status FROM task_plans WHERE owner=? AND id IN (?,?)').bind(ctx.owner,d.planId,d.checkId).all();const items=await env.DB.prepare('SELECT status,error FROM task_items WHERE owner=? AND plan_id IN (?,?)').bind(ctx.owner,d.planId,d.checkId).all();list.push({id:row.id,brandId:row.brand_id,...d,plans:plans.results,issues:items.results.filter(i=>['failed','uncertain','deferred','retry_wait'].includes(i.status))});}return h.json({flows:list});
 }
 if(req.method!=='POST')reject(405,'请使用 POST');const b=await h.body(req);
 if(path==='/api/simple/source'){
  if(!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能整理资料');
  const page=b.url?await h.inspectPage(b.url,true,25000):null,text=value(page?.sourceText||b.text,50000);if(text.length<8)reject(400,'资料太少，请粘贴业务介绍或上传资料');
  const heading=value(page?.h1||page?.title||text.split('\n').find(x=>x.trim()),160).replace(/^#+\s*/,'');
  return h.json({name:heading,description:text.slice(0,1200),text,source:page?.url||value(b.source,300)||'用户提供的业务资料',site:page?.url||'',fetchedAt:page?.checkedAt||null});
 }
 if(path==='/api/simple/setup'){
  requireAdmin(ctx);if(!/^[a-zA-Z0-9-]{16,60}$/.test(b.id||''))reject(400,'建档编号无效');
  const name=value(b.name,160),description=value(b.description,5000),text=value(b.text,50000),source=value(b.source,1000);
  if(!name||description.length<8||text.length<8||!source||b.confirmed!==true)reject(400,'请核对业务名称、介绍和原始资料');
  const platforms=Array.isArray(b.platforms)?b.platforms:[];if(!platforms.length||platforms.some(p=>!SIMPLE_PLATFORMS.includes(p))||new Set(platforms).size!==platforms.length)reject(400,'请选择支持的 AI 平台');
  const site=b.site?h.publicUrl(b.site).href:'',hash=await digest(JSON.stringify({name,description,text,source,site,platforms}));
  await h.appendResult(env,ctx.owner,s=>{
   const old=s.brands.find(x=>x.id===b.id);if(old){if(old.setupHash!==hash)reject(409,'这次建档已保存，请刷新查看；修改请编辑业务资料');return;}
   s.brands.push({id:b.id,name,description,client:name,industry:'其他',aliases:name,owner:'',site,demo:false,setupHash:hash,platforms});s.currentBrand=b.id;s.scope='import';s.viewMode='simple';
   s.sourceDocuments.push({id:b.id+'-source',brandId:b.id,title:source,text,kind:'uploaded',created:stamp()});
   s.facts.push({id:b.id+'-fact',brandId:b.id,key:'已核对的业务介绍',value:description,source,sourceDocumentId:b.id+'-source',status:'已确认',confirmationMethod:'manual'});
   starterQuestions(name,description).forEach((text,i)=>s.questions.push({id:b.id+'-q'+i,brandId:b.id,text,version:'v1',topic:'初始问题建议',intent:i===4?'了解':'比较',demo:false}));
  });return h.json(await h.workspace(env,ctx.owner));
 }
 if(path==='/api/simple/prepare'){
  if(!['owner','admin','editor'].includes(ctx.role)||ctx.key)reject(403,'当前角色不能启动业务流程');
  const w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand)reject(404,'业务不存在');if(!/^[a-zA-Z0-9-]{16,60}$/.test(b.id||''))reject(400,'流程编号无效');
  if(!w.state.facts.some(f=>f.brandId===brand.id&&factUsable(f)))reject(400,'请先核对至少一项业务资料');
  const q=w.state.questions.find(q=>q.brandId===brand.id&&q.id===b.questionId);if(!q)reject(400,'请选择一个客户问题');
  const planId=b.id,checkId=b.id+'-check',flow={planId,checkId,provider:b.provider,questionId:q.id,stage:'writing',paused:false,error:'',created:stamp()};
  const old=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  if(old){const data=JSON.parse(old.body);if(old.kind!=='simple_flow'||old.brand_id!==brand.id||data.provider!==b.provider||data.questionId!==q.id)reject(409,'流程编号已使用');return h.json({id:b.id,existing:true});}
  const prior=await env.DB.prepare('SELECT kind,brand_id,spec FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,planId).first();if(prior){const spec=JSON.parse(prior.spec);if(prior.kind!=='generate'||prior.brand_id!==brand.id||spec.providers.length!==1||spec.providers[0]!==b.provider||spec.questions.length!==1||spec.questions[0].id!==q.id)reject(409,'已有任务与此次请求不同，请刷新进度');}
  await callTasks(env,ctx,h,{id:planId,brandId:brand.id,name:'简单模式 · 准备一篇内容',kind:'generate',questionIds:[q.id],providers:[b.provider],repeats:1,intervalMinutes:0,style:'专业解答',brief:'先回答用户的问题；使用已确认的业务资料，不编造排名、认证、价格或效果。'});
  await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) VALUES(?,?,?,'simple_flow',?,1,?,?)").bind(b.id,ctx.owner,brand.id,JSON.stringify(flow),stamp(),stamp()).run();return h.json({id:b.id});
 }
 if(path==='/api/simple/tick'){
  const scoped={...ctx,brands:[b.brandId]},w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'业务不存在');
  await advanceSimpleFlows(env,scoped,h);const result=await callTasks(env,scoped,h,{brandId:b.brandId},'/api/tasks/tick');await advanceSimpleFlows(env,scoped,h);return result;
 }
 if(path==='/api/simple/action'){
  const row=(await rows(env,ctx,b.brandId)).find(r=>r.id===b.id);if(!row)reject(404,'流程不存在');if(!['pause','resume'].includes(b.action))reject(400,'操作无效');const d=JSON.parse(row.body);if(d.stage==='review')return h.json({saved:true});
  const changed=await update(env,ctx,row,{...d,paused:b.action==='pause',...(b.action==='resume'&&d.stage==='needs_attention'?{stage:d.contentIds?'checking':'writing',error:''}:{})});if(!changed.meta.changes)reject(409,'流程已更新，请刷新后重试');
  for(const id of [d.planId,d.checkId]){const p=await env.DB.prepare('SELECT status FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,id).first();if(p&&p.status!=='complete'&&p.status!=='canceled')await callTasks(env,ctx,h,{planId:id,action:b.action},'/api/tasks/action');}return h.json({saved:true});
 }
 reject(404,'没有这个简单模式操作');
}
