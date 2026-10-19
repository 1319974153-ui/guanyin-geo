const browserPlatformNames={csdn:'CSDN',toutiao:'头条',zhihu:'知乎',douyin:'抖音图文',xiaohongshu:'小红书图文'};
let browserPublisherData=null,browserPublisherScope='',browserPublisherLoading=false,browserPublisherError='';
const browserPublisherStates={queued:'等待浏览器',preparing:'填入编辑器中',prepared:'已填入 · 未提交',submitting:'提交中',submitted:'已提交 · 公开待核验',needs_attention:'需要处理',uncertain:'结果未知 · 禁止重发',cancelled:'已取消'};
function browserPublisherAvailable(){return isLocalRuntime()&&isManager()&&!sessionStorage.getItem('geo.workspace')&&location.hostname==='127.0.0.1'}
async function refreshBrowserPublisher(){
 if(!browserPublisherAvailable()||!brand()?.id||browserPublisherLoading)return;
 const id=brand().id;if(browserPublisherScope!==id)browserPublisherData=null;browserPublisherLoading=true;
 try{const d=await apiRequest('/api/local-publisher/status?'+new URLSearchParams({brandId:id}));if(brand()?.id===id){browserPublisherData=d;browserPublisherScope=id;browserPublisherError=''}}catch(e){browserPublisherError=e.message;browserPublisherScope=id}finally{browserPublisherLoading=false;if(route==='integrations')render()}
}
function renderBrowserPublisher(){
 if(!browserPublisherAvailable()||!brand()?.id)return '';
 if(browserPublisherScope!==brand().id&&!browserPublisherLoading)queueMicrotask(refreshBrowserPublisher);
 const d=browserPublisherScope===brand().id?browserPublisherData:null;
 return `<section class="panel"><div class="panel-head"><div><h2>浏览器发布连接</h2><p>多平台连接 · 逐平台验收</p></div><label class="field">平台<select id="browser-publisher-platform">${Object.entries(browserPlatformNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>${btn('连接 Chrome','browser-publisher-pair','primary small')}${btn('刷新','browser-publisher-refresh','small')}</div><div class="panel-body"><p>首次安装连接器，在所选平台登录并核验账号。连接器仅处理你在这里明确授权的任务。</p>${browserPublisherError?`<p class="form-error">${esc(browserPublisherError)}</p>`:''}${d?table(['浏览器账号','状态','操作'],d.accounts.map(a=>[esc(a.account?.name||'已配对，尚未核验')+(a.account?'<span class="sub">'+esc(browserPlatformNames[a.platform]||a.platform)+' · '+esc(a.account.accountId)+'</span>':''),a.account?'已读取登录身份 · 提交前再次核对':'请在扩展中登录并核验',`${a.account?btn('选择稿件','browser-publisher-compose','small',`data-session="${esc(a.id)}"`):''}${btn('撤销连接','browser-publisher-revoke','small',`data-session="${esc(a.id)}"`)}`]),'尚未连接。这里不会生成演练账号。'):''}<p class="helper">五个平台的连接、任务与适配代码已接入；每个平台仍需核验真实账号与编辑器。自动发布仅在该平台验收开关开启时可用。</p>${d?.jobs.length?table(['稿件','进度','操作'],d.jobs.slice().reverse().map(j=>[esc(j.title),esc(browserPublisherStates[j.state]||j.state)+(j.error?'<span class="sub">'+esc(j.error)+'</span>':''),j.receipt?`<a href="${esc(j.receipt.url)}" target="_blank" rel="noopener noreferrer">查看平台回执</a>`:j.state==='needs_attention'?btn('核对后重新授权','browser-publisher-retry','small',`data-id="${esc(j.id)}"`):j.state==='queued'?btn('取消','browser-publisher-cancel','small',`data-id="${esc(j.id)}"`):'—'])):''}</div></section>`;
}
async function browserPublisherAction(name,el){
 if(!name.startsWith('browser-publisher-'))return false;
 if(!browserPublisherAvailable())throw new Error('浏览器连接仅限当前本机所有者');
 const action=name.slice('browser-publisher-'.length);
 if(action==='refresh'){await refreshBrowserPublisher();return true}
 if(action==='pair'){
  await runtimeFlush();const d=await apiRequest('/api/local-publisher/pairing',{method:'POST',body:JSON.stringify({brandId:brand().id,platform:document.getElementById('browser-publisher-platform')?.value||'csdn'})});
  const pairing=JSON.stringify({origin:d.origin,instance:d.instance,code:d.code,platform:d.platform});
  openDrawer('连接 Chrome 发布扩展',`<p>1. 在 Chrome 扩展页开启开发者模式，加载交付包中的 browser-extension 文件夹。</p><p>2. 点击观引扩展，粘贴下方配对信息，点击“连接本机观引”。</p><p>3. 在扩展选择相同平台，点击“打开所选平台并登录”，登录后点“核验当前账号”，最后在这里刷新。</p><label class="field">一次性配对信息 · 5 分钟有效<textarea readonly rows="5" aria-label="一次性配对信息">${esc(pairing)}</textarea></label><p class="helper">配对信息相当于本次连接凭据，请勿发给其他人。只授予本机和所选平台所需权限，不要求读取 Cookie。</p>`,'绑定当前品牌 · 可随时撤销');return true;
 }
 if(action==='compose'){
  openArticleEditor();return true;
 }
 if(['revoke','retry','cancel'].includes(action)){
  await runtimeFlush();await apiRequest('/api/local-publisher/'+action,{method:'POST',body:JSON.stringify({sessionId:el.dataset.session,id:el.dataset.id})});await refreshBrowserPublisher();return true;
 }
 return true;
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-browser-publisher-form]');if(!f)return;e.preventDefault();const button=e.submitter||f.querySelector('button'),mode=button.value||'prepare';f.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{if(f.dataset.brand!==brand()?.id)throw new Error('品牌已切换，请重新选择');await runtimeFlush();await apiRequest('/api/local-publisher/enqueue',{method:'POST',body:JSON.stringify({brandId:f.dataset.brand,sessionId:f.dataset.session,contentId:f.elements.contentId.value,tags:f.elements.tags.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean),mode})});closeDrawer();await refreshBrowserPublisher();toast('任务已入队；Chrome 连接器运行时会处理。尚未提交文章。')}catch(e){f.querySelector('.form-error').textContent=e.message;f.querySelectorAll('button').forEach(b=>b.disabled=false)}
});
