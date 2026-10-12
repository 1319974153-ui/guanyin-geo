import {canBrand,reject,digest} from './access.js';
const now=()=>new Date().toISOString();
export async function retestRequestHash(b){return digest(JSON.stringify({brandId:b.brandId,actionId:b.actionId,kind:b.kind,name:b.name,questionIds:b.questionIds,providers:b.providers,repeats:b.repeats,intervalMinutes:b.intervalMinutes,firstAt:b.firstAt||'',region:b.region||'未指定',language:b.language||'zh-CN'}));}
export async function prepareRetest(env,ctx,b){
 if(!b.actionId)return null;if(typeof b.actionId!=='string'||!Number.isInteger(b.actionRevision)||b.actionRevision<1)reject(400,'待办标识或版本格式不正确');if(b.kind!=='sample'||b.intervalMinutes!==0)reject(400,'待办复测目前支持单次模型 API 采样');
 const row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND id=? AND kind='action'").bind(ctx.owner,b.brandId,b.actionId).first();if(!row||!canBrand(ctx,b.brandId))reject(404,'找不到授权的改进待办');
 if(row.revision!==b.actionRevision)reject(409,'待办已更新，请刷新后创建复测');const a=JSON.parse(row.body);if(a.status==='已复核')reject(409,'请先重新打开已复核事项，再创建后续复测');if((a.history||[]).length>=99)reject(400,'待办历史接近上限，请新建后续事项');
 const pending=await env.DB.prepare("SELECT id FROM task_plans WHERE owner=? AND brand_id=? AND json_extract(spec,'$.origin.actionId')=? AND status NOT IN ('complete','canceled') LIMIT 1").bind(ctx.owner,b.brandId,b.actionId).first();if(pending)reject(409,'此待办已有未结束的复测，请处理原任务或取消后再创建');
 return {row,action:a,requestHash:await retestRequestHash(b)};
}
export function retestActionStatement(env,ctx,b,prepared){
 const {row,action:a}=prepared,at=now(),data={...a,status:'待复测',lastRetest:{planId:b.id,created:at,questionIds:b.questionIds,providers:b.providers,repeats:b.repeats},history:[...(a.history||[]),{at,actor:ctx.actor,from:a.status,to:'待复测',note:'已创建单次模型 API 复测任务，结果返回后自动关联，仍需人工复核。',assignee:a.assignee,evidence:[],planId:b.id}]};
 return env.DB.prepare("UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM task_plans WHERE owner=? AND id=? AND json_extract(spec,'$.origin.actionId')=? AND json_extract(spec,'$.origin.actionRevision')=?)").bind(JSON.stringify(data),at,ctx.owner,row.id,row.revision,ctx.owner,b.id,row.id,row.revision);
}
export function retestSuggestions(state,action){
 const o=action.origin||{},d=o.diagnosis||{},ids=new Set([...(d.questionIds||[]),...(o.kind==='opportunity'&&o.opportunity?.questionId?[o.opportunity.questionId]:[])]),answerIds=new Set(d.answerIds||[]),e=o.evidence||{};
 for(const id of [e.answerId,...(e.currentIds||[]),...(e.previousIds||[])].filter(Boolean))answerIds.add(id);
 for(const a of state.answers||[])if(a.brandId===action.brandId&&answerIds.has(a.id))ids.add(a.promptId);
 const productId=o.kind==='opportunity'?(o.opportunity.productId||'@brand'):(o.options?.productId||'');
 return (state.questions||[]).filter(q=>q.brandId===action.brandId&&ids.has(q.id)&&(!productId||(q.productId||'@brand')===productId)).map(q=>q.id);
}
export async function retestEvidence(env,owner,state,brandId,ref,action){
 const plan=await env.DB.prepare('SELECT * FROM task_plans WHERE owner=? AND brand_id=? AND id=?').bind(owner,brandId,ref.id).first();if(!plan)reject(404,'找不到此复测任务');const spec=JSON.parse(plan.spec);
 if(plan.kind!=='sample'||spec.origin?.actionId!==action.id||Date.parse(plan.created)<Date.parse(action.created))reject(400,'复测任务必须在此待办创建后由当前事项发起');
 if(plan.status!=='complete')reject(400,'复测任务尚未全部结束，请先处理未完成请求');
 const items=(await env.DB.prepare('SELECT id,status,updated FROM task_items WHERE owner=? AND plan_id=? ORDER BY id').bind(owner,plan.id).all()).results;
 const expected=spec.questions.length*spec.providers.length*spec.repeats;
 if(items.length!==expected||items.some(i=>i.status!=='complete'))reject(400,'复测包含缺失或未成功的请求，不能标为完整返回');
 for(const q of spec.questions){const current=state.questions.find(x=>x.id===q.id&&x.brandId===brandId);if(!current||(current.version||'v1')!==q.version||current.text!==q.text||(current.productId||'')!==(q.productId||''))reject(409,'复测的问题版本或产品归属已变化，请核对后重新复测');}
 const answers=items.map(i=>state.answers.find(a=>a.id===i.id&&a.brandId===brandId&&a.taskId===plan.id&&a.surface==='api'&&a.status==='ok'));
 if(answers.some(a=>!a||!a.text||!Number.isFinite(Date.parse(a.date))||Date.parse(a.date)<Date.parse(action.created)||Date.parse(a.date)>Date.now()+60000))reject(400,'复测回答缺失或时间不正确，请核对结果');
 const at=items.map(i=>i.updated).sort().at(-1),summary={planId:plan.id,name:plan.name,entry:'api',answerCount:answers.length,questions:spec.questions,providers:spec.providers,answerIds:answers.map(a=>a.id),method:'模型 API 复测结果；推荐与引用标签仍需核对，不代表消费端效果或问题已经改善。'};
 return {kind:'task',id:plan.id,at,title:plan.name,text:JSON.stringify(summary).slice(0,6000),sha256:await digest(JSON.stringify({plan:{id:plan.id,spec},items,answers})),answerCount:answers.length,answerIds:answers.map(a=>a.id)};
}
export async function collectRetests(env,ctx,state,onlyActionId=null){
 const rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND kind='action' AND json_extract(body,'$.status')='待复测' AND json_extract(body,'$.lastRetest.planId') IS NOT NULL ORDER BY updated,id").bind(ctx.owner).all()).results.filter(r=>canBrand(ctx,r.brand_id)&&(!onlyActionId||r.id===onlyActionId));let attached=0;const pending=[];
 for(const row of rows.slice(0,200)){
  const a=JSON.parse(row.body),id=a.lastRetest.planId;let evidence;
  try{evidence=await retestEvidence(env,ctx.owner,state,row.brand_id,{id},{id:row.id,created:row.created});}catch(e){pending.push({id:row.id,planId:id,reason:e.status?e.message:'复测回执暂不可用'});continue;}
  if((a.evidence||[]).length>=5&&!(a.evidence||[]).some(e=>e.kind==='task'&&e.id===id)){pending.push({id:row.id,planId:id,reason:'已有 5 条证据，请先移除不再需要的关联'});continue;}
  if((a.history||[]).length>=100){pending.push({id:row.id,planId:id,reason:'待办历史达到上限，请登记后续事项'});continue;}
  const at=now(),note='复测任务已完整返回，结果自动关联；请审核实际回答，尚未确认指标改善。',refs=[...(a.evidence||[]).filter(e=>!(e.kind==='task'&&e.id===id)),evidence];
  const data={...a,status:'待复核',note,evidence:refs,lastRetest:{...a.lastRetest,collectedAt:at},history:[...(a.history||[]),{at,actor:'system:retest-results',from:a.status,to:'待复核',note,assignee:a.assignee,evidence:[{kind:'task',id,sha256:evidence.sha256}]}]};
  const r=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),at,ctx.owner,row.id,row.revision).run();attached+=r.meta.changes;
 }return {attached,pending};
}
export async function linkedRetests(env,owner,brandId){const rows=(await env.DB.prepare("SELECT id,name,spec,status,created,updated FROM task_plans WHERE owner=? AND brand_id=? AND json_extract(spec,'$.origin.kind')='action' ORDER BY created,id").bind(owner,brandId).all()).results;return rows.map(r=>({...r,spec:undefined,actionId:JSON.parse(r.spec).origin.actionId}));}
