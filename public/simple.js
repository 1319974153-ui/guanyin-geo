/* Simple mode orchestrates existing services; it does not fabricate platform results. */
const SIMPLE_ENTRIES={'豆包':'https://www.doubao.com/chat/','DeepSeek':'https://chat.deepseek.com/','Kimi':'https://www.kimi.com/','腾讯元宝':'https://yuanbao.tencent.com/','通义千问':'https://www.qianwen.com/','文心':'https://yiyan.baidu.com/','ChatGPT':'https://chatgpt.com/'};
let simpleDraft=null,simpleFlows=[],simpleFlowScope='',simpleLoading=false,simpleError='',simpleRefreshTimer=null,simpleReading=false;
function simplePlatforms(){return brand().platforms?.filter(p=>SIMPLE_ENTRIES[p])||Object.keys(SIMPLE_ENTRIES)}
function simpleScope(){return [accessInfo.current.owner,sessionStorage.getItem('geo.workspace')||'',brand().id].join('|')}
function simpleWrite(){return ['owner','admin','editor'].includes(accessInfo.current.role)}
function simpleReview(){return ['owner','admin','reviewer'].includes(accessInfo.current.role)}
function simpleBrandPicker(){return state.brands.length>1?`<label class="simple-toolbar">当前业务<select id="brand-select">${state.brands.map(b=>`<option value="${esc(b.id)}" ${brand().id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}
function renderSimpleNavigation(){
 const count=own('facts').filter(f=>f.status==='待确认').length+own('contents').filter(c=>c.status!=='已审核').length;
 $('#nav').innerHTML=[['today','今天','dashboard'],['inbox','待我确认','edit'],['results','效果','chart']].map(([id,t,i])=>`<a class="nav-item ${route===id?'active':''}" href="#${id}" ${route===id?'aria-current="page"':''}>${icon(i)}<span>${t}</span>${id==='inbox'&&count?`<span class="nav-num">${count}</span>`:''}</a>`).join('')+`<details class="simple-detail"><summary>更多工具</summary>${[['knowledge','业务资料'],['monitor','客户问题'],['publish','发布记录'],['reports','完整报告'],['integrations','模型与账号'],['tasks','任务记录'],['brands','切换 / 新建业务']].map(([id,t])=>`<a class="nav-item" href="#${id}">${t}</a>`).join('')}</details>`;
 $('#view-mode').value='simple';document.body.dataset.view='simple';
}
function simpleCard(title,body,actions=''){return `<section class="simple-card"><h3>${title}</h3>${body}${actions}</section>`}
function renderSimpleSetup(){
 const d=simpleDraft ||= state.simpleSetupDraft||null;
 return `<div class="simple-setup">${title(d?'核对你的业务介绍':'先告诉观引，你在做什么',d?'改正不准确的地方，其他交给系统整理。':'提供一个网址或一份资料，不用逐项填写。')}<section class="simple-hero">${d?`<form data-simple="setup" data-id="${esc(d.id)}"><label class="field">业务名称<input name="name" value="${esc(d.name)}" required maxlength="160"></label><label class="field">业务介绍<textarea name="description" required maxlength="5000">${esc(d.description)}</textarea><small>请核对服务对象、产品和优势。这里只使用你确认的介绍来写作。</small></label><details class="simple-detail"><summary>查看原始资料 · ${esc(d.source)}</summary><div class="answer-text">${esc(d.text)}</div></details><p>希望在哪些 AI 平台被找到？</p><div class="simple-platforms">${Object.keys(SIMPLE_ENTRIES).map(p=>`<label><input type="checkbox" name="platforms" value="${esc(p)}" checked>${esc(p)}${p==='豆包'?' · 优先':''}</label>`).join('')}</div><p class="simple-help">自动建立 5 个可修改的客户问题建议。此步骤不调用付费模型，也不代表已被 AI 收录。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">介绍准确，建立工作区</button> ${btn('重新提供资料','simple-setup-back','','type="button"')}</form>`:`<form data-simple="source"><label class="field">官网或产品页网址<input name="url" type="url" placeholder="https://你的业务网站"></label><p class="simple-help">没有网站？上传资料或直接粘贴介绍即可。</p><label class="file-picker">上传业务资料<input type="file" name="file" data-simple-file accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"></label><label class="field">业务资料<textarea name="text" maxlength="50000" placeholder="例如：观引是一个本地部署的 GEO 工作台，帮助业务运营人员整理资料、准备内容并验证 AI 是否提及业务。"></textarea></label><input type="hidden" name="source" value="用户提供的业务介绍"><button type="button" class="button small" data-action="simple-cancel-parse" hidden>取消文件解析</button><p class="simple-help" data-simple-progress>PDF / Word / 文本 / 图片，最多 8 MB。识别后可修改；本地解析不调用付费模型。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">整理我的业务资料</button></form>`}</section></div>`;
}
function simpleFlowCards(){
 if(simpleFlowScope!==simpleScope())return '<p class="simple-help">正在读取工作进度…</p>';
 return simpleFlows.slice(0,4).map(f=>{
 const labels={writing:'正在准备草稿',checking:'正在检查草稿',review:'草稿已准备好，等你确认',needs_attention:'需要处理后继续'};
 return simpleCard(f.paused?'流程已暂停':labels[f.stage]||'正在处理',`<p>${esc(own('questions').find(q=>q.id===f.questionId)?.text||'历史问题')}</p>${f.error?`<p class="simple-issue">${esc(f.error)}</p>`:''}${f.issues?.length?`<p class="simple-issue">${esc(f.issues[0].error||taskStates[f.issues[0].status])}</p><a href="#tasks">查看失败原因与恢复操作 →</a>`:''}`,f.stage==='review'?'<a class="button primary" href="#inbox">查看稿件</a>':simpleWrite()?btn(f.paused?'继续流程':'暂停流程','simple-flow-action','small',`data-id="${esc(f.id)}" data-mode="${f.paused?'resume':'pause'}"`):'');
 }).join('');
}
function renderSimpleToday(){
 const b=brand(),qs=own('questions'),pending=own('facts').filter(f=>f.status==='待确认'),usable=own('facts').some(GEO_KNOWLEDGE.factUsable),answers=own('answers').filter(a=>a.surface==='import'&&!a.demo&&a.status==='ok');
 const next=!usable?'先核对业务资料':!qs.length?'先准备客户问题':'先完成一轮小范围验证';
 const main=!usable?'<a class="button primary" href="#inbox">核对业务资料</a>':!qs.length?'<a class="button primary" href="#monitor">添加客户问题</a>':simpleWrite()?btn('准备一篇内容','simple-prepare','primary')+btn('去豆包等平台检测','simple-capture'):'<a class="button primary" href="#results">查看已有结果</a>';
 return title('今天',`${esc(b.name)} · 豆包优先，也关注其他 AI 平台。`)+simpleBrandPicker()+`<div class="simple-stack"><section class="simple-hero"><span class="simple-eyebrow">下一步</span><h2>${next}</h2><p>${!usable?'上传业务资料，核对后即可生成内容。':`系统已保存 ${qs.length} 个问题、${answers.length} 条真实采样记录。内容准备和平台检测可以分别进行。`}</p>${main}</section><div class="simple-grid">${simpleCard('只处理需要你的事',`<p>${pending.length} 项资料待确认，${own('contents').filter(c=>c.status!=='已审核').length} 篇稿件待处理。</p>`,'<a class="button" href="#inbox">打开待我确认</a>')}${simpleCard('关注的 AI 平台',`<p>${simplePlatforms().map(esc).join('、')}</p><p class="simple-help">各平台使用真实回答独立统计。</p>`,isOwner()?btn('调整关注平台','simple-platforms','small'):'')}</div><section><h2>工作进度</h2><p class="simple-help">${runtimeContext.background?.enabled?'本机后台已开启，关闭网页后继续；电脑休眠或关机期间暂停。':'后台未开启。可在下方执行下一步，或开启后台自动推进。'}</p>${simpleWrite()?btn('执行下一步并刷新','simple-tick','small')+btn('刷新进度','simple-refresh','small'):''}${isLocalRuntime()&&isOwner()?btn(runtimeContext.background?.enabled?'暂停本机后台':'开启本机后台','local-runner-toggle','small',`data-enabled="${!runtimeContext.background?.enabled}"`):''}<p class="simple-error" role="alert">${esc(simpleError)}</p><div class="simple-grid">${simpleFlowCards()||'<p class="simple-help">还没有自动内容任务。点击“准备一篇内容”开始。</p>'}</div></section></div>`;
}
function renderSimpleInbox(){
 const facts=own('facts').filter(f=>f.status==='待确认'),contents=own('contents').slice().reverse(),pubs=own('publications').filter(p=>!p.url&&!p.demo);
 return title('待我确认','系统先整理，你只核对资料、稿件和平台结果。')+simpleBrandPicker()+`<div class="simple-stack">${!own('facts').length?simpleCard('补充业务资料','<p>上传现有介绍，不必逐条创建事实。</p>',simpleWrite()?btn('上传资料','knowledge-upload','primary')+btn('粘贴介绍','import-document'):''):''}${facts.map(f=>simpleCard(esc(f.key),`<p>${esc(f.value)}</p><small>出处：${esc(f.source)}</small>`,simpleReview()?btn('核对这项资料','confirm-fact','primary',`data-id="${esc(f.id)}"`):'')).join('')}${contents.map(c=>simpleCard(esc(c.title),`<p>${esc(c.status)} · ${esc(c.question||'已保存的稿件')}</p>${contentCheckSummary(c)}`,btn(c.status==='已审核'?'查看稿件':'修改 / 核对稿件','edit-content','primary',`data-id="${esc(c.id)}"`)+(c.status==='已审核'&&simpleWrite()?btn('准备发布','publish-content','',`data-id="${esc(c.id)}"`):''))).join('')}${pubs.map(p=>simpleCard(esc(p.title),`<p>${esc(p.channel)} · 等待实际平台结果</p>`,btn('继续发布与登记','publication-journey','primary',`data-id="${esc(p.id)}"`))).join('')}${facts.length||contents.length||pubs.length?'':'<div class="simple-empty"><h2>目前没有待确认内容</h2><p>回到今天，开始准备第一篇内容。</p><a class="button" href="#today">返回今天</a></div>'}</div>`;
}
function renderSimpleResults(){
 const all=own('answers').filter(a=>a.surface==='import'&&!a.demo&&a.status==='ok'),platforms=[...new Set([...simplePlatforms(),...all.map(a=>a.platform)])];
 return title('效果','只展示实际取得的回答。未采样不代表搜不到。',simpleWrite()?btn('检测 AI 平台','simple-capture','primary'):'')+simpleBrandPicker()+`<div class="simple-grid">${platforms.map(p=>{const a=all.filter(a=>a.platform===p),m=GEO_METRICS.aggregate(a,brand());return simpleCard(esc(p),`<div class="simple-count">${a.length?m.mention+' / '+a.length:'尚未采样'}</div><p>${a.length?'条回答提及业务':'还没有这个平台的真实回答'}</p>${a.length?`<p class="simple-help">适用推荐：${m.rec} / ${m.recommendationN} 条已核对回答<br>官网引用：${m.official} / ${m.citationN} 条已核对回答<br>最近采样：${esc(new Date(a.map(x=>x.date).sort().at(-1)).toLocaleString('zh-CN'))}</p>`:''}`,(simpleWrite()?btn(a.length?'继续检测':'开始检测','simple-capture','small',`data-platform="${esc(p)}"`):'')+(a.length?btn('查看原始回答','simple-evidence','small',`data-platform="${esc(p)}"`):''))}).join('')}</div><section class="simple-hero" style="margin-top:20px"><h2>持续追踪</h2><p>公开链接检查和已有证据周报可以自动执行。消费端尚未取得的回答不会补造。</p>${simpleWrite()?btn('开启 / 调整每周报告','simple-weekly'):''}<a class="button" href="#publish">文章链接与复测</a><a class="button" href="#reports">完整报告与历史</a><details class="simple-detail"><summary>查看口径</summary><p>以上为当前业务全部正式消费端记录，不含试用和模型 API 测试。问题、时间和平台条件可能不同，不能直接把平台间比例当成排名。推荐和引用的未知状态不计入已核对分母。</p></details></section>`;
}
async function refreshSimple(){
 if(simpleLoading||!brand().id)return;const scope=simpleScope(),id=brand().id;simpleLoading=true;
 try{const d=await apiRequest('/api/simple/flows?brandId='+encodeURIComponent(id));if(scope!==simpleScope())return;simpleFlows=d.flows;simpleFlowScope=scope;simpleError='';if(route==='today')render();}catch(e){simpleError=e.message;}finally{simpleLoading=false;}
}
function simpleDecorate(){
 clearTimeout(simpleRefreshTimer);
 if(state.viewMode!=='simple'||!brand().id)return;
 if(route==='today'&&simpleFlowScope!==simpleScope())void refreshSimple();
 if(route==='today'&&runtimeContext.background?.enabled&&simpleFlows.some(f=>!f.paused&&['writing','checking'].includes(f.stage)))simpleRefreshTimer=setTimeout(()=>{if(!runtimeBusy&&!pendingSnapshot&&!savingPromise&&!$('#drawer').open)void reloadWorkspace().then(refreshSimple).catch(()=>{});},12000);
}
function simpleCapture(qid,platform){
 const q=own('questions').find(q=>q.id===qid)||own('questions')[0];if(!q){toast('请先添加一个客户问题');go('monitor');return;}
 answerImportAction('import-answer',{dataset:{id:q.id}});const f=document.querySelector('[data-answer-import]');f.dataset.simple='capture';
 f.elements.platform.value=SIMPLE_ENTRIES[platform]?platform:'豆包';f.elements.mode.value='未记录';f.elements.region.value='未记录';f.elements.language.value='未记录';
 const advanced=document.createElement('details');advanced.className='simple-detail';advanced.innerHTML='<summary>采样条件、历史回答和引用核对</summary>';
 const keep=new Set(['platform','text','collectedAt']);for(const el of [...f.children]){if(el.matches('.form-error,button[type="submit"]'))continue;const input=el.querySelector('[name]');if(input&&keep.has(input.name)||el.matches('[data-citation-candidates]')||el.dataset.action==='answer-citations-extract')continue;advanced.append(el);}
 const intro=document.createElement('div');intro.innerHTML=`<p class="simple-question" data-simple-question>${esc(q.text)}</p><div class="form-actions">${btn('复制问题','simple-copy','','type="button"')} <a class="button" data-simple-entry target="_blank" rel="noopener noreferrer" href="${SIMPLE_ENTRIES[f.elements.platform.value]}">打开${esc(f.elements.platform.value)}</a></div><p class="simple-help">在平台新会话中提问，把实际回答粘贴回来。时间已预填，请核对；历史回答请改成实际采样时间。引用与推荐未核对时保持未知。</p>`;f.prepend(intro);f.insertBefore(advanced,f.querySelector('.form-error'));f.querySelector('button[type="submit"]').textContent='保存这条回答';$('#drawer-title').textContent='AI 平台检测';
}
async function simpleAction(name,el){
 if(name==='edit-publication'&&state.viewMode==='simple'){const p=own('publications').find(p=>p.id===el.dataset.id);if(!p)return true;openDrawer('保存平台结果',publicationForm(p),'填写实际状态与公开文章链接');simplifyPublicationForm();return true;}
 if(name==='capture-start'&&state.viewMode==='simple'){simpleCapture(el.dataset.id,el.dataset.platform);return true;}
 if(!name.startsWith('simple-'))return false;
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
 if(name==='simple-prepare'){
  if(!serverConnections.length){openDrawer('先连接你的写作模型','<p>写作模型与你要检测的 AI 平台可以不同。配置一次后重复使用；密钥属于你。</p>'+btn('配置豆包 / 方舟','configure-model','primary','data-provider="ark"')+btn('配置 DeepSeek','configure-model','','data-provider="deepseek"'));return true;}
  openDrawer('自动准备一篇内容',`<form data-simple="prepare" data-id="${uid()}"><label class="field">先回答哪个客户问题<select name="questionId">${own('questions').map(q=>`<option value="${esc(q.id)}">${esc(q.text)}</option>`).join('')}</select></label><label class="field">使用我的写作模型<select name="provider">${serverConnections.map(c=>`<option value="${esc(c.provider)}">${esc(c.model)}</option>`).join('')}</select></label><p>系统依次生成 1 篇草稿、进行 1 次内容质检，然后等你审核。通常 2 次模型请求，失败重试可能增加次数；按你的供应商账号计费并受已有预算限制。</p><p>不会自动公开发布。后台已开启时可关闭网页等待；否则在“今天”执行下一步。</p>${isLocalRuntime()&&isOwner()&&!runtimeContext.background?.enabled?'<label class="auto-option"><input type="checkbox" name="enableBackground">同时开启本机后台，自动完成后续步骤（包括已有启用任务）</label>':''}${isOwner()?btn('查看 / 设置费用预算','budget-open','small','type="button"'):''}<p class="form-error" role="alert"></p><button class="button primary" type="submit">确认用我的模型准备内容</button></form>`);return true;
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
  f.elements.text.value=text;f.elements.source.value=file.name;f.elements.url.value='';status.textContent='已提取文字，请核对后继续。'+(extraction.ocr?'包含 OCR 识别，请对照原件确认。':'');
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
   const payload={...simpleDraft,...v,id:f.dataset.id,platforms:new FormData(f).getAll('platforms'),confirmed:true};
   const d=await apiRequest('/api/simple/setup',{method:'POST',body:JSON.stringify(payload)});state=d.state;serverRevision=d.revision;state.simpleSetupDraft=null;simpleDraft=null;save();await runtimeFlush();runtimeLock(false);go('today');render();toast('业务和 5 个初始问题已保存');
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
 }catch(err){error.textContent=err.message;}finally{runtimeLock(false);}
});
document.addEventListener('input',e=>{
 const f=e.target.closest('[data-simple="setup"]');if(!f||!simpleDraft||runtimeBusy)return;
 simpleDraft={...simpleDraft,name:f.elements.name.value,description:f.elements.description.value};state.simpleSetupDraft=simpleDraft;save();
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
