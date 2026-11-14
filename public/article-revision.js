/* AI revisions are explicit, single calls. A lost response is read back, never resubmitted. */
const articleRevisionPresets = [
 ['更清楚','保留原有事实和文章类型，把表达改得更清楚，让新读者容易理解。'],
 ['少些宣传','删掉重复宣传和空泛形容，用有依据的具体信息表达品牌特色。'],
 ['补足回答','检查是否回答了目标用户的问题，在已有依据范围内补足解释；缺资料时说明边界，不编造。']
];
function articleRevisionScope(f){
 try{
 const current=accessInfo?.current;
 return current?.owner&&f.dataset.brand?JSON.stringify([current.owner,current.actor||current.owner,sessionStorage.getItem('geo.workspace')||'',f.dataset.brand,f.dataset.id]):'';
 }catch{return '';}
}
function articleRevisionKey(f){return 'geo.article.revision.'+articleRevisionScope(f);}
function articleRevisionCurrent(f){return f.isConnected&&document.querySelector('[data-article-editor]')===f&&f.dataset.brand===brand().id&&f.revisionState?.scope===articleRevisionScope(f);}
function articleRevisionBuffer(f){return JSON.stringify(articleEditorValues(f));}
function articleRevisionMount(f,current){
 let attempt=null;try{const saved=JSON.parse(sessionStorage.getItem(articleRevisionKey(f))||'null');if(saved?.contentId===current.id&&typeof saved.runId==='string'&&saved.runId.length<=100)attempt={...saved,state:'unknown'};}catch{}
 const connection=serverConnections.find(item=>item.provider===current.provider)||serverConnections[0];
 f.revisionState={scope:articleRevisionScope(f),provider:connection?.provider||'',instruction:'',includeReviewSuggestions:true,plan:null,confirmed:false,pending:false,attempt,error:'',message:'',history:null,historyOpen:false};
 articleRevisionRender(f);
}
function articleRevisionRender(f){
 if(!articleRevisionCurrent(f))return;
 const r=f.revisionState,panel=f.querySelector('[data-article-revision-panel]'),record=own('contents').find(c=>c.id===f.dataset.id);
 if(!panel)return;
 if(!['owner','admin','editor'].includes(accessInfo.current.role)){panel.innerHTML='';return;}
 const blocked=r.pending||!!r.attempt,disabled=blocked?'disabled':'';
 const model=serverConnections.find(item=>item.provider===r.provider);
 let action='';
 if(r.attempt){
  const label={running:'原请求仍在处理。',ready:'修改稿已生成，正在等待保存。',conflict:'生成期间原稿或资料有变化，已保留修改稿，未覆盖原文。',failed:'这次没有获得可用稿件，请先核对模型账户用量。',missing:'未找到这次请求记录。未找到不代表没有费用，请先核对模型账户用量。',complete:'修改稿已保存。',unknown:'上次改稿结果还需要核对。'}[r.attempt.state]||'需要核对原请求。';
  action=`<p role="status">${label}</p><p class="helper">核对结果不会重新调用模型。</p><div class="form-actions"><button type="button" class="button small" data-article-revision-action="recover" ${r.pending?'disabled':''}>核对原结果</button>${r.attempt.state==='ready'?`<button type="button" class="button" data-article-revision-action="apply" ${r.pending?'disabled':''}>保存已生成稿</button>`:''}${r.attempt.checked&&['failed','conflict','complete','missing'].includes(r.attempt.state)?`<button type="button" class="button small" data-article-revision-action="finish" ${r.pending?'disabled':''}>结束本次改稿</button>`:''}</div>`;
 }else if(r.plan&&r.budget?.eligible&&r.budget.availableStages?.includes('revision')){
  action=`<div class="article-revision-plan"><p>本次改稿已包含在本篇计划内 · 最多 1 次调用</p><p class="helper">按你的要求生成一版，保留原稿；不会自动发布。</p><button type="button" class="button primary" data-article-revision-action="generate" ${r.pending?'disabled':''}>${r.pending?'正在改稿…':'用本篇额度改一版'}</button></div>`;
 }else if(r.plan){
  action=`<div class="article-revision-plan"><p>${esc(r.plan.model)} · 最多 1 次调用 · ${r.plan.facts?.length||0} 项已确认依据${r.plan.semanticSuggestions?.length?` · 参考 ${r.plan.semanticSuggestions.length} 条已定位的语义建议`:''}</p><p class="helper">${r.plan.estimatedInputTokens?`输入预算估算约 ${Number(r.plan.estimatedInputTokens).toLocaleString('zh-CN')} token，`:''}输出上限 ${Number(r.plan.maxOutputTokens||4000).toLocaleString('zh-CN')} token。${r.plan.provider==='ollama'?'使用本机模型，无服务费用。':'实际费用按你的模型服务计费。'}原稿会保留，修改稿需重新确认。</p><label class="distribution-confirm"><input type="checkbox" data-article-revision-cost ${r.confirmed?'checked':''} ${r.pending?'disabled':''}>${r.plan.provider==='ollama'?'确认使用本机模型':'同意本次模型调用费用'}</label><button type="button" class="button primary" data-article-revision-action="generate" ${r.confirmed&&!r.pending?'':'disabled'}>${r.pending?'正在改稿…':r.plan.provider==='ollama'?'改一版':'确认费用，改一版'}</button></div>`;
 }else action=model?`<button type="button" class="button" data-article-revision-action="preview" ${r.pending?'disabled':''}>${r.pending?'正在准备…':'查看改稿计划'}</button>`:`<a href="#integrations" class="button small" data-article-revision-action="configure">连接写作模型</a><span class="helper">只需配置一次，使用你自己的模型账号。</span>`;
 const versions=record?.revisionHistory||[];
 const history=r.history?`<details class="article-revision-history" open><summary>${r.history.output?'已保留的修改稿':'改稿前的原文'}</summary><h4>${esc(r.history.value?.title||'')}</h4><pre>${esc(r.history.value?.text||'')}</pre><button type="button" class="button small" data-article-revision-action="load-version" ${r.pending?'disabled':''}>载入编辑区</button><span class="helper">载入后仍需保存和确认。</span></details>`:'';
 panel.innerHTML=`<section class="article-revision" aria-label="AI 改稿"><details data-article-revision-open ${r.open||r.attempt||r.error?'open':''}><summary>AI 帮我改稿<span>说一句怎么改，原稿自动保留</span></summary><div class="article-revision-body"><div class="article-revision-presets">${articleRevisionPresets.map(([label,instruction])=>`<button type="button" class="button small" data-article-revision-preset="${esc(instruction)}" ${disabled}>${label}</button>`).join('')}</div><label class="field">修改要求<textarea data-article-revision-instruction rows="2" maxlength="1000" placeholder="例如：开头直接回答问题，保留案例，把宣传语换成具体事实。" ${disabled}>${esc(r.instruction)}</textarea></label><details class="article-revision-settings"><summary>模型与修改选项</summary><label class="field">写作模型<select data-article-revision-provider ${disabled}>${serverConnections.map(item=>`<option value="${esc(item.provider)}" ${item.provider===r.provider?'selected':''}>${esc(item.model)} · ${esc(item.provider)}</option>`).join('')}</select></label><label class="distribution-confirm"><input type="checkbox" data-article-revision-review ${r.includeReviewSuggestions?'checked':''} ${disabled}>参考当前有效的基础与语义检查建议</label>${record?.writingBudgetId&&!r.budgetCanceled?`<button type="button" class="button small" data-article-revision-action="cancel-budget" ${disabled}>取消本篇未使用额度</button><p class="helper">只停止后续模型调用，保留原稿和已有结果。</p>`:''}</details><div data-article-revision-plan>${action}</div><p class="form-error" role="alert">${esc(r.error)}</p></div></details>${r.message?`<p role="status">${esc(r.message)}</p>`:''}${versions.length?`<details class="article-revision-versions"><summary>改稿历史（${versions.length}）</summary>${versions.slice().reverse().map(item=>`<button type="button" class="button small" data-article-revision-history="${esc(item.runId)}" ${r.pending?'disabled':''}>查看原稿 · ${esc(item.createdAt?new Date(item.createdAt).toLocaleString('zh-CN'):'已保存版本')}</button>`).join('')}</details>`:''}${history}</section>`;
}
function articleRevisionInvalidate(f){const r=f.revisionState;if(!r||r.attempt||r.pending)return;const hadPlan=!!r.plan;r.plan=null;r.confirmed=false;r.error='';if(hadPlan){const box=f.querySelector('[data-article-revision-plan]');if(box)box.innerHTML='<button type="button" class="button" data-article-revision-action="preview">重新查看改稿计划</button>';}}
function articleRevisionLock(f,locked){
 const r=f.revisionState;r.pending=locked;
 if(locked){r.controls=[...f.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);for(const [el] of r.controls)el.disabled=true;r.ownsRuntimeLock=true;runtimeLock(true);}
 else {for(const [el,disabled] of r.controls||[])if(el.isConnected)el.disabled=disabled;r.controls=[];}
 if(!locked&&r.ownsRuntimeLock){if(articleRevisionCurrent(f))runtimeLock(false);r.ownsRuntimeLock=false;}
 articleRevisionRender(f);if(!locked&&articleRevisionCurrent(f))distributionUpdate(f);
}
function articleRevisionRemember(f,runId){
 const value=JSON.stringify({runId,contentId:f.dataset.id});
 if(!f.revisionState.scope)throw Error('无法确认当前工作区，请重新打开稿件。');
 try{sessionStorage.setItem(articleRevisionKey(f),value);if(sessionStorage.getItem(articleRevisionKey(f))!==value)throw Error();}catch{throw Error('无法保存本次请求记录，尚未调用模型。请恢复浏览器存储后再试。');}
 f.revisionState.attempt={runId,contentId:f.dataset.id,state:'unknown',checked:false};
}
function articleRevisionForget(f){sessionStorage.removeItem(articleRevisionKey(f));f.revisionState.attempt=null;f.revisionState.plan=null;f.revisionState.confirmed=false;}
function articleRevisionAccept(f,data){
 const r=f.revisionState,run=data.run;
 if(!run||run.id!==r.attempt?.runId||run.brandId!==f.dataset.brand||run.contentId!==f.dataset.id)throw Error('返回记录不属于本次稿件，已停止处理。');
 r.attempt.state=run.state;r.attempt.checked=true;
 if(run.state==='complete'){
  const record=data.state?.contents?.find(c=>c.id===f.dataset.id&&c.brandId===f.dataset.brand);
  if(!record)throw Error('未找到已保存稿件，请核对原结果。');
  if(r.resultDirty||articleRevisionBuffer(f)!==r.resultBuffer||JSON.stringify(state)!==r.resultState||pendingSnapshot){r.history={output:true,value:data.after||record};throw Error('修改稿已保存，但当前页面有其他修改；请先保存或导出当前内容，再重新载入。');}
  state=data.state;serverRevision=data.revision;
  f.elements.title.value=record.title;f.elements.text.value=record.text;f.elements.articleAi.checked=!!record.ai;
  f.savedTitle=record.title;f.savedText=record.text;f.savedAi=!!record.ai;
  f.querySelector('[data-article-workflow]').innerHTML=badge(record.status);distributionInvalidate(f);articleEditorRefresh(f);
  r.history=null;r.message='修改稿已保存，原稿保留在改稿历史。确认内容后即可勾选平台发布。';articleRevisionForget(f);
 }else if(run.state==='conflict'&&data.after){r.history={output:true,value:data.after};}
 else if(run.state==='failed')r.error=run.error||'未生成可用正文，不会自动再次调用模型。';
}
async function articleRevisionRequest(f,action){
 if(!articleRevisionCurrent(f)||runtimeBusy||f.revisionState.pending||f.distributionBusy)return;
 const r=f.revisionState;
 if(action==='cancel-budget'){
  const record=own('contents').find(c=>c.id===f.dataset.id&&c.brandId===f.dataset.brand);if(r.attempt||!record?.writingBudgetId)return;
  try{articleRevisionLock(f,true);await apiRequest('/api/writing-budget/cancel',{method:'POST',body:JSON.stringify({id:record.writingBudgetId})});if(articleRevisionCurrent(f)){r.budget=null;r.budgetCanceled=true;r.plan=null;r.confirmed=false;r.message='本篇未使用额度已取消，已有稿件和结果保留。';}}
  catch(error){r.error=error.message;}finally{articleRevisionLock(f,false);}return;
 }
 if(action==='preview'){
  if(r.attempt)return;
  r.error='';r.plan=null;r.confirmed=false;
  if(!r.instruction.trim()){r.error='选一个修改方向，或写一句你想怎么改。';r.open=true;articleRevisionRender(f);return;}
  if(!serverConnections.some(item=>item.provider===r.provider)){r.error='先连接自己的写作模型，再改稿。';articleRevisionRender(f);return;}
  try{
   r.pending=true;articleRevisionRender(f);
   if(articleEditorDirty()||f.dataset.new==='true'){const saved=await articleEditorSave('save',{reopen:false});if(!saved)throw Error('请先处理稿件保存问题，再改稿。');}
   await runtimeFlush();if(!articleRevisionCurrent(f))return;
   articleRevisionLock(f,true);
   const savedArticle=own('contents').find(c=>c.id===f.dataset.id&&c.brandId===f.dataset.brand);
   r.planInput={brandId:f.dataset.brand,contentId:f.dataset.id,provider:r.provider,instruction:r.instruction,includeReviewSuggestions:r.includeReviewSuggestions,...(savedArticle?.writingBudgetId?{writingBudgetId:savedArticle.writingBudgetId}:{})};
   r.planBuffer=articleRevisionBuffer(f);
   const data=await apiRequest('/api/article-revision/preview',{method:'POST',body:JSON.stringify(r.planInput)});
   if(articleRevisionCurrent(f)){r.plan=data.plan;r.budget=data.budget?.provider===r.provider&&data.budget.eligible&&data.budget.availableStages?.includes('revision')?data.budget:null;if(!r.budget)delete r.planInput.writingBudgetId;r.confirmed=!!r.budget;}
  }catch(error){r.error=error.message;}finally{articleRevisionLock(f,false);}return;
 }
 if(!['generate','recover','apply'].includes(action))return;
 if(action==='generate'&&(r.attempt||!r.plan||!r.confirmed))return;
 if(action!=='generate'&&!r.attempt)return;
 try{
  r.error='';
  if(action==='generate'&&r.planBuffer!==articleRevisionBuffer(f))throw Error('稿件已变化，请重新查看改稿计划。');
  r.pending=true;articleRevisionRender(f);
  await runtimeFlush();if(!articleRevisionCurrent(f))return;
  articleRevisionLock(f,true);r.resultBuffer=articleRevisionBuffer(f);r.resultState=JSON.stringify(state);r.resultDirty=articleEditorDirty();
  if(action==='generate')articleRevisionRemember(f,uid());
  articleRevisionRender(f);
  const runId=r.attempt.runId;
  const data=action==='recover'?await apiRequest('/api/article-revision/result?'+new URLSearchParams({brandId:f.dataset.brand,runId}),{method:'GET'}):await apiRequest('/api/article-revision/'+action,{method:'POST',body:JSON.stringify(action==='generate'?{...r.planInput,runId,previewHash:r.plan.previewHash,...(r.budget?{}:{confirmCost:true})}:{brandId:f.dataset.brand,runId})});
  if(articleRevisionCurrent(f))articleRevisionAccept(f,data);
 }catch(error){if(action==='recover'&&error.status===404&&r.attempt){r.attempt.state='missing';r.attempt.checked=true;}r.error=r.attempt?'本次结果需要核对，不会自动重新调用模型。'+error.message:error.message;r.confirmed=false;}
 finally{articleRevisionLock(f,false);}
}
async function articleRevisionHistory(f,runId){
 const r=f.revisionState;if(r.pending||runtimeBusy)return;
 try{articleRevisionLock(f,true);const data=await apiRequest('/api/article-revision/result?'+new URLSearchParams({brandId:f.dataset.brand,runId}),{method:'GET'});
  if(!articleRevisionCurrent(f))return;
  if(data.run?.contentId!==f.dataset.id||data.run?.brandId!==f.dataset.brand||data.run?.id!==runId||!data.before)throw Error('没有找到这篇文章的原稿。');
  r.history={output:false,value:data.before};r.error='';
 }catch(error){r.error=error.message;}finally{articleRevisionLock(f,false);}
}
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-article-editor]');if(!f||!articleRevisionCurrent(f))return;
 const r=f.revisionState,b=e.target.closest('[data-article-revision-action],[data-article-revision-preset],[data-article-revision-history]');if(!b||r.pending||runtimeBusy)return;
 if(b.hasAttribute('data-article-revision-preset')){if(r.attempt)return;r.instruction=b.dataset.articleRevisionPreset;r.plan=null;r.confirmed=false;r.open=true;articleRevisionRender(f);return;}
 if(b.hasAttribute('data-article-revision-history')){await articleRevisionHistory(f,b.dataset.articleRevisionHistory);return;}
 const action=b.dataset.articleRevisionAction;
 if(action==='configure'){e.preventDefault();if(articleEditorDirty()||f.dataset.new==='true'){const saved=await articleEditorSave('save',{reopen:false});if(!saved)return;}closeDrawer();go('integrations');return;}
 if(action==='finish'){if(!r.attempt?.checked)return;articleRevisionForget(f);r.error='';articleRevisionRender(f);return;}
 if(action==='load-version'&&r.history){if(articleEditorDirty()&&!confirm('用这个版本替换当前未保存的编辑内容？'))return;const value=r.history.value;f.elements.title.value=value.title;f.elements.text.value=value.text;f.elements.articleAi.checked=!!value.ai;distributionInvalidate(f);articleEditorRefresh(f);r.plan=null;r.confirmed=false;r.message='已载入编辑区，保存后会作为待确认稿件。';articleRevisionRender(f);return;}
 await articleRevisionRequest(f,action);
});
document.addEventListener('input',e=>{
 const f=e.target.closest('[data-article-editor]');if(!f?.revisionState||f.revisionState.pending)return;
 if(e.target.matches('[data-article-revision-instruction]')){f.revisionState.instruction=e.target.value;articleRevisionInvalidate(f);}
 else if(['title','text'].includes(e.target.name)&&f.revisionState.plan){articleRevisionInvalidate(f);articleRevisionRender(f);}
});
document.addEventListener('change',e=>{
 const f=e.target.closest('[data-article-editor]');if(!f?.revisionState||f.revisionState.pending)return;const r=f.revisionState;
 if(e.target.matches('[data-article-revision-cost]')){r.confirmed=e.target.checked;articleRevisionRender(f);return;}
 if(e.target.matches('[data-article-revision-provider]'))r.provider=e.target.value;
 else if(e.target.matches('[data-article-revision-review]'))r.includeReviewSuggestions=e.target.checked;
 else if(e.target.name!=='articleAi')return;
 r.plan=null;r.confirmed=false;articleRevisionRender(f);
});
document.addEventListener('toggle',e=>{if(!e.target.matches?.('[data-article-revision-open]')||!e.target.isConnected)return;const f=e.target.closest('[data-article-editor]');if(f?.revisionState)f.revisionState.open=e.target.open;},true);
