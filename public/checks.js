let activeChecksBatch=null,checksStop=false;
function checksScope(){return [accessInfo.current.owner,sessionStorage.getItem('geo.workspace')||'',brand().id].join('|')}
function latestCheck(kind,id){const record=own('analysisChecks').filter(r=>r.kind===kind&&r.input.targets.some(t=>t.id===id)).at(-1);return record?{record,result:record.results.find(x=>x.id===id),stale:GEO_CHECKS.checkStale(record,state)}:null;}
function checkLabel(kind,id){const x=latestCheck(kind,id);if(!x)return '尚未检查';if(x.stale)return '资料变化，需重检';if(kind==='content'&&x.record.input.version<3)return '事实检查已保存；语义尚未检查';if(x.record.parseError||!x.result||x.result.problems.length)return '检查结果需核对';const n=x.result.claims.filter(c=>c.relation!=='支持').length+x.result.negations.length;return n?n+' 项待核对':'已检查，待复核';}
function contentCheckSummary(c){return `<span class="sub">自动质检：${checkLabel('content',c.id)}</span>`;}
function contentReviewDetailsHtml(review){
 if(!review||review.status==='not_available')return '<p class="helper">这份旧回执没有五项语义审校，重新检查后才会提供文章修改建议。</p>';
 const labels={needs_revision:'建议修改',satisfactory:'暂未发现明显问题',not_assessable:'依据不足，无法判断'};
 return review.dimensions.map(item=>`<div class="source-evidence"><b>${esc(item.label)} · ${esc(labels[item.status]||'待核对')}</b>${item.quote?`<blockquote>${esc(item.quote)}</blockquote><small>${item.location==='title'?'标题原句':'正文原句'}</small>`:''}<p>${esc(item.issue)}</p>${item.suggestion?`<p>建议：${esc(item.suggestion)}</p>`:''}${item.factId?`<p>对应资料 ${esc(item.factId)}：${esc(item.factQuote)}</p>`:''}</div>`).join('')+(review.excluded||[]).map(item=>`<p class="form-error">未采纳：${esc(item.reason)}</p>`).join('')+'<p class="helper">原句定位仅证明内容来自保存的稿件或资料，模型的语义判断仍需复核；不自动批准发布。</p>';
}
function contentReviewPanelHtml(id,dirty){
 if(dirty)return '<p class="helper">先保存当前修改，再检查文章；旧建议不会用于当前编辑内容。</p>';
 const review=GEO_CHECKS.currentContentReview?.(state,brand().id,id);
 if(!review){const previous=latestCheck('content',id),legacy=previous?.record.input.version<3;return '<button type="button" class="button small" data-article-check-start>检查文章质量</button><span class="helper">'+(legacy?'已有记录只核对事实，尚未检查文章的回答、标题和表达。':'')+'使用你的写作模型检查，确认费用后才开始。</span>';}
 const suggestions=review.suggestions.slice(0,3);
 return (suggestions.length?'<h4>优先改这 '+suggestions.length+' 项</h4><ol>'+suggestions.map(item=>`<li><b>${esc(item.label)}</b><p>${esc(item.issue)}</p><p>${esc(item.suggestion)}</p></li>`).join('')+'</ol><button type="button" class="button small" data-article-semantic-revise>让 AI 按建议改一版</button>':`<p>${review.status==='incomplete'?'部分项目缺少有效判断，请先看具体原因。':'五项模型审校已返回，暂未给出修改建议；仍需确认事实和表达。'}</p>`)+`<details class="advanced"><summary>查看五项审校依据与全部建议</summary>${contentReviewDetailsHtml(review)}<button type="button" class="button small" data-article-check-start>重新检查文章质量</button></details>`;
}
function renderPerceptionChecks(r){
 const rows=r.answers.slice().reverse().slice(0,100).map(a=>{const x=latestCheck('answer',a.id);return [esc(a.platform)+`<span class="sub">${esc(a.date.slice(0,10))} · ${esc((a.questionText||a.questionSnapshot||'').slice(0,80))}</span>`,badge(x&&!x.stale&&x.result&&!x.record.parseError?x.result.sentiment:'待分析','amber'),esc(checkLabel('answer',a.id)),`${btn(x?'查看分析':'分析此条',x?'check-detail':'check-one','small',`data-kind="answer" data-id="${x?x.record.id:a.id}"`)} ${btn('原回答','answer-detail','ghost small',`data-id="${a.id}"`)}`]});
 return `<div class="panel-body"><div class="row-actions">${btn('批量分析本期回答','check-answers','primary')}${pendingChecksButton()}</div><p>识别针对本品牌的情感、否定语境和疑似事实冲突。AI 判断单独保存，原句必须能在回答中定位。</p><p class="helper">以下展示最近 100 条本期回答，批量可处理本期全部。人工推荐与引用标签、报告比例不会被模型结果覆盖。</p></div>`+table(['回答','AI 情感建议','检查状态','证据'],rows,'本期没有可分析的回答。');
}
function pendingChecksButton(){try{const p=JSON.parse(sessionStorage.getItem('geo.checks.pending')||'null');return p?.brandId===brand().id&&p.scope===checksScope()?btn('恢复未完成检查','checks-resume','small'):''}catch{return ''}}
function checkRecoveryHtml(r){return (r.parseRepair?'<p class="helper">已修复模型输出中的引号格式；原始回执保留，证据仍须与原文逐字匹配。</p>':'')+(r.parseError&&r.parserVersion!==GEO_CHECKS.CHECK_PARSE_VERSION?btn('重新解析已有结果','checks-reparse','small',`data-id="${r.id}"`)+'<p class="helper">使用已保存的原始回执，不调用模型、不增加模型用量。</p>':'');}
function excludedClaimsHtml(x){return (x.excludedClaims||[]).map(c=>`<div class="source-evidence"><b>未采纳的模型引句</b><blockquote>${esc(c.quote||'未返回引句')}</blockquote><p>${esc(c.reason)}</p></div>`).join('');}
function showCheckDetail(id){
 const r=own('analysisChecks').find(r=>r.id===id);if(!r)return;if(r.kind==='competitor'){showCompetitorCheck(r);return;}const stale=GEO_CHECKS.checkStale(r,state);
 openDrawer(r.kind==='answer'?'品牌感知与原句证据':'内容质检与事实依据',`<div class="callout">${stale?'<b>资料已变化或过期，本次结果需重新检查。</b>':`检查于 ${new Date(r.created).toLocaleString('zh-CN')} · ${esc(r.model)}`}<p>逐字匹配只证明引文来自已保存资料，语义判断仍需复核。缺少证据不等于已证伪。</p></div>${r.parseError?`<p class="form-error">${esc(r.parseError)}</p>`:''}${checkRecoveryHtml(r)}`+
 r.input.targets.map(t=>{const x=r.results.find(x=>x.id===t.id);return `<section class="check-target"><h3>${esc(t.title||t.question||'回答 '+t.id)}</h3>${!x?'<p>此条没有有效检查结果。</p>':`${r.kind==='answer'?`<h4>AI 情感建议：${esc(x.sentiment)}</h4>${x.sentimentQuote?`<blockquote>${esc(x.sentimentQuote)}</blockquote>`:''}${x.negations.map(n=>`<div class="source-evidence"><b>否定 / 限制语境</b><blockquote>${esc(n.quote)}</blockquote><p>${esc(n.reason)}</p></div>`).join('')}`:''}${x.problems.map(p=>`<p class="form-error">${esc(p)}</p>`).join('')}${excludedClaimsHtml(x)}${r.kind==='content'?'<h4>五项文章语义审校</h4>'+contentReviewDetailsHtml(x.editorialReview):''}<h4>逐项事实核对</h4>${x.claims.map(c=>{const f=r.input.facts.find(f=>f.id===c.factId);return `<div class="source-evidence">${badge(c.relation,c.relation==='支持'?'blue':'amber')}<blockquote>${esc(c.quote)}</blockquote><p>${esc(c.reason)}</p>${f?`<div class="check-fact"><b>对应资料：${esc(f.key)}</b><p>${esc(c.factQuote)}</p><small>出处：${esc(f.source)}${f.expiresAt?' · 有效至 '+esc(f.expiresAt):''}</small></div>`:'<p class="helper">尚未找到可定位的有效事实依据。</p>'}</div>`}).join('')||'<p>模型没有返回可核对的事实条目。</p>'}`}${r.kind==='content'?`<h4>同品牌内容重复检查</h4>${t.duplicates.map(d=>`<div class="source-evidence"><b>${esc(d.title)}</b><p>三字片段集合相似度 ${(d.score*100).toFixed(1)}%${d.quote?' · 发现相同段落':''}</p>${d.quote?`<blockquote>${esc(d.quote)}</blockquote>`:''}</div>`).join('')||'<p>没有发现集合相似度至少 45% 或相同长段落的库内稿件。</p>'}<p class="helper">仅比较当前品牌已保存内容；不代表互联网查重率或原创证明。</p>`:''}<details class="advanced"><summary>本次检查的原始文本</summary><div class="answer-text">${esc(t.text)}</div></details></section>`}).join('')+
 `<details class="advanced"><summary>原始模型输出与回执</summary><p>请求 ID：${esc(r.requestId||'供应商未返回')} · 用量：${esc(JSON.stringify(r.usage))}</p><p class="helper">输入 SHA-256：${esc(r.inputHash)}</p><div class="answer-text">${esc(r.rawText)}</div></details>`,'自动核对 · 保留证据');
}
async function openChecks(kind,ids){
 if(!ids.length){toast('没有可检查的记录');return;}
 if(!serverConnections.length){toast('请先配置模型服务');go('integrations');return;}
 let budget=null;const startingScope=checksScope(),article=kind==='content'&&ids.length===1?own('contents').find(c=>c.id===ids[0]):null;
 if(article?.writingBudgetId){try{const d=await apiRequest('/api/writing-budget/status?'+new URLSearchParams({id:article.writingBudgetId}),{method:'GET'});if(startingScope!==checksScope())return;if(d.budget?.eligible&&d.budget.availableStages?.includes('review')&&d.budget.articleId===article.id)budget=d.budget;}catch(error){if(startingScope!==checksScope())return;toast('本篇额度暂不可确认；可在下方单独确认本次检查费用。');}}
 openDrawer(kind==='competitor'?'批量竞品语义分析':kind==='answer'?'批量分析品牌感知':'批量内容质检',`<form data-checks-form data-writing-budget="${esc(budget?.id||'')}" data-queue-id="${crypto.randomUUID()}" data-kind="${kind}" data-scope="${esc(checksScope())}" data-ids="${ids.join(',')}"><p>将检查 ${ids.length} 条记录，分 ${Math.ceil(ids.length/(kind==='competitor'?2:5))} 批依次执行，每批最多 ${kind==='competitor'?2:5} 条并计入每日模型配额。</p><label class="field">模型<select name="provider" ${budget?'disabled':''}>${serverConnections.map(c=>`<option value="${esc(c.provider)}" ${budget?.provider===c.provider?'selected':''}>${esc(c.model)}</option>`).join('')}</select></label><label class="auto-option"><input type="checkbox" name="onlyPending" checked>跳过已有有效检查的记录</label><p class="helper">${kind==='competitor'?'发送所选回答和当前品牌、竞品身份资料；不发送品牌事实库。':'发送所选原文、品牌名称与事实资料。已确认且未过期的资料作为核对依据。'}结果保存为建议，不自动改变审核状态。</p>${canOperateTasks()&&!budget?'<label class="auto-option"><input type="checkbox" name="background" checked>在后台运行，关闭页面后继续</label><p class="helper">本机执行器在线时自动处理，可在任务中心暂停。排队后原文或资料变化时停止该批，避免检查旧稿。</p>':''}${budget?'<p>这篇文章的一次质检已包含在本篇计划内，无需重复确认费用。</p><p class="helper">只在点击下方按钮后执行，不自动运行或发布。</p>':'<label class="auto-option"><input type="checkbox" name="confirmCost" required>确认本批模型调用费用；每批最多 8,000 输出 token，实际费用以供应商回执为准</label><p class="helper">只执行本次选择的批次，不自动每日检查；未包含的后续调用分别确认费用。</p>'}<p class="form-error" role="alert"></p><div class="form-actions"><button class="button primary" type="submit">${budget?'使用本篇额度检查':'确认费用，开始检查'}</button></div></form>`,'一次操作 · 分批保存');
}
function rememberChecks(){if(activeChecksBatch)sessionStorage.setItem('geo.checks.pending',JSON.stringify(activeChecksBatch));else sessionStorage.removeItem('geo.checks.pending');}
async function runChecksBatch(){
 if(!activeChecksBatch||runtimeBusy)return;if(activeChecksBatch.scope!==checksScope()){toast('工作区或品牌已切换，请返回原工作区恢复');return;}checksStop=false;runtimeLock(true);
 openDrawer('正在自动检查',`<p id="checks-progress"></p><p class="helper">长文检查每批最长等待约 3 分钟，完成即保存。关闭页面后，可从“恢复未完成检查”继续；已返回的请求会先恢复回执。</p><div id="checks-error" class="form-error" role="alert"></div>${btn('完成当前批后停止','checks-stop','small')}`,'批量检查 · 逐批保存');
 try{
  await runtimeFlush();const p=activeChecksBatch;
  while(p.next<p.groups.length&&!checksStop){if(p.scope!==checksScope())throw new Error('工作区或品牌已切换，检查已停止');const g=p.groups[p.next];$('#checks-progress').textContent=`正在处理第 ${p.next+1} / ${p.groups.length} 批（${g.ids.length} 条）…`;
   const d=await apiRequest('/api/checks/run',{method:'POST',body:JSON.stringify({brandId:p.brandId,kind:p.kind,provider:p.provider,...(p.writingBudgetId?{writingBudgetId:p.writingBudgetId}:{confirmCost:true}),...g})});if(p.scope!==checksScope())throw new Error('工作区或品牌已切换，请返回原工作区恢复回执');state=d.state;serverRevision=d.revision;p.lastId=d.record.id;p.next++;rememberChecks();
   if(d.record.parseError){$('#checks-error').textContent='本批输出格式不完整，已保存原始结果。后续批次暂停，请核对。';break;}
  }
  if(p.next===p.groups.length){const lastId=p.lastId;activeChecksBatch=null;rememberChecks();runtimeLock(false);render();showCheckDetail(lastId);toast('批量检查完成，每条结果与原句已保存');}
  else {$('#checks-progress').textContent=`已保存 ${p.next} / ${p.groups.length} 批。剩余检查可稍后恢复。`;$('#drawer-body').insertAdjacentHTML('beforeend',btn('继续未完成检查','checks-resume','primary'));runtimeLock(false);render();}
 }catch(e){$('#drawer-title').textContent='检查未完成';$('#checks-progress').textContent=`已保存 ${activeChecksBatch.next} / ${activeChecksBatch.groups.length} 批，本批尚无可用结果。`;$('#checks-error').textContent=e.message+' 同一批次恢复不会再次调用已完成的请求；结果未知的请求需先核对供应商用量。';$('#drawer-body').insertAdjacentHTML('beforeend',btn('恢复本批回执','checks-resume','small'));render();}
 finally{runtimeLock(false);}
}
async function checksAction(name,el){
 if(name==='checks-reparse'){if(runtimeBusy)return true;const scope=checksScope(),brandId=brand().id;runtimeLock(true);el.disabled=true;try{await runtimeFlush();const d=await apiRequest('/api/checks/reparse',{method:'POST',body:JSON.stringify({brandId,runId:el.dataset.id})});if(scope!==checksScope())throw new Error('工作区或品牌已切换，请返回原范围查看结果');state=d.state;serverRevision=d.revision;runtimeLock(false);render();showCheckDetail(d.record.id);toast(d.record.parseError?'原始回执仍无法解析；未调用模型':'已有回执已重新解析；未调用模型');}catch(e){toast(e.message);el.disabled=false;}finally{runtimeLock(false)}return true;}
 if(name==='check-detail'){showCheckDetail(el.dataset.id);return true;}
 if(name==='check-one'){openChecks(el.dataset.kind,[el.dataset.id]);return true;}
 if(name==='check-answers'){openChecks('answer',currentEvidenceReport().answers.map(a=>a.id));return true;}
 if(name==='check-contents'){const status=context().get('status');openChecks('content',own('contents').filter(c=>!status||c.status===status).map(c=>c.id));return true;}
 if(name==='checks-resume'){try{activeChecksBatch=JSON.parse(sessionStorage.getItem('geo.checks.pending')||'null')}catch{}if(activeChecksBatch?.brandId===brand().id&&activeChecksBatch.scope===checksScope())await runChecksBatch();else toast('当前品牌没有待恢复的检查');return true;}
 if(name==='checks-stop'){checksStop=true;el.disabled=true;el.textContent='正在完成当前批…';return true;}
 return false;
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-checks-form]');if(!f)return;e.preventDefault();if(runtimeBusy)return;if(f.dataset.scope!==checksScope()){toast('工作区或品牌已切换，请重新打开');return;}
 if(!f.dataset.writingBudget&&!f.elements.confirmCost?.checked){f.querySelector('.form-error').textContent='请确认本批模型调用可能产生费用后再开始检查。';return;}
 if(f.elements.background?.checked&&!f.dataset.writingBudget){
  const error=f.querySelector('.form-error'),button=f.querySelector('button[type="submit"]'),payload=JSON.stringify({id:f.dataset.queueId,brandId:brand().id,kind:'check',checkKind:f.dataset.kind,name:(brand().name+' · '+({answer:'品牌感知检查',content:'内容质检',competitor:'竞品语义检查'}[f.dataset.kind])).slice(0,120),targetIds:f.dataset.ids.split(','),provider:f.elements.provider.value,onlyPending:f.elements.onlyPending.checked,semanticReviewVersion:f.dataset.kind==='content'?1:undefined,confirmCost:true});
  if(f.dataset.submitted&&f.dataset.submitted!==payload){error.textContent='上次入队结果尚待确认，请恢复原选项后重试，或前往任务中心核对。';return;}
  runtimeLock(true);button.disabled=true;error.textContent='';
  try{await runtimeFlush();if(f.dataset.scope!==checksScope())throw Error('工作区或品牌已切换，本批未入队');f.dataset.submitted=payload;const d=await apiRequest('/api/tasks',{method:'POST',body:payload});if(f.dataset.scope!==checksScope())throw Error('检查已返回，请回原工作区查看任务');runtimeLock(false);closeDrawer();if(d.skipped){toast(d.reason);return;}go('tasks');await refreshTasks();toast(d.existing?'已找回此前建立的检查任务':'检查已入队，后台执行器会逐批保存结果');}
  catch(err){if(err.status&&err.status<500&&err.status!==409)delete f.dataset.submitted;error.textContent=err.message;button.disabled=false;}
  finally{runtimeLock(false)}return;
 }
 const kind=f.dataset.kind,ids=f.dataset.ids.split(',').filter(id=>{const x=latestCheck(kind,id);return !f.elements.onlyPending.checked||!x||x.stale||x.record.parseError||!x.result||x.result.problems.length||kind==='content'&&x.record.input.version<3});
 if(!ids.length){toast('所选记录已有当前资料的检查结果，可取消跳过选项后重检');return;}
 activeChecksBatch={scope:checksScope(),owner:accessInfo.current.owner,brandId:brand().id,kind,provider:f.elements.provider.value,...(f.dataset.writingBudget?{writingBudgetId:f.dataset.writingBudget}:{}),next:0,groups:[]};const batchSize=kind==='competitor'?2:5;for(let n=0;n<ids.length;n+=batchSize)activeChecksBatch.groups.push({ids:ids.slice(n,n+batchSize),runId:crypto.randomUUID()});rememberChecks();await runChecksBatch();
});
