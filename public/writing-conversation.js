/* A guided, explicit-cost writing conversation. It never sends a model request until the user asks for one. */
let writingConversationState=null;
const writingRecoveryMemory=new Map();
let writingRequestCount=0;

function writingScope(){
 try{
  const owner=accessInfo?.current?.owner,actor=accessInfo?.current?.actor||owner,brandId=brand().id;
  if(!owner||!brandId)return null;
  return {owner,actor,workspace:sessionStorage.getItem('geo.workspace')||'',brandId};
 }catch{return null;}
}

function writingScopeKey(scope){return scope?'geo.writing.pending.'+JSON.stringify([scope.owner,scope.actor,scope.workspace,scope.brandId]):'';}
function writingIsCurrent(current){
 const drawer=document.getElementById('drawer'),surface=document.getElementById('drawer-body')?.querySelector('[data-writing-conversation]');
 return !!current&&writingConversationState===current&&!!current.scope&&writingScopeKey(current.scope)===writingScopeKey(writingScope())&&!!drawer?.open&&surface?.dataset.writingConversation===current.viewId;
}
function writingBlocked(current){return !!current.pending||!!current.attempt;}
function writingRequestLock(locked){writingRequestCount+=locked?1:-1;runtimeLock(writingRequestCount>0);}
function writingRecoveryRecord(current){
 const attempt=current.attempt;
 return {runId:attempt.runId,kind:attempt.kind,questionId:attempt.questionId,...(attempt.proposalId?{proposalId:attempt.proposalId,directionId:attempt.directionId}:{})};
}
function writingReadRecovery(scope){
 const key=writingScopeKey(scope);if(!key)return null;
 let record=writingRecoveryMemory.get(key);
 try{record=JSON.parse(sessionStorage.getItem(key)||'null')||record;}catch{}
 if(!record||typeof record.runId!=='string'||!record.runId||record.runId.length>100||!['plan','generate'].includes(record.kind)||typeof record.questionId!=='string')return null;
 return {...record,status:'unknown',checked:false};
}
function writingSaveRecovery(current){
 const key=writingScopeKey(current.scope),record=writingRecoveryRecord(current),value=JSON.stringify(record);
 if(!key)return false;
 try{sessionStorage.setItem(key,value);if(sessionStorage.getItem(key)!==value)return false;writingRecoveryMemory.set(key,record);return true;}catch{return false;}
}
function writingClearRecovery(current){
 const key=writingScopeKey(current.scope),runId=current.attempt?.runId;
 if(writingRecoveryMemory.get(key)?.runId===runId)writingRecoveryMemory.delete(key);
 try{if(JSON.parse(sessionStorage.getItem(key)||'null')?.runId===runId)sessionStorage.removeItem(key);}catch{}
 current.attempt=null;
}
function writingStartAttempt(current,kind){
 const key=kind==='plan'?'runId':'draftRunId';
 current[key]||=uid();
 current.attempt={runId:current[key],kind,questionId:current.questionId,...(kind==='generate'?{proposalId:current.proposal.id,directionId:current.selected.id}:{}),status:'unknown',checked:false};
 if(writingSaveRecovery(current))return true;
 current.attempt=null;current.error='浏览器暂时无法保存请求编号，本次尚未调用模型。请恢复浏览器存储后再试，以便中断时核对原结果。';return false;
}
function writingUnknown(current,error){
 current.error='这次请求的结果尚未确认，可能已经产生模型费用。请先核对已保存结果；核对只读取记录，不会再次调用模型。'+(error?.message?'（'+error.message+'）':'');
 if(current.attempt){current.attempt.status='unknown';current.attempt.checked=false;}
 current.costConfirmed=false;current.draftCostConfirmed=false;
}
function writingRecoveryHtml(current){
 if(!current.attempt)return '';
 const attempt=current.attempt,status=attempt.status==='running'?'服务端仍在处理，请稍后再次核对。':attempt.status==='failed'?'服务端记录未成功完成，请核对供应商用量后再决定是否重新开始。':attempt.status==='missing'?'服务端暂未找到这个请求。未找到不代表没有产生费用；不会自动重新发送。':'发现一次尚待核对的写作请求。';
 return `<section class="writing-message writing-message-assistant" aria-live="polite"><p>${status} 核对过程不会调用模型。</p><p class="helper">请求编号：${esc(attempt.runId)}</p><div class="form-actions"><button type="button" class="button primary" data-action="writing-recover" ${current.pending?'disabled':''}>${current.pending?'正在处理…':'核对已保存结果'}</button>${attempt.checked&&attempt.status!=='running'?`<button type="button" class="button small" data-action="writing-new-run" ${current.pending?'disabled':''}>核对后，重新开始一次</button>`:''}</div></section>`;
}

