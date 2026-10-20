/* Simple mode orchestrates existing services; it does not fabricate platform results. */
const SIMPLE_ENTRIES={'豆包':'https://www.doubao.com/chat/','DeepSeek':'https://chat.deepseek.com/','Kimi':'https://www.kimi.com/','腾讯元宝':'https://yuanbao.tencent.com/','通义千问':'https://www.qianwen.com/','文心':'https://yiyan.baidu.com/','ChatGPT':'https://chatgpt.com/'};
let simpleActivePlatform="",simpleDraft=null,simpleFlows=[],simpleFlowScope='',simpleLoading=false,simpleError='',simpleRefreshTimer=null,simpleReading=false;
function simplePlatforms(){return brand().platforms?.filter(p=>SIMPLE_ENTRIES[p])||Object.keys(SIMPLE_ENTRIES)}
function simpleScope(){return [accessInfo.current.owner,sessionStorage.getItem('geo.workspace')||'',brand().id].join('|')}
function simpleWrite(){return ['owner','admin','editor'].includes(accessInfo.current.role)}
function simpleReview(){return ['owner','admin','reviewer'].includes(accessInfo.current.role)}
const SIMPLE_TYPES={brand:'品牌',product:'产品',person:'个人'};
function simpleTypeOptions(value='brand'){return Object.entries(SIMPLE_TYPES).map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}
function simpleBrandPicker(){return state.brands.length>1?`<label class="simple-toolbar">当前对象<select id="brand-select">${state.brands.map(b=>`<option value="${esc(b.id)}" ${brand().id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}
function renderSimpleNavigation(){
 const count=own('facts').filter(f=>f.status==='待确认').length+own('contents').filter(c=>c.status!=='已审核').length;
 $('#nav').innerHTML=[['today','工作台','dashboard'],['inbox','内容与确认','edit'],['results','AI 引用与推荐','chart']].map(([id,t,i])=>`<a class="nav-item ${route===id?'active':''}" href="#${id}" ${route===id?'aria-current="page"':''}>${icon(i)}<span>${t}</span>${id==='inbox'&&count?`<span class="nav-num">${count}</span>`:''}</a>`).join('')+`<details class="simple-detail"><summary>更多工具</summary>${[['knowledge','资料与项目证据'],['monitor','用户会问的问题'],['publish','发布记录'],['reports','完整报告'],['integrations','模型与账号'],['tasks','任务记录'],['brands','品牌、产品与个人']].map(([id,t])=>`<a class="nav-item" href="#${id}">${t}</a>`).join('')}<button type="button" class="nav-item" data-action="simple-full-view">完整工作台</button></details>`;
 $('#view-mode').value='simple';document.body.dataset.view='simple';
}
function simpleCard(title,body,actions=''){return `<section class="simple-card"><h3>${title}</h3>${body}${actions}</section>`}
function renderSimpleSetup(){
 const d=simpleDraft ||= state.simpleSetupDraft||{id:uid(),entityType:'brand',platforms:['豆包']};
 const imported=!!d.text;
 return `<div class="simple-setup">${title('让 AI 在合适的问题里找到你','可以是品牌、一款产品，也可以是你自己。')}<form class="focus-setup" data-simple="setup" data-id="${esc(d.id)}">
 <fieldset class="entity-choice"><legend>你想让 AI 认识谁？</legend>${Object.entries(SIMPLE_TYPES).map(([v,t])=>`<label><input type="radio" name="entityType" value="${v}" ${v===(d.entityType||'brand')?'checked':''}><span>${t}</span></label>`).join('')}</fieldset>
 <label class="field"><span data-entity-name>名称</span><input name="name" required maxlength="160" value="${esc(d.name||'')}" placeholder="例如：温舒 / 观引 GEO" autocomplete="off"></label>
 <label class="field">一句介绍<textarea name="description" required minlength="8" maxlength="5000" rows="3" placeholder="你做什么、帮助谁，以及可以公开核实的项目。">${esc(d.description||'')}</textarea></label>
 <label class="field">希望用户怎样问 AI 时找到你？<input name="goalQuery" required maxlength="500" value="${esc(d.goalQuery||'')}" placeholder="例如：杭州做 FDE 有哪些人？"><small>写真实需求，尽量不带自己的名字。它是目标，不是已经获得的推荐。</small></label>
 <details class="simple-detail setup-extras"><summary>补充网址、导入资料或调整平台</summary>
 <label class="field">公开网站（可选）<input name="site" type="url" value="${esc(d.site||'')}" placeholder="https://"></label>
 <label class="field">从网页读取资料<input name="url" type="url" value="${esc(d.url||'')}" placeholder="https://"></label>
 <label class="file-picker">上传 PDF、Word、文本或图片<input type="file" name="file" data-simple-file accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"></label>
 <label class="field">也可粘贴现有资料<textarea name="text" maxlength="50000" rows="3">${esc(d.text||'')}</textarea></label>
 <input type="hidden" name="source" value="${esc(d.source||'用户确认的公开介绍')}"><button type="button" class="button small" data-action="simple-cancel-parse" hidden>取消文件解析</button>
 <p class="simple-help" data-simple-progress>本机解析，最多 8 MB。读取后请核对名称与介绍。</p>${btn('读取并填入介绍','simple-read-source','small','type="button"')}
 <fieldset class="platform-choice"><legend>关注的 AI 平台</legend><div class="simple-platforms">${Object.keys(SIMPLE_ENTRIES).map(p=>`<label><input type="checkbox" name="platforms" value="${esc(p)}" ${(d.platforms||['豆包']).includes(p)?'checked':''}>${esc(p)}</label>`).join('')}</div></fieldset></details>
 ${imported?'<p class="simple-help">已读入资料，请核对上方介绍后保存。</p>':''}<p class="form-error" role="alert"></p>
 <button class="button primary" type="submit">确认资料，开始</button><p class="simple-help">自动准备 5 个可编辑的问题。不会调用付费模型或自动发布。</p>
 </form></div>`;
}
function simpleFlowCards(){
 if(simpleFlowScope!==simpleScope())return '<p class="simple-help">正在读取工作进度…</p>';
 return simpleFlows.slice(0,4).map(f=>{
 const runnable=!f.paused&&['writing','checking'].includes(f.stage)&&!runtimeContext.background?.enabled;
 const labels={writing:'草稿准备任务',checking:'草稿检查任务',review:'草稿已准备好，等你确认',needs_attention:'需要处理后继续'};
 return simpleCard(f.paused?'流程已暂停':labels[f.stage]||'正在处理',`<p>${esc(own('questions').find(q=>q.id===f.questionId)?.text||'历史问题')}</p>${f.error?`<p class="simple-issue">${esc(f.error)}</p>`:''}${f.issues?.length?`<p class="simple-issue">${esc(f.issues[0].error||taskStates[f.issues[0].status])}</p><a href="#tasks">查看失败原因与恢复操作 →</a>`:''}`,f.stage==='review'?'<a class="button primary" href="#inbox">查看稿件</a>':simpleWrite()?(runnable?btn('执行下一步','simple-tick','primary'):'')+btn(f.paused||f.stage==='needs_attention'?'继续流程':'暂停流程','simple-flow-action','small',`data-id="${esc(f.id)}" data-mode="${f.paused||f.stage==='needs_attention'?'resume':'pause'}"`):'');
 }).join('');
}
function renderSimpleToday(){
 const b=brand(),qs=own('questions'),facts=own('facts'),usable=facts.some(GEO_KNOWLEDGE.factUsable);
 const answers=own('answers').filter(a=>a.surface==='import'&&!a.demo&&a.status==='ok');
 const pending=facts.filter(f=>f.status==='待确认').length,waiting=own('contents').filter(c=>c.status!=='已审核').length;
 const goal=GEO_METRICS.goalEvidence(answers,b),target=qs.find(q=>q.text.trim()===b.goalQuery?.trim())||qs[0];
 const next=!b.goalQuery?'先确定你希望被找到的问题':!usable?'补齐可以核实的介绍和项目':!goal.rows.length?'记录一次目标问题的回答，建立起点':waiting?'核对草稿，让真实项目成为内容依据':'根据实际引用，补齐下一篇内容';
 const main=!b.goalQuery?(isOwner()?btn('设定目标问题','simple-goal','primary'):'<a class="button primary" href="#results">查看已有结果</a>'):!usable?'<a class="button primary" href="#knowledge">补充项目资料</a>':waiting&&goal.rows.length?'<a class="button primary" href="#inbox">核对草稿</a>':simpleWrite()?btn(!goal.rows.length?'记录首次 AI 回答':'准备下一篇内容',!goal.rows.length?'simple-capture':'simple-prepare','primary',`data-id="${esc(target?.id||'')}"`):'<a class="button primary" href="#results">查看已有结果</a>';
 const active=simpleFlowScope===simpleScope()&&simpleFlows.length;
 return title(esc(b.name),`${SIMPLE_TYPES[b.entityType]||'品牌'} · AI 可见性工作台`,isOwner()?btn('编辑资料','catalog-profile','ghost small',`data-id="${esc(b.id)}"`):'')+simpleBrandPicker()+`
 <div class="focus-workspace"><section class="focus-goal" aria-labelledby="focus-goal-title"><div class="goal-heading"><h2 id="focus-goal-title">${esc(b.goalQuery||'你希望用户怎样问 AI 时找到你？')}</h2>${b.goalQuery&&isOwner()?btn('调整目标','simple-goal','ghost small'):''}</div><p>用户提出这个需求时，让 AI 有依据地认识、引用和推荐${b.entityType==='person'?'你':'你提供的服务或产品'}。</p>
 <ol class="goal-path" aria-label="从资料到推荐的工作路径"><li><a href="#knowledge">资料与证据</a></li><li><a href="#inbox">内容与发布</a></li><li><a href="#results">引用与推荐</a></li></ol>
 <div class="next-action"><h3>${esc(next)}</h3><div class="today-actions">${main}${simpleWrite()&&(!b.goalQuery||waiting||!goal.rows.length)?btn('准备内容','simple-prepare','ghost'):''}</div></div></section>
 <section class="focus-evidence" aria-labelledby="focus-evidence-title"><div class="section-heading"><h2 id="focus-evidence-title">距离被推荐，还有哪些证据？</h2><a href="#results">查看原始回答 →</a></div><dl class="evidence-strip"><div><dt>目标问题的回答</dt><dd>${goal.rows.length?goal.rows.length+' 条':'尚未记录'}</dd></div><div><dt>提及${b.entityType==='person'?'你':'名称'}</dt><dd>${goal.rows.length?goal.metrics.mention+' / '+goal.rows.length:'待验证'}</dd></div><div><dt>引用官网</dt><dd>${!b.site?'待补充官网':goal.metrics.citationN?goal.metrics.official+' / '+goal.metrics.citationN:'待核对引用'}</dd></div><div><dt>无点名推荐</dt><dd>${goal.prompted?'目标包含名称':goal.reviewed.length?goal.recommended.length+' / '+goal.reviewed.length:'待核对推荐'}</dd></div></dl><p class="simple-help">只统计这个目标问题的正式回答。无点名推荐还需确认联网模式与原文；上传资料、发表文章都不等于已被推荐。</p></section>
 <section class="focus-questions"><div class="section-heading"><h2>用户会问的问题</h2><a href="#monitor">管理全部 ${qs.length} 个 →</a></div><ul>${[...(target?[target]:[]),...qs.filter(q=>q.id!==target?.id)].slice(0,3).map(q=>`<li><span>${esc(q.text)}</span>${simpleWrite()?btn('记录回答','simple-capture','ghost small',`data-id="${esc(q.id)}"`):''}</li>`).join('')||'<li>还没有问题。先设定一个真实需求。</li>'}</ul></section>
 ${pending?`<p class="focus-notice"><a href="#inbox">${pending} 项资料待核对</a>，核对后才会用于内容生成。</p>`:''}
 ${active?`<section class="today-progress"><h2>内容准备进度</h2><div class="simple-grid">${simpleFlowCards()}</div></section>`:''}
 <details class="simple-detail focus-settings"><summary>平台与后台设置</summary><p class="simple-help">当前关注：${esc(simplePlatforms().join('、'))}。${runtimeContext.background?.enabled?'本机后台已开启。':'后台未开启，任务按需执行。'}</p><div class="today-actions">${isOwner()?btn('调整关注平台','simple-platforms','small'):''}${simpleWrite()&&active?btn('推进内容任务','simple-tick','small'):''}${isLocalRuntime()&&isOwner()?btn(runtimeContext.background?.enabled?'暂停本机后台':'开启本机后台','local-runner-toggle','small',`data-enabled="${!runtimeContext.background?.enabled}"`):''}${btn('刷新工作区','simple-refresh','ghost small')}</div></details><p class="simple-error" role="alert">${esc(simpleError)}</p></div>`;
}
function renderSimpleInbox(){
 const facts=own('facts').filter(f=>f.status==='待确认'),contents=own('contents').slice().reverse(),pubs=own('publications').filter(p=>!p.url&&!p.demo);
 return title('内容与确认','用真实资料回答用户的问题，再保存平台实际发布结果。',simpleWrite()?btn('写文章','write-article','primary'):'')+simpleBrandPicker()+`<div class="simple-stack">${!own('facts').length?simpleCard('补充资料与项目证据','<p>上传现有介绍，不必逐条创建事实。</p>',simpleWrite()?btn('上传资料','knowledge-upload','primary')+btn('粘贴介绍','import-document'):''):''}${facts.map(f=>simpleCard(esc(f.key),`<p>${esc(f.value)}</p><small>出处：${esc(f.source)}</small>`,simpleReview()?btn('核对这项资料','confirm-fact','primary',`data-id="${esc(f.id)}"`):'')).join('')}${contents.map(c=>simpleCard(esc(c.title),`<p>${esc(c.status)} · ${esc(c.question||'已保存的稿件')}</p>${contentCheckSummary(c)}`,btn(c.status==='已审核'?'查看稿件':'修改 / 核对稿件','edit-content','primary',`data-id="${esc(c.id)}"`)+(c.status==='已审核'&&simpleWrite()?btn('多平台发布','distribute-article','',`data-id="${esc(c.id)}"`):''))).join('')}${pubs.map(p=>simpleCard(esc(p.title),`<p>${esc(p.channel)} · 等待实际平台结果</p>`,btn('继续发布与登记','publication-journey','primary',`data-id="${esc(p.id)}"`))).join('')}${facts.length||contents.length||pubs.length?'':'<div class="simple-empty"><h2>目前没有待确认内容</h2><p>资料确认后，就可以准备第一篇内容。</p><a class="button" href="#today">返回工作台</a></div>'}</div>`;
}
function renderSimpleResults(){
 const b=brand(),all=own('answers').filter(a=>a.surface==='import'&&!a.demo&&a.status==='ok'),platforms=[...new Set([...simplePlatforms(),...all.map(a=>a.platform)])];
 return title('AI 引用与推荐','看真实需求里是否被提及、引用和推荐，不用一个总分代替证据。',simpleWrite()?btn('记录 AI 回答','simple-capture','primary'):'')+simpleBrandPicker()+`<section class="goal-results-intro"><h2>${esc(b.goalQuery||'先设置希望被找到的目标问题')}</h2><p class="simple-help">${b.goalQuery?'下方仅统计原问题与目标相符的正式消费端回答。其他问题的记录保留在原始回答中。':'添加目标后再判断推荐效果；已有回答不会丢失。'}</p>${!b.goalQuery&&isOwner()?btn('设置目标问题','simple-goal'):''}</section><div class="goal-results">${platforms.map(p=>{const rows=all.filter(a=>a.platform===p),g=GEO_METRICS.goalEvidence(rows,b),m=g.metrics;return `<section class="goal-result-row"><h3>${esc(p)}</h3><div><p>${g.rows.length?`目标问题 ${g.rows.length} 条 · 提及名称 ${m.mention} 条`:'目标问题尚未记录回答'}</p><p class="result-detail">官网引用：${!b.site?'未填写官网':m.citationN?m.official+' / '+m.citationN+' 条已核对':'待核对'} · 无点名推荐：${g.prompted?'目标含名称，不能判断':g.reviewed.length?g.recommended.length+' / '+g.reviewed.length+' 条已核对':'待核对联网模式与推荐'}${g.unknown?' · '+g.unknown+' 条条件待核对':''}</p>${rows.length?`<p class="result-detail">这个平台另有 ${rows.length-g.rows.length} 条其他问题的回答。</p>`:''}</div>${simpleWrite()?btn('记录回答','simple-capture','small',`data-platform="${esc(p)}" data-id="${esc(own('questions').find(q=>q.text.trim()===b.goalQuery?.trim())?.id||'')}"`):''}${rows.length?btn('查看原文与引用','simple-evidence','ghost small',`data-platform="${esc(p)}"`):''}</section>`}).join('')}</div><details class="simple-detail"><summary>统计口径与后续跟踪</summary><p class="simple-help">“无点名推荐”要求原问题不包含当前名称或别名、记录为 Web / App 联网回答，并人工核对原文明确推荐。未知不当作未推荐；点名介绍不当作主动推荐。没有采样也不代表搜不到。不同平台的样本条件可能不同，比例不能直接作为排名。</p><div class="today-actions"><a class="button" href="#publish">文章发布与访问记录</a><a class="button" href="#reports">完整报告</a>${simpleWrite()?btn('设置每周证据报告','simple-weekly'):''}${isOwner()?btn('调整关注平台','simple-platforms'):''}</div></details>`;
}
async function refreshSimple(){
 if(simpleLoading||!brand().id)return;const scope=simpleScope(),id=brand().id;simpleLoading=true;
 try{const d=await apiRequest('/api/simple/flows?brandId='+encodeURIComponent(id));if(scope!==simpleScope())return;simpleFlows=d.flows;simpleFlowScope=scope;simpleError='';if(route==='today')render();}catch(e){simpleError=e.message;}finally{simpleLoading=false;}
}
function simpleDecorate(){
 window.GEO_LIGHT?.mount();
 clearTimeout(simpleRefreshTimer);
 if(state.viewMode!=='simple'||!brand().id)return;
 if(route==='today'&&simpleFlowScope!==simpleScope())void refreshSimple();
 if(route==='today'&&runtimeContext.background?.enabled&&simpleFlows.some(f=>!f.paused&&['writing','checking'].includes(f.stage)))simpleRefreshTimer=setTimeout(()=>{if(!runtimeBusy&&!pendingSnapshot&&!savingPromise&&!$('#drawer').open)void reloadWorkspace().then(refreshSimple).catch(()=>{});},12000);
}
function simpleCapture(qid,platform){
 const q=own('questions').find(q=>q.id===qid)||own('questions').find(q=>q.text.trim()===brand().goalQuery?.trim())||own('questions')[0];if(!q){toast('请先添加一个用户问题');go('monitor');return;}
 answerImportAction('import-answer',{dataset:{id:q.id}});const f=document.querySelector('[data-answer-import]');f.dataset.simple='capture';
 f.elements.platform.value=SIMPLE_ENTRIES[platform]?platform:simplePlatforms()[0]||'豆包';f.elements.mode.value='未记录';f.elements.region.value='未记录';f.elements.language.value='未记录';
 const advanced=document.createElement('details');advanced.className='simple-detail';advanced.innerHTML='<summary>历史版本与其他采样条件</summary>';
 const keep=new Set(['questionId','platform','entry','dataPurpose','mode','text','collectedAt','citations','recommendation','citationKnown']);for(const el of [...f.children]){if(el.matches('.form-error,button[type="submit"]'))continue;const input=el.querySelector('[name]');if(input&&keep.has(input.name)||el.matches('[data-citation-candidates]')||el.dataset.action==='answer-citations-extract')continue;advanced.append(el);}
 f.elements.recommendation.closest('label').firstChild.textContent='回答是否明确推荐当前对象？';const intro=document.createElement('div');intro.innerHTML=`<p class="simple-question" data-simple-question>${esc(q.text)}</p><div class="form-actions">${btn('复制问题','simple-copy','','type="button"')} <a class="button" data-simple-entry target="_blank" rel="noopener noreferrer" href="${SIMPLE_ENTRIES[f.elements.platform.value]}">打开${esc(f.elements.platform.value)}</a></div><p class="simple-help">在平台新会话开启联网搜索，复制问题提问，再把实际回答粘贴回来。模式、时间与引用按平台实际情况填写；未核对时保持未知。</p>`;f.prepend(intro);f.prepend(f.elements.questionId.closest('label'));f.insertBefore(advanced,f.querySelector('.form-error'));f.querySelector('button[type="submit"]').textContent='保存这条回答';$('#drawer-title').textContent='记录 AI 平台的实际回答';
}
async function simpleAction(name,el){
 if(name==='simple-select-platform'){if(simplePlatforms().includes(el.dataset.platform)){simpleActivePlatform=el.dataset.platform;render();document.querySelector('.platform-tab[aria-selected="true"]')?.focus({preventScroll:true});}return true;}
 if(name==='edit-publication'&&state.viewMode==='simple'){const p=own('publications').find(p=>p.id===el.dataset.id);if(!p)return true;openDrawer('保存平台结果',publicationForm(p),'填写实际状态与公开文章链接');simplifyPublicationForm();return true;}
 if(name==='capture-start'&&state.viewMode==='simple'){simpleCapture(el.dataset.id,el.dataset.platform);return true;}
 if(name==='select-brand'&&state.viewMode==='simple'){state.currentBrand=el.dataset.id;state.scope='import';save();go('today');render();return true;}
 if(name==='new-brand'&&state.viewMode==='simple'){simpleDraft=null;state.simpleSetupDraft=null;save();go('setup');return true;}
 if(!name.startsWith('simple-'))return false;
 if(name==='simple-full-view'){state.viewMode='operator';save();go('overview');render();return true;}
 if(name==='simple-goal'){
  const b=brand();openDrawer('希望在哪个问题里被找到？',`<form data-simple="goal"><label class="field">对象类型<select name="entityType">${simpleTypeOptions(b.entityType)}</select></label><label class="field">目标问题<input name="goalQuery" required maxlength="500" value="${esc(b.goalQuery||'')}" placeholder="例如：杭州做 FDE 有哪些人？"><small>不加入自己的名字，才能观察 AI 是否主动推荐。</small></label><p class="simple-help">保存后加入问题列表，保留已有回答与历史问题。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存目标</button></form>`);return true;
 }
 if(name==='simple-read-source'){
  const f=el.closest('form'),v=Object.fromEntries(new FormData(f)),error=f.querySelector('.form-error');error.textContent='';
  if(!v.text.trim()&&!v.url){error.textContent='粘贴资料、上传文件或填写读取网址后再试。';return true;}
  runtimeLock(true);try{await runtimeFlush();const d=await apiRequest('/api/simple/source',{method:'POST',body:JSON.stringify(v.text.trim()?{text:v.text,source:v.source}:{url:v.url})});simpleDraft={...simpleDraft,...d,name:v.name.trim()||d.name,description:v.description.trim()||d.description,entityType:v.entityType,goalQuery:v.goalQuery,site:v.site||d.site,platforms:new FormData(f).getAll('platforms')};state.simpleSetupDraft=simpleDraft;save();await runtimeFlush();runtimeLock(false);render();toast('资料已填入，请核对后保存');}catch(e){error.textContent=e.message;}finally{runtimeLock(false);}return true;
 }
 if(name==='simple-cancel-parse'){simpleParseCancel?.();return true;}
 if(name==='simple-setup-back'){simpleDraft=null;state.simpleSetupDraft=null;save();render();return true;}
 if(name==='simple-capture'){simpleCapture(el.dataset.id,el.dataset.platform);return true;}
 if(name==='simple-copy'){const f=el.closest('form'),q=own('questions').find(q=>q.id===f.elements.questionId.value);await navigator.clipboard.writeText(captureQuestion(f));toast('问题已复制');return true;}
 if(name==='simple-copy-article'){const p=own('publications').find(p=>p.id===el.dataset.id);if(p?.handoffSnapshot){await navigator.clipboard.writeText(p.handoffSnapshot.text);toast('审核稿已复制，去平台粘贴即可');}return true;}
 if(name==='simple-evidence'){showAnswers(own('answers').filter(a=>!a.demo&&a.surface==='import'&&a.platform===el.dataset.platform),el.dataset.platform+' · 真实回答');return true;}
 if(name==='simple-refresh'){await reloadWorkspace();await refreshSimple();return true;}
 if(name==='simple-tick'){runtimeLock(true);try{await runtimeFlush();await apiRequest('/api/simple/tick',{method:'POST',body:JSON.stringify({brandId:brand().id})});await reloadWorkspace();await refreshSimple();}finally{runtimeLock(false)}return true;}
 if(name==='simple-flow-action'){await apiRequest('/api/simple/action',{method:'POST',body:JSON.stringify({brandId:brand().id,id:el.dataset.id,action:el.dataset.mode})});await refreshSimple();return true;}
 if(name==='simple-platforms'){openDrawer('关注哪些 AI 平台',`<form data-simple="platforms"><div class="simple-platforms">${Object.keys(SIMPLE_ENTRIES).map(p=>`<label><input type="checkbox" name="platforms" value="${esc(p)}" ${simplePlatforms().includes(p)?'checked':''}>${esc(p)}</label>`).join('')}</div><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存关注平台</button></form>`);return true;}
 if(name==='simple-local-draft'){await action('new-content',{dataset:{id:el.closest('form')?.elements.questionId.value||own('questions').find(q=>q.text.trim()===brand().goalQuery?.trim())?.id||''}});return true;}
 if(name==='simple-prepare'){
  if(!own('questions').length){toast('先设定一个用户会问的问题');go('monitor');return true;}
  if(!serverConnections.length){await action('new-content',{dataset:{id:own('questions').find(q=>q.text.trim()===brand().goalQuery?.trim())?.id||''}});return true;}
  openDrawer('自动准备一篇内容',`<form data-simple="prepare" data-id="${uid()}"><label class="field">先回答哪个用户问题<select name="questionId">${own('questions').map(q=>`<option value="${esc(q.id)}" ${q.text.trim()===brand().goalQuery?.trim()?'selected':''}>${esc(q.text)}</option>`).join('')}</select></label><label class="field">使用我的写作模型<select name="provider">${serverConnections.map(c=>`<option value="${esc(c.provider)}">${esc(c.model)}</option>`).join('')}</select></label><p>系统依次生成 1 篇草稿、进行 1 次内容质检，然后等你审核。通常 2 次模型请求，失败重试可能增加次数；按你的供应商账号计费并受已有预算限制。</p><p>不会自动公开发布。后台已开启时可关闭网页等待；否则在工作台的内容进度卡片上点击“执行下一步”。</p>${isLocalRuntime()&&isOwner()&&!runtimeContext.background?.enabled?'<label class="auto-option"><input type="checkbox" name="enableBackground">同时开启本机后台，自动完成后续步骤（包括已有启用任务）</label>':''}${isOwner()?btn('查看 / 设置费用预算','budget-open','small','type="button"'):''}<p class="form-error" role="alert"></p><button class="button primary" type="submit">确认用我的模型准备内容</button> ${btn('先用本地模板，不调用模型','simple-local-draft','ghost','type="button"')}</form>`);return true;
 }
 if(name==='simple-weekly'){
  await refreshReportArchives();const row=reportScheduleData.find(r=>r.frequency==='weekly'&&r.surface==='import'&&!r.options?.productId);
  openDrawer('自动整理每周结果',`<form data-simple="weekly" data-id="${esc(row?.id||'')}" data-revision="${row?.revision||0}"><p>每周归档已有真实回答，不调用模型，不发送外部消息。需开启本机后台，电脑离线时延后。</p><label class="auto-option"><input type="checkbox" name="enabled" ${row?.enabled!==false?'checked':''}>启用每周报告</label><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存周报设置</button></form>`);return true;
 }
 return false;
}
let simpleParseCancel=null;
document.addEventListener('change',async e=>{
 const f=e.target.closest('form');if(!f)return;
 if(f.dataset.simple==='capture'){
  if(e.target.name==='platform'){const a=f.querySelector('[data-simple-entry]');a.href=SIMPLE_ENTRIES[e.target.value];a.textContent='打开'+e.target.value;}
  if(['questionId','questionVersion'].includes(e.target.name)){const q=own('questions').find(x=>x.id===f.elements.questionId.value);f.querySelector('[data-simple-question]').textContent=answerImportVersions(q).find(v=>(v.version||'v1')===f.elements.questionVersion.value)?.text||q.text;}
 }
 if(!e.target.matches('[data-simple-file]'))return;const file=e.target.files?.[0];if(!file||simpleReading)return;
 const status=f.querySelector('[data-simple-progress]'),error=f.querySelector('.form-error');let worker,timer;simpleReading=true;runtimeLock(true);error.textContent='';const cancel=f.querySelector('[data-action="simple-cancel-parse"]');cancel.hidden=false;f.inert=false;document.querySelector('#main').inert=false;f.querySelectorAll('input,textarea,button[type="submit"]').forEach(x=>x.disabled=true);
 try{
  if(file.size>8*1024*1024)throw new Error('资料超过 8 MB，请拆分后上传');status.textContent='正在本机解析资料…';
  const bytes=await file.arrayBuffer();worker=new Worker('/document-parser-worker.js',{type:'module'});
  const extraction=await new Promise((resolve,reject)=>{const finish=(err,result)=>{clearTimeout(timer);err?reject(err):resolve(result)};timer=setTimeout(()=>finish(new Error('解析超时，请拆分资料或粘贴文字')),480000);simpleParseCancel=()=>finish(new Error('已取消解析，可以粘贴文字继续'));
   worker.onmessage=e=>{if(e.data.progress){status.textContent=`正在解析第 ${e.data.progress.page} / ${e.data.progress.total} 页…`;return;}finish(e.data.error?new Error(e.data.error):null,e.data.result)};worker.onerror=()=>finish(new Error('解析组件未能加载，请刷新或粘贴文字'));
   worker.postMessage({bytes,filename:file.name,ocrMode:'auto',language:'chi_sim+eng'},[bytes]);
  });
  const text=extraction.blocks.map(b=>b.text).join('\n\n');if(text.length>50000)throw new Error('抽取结果超过 5 万字，请拆分资料再试');if(text.trim().length<8)throw new Error('没有取得足够文字，请粘贴业务介绍');
  f.elements.text.value=text;f.elements.source.value=file.name;f.elements.url.value='';simpleDraft={...simpleDraft,text,source:file.name,url:''};state.simpleSetupDraft=simpleDraft;save();status.textContent='已提取文字，请核对后继续。'+(extraction.ocr?'包含 OCR 识别，请对照原件确认。':'');
 }catch(err){error.textContent=err.message;}finally{clearTimeout(timer);worker?.terminate();simpleParseCancel=null;simpleReading=false;cancel.hidden=true;f.querySelectorAll('input,textarea,button[type="submit"]').forEach(x=>x.disabled=false);runtimeLock(false);}
});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-simple]');if(!f||f.dataset.simple==='capture')return;e.preventDefault();if(runtimeBusy)return;
 const mode=f.dataset.simple,v=Object.fromEntries(new FormData(f)),error=f.querySelector('.form-error');runtimeLock(true);error.textContent='';
 try{
  await runtimeFlush();
  if(mode==='source'){
   if(!v.text.trim()&&!v.url)throw new Error('提供一个网址或一份业务介绍即可');
   const d=await apiRequest('/api/simple/source',{method:'POST',body:JSON.stringify(v.text.trim()?{text:v.text,source:v.source}:{url:v.url})});simpleDraft={...d,id:uid()};state.simpleSetupDraft=simpleDraft;save();await runtimeFlush();runtimeLock(false);render();
  }
  if(mode==='setup'){
   const payload={...simpleDraft,...v,text:v.text?.trim()||v.description,source:v.source||'用户确认的公开介绍',id:f.dataset.id,platforms:new FormData(f).getAll('platforms'),confirmed:true};
   const serialized=JSON.stringify(payload);if(f.dataset.submitted&&f.dataset.submitted!==serialized)throw new Error('上次保存结果尚待确认，请保持原资料重试，或刷新查看已有对象');f.dataset.submitted=serialized;
   const d=await apiRequest('/api/simple/setup',{method:'POST',body:JSON.stringify(payload)});state=d.state;serverRevision=d.revision;state.simpleSetupDraft=null;simpleDraft=null;save();await runtimeFlush();runtimeLock(false);go('today');render();toast('资料和 5 个初始问题已保存');
  }
  if(mode==='goal'){
   const b=brand(),d=await apiRequest('/api/brands/profile',{method:'POST',body:JSON.stringify({...b,...v,brandId:b.id,revision:serverRevision})});state=d.state;serverRevision=d.revision;runtimeLock(false);closeDrawer();render();toast('目标问题已保存');
  }
  if(mode==='platforms'){
   const values=new FormData(f).getAll('platforms');if(!values.length)throw new Error('至少关注一个平台');brand().platforms=values;save();await runtimeFlush();runtimeLock(false);closeDrawer();render();
  }
  if(mode==='prepare'){
   const payload={...v,id:f.dataset.id,brandId:brand().id};
   const serialized=JSON.stringify(payload);if(f.dataset.submitted&&f.dataset.submitted!==serialized)throw new Error('上次任务可能已创建，请恢复原选择重试，或关闭后刷新进度');f.dataset.submitted=serialized;
   await apiRequest('/api/simple/prepare',{method:'POST',body:serialized});if(f.elements.enableBackground?.checked){const r=await apiRequest('/api/local/runner',{method:'POST',body:JSON.stringify({enabled:true})});runtimeContext.background=r.background;}runtimeLock(false);closeDrawer();simpleFlowScope='';go('today');render();await refreshSimple();toast('内容准备已排队；按进度执行或开启后台');
  }
  if(mode==='weekly'){
   await apiRequest('/api/reports/schedule',{method:'POST',body:JSON.stringify({brandId:brand().id,revision:Number(f.dataset.revision),frequency:'weekly',surface:'import',enabled:f.elements.enabled.checked,options:{platform:'',mode:'',entry:'',version:'all',productId:''}})});runtimeLock(false);closeDrawer();toast('每周报告设置已保存；后台在线时自动归档');
  }
 }catch(err){if(err.status&&err.status<500&&err.status!==409)delete f.dataset.submitted;error.textContent=err.message;}finally{runtimeLock(false);}
});
document.addEventListener('input',e=>{
 const f=e.target.closest('[data-simple="setup"]');if(!f||!simpleDraft||runtimeBusy)return;
 simpleDraft={...simpleDraft,...Object.fromEntries(new FormData(f)),platforms:new FormData(f).getAll('platforms')};delete simpleDraft.file;state.simpleSetupDraft=simpleDraft;save();
});

