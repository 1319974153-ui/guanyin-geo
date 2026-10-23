let publishingCenterData=null,publishingCenterLoaded='',publishingCenterLoading=false,publishingCenterError='',publishingCenterErrorScope='';
const publishingAccountStates={draft_only:'可保存草稿',disabled:'已暂停',unverified:'待验证身份',permission_limited:'仅有编辑权限',verified:'已核验发布权限'};
function publishingCenterInvalidate(){publishingCenterLoaded='';publishingCenterError='';}
function publishingCenterCurrent(){return publishingCenterLoaded===wordpressBaseScope()?publishingCenterData:null}
async function refreshPublishingCenter(){
 if(publishingCenterLoading||!brand()?.id)return;
 const scope=wordpressBaseScope(),brandId=brand().id;publishingCenterLoading=true;
 try{const d=await apiRequest('/api/publishing-center?'+new URLSearchParams({brandId}));if(scope===wordpressBaseScope()){publishingCenterData=d;publishingCenterLoaded=scope;publishingCenterError='';}}
 catch(e){if(scope===wordpressBaseScope()){publishingCenterError=e.message;publishingCenterErrorScope=scope;}}
 finally{publishingCenterLoading=false;if(['integrations','publish'].includes(route))render();}
}
function publishingCenterDecorate(){
 if(['integrations','publish'].includes(route)&&brand()?.id&&publishingCenterLoaded!==wordpressBaseScope()&&!publishingCenterLoading&&(!publishingCenterError||publishingCenterErrorScope!==wordpressBaseScope()))refreshPublishingCenter();
}
function publishingAccountSelector(){
 const d=publishingCenterCurrent(),selected=wordpressSelectedAccount();
 if(!d)return '<p class="helper"><a href="#integrations">管理发布账号</a></p>';
 const rows=d.accounts.filter(a=>a.platform==='wordpress');
 const options=rows.map(a=>`<option value="${esc(a.accountId)}" ${a.accountId===selected?'selected':''}>${esc(a.username)} · ${esc(a.site)} · ${esc(publishingAccountStates[a.status]||a.status)}</option>`).join('');
 return `<label class="field">发布到哪个账号<select data-publishing-account aria-label="WordPress 发布账号">${!rows.some(a=>a.accountId===selected)?`<option value="${esc(selected)}" selected>未配置的${selected==='default'?'默认':'新'}账号</option>`:''}${options}</select></label><a href="#integrations">添加或管理发布账号 →</a>`;
}
function publishingCatalogPanel(platforms){
 const groupNames={self_hosted:'自建网站',knowledge:'技术与知识社区',general:'综合内容平台',social:'社交与图文',video:'视频社区',vertical:'垂直社区'};
 return `<details class="simple-detail"><summary>全部平台与接入进度 · ${platforms.length} 项</summary><p>文章、图文和自建网站统一管理；长文与图文分别接入。</p><p class="helper">平台清单不代表已经登录或可发布。浏览器适配仅用于本机连接器；是否可发送以你自己的账号和实际开放操作为准。</p>${Object.entries(groupNames).map(([group,label])=>`<h3>${label}</h3><div class="integration-grid">${platforms.filter(p=>p.group===group).map(p=>`<article class="integration"><h4>${esc(p.name)}</h4><p>${esc(p.stage||'待开发')}</p><p class="helper">${esc(p.note)}</p>${p.actionEvidence?'<details><summary>各项能力验收</summary>'+Object.entries(p.actionEvidence).map(([action,e])=>'<p class="helper">'+esc(({identity:'账号核验',prepare:'填入编辑器',draft:'平台草稿',publish:'公开提交'})[action]||action)+'：'+esc(e.label)+(e.evidence?.connectorVersion?' · 连接器 '+esc(e.evidence.connectorVersion):'')+'</p>').join('')+'</details>':''}</article>`).join('')}</div>`).join('')}<p class="helper">Markdown / PDF 是本地导出，不计作平台发布。待开发平台暂不申请登录权限。</p></details>`;
}
function renderPublishingCenter(){
 if(!brand()?.id)return '';
 const d=publishingCenterCurrent(),error=publishingCenterErrorScope===wordpressBaseScope()?publishingCenterError:'';
 const actions=a=>['cnblogs','typecho','personal-site'].includes(a.platform)?btn('稿件与回执','publishing-account-open','small',`data-account="${esc(a.accountId)}"`)+(isManager()?btn('管理连接','publishing-account-config','small',`data-account="${esc(a.accountId)}"`):''):`${btn('查看稿件与回执','publishing-account-open','small',`data-account="${esc(a.accountId)}"`)}${isManager()?btn('管理连接','publishing-account-config','small',`data-account="${esc(a.accountId)}"`)+(a.status!=='disabled'?btn('验证身份与权限','publishing-account-verify','small',`data-account="${esc(a.accountId)}"`):''):''}`;
 return `<section class="panel"><div class="panel-head"><div><h2>我的发布账号</h2><p>这里只显示你实际添加的账号，连接后即可验证发布权限。</p></div>${btn('写文章','write-article','small')}${btn('刷新账号','publishing-refresh','small')}${isManager()?btn('连接博客园','publishing-cnblogs-add','small')+btn('连接 Typecho','publishing-typecho-add','small')+btn('连接个人官网','publishing-personal-site-add','small')+btn('添加 WordPress 账号','publishing-account-add','primary small'):''}</div><div class="panel-body">${error?`<p class="form-error" role="alert">${esc(error)}</p>`:!d?'<p role="status">正在读取发布账号…</p>':''}${d?table(['发布账号','上次核验','操作'],d.accounts.map(a=>[esc(a.username)+'<span class="sub">'+esc(a.site)+(a.remoteAccountId?' · #'+esc(a.remoteAccountId):'')+'</span>',badge(publishingAccountStates[a.status]||a.status)+(a.verifiedAt?'<span class="sub">'+esc(a.verifiedAt.slice(0,16).replace('T',' '))+' UTC</span>':''),actions(a)]),'还没有发布账号。添加后先验证身份和权限。'):''}<p class="helper">WordPress 使用应用密码；博客园使用平台访问令牌；Typecho 使用网站账号密码。连接时自动核对身份。保存连接不会发布文章；查询显示上次核验结果，执行前仍检查权限。每个账号的稿件、封面和回执分别保存。</p>${d?publishingCatalogPanel(d.platforms):''}</div></section>`;
}
async function publishingCenterAction(name,el){
 if(!name.startsWith('publishing-'))return false;
 if(name==='publishing-refresh'){publishingCenterInvalidate();await refreshPublishingCenter();return true;}
 if(name==='publishing-personal-site-add'){await personalSiteConfigure();return true;}
 if(name==='publishing-typecho-add'){await typechoConfigure();return true;}
 if(name==='publishing-cnblogs-add'){await cnblogsConfigure();return true;}
 const baseScope=wordpressBaseScope();
 if(name==='publishing-account-add'){
  if(!isManager())throw new Error('只有管理员可以连接发布账号');
  wordpressSelectAccount('wp-'+crypto.randomUUID());
  openDrawer('添加 WordPress 发布账号',wordpressConfigForm(),'新账号独立保存 · 不覆盖已有连接');return true;
 }
 const account=publishingCenterCurrent()?.accounts.find(a=>a.accountId===el.dataset.account);
 if(!account)throw new Error('账号列表已变化，请刷新后重试');
 if(account.platform==='personal-site'){if(name==='publishing-account-open')await personalSiteReceipts(account);else if(name==='publishing-account-config')await personalSiteConfigure(account);return true;}
 if(account.platform==='typecho'){if(name==='publishing-account-open')await typechoReceipts(account);else if(name==='publishing-account-config')await typechoConfigure(account);return true;}
 if(account.platform==='cnblogs'){if(name==='publishing-account-open')await cnblogsReceipts(account);else if(name==='publishing-account-config')await cnblogsConfigure(account);return true;}
 if(name==='publishing-account-open'){wordpressSelectAccount(account.accountId);location.hash='publish';await refreshWordpress();return true;}
 if(name==='publishing-account-verify'){
  if(!isManager())throw new Error('只有管理员可以验证连接');
  wordpressSelectAccount(account.accountId);runtimeLock(true);
  try{await wordpressMutation('verify',{brandId:brand().id});if(baseScope===wordpressBaseScope())toast('账号身份与权限已核验');}finally{runtimeLock(false)}return true;
 }
 if(name==='publishing-account-config'){
  if(!isManager())throw new Error('只有管理员可以管理连接');
  wordpressSelectAccount(account.accountId);await refreshWordpress();
  if(baseScope!==wordpressBaseScope()||account.accountId!==wordpressSelectedAccount())return true;
  if(wordpressLoaded!==wordpressScope())throw new Error(wordpressError||'未能读取账号，请稍后重试');
  openDrawer('管理 WordPress 发布账号',wordpressConfigForm(),'修改连接后需要重新验证权限');return true;
 }
 return true;
}
document.addEventListener('change',async e=>{
 if(!e.target.matches('[data-publishing-account]')||runtimeBusy)return;
 wordpressSelectAccount(e.target.value);render();await refreshWordpress();
});