const writingChoices=GEO_CONTENT_OPTIONS.WRITING_CHOICES;
const writingKnownChoice=(key,value)=>GEO_CONTENT_OPTIONS.isContentOption(key,value);

function writingQuestions(topic=''){
 return own('questions').filter(question=>question.brandId===brand().id&&(!topic||question.topic===topic));
}

function writingChoiceRow(key,label,value){
 const historical=!writingChoices[key].includes(value)&&writingKnownChoice(key,value),options=historical?[value,...writingChoices[key]]:writingChoices[key];
 return `<div class="writing-choice-row"><span>${esc(label)}</span><div class="writing-choice-options">${options.map(option=>`<button type="button" class="button small ${value===option?'selected':''}" data-action="writing-choice" data-writing-key="${key}" data-writing-value="${esc(option)}" aria-pressed="${value===option}" ${writingBlocked(writingConversationState)?'disabled':''}>${esc(option)}${historical&&option===value?'（历史选项）':''}</button>`).join('')}</div></div>`;
}

function writingDirection(direction,index){
 const evidence=direction.evidenceNeed?.length?`<p class="writing-evidence"><b>写前仍需核对</b>${direction.evidenceNeed.map(item=>`<span>${esc(item)}</span>`).join('')}</p>`:'<p class="writing-evidence muted">当前没有额外待核对项；生成时仍只会使用已确认事实。</p>';
 return `<article class="writing-direction"><div class="writing-direction-number">${String(index+1).padStart(2,'0')}</div><div class="writing-direction-body"><h3>${esc(direction.title)}</h3><p>${esc(direction.angle)}</p>${direction.reader?`<p class="writing-reader">面向：${esc(direction.reader)}</p>`:''}<ol>${direction.outline.map(item=>`<li>${esc(item)}</li>`).join('')}</ol>${evidence}<button type="button" class="button small" data-action="writing-select-direction" data-direction-id="${esc(direction.id)}" ${writingBlocked(writingConversationState)?'disabled':''}>选择这个方向</button></div></article>`;
}

function resetWritingSuggestion(current,{keepProposal=false,keepInstruction=false}={}){
 current.plan=null;current.planInput=null;current.costConfirmed=false;if(!keepProposal)current.proposal=null;if(!keepInstruction)current.instruction='';current.selected=null;current.draftPlan=null;current.draftCostConfirmed=false;current.runId='';current.draftRunId='';
}
function writingDirectionInput(current){
 return {brandId:current.scope.brandId,questionId:current.questionId,provider:current.provider,goal:current.goal,format:current.format,tone:current.tone,instruction:current.instruction||'',previousProposalId:current.proposal?.id||''};
}
function writingInstructionHtml(current){
 return `<label class="writing-question writing-instruction">${current.proposal?'想怎样调整这些方向？':'想重点写什么？（可选）'}<textarea data-writing-instruction aria-label="补充写作要求" rows="3" maxlength="1000" placeholder="例如：突出品牌特色，用新用户能理解的语言，先回答大家最关心的问题" ${writingBlocked(current)?'disabled':''}>${esc(current.instruction||'')}</textarea><span class="helper">个人、产品和企业使用同一套选项；具体方向根据当前品牌资料生成。</span></label>`;
}

