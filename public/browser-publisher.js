const browserPlatformNames={csdn:'CSDN',toutiao:'头条',zhihu:'知乎',douyin:'抖音图文',xiaohongshu:'小红书图文'};
let desktopAccountTimer=null;
function desktopPublisherAvailable(){return !!window.guanyinDesktop?.available&&browserPublisherAvailable()}
let browserPublisherData=null,browserPublisherScope='',browserPublisherLoading=false,browserPublisherError='';
let browserPublisherWatcher=null,browserPublisherWatchScope='';
const browserPublisherStates={published:'发布成功 · 公开正文已核验',publishing:'提交中',sending:'正在发送',draft:'平台草稿已保存 · 未公开',queued:'等待浏览器',preparing:'填入编辑器中',prepared:'已填入 · 未提交',submitting:'提交中',submitted:'已提交 · 公开待核验',needs_attention:'需要处理',uncertain:'结果未知 · 禁止重发',cancelled:'已取消'};
function browserPublisherAvailable(){return isLocalRuntime()&&isManager()&&!sessionStorage.getItem('geo.workspace')&&location.hostname==='127.0.0.1'}
function browserPublisherContext(){return [accessInfo.current.owner,sessionStorage.getItem('geo.workspace')||'',brand()?.id].join('|')}
async function refreshBrowserPublisher(){
 if(!browserPublisherAvailable()||!brand()?.id||browserPublisherLoading)return;
 const id=brand().id,scope=browserPublisherContext();if(browserPublisherScope!==scope){browserPublisherData=null;browserPublisherError='';}browserPublisherLoading=true;
 try{const d=await apiRequest('/api/local-publisher/status?'+new URLSearchParams({brandId:id}));if(browserPublisherContext()===scope&&browserPublisherAvailable()){browserPublisherData=d;browserPublisherScope=scope;browserPublisherError=''}}
 catch(e){if(browserPublisherContext()===scope){browserPublisherError=e.message;browserPublisherScope=scope;}}
 finally{browserPublisherLoading=false;if(['integrations','publish'].includes(route)){if(browserPublisherContext()!==scope)void refreshBrowserPublisher();else {render();browserPublisherWatch();}}}
}
function browserPublisherWatch(){
 if(!browserPublisherAvailable()||!['integrations','publish'].includes(route))return;
 const scope=browserPublisherContext();
 if(browserPublisherWatchScope!==scope){browserPublisherWatcher?.stop();browserPublisherWatcher=null;browserPublisherWatchScope=scope;}
 if(browserPublisherWatcher?.active||browserPublisherScope!==scope||!browserPublisherData?.jobs.some(j=>['queued','preparing','submitting','uncertain'].includes(j.state)))return;
 browserPublisherWatcher=GEO_DISPATCH.createDispatchWatcher({
  valid:()=>browserPublisherAvailable()&&browserPublisherContext()===scope&&['integrations','publish'].includes(route),
  pending:()=>browserPublisherData?.jobs.some(j=>['queued','preparing','submitting','uncertain'].includes(j.state)),
  paused:()=>document.hidden||navigator.onLine===false||runtimeBusy||document.querySelector('#drawer')?.open||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||false,
  refresh:async()=>{await refreshBrowserPublisher();return !browserPublisherError;},interval:4000
 });browserPublisherWatcher.start();
}
window.addEventListener('hashchange',()=>{if(!['#integrations','#publish'].includes(location.hash))browserPublisherWatcher?.stop();else queueMicrotask(()=>void refreshBrowserPublisher())});
for(const event of ['visibilitychange','online'])window.addEventListener(event,()=>browserPublisherWatcher?.wake());
function renderBrowserPublicationHistory(){
 if(!browserPublisherAvailable()||!brand()?.id)return '';
 const scope=browserPublisherContext();if(browserPublisherScope!==scope&&!browserPublisherLoading)queueMicrotask(refreshBrowserPublisher);
 const data=browserPublisherScope===scope?browserPublisherData:null;
 const jobs=(data?.jobs||[]).filter(j=>j.brandId===brand().id).slice().sort((a,b)=>b.created-a.created);
 return `<section class="panel"><div class="panel-head"><div><h2>多平台发送进度</h2><p>保留每次发送的原稿与回执；刷新只查结果，不会重发。</p></div>${btn('刷新发送进度','browser-publisher-refresh','small')}</div><div class="panel-body">${browserPublisherScope===scope&&browserPublisherError?`<p class="form-error" role="alert">${esc(browserPublisherError)}；已保留上次记录。</p>`:''}${table(['内容与平台','实际进度','下一步'],jobs.map(j=>{
  const c=own('contents').find(c=>c.id===j.contentId),url=j.receipt?.url||j.preparation?.editorUrl;
  const advice={queued:desktopPublisherAvailable()?'观引正在自动处理，请保持应用运行。':'打开 Chrome 中的观引连接器，任务会按队列处理。',preparing:'正在处理原任务，请勿重复发送。',submitting:'正在提交原任务，请勿重复发送。',draft:'已保存在平台草稿箱，尚未公开。',prepared:'正文已填入，仍需在平台检查并提交。',submitted:'平台已接收，公开可访问状态仍待核对。',uncertain:'先到平台核对原稿，结果不明时不能重发。',needs_attention:'查看原因，在账号页核对后继续原任务。',cancelled:'本任务已取消，记录保留。'}[j.state]||'请核对平台实际结果。';
  return [esc(j.title)+`<span class="sub">${esc(browserPlatformNames[j.platform]||j.platform)} · ${esc(j.accountId)}</span>`+(j.currentRevision!==true?'<span class="sub">历史版本；当前稿件已变化或移除</span>':''),esc(browserPublisherStates[j.state]||j.state)+`<span class="sub">${esc(advice)}</span>`+(j.error?`<span class="sub">${esc(j.error)}</span>`:''),(url?links(url,j.receipt?'查看平台回执':'打开原编辑页'):'')+(c?btn(j.currentRevision===true?'原稿与回执':'查看当前稿件',j.currentRevision===true?'distribute-article':'edit-content','small',`data-id="${esc(c.id)}"`):'')+(['needs_attention','uncertain'].includes(j.state)?'<a class="button small" href="#integrations">检查发布账号</a>':'')];
 }))}${!data?(browserPublisherScope===scope&&browserPublisherError?'<p>记录读取失败，请刷新重试。当前发送状态未知。</p>':'<p role="status">正在读取发送记录…</p>'):!jobs.length?'<p>还没有发送任务。<a href="#inbox">打开内容，选择账号发送 →</a></p>':''}</div></section>`;
}
function renderBrowserPublisher(){
 if(!browserPublisherAvailable()||!brand()?.id)return '';
 if(browserPublisherScope!==browserPublisherContext()&&!browserPublisherLoading)queueMicrotask(refreshBrowserPublisher);
 const d=browserPublisherScope===browserPublisherContext()?browserPublisherData:null;
 if(desktopPublisherAvailable())return desktopAccountPanel(d);
 return `<section class="panel browser-account-connect"><div class="panel-head"><div class="browser-account-heading"><h2>连接你的发布账号</h2><p>选择平台，登录后保存连接；日常只需勾选账号。</p></div><label class="field">平台<select id="browser-publisher-platform">${Object.entries(browserPlatformNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>${btn('连接所选平台','browser-publisher-pair','primary small')}${btn('刷新','browser-publisher-refresh','small')}</div><div class="panel-body"><p>首次安装连接器，在所选平台登录并核验账号。连接器仅处理你在这里明确授权的任务。</p>${btn('找不到连接器或回执按钮？','browser-publisher-help','small')}${browserPublisherScope===browserPublisherContext()&&browserPublisherError?`<p class="form-error">${esc(browserPublisherError)}</p>`:''}${d?table(['浏览器账号','状态','操作'],d.accounts.map(a=>[esc(a.account?.name||'已配对，尚未核验')+(a.account?'<span class="sub">'+esc(browserPlatformNames[a.platform]||a.platform)+' · '+esc(a.account.accountId)+'</span>':''),a.account?'已读取登录身份 · 提交前再次核对':'请在扩展中登录并核验',`${a.account?btn('选择稿件','browser-publisher-compose','small',`data-session="${esc(a.id)}"`):''}${btn('撤销连接','browser-publisher-revoke','small',`data-session="${esc(a.id)}"`)}`]),'尚未连接。这里不会生成演练账号。'):''}<p class="helper">五个平台的连接、任务与适配代码已接入；每个平台仍需核验真实账号与编辑器。自动发布仅在该平台验收开关开启时可用。</p>${d?.jobs.length?table(['稿件','进度','操作'],d.jobs.slice().reverse().map(j=>[esc(j.title),esc(browserPublisherStates[j.state]||j.state)+(j.error?'<span class="sub">'+esc(j.error)+'</span>':''),j.receipt?`<a href="${esc(j.receipt.url)}" target="_blank" rel="noopener noreferrer">查看平台回执</a>`:j.preparation?.editorUrl?`<a href="${esc(j.preparation.editorUrl)}" target="_blank" rel="noopener noreferrer">打开平台编辑页</a><span class="sub">填稿已核对；平台保存与公开状态待确认</span>`:j.state==='needs_attention'?btn('核对后重新授权','browser-publisher-retry','small',`data-id="${esc(j.id)}"`):j.state==='queued'?btn('取消','browser-publisher-cancel','small',`data-id="${esc(j.id)}"`):'—'])):''}</div></section>`;
}
async function browserPublisherAction(name,el){
 if(!name.startsWith('browser-publisher-'))return false;
 if(!browserPublisherAvailable())throw new Error('浏览器连接仅限当前本机所有者');
 const action=name.slice('browser-publisher-'.length);
 if(action==='help'){openDrawer('找到观引连接器',`<ol><li>打开电脑上的 Chrome 浏览器，点击右上角拼图形状的“扩展程序”图标。</li><li>选择“观引发布连接器（验收版）”；可以点图钉固定到工具栏。</li><li>在弹窗的“发布平台”选择对应平台。</li><li>需要恢复结果时，点击底部的“核对上次回执”。这会检查原任务，不会新建或公开发布文章。</li></ol><p>已安装时无需重新安装或配对；找不到扩展时再按交付包说明安装。连接器弹窗和观引网页是两个入口。</p>`);return true;}
 if(action==='copy'){const value=document.querySelector('[aria-label="一次性配对信息"]')?.value;if(!value)throw Error('配对信息已关闭，请重新连接');await navigator.clipboard.writeText(value);toast('已复制，请粘贴到观引连接器');return true;}
 if(action==='refresh'){await refreshBrowserPublisher();return true}
 if(action==='desktop-open'){await window.guanyinDesktop.openAccount(el.dataset.session);toast('已打开平台窗口；已有任务会回到原稿');await refreshBrowserPublisher();return true;}
 if(action==='pair'&&desktopPublisherAvailable()){
  startDesktopAccountWatch();await runtimeFlush();await window.guanyinDesktop.connect({brandId:brand().id,platform:el?.dataset?.platform||document.getElementById('browser-publisher-platform')?.value||'csdn'});toast('已打开登录窗口，登录完成后自动识别账号');await refreshBrowserPublisher();return true;
 }
 if(action==='pair'){
  await runtimeFlush();const d=await apiRequest('/api/local-publisher/pairing',{method:'POST',body:JSON.stringify({brandId:brand().id,platform:el?.dataset?.platform||document.getElementById('browser-publisher-platform')?.value||'csdn'})});
  const pairing=JSON.stringify({origin:d.origin,instance:d.instance,code:d.code,platform:d.platform});
  openDrawer('连接 Chrome 发布扩展',`<p>1. 在 Chrome 扩展页开启开发者模式，加载交付包中的 browser-extension 文件夹。</p><p>2. 点击观引扩展，粘贴下方配对信息，点击“连接本机观引”。</p><p>3. 在扩展选择相同平台，点击“打开所选平台并登录”，登录后点“核验当前账号”，最后在这里刷新。</p><label class="field">一次性配对信息 · 5 分钟有效<textarea readonly rows="5" aria-label="一次性配对信息">${esc(pairing)}</textarea></label>${btn('复制配对信息','browser-publisher-copy','primary')}${el?.dataset?.contentId?btn('连接后返回文章','distribute-article','small',`data-id="${esc(el.dataset.contentId)}"`):''}<p class="helper">配对信息相当于本次连接凭据，请勿发给其他人。只授予本机和所选平台所需权限，不要求读取 Cookie。</p>`,'绑定当前品牌 · 可随时撤销');return true;
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

function desktopAccountPanel(d){
 startDesktopAccountWatch();
 return `<section class="panel"><div class="panel-head"><div><h2>发布账号</h2><p>登录一次，之后勾选平台即可发送。账号和结果由观引自动检查。</p></div><label class="field">平台<select id="browser-publisher-platform"><option value="toutiao">头条</option><option value="zhihu">知乎</option><option value="csdn">CSDN</option><option value="douyin">抖音图文（填稿验收）</option></select></label>${btn('添加账号','browser-publisher-pair','primary small')}</div><div class="panel-body">${browserPublisherError?'<p class="form-error">'+esc(browserPublisherError)+'</p>':''}<div id="desktop-account-table">${desktopAccountTable(d)}</div><p class="helper">无需浏览器插件。登录信息仅保存在本机；平台要求扫码或验证码时由你本人完成。公开发布仅对已通过验收的渠道开放。</p></div></section>`;
}

function desktopAccountTable(d){const labels={awaiting_login:'等待登录',checking:'正在连接',connected:'已连接',needs_login:'需要登录',error:'连接异常'};return d?table(['平台与账号','连接状态','操作'],d.accounts.filter(a=>a.transport==='desktop').map(a=>[esc(browserPlatformNames[a.platform])+'<span class="sub">'+esc(a.account?.name||'登录后自动识别')+'</span>',esc(labels[a.connectionState]||'等待登录')+(a.connectionError?'<span class="sub">'+esc(a.connectionError)+'</span>':''),btn(a.account?'打开账号':'去登录','browser-publisher-desktop-open','small',`data-session="${esc(a.id)}"`)+(a.account?btn('写文章','browser-publisher-compose','small'):'')+btn('断开连接','browser-publisher-revoke','small',`data-session="${esc(a.id)}"`)]),'还没有账号。点击添加账号，在平台自己的窗口登录即可。'):'<p>正在读取账号…</p>'}

let desktopAccountsRefreshing=false;
async function refreshDesktopAccounts(){
 if(desktopAccountsRefreshing||document.hidden||!desktopPublisherAvailable()||!brand()?.id)return;
 const form=document.querySelector('[data-article-editor]');if(!['integrations','publish'].includes(route)&&!form)return;
 const scope=browserPublisherContext(),id=brand().id;desktopAccountsRefreshing=true;
 try{const data=await apiRequest('/api/local-publisher/status?'+new URLSearchParams({brandId:id}));if(scope!==browserPublisherContext())return;
  const changed=desktopAccountFingerprint(browserPublisherData?.accounts)!==desktopAccountFingerprint(data.accounts);browserPublisherData=data;browserPublisherScope=scope;
  if(changed){const table=document.getElementById('desktop-account-table');if(table)table.innerHTML=desktopAccountTable(data);if(form&&!form.distributionBusy&&form.isConnected)await distributionLoad(form);}
 }catch{}finally{desktopAccountsRefreshing=false}
}

function startDesktopAccountWatch(){if(!desktopAccountTimer)desktopAccountTimer=setInterval(()=>void refreshDesktopAccounts(),4000)}
window.addEventListener('beforeunload',()=>{clearInterval(desktopAccountTimer);desktopAccountTimer=null;browserPublisherWatcher?.stop()});

function desktopAccountFingerprint(accounts){return JSON.stringify((accounts||[]).map(a=>({id:a.id,platform:a.platform,transport:a.transport,state:a.connectionState,error:a.connectionError,modes:a.modes,account:a.account?{accountId:a.account.accountId,name:a.account.name}:null})).sort((a,b)=>a.id.localeCompare(b.id)))}
