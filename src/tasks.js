import {contentPlan} from './content-plan.js';
import {taskCostPolicy} from './task-cost-policy.js';
import {writingOptions,writingRequest} from './writing.js';
import {createCheckPlan} from './check-tasks.js';
import {checkStale} from './checks-core.js';
import {validateCheckInput,checkModelRequest,checkRecord} from './check-execution.js';
import {prepareRetest,retestRequestHash,retestActionStatement} from './retests.js';
import {productFields,productFor,factsForProduct} from './product-core.js';
import {factUsable} from './knowledge-core.js';
import {canBrand,policy,reject,digest} from './access.js';
import {articleTitle} from './automation.js';
const stamp=()=>new Date().toISOString();
const plus=(ms)=>new Date(Date.now()+ms).toISOString();
const activeStates=['queued','running','ready','persisting','deferred','retry_wait','uncertain','failed'];
function mayWrite(ctx,execute=false){if(ctx.key){if(!ctx.scopes.includes(execute?'run':'write'))reject(403,execute?'此 Key 未授权执行模型任务':'此 Key 没有任务写入权限')}else if(!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能执行任务');}
async function planFor(env,ctx,id){const p=await env.DB.prepare('SELECT * FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,id).first();if(!p||!canBrand(ctx,p.brand_id))reject(404,'找不到已授权的任务');return p;}
async function taskList(env,ctx,brandId){
 const plans=await env.DB.prepare('SELECT * FROM task_plans WHERE owner=? ORDER BY created DESC').bind(ctx.owner).all();
 const visible=plans.results.filter(p=>canBrand(ctx,p.brand_id)&&(!brandId||p.brand_id===brandId));
 const output=[];
 for(const p of visible){const counts=await env.DB.prepare('SELECT status,count(*) AS count FROM task_items WHERE owner=? AND plan_id=? GROUP BY status').bind(ctx.owner,p.id).all();output.push({...p,spec:JSON.parse(p.spec),counts:Object.fromEntries(counts.results.map(x=>[x.status,x.count]))})}
 return output;
}
async function enqueue(env,ctx,p){
 if(p.status!=='active'||!p.next_at||p.next_at>stamp())return 0;
 // Stop overlapping cycles, including unresolved or uncertain provider responses.
 const unfinished=await env.DB.prepare("SELECT count(*) AS n FROM task_items WHERE owner=? AND plan_id=? AND status NOT IN ('complete','canceled')").bind(ctx.owner,p.id).first();if(unfinished.n)return 0;
 const spec=typeof p.spec==='string'?JSON.parse(p.spec):p.spec,at=p.next_at,statements=[];
 const entries=p.kind==='check'?spec.groups.map((g,i)=>({key:'check:'+i,item:{kind:'check',checkKind:spec.checkKind,input:g.input,provider:spec.providers[0],repeat:1,scheduledAt:at}})):spec.questions.flatMap(question=>spec.providers.flatMap(provider=>Array.from({length:spec.repeats},(_,repeat)=>({key:[question.id,provider,repeat].join(':'),item:{kind:p.kind,question,provider,repeat:repeat+1,style:spec.style,brief:spec.brief,region:spec.region,language:spec.language,scheduledAt:at}}))));
 for(const {key,item} of entries){
  const id=await digest([ctx.owner,p.id,at,key].join(':'));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO task_items(id,owner,plan_id,brand_id,spec,status,attempts,available,created,updated) SELECT ?,?,?,?,?,'queued',0,?,?,? WHERE EXISTS(SELECT 1 FROM task_plans WHERE owner=? AND id=? AND status='active' AND next_at=?)").bind(id,ctx.owner,p.id,p.brand_id,JSON.stringify(item),stamp(),stamp(),stamp(),ctx.owner,p.id,at));
 }
 const next=spec.intervalMinutes?new Date(Math.max(Date.now(),Date.parse(at))+spec.intervalMinutes*60000).toISOString():null;
 statements.push(env.DB.prepare("UPDATE task_plans SET next_at=?,updated=? WHERE owner=? AND id=? AND status='active' AND next_at=?").bind(next,stamp(),ctx.owner,p.id,at));
 const r=await env.DB.batch(statements);return r.slice(0,-1).reduce((n,x)=>n+x.meta.changes,0);
}
async function recoverExpired(env,ctx){
 const expired=await env.DB.prepare("SELECT id,brand_id,status FROM task_items WHERE owner=? AND status IN ('running','persisting') AND lease_until<?").bind(ctx.owner,stamp()).all();
 for(const row of expired.results.filter(x=>canBrand(ctx,x.brand_id)))await env.DB.prepare('UPDATE task_items SET status=?,error=?,lease_until=NULL,lease_token=NULL,updated=? WHERE owner=? AND id=? AND status=? AND lease_until<?').bind(row.status==='persisting'?'ready':'uncertain',row.status==='persisting'?'保存中断，可继续恢复已返回结果':'执行租约已过期，供应商结果不确定；请核对用量后再重试',stamp(),ctx.owner,row.id,row.status,stamp()).run();
}
async function finishPlan(env,owner,id){
 await env.DB.prepare("UPDATE task_plans SET status='complete',updated=? WHERE owner=? AND id=? AND status='active' AND next_at IS NULL AND EXISTS(SELECT 1 FROM task_items WHERE owner=? AND plan_id=?) AND NOT EXISTS(SELECT 1 FROM task_items WHERE owner=? AND plan_id=? AND status NOT IN ('complete','canceled'))").bind(stamp(),owner,id,owner,id,owner,id).run();
}
async function persistReady(env,ctx,item,h){
 const token=crypto.randomUUID();const claimed=await env.DB.prepare("UPDATE task_items SET status='persisting',lease_token=?,lease_until=?,updated=? WHERE owner=? AND id=? AND status='ready'").bind(token,plus(180000),stamp(),ctx.owner,item.id).run();if(!claimed.meta.changes)return {state:'busy'};
 try{
  const payload=JSON.parse(item.result),record=payload.record;
  await h.appendResult(env,ctx.owner,s=>{if(!s.brands.some(b=>b.id===item.brand_id))reject(404,'品牌已移除，不导入任务结果');const target=item.spec.kind==='check'?s.analysisChecks:item.spec.kind==='generate'?s.contents:s.answers;if(!target.some(x=>x.id===record.id))target.push(record)});
  await env.DB.prepare("UPDATE task_items SET status='complete',lease_until=NULL,lease_token=NULL,error=NULL,updated=? WHERE owner=? AND id=? AND lease_token=?").bind(stamp(),ctx.owner,item.id,token).run();await finishPlan(env,ctx.owner,item.plan_id);if(item.spec.kind==='check'&&record.parseError)await env.DB.prepare("UPDATE task_plans SET status='paused',updated=? WHERE owner=? AND id=? AND status='active'").bind(stamp(),ctx.owner,item.plan_id).run();return {state:'complete',itemId:item.id,recordId:record.id,kind:item.spec.kind};
 }catch(e){await env.DB.prepare("UPDATE task_items SET status=?,error=?,lease_until=NULL,lease_token=NULL,updated=? WHERE owner=? AND id=? AND lease_token=?").bind(e.status===404?'canceled':'ready',e.status?e.message:'结果已返回但保存失败，可继续恢复，无需再次调用模型',stamp(),ctx.owner,item.id,token).run();return {state:e.status===404?'canceled':'save_pending',itemId:item.id,error:e.status?e.message:'结果保存待恢复'};}
}
export async function tick(env,ctx,h,planId){
 mayWrite(ctx,true);if(planId)await planFor(env,ctx,planId);await recoverExpired(env,ctx);
 const plans=await taskList(env,ctx);for(const p of plans.filter(p=>(!planId||p.id===planId)&&p.status==='active'))await enqueue(env,ctx,p);
 if(ctx.brands?.length===0)return {state:'idle'};
 const restrictions=(ctx.brands?' AND i.brand_id IN ('+ctx.brands.map(()=>'?').join(',')+')':'')+(planId?' AND i.plan_id=?':'');
 const rows=await env.DB.prepare("SELECT i.* FROM task_items i JOIN task_plans p ON p.owner=i.owner AND p.id=i.plan_id WHERE i.owner=? AND p.status='active' AND i.status IN ('ready','queued','deferred','retry_wait') AND i.available<=?"+restrictions+" ORDER BY CASE WHEN i.status='ready' THEN 0 ELSE 1 END,i.created,i.id LIMIT 1").bind(ctx.owner,stamp(),...(ctx.brands||[]),...(planId?[planId]:[])).all();
 const item=rows.results.find(i=>canBrand(ctx,i.brand_id)&&(!planId||i.plan_id===planId));if(!item)return {state:'idle',note:'当前没有可领取任务；查看暂停、配额延后、异常或下一次计划时间。'};item.spec=JSON.parse(item.spec);
 if(item.status==='ready')return persistReady(env,ctx,item,h);
 const token=crypto.randomUUID(),attempt=item.attempts+1;
 const claim=await env.DB.prepare("UPDATE task_items SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated=? WHERE owner=? AND id=? AND status=? AND EXISTS(SELECT 1 FROM task_plans WHERE owner=? AND id=? AND status='active')").bind(token,plus(item.spec.kind==='check'?300000:180000),stamp(),ctx.owner,item.id,item.status,ctx.owner,item.plan_id).run();if(!claim.meta.changes)return {state:'busy'};
 const runId=item.id+'-'+attempt;let reserved=false,costPolicy;
 try{
  const limits=await policy(env,ctx.owner),definition=JSON.parse((await planFor(env,ctx,item.plan_id)).spec);costPolicy=definition.costPolicy;if(definition.repeats>limits.repeatsPerJob||definition.providers.length>limits.platformsPerJob)reject(400,'任务超过调整后的重复次数或平台配额，请修改配额或重新创建任务');
  const w=await h.loadWorkspace(env,ctx.owner),brand=w.state.brands.find(b=>b.id===item.brand_id),spec=item.spec;
  if(!brand)reject(404,'品牌已移除，停止执行任务');
  const connection=await h.connection(env,ctx.owner,spec.provider);if(!connection)reject(400,'模型连接已移除或尚未配置');
  if(costPolicy&&connection.model!==costPolicy.model)reject(412,'模型已变化，本批授权未执行；请重新查看内容计划并确认费用');
  if(costPolicy?.previewHash){const plan=contentPlan(w.state,brand.id,costPolicy.questionId,{provider:spec.provider,model:connection.model});if(await digest(JSON.stringify(plan))!==costPolicy.previewHash)reject(412,'资料或问题已变化，本批未调用模型；请重新查看内容计划并确认费用');}
  let record;
  if(spec.kind==='check'){
   validateCheckInput(spec.input);
   if(checkStale({brandId:brand.id,kind:spec.input.kind,input:spec.input},w.state))reject(412,'原文或品牌资料在排队后发生变化，本批未调用模型；请按最新资料重新建立检查');
   if(await h.reserveRun(env,ctx.owner,runId,'analyze'))reject(409,'此检查尝试已有调用记录，需要核对结果');reserved=true;
   const result=await h.modelCall(env,ctx.owner,checkModelRequest(spec.provider,spec.input));
   record={...await checkRecord(item.id,brand.id,spec.provider,spec.input,result),taskId:item.plan_id,taskItemId:item.id};
  }else{
  if(spec.question.productId&&productFor(brand,spec.question.productId)?.status!=='active')reject(400,'任务所属产品线已归档，请核对后创建新任务');
  const facts=factsForProduct(w.state.facts.filter(f=>f.brandId===brand.id&&factUsable(f)),spec.question.productId||'');
  if(spec.kind==='generate'&&!facts.length)reject(400,'没有有效且已确认的品牌事实，请补齐后重试');
  if(await h.reserveRun(env,ctx.owner,runId,spec.kind))reject(409,'此执行尝试已有调用记录，需要核对结果');reserved=true;
  const writing=spec.kind==='generate'?writingRequest({brand,product:spec.question.productSnapshot?.name||'品牌通用',question:spec.question.text,facts,style:spec.style,brief:spec.brief,variant:spec.repeat}):null;
  const messages=writing?.messages||[{role:'user',content:spec.question.text}];
  const result=await h.modelCall(env,ctx.owner,{provider:spec.provider,messages});
  const base={id:item.id,brandId:brand.id,...(Object.hasOwn(spec.question,'productId')?{productId:spec.question.productId,productSnapshot:spec.question.productSnapshot||null}:{}),taskId:item.plan_id,taskItemId:item.id,questionVersion:spec.question.version,questionSnapshot:spec.question.text,questionText:spec.question.text,provider:spec.provider,model:result.model,requestId:result.requestId,usage:result.usage,date:stamp(),demo:false};
  record=spec.kind==='generate'?{...base,questionId:spec.question.id,title:articleTitle({text:result.text,question:spec.question.text,brand:brand.name}),question:spec.question.text,status:'草稿',style:spec.style,text:result.text,ai:true,generated:false,variant:spec.repeat,brief:spec.brief,writingBasis:writing.basis,factIds:facts.map(f=>f.id),factSnapshots:facts.map(f=>({id:f.id,version:f.version||1,key:f.key,value:f.value,source:f.source,productId:f.productId||'',validFrom:f.validFrom||'',expiresAt:f.expiresAt||'',sourceDocumentId:f.sourceDocumentId||''}))}:{...base,promptId:spec.question.id,platform:h.PROVIDERS[spec.provider].name,surface:'api',entry:'api',mode:'官方 API · 不联网',region:spec.region,language:spec.language,status:'ok',text:result.text,mention:[brand.name,...String(brand.aliases||'').split(',')].map(n=>n.trim()).filter(Boolean).some(n=>result.text.toLowerCase().includes(n.toLowerCase())),recommended:false,recommendationLabeled:false,citationKnown:false,official:false,rank:null,sentiment:'待复核',citations:[]};
  }
  const payload=JSON.stringify({record,receivedAt:stamp()});
  // Preserve the paid response before saving business assets; replaying this phase never calls a model.
  await env.DB.prepare("UPDATE runs SET state='complete',result=? WHERE owner=? AND id=?").bind(payload,ctx.owner,runId).run();
  const saved=await env.DB.prepare("UPDATE task_items SET status='ready',result=?,error=NULL,lease_until=NULL,lease_token=NULL,updated=? WHERE owner=? AND id=? AND lease_token=? AND attempts=?").bind(payload,stamp(),ctx.owner,item.id,token,attempt).run();
  if(!saved.meta.changes)return {state:'uncertain',itemId:item.id,error:'返回结果已存入调用记录，但任务状态已改变，请核对后恢复'};
  return persistReady(env,ctx,{...item,result:payload},h);
 }catch(e){
  let state=e.status===404?'canceled':e.uncertain||e.status===409?'uncertain':'failed',available=stamp();
  if(e.status===429&&!reserved&&!costPolicy){state='deferred';available=new Date(Date.parse(stamp().slice(0,10)+'T00:00:00Z')+86460000).toISOString();}
  else if(e.retrySafe&&attempt<3&&costPolicy?.autoRetry!==false){state='retry_wait';available=plus(30000*2**(attempt-1));}
  // Unknown exceptions after sending may have billed. Do not automatically repeat them.
  else if(reserved&&!e.status)state='uncertain';
  const message=e.status?e.message:'任务执行中断，结果尚未确认';
  if(reserved)await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND state='running'").bind(state==='uncertain'?'uncertain':'failed',JSON.stringify({error:message}),ctx.owner,runId).run();
  await env.DB.prepare('UPDATE task_items SET status=?,error=?,available=?,lease_until=NULL,lease_token=NULL,updated=? WHERE owner=? AND id=? AND lease_token=?').bind(state,message,available,stamp(),ctx.owner,item.id,token).run();
  return {state,itemId:item.id,error:message,available};
 }
}
export async function tasksApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname==='/api/runner/tick'?'/api/tasks/tick':url.pathname.replace('/api/v1/','/api/'),method=req.method;if(!path.startsWith('/api/tasks'))return null;
 if(path==='/api/tasks'&&method==='GET'){
  const plans=await taskList(env,ctx,url.searchParams.get('brandId'));
  const last=await env.DB.prepare("SELECT created FROM audit_events WHERE owner=? AND action IN ('POST /api/v1/tasks/tick','POST /api/runner/tick') AND status=200 AND (actor LIKE 'key:%' OR actor='runner:local-machine') ORDER BY created DESC LIMIT 1").bind(ctx.owner).first();
  return h.json({plans,localBackground:env.LOCAL_RUNTIME?.status()||null,executor:{lastExternalTick:last?.created||null,status:last?(Date.now()-Date.parse(last.created)<300000?'执行器最近 5 分钟有响应':'执行器最近 5 分钟未响应，检查电脑或网络'):'尚未连接外部定时触发器'}});
 }
 if(path==='/api/tasks/items'&&method==='GET'){
  const id=url.searchParams.get('planId'),plan=await planFor(env,ctx,id);const r=await env.DB.prepare('SELECT * FROM task_items WHERE owner=? AND plan_id=? ORDER BY created DESC,id LIMIT 500').bind(ctx.owner,id).all();
  return h.json({plan:{id:plan.id,name:plan.name,origin:JSON.parse(plan.spec).origin||null,costPolicy:JSON.parse(plan.spec).costPolicy||null},items:r.results.map(i=>({...i,spec:JSON.parse(i.spec),result:i.result?JSON.parse(i.result):null,lease_token:undefined}))});
 }
 if(path==='/api/tasks'&&method==='POST'){
  mayWrite(ctx);if(ctx.key)mayWrite(ctx,true);const b=await h.body(req),w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand)reject(404,'找不到授权品牌');
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||''))reject(400,'任务标识缺失');
  const old=await env.DB.prepare('SELECT id,brand_id,kind,spec FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(b.kind==='check'||old?.kind==='check')return createCheckPlan(env,ctx,h,b,w,old,p=>enqueue(env,ctx,p));if(old){if(old.brand_id!==b.brandId||b.actionId&&(JSON.parse(old.spec).origin?.requestHash!==await retestRequestHash(b)))reject(409,'此任务标识已被使用或复测参数已改变');return h.json({id:old.id,existing:true})}
  if(!['sample','generate'].includes(b.kind)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120)reject(400,'请选择任务类型并填写名称');
  const retest=await prepareRetest(env,ctx,b);
  const limits=await policy(env,ctx.owner),count=await env.DB.prepare('SELECT count(*) AS n FROM task_plans WHERE owner=?').bind(ctx.owner).first();if(count.n>=limits.jobs)reject(429,'已达到工作区任务数量上限');
  if(!Array.isArray(b.providers)||!b.providers.length||new Set(b.providers).size!==b.providers.length||b.providers.length>limits.platformsPerJob||b.providers.some(p=>!h.PROVIDERS[p]))reject(400,'请选择配额范围内、不重复的模型平台');
  for(const provider of b.providers)if(!await h.connection(env,ctx.owner,provider))reject(400,'请先配置所选模型平台');
  if(!Array.isArray(b.questionIds)||!b.questionIds.length||new Set(b.questionIds).size!==b.questionIds.length)reject(400,'请选择不重复的客户问题');
  const questions=b.questionIds.map(id=>w.state.questions.find(q=>q.id===id&&q.brandId===brand.id));if(questions.some(q=>!q))reject(400,'问题必须属于当前授权品牌');if(questions.some(q=>q.productId&&productFor(brand,q.productId)?.status!=='active'))reject(400,'所选问题包含已归档产品线，请先调整问题');
  if(retest?.action.origin?.kind==='opportunity'&&questions.some(q=>q.id!==retest.action.origin.opportunity.questionId||(q.productId||'')!==retest.action.origin.opportunity.productId))reject(400,'复测必须使用此机会对应的问题与原产品归属，改版后请重新评估');
  if(retest?.action.origin?.options?.productId&&questions.some(q=>(q.productId||'@brand')!==retest.action.origin.options.productId))reject(400,'复测问题必须属于此诊断的产品范围');
  if(!Number.isInteger(b.repeats)||b.repeats<1||b.repeats>limits.repeatsPerJob)reject(400,`重复次数应为 1 至 ${limits.repeatsPerJob}`);
  if(questions.length*b.providers.length*b.repeats>80)reject(400,'单批最多 80 次请求，请拆分任务');
  if(![0,60,360,1440,4320,10080].includes(b.intervalMinutes)||b.kind==='generate'&&b.intervalMinutes!==0)reject(400,'请选择支持的采样频率；批量写作仅运行一次');
  const firstAt=b.firstAt?new Date(b.firstAt):new Date();if(Number.isNaN(firstAt.getTime())||firstAt.getTime()>Date.now()+366*86400000)reject(400,'首次执行时间不正确');
  if(b.kind==='generate'&&questions.some(q=>!factsForProduct(w.state.facts.filter(f=>f.brandId===brand.id&&factUsable(f)),q.productId||'').length))reject(400,'批量写作前请确认至少一项有效品牌事实');
  const options=b.kind==='generate'?writingOptions(b):{style:'',brief:''};
  const spec={providers:b.providers,repeats:b.repeats,intervalMinutes:b.intervalMinutes,questions:questions.map(q=>({id:q.id,text:q.text,version:q.version||'v1',topic:q.topic||'',...productFields(brand,q.productId||'')})),...options,region:String(b.region||'未指定').slice(0,80),language:String(b.language||'zh-CN').slice(0,40)};
  const costPolicy=taskCostPolicy(b.costPolicy);if(costPolicy){if(b.intervalMinutes!==0||b.repeats!==1||b.providers.length!==1||questions.length!==1)reject(400,'单批费用授权只支持一次、一个问题和一个模型');spec.costPolicy=costPolicy;}
  if(retest)spec.origin={kind:'action',actionId:retest.row.id,actionRevision:retest.row.revision,title:retest.action.title,requestHash:retest.requestHash};
  // Both the plan and its action link commit together. A stale action cannot create a paid queue.
  const guard=retest?" AND EXISTS(SELECT 1 FROM operation_records WHERE owner=? AND id=? AND revision=? AND kind='action')":'';
  const statement=env.DB.prepare("INSERT OR IGNORE INTO task_plans(id,owner,brand_id,name,kind,spec,status,next_at,created,updated) SELECT ?,?,?,?,?,?,'active',?,?,? WHERE (SELECT count(*) FROM task_plans WHERE owner=?)<?"+guard).bind(b.id,ctx.owner,brand.id,b.name.trim(),b.kind,JSON.stringify(spec),firstAt.toISOString(),stamp(),stamp(),ctx.owner,limits.jobs,...(retest?[ctx.owner,retest.row.id,retest.row.revision]:[]));
  const insert=retest?(await env.DB.batch([statement,retestActionStatement(env,ctx,b,retest)]))[0]:await statement.run();
  if(!insert.meta.changes){const duplicate=await env.DB.prepare('SELECT id,brand_id,spec FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(duplicate&&duplicate.brand_id===b.brandId&&(!b.actionId||JSON.parse(duplicate.spec).origin?.requestHash===await retestRequestHash(b)))return h.json({id:b.id,existing:true});reject(retest?409:429,retest?'待办已变化或任务配额已满，请刷新后重试':'已达到工作区任务数量上限');}
  const p=await planFor(env,ctx,b.id),queued=await enqueue(env,ctx,p);return h.json({id:b.id,queued,requestsPerCycle:questions.length*b.providers.length*b.repeats});
 }
 if(path==='/api/tasks/action'&&method==='POST'){
  mayWrite(ctx);const b=await h.body(req),p=await planFor(env,ctx,b.planId);
  if(['pause','resume'].includes(b.action)){
   if(b.action==='resume'&&ctx.key)mayWrite(ctx,true);
   if(p.status==='complete')reject(400,'已完成任务无需恢复，请创建新任务');await env.DB.prepare('UPDATE task_plans SET status=?,updated=? WHERE owner=? AND id=?').bind(b.action==='pause'?'paused':'active',stamp(),ctx.owner,p.id).run();if(b.action==='resume')await finishPlan(env,ctx.owner,p.id);return h.json({saved:true,note:'已领取的请求可能仍会完成；后续领取使用新状态。'});
  }
  if(b.action==='cancel'){
   await env.DB.batch([env.DB.prepare("UPDATE task_plans SET status='canceled',updated=? WHERE owner=? AND id=?").bind(stamp(),ctx.owner,p.id),env.DB.prepare("UPDATE task_items SET status='canceled',updated=? WHERE owner=? AND plan_id=? AND status IN ('queued','deferred','retry_wait','failed','uncertain')").bind(stamp(),ctx.owner,p.id)]);return h.json({saved:true});
  }
  if(['retry','recover'].includes(b.action)){
   if(p.status==='canceled')reject(400,'已取消任务不能继续执行');
   const item=await env.DB.prepare('SELECT * FROM task_items WHERE owner=? AND id=? AND plan_id=?').bind(ctx.owner,b.itemId,p.id).first();if(!item||!['failed','uncertain','ready','deferred','retry_wait'].includes(item.status))reject(400,'这条任务目前不能重试');
   if(b.action==='recover'){
    const receipt=await env.DB.prepare("SELECT result FROM runs WHERE owner=? AND id=? AND state='complete'").bind(ctx.owner,item.id+'-'+item.attempts).first();if(!receipt)reject(404,'没有可恢复的已返回结果，请核对供应商记录');
    const saved=JSON.parse(receipt.result);if(!saved.record)reject(400,'调用回执不包含完整业务结果');await env.DB.prepare("UPDATE task_items SET status='ready',result=?,error=NULL,available=?,updated=? WHERE owner=? AND id=? AND status=?").bind(receipt.result,stamp(),stamp(),ctx.owner,item.id,item.status).run();return h.json({saved:true});
   }
   if((item.status==='uncertain'||JSON.parse(p.spec).costPolicy)&&!item.result&&b.confirmCost!==true)reject(400,'请先核对供应商用量；确认可能重复计费后才能重试');
   if(item.attempts>=10)reject(400,'该条任务已尝试 10 次，请排查服务配置后创建新任务');
   // Already received results can only be persisted again, never regenerated by retry.
   await env.DB.prepare('UPDATE task_items SET status=?,error=NULL,available=?,updated=? WHERE owner=? AND id=? AND status=?').bind(item.result?'ready':'queued',stamp(),stamp(),ctx.owner,item.id,item.status).run();return h.json({saved:true});
  }
  reject(400,'不支持的任务操作');
 }
 if(path==='/api/tasks/tick'&&method==='POST'){const b=await h.body(req);let scoped=ctx;if(b.brandId){const w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');scoped={...ctx,brands:[b.brandId]}}return h.json(await tick(env,scoped,h,b.planId));}
 reject(404,'没有这个任务接口');
}