function writingBudgetSummary(plan){
 return `<p>本篇包含：4 个方向、完整草稿、文章质检、改一版，各最多 1 次；总计最多 ${plan.maxModelCalls} 次模型调用。</p><p class="helper">${plan.estimatedMaxCny===null?'尚未配置单价，金额无法估计':`按当前单价保守估算约 ¥${Number(plan.estimatedMaxCny).toFixed(4)}，以供应商账单为准`}。仅在你点击对应步骤时执行，不包含发布；${plan.validHours/24} 天内有效。超出计划或配置变化后另行确认。</p><details><summary>查看额度与计费说明</summary><p class="helper">本篇输入请求合计最多 ${Number(plan.maxInputBytes).toLocaleString('zh-CN')} UTF-8 字节（含预留），输出请求上限合计 ${Number(plan.maxOutputTokens).toLocaleString('zh-CN')} token。输入 token 与费用是估算，不是账单保证；供应商须支持输出上限。不自动重试；结果未知时保留占用额度。</p></details>`;
}
function writingDraftIncluded(current){return !!current.draftBudget?.eligible&&current.draftBudget.availableStages?.includes('draft');}
function writingSuggestionPlan(current,hasConnection){
 if(current.attempt)return '';
 if(current.proposal?.directions?.length&&!current.plan)return `<div class="writing-call"><div><b>保留当前方向，再按你的想法调整</b><p>先免费查看调整计划。只有你确认新调用费用后，才会生成新的 4 个方向。</p></div><button type="button" class="button" data-action="writing-preview" ${hasConnection&&!current.pending?'':'disabled'}>查看调整计划</button></div>`;
 if(!current.plan)return `<div class="writing-call"><div><b>先看本次建议计划</b><p>免费核对问题、已确认资料和模型；确认后才会调用模型给出 4 个方向。</p></div><button type="button" class="button primary" data-action="writing-preview" ${hasConnection&&!current.pending?'':'disabled'}>${current.pending?'正在准备计划…':'查看建议计划'}</button></div>`;
 const plan=current.plan;
 if(current.articleBudget&&current.wholeBudget!==false)return `<section class="writing-cost-plan"><b>本篇写作计划 · 一次确认</b>${writingBudgetSummary(current.articleBudget)}<label class="auto-option"><input type="checkbox" data-writing-cost-confirm ${current.costConfirmed?'checked':''} ${current.pending?'disabled':''}>我确认本篇有限计划由自己的模型账号计费</label><button type="button" class="button primary" data-action="writing-suggest" ${current.costConfirmed&&!current.pending?'':'disabled'}>${current.pending?'正在整理方向…':'确认本篇费用，获取 4 个方向'}</button><button type="button" class="button small" data-action="writing-single-step" ${current.pending?'disabled':''}>改为每步确认费用</button></section>`;
 return `<section class="writing-cost-plan"><div><b>${current.proposal?'本次方向调整计划':'本次方向建议计划'}</b><p>${esc(plan.model)} · 已确认资料 ${plan.facts.length} 项 · 最多 ${plan.maxModelCalls} 次模型调用</p>${plan.refinement?.instruction?`<p>本次要求：${esc(plan.refinement.instruction)}</p>`:''}<p class="helper">只生成 4 个方向，不生成文章、不发布，也不会自动重试或定时调用。${current.proposal?'新结果返回前保留当前方向。':''}</p></div><label class="auto-option"><input type="checkbox" data-writing-cost-confirm ${current.costConfirmed?'checked':''} ${current.pending?'disabled':''}>我确认本次调用由我的模型账号计费</label><div class="form-actions"><button type="button" class="button primary" data-action="writing-suggest" ${current.costConfirmed&&!current.pending?'':'disabled'}>${current.pending?'正在整理方向…':'确认费用，获取 4 个方向'}</button><button type="button" class="button small" data-action="writing-preview" ${current.pending?'disabled':''}>重新查看计划</button></div></section>`;
}

function writingDraftPlan(current){
 if(current.attempt)return '';
 if(!current.draftPlan)return `<div class="writing-call"><div><b>先看完整草稿计划</b><p>免费核对所选方向、当前资料和模型；确认后才会生成一篇待审核草稿。</p></div><button type="button" class="button primary" data-action="writing-draft-preview" ${current.pending?'disabled':''}>查看草稿计划</button></div>`;
 const plan=current.draftPlan;
 if(writingDraftIncluded(current))return `<section class="writing-cost-plan"><b>完整草稿已包含在本篇计划内</b><p>${esc(plan.model)} · 本阶段最多 1 次调用，不再重复确认费用。</p><p class="helper">点击后才开始生成；不会自动质检、改稿或发布。</p><button type="button" class="button primary" data-action="writing-generate-draft" ${current.pending?'disabled':''}>${current.pending?'正在生成草稿…':'生成完整草稿'}</button><button type="button" class="button small" data-action="writing-budget-cancel" ${current.pending?'disabled':''}>取消本篇剩余额度</button></section>`;
 return `<section class="writing-cost-plan"><div><b>本次完整草稿计划</b><p>${esc(plan.model)} · 已确认资料 ${plan.facts.length} 项 · 最多 ${plan.maxModelCalls} 次模型调用</p><p class="helper">只创建一篇待审核草稿；不发布、不自动重试，也不会启用后台定时写稿。</p></div><label class="auto-option"><input type="checkbox" data-writing-draft-cost-confirm ${current.draftCostConfirmed?'checked':''} ${current.pending?'disabled':''}>我确认本次生成由我的模型账号计费</label><div class="form-actions"><button type="button" class="button primary" data-action="writing-generate-draft" ${current.draftCostConfirmed&&!current.pending?'':'disabled'}>${current.pending?'正在生成草稿…':'确认费用，生成完整草稿'}</button><button type="button" class="button small" data-action="writing-draft-preview" ${current.pending?'disabled':''}>重新查看计划</button></div></section>`;
}

