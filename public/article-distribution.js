// One article, explicit targets, independent receipts. No paid synchronization service.
const distributionStateLabels={not_queued:'未发送',ready:'未发送',registered:'已登记，待发送',claim_pending:'发送确认中',sending:'发布中',draft:'草稿已保存',published:'发布成功',queued:'等待处理',preparing:'正在准备',submitting:'正在提交',prepared:'已填稿，未发布',submitted:'已提交，待确认',result_unknown:'结果待确认',uncertain:'结果待确认',needs_attention:'需要处理',cancelled:'已取消'};
const distributionModeLabels={publish:'发布文章',draft:'保存平台草稿',prepare:'仅填入编辑器'};
const distributionModeSelectLabels={publish:'全选可发布',draft:'全选可存草稿',prepare:'全选可填入'};
const distributionActionLabels={publish:'可直接发布',draft:'可保存草稿',prepare:'可填入编辑器'};
function distributionWechatTaskState(state){return ({opening_editor:'preparing',waiting_editor:'preparing',ready_to_request:'preparing',requesting:'submitting',waiting_receipt:'submitting',draft_requested:'submitting',publish_requested:'submitting',verification_required:'needs_attention',blocked:'needs_attention',filled:'needs_attention',draft_saved:'draft',publish_submitted:'submitted'})[state]||null}
function distributionPanel(){return `<section class="article-distribution" aria-label="发布账号与结果"><div class="distribution-heading"><div><h3>发布到哪些平台</h3><p>勾选已连接且支持当前操作的账号，统一发送并查看结果；需要本人验证时会提示。</p></div><button type="button" class="button small" data-distribution-refresh>刷新</button></div><div class="distribution-account-tools"><button type="button" class="button small" data-distribution-select-all>全选可发布</button><span data-distribution-count aria-live="polite">已选 0 个</span></div><details class="distribution-operation"><summary data-distribution-mode-summary>改为保存草稿或仅填入</summary><label class="distribution-mode">操作<select name="distributionMode" data-distribution-mode aria-label="发布操作"><option value="publish">发布文章</option><option value="draft">保存平台草稿</option><option value="prepare">仅填入编辑器</option></select></label></details><div class="distribution-submit-bar"><p data-distribution-hint class="helper" aria-live="polite">请选择平台。</p><p data-distribution-policy class="helper">本次仅执行一次；不创建定时任务、不自动重试，也不调用模型或付费同步服务。</p><input type="checkbox" name="distributionConfirmed" hidden><div data-distribution-readiness class="distribution-readiness" aria-live="polite"></div><div class="distribution-actions"><button type="button" class="button primary" data-distribution-send="publish" disabled>发布到已选平台</button></div></div><div data-distribution-accounts role="group" aria-label="全部发布平台"><p role="status">正在读取平台…</p></div><label class="field distribution-tags" hidden>文章标签<input name="distributionTags" placeholder="例如：软件测试，最多 5 个" maxlength="110"></label><details class="field distribution-media"><summary>配图（可选，随草稿保存）</summary><label>从电脑添加<input type="file" name="distributionMedia" accept="image/png,image/jpeg,image/webp" multiple></label><p class="helper">最多 9 张，单张 2 MB、合计 8 MB。本机保存后可重复使用；不会自动上传到平台。</p><button type="button" class="button small" data-distribution-media-library>从本品牌已存图片选择</button><div data-distribution-media-library-list></div><div data-distribution-media-list></div><label class="distribution-confirm"><input type="checkbox" name="distributionMediaRights">我有权将这些图片用于本稿发布</label><p data-distribution-media-status role="status"></p><button type="button" class="button small" data-distribution-media-clear>清空本稿配图</button></details><p class="form-error" data-distribution-error role="alert"></p><div data-distribution-results aria-live="polite"></div>${typeof publishSchedulePanel==='function'?publishSchedulePanel():''}<details class="distribution-more"><summary>账号设置与更多操作</summary><p>账号只需首次连接；登录失效时再处理。未接入的平台暂不能勾选。</p><button type="button" class="button small" data-distribution-manage>管理账号</button><button type="button" class="button small" data-distribution-manual>下载稿件</button></details></section>`}
function distributionResultLabel(row){if(row?.preflightFailed)return row.state==='draft'?'草稿已保存，本次未发布':'本次未发送';if(row?.preparation?.temporaryVerified)return '已暂存，未发布';if(row?.preparation?.autosaveObserved)return '已观察到平台自动保存，待草稿箱核对';return distributionStateLabels[row.state]||row.state}
function distributionTone(row){return row?.preflightFailed?'attention':row?.state==='published'?'success':['needs_attention','uncertain','result_unknown'].includes(row?.state)?'attention':row?.state==='draft'?'saved':'neutral'}
function distributionPlatformRows(platforms,targets){
 const catalog=[...(platforms||[])];for(const t of targets)if(!catalog.some(p=>p.id===t.platform))catalog.push({id:t.platform,name:t.detail||t.platform,implementation:'unknown'});
 return catalog.flatMap(p=>{const accounts=targets.filter(t=>t.platform===p.id),meta={platformName:p.name,implementation:p.implementation,actionEvidence:p.actionEvidence,evidenceUpdatedAt:p.evidenceUpdatedAt};return accounts.length?accounts.map(t=>({...t,...meta})):[{key:'catalog:'+p.id,platform:p.id,modes:[],placeholder:true,...meta}]});
}
function distributionCatalogCapability(t){const actions=t.actionEvidence||{};for(const [action,label] of [['publish','公开'],['draft','草稿'],['prepare','填稿']])if(actions[action]?.liveAcceptance==='passed')return actions[action].evidence?'有历史'+label+'记录':'历史验收记录待补齐';return actions.publish?.implemented||actions.draft?.implemented||actions.prepare?.implemented?'接入待验收':'待接入'}
// Catalog evidence describes a dated product test, never today's account permission.
function publishingEvidenceDetails(p,includeNote=false){
 const actions=Object.entries(p.actionEvidence||{});if(!actions.length)return '';
 const names={identity:'账号识别',prepare:'填入编辑器',draft:'平台草稿',publish:'公开提交'},date=/^\d{4}-\d{2}-\d{2}$/.test(p.evidenceUpdatedAt||'')?p.evidenceUpdatedAt:'';
 return `<details class="publishing-evidence-details"><summary>接入与历史验收</summary><p class="helper">${date?'记录更新于 '+esc(date):'记录更新日期未提供'}。历史记录仅适用于所列动作、版本与范围，不代表本次账号或稿件已验收。</p>${includeNote&&p.note?'<p class="helper">记录说明：'+esc(p.note)+'</p>':''}${actions.map(([action,e])=>{
  const historical=e.liveAcceptance==='passed',record=e.evidence,versions=[record?.productVersion?'观引 '+record.productVersion:'',record?.connectorVersion?'连接器 '+record.connectorVersion:''].filter(Boolean);
  const label=action==='prepare'&&!e.implemented&&distributionSelfHostedPlatforms.has(p.id||p.platform)?'接口发布无需填入网页编辑器':historical?(record?'有历史实机记录':'历史通过标记，详细记录待补齐'):e.liveAcceptance==='paused'?'验收已暂停':e.implemented?'已接入，待实机验收':'尚未接入';
  return '<p class="helper"><strong>'+esc(names[action]||action)+'：</strong>'+esc(label)+(historical?'<br>验收版本：'+esc(versions.join('；')||'未记录')+'<br>适用范围：'+esc(record?.scope||'未记录，不能推定当前可用'):'')+'</p>';
 }).join('')}</details>`;
}
function distributionPlatformStatus(t,mode,result){
 if(result)return distributionResultLabel(result);
 if(t.platform==='wechat'&&t.transport==='desktop_personal')return t.loginRequired?(t.taskId?'请登录后继续原任务':'需要登录'):'官方窗口登录后自动处理';
 if(t.implementation==='planned')return '待接入';
 if(t.placeholder)return '尚未连接账号';
 if(t.loginRequired)return '需要登录';
 if(!t.accountId)return '登录待核验';
 if(t.modes.includes(mode))return distributionActionLabels[mode]||'可选择';
 if(mode==='publish')return t.modes.includes('draft')?'本账号仅可保存草稿':t.modes.includes('prepare')?'本账号仅可填入编辑器':'暂未开放发布';
 if(mode==='draft')return t.modes.includes('prepare')?'本账号仅可填入编辑器':'暂不支持保存草稿';
 return '暂不支持填入';
}
function distributionCapabilitySummary(rows,mode){
 if(!rows.length)return '';
 const ready=rows.filter(t=>!t.loginRequired&&!!t.accountId&&t.modes.includes(mode)).length,waiting=rows.filter(t=>t.loginRequired||!t.accountId).length,other=rows.filter(t=>!t.loginRequired&&!!t.accountId&&!t.modes.includes(mode)).length;
 const parts=[ready?'可执行 '+ready+' 个账号':'暂无可执行账号'];if(waiting)parts.push('待登录 '+waiting+' 个');if(other)parts.push('需切换操作 '+other+' 个');
 return `<p class="distribution-availability-summary" role="status">当前${esc(distributionActionLabels[mode]||'操作')}：${esc(parts.join(' · '))}</p>`;
}
const distributionSelfHostedPlatforms=new Set(['wordpress','cnblogs','typecho','metaweblog','personal-site','yuque']);
const distributionExtensionPlatforms=new Set(['csdn','toutiao','zhihu','douyin','xiaohongshu']);
function distributionCanConnect(t){
 if(t.implementation==='planned'||!(t.placeholder||!t.accountId||t.loginRequired))return false;
 if(distributionSelfHostedPlatforms.has(t.platform))return true;
 // Desktop availability comes from the publishing catalog's implementation
 // value, so a newly declared official-window adapter appears here without a
 // second page-side whitelist. The catalog never grants publish permission.
 if(window.guanyinDesktop?.available)return ['browser_adapter_acceptance','desktop_personal_browser'].includes(t.implementation);
 return distributionExtensionPlatforms.has(t.platform);
}
function distributionPlatformRow(f,t,mode,selected){
  const result=f.distributionJournal?.[t.key],available=t.modes.includes(mode),planned=t.implementation==='planned';
  const status=distributionPlatformStatus(t,mode,result);
  const connect=distributionCanConnect(t);
 return `<div class="distribution-platform" data-distribution-row-key="${esc(t.key)}"><label class="distribution-account"><input type="checkbox" data-distribution-target value="${esc(t.key)}" aria-label="选择 ${esc(t.platformName)}${t.name?' · '+esc(t.name):''}" ${available&&selected.has(t.key)?'checked':''} ${available?'':'disabled'}><span><strong>${esc(t.platformName)}</strong>${t.name?'<span class="sub">'+esc(t.name)+'</span>':''}<span class="distribution-capability" data-distribution-row-status data-tone="${distributionTone(result)}">${esc(status)}</span></span></label>${connect?`<button type="button" class="button small" data-distribution-connect="${esc(t.platform)}" aria-label="连接 ${esc(t.platformName)}">连接</button>`:''}${planned?'':publishingEvidenceDetails(t)}</div>`;
}
function distributionRenderTargets(f,selected=new Set(distributionSelected(f).map(t=>t.key))){
 const mode=f.elements.distributionMode.value,rows=distributionPlatformRows(f.distributionCatalog,f.distributionTargets||[]),connected=rows.filter(t=>!t.placeholder),directory=rows.filter(t=>t.placeholder);
 const current=connected.length?connected.map(t=>distributionPlatformRow(f,t,mode,selected)).join(''):`<div class="distribution-empty"><strong>还没有已连接账号</strong><p>先完成一次平台登录；之后这里只显示你的账号，勾选后即可发布。</p><button type="button" class="button small" data-distribution-manage>管理账号</button></div>`;
 const more=directory.length?`<details class="distribution-platform-directory"><summary>添加或查看更多平台（${directory.length}）</summary><p>首次添加才需要登录。标为“待接入”的平台暂不能勾选；登录成功的平台会自动移到上方。</p><div class="distribution-platform-directory-grid">${directory.map(t=>distributionPlatformRow(f,t,mode,selected)).join('')}</div></details>`:'';
 f.querySelector('[data-distribution-accounts]').innerHTML=distributionCapabilitySummary(connected,mode)+current+more+(f.distributionLoadErrors||[]).map(e=>'<p class="form-error">'+esc(e)+'</p>').join('');
}
function distributionInlineResults(f){
 const targets=distributionPlatformRows(f.distributionCatalog,f.distributionTargets||[]);
 for(const row of f.querySelectorAll?.('[data-distribution-row-key]')||[]){const result=f.distributionJournal?.[row.dataset.distributionRowKey],target=targets.find(t=>t.key===row.dataset.distributionRowKey),status=row.querySelector('[data-distribution-row-status]');if(!status||!target)continue;status.textContent=distributionPlatformStatus(target,f.elements.distributionMode.value,result);status.dataset.tone=distributionTone(result);}
}
function distributionScope(){return JSON.stringify([wordpressBaseScope(),accessInfo.current.actor||'',accessInfo.current.role||'',accessInfo.current.brands??null])}
function distributionCanSend(){return ['owner','admin','editor'].includes(accessInfo.current.role)}
function distributionCanUseWechat(){const a=accessInfo.current;return a.owner==='local-owner'&&a.actor==='local-owner'&&a.role==='owner'}
function distributionArticle(f){return own('contents').find(c=>c.id===f.dataset.id)}
function distributionSelected(f){const keys=[...f.querySelectorAll('[data-distribution-target]:checked')].map(el=>el.value);return (f.distributionTargets||[]).filter(t=>keys.includes(t.key))}
function distributionExecutionPolicy(){return {frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0}}
function distributionServerExecution(){return {media:[],executionPolicy:distributionExecutionPolicy()}}
function distributionPreflight(f,mode=f.elements.distributionMode.value){
 const stored=distributionArticle(f)||{},targets=distributionSelected(f).map(target=>{const catalog=(f.distributionCatalog||[]).find(platform=>platform.id===target.platform);return {...target,implementation:catalog?.implementation||target.implementation,actionEvidence:catalog?.actionEvidence||target.actionEvidence,platformName:catalog?.name||target.platformName}});
 return GEO_DISPATCH.publishReadiness({article:{title:f.elements.title?.value??stored.title,text:f.elements.text?.value??stored.text,...(f.distributionPersistentMedia?{mediaRefs:f.distributionMediaRefs||[]}: {})},targets,mode,tags:(f.elements.distributionTags?.value||'').split(/[,，]/).map(t=>t.trim()).filter(Boolean),media:f.distributionMediaFiles||[],mediaLoading:!!f.distributionMediaLoading,mediaError:f.distributionMediaError||''});
}
function distributionPreflightHtml(check){
 if(!check.rows.length)return '';
 const labels={ready:'已准备',needs_input:'需补充',needs_login:'需登录',unavailable:'暂不可用'};
 return `<div><strong>${check.canSend?'已选 '+check.rows.length+' 个账号，内容准备就绪':'发送前还需处理'}</strong>${check.generalIssues.length?'<ul>'+check.generalIssues.map(issue=>'<li>'+esc(issue)+'</li>').join('')+'</ul>':''}<ul>${check.rows.map(row=>`<li><b>${esc(row.name)}${row.accountName?' · '+esc(row.accountName):''}</b>：${labels[row.status]}${row.issues.length?'；'+row.issues.map(esc).join('；'):''}</li>`).join('')}</ul><p class="helper">按当前连接和稿件检查；平台登录、审核要求及实际结果会在发送时继续核对。不会自动截断正文。</p></div>`;
}
function distributionUpdate(f){
 const selected=distributionSelected(f),allowed=GEO_DISPATCH.availableActions(selected);
 const canReview=['owner','admin'].includes(accessInfo.current.role),c=distributionArticle(f),reviewed=c?.status==='已审核'&&!articleEditorDirty();
 const scopeChanged=!!f.distributionScope&&f.distributionScope!==distributionScope(),wechatAllowed=!selected.some(t=>t.transport==='desktop_personal')||distributionCanUseWechat();
 const mode=f.elements.distributionMode,action=f.querySelector('[data-distribution-send]');
 action.dataset.distributionSend=mode.value;
 const label={publish:'发布到已选平台',draft:'保存为平台草稿',prepare:'填入已选编辑器'}[mode.value];
 action.textContent=runtimeBusy?'正在处理…':label+(selected.length?'（'+selected.length+'）':'');
 const check=distributionPreflight(f),preflight=f.querySelector('[data-distribution-readiness]');if(preflight)preflight.innerHTML=distributionPreflightHtml(check);
 action.disabled=runtimeBusy||!!f.distributionBusy||scopeChanged||!wechatAllowed||!distributionCanSend()||!check.canSend||!allowed[mode.value]||(!canReview&&!reviewed);
 const selectAll=f.querySelector('[data-distribution-select-all]');selectAll.disabled=runtimeBusy||!distributionCanSend()||scopeChanged||!(f.distributionTargets||[]).some(t=>t.modes.includes(mode.value));selectAll.textContent=distributionModeSelectLabels[mode.value]||'全选可用';
 const modeSummary=f.querySelector('[data-distribution-mode-summary]');if(modeSummary)modeSummary.textContent=mode.value==='publish'?'改为保存草稿或仅填入':'当前：'+(distributionModeLabels[mode.value]||'其他操作')+'（点击修改）';
 f.querySelector('[data-distribution-count]').textContent='已选 '+selected.length+' 个';
 f.querySelector('.distribution-tags').hidden=!selected.some(t=>t.platform==='csdn');f.querySelector('.distribution-media').hidden=false;
 f.querySelector('[data-distribution-hint]').textContent=!distributionCanSend()?'当前角色只可查看，不能发送文章。':!selected.length?'勾选可用平台后点击发布；未连接的平台可先连接账号。':!canReview&&!reviewed?'稿件尚未审核，请先保存并提交审核。':!Object.values(allowed).some(Boolean)?'所选账号没有共同的发送方式，请按支持的操作分批选择。':mode.value==='prepare'?'当前选择只填入编辑器，仍需在平台提交；不会登记为已发布或已保存平台草稿。':mode.value==='draft'?'保存到所选平台的草稿箱，不公开文章。':'点击发布即确认当前稿件、来源和 AI 声明。每个平台单独显示结果；某个账号登录或连接异常时，其余可用账号继续。';
 const policy=f.querySelector('[data-distribution-policy]');if(policy)policy.textContent=mode.value==='prepare'?'仅填入编辑器，不创建发布批次、不调用模型或付费同步服务。':'本次仅执行一次；不创建定时任务、不自动重试，也不调用模型或付费同步服务。改稿、换图或换账号后会重新确认。';
}
function distributionWechatTarget(login={},task=null){
 if(!window.guanyinDesktop?.wechatPersonalPublish||!distributionCanUseWechat())return null;
 const connected=login?.state==='connected',taskId=/^gy-[a-f0-9]{64}$/.test(task?.taskId||'')?task.taskId:'';
 if(!connected&&!taskId)return null;
 return {key:'wechat:personal-browser',platform:'wechat',accountId:'personal-browser',name:'公众号浏览器',detail:'个人主体',transport:'desktop_personal',taskId,loginRequired:!connected,modes:connected?['draft','publish']:[],status:connected?'官方窗口登录后自动处理':'需要登录'};
}
function distributionBeginMediaRead(f){
 const version=f.distributionMediaVersion=(f.distributionMediaVersion||0)+1,scope=distributionScope(),brandId=f.dataset.brand,contentId=f.dataset.id;
 f.distributionMediaLoading=true;f.distributionMediaError='';
 // Only the newest selection in this exact editor may install files or finish its loading state.
 return ()=>f.isConnected&&version===f.distributionMediaVersion&&scope===distributionScope()&&brandId===brand().id&&f.dataset.brand===brandId&&f.dataset.id===contentId;
}
function distributionRenderMedia(f){
 const media=f.distributionMediaFiles||[],refs=f.distributionMediaRefs||[],box=f.querySelector('[data-distribution-media-list]'),rights=f.elements?.distributionMediaRights;
 const summary=f.querySelector('.distribution-media')?.querySelector?.('summary');if(summary)summary.textContent='配图（'+(refs.length?refs.length+' 张，随草稿保存':'可选，随草稿保存')+'）';
 if(box)box.innerHTML=media.map((m,i)=>'<div class="article-media-item"><img src="'+esc(m.dataUrl)+'" alt="配图 '+(i+1)+'" width="96" height="72" style="object-fit:contain"><span>'+esc(m.name)+'</span><button type="button" class="button small" data-media-move="'+i+'" data-media-step="-1" '+(!i?'disabled':'')+' aria-label="上移第 '+(i+1)+' 张配图">上移</button><button type="button" class="button small" data-media-move="'+i+'" data-media-step="1" '+(i===media.length-1?'disabled':'')+' aria-label="下移第 '+(i+1)+' 张配图">下移</button><button type="button" class="button small" data-media-remove="'+i+'">移除</button></div>').join('');
 if(rights){rights.disabled=!refs.length||!!f.distributionMediaLoading;rights.checked=refs.length>0&&refs.every(ref=>ref.rightsConfirmed);}
}
function distributionMediaChanged(f){
 f.distributionPersistentMedia=true;f.distributionMediaChosen=true;distributionRenderMedia(f);distributionInvalidate(f);if(typeof articleEditorRefresh==='function')articleEditorRefresh(f);
}
function distributionClearMedia(f){
 f.distributionMediaVersion=(f.distributionMediaVersion||0)+1;f.distributionMediaFiles=[];f.distributionMediaRefs=[];f.distributionMediaLoading=false;f.distributionMediaError='';
 if(f.elements.distributionMedia)f.elements.distributionMedia.value='';
 f.querySelector('[data-distribution-media-status]').textContent='已清空本稿配图，保存后生效。原图片仍可在本品牌复用。';distributionMediaChanged(f);
}
async function distributionLoadSavedMedia(f){
 if(!f.distributionPersistentMedia||f.distributionMediaChosen||f.distributionMediaLoaded||f.distributionMediaLoading)return;
 const refs=f.distributionMediaRefs||[];if(!refs.length){f.distributionMediaLoaded=true;return;}
 const current=distributionBeginMediaRead(f);distributionRenderMedia(f);
 try{
  const result=await apiRequest('/api/article-media/load',{method:'POST',body:JSON.stringify({brandId:f.dataset.brand,ids:refs.map(ref=>ref.id)})});
  if(!current())return;
  if(result.media?.length!==refs.length||result.media.some((item,i)=>item.id!==refs[i].id||item.sha256!==refs[i].sha256))throw Error('配图文件与稿件记录不一致');
  f.distributionMediaFiles=result.media;f.distributionMediaLoaded=true;f.querySelector('[data-distribution-media-status]').textContent=refs.length+' 张本机配图已恢复，顺序和使用确认已保留';
 }catch(error){if(current()){f.distributionMediaError=error.message;f.querySelector('[data-distribution-media-status]').textContent='配图未恢复：'+error.message;}}
 finally{if(current()){f.distributionMediaLoading=false;distributionRenderMedia(f);}}
}
async function distributionMediaLibrary(f){
 const scope=distributionScope(),brandId=f.dataset.brand,box=f.querySelector('[data-distribution-media-library-list]');box.textContent='正在读取本品牌图片…';
 try{const result=await apiRequest('/api/article-media/list',{method:'POST',body:JSON.stringify({brandId})});if(!f.isConnected||scope!==distributionScope()||brandId!==brand().id)return;
 box.innerHTML=result.media.length?result.media.map(m=>'<button type="button" class="button small" data-media-reuse="'+esc(m.id)+'">'+esc(m.name)+' · '+m.width+'×'+m.height+'</button>').join(''):'<p class="helper">本品牌还没有保存过图片。</p>';
 }catch(error){if(f.isConnected&&scope===distributionScope())box.textContent=error.message;}
}
async function distributionReuseMedia(f,id){
 if(f.distributionMediaLoading)return;const current=distributionBeginMediaRead(f);distributionUpdate(f);
 try{const result=await apiRequest('/api/article-media/load',{method:'POST',body:JSON.stringify({brandId:f.dataset.brand,ids:[id]})});if(!current())return;
 const media=result.media?.[0];if(!media||media.id!==id)throw Error('图片没有读取成功');
 const next=[...(f.distributionMediaFiles||[]),media];if(next.length>9||next.reduce((n,m)=>n+m.bytes,0)>8388608)throw Error('最多 9 张配图，合计 8 MB');
 const refs=GEO_ARTICLE_EDITOR.articleMediaRefs([...(f.distributionMediaRefs||[]),{id:media.id,sha256:media.sha256,rightsConfirmed:false}]);
 f.distributionMediaFiles=next;f.distributionMediaRefs=refs;f.distributionMediaError='';distributionMediaChanged(f);f.querySelector('[data-distribution-media-status]').textContent='已加入本品牌图片，保存稿件后保留';
 }catch(error){if(current())f.querySelector('[data-distribution-media-status]').textContent=error.message;}
 finally{if(current()){f.distributionMediaLoading=false;distributionRenderMedia(f);distributionUpdate(f);}}
}
async function distributionDecodeImage(dataUrl){
 await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const w=image.naturalWidth,h=image.naturalHeight;if(!w||!h||w>10000||h>10000||w*h>12000000)reject(Error('图片尺寸过大或无效'));else resolve();image.src='';};image.onerror=()=>reject(Error('图片损坏或无法解码'));image.src=dataUrl;});
}
async function distributionLoad(f){
 if(!f?.isConnected)return;const scope=distributionScope(),box=f.querySelector('[data-distribution-accounts]');f.distributionScope=scope;
 const selected=new Set(distributionSelected(f).map(t=>t.key));box.innerHTML='<p role="status">正在读取账号…</p>';
 await distributionLoadSavedMedia(f);if(!f.isConnected||scope!==distributionScope())return;
 const current=distributionArticle(f),batchRequest=current?.id?apiRequest('/api/publish-batches?'+new URLSearchParams({brandId:f.dataset.brand,contentId:current.id})):Promise.resolve({batches:[]});
 const requests=[apiRequest('/api/publishing-center?'+new URLSearchParams({brandId:f.dataset.brand})),browserPublisherAvailable()?apiRequest('/api/local-publisher/status?'+new URLSearchParams({brandId:f.dataset.brand})):Promise.resolve({accounts:[]}),window.guanyinDesktop?.wechatPersonalTask?window.guanyinDesktop.wechatPersonalTask():Promise.resolve(null),window.guanyinDesktop?.wechatPersonalLoginState?window.guanyinDesktop.wechatPersonalLoginState():Promise.resolve({state:'unknown'}),batchRequest];
 const results=await Promise.allSettled(requests);if(!f.isConnected||scope!==distributionScope())return;
 const targets=[],errors=[];
 results.slice(0,2).forEach((r,i)=>{if(r.status==='rejected'){errors.push((i?'浏览器连接':'网站账号')+'读取失败：'+r.reason.message);return}
  for(const a of r.value.accounts||[]){
   if(i===0&&['cnblogs','typecho','metaweblog','personal-site','yuque'].includes(a.platform))targets.push({key:a.platform+':'+a.accountId,platform:a.platform,accountId:a.accountId,connectionRevision:a.connectionRevision,name:a.username,detail:a.site,modes:[...(a.capabilities?.createDraft?['draft']:[]),...(a.capabilities?.publish?['publish']:[])],status:publishingAccountStates[a.status]||a.status});
   if(i===0&&a.platform==='wordpress')targets.push({key:'wp:'+a.accountId,platform:'wordpress',accountId:a.accountId,connectionRevision:a.connectionRevision,name:a.username,detail:a.site,modes:[...(a.capabilities?.createDraft?['draft']:[]),...(a.capabilities?.publish?['publish']:[])],status:publishingAccountStates[a.status]||a.status});
   if(i===1){const loginRequired=a.transport==='desktop'&&a.connectionState!=='connected';targets.push({loginRequired,key:a.platform+':'+a.id,platform:a.platform,sessionId:a.id,transport:a.transport,accountId:a.account?.accountId,name:a.account?.name||'尚未核验账号',detail:browserPlatformNames[a.platform]||a.platform,modes:a.account&&!loginRequired?(a.modes||['prepare']):[],status:a.account?(a.modes?.includes('publish')?'可执行发布 · 验收开关':a.modes?.includes('draft')?'可保存平台草稿':'可填入 · 平台验收中'):a.transport==='desktop'?'请先登录账号':'请在连接器核验身份'});}
  }
 });
 if(results[2].status==='rejected')errors.push('公众号原任务读取失败：'+results[2].reason.message);
 if(results[3].status==='rejected')errors.push('公众号登录状态读取失败：'+results[3].reason.message);
 if(results[4].status==='rejected')errors.push('已登记发布批次读取失败：'+results[4].reason.message);
 const wechat=distributionWechatTarget(results[3].status==='fulfilled'?results[3].value:null,results[2].status==='fulfilled'?results[2].value:null);if(wechat)targets.push(wechat);
 f.distributionTargets=targets;f.distributionRemoteJobs=[...(results[1].status==='fulfilled'?results[1].value.jobs||[]:[]),...(results[0].status==='fulfilled'?results[0].value.receipts||[]:[])];
 f.distributionCatalog=results[0].status==='fulfilled'?results[0].value.platforms||[]:[];f.distributionBatches=results[4].status==='fulfilled'?results[4].value.batches||[]:[];f.distributionBatchRefreshError=results[4].status==='rejected'?results[4].reason?.message||'暂时无法读取':'';f.distributionLoadErrors=errors;
 distributionRenderTargets(f,selected);
 distributionUpdate(f);
 if(!f.distributionPersistentMedia&&current?.status==='已审核'&&!articleEditorDirty()&&!f.distributionMediaChosen&&!f.distributionMediaFiles?.length&&f.distributionRemoteJobs.some(j=>['51cto','douyin','xiaohongshu'].includes(j.platform)&&j.state!=='cancelled'&&j.contentId===current.id&&j.currentRevision&&j.mediaHashes?.length)){
  const currentMedia=distributionBeginMediaRead(f);distributionUpdate(f);
  try{const restored=await apiRequest('/api/local-publisher/media',{method:'POST',body:JSON.stringify({brandId:current.brandId,contentId:current.id})});if(currentMedia()&&!articleEditorDirty()&&!f.distributionMediaChosen){f.distributionMediaFiles=restored.media;f.querySelector('[data-distribution-media-status]').textContent=restored.media.length+' 张原稿图片已恢复，无需重新选择';}}
  catch(e){if(currentMedia()){f.distributionMediaError=e.message;f.querySelector('[data-distribution-media-status]').textContent='原稿图片暂未恢复：'+e.message;}}
  finally{if(currentMedia()){f.distributionMediaLoading=false;distributionUpdate(f);}}
 }
 await distributionRestore(f);
 distributionRestoreRegisteredBatch(f,f.distributionBatches);
 await distributionRecoverWechatTask(f,results[2].status==='fulfilled'?results[2].value:null);
}
async function distributionKey(c,scope){
 const fields=[c.brandId,c.id,c.title,c.text,!!c.ai,c.factSnapshots||[]];if(Object.hasOwn(c,'mediaRefs'))fields.push(c.mediaRefs,c.mediaVersion);if(c.media?.length)fields.push(c.media.map(m=>m.sha256));const bytes=new TextEncoder().encode(JSON.stringify(fields));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return 'guanyin.distribution.v1.'+scope+'.'+hash;
}
async function distributionHash(value){
 const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function distributionAuthorizeWechat(f,c,mode,taskId,scope){
 const current=()=>f.isConnected&&scope===distributionScope()&&f.dataset.brand===brand().id&&c.brandId===f.dataset.brand&&c.id===f.dataset.id&&distributionCanUseWechat()&&!articleEditorDirty();
 if(!current()||c.status!=='已审核'||c.demo)throw Error('公众号仅可由本机个人工作区所有者发送当前已审核稿件');
 if(f.distributionMediaFiles?.length)throw Error('公众号当前连接器不支持附加图片，请单独确认无附加图片的稿件');
 const id='pa-'+await distributionHash(JSON.stringify([scope,c.id,taskId,mode,crypto.randomUUID()]));
 if(!current())throw Error('工作区或稿件已变化，未继续公众号发送');
 const created=await apiRequest('/api/publish-authorizations',{method:'POST',body:JSON.stringify({id,brandId:c.brandId,contentId:c.id,mode,confirmed:true,expiresAt:new Date(Date.now()+10*60_000).toISOString(),targets:[{platform:'wechat',accountId:'personal-browser'}],...distributionServerExecution()})});
 if(!current())throw Error('工作区或稿件已变化，未继续公众号发送');
 const checked=await apiRequest('/api/publish-authorizations/validate',{method:'POST',body:JSON.stringify({id,brandId:c.brandId})});
 if(!current()||checked.authorization?.id!==id||!(/^[a-f0-9]{64}$/).test(created.authorization?.desktopToken||''))throw Error('公众号本次授权未核对完成，未发送');
 return {authorizationId:id,desktopToken:created.authorization.desktopToken,brandId:c.brandId,contentId:c.id,mode,taskId};
}
// Browser-window platforms keep their own authenticated local task receipts.
// For server-owned accounts we additionally persist a short-lived, exact
// approval snapshot before dispatching, so a changed draft, fact or connection
// cannot silently reuse an earlier click.
async function distributionAuthorizeServerTargets(f,c,targets,mode,scope){
 const selected=targets.filter(target=>distributionSelfHostedPlatforms.has(target.platform));
 if(!selected.length||mode==='prepare')return null;
 const compact=selected.map(target=>({platform:target.platform,accountId:target.accountId})).sort((a,b)=>(a.platform+'\u0000'+a.accountId).localeCompare(b.platform+'\u0000'+b.accountId));
 const {media,executionPolicy}=distributionServerExecution(),slot=Math.floor(Date.now()/300000),signature=JSON.stringify({scope,brandId:c.brandId,contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[],media,executionPolicy,targets:compact,mode,slot});
 let pending=f.distributionAuthorization;
 if(!pending||pending.signature!==signature||Date.parse(pending.expiresAt)<=Date.now()+30_000){
  const expiresAt=new Date((slot+2)*300000).toISOString(),nonce=crypto.randomUUID?.()||String(Date.now())+':'+String(Math.random());
  pending={signature,expiresAt,id:'pa-'+await distributionHash(signature+'\u0000'+nonce)};
  f.distributionAuthorization=pending;
 }
 try{
  const created=await apiRequest('/api/publish-authorizations',{method:'POST',body:JSON.stringify({id:pending.id,brandId:c.brandId,contentId:c.id,mode,confirmed:true,expiresAt:pending.expiresAt,media,executionPolicy,targets:compact})});
  const checked=await apiRequest('/api/publish-authorizations/validate',{method:'POST',body:JSON.stringify({id:created.authorization.id,brandId:c.brandId})});
  f.distributionAuthorization={...pending,id:checked.authorization.id,expiresAt:checked.authorization.expiresAt};
  return checked.authorization;
 }catch(error){
  // A retry after an unknown response keeps the same receipt. A failed current
  // validation drops it so the next deliberate click obtains a new snapshot.
  if(!/网络|暂时|超时|连接中断|结果待确认/.test(error.message||''))f.distributionAuthorization=null;
  throw error;
 }
}
// Keep the server-owned part of a click recoverable even if this tab closes
// before an adapter replies. It is an intent/receipt index, not a background
// sender: actual platform work still happens only in the explicit dispatch
// flow below and is guarded again by the adapter.
async function distributionCreateServerBatch(f,c,targets,mode,scope){
 const selected=targets.filter(target=>distributionSelfHostedPlatforms.has(target.platform));
 if(!selected.length||mode==='prepare')return null;
 const authorizationId=f.distributionAuthorization?.id;if(!authorizationId)throw Error('本次发布确认未保存，请重新点击发布');
 const compact=selected.map(target=>({platform:target.platform,accountId:target.accountId})).sort((a,b)=>(a.platform+'\u0000'+a.accountId).localeCompare(b.platform+'\u0000'+b.accountId));
 const {media,executionPolicy}=distributionServerExecution(),signature=JSON.stringify({scope,brandId:c.brandId,contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[],media,executionPolicy,targets:compact,mode,authorizationId});
 let pending=f.distributionBatch;
 if(!pending||pending.signature!==signature)pending={signature,id:'pb-'+await distributionHash(signature)};
 const created=await apiRequest('/api/publish-batches',{method:'POST',body:JSON.stringify({id:pending.id,brandId:c.brandId,contentId:c.id,mode,authorizationId,media,executionPolicy,targets:compact})});
 f.distributionBatch={...pending,id:created.batch.id,createdAt:created.batch.createdAt};
 return created.batch;
}
// A stable claim ID makes a lost browser response safe to resume within the
// same user-confirmed batch. The server refuses a different concurrent click,
// and refuses any claim that expired before a platform receipt appeared.
async function distributionClaimServerTarget(f,batch,c,target,stage){
 if(!batch||!distributionSelfHostedPlatforms.has(target.platform))return null;
 const leaseId='pl-'+await distributionHash(JSON.stringify({batchId:batch.id,brandId:c.brandId,contentId:c.id,platform:target.platform,accountId:target.accountId,stage}));
 try{return await apiRequest('/api/publish-batches/claim',{method:'POST',body:JSON.stringify({id:batch.id,brandId:c.brandId,platform:target.platform,accountId:target.accountId,stage,leaseId})})}
 catch(error){
  // An expired claim is deliberately terminal. Dropping this in-memory handle
  // means a later user click obtains a fresh authorization and batch instead
  // of reviving a send whose platform result is unknown.
  if(/结果待核对/.test(error.message||'')){
   f.distributionAuthorization=null;f.distributionBatch=null;
   // dispatchArticle will persist this same journal object in its error path.
   // Keep the old batch ID so a later, deliberate retry can create a fresh
   // batch without erasing the unknown original operation from the server.
   const row=f.distributionJournal?.[target.key];if(row){row.batchId=batch.id;row.resultUnknown=true;row.notice='上一次发送结果待核对；不会自动重发。'}
  }
  throw error;
 }
}
async function distributionStartNewConfirmedBatch(journal,batch,targets,persist){
 if(!batch)return false;
 let changed=false;
 for(const target of targets){
  if(!distributionSelfHostedPlatforms.has(target.platform))continue;
  const row=journal?.[target.key];
  if(!row?.resultUnknown||row.batchId===batch.id)continue;
  // The old batch and its unknown result remain on the server. Removing only
  // this local blocker is safe here because the user just made a new explicit
  // confirmation and the new batch has its own authorization and lease.
  delete journal[target.key];changed=true;
 }
 if(changed)await persist(journal);
 return changed;
}
function distributionBatchJournalRow(target,item,batch){
 const unknown=item.state==='result_unknown',pending=item.state==='claim_pending';
 return {id:item.dispatchId,key:target.key,platform:target.platform,accountId:target.accountId,name:target.name,state:unknown?'uncertain':pending?'claim_pending':'registered',stage:item.stage||batch.mode,notice:item.notice||(unknown?'上一次发送结果待确认；不会自动重发。':pending?'已确认发送，正在等待平台回执；不会自动重试。':'本次已登记，但尚未向平台发送。请重新点击发布后才会开始。'),batchId:batch.id,resultUnknown:unknown,fromServerBatch:true};
}
function distributionMaySyncBatchRow(existing,batch){
 if(!existing)return true;
 // A platform receipt, editor task or an unrelated older batch always wins over
 // a server-side pending marker. This function only refreshes the lightweight
 // batch states that have not yet obtained an adapter receipt.
 return existing.batchId===batch.id&&(existing.state==='registered'||existing.state==='claim_pending'||existing.resultUnknown===true);
}
// A persisted batch is deliberately weaker than a platform task: it means the
// user confirmed this exact version, then the browser closed before an adapter
// was contacted. Restore that fact for transparency, but never restart it.
function distributionRestoreRegisteredBatch(f,batches){
 const record=distributionArticle(f),key=f.distributionKey;
 if(!record||!key||articleEditorDirty()||!Array.isArray(batches))return false;
 const journal=f.distributionJournal||{},known=new Set(Object.keys(journal));let changed=false;
 const ordered=[...batches].filter(batch=>batch?.currentRevision===true&&batch.contentId===record.id).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 for(const batch of ordered){
  for(const item of batch.targets||[]){
   if(!['not_started','claim_pending','result_unknown'].includes(item?.state))continue;
   const target=(f.distributionTargets||[]).find(candidate=>distributionSelfHostedPlatforms.has(candidate.platform)&&candidate.platform===item.platform&&candidate.accountId===item.accountId);
   const existing=journal[target?.key];
   if(!target||known.has(target.key)&&!distributionMaySyncBatchRow(existing,batch))continue;
   const next=distributionBatchJournalRow(target,item,batch);
   if(existing&&JSON.stringify(existing)===JSON.stringify(next)){known.add(target.key);continue;}
   journal[target.key]={...existing,...next};
   known.add(target.key);changed=true;
  }
 }
 if(!changed)return false;
 localStorage.setItem(key,JSON.stringify(journal));f.distributionJournal=journal;f.distributionWatchState=GEO_DISPATCH.dispatchNeedsRefresh(journal)?'watching':'complete';distributionResults(f);
 return true;
}
function distributionSummary(rows){const counts=new Map();for(const row of rows){const label=distributionResultLabel(row);counts.set(label,(counts.get(label)||0)+1)}return [...counts].map(([label,n])=>label+' '+n+' 个').join(' · ')}
function distributionUnknownResultRows(rows){return rows.filter(row=>row?.resultUnknown===true||row?.state==='result_unknown')}
function distributionRecoveryTarget(f,row){
 if(!window.guanyinDesktop?.available||!(row?.preflightFailed||['needs_attention','uncertain'].includes(row?.state))||!row.sessionId)return null;
 return (f.distributionTargets||[]).find(t=>t.transport==='desktop'&&t.sessionId===row.sessionId&&t.platform===row.platform&&t.accountId===row.accountId)||null;
}
function distributionRecoveryButton(f,row){const target=distributionRecoveryTarget(f,row);return target?`<p><button type="button" class="button small" data-distribution-open-original="${esc(row.key)}">打开平台处理</button>${row.retryable&&row.jobId?`<button type="button" class="button small" data-distribution-unstarted="${esc(row.key)}">继续未开始的任务</button>`:''}${row.resumable&&row.jobId?`<button type="button" class="button small" data-distribution-resume="${esc(row.key)}">${row.stage==='prepare'?'补齐原稿文字（不发布）':'继续原稿发布'}</button>`:''}<span class="helper">${row.preflightFailed?'处理后回到这里再次点击发送；已提交的账号不会重复发送':'查看原任务，不会重新发送'}</span></p>`:'';}
function distributionWechatRecoveryButton(row){
 if(row?.platform!=='wechat'||row.transport!=='desktop_personal'||!/^gy-[a-f0-9]{64}$/.test(row.id||'')||!window.guanyinDesktop?.wechatPersonalResume)return '';
 if(!['preparing','submitting','needs_attention'].includes(row.state))return '';
 return `<p><button type="button" class="button small" data-distribution-wechat-open="${esc(row.id)}">打开公众号原任务</button><span class="helper">只恢复原任务，不会新建稿件或重复点击发表</span></p>`;
}
async function distributionRecoverWechatTask(f,task){
 // The task file outlives renderer storage. Restore both an in-flight task and
 // a terminal draft/submission receipt, but only when this exact article
 // revision derives the same original task ID. A terminal record is a result
 // to display, never a reason to reopen or replay a platform action.
 if(!task||!/^gy-[a-f0-9]{64}$/.test(task.taskId||''))return false;
 const record=distributionArticle(f),scope=distributionScope();if(!record||articleEditorDirty())return false;
 const target=(f.distributionTargets||[]).find(t=>t.platform==='wechat'&&t.transport==='desktop_personal');if(!target)return false;
 const id=await GEO_DISPATCH.dispatchId(record,target);if(id!==task.taskId||!f.isConnected||scope!==distributionScope()||f.dataset.brand!==brand().id||articleEditorDirty())return false;
 const key=f.distributionKey||await distributionKey(record,scope);if(id!==task.taskId||!f.isConnected||scope!==distributionScope()||f.dataset.brand!==brand().id||articleEditorDirty())return false;
 const current=f.distributionJournal||{},existing=current[target.key];
 if(existing&&existing.id!==task.taskId)return false;
 if(existing?.id===task.taskId&&existing.state==='published')return false;
 const state=distributionWechatTaskState(task.state);if(!state)return false;
 current[target.key]={...(existing||{}),id:task.taskId,key:target.key,platform:'wechat',accountId:target.accountId,name:target.name,transport:target.transport,state,stage:task.mode,error:task.message||''};
 localStorage.setItem(key,JSON.stringify(current));f.distributionJournal=current;f.distributionKey=key;f.distributionWatchState=GEO_DISPATCH.dispatchNeedsRefresh(current)?'watching':'complete';distributionResults(f);distributionWatch(f);return true;
}
async function distributionOpenOriginal(f,key){
 if(!f.isConnected||f.distributionScope!==distributionScope()||f.dataset.brand!==brand().id)throw Error('工作区已变化，请重新打开稿件');
 const row=f.distributionJournal?.[key],target=distributionRecoveryTarget(f,row);if(!target)throw Error('原账号连接已变化，请检查账号设置');
 await window.guanyinDesktop.openAccount(target.sessionId);
}
async function distributionResumeOriginal(f,key){
 if(!f.isConnected||f.distributionScope!==distributionScope()||f.dataset.brand!==brand().id||articleEditorDirty())throw Error('稿件或工作区已变化');
 const row=f.distributionJournal?.[key],target=distributionRecoveryTarget(f,row);
 if(!target||row.resumable!==true||!row.jobId||!window.guanyinDesktop.resume)throw Error('原任务不能继续提交，请核对回执');
 const assertCurrent=()=>{if(!f.isConnected||f.distributionScope!==distributionScope()||f.dataset.brand!==brand().id||articleEditorDirty()||distributionRecoveryTarget(f,row)!==target)throw Error('稿件或账号已变化，未继续提交')};
 await window.guanyinDesktop.prepare([{sessionId:target.sessionId,accountId:target.accountId}]);assertCurrent();
 await apiRequest('/api/local-publisher/retry',{method:'POST',body:JSON.stringify({id:row.jobId})});assertCurrent();
 await window.guanyinDesktop.resume({sessionId:target.sessionId,accountId:target.accountId,jobId:row.jobId});await distributionReconcile(f);distributionWatch(f);
}
function distributionReceiptLink(row){
 const url=row.remote?.publicUrl||row.remote?.url||row.preparation?.editorUrl||row.recoveredDraft?.url;
 if(!url||!/^https?:\/\//.test(url))return '';
 if(typeof browserPublisherDestination==='function')return browserPublisherDestination({id:row.jobId,sessionId:row.sessionId,state:row.state},url,row.remote?'查看平台回执':'打开平台编辑页');
 return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看平台回执</a>`;
}
function distributionResults(f){
 const rows=Object.values(f.distributionJournal||{}),box=f.querySelector('[data-distribution-results]');distributionInlineResults(f);
 const registered=rows.some(row=>row.state==='registered'),unknown=distributionUnknownResultRows(rows);
 const unknownHint=unknown.length?`<aside class="distribution-result-alert" role="status"><strong>${unknown.length} 个平台结果待确认</strong><p>平台没有返回最终结果，观引已经停止，绝不会自动重发。先点“刷新结果”；若仍没有回执，请到对应平台搜索这篇标题。确认未发后，再勾选并点击发布，会新建一次明确的发送。</p></aside>`:'';
 const batchRefreshError=f.distributionBatchRefreshError?`<p class="helper">发布记录暂时无法读取：${esc(f.distributionBatchRefreshError)}；已保留当前状态，不会重新发送。</p>`:'';
 const markup=rows.length?`<div class="distribution-heading"><h3>发布结果</h3><button class="button small" type="button" data-distribution-reconcile>刷新结果</button></div><p class="distribution-result-summary">${esc(distributionSummary(rows))}</p>${unknownHint}${batchRefreshError}<details class="distribution-result-details" ${rows.some(r=>r.preflightFailed||['needs_attention','uncertain','registered','claim_pending'].includes(r.state)||r.refreshError)?'open':''}><summary>查看各平台详情</summary><ul class="distribution-receipts">${rows.map(r=>`<li><div><strong>${esc(f.distributionCatalog?.find(p=>p.id===r.platform)?.name||r.platform)} · ${esc(r.name)}</strong><span>${esc(distributionResultLabel(r))}</span></div>${r.notice?'<p class="helper">'+esc(r.notice)+'</p>':''}${r.error?'<p class="form-error">'+esc(r.error)+'</p>':''}${r.preflightError&&r.preflightError!==r.error?'<p class="form-error">'+esc(r.preflightError)+'</p>':''}${r.refreshError?'<p class="helper">暂未取得新回执：'+esc(r.refreshError)+'；保留上次状态，不会重新发送。</p>':''}${distributionReceiptLink(r)}${distributionRecoveryButton(f,r)}${distributionWechatRecoveryButton(r)}</li>`).join('')}</ul></details><p class="helper" role="status" data-distribution-watch-status></p><p class="helper">${registered?'已登记的目标不会自动发送；请重新点击发布后才会开始。':'结果自动更新。需要处理时可直接打开对应平台；不会自动重复发布。'}</p>`:'';
 // Polling must not replace an unchanged action button or steal keyboard focus.
 if(box.distributionMarkup!==markup){box.innerHTML=markup;box.distributionMarkup=markup;}
 const watch=box.querySelector?.('[data-distribution-watch-status]');if(watch)watch.textContent=distributionWatchLabel(f);
}
async function distributionRefreshBatchStatuses(f,record,scope,assertCurrent=()=>{}){
 const result=await apiRequest('/api/publish-batches?'+new URLSearchParams({brandId:f.dataset.brand,contentId:record.id}));
 assertCurrent();
 if(!f.isConnected||scope!==distributionScope()||f.dataset.brand!==brand().id||articleEditorDirty())throw Error('稿件或工作区已变化，已停止核对');
 f.distributionBatches=result.batches||[];f.distributionBatchRefreshError='';
 return distributionRestoreRegisteredBatch(f,f.distributionBatches);
}
function distributionWatchLabel(f){
 return ({checking:'正在读取最新结果…',watching:'正在自动更新发布进度。',retry_wait:'暂时无法读取新结果，稍后自动再查；不会重发。',paused:'页面在后台或网络不可用，恢复后继续核对。',timeout:'自动核对已暂停，点击“刷新结果”继续；原任务不会重发。',complete:'结果已更新。'})[f.distributionWatchState]||'等待中的任务会自动更新结果。';
}
function distributionStopWatch(f){f.distributionWatcher?.stop();f.distributionWatcher=null;}
async function distributionReconcile(f){
 if(f.distributionReconciling)return false;
 const record=distributionArticle(f),scope=distributionScope(),key=f.distributionKey,journal=f.distributionJournal,epoch=f.distributionEpoch||0;
 if(!record||!key||articleEditorDirty())throw Error('请先保存当前修改，再核对对应版本');
 const valid=()=>f.isConnected&&scope===distributionScope()&&f.dataset.brand===brand().id&&key===f.distributionKey&&journal===f.distributionJournal&&(f.distributionEpoch||0)===epoch&&!articleEditorDirty()&&!f.distributionBusy;
 const assertScope=()=>{if(!valid())throw Error('稿件、工作区或页面已变化，已停止核对')};
 const article={...record,media:f.distributionMediaFiles||[]};f.distributionReconciling=true;
 try{
  assertScope();try{await distributionRefreshBatchStatuses(f,record,scope,assertScope)}catch(error){assertScope();f.distributionBatchRefreshError=error.message||'暂时无法读取'}assertScope();
  await GEO_DISPATCH.reconcileDispatch({article,journal,request:apiRequest,persist:async j=>{assertScope();localStorage.setItem(key,JSON.stringify(j))},assertScope});
  assertScope();if(!GEO_DISPATCH.dispatchNeedsRefresh(journal))f.distributionWatchState='complete';distributionResults(f);return !Object.values(journal).some(r=>r.refreshError);
 }finally{f.distributionReconciling=false;}
}
function distributionWatch(f){
 if(f.distributionWatcher?.active||!f.isConnected||!GEO_DISPATCH.dispatchNeedsRefresh(f.distributionJournal)||articleEditorDirty())return;
 const scope=distributionScope(),key=f.distributionKey,journal=f.distributionJournal,epoch=f.distributionEpoch||0;
 f.distributionWatcher=GEO_DISPATCH.createDispatchWatcher({
  valid:()=>f.isConnected&&scope===distributionScope()&&f.dataset.brand===brand().id&&key===f.distributionKey&&journal===f.distributionJournal&&(f.distributionEpoch||0)===epoch&&!articleEditorDirty(),
  pending:()=>GEO_DISPATCH.dispatchNeedsRefresh(journal),
  paused:()=>document.hidden||navigator.onLine===false||runtimeBusy||f.distributionBusy,
  refresh:()=>distributionReconcile(f),
  interval:()=>GEO_DISPATCH.dispatchRefreshInterval(journal),maxDelay:60000,maxDuration:1800000,
  notify:({state})=>{f.distributionWatchState=state;if(f.isConnected)distributionResults(f)}
 });f.distributionWatcher.start();
}
for(const event of ['visibilitychange','online'])window.addEventListener(event,()=>{for(const f of document.querySelectorAll('[data-article-editor]'))f.distributionWatcher?.wake()});
if(window.guanyinDesktop?.onWechatPersonalLoginStatus)window.guanyinDesktop.onWechatPersonalLoginStatus(()=>{for(const f of document.querySelectorAll?.('[data-article-editor]')||[])if(f.isConnected&&!f.distributionBusy)void distributionLoad(f)});
async function distributionRestore(f){
 const record=distributionArticle(f);if(!record||articleEditorDirty())return;const epoch=f.distributionEpoch=(f.distributionEpoch||0)+1;distributionStopWatch(f);const c={...record,media:f.distributionMediaFiles||[]};
 const scope=distributionScope(),key=await distributionKey(c,scope);if(!f.isConnected||scope!==distributionScope()||epoch!==f.distributionEpoch||articleEditorDirty())return;
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}'),journal=await GEO_DISPATCH.recoverDispatchJournal({article:c,targets:f.distributionTargets||[],jobs:f.distributionRemoteJobs||[],journal:saved});if(!f.isConnected||scope!==distributionScope()||epoch!==f.distributionEpoch||articleEditorDirty())return;localStorage.setItem(key,JSON.stringify(journal));f.distributionJournal=journal;f.distributionKey=key;f.distributionWatchState=GEO_DISPATCH.dispatchNeedsRefresh(journal)?'watching':'complete';distributionResults(f);distributionWatch(f)}catch{f.querySelector('[data-distribution-error]').textContent='无法读取本机发送记录，暂不发送。请保留浏览器数据并检查存储权限。'}
}
async function distributionSend(f,mode){
 const error=f.querySelector('[data-distribution-error]');error.textContent='';if(runtimeBusy||f.distributionBusy)return;distributionStopWatch(f);f.distributionEpoch=(f.distributionEpoch||0)+1;f.distributionBusy=true;f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
 try{
  if(!distributionCanSend())throw new Error('当前角色不能发送文章');
  if(f.distributionScope!==distributionScope()||f.dataset.brand!==brand().id)throw new Error('工作区或品牌已切换，请重新打开稿件');
  if(!f.elements.distributionConfirmed.checked)throw new Error('请先核对并确认稿件');
  const targets=distributionSelected(f);if(!GEO_DISPATCH.availableActions(targets)[mode])throw new Error('所选账号不都支持此操作');
  const check=distributionPreflight(f,mode);if(!check.canSend)throw new Error([...check.generalIssues,...check.rows.filter(row=>row.issues.length).map(row=>row.name+'：'+row.issues.join('；'))].join('；'));
  const tags=f.elements.distributionTags.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean);
  // Explicit confirmation plus this action authorizes an owner/admin to approve this exact revision.
  let c=distributionArticle(f);
  if(articleEditorDirty()||!c||c.status!=='已审核'){
   if(!['owner','admin'].includes(accessInfo.current.role))throw new Error('请先将稿件提交审核');
   c=await articleEditorSave('confirm',{reopen:false});if(!c)throw new Error('稿件未保存，请检查上方提示');
  }
  c={...c,media:f.distributionMediaFiles||[]};const scope=distributionScope(),key=await distributionKey(c,scope),journal=JSON.parse(localStorage.getItem(key)||'{}');
  const assertScope=()=>{if(scope!==distributionScope()||!f.isConnected||f.dataset.brand!==brand().id||!distributionCanSend())throw new Error('工作区、权限或页面已变化，已停止后续发送')};
  const persist=async value=>localStorage.setItem(key,JSON.stringify(value));
  assertScope();await persist(journal);f.distributionJournal=journal;f.distributionKey=key;
  runtimeLock(true);f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
  const wechatTargets=targets.filter(t=>t.transport==='desktop_personal'),selectedRegularTargets=targets.filter(t=>t.transport!=='desktop_personal');
  const prepared=selectedRegularTargets.length?await GEO_DISPATCH.prepareDispatchTargets({article:c,targets:selectedRegularTargets,mode,journal,persist,assertScope,changed:()=>distributionResults(f),prepareDesktop:async list=>{if(!window.guanyinDesktop?.prepare)throw Error('请在观引桌面版打开此稿件');return window.guanyinDesktop.prepare(list)}}):{targets:[],failed:[]};
  assertScope();const regularTargets=prepared.targets,desktopTargets=regularTargets.filter(t=>t.transport==='desktop');
  if(!regularTargets.length&&!wechatTargets.length){distributionResults(f);toast('所选 '+prepared.failed.length+' 个账号本次未发送，请按各平台提示处理');return;}
  await distributionAuthorizeServerTargets(f,c,regularTargets,mode,scope);assertScope();
  const serverBatch=await distributionCreateServerBatch(f,c,regularTargets,mode,scope);assertScope();
  await distributionStartNewConfirmedBatch(journal,serverBatch,regularTargets,persist);assertScope();
  if(regularTargets.length)await GEO_DISPATCH.reconcileDispatch({article:c,journal,request:apiRequest,persist,assertScope});assertScope();
  for(const target of wechatTargets){
   if(!window.guanyinDesktop?.wechatPersonalPublish)throw new Error('请在观引桌面版打开此稿件');
   const existing=journal[target.key];if(existing&&['sending','uncertain','needs_attention','queued','preparing','publishing','submitting','submitted','prepared','published'].includes(existing.state))continue;
   const taskId=await GEO_DISPATCH.dispatchId(c,target);
   const authorization=await distributionAuthorizeWechat(f,c,mode,taskId,scope);assertScope();
   journal[target.key]={id:taskId,key:target.key,platform:'wechat',accountId:target.accountId,name:target.name,transport:target.transport,state:'preparing',stage:mode,error:'公众号窗口已打开，正在等待登录或编辑器就绪。'};
   await persist(journal);distributionResults(f);
   const result=await window.guanyinDesktop.wechatPersonalPublish(authorization);assertScope();
   journal[target.key]={...journal[target.key],state:'preparing',error:result?.message||journal[target.key].error};
   await persist(journal);distributionResults(f);
  }
  if(regularTargets.length)await GEO_DISPATCH.dispatchArticle({article:{...c,tags,executionPolicy:distributionExecutionPolicy()},targets:regularTargets,mode,journal,request:apiRequest,persist,assertScope,authorizationId:f.distributionAuthorization?.id||null,beforeTarget:(target,{stage})=>distributionClaimServerTarget(f,serverBatch,c,target,stage),changed:()=>distributionResults(f)});
  if(desktopTargets.length)void window.guanyinDesktop.wake();
  // WordPress publication registers server-owned receipt data. Reload before the next workspace write.
  try{const fresh=await apiRequest('/api/state');state=fresh.state;serverRevision=fresh.revision;}catch{saveBlocked=true;throw new Error('发送记录已保留，但工作区刷新失败。请刷新页面后再编辑，避免覆盖回执。')}
  toast(prepared.failed.length?prepared.failed.length+' 个账号本次未发送，其余账号已继续处理；请查看各平台实际结果':'发送流程已结束，请查看每个账号的实际结果');
 }catch(e){error.textContent=e.message}
 finally{f.distributionBusy=false;runtimeLock(false);if(f.isConnected){f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=false);f.querySelectorAll('[data-distribution-target]').forEach(e=>e.disabled=!f.distributionTargets.find(t=>t.key===e.value)?.modes.includes(f.elements.distributionMode.value));distributionUpdate(f);distributionResults(f);distributionWatch(f)}}
}
function distributionWechatStatus(status){
 if(!status?.taskId)return;
 const state=distributionWechatTaskState(status.state);if(!state)return;
 for(const f of document.querySelectorAll?.('[data-article-editor]')||[]){
  const row=Object.values(f.distributionJournal||{}).find(v=>v.platform==='wechat'&&v.id===status.taskId);if(!row)continue;
  row.state=state;row.error=status.message||'';localStorage.setItem(f.distributionKey,JSON.stringify(f.distributionJournal));distributionResults(f);distributionInlineResults(f);
 }
}
if(window.guanyinDesktop?.onWechatPersonalStatus)window.guanyinDesktop.onWechatPersonalStatus(distributionWechatStatus);
document.addEventListener('change',e=>{const f=e.target.closest('[data-article-editor]');if(f&&e.target.name==='distributionMode')distributionRenderTargets(f);if(f&&(e.target.matches('[data-distribution-target]')||['distributionConfirmed','distributionMode'].includes(e.target.name)))distributionUpdate(f)});
function distributionInvalidate(f){distributionStopWatch(f);f.distributionEpoch=(f.distributionEpoch||0)+1;f.distributionKey=null;f.distributionAuthorization=null;f.distributionBatch=null;f.elements.distributionConfirmed.checked=false;f.distributionJournal={};distributionResults(f);distributionUpdate(f)}
document.addEventListener('input',e=>{const f=e.target.closest('[data-article-editor]');if(f&&['title','text','articleAi'].includes(e.target.name)){distributionInvalidate(f)}else if(f&&e.target.name==='distributionTags')distributionUpdate(f)});
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-distribution-focus')){f.querySelector('.article-distribution').scrollIntoView({block:'start'});f.querySelector('[data-distribution-target]')?.focus()}
 if(b.hasAttribute('data-distribution-manual')){if(articleEditorDirty()){f.querySelector('[data-distribution-error]').textContent='请先保存并审核修改，再准备交付稿。';return}const c=distributionArticle(f);if(c?.status!=='已审核'){f.querySelector('[data-distribution-error]').textContent='请先完成稿件审核。';return}manualPublicationHandoff(c)}
 if(b.hasAttribute('data-distribution-refresh'))await distributionLoad(f);
 if(b.hasAttribute('data-distribution-media-clear'))distributionClearMedia(f);
 if(b.hasAttribute('data-distribution-media-library'))await distributionMediaLibrary(f);
 if(b.dataset.mediaReuse)await distributionReuseMedia(f,b.dataset.mediaReuse);
 if(b.hasAttribute('data-media-remove')||b.hasAttribute('data-media-move')){if(f.distributionMediaLoading)return;const index=Number(b.dataset.mediaRemove??b.dataset.mediaMove),files=f.distributionMediaFiles||[],refs=f.distributionMediaRefs||[];if(!Number.isInteger(index)||!refs[index])return;if(b.hasAttribute('data-media-remove')){files.splice(index,1);refs.splice(index,1);}else{const next=index+Number(b.dataset.mediaStep);if(next<0||next>=refs.length)return;[files[index],files[next]]=[files[next],files[index]];[refs[index],refs[next]]=[refs[next],refs[index]];}distributionMediaChanged(f);}
 if(b.hasAttribute('data-distribution-manage')){if(articleEditorDirty()){const saved=await articleEditorSave('save',{reopen:false});if(!saved)return;}closeDrawer();location.hash='integrations';toast('账号连接后，从内容与确认中打开原稿继续发送')}
 if(b.hasAttribute('data-distribution-select-all')){const boxes=[...f.querySelectorAll('[data-distribution-target]:not(:disabled)')],select=!boxes.every(x=>x.checked);for(const box of boxes)box.checked=select;distributionUpdate(f);}
 if(b.dataset.distributionConnect){
  const scope=distributionScope();try{b.disabled=true;if(articleEditorDirty()||f.dataset.new==='true'){const saved=await articleEditorSave('save',{reopen:false});if(!saved)return;}if(!f.isConnected||scope!==distributionScope()||f.dataset.brand!==brand().id)return;
   if(b.dataset.distributionConnect==='personal-site')await personalSiteConfigure();else if(b.dataset.distributionConnect==='metaweblog')await metaweblogConfigure();else if(b.dataset.distributionConnect==='typecho')await typechoConfigure();else if(b.dataset.distributionConnect==='cnblogs')await cnblogsConfigure();else if(b.dataset.distributionConnect==='yuque')await yuqueConfigure();else if(b.dataset.distributionConnect==='wordpress')await publishingCenterAction('publishing-account-add',b);else await browserPublisherAction('browser-publisher-pair',{dataset:{platform:b.dataset.distributionConnect,contentId:f.dataset.id}});
  }catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}
 }
 if(b.dataset.distributionOpenOriginal){try{b.disabled=true;await distributionOpenOriginal(f,b.dataset.distributionOpenOriginal)}catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}}
 if(b.dataset.distributionUnstarted){try{
  b.disabled=true;const row=f.distributionJournal?.[b.dataset.distributionUnstarted],target=distributionRecoveryTarget(f,row);
  const current=()=>f.isConnected&&f.distributionScope===distributionScope()&&f.dataset.brand===brand().id&&!articleEditorDirty();
  if(!current()||!target||row.retryable!==true||!row.jobId)throw Error('原任务或工作区已变化');
  await window.guanyinDesktop.prepare([{sessionId:target.sessionId,accountId:target.accountId}]);
  if(!current())throw Error('稿件已变化，未继续');
  await apiRequest('/api/local-publisher/continue-unstarted',{method:'POST',body:JSON.stringify({id:row.jobId})});
  await distributionReconcile(f);distributionWatch(f);
 }catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}}
 if(b.dataset.distributionResume){try{b.disabled=true;await distributionResumeOriginal(f,b.dataset.distributionResume)}catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}}
 if(b.dataset.distributionWechatOpen){try{b.disabled=true;if(!window.guanyinDesktop?.wechatPersonalResume)throw Error('请在观引桌面版打开公众号原任务');const c=distributionArticle(f),row=Object.values(f.distributionJournal||{}).find(item=>item.platform==='wechat'&&item.id===b.dataset.distributionWechatOpen);if(!row||!['draft','publish'].includes(row.stage))throw Error('原任务操作记录不完整，请先刷新结果');const scope=distributionScope();if(f.distributionScope!==scope)throw Error('工作区或权限已变化，请重新打开稿件');const authorization=await distributionAuthorizeWechat(f,c,row.stage,row.id,scope);await window.guanyinDesktop.wechatPersonalResume(authorization);toast('已打开公众号原任务；已请求过的操作只核对回执，不会重复发送')}catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}}
 if(b.dataset.distributionSend){f.elements.distributionConfirmed.checked=true;await distributionSend(f,b.dataset.distributionSend);}
 if(b.hasAttribute('data-distribution-reconcile')){
  try{b.disabled=true;await distributionReconcile(f);distributionWatch(f);}
  catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}
 }
});

document.addEventListener('change',async e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;
 if(e.target.name==='distributionMediaRights'){if(f.distributionMediaLoading)return;f.distributionMediaRefs=(f.distributionMediaRefs||[]).map(ref=>({...ref,rightsConfirmed:e.target.checked===true}));distributionMediaChanged(f);return;}
 if(e.target.name!=='distributionMedia')return;
 const files=[...e.target.files];if(!files.length)return; // Cancelling the picker keeps the previous saved selection.
 const currentMedia=distributionBeginMediaRead(f);distributionInvalidate(f);distributionRenderMedia(f);
 const status=f.querySelector('[data-distribution-media-status]');status.textContent='正在检查并保存本机配图…';
 try{
  if(files.length>9||files.some(x=>x.size>2097152)||files.reduce((n,x)=>n+x.size,0)>8388608)throw Error('最多 9 张图片，单张 2 MB，合计 8 MB');
  const media=[];for(const file of files){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('仅支持 PNG、JPEG、WebP');const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file)});await distributionDecodeImage(dataUrl);media.push({name:file.name,type:file.type,dataUrl,rightsConfirmed:false});}
  if(!currentMedia())return;
  const saved=await apiRequest('/api/article-media/upload',{method:'POST',body:JSON.stringify({brandId:f.dataset.brand,media})});if(!currentMedia())return;
  const refs=GEO_ARTICLE_EDITOR.articleMediaRefs(saved.media.map(m=>({id:m.id,sha256:m.sha256,rightsConfirmed:(f.distributionMediaRefs||[]).find(ref=>ref.id===m.id&&ref.sha256===m.sha256)?.rightsConfirmed===true})));
  f.distributionMediaFiles=saved.media;f.distributionMediaRefs=refs;f.distributionMediaLoaded=true;distributionMediaChanged(f);status.textContent=saved.media.length+' 张图片已存到本机；保存稿件后保留本次选择';
 }catch(error){if(currentMedia()){f.distributionMediaError=error.message;status.textContent=error.message+'；原有配图已保留，请重新选择或清空配图。';e.target.value='';}}
 finally{if(currentMedia()){f.distributionMediaLoading=false;distributionRenderMedia(f);distributionUpdate(f);}}
});
