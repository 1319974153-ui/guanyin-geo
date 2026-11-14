import {contentDisclosureConflict} from './knowledge-core.js';
import {legacyCredibilityContract,normalizeRankingReview} from './credibility-evidence.js';
import {answerReviewHash,answerReviewLabels} from './answer-review-audit.js';
import {createOpportunityBatch} from './opportunity-actions.js';
import {retestEvidence,retestSuggestions,linkedRetests,collectRetests,consumerRetestChoices} from './retests.js';
import {publicationAlertCandidates,isPlatformReceiptUrl} from './publication-core.js';
import {canBrand,requireAdmin,policy,reject,digest} from './access.js';
import {makeReport,opportunityToken,decisionActionToken,decisionActionTemplate,decisionReviewPlan,decisionReviewStatus,diagnosticEvidenceContract,diagnosticEvidenceReadiness,canonicalUrl} from './analytics-core.js';
import {credibilityActionTemplate,credibilityToken} from './credibility-plan.js';
import {checkStale,factUsable} from './checks-core.js';
const stamp=()=>new Date().toISOString();
export const DEFAULT_ALERT_RULES={enabled:true,failures:true,conflicts:true,budget:true,citations:true,budgetPercent:80,citationDrop:20,minSamples:5,windowDays:7};
const states=['待处理','处理中','待复测','待复核','已复核','停止跟进'];
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
function approvedContent(state,brandId,id){
 const c=(state.contents||[]).find(c=>c.id===id&&c.brandId===brandId);
 if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim()||!Number.isFinite(Date.parse(c.reviewedAt)))reject(400,'需要有审核时间、完整标题和正文的正式已审核稿件');
 if(contentDisclosureConflict(state,c))reject(400,'稿件涉及内部资料，不能作为对外材料完成此待办');
 const ids=[...new Set(c.factIds||[])];if(!ids.length)reject(400,'已审核稿件还没有关联事实依据，请先补充出处并重新审核');
 for(const id of ids){const f=(state.facts||[]).find(f=>f.brandId===brandId&&f.id===id),snapshot=(c.factSnapshots||[]).find(s=>s.id===id);if(!f||f.demo||!factUsable(f)||(f.productId&&f.productId!==c.productId)||snapshot&&(snapshot.value!==f.value||snapshot.source!==f.source||(snapshot.productId||'')!==(f.productId||'')))reject(400,'稿件关联事实已变化、失效或不属于当前产品，请核对后重新审核');}
 return c;
}
async function labelReviewEvidence(env,owner,state,brandId,ref,actionId){
 if(!actionId||ref.id!==actionId)reject(400,'标签核对回执只能关联原标签待办');
 const row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND id=? AND kind='action'").bind(owner,brandId,actionId).first(),contract=row?JSON.parse(row.body).origin?.evidenceContract:null;
 if(contract?.kind!=='labels'||!contract.answerTargets?.length||contract.answerTargets.length!==contract.requiredAnswerIds?.length)reject(400,'此待办没有固定的原回答核对范围');
 const reviews=[];
 for(const target of contract.answerTargets){
  const answer=state.answers.find(a=>a.id===target.id&&a.brandId===brandId),audit=(state.answerReviewAudits||[]).filter(r=>r.answerId===target.id&&r.brandId===brandId).sort((a,b)=>a.revision-b.revision).at(-1);
  if(!answer||answer.demo||!audit||await answerReviewHash(answer)!==target.answerHash||audit.answerHash!==target.answerHash||audit.revision!==answer.reviewRevision||answer.reviewAnswerHash!==target.answerHash)reject(400,'原回答或最新核对记录已变化，请重新核对；不能以其他回答替代原诊断样本');
  const labels=answerReviewLabels(answer);if(labels.recommendation==='unknown'||!labels.citationKnown||JSON.stringify(labels)!==JSON.stringify(audit.after))reject(400,'原回答的推荐或引用仍未核对，不能完成此项');
  if(!Number.isFinite(Date.parse(audit.at))||Date.parse(audit.at)<Date.parse(row.created)||Date.parse(audit.at)>Date.now()+60000)reject(400,'标签核对必须发生在此待办创建之后，旧回执不能代替');
  reviews.push({id:audit.id,answerId:answer.id,answerHash:audit.answerHash,revision:audit.revision,at:audit.at,actor:audit.actor,before:audit.before,after:audit.after,sample:audit.sample});
 }
 reviews.sort((a,b)=>a.answerId.localeCompare(b.answerId));const sha256=await digest(JSON.stringify(reviews));
 if(ref.sha256&&ref.sha256!==sha256)reject(409,'标签核对回执已更新，请重新打开此待办后保存');
 return {kind:'answer_review_group',id:actionId,brandId,at:reviews.map(r=>r.at).sort().at(-1),title:`${reviews.length} 条原回答的标签核对记录`,answerIds:reviews.map(r=>r.answerId),reviews,text:JSON.stringify(reviews).slice(0,6000),sha256};
}
async function evidenceSnapshot(env,owner,state,brandId,ref,created,actionId,publicationChecks){
 if(ref?.kind==='answer_review_group')return labelReviewEvidence(env,owner,state,brandId,ref,actionId);
 if(ref?.kind==='task')return retestEvidence(env,owner,state,brandId,ref,{id:actionId,created});
 if(ref?.kind==='fact_group'){
  if(!actionId||ref.id!==actionId)reject(400,'批量出处回执只能关联创建它的原资料待办');
  const row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND id=? AND kind='action'").bind(owner,brandId,actionId).first(),contract=row?JSON.parse(row.body).origin?.evidenceContract:null;
  if(contract?.kind!=='facts'||!contract.requiredFactIds?.length)reject(400,'此待办没有可批量核对的原资料');
  const refs=await Promise.all(contract.requiredFactIds.map(id=>evidenceSnapshot(env,owner,state,brandId,{kind:'fact',id},row.created,actionId)));
  return {kind:'fact_group',id:actionId,at:refs.map(r=>r.at).sort().at(-1),title:`${refs.length} 条原资料的出处核对回执`,factIds:refs.map(r=>r.id),text:JSON.stringify(refs.map(({id,title,at,sha256})=>({id,title,at,sha256}))),sha256:await digest(JSON.stringify(refs))};
 }
 if(!ref||!['answer','site','check','fact','report','content','publication'].includes(ref.kind))reject(400,'请选择已有的回答、网站检查、自动质检、出处核对、已审核稿件、公开发布回执或报告');
 let r,at,title,text;
 if(ref.kind==='content'){r=approvedContent(state,brandId,ref.id);at=r.reviewedAt;title=r.title;text=JSON.stringify({title:r.title,text:r.text,questionId:r.questionId,questionVersion:r.questionVersion,factIds:r.factIds});}
 else if(ref.kind==='publication'){
  const p=(state.publications||[]).find(p=>p.id===ref.id&&p.brandId===brandId);if(!p||p.demo)reject(404,'找不到当前品牌的正式发布记录');
  if(!(p.publicationStage==='published'||!p.publicationStage&&['已发布','published'].includes(p.status))||!canonicalUrl(p.url)||isPlatformReceiptUrl(p.url))reject(400,'此记录尚不是带公开链接的已发布文章，不能完成发布类待办');
  const content=approvedContent(state,brandId,p.contentId),checkRow=publicationChecks?publicationChecks.find(row=>row.publication_id===p.id):await env.DB.prepare('SELECT * FROM publication_checks WHERE owner=? AND brand_id=? AND publication_id=? ORDER BY created DESC,id DESC LIMIT 1').bind(owner,brandId,p.id).first();
  const check=checkRow?JSON.parse(checkRow.body):null,normal=v=>String(v||'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase(),excerpt=normal(check?.page?.excerpt),body=normal(content.text).slice(0,120);
  if(!check||check.obsolete||canonicalUrl(check.url)!==canonicalUrl(p.url)||check.page?.status!=='response_ok'||check.page?.contentMatch!=='标题与页面文字匹配'||check.page.bodyChars<80||body.length<20||!excerpt.includes(body)||p.title!==content.title||p.handoffSnapshot&&(p.handoffSnapshot.title!==content.title||p.handoffSnapshot.text!==content.text))reject(400,'缺少与当前审核稿标题及正文片段一致的公开页核验回执，请先检查这篇公开文章；普通网页检查不能代替');
  r={publication:p,content,check};at=check.created;title=p.title;text=JSON.stringify({publicationId:p.id,contentId:content.id,url:p.url,checkId:check.id,page:check.page,scope:'标题及正文片段已核对，不证明全文逐字一致、搜索收录或 AI 引用。'});
 }
 else if(ref.kind==='report'){const row=await env.DB.prepare('SELECT * FROM report_snapshots WHERE owner=? AND brand_id=? AND id=?').bind(owner,brandId,ref.id).first();if(row&&JSON.parse(row.body).format!=='guanyin-deleted-report-v1'){r=JSON.parse(row.body);if(!r.answers.some(a=>Date.parse(a.date)>=Date.parse(created)&&Date.parse(a.date)<=Date.now()+60000))reject(400,'报告没有待办创建之后的新样本，请先复测再归档');at=row.created;title=row.title;text=JSON.stringify({metrics:r.metrics,comparison:r.comparison,answerIds:r.answers.map(a=>a.id)});}}
 else{const key={answer:'answers',site:'siteChecks',check:'analysisChecks',fact:'facts'}[ref.kind];r=(state[key]||[]).find(r=>r.id===ref.id&&r.brandId===brandId);if(r){at=ref.kind==='answer'?r.date:ref.kind==='site'?r.at:ref.kind==='fact'?r.sourceReview?.checkedAt:r.created;title=r.title||r.platform||r.key||r.url||'自动检查';text=ref.kind==='answer'?r.text:ref.kind==='site'?JSON.stringify(r.result||{error:r.error}):ref.kind==='fact'?JSON.stringify({value:r.value,source:r.source,review:r.sourceReview}):JSON.stringify(r.results);if(ref.kind==='check'&&(r.parseError||!r.results.length||r.results.some(x=>x.problems.length)||checkStale(r,state)))reject(400,'自动检查不完整或已过期，请先重新检查');if(ref.kind==='fact'&&(!factUsable(r)||r.sourceReview?.status!=='matched'||r.sourceReview.quote!==r.value))reject(400,'此条事实还没有有效的出处核对回执');}}
 if(!r||!Number.isFinite(Date.parse(at)))reject(404,'找不到有记录时间的授权证据');
 if(Date.parse(at)<Date.parse(created)||Date.parse(at)>Date.now()+60000)reject(400,'复测证据必须产生于待办创建之后，且不能使用未来时间');
 return {kind:ref.kind,id:ref.id,at,title,text:String(text||'').slice(0,6000),sha256:await digest(JSON.stringify(r)),...(ref.kind==='report'?{answerIds:r.answers.map(a=>a.id)}:{})};
}
async function typedEvidenceCandidates(env,owner,state,brandId,actions){
 const kinds=new Set(actions.map(a=>a.origin?.evidenceContract?.kind)),refs=[];
 if(kinds.has('facts')||kinds.has('external')||kinds.has('ranking'))for(const f of state.facts||[])if(f.brandId===brandId&&!f.demo&&f.sourceReview?.checkedAt)refs.push({kind:'fact',id:f.id});
 if(kinds.has('content')||kinds.has('submission_preparation'))for(const c of state.contents||[])if(c.brandId===brandId&&!c.demo&&c.status==='已审核')refs.push({kind:'content',id:c.id});
 for(const action of actions)if(action.origin?.evidenceContract?.kind==='labels')refs.push({kind:'answer_review_group',id:action.id});
 for(const action of actions)if(action.origin?.evidenceContract?.kind==='facts'&&action.origin.evidenceContract.requiredFactIds?.length>1)refs.push({kind:'fact_group',id:action.id});
 let checks=[];if(kinds.has('publication')){checks=(await env.DB.prepare('SELECT * FROM publication_checks WHERE owner=? AND brand_id=? ORDER BY created DESC,id DESC').bind(owner,brandId).all()).results;for(const p of state.publications||[])if(p.brandId===brandId&&!p.demo)refs.push({kind:'publication',id:p.id});}
 return (await Promise.all(refs.map(async ref=>{try{return await evidenceSnapshot(env,owner,state,brandId,ref,'1970-01-01T00:00:00Z',['fact_group','answer_review_group'].includes(ref.kind)?ref.id:null,checks)}catch{return null}}))).filter(Boolean);
}
export async function operationsApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname;if(!path.startsWith('/api/operations'))return null;
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 const rows=(await records(env,ctx.owner)).filter(r=>r.brand_id===brand.id),admin=['owner','admin'].includes(ctx.role);
 if(path==='/api/operations/opportunities'&&req.method==='POST')return h.json(await createOpportunityBatch(env,ctx,h,brand,w,b));
 if(path==='/api/operations'&&req.method==='GET'){
  const rule=rows.find(r=>r.kind==='rule'),actions=rows.filter(r=>r.kind==='action').map(unpack),candidates=await typedEvidenceCandidates(env,ctx.owner,w.state,brand.id,actions);return h.json({retestPlans:await linkedRetests(env,ctx.owner,brand.id),evidenceOptions:candidates.map(({kind,id,title,at})=>({kind,id,title,at})),actions:actions.map(a=>({...a,consumerRetestChoices:consumerRetestChoices(w.state,a),suggestedQuestionIds:retestSuggestions(w.state,a),reviewReadiness:decisionReviewStatus(w.state,a),evidenceReadiness:diagnosticEvidenceReadiness(w.state,a,candidates)})),alerts:rows.filter(r=>r.kind==='alert').map(unpack).filter(a=>admin||a.type!=='budget'),rules:{...DEFAULT_ALERT_RULES,...(rule?JSON.parse(rule.body):{})},ruleRevision:rule?.revision||0,scan:rows.find(r=>r.kind==='scan')?unpack(rows.find(r=>r.kind==='scan')):null,assignees:await assignees(env,ctx.owner,brand.id)});
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
  let decisionOrigin=null,credibilityOrigin=null,credibilityTemplate=null;
  if(b.decision){
   if(!['owner','admin','editor'].includes(ctx.role))reject(403,'创建改进待办需要编辑或管理员权限');
   if(b.revision||b.diagnosis||b.opportunity||b.alertId||b.credibility)reject(400,'只能选择一个待办来源');
   const report=makeReport(w.state,brand.id,b.options||{}),step=report.decision?.steps?.find(item=>item.id===b.decision.id);
   const token=step?await digest(decisionActionToken(report,step)):'';
   if(!step||b.decision.token!==token)reject(409,'报告步骤或依据已变化，请刷新报告后重新加入待办');
   b.id=await digest(ctx.owner+':decision-action:'+brand.id+':'+token);
   const template=decisionActionTemplate(report,step);b.title=template.title;b.description=template.description;b.status='待处理';b.assignee='owner';b.dueDate='';b.note='';delete b.evidence;
   const questionIds=[...new Set([...(report.answers||[]).map(a=>a.promptId).filter(Boolean),...w.state.questions.filter(q=>q.brandId===brand.id&&q.text?.trim()===report.decision.goalQuery&&(!report.options.productId||(q.productId||'@brand')===report.options.productId)).map(q=>q.id)])];
   decisionOrigin={kind:'decision',step,goalQuery:report.decision.goalQuery,conclusion:report.decision.conclusion,status:report.decision.status,options:report.options,at:report.created,token,questionIds,evidence:{...report.decision.evidence,currentIds:report.answers.map(a=>a.id)},method:report.decision.method,reviewPlan:decisionReviewPlan(report,step),evidenceContract:diagnosticEvidenceContract(report,{kind:'decision',id:step.id},w.state)};
  }
  if(b.credibility&&!b.revision){
   if(b.diagnosis||b.opportunity||b.alertId||b.decision)reject(400,'只能选择一个待办来源');
   const r=makeReport(w.state,brand.id,b.options||{}),item=r.credibilityPlan?.items?.find(x=>x.id===b.credibility.id);
   if(!item||b.credibility.token!==await digest(credibilityToken(item,r)))reject(409,'可信背书报告范围、建议或依据已变化，请刷新报告后重新创建');
   const matched=rows.find(row=>row.kind==='action'&&(()=>{const origin=JSON.parse(row.body).origin;return origin?.kind==='credibility'&&origin.token===b.credibility.token})());
   b.id=matched?.id||await digest(ctx.owner+':credibility-action:'+brand.id+':'+b.credibility.token);
   credibilityTemplate=credibilityActionTemplate(item);credibilityOrigin={kind:'credibility',credibility:item,options:r.options,at:r.created,token:b.credibility.token,evidenceContract:diagnosticEvidenceContract(r,{kind:'credibility',id:item.id},w.state)};
  }
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||''))reject(400,'待办标识不正确');
  const old=rows.find(r=>r.kind==='action'&&r.id===b.id);let requestHash=null;
  if(b.requestId!==undefined){if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId))reject(400,'保存请求标识不正确');requestHash=await digest(JSON.stringify(Object.fromEntries(['id','brandId','revision','title','description','assignee','dueDate','status','note','evidence','useLabelReviews','labelReviewHash',...(b.materialDetails!==undefined?['materialDetails']:[])].map(k=>[k,b[k]??null]))));const previous=old&&JSON.parse(old.body).history?.find(h=>h.requestId===b.requestId);if(previous){if(previous.requestHash!==requestHash||previous.actor!==ctx.actor)reject(409,'同一保存请求不能更换内容或执行者');return h.json({saved:true,id:b.id,existing:true});}}
  if(old){if(!b.revision)return h.json({action:unpack(old),existing:true});if(old.revision!==b.revision)reject(409,'待办已被其他成员更新，请刷新');}
  else if(b.revision)reject(404,'待办已不存在');
  if(!old&&ctx.role==='reviewer')reject(403,'审核人可复核已有待办，创建由编辑或管理员负责');
  const before=old?JSON.parse(old.body):null;if(before&&legacyCredibilityContract(before))reject(409,'此历史排名/提交事项仅保留原记录，请从当前报告另建材料核对或准备事项');let title=label(b.title,160),description=label(b.description,3000);const status=b.status||'待处理',note=label(b.note,1500),assigned=await assignees(env,ctx.owner,brand.id);
  const assignee=b.assignee===undefined?'owner':String(b.assignee);if(!assigned.some(x=>x.id===assignee))reject(400,'负责人需要拥有当前品牌的工作权限');
  if(b.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||!Number.isFinite(Date.parse(b.dueDate))||new Date(b.dueDate).toISOString().slice(0,10)!==b.dueDate))reject(400,'截止日期不正确');
  if(status==='已复核'&&!['owner','admin','reviewer'].includes(ctx.role))reject(403,'完成复核需要审核人或管理员');
  if(ctx.role==='reviewer'&&(title!==before.title||description!==before.description||assignee!==before.assignee||String(b.dueDate||'')!==before.dueDate||!['待复核','已复核'].includes(status)))reject(403,'审核人仅可复核既有待办及登记复测结果');
  if(before?.status==='停止跟进'&&status!=='停止跟进'&&!admin)reject(403,'恢复停止跟进事项需要管理员');
  if(status==='停止跟进'){if(!old)reject(400,'请先保存待办再决定停止跟进');if(!['owner','admin','editor'].includes(ctx.role))reject(403,'停止跟进需要编辑或管理员权限');if(note.length<10)reject(400,'请说明停止跟进的原因（至少 10 字），此状态不代表完成');const pending=await env.DB.prepare("SELECT id FROM task_plans WHERE owner=? AND brand_id=? AND json_extract(spec,'$.origin.actionId')=? AND status NOT IN ('complete','canceled') LIMIT 1").bind(ctx.owner,brand.id,b.id).first();if(pending)reject(409,'此事项仍有关联任务，请先在任务中心暂停并取消原任务后停止跟进');}
  if(before?.status==='已复核'&&status!=='已复核'&&!admin)reject(403,'重新打开已复核待办需要管理员');
  let origin=before?.origin||decisionOrigin||{kind:'manual'};
  if(before&&(origin.kind==='diagnosis'&&origin.diagnosis?.type==='labels'||origin.kind==='decision'&&origin.step?.id==='labels')&&origin.evidenceContract?.kind!=='labels'&&['待复核','已复核'].includes(status))reject(409,'此历史标签待办未固定原回答版本，不能用其他材料完成复核；请从当前诊断新建，或说明原因后停止跟进');
  if(!old&&b.diagnosis){if(b.opportunity||b.alertId||b.credibility)reject(400,'只能选择一个待办来源');const r=makeReport(w.state,brand.id,b.options||{}),d=r.diagnosis.find(d=>d.type===b.diagnosis);if(!d)reject(409,'此诊断已不再触发，请刷新');origin={kind:'diagnosis',diagnosis:d,options:r.options,at:r.created,evidenceContract:diagnosticEvidenceContract(r,{kind:'diagnosis',id:d.type},w.state)};}
  if(!old&&b.opportunity){if(b.diagnosis||b.alertId||b.credibility)reject(400,'只能选择一个待办来源');const r=makeReport(w.state,brand.id,b.options||{}),item=r.opportunities.items.find(x=>x.questionId===b.opportunity.questionId&&x.type===b.opportunity.type);if(!item||b.opportunity.token!==await digest(opportunityToken(item)))reject(409,'处理机会或依据已变化，请刷新清单后重新创建');origin={kind:'opportunity',opportunity:item,options:r.options,at:r.created};}
  if(!old&&credibilityOrigin){title=credibilityTemplate.title;description=credibilityTemplate.description;origin=credibilityOrigin;}
  if(!old&&b.alertId){if(b.diagnosis||b.opportunity||b.credibility)reject(400,'只能选择一个待办来源');const a=rows.find(r=>r.kind==='alert'&&r.id===b.alertId);if(!a)reject(404,'告警不存在');if(JSON.parse(a.body).type==='budget'&&!admin)reject(403,'预算告警由管理员处理');origin={kind:'alert',id:a.id,...JSON.parse(a.body)};}
  if(!old&&origin.evidenceContract?.kind==='labels'){const c=origin.evidenceContract;c.answerTargets=await Promise.all(c.requiredAnswerIds.map(async id=>{const a=w.state.answers.find(a=>a.id===id&&a.brandId===brand.id);if(!a)reject(409,'原回答已变化，请刷新诊断');return {id,answerHash:await answerReviewHash(a),questionText:a.questionText||'',platform:a.platform||''};}));}
  if(!title||!states.includes(status))reject(400,'请填写待办标题和有效状态');
  if(b.useLabelReviews===true){if(!old||origin.evidenceContract?.kind!=='labels'||!/^[a-f0-9]{64}$/.test(b.labelReviewHash||''))reject(400,'请重新打开标签待办，取得当前核对回执');b.evidence=[{kind:'answer_review_group',id:old.id,sha256:b.labelReviewHash}];}
  let evidence=before?.evidence||[];if(b.evidence!==undefined){if(!Array.isArray(b.evidence)||b.evidence.length>5)reject(400,'最多关联 5 条复测证据');evidence=await Promise.all(b.evidence.map(ref=>evidenceSnapshot(env,ctx.owner,w.state,brand.id,ref,old?.created||stamp(),old?.id)));}
  if(['待复核','已复核'].includes(status)&&b.evidence===undefined&&evidence.length)evidence=await Promise.all(evidence.map(ref=>evidenceSnapshot(env,ctx.owner,w.state,brand.id,ref,old.created,old.id)));
  if(['待复核','已复核'].includes(status)){
   if(!old)reject(400,'请先保存待办，取得后续证据后再进入复核');
   if(!evidence.length)reject(400,'还没有关联后续证据，请先关联真实结果再进入复核');
   if(note.length<10)reject(400,'请填写至少 10 字的处理或复核结论');
  }
  const materialDetails=origin.evidenceContract?.kind==='ranking'?normalizeRankingReview(b.materialDetails===undefined?before?.materialDetails:b.materialDetails):null;
  let reviewReceipt=null,materialReviewReceipt=null;
  if(status==='已复核'&&origin.reviewPlan){const review=decisionReviewStatus(w.state,{brandId:brand.id,created:old.created,origin,evidence});if(!review.ready)reject(400,'本次诊断复测尚不能完成复核：'+review.reasons.join(' '));reviewReceipt={...review,checkedAt:stamp()};}
  if(status==='已复核'&&origin.evidenceContract){const review=diagnosticEvidenceReadiness(w.state,{id:old.id,brandId:brand.id,created:old.created,origin,evidence,materialDetails},evidence);if(!review.ready)reject(400,'本项材料尚不能完成复核：'+review.reasons.join(' '));materialReviewReceipt={...review,checkedAt:stamp(),checkedBy:ctx.actor,...(materialDetails?{manualScopeReview:materialDetails}:{})};}
  if((before?.history||[]).length>=100)reject(400,'已达到 100 条变更记录，请归档此事项并新建后续待办');
  const data={...(before?.stoppedAt?{stoppedAt:before.stoppedAt,stoppedBy:before.stoppedBy}:{}),...(status==='停止跟进'?{stoppedAt:stamp(),stoppedBy:ctx.actor}:{}),title,description,assignee,dueDate:String(b.dueDate||''),status,note,origin,evidence,...(materialDetails?{materialDetails}:{}),reviewReceipt,materialReviewReceipt,lastRetest:before?.lastRetest||null,history:[...(before?.history||[]),{at:stamp(),actor:ctx.actor,from:before?.status||'',to:status,note,assignee,...(materialDetails?{materialDetails}:{}),...(b.requestId?{requestId:b.requestId,requestHash}:{}),evidence:evidence.map(e=>({kind:e.kind,id:e.id,sha256:e.sha256}))}]};
  if(old){try{await change(env,ctx.owner,old,data);}catch(error){if(error.status===409&&b.requestId){const row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND id=? AND kind='action'").bind(ctx.owner,brand.id,b.id).first(),receipt=row&&JSON.parse(row.body).history?.find(h=>h.requestId===b.requestId);if(receipt?.requestHash===requestHash&&receipt.actor===ctx.actor)return h.json({saved:true,id:b.id,existing:true});}throw error;}}else {if(rows.filter(r=>r.kind==='action').length>=1000)reject(429,'当前品牌待办已达 1000 条');const saved=await insert(env,ctx.owner,brand.id,'action',b.id,data);if(!saved.meta.changes){if(decisionOrigin||credibilityOrigin){const existing=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND kind='action' AND id=?").bind(ctx.owner,brand.id,b.id).first();if(existing)return h.json({action:unpack(existing),existing:true});}reject(409,'待办标识已使用，请刷新');}}
  return h.json({saved:true,id:b.id});
 }
 reject(405,'不支持此执行管理操作');
}