function writingQuestionSource(question){
 if(typeof questionSourceInfo==='function')return questionSourceInfo(question).label;
 if(typeof GEO_QUESTION_IMPORT!=='undefined'&&typeof GEO_QUESTION_IMPORT.questionProvenanceView==='function')return GEO_QUESTION_IMPORT.questionProvenanceView(question,state.questionDiscoveries||[]).label;
 if(question?.demo===true)return '演示问题';
 const discovery=(state.questionDiscoveries||[]).find(item=>item.brandId===question?.brandId&&item.id===question?.discoveryId);
 const candidate=discovery?.candidates?.find(item=>item.id===question.candidateId);
 if(candidate)return candidate.text===question.text?'AI 生成的候选问题':'AI 候选修改后的问题';
 return '当前品牌问题库（原始来源未标注）';
}

function writingConversationHtml(){
 const current=writingConversationState,questions=writingQuestions(current.topic),chosenQuestion=questions.find(question=>question.id===current.questionId)||questions[0],connection=serverConnections.find(item=>item.provider===current.provider)||serverConnections[0],hasConnection=!!connection;
 if(!current.attempt&&!current.proposal&&chosenQuestion&&chosenQuestion.id!==current.questionId)current.questionId=chosenQuestion.id;
 if(!current.attempt&&!current.proposal&&connection&&connection.provider!==current.provider)current.provider=connection.provider;
 const setupNotice=!hasConnection?`<div class="writing-message writing-message-assistant"><p>还没有连接写作模型。先完成一次模型配置，之后这里会保留你的文章组合和问题选择。</p><a class="button primary" href="#integrations" data-close>连接写作模型</a></div>`:'';
 const questionControl=questions.length?`<label class="writing-question">围绕哪个用户问题？<select data-writing-question aria-label="选择用户问题" ${writingBlocked(current)?'disabled':''}>${questions.map(question=>`<option value="${esc(question.id)}" ${question.id===current.questionId?'selected':''}>${esc(question.text)} · ${esc(question.topic||'未分组')}</option>`).join('')}</select><span class="helper" data-writing-question-source>来源：${esc(writingQuestionSource(chosenQuestion))}。搜索量数据未接入，不代表高频搜索问题。</span></label>${typeof questionSourceDetails==='function'?questionSourceDetails(chosenQuestion,{summary:'问题是怎么来的？',allowReceipt:false}):'<details class="writing-question-help"><summary>问题是怎么来的？</summary><p class="helper">来源详情尚未加载，请刷新后核对。选择问题不会调用模型，也不会检索真实搜索量。</p></details>'}`:`<div class="writing-message writing-message-assistant"><p>${current.topic?`“${esc(current.topic)}”还没有可用问题。`:'还没有可用的客户问题。'}先建立问题库，再让 AI 结合真实资料提供方向。</p><a class="button" href="#monitor" data-close>管理客户问题</a></div>`;
 const combination=questions.length?`<section class="writing-combination" aria-label="文章组合">${writingChoiceRow('goal','这篇文章的目标',current.goal)}${writingInstructionHtml(current)}<details class="writing-preferences" data-writing-preferences ${current.preferencesOpen?'open':''}><summary>文章类型与表达（${current.format==='AI 推荐'&&current.tone==='AI 推荐'?'自动推荐，可修改':esc(current.format)+' · '+esc(current.tone)}）</summary><p class="helper">可以直接使用 AI 推荐：模型按品牌资料和用户问题选择写法；这里指文章写法，不是品牌已获得 AI 推荐。</p>${writingChoiceRow('format','文章类型',current.format)}${writingChoiceRow('tone','表达方式',current.tone)}</details><label class="writing-question">使用模型<select data-writing-provider aria-label="选择写作模型" ${writingBlocked(current)?'disabled':''}>${serverConnections.map(item=>`<option value="${esc(item.provider)}" ${item.provider===current.provider?'selected':''}>${esc(item.provider)} · ${esc(item.model)}</option>`).join('')}</select></label><div data-writing-suggestion-plan>${writingSuggestionPlan(current,hasConnection)}</div><p class="helper">方向建议与完整草稿是两次独立调用；每次都由你主动开始，不会每天自动消耗 token。</p></section>`:'';
 let result='';
 if(current.error)result+=`<div class="writing-message writing-message-error" role="alert"><p>${esc(current.error)}</p></div>`;
 if(current.proposal?.directions?.length){const options=current.proposal.options||current;result+=`${current.proposal.refinement?.instruction?`<div class="writing-message writing-message-user"><p>${esc(current.proposal.refinement.instruction)}</p></div>`:''}<div class="writing-message writing-message-assistant"><p>已按“${esc(options.goal)} · ${esc(options.format)} · ${esc(options.tone)}”整理出 4 个可选方向。请选择一个，再决定是否生成完整草稿。</p></div><section class="writing-directions">${current.proposal.directions.map(writingDirection).join('')}</section>`;}
 if(current.selected){const direction=current.selected;result+=`<section data-writing-selected><div class="writing-message writing-message-user"><p>我选择：<b>${esc(direction.title)}</b></p></div><div class="writing-message writing-message-assistant"><p>${current.attempt?'这次写作请求已发出，请先核对结果。':'选择方向不会调用模型。先确认完整草稿计划，再由你决定是否调用模型。'}</p>${writingDraftPlan(current)}<div class="form-actions"><button type="button" class="button" data-action="writing-clear-direction" ${writingBlocked(current)?'disabled':''}>换一个方向</button></div><p class="helper">生成结果进入“内容管理”，不会直接对外发布。</p></div></section>`;}
 return `<div class="writing-conversation" data-writing-conversation="${esc(current.viewId)}"><section class="writing-message writing-message-assistant"><h3>先选文章方向</h3><p>先选通用目标，其余可以交给 AI。具体选题会根据品牌资料、用户问题和现有依据生成，选定方向后再写完整草稿。</p></section>${writingRecoveryHtml(current)}${questionControl}${combination}${setupNotice}${result}</div>`;
}