function simplifyPublicationForm(){
 const f=document.querySelector('[data-form="publication"]');if(!f)return;
 const details=document.createElement('details');details.className='simple-detail';details.innerHTML='<summary>文章信息、账号与复测设置</summary>';
 for(const el of [...f.children]){if(el.matches('.form-error,.form-actions'))continue;const input=el.querySelector('[name]');if(input&&['url','publicationStage','platformNote'].includes(input.name))continue;details.append(el);}
 f.insertBefore(details,f.querySelector('.form-error'));
}
function simplePublicationJourney(p){
 const snapshot=p.handoffSnapshot,c=own('contents').find(c=>c.id===p.contentId);
 openDrawer(p.url?'检查这篇文章的实际结果':'把这篇稿件发布出去',`<h3>${esc(p.title)}</h3><p>${esc(p.channel)} · ${esc(GEO_PUBLICATION.publicationStatus(p))}</p>${!p.url?`<p>审核稿已经固定，先到平台发布，再保存平台实际显示的结果。</p><div class="form-actions">${snapshot?btn('复制审核稿','simple-copy-article','primary',`data-id="${esc(p.id)}"`)+btn('下载稿件','handoff-download','',`data-id="${esc(p.id)}"`):''}${p.entryUrl?links(p.entryUrl,'打开发布平台'):''}</div>${btn('保存平台结果 / 文章链接','edit-publication','primary',`data-id="${esc(p.id)}"`)}`:`<p>${links(p.url,'查看公开文章')}</p>${GEO_PUBLICATION.canCheckPublication(p)?btn('检查文章链接','publication-check-run','primary',`data-id="${esc(p.id)}"`):''}${btn('重新检测 AI 平台','simple-capture','',`data-id="${esc(c?.questionId||'')}"`)}${btn('更新平台结果','edit-publication','small',`data-id="${esc(p.id)}"`)}`}<details class="simple-detail"><summary>更多发布方式与说明</summary><p>文章可访问、搜索收录和 AI 引用分别记录，不相互推断。后台在线时，已开启的公开链接复测按设置执行。</p><a href="#publish" data-close>自有 WordPress 网站连接与直接发布 →</a></details>`,'审核稿 → 实际平台结果');
}
