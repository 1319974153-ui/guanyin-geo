let operationsData=null,operationsBrand='',operationsWorkspace='',operationsIdentity='',operationsLoading=false,operationsError='',operationsReadAt=0,actionOrigin=null;
const operationScope=()=>JSON.stringify({owner:accessInfo.current.owner,actor:accessInfo.current.actor||'',role:accessInfo.current.role,brands:accessInfo.current.brands||[],workspace:sessionStorage.getItem('geo.workspace')||'',brand:brand().id});
const decisionOperationRequests=new Set();
let operationReviewReturn=null;
const operationStatuses=['待处理','处理中','待复测','待复核','已复核','停止跟进'];
const alertNames={failure:'执行异常',conflict:'事实疑点',budget:'调用配额',citation:'引用变化',article_citation:'文章引用'};
async function credibilityDigest(item,report){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(GEO_METRICS.credibilityToken(item,report))))].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function refreshOperations(){if(operationsLoading)return;const id=brand().id,ws=sessionStorage.getItem('geo.workspace')||'',scope=operationScope();operationsLoading=true;operationsError='';try{const d=await apiRequest('/api/operations?brandId='+encodeURIComponent(id));if(scope===operationScope()){operationsData=d;operationsBrand=id;operationsWorkspace=ws;operationsIdentity=scope;operationsReadAt=Date.now()}}catch(e){if(scope===operationScope())operationsError=e.message}finally{operationsLoading=false;if(route==='operations')render()}}
function operationStatusLabel(a){return a.origin?.evidenceContract?.kind==='submission_preparation'?'材料准备 · '+a.status:a.status;}
function materialOnlyOperation(a){return a?.evidenceReadiness?.legacyReadOnly||['labels','ranking','submission_preparation'].includes(a?.origin?.evidenceContract?.kind)||a?.evidenceReadiness?.kind==='labels';}
function retestPanel(a){const plans=(operationsData?.retestPlans||[]).filter(p=>p.actionId===a.id);return `<section class="source-evidence"><h3>关联复测任务</h3>${plans.map(p=>`<p>${esc(p.name)} · ${esc(taskStates[p.status]||p.status)} ${btn('查看任务与原回答','task-detail','small',`data-id="${p.id}"`)}</p>`).join('')||'<p>尚未从此事项发起复测。</p>'}<div class="row-actions">${canOperateTasks()&&!['已复核','停止跟进'].includes(a.status)&&!materialOnlyOperation(a)?btn(a.origin?.reviewPlan?'创建辅助 API 复测':'创建关联复测','operation-retest','small primary',`data-id="${a.id}"`):''}${accessInfo.current.role!=='viewer'&&a.lastRetest?btn('重新关联已完成结果','operation-collect','small',`data-id="${a.id}"`):''}</div><p class="helper">结果完整返回后自动进入待复核；失败、结果不明或问题改版需要处理。不会自动认定指标改善。</p></section>`;}
function operationsDecorate(){if(route==='operations'&&(operationsIdentity!==operationScope()||Date.now()-operationsReadAt>60000)&&!operationsLoading&&!operationsError)refreshOperations()}
function renderOperations(){
 const d=operationsIdentity===operationScope()?operationsData:null,showAll=context().get('alerts')==='all';
 return title('告警与改进待办','识别异常、分配责任、保存后续证据，再记录复核结论。',btn('检查当前告警','operations-evaluate')+(!['viewer','reviewer'].includes(accessInfo.current.role)?btn('＋ 新建待办','operation-new','primary'):''))+brandFilter()+
 (operationsError?`<div class="callout">${esc(operationsError)}${btn('重新载入','operations-refresh','small')}</div>`:'')+
 (!d?`<section class="panel"><div class="panel-body">${operationsLoading?'正在读取告警与待办…':'尚未读取此品牌执行记录。'}</div></section>`:
 `<div class="metric-strip">${[['待处理告警',d.alerts.filter(a=>a.status==='待处理').length,'同一问题自动去重'],['未完成待办',d.actions.filter(a=>!['已复核','停止跟进'].includes(a.status)).length,'责任人与截止日期'],['待复核',d.actions.filter(a=>a.status==='待复核').length,'须关联后续证据'],['最近检查',d.scan?new Date(d.scan.checkedAt).toLocaleTimeString('zh-CN'):'尚未检查',d.scan?new Date(d.scan.checkedAt).toLocaleDateString('zh-CN'):'可立即检查或等待执行器']].map(([t,n,x])=>`<div class="metric"><div class="metric-label">${t}</div><div class="metric-value">${n}</div><div class="metric-note">${esc(x)}</div></div>`).join('')}</div>`+
 `<div class="section-title"><h2>异常告警</h2><div class="row-actions"><a class="button small" href="#operations${showAll?'':'?alerts=all'}">${showAll?'仅看当前告警':'包含已消退记录'}</a>${isManager()?btn('调整规则','operation-rules','small'):''}</div></div><section class="panel">${table(['告警与依据','状态','最近变化','处理'],d.alerts.filter(a=>showAll||a.status!=='已消退').slice().reverse().map(a=>[`${badge(alertNames[a.type]||a.type)} <b>${esc(a.title)}</b><span class="sub">${esc(a.detail)}</span>`,badge(a.status,a.status==='待处理'?'amber':'blue'),new Date(a.updated).toLocaleString('zh-CN'),btn('查看依据','operation-alert','small',`data-id="${a.id}"`)]),'当前没有触发告警。无告警不代表已达到效果目标。')}</section><p class="helper">规则默认启用，由已连接的本机执行器随心跳检查。电脑离线会延后；站内告警可查看依据；只有另行启用事件回调后才向指定地址通知。${!d.rules.enabled?'当前品牌规则已暂停。':''}</p>`+
 `<div class="section-title"><h2>改进与复测待办</h2>${btn('刷新记录','operations-refresh','small')}</div><section class="panel">${table(['事项','负责人 / 截止','状态','复测证据','操作'],d.actions.slice().reverse().map(a=>[esc(a.title)+`<span class="sub">${esc(a.description.slice(0,100))}</span>`,`${esc(a.assignee==='owner'?'工作区所有者':a.assignee)}<span class="sub">${esc(a.dueDate||'未设截止')}</span>`,badge(operationStatusLabel(a),a.status==='已复核'?'blue':'amber'),a.evidence.length+' 条',btn('处理与复核','operation-edit','small',`data-id="${a.id}"`)+(canOperateTasks()&&!['已复核','停止跟进'].includes(a.status)&&!materialOnlyOperation(a)?btn(a.origin?.reviewPlan?'辅助 API 复测':'发起复测','operation-retest','small',`data-id="${a.id}"`):'')]),'可从品牌诊断或告警直接生成待办，也可以手动新建。')}</section><div class="callout">“已复核”记录团队的处理结论，不自动表示品牌指标改善。复核需要创建待办之后的实际回答、网页检查、出处核对、自动质检或报告。</div>`);
}
function alertDetail(id){const a=operationsData?.alerts.find(a=>a.id===id);if(!a)return;const e=a.evidence;
 const evidence=a.type==='article_citation'?`<p>${esc(e.title)}</p>${links(e.url,'被引用的文章')}<p>首次记录时间：${new Date(e.detectedAt).toLocaleString('zh-CN')}<br>最早已核对回答时间：${esc(e.capturedAt)}</p><p class="helper">这是当前工作区首次保留的匹配记录，不代表平台全网首次引用。</p>${btn('查看引用与页面依据','publication-check-detail','small',`data-id="${e.checkId}"`)}`:
 a.type==='failure'?e.items.map(t=>`<section class="source-evidence"><p>${esc(t.status)} · ${esc(t.error||'未记录原因')}</p><small>任务条目 ${esc(t.id)}</small></section>`).join('')+`<a class="button" href="#tasks">到任务中心恢复或重试</a>`:
 a.type==='conflict'?e.issues.map(x=>`<section class="source-evidence"><blockquote>${esc(x.quote)}</blockquote><p>${esc(x.reason)}</p><p>品牌资料：${esc(x.factQuote)}</p></section>`).join('')+btn('查看完整自动检查','check-detail','small',`data-id="${e.checkId}"`):
 a.type==='budget'?`<p>${e.day}（UTC）已使用 ${e.used} / ${e.limit} 次模型调用，提醒阈值 ${e.threshold}%。</p><a href="#team" class="button">查看配额与用量</a>`:
 `<p>窗口 ${esc(e.options.from)} — ${esc(e.options.to)}；前期 ${esc(e.previousOptions.from)} — ${esc(e.previousOptions.to)}（UTC）</p><p>变化 ${e.points.toFixed(1)} 个百分点，匹配 ${e.groups} 组，本期 ${e.currentN} 条 / 前期 ${e.previousN} 条已核对样本。</p><details class="advanced"><summary>关联回答 ID</summary><div class="answer-text">${esc([...e.currentIds,...e.previousIds].join('\n'))}</div></details>`;
 openDrawer(a.title,`${badge(a.status,a.status==='待处理'?'amber':'blue')}<p>${esc(a.detail)}</p>${evidence}${a.resolution?`<div class="callout">${esc(a.resolution)}</div>`:''}<div class="form-actions">${a.status!=='已消退'?btn('我已知悉','operation-ack','',`data-id="${a.id}" data-revision="${a.revision}"`):''}${btn('转为改进待办','operation-from-alert','primary',`data-id="${a.id}"`)}</div><p class="helper">首次触发 ${new Date(a.firstSeen).toLocaleString('zh-CN')} · 重现 ${a.occurrences} 次。知悉不会消除触发条件；条件发生变化会再次提示。</p>`,'站内告警 · 依据可追溯');
}
function eligibleEvidence(a,reports=[]){
 if(a.evidenceReadiness){const refs=[...a.evidenceReadiness.candidateRefs];for(const ref of a.evidence||[])if(!refs.some(r=>r.kind===ref.kind&&r.id===ref.id))refs.push({...ref,ineligible:true});return refs;}
 const refs=[...own('answers').map(x=>({kind:'answer',id:x.id,at:x.date,title:x.platform+' · '+(x.questionText||x.text.slice(0,60))})),...own('siteChecks').map(x=>({kind:'site',id:x.id,at:x.at,title:x.url+' · '+x.status})),...own('analysisChecks').map(x=>({kind:'check',id:x.id,at:x.created,title:'自动检查 · '+x.model})),...own('facts').map(x=>({kind:'fact',id:x.id,at:x.sourceReview?.checkedAt,title:'出处核对 · '+x.key})),...reports.map(x=>({kind:'report',id:x.id,at:x.created,title:x.title}))].filter(x=>x.at&&Date.parse(x.at)>=Date.parse(a.created)).sort((x,y)=>y.at.localeCompare(x.at)).slice(0,80);
 for(const x of a.evidence||[])if(!refs.some(r=>r.kind===x.kind&&r.id===x.id))refs.push(x);return refs;
}
function decisionOperationOrigin(origin){
 if(origin?.kind!=='decision')return '';
 const options=origin.options||{},ids=origin.evidence?.currentIds||[];
 return `<p><strong>目标问题：</strong>${esc(origin.goalQuery||'尚未设置')}</p><p>${esc(origin.conclusion)}</p><p>报告范围：${esc(options.from||'全部已保存记录')} — ${esc(options.to||'未记录')}（UTC） · ${esc(options.surface==='api'?'模型 API 测试':'消费端记录')} · ${esc(options.platform||'全部平台')}</p><p>依据回答：${esc(ids.join('、')||'尚无样本，不能据此判断未被推荐')}</p><p class="helper">${esc(origin.method||'此处保留创建时的报告依据；后续复测结果需另外关联。')}</p>`;
}
function decisionReviewPanel(a){
 const review=a?.reviewReadiness;if(!review)return '';
 const choices=canOperateTasks()?(a.consumerRetestChoices||[]):[];const entry=choices.map(c=>`<section><p>${esc(c.context.platform)} · ${esc(c.context.mode)} · ${esc(c.context.questionVersion)}</p>${c.canStart?btn('按原条件采集新回答','operation-consumer-retest','small primary',`type="button" data-id="${esc(a.id)}" data-answer="${esc(c.answerId)}"`):`<p class="helper">${esc(c.reason)}</p>`}</section>`).join('');
 return `<section class="source-evidence"><h3>真实${review.kind==='baseline'?'基线':'复测'}验收</h3><p><strong>原目标问题：</strong>${esc(review.goalQuery||'尚未设置')}</p>${a.reviewReceipt?`<p class="helper">复核回执：${esc(a.reviewReceipt.checkedAt)} · 当时关联 ${a.reviewReceipt.linkedAnswerIds.length} 条符合条件的回答。以下检查反映当前记录。</p>`:''}<p>${review.ready?'已关联符合条件的新回答，可填写处理结论并完成复核。':'完成前还需要：'}</p>${review.reasons.length?`<ul>${review.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}${review.conditions?.length?`<details><summary>原采样条件 · ${review.baselineGroups} 组</summary>${review.conditions.map(c=>`<p>${esc(c.platform)} · ${esc(c.entry==='app'?'App':'网页')} · ${esc(c.mode)} · ${esc(c.model)} · ${esc(c.region)} · ${esc(c.language)} · ${esc(c.questionVersion)}</p>`).join('')}</details>`:''}<p>已关联 ${review.linkedAnswerIds.length} 条符合条件的回答${review.kind==='retest'?`，覆盖 ${review.coveredGroups} / ${review.baselineGroups} 组原条件`:''}。</p>${entry}<div class="row-actions"><a class="button small" href="#answers">查看与导入真实回答</a></div><p class="helper">${esc(review.method)}</p></section>`;
}
function materialReviewPanel(a){
 const review=a?.evidenceReadiness;if(!review)return '';
 if(review.kind==='labels')return labelOperationPanel(a);
 const names={facts:'资料出处',content:'已审核稿件',publication:'公开发布回执',external:'站外材料',ranking:'人工核对排名或评选原文',submission_preparation:'准备投稿/申报材料'},destinations={facts:['knowledge','完善品牌资料'],content:['content','查看与审核稿件'],publication:['publish','查看发布记录'],external:['knowledge','完善来源与复核备注'],ranking:['knowledge','查看原始材料'],submission_preparation:['content','整理并审核材料稿']},link=destinations[review.kind];
 return `<section class="source-evidence"><h3>本项需要：${esc(names[review.kind]||'匹配材料')}</h3>${review.ready?'<p>已关联符合本项要求的材料，可填写结论后完成复核。</p>':review.reasons.map(reason=>`<p>${esc(reason)}</p>`).join('')}${a.materialReviewReceipt?`<p class="helper">上次复核：${esc(a.materialReviewReceipt.checkedAt)}。当前材料若有变化，需要重新核对。</p>`:''}${review.kind==='ranking'&&!review.legacyReadOnly?rankingReviewFields(a):''}${link?`<a href="#${link[0]}">${link[1]} →</a>`:''}<p class="helper">${esc(review.method)}</p></section>`;
}
function rankingReviewFields(a){
 const details=a.materialDetails||{},rows=[['issuer','发布机构',160],['publishedDate','原始材料发布日期',10],['scope','地区、行业、对象与统计周期',500],['methodology','评价方法与指标（至少 10 字）',800],['conclusion','原文实际支持的具体结论（至少 10 字）',800]];
 return `<fieldset><legend>人工核对口径</legend>${rows.map(([key,label,max])=>`<label class="field">${label}<input name="material_${key}" type="${key==='publishedDate'?'date':'text'}" maxlength="${max}" value="${esc(details[key]||'')}"></label>`).join('')}<label class="source-evidence"><input type="checkbox" name="material_attested">我已阅读下面选中的原始材料，确认上述口径与原文一致；这不是观引自动认定权威或排名。</label><p class="helper">一次核对一份原始材料，材料改变后需重新确认。可先保存未完成的核对，不自动记为完成。</p></fieldset>`;
}
function rankingMaterialPreview(ref){
 const fact=own('facts').find(f=>f.id===ref.id&&f.brandId===brand().id);if(!fact)return '';
 const source=String(fact.sourceReview?.source||fact.source||'');return `<blockquote>${esc(fact.value)}</blockquote>${/^https?:\/\//i.test(source)?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">查看原始出处 ↗</a>`:''}`;
}
function labelOperationPanel(a){
 const review=a.evidenceReadiness,receipt=review.candidateRefs?.find(r=>r.kind==='answer_review_group');
 return `<section class="source-evidence"><h3>核对原回答的推荐与引用</h3>${(review.answerTargets||[]).map(t=>`<p><b>${esc(t.platform)}</b> · ${esc(t.question)}<br>${t.ready?'标签已核对':'待核对'} ${btn('查看并核对原回答','operation-label-review','small',`type="button" data-id="${esc(a.id)}" data-answer="${esc(t.answerId)}"`)}</p>`).join('')}${receipt?'<p>有效核对回执已自动选好，保存时会关联到本事项，不用填写编号。</p>':review.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}<p class="helper">${esc(review.method)}</p>${a.materialReviewReceipt?'<p class="helper">此前复核保持历史记录；当前标签或原回答变化时，需要重新处理。</p>':''}</section>`;
}
async function openOperation(a=null,origin=null,guard=null){
 const openingScope=operationScope();
 if(operationsIdentity!==openingScope||!operationsData)await refreshOperations();if(!operationsData||operationsIdentity!==openingScope)throw new Error('执行记录尚未载入');
 let reports=[];if(a)reports=(await apiRequest('/api/reports?brandId='+encodeURIComponent(brand().id))).reports;
 if(openingScope!==operationScope())throw new Error('工作区或品牌已切换，请重新打开事项');if(guard&&!guard())throw Error('报告已变化，请刷新后重新加入待办');actionOrigin=origin;
 const role=accessInfo.current.role,readonly=role==='viewer'||a?.evidenceReadiness?.legacyReadOnly,reviewer=role==='reviewer',states=reviewer?[...new Set([a?.status||'待处理','待复核','已复核'])]:role==='editor'?operationStatuses.filter(s=>s!=='已复核'):operationStatuses;
 const labelReceipt=a?.evidenceReadiness?.kind==='labels'?a.evidenceReadiness.candidateRefs.find(r=>r.kind==='answer_review_group'):null;
 const refs=a?eligibleEvidence(a,reports):[],selected=new Set((a?.evidence||[]).map(x=>x.kind+':'+x.id));
 openDrawer(a?'处理与复核待办':'新建改进待办',`<form data-operations-form="action" data-scope="${esc(openingScope)}" data-id="${a?.id||crypto.randomUUID()}" data-revision="${a?.revision||0}" ${labelReceipt?`data-label-hash="${esc(labelReceipt.sha256)}"`:''}>${field('事项名称','title',a?.title||origin?.title||'')}${textField('需要完成什么','description',a?.description||origin?.description||'')}<div class="two-col"><label class="field">负责人<select name="assignee" required>${a&&!operationsData.assignees.some(x=>x.id===a.assignee)?'<option value="" selected disabled>原负责人权限已变化，请重新分配</option>':''}${operationsData.assignees.map(x=>`<option value="${esc(x.id)}" ${x.id===(a?.assignee||'owner')?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field">截止日期<input type="date" name="dueDate" value="${esc(a?.dueDate||'')}"></label></div><label class="field">处理状态<select name="status">${states.map(s=>`<option value="${s}" ${s===(a?.status||'待处理')?'selected':''}>${a?.origin?.evidenceContract?.kind==='submission_preparation'&&s==='已复核'?'材料已准备（已复核）':s}</option>`).join('')}</select></label>${textField('本次处理 / 复核结论','note',a?.note||(labelReceipt?'已核对原回答的推荐与引用；仅完善标签，不作为新增采样或效果改善。':'')).replace(' required','')}${a?materialReviewPanel(a):''}${a?.evidenceReadiness?.kind==='labels'?'<p class="helper">完成标签核对后重新打开此事项，即可自动带出回执；停止跟进需说明原因，不记为已完成。</p>':a?`<fieldset class="operation-evidence"><legend>关联后续证据（最多 5 条）</legend>${refs.map(r=>`<label class="source-evidence"><input type="checkbox" name="evidence" value="${r.kind}:${r.id}" ${selected.has(r.kind+':'+r.id)?'checked':''}> ${esc(r.title)}${a.evidenceReadiness?.kind==='ranking'?rankingMaterialPreview(r):''}${a.evidenceReadiness?`<span class="sub">${r.ineligible?'此记录已失效或不匹配，不能完成本项':a.evidenceReadiness.kind==='ranking'?'原文资料可选，仍需人工核对口径':'符合本项要求，可关联'}</span>`:''}${r.kind==='answer'&&a.reviewReadiness?.candidateAnswerIds?.includes(r.id)?'<span class="sub">符合本次真实复测条件</span>':''}<span class="sub">${new Date(r.at).toLocaleString('zh-CN')}</span></label>`).join('')||(a.evidenceReadiness?'<p>暂时没有匹配材料，请先按上面的提示完成资料或稿件。</p>':'<p>暂时没有创建此待办之后的证据。完成采样、网页检查或内容质检后回来关联。</p>')}</fieldset><p class="helper">${materialOnlyOperation(a)?'本项按上面的材料要求核对；普通网页检查或模型采样不能替代。':'<a href="#tasks">创建复测采样任务</a> · <a href="#audit">检查网页</a> · <a href="#content">检查内容</a>。'}更新状态不会自动调用模型或发布。</p>`:'<p class="helper">先保存待办，再开始执行或复测。后续结果可关联回来。</p>'}<p class="form-error" role="alert"></p><div class="form-actions"><button class="button primary" type="submit">保存处理记录</button></div></form>${a?decisionReviewPanel(a):''}${a&&!materialOnlyOperation(a)?retestPanel(a):''}${a?`<details class="advanced"><summary>来源与 ${a.history.length} 条处理记录</summary><p>来源：${a.origin.kind==='opportunity'?'问题处理机会':a.origin.kind==='diagnosis'?'品牌诊断':a.origin.kind==='decision'?'报告执行步骤':a.origin.kind==='credibility'?'可信资料建议':a.origin.kind==='alert'?'异常告警':'手动创建'}</p>${decisionOperationOrigin(a.origin)}${a.origin.kind==='opportunity'?`<p>${esc(a.origin.opportunity.questionText)} · ${esc(a.origin.opportunity.questionVersion)}</p>${a.origin.opportunity.reasons.map(t=>`<p>${esc(t)}</p>`).join('')}<p>依据回答：${esc(a.origin.opportunity.answerIds.join('、')||'尚无')}</p>`:''}${a.history.slice().reverse().map(h=>`<div class="source-evidence"><b>${esc(h.from||'创建')} → ${esc(h.to)}</b><p>${esc(h.note||'无备注')}</p><small>${new Date(h.at).toLocaleString('zh-CN')}</small></div>`).join('')}</details>`:''}`,'责任分配 · 后续证据 · 人工复核');
 const f=$('[data-operations-form="action"]');if(a?.evidenceReadiness?.kind==='ranking'&&!a.evidenceReadiness.legacyReadOnly)f.rankingEvidence=a.evidenceReadiness.candidateRefs.map(r=>({id:r.id,sha256:r.sha256}));if(readonly)f.querySelectorAll('input,textarea,select,button').forEach(x=>x.disabled=true);else if(reviewer)for(const name of ['title','description','assignee','dueDate']){const x=f.elements[name];if(x.tagName==='SELECT')x.disabled=true;else x.readOnly=true;}
}
function openAlertRules(){const d=operationsData,r=d.rules;openDrawer('告警规则',`<form data-operations-form="rules" data-revision="${d.ruleRevision}">${[['enabled','启用此品牌告警'],['failures','任务失败或结果不确定'],['conflicts','回答中的疑似事实冲突'],['budget','模型调用配额提醒'],['citations','官网引用下降与首次文章引用']].map(([k,n])=>`<label class="auto-option"><input type="checkbox" name="${k}" ${r[k]?'checked':''}>${n}</label>`).join('')}<div class="two-col">${[['budgetPercent','配额提醒百分比',10,100],['citationDrop','引用下降百分点',1,100],['minSamples','每期最少匹配样本',2,1000]].map(([k,n,min,max])=>`<label class="field">${n}<input type="number" name="${k}" min="${min}" max="${max}" value="${r[k]}" required></label>`).join('')}<label class="field">引用观察窗口<select name="windowDays">${[7,30,90].map(n=>`<option value="${n}" ${r.windowDays===n?'selected':''}>${n} 天</option>`).join('')}</select></label></div><p class="helper">引用比较截至昨日 UTC，避免把未结束的一天当成完整周期。仅计有完整平台上下文和已核对引用的样本。配额按请求次数提醒，不推算金额。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存规则</button></form>`,'默认自动检查 · 阈值可调整');}
async function resumeOperationAfterCapture(back,answerId){
 if(back.scope!==operationScope())return false;
 await refreshOperations();if(back.scope!==operationScope()||operationsError)throw Error('待办暂不可用');
 const action=operationsData?.actions.find(a=>a.id===back.actionId);if(!action||['已复核','停止跟进'].includes(action.status))return false;
 if(!action.reviewReadiness?.candidateAnswerIds?.includes(answerId)){
  operationReviewReturn={...back,answerId,consumerCapture:true};
  toast('回答已保存；推荐与引用仍待核对，核对后可返回原待办。');return false;
 }
 await openOperation(action);if(back.scope!==operationScope())return false;
 const f=$('[data-operations-form="action"]'),checks=[...(f?.querySelectorAll('input[name="evidence"]')||[])],target=checks.find(c=>c.value==='answer:'+answerId);
 if(target){if(checks.filter(c=>c.checked).length<5||target.checked){target.checked=true;toast('新回答已保存，并为原待办预选；保存处理记录后才会关联，不自动认定效果改善。');}else toast('新回答已保存；待办已有 5 条证据，请选择需要保留的记录。');}
 return true;
}
async function resumeOperationAfterReview(answerId){
 const back=operationReviewReturn;operationReviewReturn=null;if(!back||back.answerId!==answerId||back.scope!==operationScope())return false;
 if(back.consumerCapture){try{return await resumeOperationAfterCapture(back,answerId);}catch{toast('标签已保存，待办暂时无法读取；稍后打开待办即可继续。');return false;}}
 try{await refreshOperations();if(back.scope!==operationScope()||operationsError)return false;const action=operationsData?.actions.find(a=>a.id===back.actionId);if(!action)return false;await openOperation(action);return true;}catch{toast('标签已保存，待办暂时无法读取；稍后打开待办即可继续。');return false;}
}
async function operationsAction(name,el){
 if(name==='operation-label-review'){const scope=operationScope();await refreshOperations();if(scope!==operationScope())throw Error('工作区或品牌已切换');const a=operationsData?.actions.find(a=>a.id===el.dataset.id);if(!a?.evidenceReadiness?.answerTargets?.some(t=>t.answerId===el.dataset.answer))throw Error('原回答不属于此标签待办');operationReviewReturn={scope,actionId:a.id,answerId:el.dataset.answer};await openAnswerReview(el.dataset.answer);return true;}

 if(name==='operation-from-decision'){
  if(!['owner','admin','editor'].includes(accessInfo.current.role))return true;
  const scope=operationScope(),report=decisionActionReport(el),step=report.decision?.steps?.find(item=>item.id===el.dataset.id),requestKey=scope+'|'+el.dataset.reportKey+'|'+el.dataset.id;
  if(!step||decisionOperationRequests.has(requestKey))return true;
  const current=()=>scope===operationScope()&&el.isConnected&&decisionActionReport(el)===report;
  decisionOperationRequests.add(requestKey);el.disabled=true;
  try{
   await runtimeFlush();if(!current())throw Error('工作区、品牌或报告已变化，请重新加入待办');
   const token=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(GEO_METRICS.decisionActionToken(report,step))))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(!current())throw Error('工作区、品牌或报告已变化，请重新加入待办');
   const result=await apiRequest('/api/operations/actions',{method:'POST',body:JSON.stringify({brandId:report.brand.id,options:report.options,decision:{id:step.id,token}})});
   if(current()){operationsReadAt=0;el.textContent='已加入待办';toast(result.existing?'这项建议已在待办中':'已加入改进待办，未启动模型或发布');}
  }catch(error){if(scope===operationScope()&&el.isConnected){el.disabled=false;throw error;}}
  finally{decisionOperationRequests.delete(requestKey);}
  return true;
 }
 if(name==='operation-consumer-retest'){const scope=operationScope();await runtimeFlush();if(scope!==operationScope())throw Error('工作区或品牌已切换');await reloadWorkspace();await refreshOperations();if(scope!==operationScope())throw Error('工作区或品牌已切换');const a=operationsData?.actions.find(a=>a.id===el.dataset.id),choice=a?.consumerRetestChoices?.find(c=>c.answerId===el.dataset.answer&&c.canStart);if(!a||!choice||!canOperateTasks())throw Error('原采样条件已变化，请重新打开此事项');const opened=await captureGuideAction('capture-retest',{dataset:{id:choice.answerId}});const form=$('[data-answer-import]');if(form)form.captureAfterSave=answerId=>resumeOperationAfterCapture({scope,actionId:a.id},answerId);return opened;}
 if(name==='operation-retest'){const scope=brand().id+'|'+(sessionStorage.getItem('geo.workspace')||'');await refreshOperations();if(scope!==brand().id+'|'+(sessionStorage.getItem('geo.workspace')||''))throw new Error('工作区或品牌已切换');const a=operationsData?.actions.find(a=>a.id===el.dataset.id);if(!a||!canOperateTasks())return true;if(['已复核','停止跟进'].includes(a.status)||a.origin?.evidenceContract?.kind==='labels'||a.evidenceReadiness?.kind==='labels')throw Error('此事项当前不需要新增模型复测');if(!serverConnections.length)throw new Error('请先在服务连接中配置模型');openDrawer(a.origin?.reviewPlan?'为待办创建辅助 API 复测':'为待办创建复测',taskForm('sample',null,a),'关联原事项 · 当前问题版本 · 模型 API');taskEstimate();return true;}
 if(name==='operation-collect'){const id=el.dataset.id,d=await apiRequest('/api/operations/retests/collect',{method:'POST',body:JSON.stringify({brandId:brand().id,id})});await reloadWorkspace();await refreshOperations();await openOperation(operationsData.actions.find(a=>a.id===id));toast(d.attached?'复测结果已关联，等待复核':d.pending[0]?.reason||'没有需要重新关联的结果');return true;}

 if(name==='operations-refresh'){await refreshOperations();return true;}
 if(name==='operations-evaluate'){el.disabled=true;try{await runtimeFlush();await apiRequest('/api/operations/evaluate',{method:'POST',body:JSON.stringify({brandId:brand().id})});await refreshOperations();toast('已按实际记录重新检查告警')}finally{el.disabled=false}return true;}
 if(name==='operation-alert'){alertDetail(el.dataset.id);return true;}
 if(name==='operation-rules'){openAlertRules();return true;}
 if(name==='operation-new'){await openOperation();return true;}
 if(name==='operation-edit'){await refreshOperations();await openOperation(operationsData.actions.find(a=>a.id===el.dataset.id));return true;}
 if(name==='operation-ack'){await apiRequest('/api/operations/acknowledge',{method:'POST',body:JSON.stringify({brandId:brand().id,id:el.dataset.id,revision:Number(el.dataset.revision)})});closeDrawer();await refreshOperations();return true;}
 if(name==='operation-from-alert'){const a=operationsData.alerts.find(a=>a.id===el.dataset.id);await openOperation(null,{alertId:a.id,title:a.title,description:a.detail});return true;}
 if(name==='operation-from-opportunity'){if(!canManageOpportunities())return true;const scope=operationScope(),r=currentEvidenceReport(),o=r.opportunities.items.find(x=>x.questionId===el.dataset.id);if(o){const token=await opportunityDigest(o);if(scope!==operationScope())throw new Error('工作区或品牌已切换');await openOperation(null,{opportunity:{questionId:o.questionId,type:o.type,token},options:r.options,title:(o.title+' · '+o.questionText).slice(0,160),description:o.reasons.join('；')+'。下一步：'+o.next});}return true;}
 if(name==='operation-from-credibility'){
  if(!['owner','admin','editor'].includes(accessInfo.current.role))return true;
  const scope=operationScope(),r=credibilityActionReport(el),item=r.credibilityPlan?.items?.find(item=>item.id===el.dataset.id),key=scope+'|credibility|'+el.dataset.reportKey+'|'+el.dataset.id;
  if(!item)throw Error('这项建议已变化，请刷新报告');if(decisionOperationRequests.has(key))return true;
  const current=()=>scope===operationScope()&&el.isConnected&&credibilityActionReport(el)===r;
  decisionOperationRequests.add(key);el.disabled=true;
  try{await runtimeFlush();if(!current())throw Error('工作区、品牌或报告已变化，请重新加入待办');const token=await credibilityDigest(item,r);if(!current())throw Error('工作区、品牌或报告已变化，请重新加入待办');await openOperation(null,{credibility:{id:item.id,token},options:r.options,title:('可信背书 · '+item.title).slice(0,160),description:(item.detail+' 下一步：'+item.next).slice(0,3000)},current);}
  catch(error){if(scope===operationScope()&&el.isConnected)throw error;}
  finally{decisionOperationRequests.delete(key);if(el.isConnected)el.disabled=false;}return true;
 }
 if(name==='operation-from-diagnosis'){const r=currentEvidenceReport(),d=r.diagnosis.find(d=>d.type===el.dataset.type);if(d)await openOperation(null,{diagnosis:d.type,options:r.options,title:d.title,description:d.detail});return true;}
 return false;
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-operations-form]');if(!f)return;e.preventDefault();if(runtimeBusy)return;const error=f.querySelector('.form-error'),button=f.querySelector('button[type="submit"]');button.disabled=true;error.textContent='';runtimeLock(true);const submitScope=operationScope();let writeAttempted=false,writeAccepted=false;
 try{await runtimeFlush();if(f.dataset.scope&&f.dataset.scope!==operationScope())throw new Error('工作区或品牌已切换，请重新打开事项');const values=new FormData(f),kind=f.dataset.operationsForm,data={...Object.fromEntries(values),brandId:brand().id,revision:Number(f.dataset.revision)};
  if(kind==='rules'){for(const key of ['enabled','failures','conflicts','budget','citations'])data[key]=f.elements[key].checked;for(const key of ['budgetPercent','citationDrop','minSamples','windowDays'])data[key]=Number(data[key]);}
  else {data.id=f.dataset.id;data.assignee=f.elements.assignee.value;data.evidence=values.getAll('evidence').map(v=>{const [kind,id]=v.split(':');return {kind,id}});if(!data.revision){delete data.evidence;for(const key of ['diagnosis','options','alertId','opportunity','credibility'])if(actionOrigin?.[key]!==undefined)data[key]=actionOrigin[key];}}
  if(kind==='action'&&f.rankingEvidence){const ref=data.evidence.length===1?f.rankingEvidence.find(r=>r.id===data.evidence[0].id&&data.evidence[0].kind==='fact'):null;data.materialDetails={factId:ref?.id||'',factHash:ref?.sha256||'',attested:f.elements.material_attested?.checked===true};for(const key of ['issuer','publishedDate','scope','methodology','conclusion']){data.materialDetails[key]=String(data['material_'+key]||'');delete data['material_'+key];}delete data.material_attested;}
  if(kind==='action'){if(!f.operationRequest){data.requestId=crypto.randomUUID();if(f.dataset.labelHash&&['待复核','已复核'].includes(data.status)){data.useLabelReviews=true;data.labelReviewHash=f.dataset.labelHash;}f.operationRequest=data;}f.operationControlLocks??=[...(f.querySelectorAll?.('input,textarea,select')||[])].map(x=>[x,x.disabled]);f.operationControlLocks.forEach(([x])=>x.disabled=true);}
  const request=f.operationRequest||data;writeAttempted=true;const saved=await apiRequest('/api/operations/'+(kind==='rules'?'rules':'actions'),{method:'POST',body:JSON.stringify(request)});writeAccepted=true;runtimeLock(false);closeDrawer();await refreshOperations();if(route!=='operations')go('operations');else render();toast(saved.existing&&saved.action?'同一建议已有待办（'+saved.action.status+'），已保留原状态。':'处理记录已保存');
 }catch(err){
  const correctable=writeAttempted&&!writeAccepted&&[400,422].includes(err.status)&&submitScope===operationScope();
  if(correctable){delete f.operationRequest;f.operationControlLocks?.forEach(([x,disabled])=>x.disabled=disabled);delete f.operationControlLocks;}
  error.textContent=err.message+(correctable?'；请补正后再次保存。':f.operationRequest?'；本次要求已保留，可重试保存；更改要求请关闭后重新打开。':'');button.disabled=false;
 }finally{runtimeLock(false)}
});

setInterval(()=>{if(route==='operations'&&!document.hidden&&!runtimeBusy&&!document.getElementById('drawer').open)refreshOperations()},60000);