function renderWritingConversation(){
 const body=document.getElementById('drawer-body');
 if(!writingIsCurrent(writingConversationState)||!body)return;
 body.innerHTML=writingConversationHtml();
}

function openWritingConversation(options={}){
 if(writingConversationState?.pending&&writingIsCurrent(writingConversationState))return;
 const scope=writingScope(),attempt=writingReadRecovery(scope),questions=writingQuestions(options.topic||'');
 if(!questions.length&&!attempt){
  openDrawer('AI 对话选方向',`<p>${options.topic?`“${esc(options.topic)}”`:'当前品牌'}还没有可用于写作的客户问题。</p><p>先把客户会怎样提问记录下来，AI 才能围绕具体业务问题提供方向。</p><a class="button primary" href="#monitor" data-close>去管理问题</a>`,'内容创作');
  return;
 }
 const selected=questions.find(question=>question.id===options.questionId)||questions[0],connection=(!attempt&&serverConnections.find(item=>item.provider===options.provider))||serverConnections[0];
 writingConversationState={scope,viewId:uid(),attempt,topic:attempt?'':options.topic||'',questionId:attempt?.questionId||selected?.id||'',provider:connection?.provider||'',goal:writingChoices.goal[0],format:writingChoices.format[0],tone:writingChoices.tone[0],instruction:'',preferencesOpen:false,plan:null,planInput:null,costConfirmed:false,proposal:null,selected:null,draftPlan:null,draftCostConfirmed:false,pending:false,error:scope?'':'无法确认当前登录或工作区，请重新连接后再发起写作。',runId:attempt?.kind==='plan'?attempt.runId:'',draftRunId:attempt?.kind==='generate'?attempt.runId:''};
 openDrawer('AI 对话选方向',writingConversationHtml(),'内容创作');
}

function selectedDirection(){
 const current=writingConversationState;
 return current?.proposal?.directions?.find(direction=>direction.id===current.selected?.id)||null;
}

async function requestWritingPreview(){
 const current=writingConversationState;if(!writingIsCurrent(current)||writingBlocked(current))return;
 if(!current.questionId||!current.provider){current.error='请先选择一个客户问题和已连接模型。';renderWritingConversation();return;}
 const input=writingDirectionInput(current);
 if(input.instruction.length>1000){current.error='补充要求请控制在 1000 字以内。';renderWritingConversation();return;}
 current.pending=true;current.error='';resetWritingSuggestion(current,{keepProposal:true,keepInstruction:true});renderWritingConversation();writingRequestLock(true);
 try{
  await runtimeFlush();
  if(!writingIsCurrent(current))return;
  const data=await apiRequest('/api/content-conversation/preview',{method:'POST',body:JSON.stringify(input)});
  if(writingIsCurrent(current)){current.plan=data.plan;current.planInput=input;current.articleBudget=data.articleBudget||null;current.wholeBudget=true;current.budgetApprovalId=uid();}
 }catch(error){current.error=error.message;}
 finally{current.pending=false;writingRequestLock(false);if(writingIsCurrent(current))renderWritingConversation();}
}

