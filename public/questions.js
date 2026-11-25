const questionIntents=['了解','比较','决策','使用'];
const questionNormalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
const questionSelection=new Set();
const questionTagsInput=(tags='')=>`<label class="field">标签（逗号分隔，选填）<input name="tags" value="${esc(tags)}" maxlength="300"></label>`;
function questionSourceInfo(question){
 if(typeof GEO_QUESTION_IMPORT!=='undefined'&&typeof GEO_QUESTION_IMPORT.questionProvenanceView==='function')return GEO_QUESTION_IMPORT.questionProvenanceView(question,state.questionDiscoveries||[]);
 return {kind:'unknown',label:'当前品牌问题库（原始来源未标注）',details:[],notice:'来源记录尚未加载，请刷新后核对。'};
}
function questionSourceDetails(question,{summary='查看问题来源',allowReceipt=true}={}){
 const source=questionSourceInfo(question),date=Date.parse(source.recordedAt||'');
 return `<details class="writing-question-help"><summary>${esc(summary)}</summary><p class="helper">${esc(source.label)}${Number.isFinite(date)?' · '+esc(new Date(date).toLocaleString('zh-CN')):' · 记录时间未注明'}</p>${source.details.length?'<dl>'+source.details.map(item=>'<dt>'+esc(item.label)+'</dt><dd>'+esc(item.value)+'</dd>').join('')+'</dl>':''}${source.originalText?'<p class="helper">'+(source.edited?'最初记录的问题（当前文字已修改）':'最初记录的问题')+'</p><p>'+esc(source.originalText)+'</p>':''}<p class="helper">${esc(source.notice)}</p>${source.importId&&allowReceipt?btn('查看原导入回执','question-file-receipt','ghost small',`data-id="${esc(source.importId)}"`):''}</details>`;
}
function renderQuestionMonitor(){
 const report=currentEvidenceReport(),p=context(),topic=p.get('topic')||'',intent=p.get('intent')||'',tag=p.get('tag')||'';monitorFilter=p.get('q')||'';monitorPlatform=p.get('platform')||'全部平台';
 const productId=p.get('productId')||'';const list=own('questions').filter(q=>(!productId||(q.productId||'@brand')===productId)&&(!topic||q.topic===topic)&&(!intent||q.intent===intent)&&(!tag||(q.tags||[]).includes(tag))&&q.text.toLowerCase().includes(monitorFilter.toLowerCase()));
 const ids=new Set(list.map(q=>q.id)),current=report.answers.filter(a=>ids.has(a.promptId)),byQuestion=new Map();
 for(const a of current){if(!byQuestion.has(a.promptId))byQuestion.set(a.promptId,[]);byQuestion.get(a.promptId).push(a);}
 const m=metrics(current),discoveries=own('questionDiscoveries').filter(d=>!productId||(d.productId||'@brand')===productId);
 const rows=list.map(q=>{
  const answers=byQuestion.get(q.id)||[],sample=metrics(answers),id=`data-id="${esc(q.id)}"`;
  return [
   `<label class="question-pick"><input type="checkbox" data-question-select="${esc(q.id)}" aria-label="选择问题：${esc(q.text)}" ${questionSelection.has(q.id)?'checked':''}><span><b class="table-question">${esc(q.text)}</b><small>${esc(q.version||'v1')} · ${esc(GEO_METRICS.productLabel(brand(),q.productId||'@brand'))}${q.priority?' · AI 建议优先级 '+esc(q.priority):''}</small>${(q.tags||[]).map(t=>badge(t)).join(' ')}</span></label>`,
   `${esc(q.topic||'未分组')}<small>${esc(q.intent||'了解')}</small>`,
   evidencePlatformList(answers.map(a=>a.platform)),
   sample.n||'—',
   sample.n?`${percent(sample.mention,sample.n)}<small>${sample.mention} / ${sample.n} 条</small>`:'—',
   sample.citationN?`${sample.cited} / ${sample.citationN}`:'—',
   `<div class="row-actions">${btn('回答与引用','question-answers','small',id)}${simpleWrite()?btn('编辑','question-edit','ghost small',id):''}</div><details class="geo-row-details"><summary>更多</summary>${questionSourceDetails(q,{summary:'问题来源'})}${btn('版本','question-history','ghost small',id)}${simpleWrite()?btn('创建内容','new-content','ghost small',id)+btn('对话选方向','writing-conversation','ghost small',id+` data-question-id="${esc(q.id)}" data-topic="${esc(q.topic||'')}"`)+btn('快速 AI 写作','ai-write','ghost small',id)+btn('API 测试','api-sample','ghost small',id):''}</details>`
  ];
 });
 const filters=`<div class="toolbar question-filters"><input id="question-search" aria-label="搜索问题" placeholder="搜索客户问题" value="${esc(monitorFilter)}"><select data-question-filter="intent" aria-label="筛选用户意图"><option value="">全部意图</option>${questionIntents.map(s=>`<option ${s===intent?'selected':''}>${s}</option>`).join('')}</select><select data-question-filter="tag" aria-label="筛选问题标签"><option value="">全部标签</option>${[...new Set(own('questions').flatMap(q=>q.tags||[]))].map(s=>`<option ${s===tag?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`;
 const actions=simpleWrite()?btn('导入回答','import-answer')+btn('新增问题','new-question','primary'):'';
 const queue=`<details class="geo-evidence-extra"><summary>问题导入、批量管理与挖掘记录</summary><div class="row-actions">${simpleWrite()?btn('AI 挖掘问题','question-discover')+btn('文件导入','question-file-open')+btn('粘贴问题','question-import')+btn('导入记录','question-file-history'):''}<a class="button small" href="${esc(routeLink('tasks',{productId}))}">任务与批量执行</a></div>${simpleWrite()?`<div class="question-batch"><label><input type="checkbox" data-question-all> 选择本页问题</label>${btn('为所选问题添加标签','question-tags','small')}${btn('分配产品线','question-products','small')}</div>`:''}<div class="settings-list">${discoveries.slice().reverse().slice(0,10).map(d=>`<div class="setting-row"><div><h3>${esc(d.seeds.slice(0,90))}</h3><p>${esc(d.model)} · ${d.candidates.length} 个候选</p></div>${btn('查看候选与回执','discovery-detail','small',`data-id="${esc(d.id)}"`)}</div>`).join('')||'<p class="helper">尚无挖掘记录。候选和 AI 优先级不代表真实搜索量。</p>'}</div></details>`;
 return evidenceWorkspace('品牌监测','按问题查看各 AI 平台的采样、品牌提及和引用。',actions,
  brandFilter(true)+filters+(topic||intent||tag?filterNotice('当前筛选：'+[topic,intent,tag].filter(Boolean).join(' / ')):'')+`<details class="geo-evidence-extra"><summary>调整统计范围</summary>${evidenceFilters()}</details>`+evidenceWorkspaceScope(report),
  [['监测问题',list.length],['已有回答的问题',byQuestion.size],['有效回答',m.n],['品牌提及',m.n?`${m.mention} / ${m.n}`:'—'],['回答含已核对引用',m.citationN?`${m.cited} / ${m.citationN}`:'—']],
  evidenceSection('监测问题','未采样或未核对显示为「—」。点击「回答与引用」查看具体证据。',
   evidenceTable(['客户问题','场景 / 意图','AI 平台','回答数','品牌提及','有引用 / 已核对','操作'],rows,'没有符合条件的问题。可清除筛选，或新增客户问题。'))+queue);
}
function questionAnswerRecords(ids){return GEO_METRICS.selectAnswers(state,brand().id,analyticOptions()).filter(a=>ids.includes(a.promptId));}
function defaultQuestionProduct(){const id=context().get('productId');return brand().productLines?.some(p=>p.id===id&&p.status==='active')?id:'';}
function questionInputs(q={}){return `<label class="field">客户会怎样提问？<textarea name="text" required maxlength="500">${esc(q.text||'')}</textarea></label>${productScopeSelect('关联产品线','productId',q.productId??defaultQuestionProduct())}${field('主题','topic',q.topic||'未分组')}${selectField('用户意图','intent',questionIntents,q.intent||'了解')}${questionTagsInput((q.tags||[]).join('，'))}`;}
function questionForm(kind,contents,data=''){return `<form data-questions-form="${kind}" ${data}>${contents}<p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="button primary">${kind==='discover'?'生成候选问题':kind==='accept'?'将所选候选加入问题库':'保存问题'}</button></div></form>`;}
function discoveryDetail(id){
 const d=own('questionDiscoveries').find(d=>d.id===id);if(!d)return;const existing=new Set(own('questions').map(q=>questionNormalize(q.text)+'|'+(q.productId||'')));
 openDrawer('候选问题与聚类',`<p>${esc(d.seeds)} · ${esc(GEO_METRICS.productLabel(brand(),d.productId||'@brand'))}</p><div class="kv"><span>模型 / 时间</span><span>${esc(d.model)} · ${new Date(d.created).toLocaleString('zh-CN')}</span></div>${d.parseError?`<p class="form-error">${esc(d.parseError)}</p>`:''}`+
 questionForm('accept',`<div class="question-candidates">${d.candidates.map(c=>{const duplicate=existing.has(questionNormalize(c.text)+'|'+(d.productId||''));return `<label class="source-evidence"><span class="question-pick"><input type="checkbox" name="candidateIds" value="${c.id}" ${duplicate?'disabled':'checked'}><b>${esc(c.text)}</b></span><span class="sub">${esc(c.topic)} · ${esc(c.intent)} · ${duplicate?'问题库已存在':'AI 建议优先级 '+esc(c.priority)}</span><span class="question-tags">${c.tags.map(t=>badge(t)).join('')}</span><p>${esc(c.reason)}</p></label>`}).join('')||'<p>格式不符合要求，可查看下面的原始结果后手动整理。</p>'}</div><p class="helper">加入时再次去重。此步骤不会调用模型或自动发布。</p>`,`data-discovery="${d.id}"`)+`<details class="advanced"><summary>原始输出与调用回执</summary><p>请求 ID：${esc(d.requestId||'供应商未返回')} · 用量：${esc(JSON.stringify(d.usage))}</p><div class="answer-text">${esc(d.rawText)}</div></details>`,'可审阅候选 · 非搜索热度');
}
function historyDetail(id){
 const q=own('questions').find(q=>q.id===id);if(!q)return;const history=q.history?.length?q.history:[{...q,at:null}];
 openDrawer('问题版本与变更',`<p>${esc(q.text)}</p>${questionSourceDetails(q)}<div class="two-col">${['from','to'].map((side,i)=>`<label class="field">${i?'比较版本':'原版本'}<select data-history-side="${side}" data-question="${q.id}">${history.map((v,j)=>`<option value="${j}" ${j===(i?history.length-1:Math.max(0,history.length-2))?'selected':''}>${esc(v.version)}</option>`).join('')}</select></label>`).join('')}</div><div id="question-comparison"></div><p class="helper">改版只影响后续任务。已排队任务和已保存回答保留当时的问题快照；早期未记录版本的回答不会自动归入新版本。</p>`,'历史保留 · 版本对照');
 document.querySelectorAll('[data-history-side]').forEach(s=>s.disabled=false);renderQuestionComparison(q);
}
function renderQuestionComparison(q){const history=q.history?.length?q.history:[{...q,at:null}];$('#question-comparison').innerHTML=`<div class="two-col question-comparison">${['from','to'].map(side=>{const v=history[Number(document.querySelector(`[data-history-side="${side}"]`).value)];return `<section class="source-evidence"><h3>${esc(v.version)}</h3><p>${esc(v.text)}</p><p>${esc(Object.hasOwn(v,'productId')?GEO_METRICS.productLabel(brand(),v.productId||'@brand'):'产品归属未记录')}</p><span class="sub">${esc(v.topic)} · ${esc(v.intent)}</span><div class="question-tags">${(v.tags||[]).map(t=>badge(t)).join('')}</div><small>${v.at?new Date(v.at).toLocaleString('zh-CN'):'早期版本，时间未记录'}</small></section>`}).join('')}</div>`;}
async function questionsAction(name,el){
 if(name==='question-answers'){showAnswers(questionAnswerRecords([el.dataset.id]),own('questions').find(q=>q.id===el.dataset.id)?.text||'回答样本');return true;}
 const q=own('questions').find(q=>q.id===el.dataset.id);
 if(name==='new-question'||name==='question-edit'){if(name==='question-edit'&&!q)return true;openDrawer(q?'编辑监测问题':'新增监测问题',questionForm(q?'edit':'create',questionInputs(q),q?`data-id="${q.id}" data-version="${esc(q.version||'v1')}"`:''),'问题管理 · 自动保存历史');return true;}
 if(name==='question-history'){historyDetail(el.dataset.id);return true;}
 if(name==='discovery-detail'){discoveryDetail(el.dataset.id);return true;}
 if(name==='question-import'){openDrawer('批量导入客户问题',questionForm('import',`<label class="field">问题列表（一行一个，最多 100 条）<textarea name="questions" rows="10" maxlength="50000" required></textarea></label>${productScopeSelect('关联产品线','productId',defaultQuestionProduct())}${field('主题','topic','未分组')}${selectField('用户意图','intent',questionIntents,'了解')}${questionTagsInput()}<p>自动跳过相同问题，保留其他品牌各自的问题库。</p>`),'批量整理 · 自动去重');return true;}
 if(name==='question-products'){const ids=own('questions').filter(q=>questionSelection.has(q.id)).map(q=>q.id);if(!ids.length){toast('请先选择问题');return true}openDrawer('批量分配产品线',questionForm('product',`<p>为 ${ids.length} 个问题保存新版本。已排队任务和历史回答保持原归属。</p>${productScopeSelect('产品线','productId',defaultQuestionProduct())}`,`data-ids="${ids.join(',')}"`),'问题归属');return true;}
 if(name==='question-tags'){const ids=own('questions').filter(q=>questionSelection.has(q.id)).map(q=>q.id);if(!ids.length){toast('请先勾选要添加标签的问题');return true;}openDrawer('批量添加标签',questionForm('tags',`<p>将为 ${ids.length} 个问题追加标签，并记录新版本。</p>${field('标签（逗号分隔）','tags','')}`,`data-ids="${ids.join(',')}"`),'已有标签会保留');return true;}
 if(name==='question-discover'){
  if(!serverConnections.length){toast('请先配置一个模型服务');go('integrations');return true;}
  openDrawer('AI 挖掘客户问题',questionForm('discover',`${productScopeSelect('关联产品线','productId',defaultQuestionProduct())}<label class="field">品类、产品用途或客户需求<textarea name="seeds" rows="5" maxlength="4000" required placeholder="例如：中小团队管理客户资料，关注迁移成本、协作和售后">${esc(brand().industry||'')}</textarea></label><div class="two-col"><label class="field">模型<select name="provider">${serverConnections.map(c=>`<option value="${esc(c.provider)}">${esc(c.model)}</option>`).join('')}</select></label><label class="field">候选数量<input type="number" name="count" value="10" min="3" max="20" required></label></div><p class="helper">发送品牌名称、行业、种子需求和最多 100 条已有问题。会调用一次供应商模型并计入每日配额；结果先保存为候选，不自动采样。</p>`,`data-run-id="${crypto.randomUUID()}"`),'模型辅助 · 意图聚类');return true;
 }
 return false;
}
document.addEventListener('change',e=>{
 const el=e.target;if(el.dataset.questionSelect){el.checked?questionSelection.add(el.dataset.questionSelect):questionSelection.delete(el.dataset.questionSelect);}
 if(el.hasAttribute('data-question-all'))document.querySelectorAll('[data-question-select]').forEach(x=>{x.checked=el.checked;el.checked?questionSelection.add(x.dataset.questionSelect):questionSelection.delete(x.dataset.questionSelect)});
 if(el.dataset.questionFilter){replaceContext({[el.dataset.questionFilter]:el.value});render();}
 if(el.dataset.historySide){const q=own('questions').find(q=>q.id===el.dataset.question);if(q)renderQuestionComparison(q);}
});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-questions-form]');if(!f)return;e.preventDefault();if(f.dataset.busy)return;f.dataset.busy='1';const button=f.querySelector('button[type="submit"]'),error=f.querySelector('.form-error'),kind=f.dataset.questionsForm;button.disabled=true;error.textContent='';runtimeLock(true);
 try{await runtimeFlush();const data=new FormData(f),v=Object.fromEntries(data);let path='/api/questions/',body={brandId:brand().id,...v};
  if(kind==='discover'){path+='discover';body.runId=f.dataset.runId;body.count=Number(v.count);}
  if(kind==='edit'){path+='edit';body.id=f.dataset.id;body.version=f.dataset.version;}
  if(['tags','product'].includes(kind)){path+=kind;body.ids=f.dataset.ids.split(',');}
  if(['create','import','accept'].includes(kind)){path+='import';if(kind==='accept'){body.discoveryId=f.dataset.discovery;body.candidateIds=data.getAll('candidateIds');}else body.questions=kind==='create'?[v]:v.questions.split('\n').map(s=>s.trim()).filter(Boolean);}
  const d=await apiRequest(path,{method:'POST',body:JSON.stringify(body)});state=d.state;serverRevision=d.revision;runtimeLock(false);closeDrawer();render();if(kind==='discover')discoveryDetail(d.record.id);else toast(d.added?`已加入 ${d.added.length} 个问题，跳过 ${d.skipped} 个重复项`:'问题已保存，历史版本已保留');
 }catch(err){error.textContent=err.message;button.disabled=false;}finally{delete f.dataset.busy;runtimeLock(false);}
});
