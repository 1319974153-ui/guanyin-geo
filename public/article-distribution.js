// One article, explicit targets, independent receipts. No paid synchronization service.
const distributionStateLabels={ready:'尚未发送',sending:'正在发送',draft:'平台草稿已保存',published:'平台返回已发布',queued:'等待连接器',preparing:'正在填稿',prepared:'已填入，未提交',submitted:'已提交，公开待核验',uncertain:'结果待核对，不会重发',needs_attention:'需要处理',cancelled:'已取消'};
function distributionPanel(){return `<section class="article-distribution" aria-label="发布账号与结果"><div class="distribution-heading"><div><h3>发布到我的账号</h3><p>选择账号，在这里完成发送并查看结果。</p></div><button type="button" class="button small" data-distribution-refresh>刷新账号</button></div><div data-distribution-accounts role="group" aria-label="发布目标"><p role="status">正在读取账号…</p></div><label class="field distribution-tags">文章标签<input name="distributionTags" placeholder="例如：软件测试，最多 5 个" maxlength="110"></label><label class="field distribution-media" hidden>图文图片<input type="file" name="distributionMedia" accept="image/png,image/jpeg,image/webp" multiple><span class="helper">选择 1–9 张图片；单张最多 2 MB，合计最多 8 MB。</span><span data-distribution-media-status role="status"></span></label><label class="distribution-confirm"><input type="checkbox" name="distributionConfirmed">我已核对正文、来源及 AI 辅助声明，确认这份内容可发送。</label><p data-distribution-hint class="helper" aria-live="polite">请先选择发布账号。</p><div class="distribution-actions"><button type="button" class="button" data-distribution-send="draft" disabled>保存平台草稿</button><button type="button" class="button primary" data-distribution-send="publish" disabled>发布到所选账号</button><button type="button" class="button" data-distribution-send="prepare" disabled>填入平台编辑器</button></div><p class="form-error" data-distribution-error role="alert"></p><div data-distribution-results aria-live="polite"></div><details class="distribution-more"><summary>其他平台与账号管理</summary><p>新增平台需先配对、登录并核验身份。这里只勾选真实连接的账号；没有连接的渠道不会自动投稿。</p><button type="button" class="button small" data-distribution-manage>添加或管理账号</button><button type="button" class="button small" data-distribution-manual>准备手动交付稿</button></details></section>`}
function distributionScope(){return wordpressBaseScope()}
function distributionArticle(f){return own('contents').find(c=>c.id===f.dataset.id)}
function distributionSelected(f){const keys=[...f.querySelectorAll('[data-distribution-target]:checked')].map(el=>el.value);return (f.distributionTargets||[]).filter(t=>keys.includes(t.key))}
function distributionUpdate(f){
 const selected=distributionSelected(f),allowed=GEO_DISPATCH.availableActions(selected),confirmed=f.elements.distributionConfirmed.checked;
 const canReview=['owner','admin'].includes(accessInfo.current.role),c=distributionArticle(f),reviewed=c?.status==='已审核'&&!articleEditorDirty();
 for(const b of f.querySelectorAll('[data-distribution-send]'))b.disabled=runtimeBusy||f.distributionMediaLoading||!confirmed||!allowed[b.dataset.distributionSend]||(!canReview&&!reviewed);
 f.querySelector('.distribution-tags').hidden=!selected.some(t=>t.platform==='csdn');f.querySelector('.distribution-media').hidden=!selected.some(t=>['douyin','xiaohongshu'].includes(t.platform));
 f.querySelector('[data-distribution-hint]').textContent=!selected.length?'选择一个或多个账号。保存平台草稿不会公开文章。':!canReview&&!reviewed?'当前稿件需要管理员或审核人确认。可以先保存本机草稿。':!Object.values(allowed).some(Boolean)?'所选账号支持的操作不同，请分组发送：WordPress 可保存或发布，CSDN 当前可填入编辑器。':selected.some(t=>t.platform!=='wordpress')?'按账号开放已启用的操作。编辑器填稿不等于平台草稿或公开发布；图片平台需要单独审核短文案。':'已选择 '+selected.length+' 个账号。发布会使内容在这些网站公开；每个账号单独保留回执。';
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
   if(i===1)targets.push({key:a.platform+':'+a.id,platform:a.platform,sessionId:a.id,accountId:a.account?.accountId,name:a.account?.name||'尚未核验账号',detail:browserPlatformNames[a.platform]||a.platform,modes:a.account?(a.modes||['prepare']):[],status:a.account?(a.modes?.includes('publish')?'可执行发布 · 验收开关':'可填入 · 平台验收中'):'请在连接器核验身份'});
  }
 });f.distributionTargets=targets;
 box.innerHTML=(targets.length?targets.map(t=>`<label class="distribution-account"><input type="checkbox" data-distribution-target value="${esc(t.key)}" ${selected.has(t.key)?'checked':''} ${t.modes.length?'':'disabled'}><span><strong>${esc(t.name)}</strong><span class="sub">${esc(t.detail)}</span></span><span class="distribution-capability">${esc(t.status)}</span></label>`).join(''):'<div class="distribution-empty"><strong>连接你的第一个发布账号</strong><p>WordPress 支持草稿与发布；浏览器连接器按平台核验账号、填稿与提交。</p><button type="button" class="button" data-distribution-manage>连接发布账号</button></div>')+errors.map(e=>'<p class="form-error">'+esc(e)+'</p>').join('');
 distributionUpdate(f);await distributionRestore(f);
}
async function distributionKey(c,scope){
 const fields=[c.brandId,c.id,c.title,c.text,!!c.ai,c.factSnapshots||[]];if(c.media?.length)fields.push(c.media.map(m=>m.sha256));const bytes=new TextEncoder().encode(JSON.stringify(fields));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return 'guanyin.distribution.v1.'+scope+'.'+hash;
}
function distributionResults(f){
 const rows=Object.values(f.distributionJournal||{}),box=f.querySelector('[data-distribution-results]');
 box.innerHTML=rows.length?`<div class="distribution-heading"><h3>本稿发送结果</h3><button class="button small" type="button" data-distribution-reconcile>核对结果</button></div><ul class="distribution-receipts">${rows.map(r=>`<li><div><strong>${esc(r.name)}</strong><span>${esc(distributionStateLabels[r.state]||r.state)}</span></div>${r.error?'<p class="form-error">'+esc(r.error)+'</p>':''}${r.remote?.url&&/^https?:\/\//.test(r.remote.url)?`<a href="${esc(r.remote.url)}" target="_blank" rel="noopener noreferrer">查看平台回执</a>`:''}</li>`).join('')}</ul><p class="helper">核对只读取记录，不重新投稿。结果待核对时，请在账号管理中查看远端回执。</p>`:'';
}
async function distributionRestore(f){
 const record=distributionArticle(f);if(!record||articleEditorDirty())return;const c={...record,media:f.distributionMedia||[]};
 const scope=distributionScope(),key=await distributionKey(c,scope);if(!f.isConnected||scope!==distributionScope())return;
 try{f.distributionJournal=JSON.parse(localStorage.getItem(key)||'{}');f.distributionKey=key;distributionResults(f)}catch{f.querySelector('[data-distribution-error]').textContent='无法读取本机发送记录，暂不发送。请保留浏览器数据并检查存储权限。'}
}
async function distributionSend(f,mode){
 const error=f.querySelector('[data-distribution-error]');error.textContent='';if(runtimeBusy||f.distributionBusy)return;f.distributionBusy=true;f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
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
 finally{f.distributionBusy=false;runtimeLock(false);if(f.isConnected){f.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=false);f.querySelectorAll('[data-distribution-target]').forEach(e=>e.disabled=!f.distributionTargets.find(t=>t.key===e.value)?.modes.length);distributionUpdate(f);distributionResults(f)}}
}
document.addEventListener('change',e=>{const f=e.target.closest('[data-article-editor]');if(f&&(e.target.matches('[data-distribution-target]')||e.target.name==='distributionConfirmed'))distributionUpdate(f)});
function distributionInvalidate(f){f.elements.distributionConfirmed.checked=false;f.distributionJournal={};distributionResults(f);distributionUpdate(f)}
document.addEventListener('input',e=>{const f=e.target.closest('[data-article-editor]');if(f&&['title','text'].includes(e.target.name)){distributionInvalidate(f)}});
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-distribution-focus')){f.querySelector('.article-distribution').scrollIntoView({block:'start'});f.querySelector('[data-distribution-target]')?.focus()}
 if(b.hasAttribute('data-distribution-manual')){if(articleEditorDirty()){f.querySelector('[data-distribution-error]').textContent='请先保存并审核修改，再准备交付稿。';return}const c=distributionArticle(f);if(c?.status!=='已审核'){f.querySelector('[data-distribution-error]').textContent='请先完成稿件审核。';return}manualPublicationHandoff(c)}
 if(b.hasAttribute('data-distribution-refresh'))await distributionLoad(f);
 if(b.hasAttribute('data-distribution-manage')){if(articleEditorDirty()){f.querySelector('[data-distribution-error]').textContent='请先保存本机草稿，再连接账号。';return}closeDrawer();location.hash='integrations'}
 if(b.dataset.distributionSend)await distributionSend(f,b.dataset.distributionSend);
 if(b.hasAttribute('data-distribution-reconcile')){
  try{const scope=distributionScope(),c=distributionArticle(f);if(articleEditorDirty()||!c)throw new Error('请先保存当前修改，再核对对应版本');b.disabled=true;
   await GEO_DISPATCH.reconcileDispatch({article:c,journal:f.distributionJournal||{},request:apiRequest,persist:async j=>localStorage.setItem(f.distributionKey,JSON.stringify(j)),assertScope:()=>{if(scope!==distributionScope()||!f.isConnected)throw new Error('工作区或页面已变化')}});distributionResults(f);
  }catch(error){f.querySelector('[data-distribution-error]').textContent=error.message}finally{b.disabled=false}
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