function writingApplyProposal(current,proposal){
 if(!proposal||proposal.id!==current.attempt?.runId||proposal.brandId!==current.scope.brandId||proposal.questionId!==current.attempt.questionId)throw new Error('返回的方向不属于本次请求，请继续核对原记录。');
 if(proposal.parseError||!Array.isArray(proposal.directions)||proposal.directions.length!==4||proposal.directions.some(direction=>!direction?.id||typeof direction.title!=='string'||!Array.isArray(direction.outline)))throw new Error(proposal.parseError||'已保存结果缺少完整的 4 个方向。');
 current.proposal=proposal;current.writingBudgetId=proposal.writingBudgetId||'';current.questionId=proposal.questionId;current.topic='';current.provider=proposal.provider||current.provider;
 for(const key of ['goal','format','tone'])if(writingKnownChoice(key,proposal.options?.[key]))current[key]=proposal.options[key];
 current.runId=proposal.id;current.plan=null;current.planInput=null;current.instruction='';current.selected=null;current.draftPlan=null;current.draftCostConfirmed=false;current.draftRunId='';current.costConfirmed=false;current.error='';writingClearRecovery(current);
}

async function requestWritingDirections(){
 const current=writingConversationState;if(!writingIsCurrent(current)||writingBlocked(current))return;
 if(!current.plan||!current.costConfirmed){current.error='请先查看建议计划并确认本次模型费用。';renderWritingConversation();return;}
 current.pending=true;current.error='';renderWritingConversation();writingRequestLock(true);
 try{
  await runtimeFlush();
  if(!writingIsCurrent(current))return;
  if(current.articleBudget&&current.wholeBudget!==false){const approved=await apiRequest('/api/writing-budget/approve',{method:'POST',body:JSON.stringify({id:current.budgetApprovalId,brandId:current.scope.brandId,questionId:current.questionId,provider:current.provider,previewHash:current.articleBudget.previewHash,confirmCost:true})});if(!writingIsCurrent(current))return;current.writingBudgetId=approved.budget.id;}
  else current.writingBudgetId='';
  if(!writingStartAttempt(current,'plan'))return;
  renderWritingConversation();
  const data=await apiRequest('/api/content-conversation/suggest',{method:'POST',body:JSON.stringify({...current.planInput,runId:current.runId,previewHash:current.plan.previewHash,...(current.writingBudgetId?{writingBudgetId:current.writingBudgetId}:{confirmCost:true})})});
  if(writingIsCurrent(current))writingApplyProposal(current,data.proposal);
 }catch(error){if(current.attempt)writingUnknown(current,error);else current.error=error.message;}
 finally{current.pending=false;writingRequestLock(false);if(writingIsCurrent(current))renderWritingConversation();}
}

async function requestWritingDraftPreview(){
 const current=writingConversationState,direction=selectedDirection();if(!writingIsCurrent(current)||!direction||writingBlocked(current))return;
 if(!current.proposal?.id){current.error='当前方向建议无法恢复，请重新获取方向。';renderWritingConversation();return;}
 current.pending=true;current.error='';current.draftPlan=null;current.draftCostConfirmed=false;renderWritingConversation();writingRequestLock(true);
 try{
  await runtimeFlush();
  if(!writingIsCurrent(current))return;
  const data=await apiRequest('/api/content-conversation/draft-preview',{method:'POST',body:JSON.stringify({brandId:current.scope.brandId,questionId:current.questionId,proposalId:current.proposal.id,directionId:direction.id,...(current.writingBudgetId?{writingBudgetId:current.writingBudgetId}:{})})});
  if(writingIsCurrent(current)){current.draftPlan=data.plan;current.draftBudget=data.budget||null;current.draftCostConfirmed=writingDraftIncluded(current);}
 }catch(error){current.error=error.message;}
 finally{current.pending=false;writingRequestLock(false);if(writingIsCurrent(current))renderWritingConversation();}
}

function writingOpenDraft(current,data){
 const saved=data.state?.contents?.find(item=>item.id===data.id&&item.brandId===current.scope.brandId);
 if(!data.id||!saved)throw new Error('记录已完成，但原草稿暂不可见，请继续核对或在内容管理中查找。');
 const existing=state.contents.find(item=>item.id===data.id);
 if(existing&&existing.brandId!==current.scope.brandId)throw new Error('原草稿不属于当前品牌。');
 // Never replace an existing article or a whole workspace with a recovery response.
 // Only advance one revision if this new article is the sole server change.
 const unchanged=current.resultBase===JSON.stringify(state),hadContent=!!existing;
 if(!existing)state.contents.push(saved);
 if(!hadContent&&unchanged&&data.revision===serverRevision+1&&!(typeof pendingSnapshot!=='undefined'&&pendingSnapshot))serverRevision=data.revision;
 writingClearRecovery(current);writingConversationState=null;
 return data.id;
}

