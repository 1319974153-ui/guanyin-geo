// One article, explicit targets, independent receipts. No paid synchronization service.
const distributionStateLabels={not_queued:'未入队，可重新发送',ready:'尚未发送',sending:'正在发送',draft:'平台草稿已保存',published:'平台返回已发布',queued:'等待连接器',preparing:'正在填稿',submitting:'正在提交',prepared:'已填入，未提交',submitted:'已提交，公开待核验',uncertain:'结果待核对，不会重发',needs_attention:'需要处理',cancelled:'已取消'};
function distributionPanel(){return `<section class="article-distribution" aria-label="发布账号与结果"><div class="distribution-heading"><div><h3>选择发布平台</h3><p>勾选账号，一篇稿件发到多个平台。</p></div></div><div class="distribution-account-tools"><button type="button" class="button small" data-distribution-manage>添加账号</button><button type="button" class="button small" data-distribution-refresh>刷新账号</button><span data-distribution-count aria-live="polite">已选 0 个</span></div><div data-distribution-accounts role="group" aria-label="发布目标"><p role="status">正在读取账号…</p></div><label class="field distribution-tags" hidden>文章标签<input name="distributionTags" placeholder="例如：软件测试，最多 5 个" maxlength="110"></label><label class="field distribution-media" hidden>图文图片<input type="file" name="distributionMedia" accept="image/png,image/jpeg,image/webp" multiple><span class="helper">选择 1–9 张图片；单张最多 2 MB，合计最多 8 MB。</span><span data-distribution-media-status role="status"></span></label><label class="field distribution-mode">发送方式<select name="distributionMode" data-distribution-mode><option value="publish">直接发布</option><option value="draft">保存平台草稿</option><option value="prepare">填入编辑器（需平台提交）</option></select></label><p data-distribution-hint class="helper" aria-live="polite">请先选择发布账号。</p><label class="distribution-confirm" data-distribution-confirmation><input type="checkbox" name="distributionConfirmed">已核对正文、来源和 AI 声明，确认发送这份稿件。</label><div class="distribution-actions"><button type="button" class="button primary" data-distribution-send="publish" disabled>发布到所选平台</button></div><p class="form-error" data-distribution-error role="alert"></p><div data-distribution-results aria-live="polite"></div><details class="distribution-more"><summary>平台接入与其他交付方式</summary><p>账号登录状态保留在自己的浏览器中。各平台按实际接入能力提供操作，登录过期后需重新核验。</p><button type="button" class="button small" data-distribution-manage>查看全部平台与账号</button><button type="button" class="button small" data-distribution-manual>下载适配稿手动发布</button></details></section>`}
function distributionScope(){return wordpressBaseScope()}
function distributionArticle(f){return own('contents').find(c=>c.id===f.dataset.id)}
function distributionSelected(f){const keys=[...f.querySelectorAll('[data-distribution-target]:checked')].map(el=>el.value);return (f.distributionTargets||[]).filter(t=>keys.includes(t.key))}
function distributionUpdate(f){
 const selected=distributionSelected(f),allowed=GEO_DISPATCH.availableActions(selected),confirmed=f.elements.distributionConfirmed.checked;
 const canReview=['owner','admin'].includes(accessInfo.current.role),c=distributionArticle(f),reviewed=c?.status==='已审核'&&!articleEditorDirty();
 const mode=f.elements.distributionMode,action=f.querySelector('[data-distribution-send]');
 for(const option of mode.options)option.disabled=!allowed[option.value];
 if(!allowed[mode.value])mode.value=['publish','draft','prepare'].find(m=>allowed[m])||'publish';
 action.dataset.distributionSend=mode.value;
 for(const selector of ['.distribution-mode','[data-distribution-confirmation]','.distribution-actions'])f.querySelector(selector).hidden=!selected.length;
 const label={publish:'发布到所选平台',draft:'保存到平台草稿箱',prepare:'一键填入所选平台'}[mode.value];
 action.textContent=runtimeBusy?'正在处理…':label+(selected.length?'（'+selected.length+'）':'');
 action.disabled=runtimeBusy||f.distributionMediaLoading||!confirmed||!allowed[mode.value]||(!canReview&&!reviewed);
 f.querySelector('[data-distribution-count]').textContent='已选 '+selected.length+' 个';
 f.querySelector('.distribution-tags').hidden=!selected.some(t=>t.platform==='csdn');f.querySelector('.distribution-media').hidden=!selected.some(t=>['douyin','xiaohongshu'].includes(t.platform));
 f.querySelector('[data-distribution-hint]').textContent=!selected.length?'先选择账号，再选择发送方式。':!canReview&&!reviewed?'稿件尚未审核，请先保存并提交审核。':!Object.values(allowed).some(Boolean)?'所选账号没有共同的发送方式，请按支持的操作分批选择。':mode.value==='prepare'?'当前选择只填入编辑器，仍需在平台提交；不会登记为已发布或已保存平台草稿。':mode.value==='draft'?'保存到所选平台的草稿箱，不公开文章。':'将在所选平台公开文章；每个账号分别显示实际结果。';
}
async function distributionLoad(f){
 if(!f?.isConnected)return;const scope=distributionScope(),box=f.querySelector('[data-distribution-accounts]');f.distributionScope=scope;
 const selected=new Set(distributionSelected(f).map(t=>t.key));box.innerHTML='<p role="status">正在读取账号…</p>';
 const requests=[apiRequest('/api/publishing-center?'+new URLSearchParams({brandId:f.dataset.brand})),browserPublisherAvailable()?apiRequest('/api/local-publisher/status?'+new URLSearchParams({brandId:f.dataset.brand})):Promise.resolve({accounts:[]})];
 const results=await Promise.allSettled(requests);if(!f.isConnected||scope!==distributionScope())return;
 const targets=[],errors=[];
 results.forEach((r,i)=>{if(r.status==='rejected'){errors.push((i?'浏览器连接':'网站账号')+'读取失败：'+r.reason.message);return}
  for(const a of r.value.accounts||[]){
   if(i===0&&a.platform==='wordpress')targets.push({key:'wp:'+a.accountId,platform:'wordpress',accountId:a.accountId,name:a.username,detail:a.site,modes:a.status==='verified'?['draft','publish']:a.status==='permission_limited'?['draft']:[],status:publishingAccountStates[a.status]||a.status});
   if(i===1)targets.push({key:a.platform+':'+a.id,platform:a.platform,sessionId:a.id,accountId:a.account?.accountId,name:a.account?.name||'尚未核验账号',detail:browserPlatformNames[a.platform]||a.platform,modes:a.account?(a.modes||['prepare']):[],status:a.account?(a.modes?.includes('publish')?'可执行发布 · 验收开关':a.modes?.includes('draft')?'可保存平台草稿':'可填入 · 平台验收中'):'请在连接器核验身份'});
  }
 });f.distributionTargets=targets;f.distributionRemoteJobs=results[1].status==='fulfilled'?results[1].value.jobs||[]:[];
 box.innerHTML=(targets.length?targets.map(t=>`<label class="distribution-account"><input type="checkbox" data-distribution-target value="${esc(t.key)}" ${selected.has(t.key)?'checked':''} ${t.modes.length?'':'disabled'}><span><strong>${esc(t.platform==='wordpress'?'WordPress':browserPlatformNames[t.platform]||t.platform)}</strong><span class="sub">${esc(t.name)}</span>${t.platform==='wordpress'?'<span class="sub">'+esc(t.detail)+'</span>':''}</span><span class="distribution-capability">${esc(t.status)}</span></label>`).join(''):'<div class="distribution-empty"><strong>连接你的第一个发布账号</strong><p>WordPress 支持草稿与发布；浏览器连接器按平台核验账号、填稿与提交。</p><button type="button" class="button" data-distribution-manage>连接发布账号</button></div>')+errors.map(e=>'<p class="form-error">'+esc(e)+'</p>').join('');
 distributionUpdate(f);await distributionRestore(f);
}
async function distributionKey(c,scope){
 const fields=[c.brandId,c.id,c.title,c.text,!!c.ai,c.factSnapshots||[]];if(c.media?.length)fields.push(c.media.map(m=>m.sha256));const bytes=new TextEncoder().encode(JSON.stringify(fields));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return 'guanyin.distribution.v1.'+scope+'.'+hash;
}
function distributionResults(f){
 const rows=Object.values(f.distributionJournal||{}),box=f.querySelector('[data-distribution-results]');
 box.innerHTML=rows.length?`<div class="distribution-heading"><h3>本稿发送结果</h3><button class="button small" type="button" data-distribution-reconcile>核对结果</button></div><ul class="distribution-receipts">${rows.map(r=>`<li><div><strong>${esc(r.name)}</strong><span>${esc(distributionStateLabels[r.state]||r.state)}</span></div>${r.error?'<p class="form-error">'+esc(r.error)+'</p>':''}${r.refreshError?'<p class="helper">暂未取得新回执：'+esc(r.refreshError)+'；保留上次状态，不会重新发送。</p>':''}${r.remote?.url&&/^https?:\/\//.test(r.remote.url)?`<a href="${esc(r.remote.url)}" target="_blank" rel="noopener noreferrer">查看平台回执</a>`:''}${r.state==='prepared'&&r.preparation?.editorUrl&&/^https:\/\//.test(r.preparation.editorUrl)?`<p><a href="${esc(r.preparation.editorUrl)}" target="_blank" rel="noopener noreferrer">打开平台编辑页</a> · 填稿已核对，保存与公开状态待确认</p>`:''}</li>`).join('')}</ul><p class="helper" role="status">${esc(distributionWatchLabel(f))}</p><p class="helper">核对只读取记录，不重新投稿。结果待核对时，请在账号管理中查看远端回执。</p>`:'';
}
function distributionWatchLabel(f){
 return ({checking:'正在读取最新结果…',watching:'正在自动更新发布进度。',retry_wait:'暂时无法读取新结果，稍后自动再查；不会重发。',paused:'页面在后台或网络不可用，恢复后继续核对。',timeout:'自动核对已暂停，点击“核对结果”继续；原任务不会重发。',complete:'结果已更新。'})[f.distributionWatchState]||'等待中的任务会自动更新结果。';
}
function distributionStopWatch(f){f.distributionWatcher?.stop();f.distributionWatcher=null;}
async function distributionReconcile(f){
 if(f.distributionReconciling)return false;
 const record=distributionArticle(f),scope=distributionScope(),key=f.distributionKey,journal=f.distributionJournal,epoch=f.distributionEpoch||0;
 if(!record||!key||articleEditorDirty())throw Error('请先保存当前修改，再核对对应版本');
 const valid=()=>f.isConnected&&scope===distributionScope()&&f.dataset.brand===brand().id&&key===f.distributionKey&&journal===f.distributionJournal&&(f.distributionEpoch||0)===epoch&&!articleEditorDirty()&&!f.distributionBusy;
 const assertScope=()=>{if(!valid())throw Error('稿件、工作区或页面已变化，已停止核对')};
 const article={...record,media:f.distributionMedia||[]};f.distributionReconciling=true;
 try{
  assertScope();await GEO_DISPATCH.reconcileDispatch({article,journal,request:apiRequest,persist:async j=>{assertScope();localStorage.setItem(key,JSON.stringify(j))},assertScope});
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
  notify:({state})=>{f.distributionWatchState=state;if(f.isConnected)distributionResults(f)}
 });f.distributionWatcher.start();
}
for(const event of ['visibilitychange','online'])window.addEventListener(event,()=>{for(const f of document.querySelectorAll('[data-article-editor]'))f.distributionWatcher?.wake()});
async function distributionRestore(f){
 const record=distributionArticle(f);if(!record||articleEditorDirty())return;const epoch=f.distributionEpoch=(f.distributionEpoch||0)+1;distributionStopWatch(f);const c={...record,media:f.distributionMedia||[]};
 const scope=distributionScope(),key=await distributionKey(c,scope);if(!f.isConnected||scope!==distributionScope()||epoch!==f.distributionEpoch||articleEditorDirty())return;
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}'),journal=await GEO_DISPATCH.recoverDispatchJournal({article:c,targets:f.distributionTargets||[],jobs:f.distributionRemoteJobs||[],journal:saved});if(!f.isConnected||scope!==distributionScope()||epoch!==f.distributionEpoch||articleEditorDirty())return;localStorage.setItem(key,JSON.stringify(journal));f.distributionJournal=journal;f.distributionKey=key;f.distributionWatchState=GEO_DISPATCH.dispatchNeedsRefresh(journal)?'watching':'complete';distributionResults(f);distributionWatch(f)}catch{f.querySelector('[data-distribution-error]').textContent='无法读取本机发送记录，暂不发送。请保留浏览器数据并检查存储权限。'}
}
async function distributionSend(f,mode){
 const error=f.querySelector('[data-distribution-error]');error.textContent='';if(runtimeBusy||f.distributionBusy)return;distributionStopWatch(f);f.distributionEpoch=(f.distributionEpoch||0)+1;f.distributionBusy=true;f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
 try{
  if(f.distributionScope!==distributionScope()||f.dataset.brand!==brand().id)throw new Error('工作区或品牌已切换，请重新打开稿件');
  if(!f.elements.distributionConfirmed.checked)throw new Error('请先核对并确认稿件');
  const targets=distributionSelected(f);if(!GEO_DISPATCH.availableActions(targets)[mode])throw new Error('所选账号不都支持此操作');
  if(f.distributionMediaLoading)throw new Error('图片仍在读取，请稍后');if(targets.some(t=>['douyin','xiaohongshu'].includes(t.platform))&&!f.distributionMedia?.length)throw new Error('请为图文平台选择图片');
  const tags=f.elements.distributionTags.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean);
  if(targets.some(t=>t.platform==='csdn')&&(!tags.length||tags.length>5||new Set(tags).size!==tags.length||tags.some(t=>t.length>20)))throw new Error('请填写 1 至 5 个不同标签，每个最多 20 字');
  if(targets.some(t=>t.platform==='csdn')&&f.elements.title.value.trim().length>100)throw new Error('CSDN 标题最多 100 字');
  // Explicit confirmation plus this action authorizes an owner/admin to approve this exact revision.
  let c=distributionArticle(f);
  if(articleEditorDirty()||!c||c.status!=='已审核'){
   if(!['owner','admin'].includes(accessInfo.current.role))throw new Error('请先将稿件提交审核');
   c=await articleEditorSave('confirm',{reopen:false});if(!c)throw new Error('稿件未保存，请检查上方提示');
  }
  c={...c,media:f.distributionMedia||[]};const scope=distributionScope(),key=await distributionKey(c,scope),journal=JSON.parse(localStorage.getItem(key)||'{}');
  const assertScope=()=>{if(scope!==distributionScope()||!f.isConnected||f.dataset.brand!==brand().id)throw new Error('工作区或页面已变化，已停止后续发送')};
  const persist=async value=>localStorage.setItem(key,JSON.stringify(value));
  assertScope();await persist(journal);f.distributionJournal=journal;f.distributionKey=key;
  runtimeLock(true);f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
  await GEO_DISPATCH.dispatchArticle({article:{...c,tags},targets,mode,journal,request:apiRequest,persist,assertScope,changed:()=>distributionResults(f)});
  // WordPress publication registers server-owned receipt data. Reload before the next workspace write.
  try{const fresh=await apiRequest('/api/state');state=fresh.state;serverRevision=fresh.revision;}catch{saveBlocked=true;throw new Error('发送记录已保留，但工作区刷新失败。请刷新页面后再编辑，避免覆盖回执。')}
  toast('发送流程已结束，请查看每个账号的实际结果');
 }catch(e){error.textContent=e.message}
 finally{f.distributionBusy=false;runtimeLock(false);if(f.isConnected){f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=false);f.querySelectorAll('[data-distribution-target]').forEach(e=>e.disabled=!f.distributionTargets.find(t=>t.key===e.value)?.modes.length);distributionUpdate(f);distributionResults(f);distributionWatch(f)}}
}
document.addEventListener('change',e=>{const f=e.target.closest('[data-article-editor]');if(f&&(e.target.matches('[data-distribution-target]')||['distributionConfirmed','distributionMode'].includes(e.target.name)))distributionUpdate(f)});
function distributionInvalidate(f){distributionStopWatch(f);f.distributionEpoch=(f.distributionEpoch||0)+1;f.distributionKey=null;f.elements.distributionConfirmed.checked=false;f.distributionJournal={};distributionResults(f);distributionUpdate(f)}
document.addEventListener('input',e=>{const f=e.target.closest('[data-article-editor]');if(f&&['title','text','articleAi'].includes(e.target.name)){distributionInvalidate(f)}});
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-distribution-focus')){f.querySelector('.article-distribution').scrollIntoView({block:'start'});f.querySelector('[data-distribution-target]')?.focus()}
 if(b.hasAttribute('data-distribution-manual')){if(articleEditorDirty()){f.querySelector('[data-distribution-error]').textContent='请先保存并审核修改，再准备交付稿。';return}const c=distributionArticle(f);if(c?.status!=='已审核'){f.querySelector('[data-distribution-error]').textContent='请先完成稿件审核。';return}manualPublicationHandoff(c)}
 if(b.hasAttribute('data-distribution-refresh'))await distributionLoad(f);
 if(b.hasAttribute('data-distribution-manage')){if(articleEditorDirty()){const saved=await articleEditorSave('save',{reopen:false});if(!saved)return;}closeDrawer();location.hash='integrations';toast('账号连接后，从内容与确认中打开原稿继续发送')}
 if(b.dataset.distributionSend)await distributionSend(f,b.dataset.distributionSend);
 if(b.hasAttribute('data-distribution-reconcile')){
  try{b.disabled=true;await distributionReconcile(f);distributionWatch(f);}
  catch(error){if(f.isConnected)f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}
 }
});

document.addEventListener('change',async e=>{
 if(e.target.name!=='distributionMedia')return;const f=e.target.closest('[data-article-editor]');if(!f)return;distributionInvalidate(f);f.distributionMedia=[];f.distributionMediaLoading=true;
 const status=f.querySelector('[data-distribution-media-status]');status.textContent='正在读取图片…';
 try{const files=[...e.target.files];if(files.length>9||files.some(x=>x.size>2097152)||files.reduce((n,x)=>n+x.size,0)>8388608)throw Error('最多 9 张图片，单张 2 MB，合计 8 MB');
 const media=[];for(const file of files){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('仅支持 PNG、JPEG、WebP');const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file)});const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');media.push({name:file.name,type:file.type,dataUrl,sha256})}
 if(!f.isConnected)return;f.distributionMedia=media;status.textContent=media.length+' 张图片已准备，仅在明确发送后上传';
 }catch(err){status.textContent=err.message;e.target.value=''}finally{f.distributionMediaLoading=false;distributionUpdate(f)}
});
