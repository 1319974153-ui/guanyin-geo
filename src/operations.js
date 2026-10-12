import {createOpportunityBatch} from './opportunity-actions.js';
import {retestEvidence,retestSuggestions,linkedRetests,collectRetests} from './retests.js';
import {publicationAlertCandidates} from './publication-core.js';
import {canBrand,requireAdmin,policy,reject,digest} from './access.js';
import {makeReport,opportunityToken} from './analytics-core.js';
import {checkStale,factUsable} from './checks-core.js';
const stamp=()=>new Date().toISOString();
export const DEFAULT_ALERT_RULES={enabled:true,failures:true,conflicts:true,budget:true,citations:true,budgetPercent:80,citationDrop:20,minSamples:5,windowDays:7};
const states=['待处理','处理中','待复测','待复核','已复核'];
const label=(v,max=300)=>String(v||'').trim().slice(0,max);
function unpack(row){return {...JSON.parse(row.body),id:row.id,brandId:row.brand_id,revision:row.revision,created:row.created,updated:row.updated};}
async function records(env,owner){return (await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? ORDER BY created,id').bind(owner).all()).results;}
async function insert(env,owner,brandId,kind,id,data){const at=stamp();return env.DB.prepare('INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) VALUES(?,?,?,?,?,1,?,?)').bind(id,owner,brandId,kind,JSON.stringify(data),at,at).run();}
async function change(env,owner,row,data){const result=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),stamp(),owner,row.id,row.revision).run();if(!result.meta.changes)reject(409,'记录已被其他操作更新，请刷新后再试');}
export function alertCandidates(state,brandId,rules,failed,used,limit,clock=new Date()){
 if(!rules.enabled)return [];const output=[];
 if(rules.failures){const groups=new Map();for(const t of failed.filter(t=>t.brand_id===brandId)){if(!groups.has(t.plan_id))groups.set(t.plan_id,[]);groups.get(t.plan_id).push(t)}for(const [planId,items]of groups)output.push({key:'failure:'+planId,type:'failure',title:items.length+' 条任务执行异常',detail:'包含失败或结果不确定的任务，请核对回执后恢复。',evidence:{planId,items:items.map(t=>({id:t.id,status:t.status,error:t.error}))}});}
 if(rules.conflicts){const latest=new Map();for(const c of (state.analysisChecks||[]).filter(c=>c.brandId===brandId&&c.kind==='answer'))for(const t of c.input.targets)latest.set(t.id,c);for(const [answerId,c]of latest){if(c.parseError||checkStale(c,state,clock.toISOString()))continue;const result=c.results.find(r=>r.id===answerId),issues=result?.claims.filter(x=>x.relation==='疑似冲突')||[];if(issues.length)output.push({key:'conflict:'+answerId,type:'conflict',title:'回答存在疑似品牌事实冲突',detail:'模型已定位原句和对应品牌资料，需人工复核，不代表已证实错误。',evidence:{answerId,checkId:c.id,issues}});}}
 if(rules.budget&&used/limit*100>=rules.budgetPercent)output.push({key:'budget:'+clock.toISOString().slice(0,10),type:'budget',title:'今日模型调用接近配额',detail:'按 UTC 日累计，含失败和验证请求；不是金额账单。',evidence:{day:clock.toISOString().slice(0,10),used,limit,threshold:rules.budgetPercent}});
 if(rules.citations){const to=new Date(clock.getTime()-86400000).toISOString().slice(0,10);for(const surface of ['import','api']){
  const filtered={...state,answers:state.answers.filter(a=>a.citationKnown===true&&[a.region,a.language,a.model].every(v=>v&&!['未记录','未指定','unknown'].includes(v)))};
  const r=makeReport(filtered,brandId,{period:String(rules.windowDays),surface,to});const c=r.comparison;
  if(c.currentN>=rules.minSamples&&c.previousN>=rules.minSamples&&c.official.points!==null&&c.official.points<=-rules.citationDrop)output.push({key:'citation:'+surface,type:'citation',title:'同条件官网引用比例下降',detail:'只比较有完整上下文和已核对引用的匹配样本；不推断全平台结果。',evidence:{options:r.options,previousOptions:r.previousOptions,points:c.official.points,groups:c.official.groups,currentN:c.currentN,previousN:c.previousN,currentIds:r.answers.filter(a=>a.citationKnown===true).map(a=>a.id),previousIds:r.previousAnswers.filter(a=>a.citationKnown===true).map(a=>a.id),threshold:rules.citationDrop}});
 }}return output;
}
export async function evaluateAlerts(env,owner,state,brandIds=null){
 const all=await records(env,owner),failed=(await env.DB.prepare("SELECT id,brand_id,plan_id,status,error FROM task_items WHERE owner=? AND status IN ('failed','uncertain') ORDER BY id").bind(owner).all()).results;
 const limits=await policy(env,owner),used=(await env.DB.prepare("SELECT count(*) AS n FROM runs WHERE owner=? AND kind IN ('generate','sample','verify','title','expand','analyze') AND created>=?").bind(owner,stamp().slice(0,10)).first()).n;
 let opened=0,resolved=0;for(const brand of state.brands.filter(b=>!brandIds||brandIds.includes(b.id))){
  const ruleRow=all.find(r=>r.brand_id===brand.id&&r.kind==='rule'),rules={...DEFAULT_ALERT_RULES,...(ruleRow?JSON.parse(ruleRow.body):{})};
  const candidates=[...alertCandidates(state,brand.id,rules,failed,used,limits.dailyModelCalls),...publicationAlertCandidates(state,all,brand.id,rules)],keys=new Set(candidates.map(c=>c.key));
  for(const candidate of candidates){const id=await digest(owner+':alert:'+brand.id+':'+candidate.key),old=all.find(r=>r.id===id),fingerprint=await digest(JSON.stringify(candidate));
   if(!old){await insert(env,owner,brand.id,'alert',id,{...candidate,fingerprint,status:'待处理',firstSeen:stamp(),occurrences:1});opened++;}
   else{const prev=JSON.parse(old.body);if(prev.fingerprint!==fingerprint||prev.status==='已消退'){await change(env,owner,old,{...candidate,fingerprint,status:'待处理',firstSeen:prev.firstSeen,occurrences:prev.occurrences+(prev.status==='已消退'?1:0),acknowledgedAt:prev.acknowledgedAt||null});opened++;}}
  }
  for(const row of all.filter(r=>r.brand_id===brand.id&&r.kind==='alert')){const a=JSON.parse(row.body);if(a.status!=='已消退'&&!keys.has(a.key)){await change(env,owner,row,{...a,status:'已消退',resolvedAt:stamp(),resolution:rules.enabled?'本次检查未再触发；可能是条件变化、样本不足或资料失效，不等同问题已解决。':'此品牌告警规则已暂停。'});resolved++;}}
  const scanId=await digest(owner+':scan:'+brand.id),scan=all.find(r=>r.id===scanId),data={checkedAt:stamp(),triggered:candidates.length};if(scan)await change(env,owner,scan,data);else await insert(env,owner,brand.id,'scan',scanId,data);
 }return {opened,resolved,checkedAt:stamp()};
}
async function assignees(env,owner,brandId){const rows=(await env.DB.prepare("SELECT email,role,brands FROM members WHERE owner=? AND role!='viewer'").bind(owner).all()).results;return [{id:'owner',name:'工作区所有者'},...rows.filter(r=>r.role==='admin'||JSON.parse(r.brands).includes(brandId)).map(r=>({id:r.email,name:r.email,role:r.role}))];}
async function evidenceSnapshot(env,owner,state,brandId,ref,created,actionId){
 if(ref?.kind==='task')return retestEvidence(env,owner,state,brandId,ref,{id:actionId,created});
 if(!ref||!['answer','site','check','fact','report'].includes(ref.kind))reject(400,'请选择已有的回答、网站检查、自动质检、出处核对或报告');
 let r,at,title,text;
 if(ref.kind==='report'){const row=await env.DB.prepare('SELECT * FROM report_snapshots WHERE owner=? AND brand_id=? AND id=?').bind(owner,brandId,ref.id).first();if(row&&JSON.parse(row.body).format!=='guanyin-deleted-report-v1'){r=JSON.parse(row.body);if(!r.answers.some(a=>Date.parse(a.date)>=Date.parse(created)&&Date.parse(a.date)<=Date.now()+60000))reject(400,'报告没有待办创建之后的新样本，请先复测再归档');at=row.created;title=row.title;text=JSON.stringify({metrics:r.metrics,comparison:r.comparison,answerIds:r.answers.map(a=>a.id)});}}
 else{const key={answer:'answers',site:'siteChecks',check:'analysisChecks',fact:'facts'}[ref.kind];r=(state[key]||[]).find(r=>r.id===ref.id&&r.brandId===brandId);if(r){at=ref.kind==='answer'?r.date:ref.kind==='site'?r.at:ref.kind==='fact'?r.sourceReview?.checkedAt:r.created;title=r.title||r.platform||r.key||r.url||'自动检查';text=ref.kind==='answer'?r.text:ref.kind==='site'?JSON.stringify(r.result||{error:r.error}):ref.kind==='fact'?JSON.stringify({value:r.value,source:r.source,review:r.sourceReview}):JSON.stringify(r.results);if(ref.kind==='check'&&(r.parseError||!r.results.length||r.results.some(x=>x.problems.length)||checkStale(r,state)))reject(400,'自动检查不完整或已过期，请先重新检查');if(ref.kind==='fact'&&(!factUsable(r)||r.sourceReview?.status!=='matched'||r.sourceReview.quote!==r.value))reject(400,'此条事实还没有有效的出处核对回执');}}
 if(!r||!Number.isFinite(Date.parse(at)))reject(404,'找不到有记录时间的授权证据');
 if(Date.parse(at)<Date.parse(created)||Date.parse(at)>Date.now()+60000)reject(400,'复测证据必须产生于待办创建之后，且不能使用未来时间');
 return {kind:ref.kind,id:ref.id,at,title,text:String(text||'').slice(0,6000),sha256:await digest(JSON.stringify(r))};
}
export async function operationsApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname;if(!path.startsWith('/api/operations'))return null;
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 const rows=(await records(env,ctx.owner)).filter(r=>r.brand_id===brand.id),admin=['owner','admin'].includes(ctx.role);
 if(path==='/api/operations/opportunities'&&req.method==='POST')return h.json(await createOpportunityBatch(env,ctx,h,brand,w,b));
 if(path==='/api/operations'&&req.method==='GET'){
  const rule=rows.find(r=>r.kind==='rule');return h.json({retestPlans:await linkedRetests(env,ctx.owner,brand.id),actions:rows.filter(r=>r.kind==='action').map(r=>{const a=unpack(r);return {...a,suggestedQuestionIds:retestSuggestions(w.state,a)}}),alerts:rows.filter(r=>r.kind==='alert').map(unpack).filter(a=>admin||a.type!=='budget'),rules:{...DEFAULT_ALERT_RULES,...(rule?JSON.parse(rule.body):{})},ruleRevision:rule?.revision||0,scan:rows.find(r=>r.kind==='scan')?unpack(rows.find(r=>r.kind==='scan')):null,assignees:await assignees(env,ctx.owner,brand.id)});
 }
 if(path==='/api/operations/retests/collect'&&req.method==='POST'){if(!['owner','admin','editor','reviewer'].includes(ctx.role))reject(403,'当前角色不能关联复测结果');if(b.id&&!rows.some(r=>r.kind==='action'&&r.id===b.id))reject(404,'找不到当前品牌的待办');return h.json(await collectRetests(env,{...ctx,brands:[brand.id]},w.state,b.id||null));}
 if(path==='/api/operations/evaluate'&&req.method==='POST'){return h.json(await evaluateAlerts(env,ctx.owner,w.state,[brand.id]));}
 if(path==='/api/operations/rules'&&req.method==='POST'){
  requireAdmin(ctx);const config={};for(const k of ['enabled','failures','conflicts','budget','citations']){if(typeof b[k]!=='boolean')reject(400,'规则开关格式不正确');config[k]=b[k]}
  for(const[k,min,max]of [['budgetPercent',10,100],['citationDrop',1,100],['minSamples',2,1000]]){if(!Number.isInteger(b[k])||b[k]<min||b[k]>max)reject(400,'规则阈值超出范围');config[k]=b[k]}
  if(![7,30,90].includes(b.windowDays))reject(400,'告警窗口支持 7、30、90 天');config.windowDays=b.windowDays;
  const old=rows.find(r=>r.kind==='rule');if((old?.revision||0)!==b.revision)reject(409,'规则已更新，请刷新');if(old)await change(env,ctx.owner,old,config);else{const r=await insert(env,ctx.owner,brand.id,'rule',await digest(ctx.owner+':rules:'+brand.id),config);if(!r.meta.changes)reject(409,'规则已创建，请刷新');}return h.json({saved:true});
 }
 if(path==='/api/operations/acknowledge'&&req.method==='POST'){
  const row=rows.find(r=>r.kind==='alert'&&r.id===b.id);if(!row)reject(404,'告警不存在');const old=JSON.parse(row.body);if(old.type==='budget'&&!admin)reject(403,'仅管理员可处理工作区预算告警');if(row.revision!==b.revision)reject(409,'告警已更新，请刷新');if(old.status==='已消退')reject(409,'此告警已消退');await change(env,ctx.owner,row,{...old,status:'已知悉',acknowledgedAt:stamp(),acknowledgedBy:ctx.actor});return h.json({saved:true});
 }
 if(path==='/api/operations/actions'&&req.method==='POST'){
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||''))reject(400,'待办标识不正确');
  const old=rows.find(r=>r.kind==='action'&&r.id===b.id);if(old){if(!b.revision)return h.json({action:unpack(old),existing:true});if(old.revision!==b.revision)reject(409,'待办已被其他成员更新，请刷新');}
  else if(b.revision)reject(404,'待办已不存在');
  if(!old&&ctx.role==='reviewer')reject(403,'审核人可复核已有待办，创建由编辑或管理员负责');
  const before=old?JSON.parse(old.body):null,title=label(b.title,160),description=label(b.description,3000),status=b.status||'待处理',note=label(b.note,1500),assigned=await assignees(env,ctx.owner,brand.id);
  if(!title||!states.includes(status))reject(400,'请填写待办标题和有效状态');
  const assignee=b.assignee===undefined?'owner':String(b.assignee);if(!assigned.some(x=>x.id===assignee))reject(400,'负责人需要拥有当前品牌的工作权限');
  if(b.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||!Number.isFinite(Date.parse(b.dueDate))||new Date(b.dueDate).toISOString().slice(0,10)!==b.dueDate))reject(400,'截止日期不正确');
  if(status==='已复核'&&!['owner','admin','reviewer'].includes(ctx.role))reject(403,'完成复核需要审核人或管理员');
  if(ctx.role==='reviewer'&&(title!==before.title||description!==before.description||assignee!==before.assignee||String(b.dueDate||'')!==before.dueDate||!['待复核','已复核'].includes(status)))reject(403,'审核人仅可复核既有待办及登记复测结果');
  if(before?.status==='已复核'&&status!=='已复核'&&!admin)reject(403,'重新打开已复核待办需要管理员');
  let origin=before?.origin||{kind:'manual'};
  if(!old&&b.diagnosis){const r=makeReport(w.state,brand.id,b.options||{}),d=r.diagnosis.find(d=>d.type===b.diagnosis);if(!d)reject(409,'此诊断已不再触发，请刷新');origin={kind:'diagnosis',diagnosis:d,options:r.options,at:r.created};}
  if(!old&&b.opportunity){if(b.diagnosis||b.alertId)reject(400,'只能选择一个待办来源');const r=makeReport(w.state,brand.id,b.options||{}),item=r.opportunities.items.find(x=>x.questionId===b.opportunity.questionId&&x.type===b.opportunity.type);if(!item||b.opportunity.token!==await digest(opportunityToken(item)))reject(409,'处理机会或依据已变化，请刷新清单后重新创建');origin={kind:'opportunity',opportunity:item,options:r.options,at:r.created};}
  if(!old&&b.alertId){const a=rows.find(r=>r.kind==='alert'&&r.id===b.alertId);if(!a)reject(404,'告警不存在');if(JSON.parse(a.body).type==='budget'&&!admin)reject(403,'预算告警由管理员处理');origin={kind:'alert',id:a.id,...JSON.parse(a.body)};}
  let evidence=before?.evidence||[];if(b.evidence!==undefined){if(!Array.isArray(b.evidence)||b.evidence.length>5)reject(400,'最多关联 5 条复测证据');evidence=await Promise.all(b.evidence.map(ref=>evidenceSnapshot(env,ctx.owner,w.state,brand.id,ref,old?.created||stamp(),old?.id)));}
  if(['待复核','已复核'].includes(status)&&b.evidence===undefined&&evidence.length)evidence=await Promise.all(evidence.map(ref=>evidenceSnapshot(env,ctx.owner,w.state,brand.id,ref,old.created,old.id)));
  if(['待复核','已复核'].includes(status)&&(!old||!evidence.length||note.length<10))reject(400,'请先保存待办，再关联后续复测证据并填写至少 10 字的结论');
  if((before?.history||[]).length>=100)reject(400,'已达到 100 条变更记录，请归档此事项并新建后续待办');
  const data={title,description,assignee,dueDate:String(b.dueDate||''),status,note,origin,evidence,lastRetest:before?.lastRetest||null,history:[...(before?.history||[]),{at:stamp(),actor:ctx.actor,from:before?.status||'',to:status,note,assignee,evidence:evidence.map(e=>({kind:e.kind,id:e.id,sha256:e.sha256}))}]};
  if(old)await change(env,ctx.owner,old,data);else {if(rows.filter(r=>r.kind==='action').length>=1000)reject(429,'当前品牌待办已达 1000 条');const saved=await insert(env,ctx.owner,brand.id,'action',b.id,data);if(!saved.meta.changes)reject(409,'待办标识已使用，请刷新');}
  return h.json({saved:true,id:b.id});
 }
 reject(405,'不支持此执行管理操作');
}