async function generateWritingDraft(){
 const current=writingConversationState,direction=selectedDirection();if(!writingIsCurrent(current)||!direction||writingBlocked(current))return;
 if(!current.draftPlan||!current.draftCostConfirmed&&!writingDraftIncluded(current)){current.error='请先查看完整草稿计划并确认本次模型费用。';renderWritingConversation();return;}
 current.pending=true;current.error='';renderWritingConversation();writingRequestLock(true);let draftId='';
 try{
  await runtimeFlush();
  if(!writingIsCurrent(current)||!writingStartAttempt(current,'generate'))return;
  current.resultBase=JSON.stringify(state);renderWritingConversation();
  const data=await apiRequest('/api/content-conversation/generate',{method:'POST',body:JSON.stringify({runId:current.draftRunId,brandId:current.scope.brandId,questionId:current.questionId,proposalId:current.proposal.id,directionId:direction.id,previewHash:current.draftPlan.previewHash,...(writingDraftIncluded(current)?{writingBudgetId:current.writingBudgetId}:{confirmCost:true})})});
  if(writingIsCurrent(current))draftId=writingOpenDraft(current,data);
 }catch(error){if(current.attempt)writingUnknown(current,error);else current.error=error.message;}
 finally{current.pending=false;writingRequestLock(false);if(writingIsCurrent(current))renderWritingConversation();}
 if(draftId)writingShowDraft(draftId);
}

function writingShowDraft(id){
 closeDrawer();go(state.viewMode==='simple'?'inbox':'content',{status:'草稿'});render();editContent(id);toast('已打开原草稿；请核对正文与出处后再审核。');
}

async function recoverWritingResult(){
 const current=writingConversationState;if(!writingIsCurrent(current)||current.pending||!current.attempt)return;
 const attempt=current.attempt;current.pending=true;current.error='';current.resultBase=JSON.stringify(state);renderWritingConversation();writingRequestLock(true);let draftId='';
 try{
  const data=await apiRequest('/api/content-conversation/result?'+new URLSearchParams({brandId:current.scope.brandId,runId:attempt.runId}),{method:'GET'});
  if(!writingIsCurrent(current))return;
  const run=data.run;
  if(!run||run.id!==attempt.runId||run.brandId!==current.scope.brandId||run.questionId!==attempt.questionId||run.kind!==attempt.kind||!['complete','running','failed'].includes(run.state))throw new Error('返回记录与本次请求不一致，请继续核对原记录。');
  if(attempt.kind==='generate'&&((run.proposalId&&run.proposalId!==attempt.proposalId)||(run.directionId&&run.directionId!==attempt.directionId)))throw new Error('草稿记录与原选择不一致。');
  attempt.checked=true;attempt.status=run.state;
  if(run.state==='complete'){
   if(attempt.kind==='plan')writingApplyProposal(current,data.proposal);
   else draftId=writingOpenDraft(current,data);
  }else if(run.state==='failed')current.error=run.error||'本次调用未成功完成。请先核对供应商用量，再明确确认是否开始新的调用。';
 }catch(error){
  if(writingIsCurrent(current)){
   if(error.status===404){attempt.status='missing';attempt.checked=true;current.error='服务端尚未找到本次结果，不会自动重新发送。请核对供应商用量后再决定是否重新开始。';}
   else{attempt.status='unknown';attempt.checked=true;current.error='暂时无法恢复结果，不会重新调用模型。'+error.message;}
  }
 }finally{current.pending=false;writingRequestLock(false);if(writingIsCurrent(current))renderWritingConversation();}
 if(draftId)writingShowDraft(draftId);
}

function writingNewAttempt(){
 const current=writingConversationState;
 if(!writingIsCurrent(current)||current.pending||!current.attempt?.checked||current.attempt.status==='running')return;
 if(!confirm('请先核对供应商用量和内容管理中的原稿。重新开始会使用新的请求编号，之后再次确认费用可能产生另一笔模型费用。确认已核对并重新开始？'))return;
 const keepDirection=current.attempt.kind==='generate'&&!!selectedDirection();
 writingClearRecovery(current);
 if(keepDirection){current.draftPlan=null;current.draftCostConfirmed=false;current.draftRunId='';}
 else resetWritingSuggestion(current,{keepProposal:true,keepInstruction:true});
 current.error='';renderWritingConversation();
}

async function writingConversationAction(name,el){
 if(name==='writing-conversation'){openWritingConversation({topic:el.dataset.topic||'',questionId:el.dataset.questionId||el.dataset.id||''});return true;}
 if(!name.startsWith('writing-'))return false;
 if(!writingIsCurrent(writingConversationState))return true;
 if(name==='writing-recover'){await recoverWritingResult();return true;}
 if(name==='writing-new-run'){writingNewAttempt();return true;}
 if(writingBlocked(writingConversationState))return true;
 if(name==='writing-choice'){
  const key=el.dataset.writingKey,value=el.dataset.writingValue;
  if(writingKnownChoice(key,value)){writingConversationState[key]=value;resetWritingSuggestion(writingConversationState,{keepProposal:true,keepInstruction:true});writingConversationState.error='';renderWritingConversation();}
  return true;
 }
 if(name==='writing-single-step'){writingConversationState.wholeBudget=false;writingConversationState.costConfirmed=false;renderWritingConversation();return true;}
 if(name==='writing-budget-cancel'){const current=writingConversationState;if(current.writingBudgetId){current.pending=true;renderWritingConversation();try{await apiRequest('/api/writing-budget/cancel',{method:'POST',body:JSON.stringify({id:current.writingBudgetId})});if(writingIsCurrent(current)){current.writingBudgetId='';current.draftBudget=null;current.draftCostConfirmed=false;current.error='本篇未使用额度已取消。已有结果保留；继续调用需单独确认费用。';}}catch(error){current.error=error.message}finally{current.pending=false;if(writingIsCurrent(current))renderWritingConversation();}}return true;}
 if(name==='writing-preview'){await requestWritingPreview();return true;}
 if(name==='writing-suggest'){await requestWritingDirections();return true;}
 if(name==='writing-select-direction'){
  const direction=writingConversationState.proposal?.directions?.find(item=>item.id===el.dataset.directionId);
  if(direction){const current=writingConversationState;for(const key of ['goal','format','tone'])if(writingKnownChoice(key,current.proposal.options?.[key]))current[key]=current.proposal.options[key];current.provider=current.proposal.provider||current.provider;resetWritingSuggestion(current,{keepProposal:true});current.selected=direction;renderWritingConversation();}
  return true;
 }
 if(name==='writing-clear-direction'){writingConversationState.selected=null;writingConversationState.draftPlan=null;writingConversationState.draftCostConfirmed=false;writingConversationState.draftRunId='';renderWritingConversation();return true;}
 if(name==='writing-draft-preview'){await requestWritingDraftPreview();return true;}
 if(name==='writing-generate-draft'){await generateWritingDraft();return true;}
 return false;
}

document.addEventListener('toggle',event=>{
 if(event.target.matches?.('[data-writing-preferences]')&&event.target.isConnected!==false&&writingIsCurrent(writingConversationState))writingConversationState.preferencesOpen=event.target.open;
},true);

document.addEventListener('change',event=>{
 if(!writingIsCurrent(writingConversationState)||writingBlocked(writingConversationState))return;
 if(event.target.matches('[data-writing-question]')){writingConversationState.questionId=event.target.value;resetWritingSuggestion(writingConversationState);writingConversationState.error='';renderWritingConversation();}
 if(event.target.matches('[data-writing-provider]')){writingConversationState.provider=event.target.value;resetWritingSuggestion(writingConversationState,{keepProposal:true,keepInstruction:true});writingConversationState.error='';renderWritingConversation();}
 if(event.target.matches('[data-writing-cost-confirm]')){writingConversationState.costConfirmed=event.target.checked;renderWritingConversation();}
 if(event.target.matches('[data-writing-draft-cost-confirm]')){writingConversationState.draftCostConfirmed=event.target.checked;renderWritingConversation();}
});

document.addEventListener('input',event=>{
 const current=writingConversationState;if(!writingIsCurrent(current)||writingBlocked(current)||!event.target.matches('[data-writing-instruction]'))return;
 current.instruction=event.target.value;
 // Preserve focus and the current cards while invalidating any earlier paid plan.
 current.plan=null;current.planInput=null;current.costConfirmed=false;current.runId='';current.error='';current.selected=null;current.draftPlan=null;current.draftCostConfirmed=false;current.draftRunId='';
 const panel=document.getElementById('drawer-body')?.querySelector('[data-writing-suggestion-plan]');
 if(panel)panel.innerHTML=writingSuggestionPlan(current,serverConnections.some(item=>item.provider===current.provider));
 const selected=document.getElementById('drawer-body')?.querySelector('[data-writing-selected]');if(selected)selected.innerHTML='';
});

document.addEventListener('close',event=>{if(event.target.id==='drawer')writingConversationState=null;},true);
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{writingConversationState=null;});
