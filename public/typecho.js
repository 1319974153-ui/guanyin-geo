async function typechoConfigure(account){
 if(!isManager())throw Error('只有管理员可以连接账号');
 const scope=wordpressBaseScope(),id=account?.accountId||'tc-'+crypto.randomUUID();
 openDrawer('连接 Typecho',`<form data-typecho-form data-account="${esc(id)}" data-scope="${esc(scope)}" data-revision="${esc(account?.connectionRevision||'')}"><p>连接你自己的 Typecho 网站，之后在文章页勾选保存草稿或发布，无需浏览器插件。</p>${catalogInput('网站地址','site',account?.site||'','url',true,500)}${catalogInput('网站用户名','username',account?.username||'','text',true,100)}<label class="field">接口访问密码<input type="password" name="password" autocomplete="new-password" maxlength="1024" ${account?'':'required'} placeholder="${account?'留空保留已保存的密码':'填写此网站账号的访问密码'}"></label><p class="helper">仅发送到你填写的同源 HTTPS 网站，加密保存在本机工作区；建议使用专门的作者账号。网站需启用 XML-RPC。</p><details><summary>接口地址 · 标准安装无需修改</summary>${catalogInput('XML-RPC 地址','endpoint',account?.endpoint||'','url',false,600)}<p>默认使用网站目录下的 index.php/action/xmlrpc。若网站采用其他入口，请从 Typecho 设置复制完整接口地址。</p></details><p class="form-error" role="alert"></p><button class="button primary" type="submit">连接并保存</button><p class="helper">连接只读取账号归属，不发文。不同主题的公开正文核验能力可能不同；未核验时显示“已提交，待确认”。</p></form>`,'首次连接 · 自动核对网站与账号');
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-typecho-form]');if(!f)return;e.preventDefault();if(runtimeBusy)return;
 const error=f.querySelector('.form-error'),button=f.querySelector('button[type=submit]');
 try{
  if(f.dataset.scope!==wordpressBaseScope())throw Error('工作区或品牌已切换，请重新打开');
  runtimeLock(true);button.disabled=true;error.textContent='';
  const values=Object.fromEntries(new FormData(f));
  await apiRequest('/api/typecho/connection',{method:'POST',body:JSON.stringify({...values,brandId:brand().id,accountId:f.dataset.account,revision:f.dataset.revision})});
  f.elements.password.value='';
  if(f.dataset.scope!==wordpressBaseScope())return;publishingCenterInvalidate();closeDrawer();await refreshPublishingCenter();toast('Typecho已连接。打开稿件，选择保存平台草稿并勾选Typecho。');
 }catch(e){if(f.isConnected)error.textContent=e.message}finally{runtimeLock(false);if(f.isConnected)button.disabled=false}
});
async function typechoReceipts(account){
 const scope=wordpressBaseScope(),d=await apiRequest('/api/typecho/records?'+new URLSearchParams({brandId:brand().id,accountId:account.accountId}));if(scope!==wordpressBaseScope())return;
 openDrawer('Typecho稿件与回执',`<p>${esc(account.site)} · ${esc(account.username)}</p>${d.records.map(r=>`<article class="panel"><h3>${esc(r.snapshot.title)}</h3><p>${esc(distributionResultLabel(r))}${r.remote?.postId?' · #'+esc(r.remote.postId):''}</p>${r.error?'<p class="form-error">'+esc(r.error)+'</p>':''}<button class="button small" data-typecho-reconcile="${esc(r.id)}" data-account="${esc(account.accountId)}" data-scope="${esc(scope)}">核对原稿结果</button></article>`).join('')||'<p>还没有任务。请从文章编辑页选择保存草稿或发布。</p>'}<p class="helper">核对只读取已有文章，不会重新创建或公开发布。</p>`,'最近 100 条任务 · 不重新发送');
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-typecho-reconcile]');if(!b||runtimeBusy)return;
 try{if(b.dataset.scope!==wordpressBaseScope())throw Error('工作区已变化');b.disabled=true;runtimeLock(true);
  await apiRequest('/api/typecho/reconcile',{method:'POST',body:JSON.stringify({brandId:brand().id,accountId:b.dataset.account,id:b.dataset.typechoReconcile})});
  if(b.dataset.scope===wordpressBaseScope())await typechoReceipts(publishingCenterCurrent().accounts.find(a=>a.accountId===b.dataset.account));
 }catch(e){toast(e.message)}finally{runtimeLock(false);if(b.isConnected)b.disabled=false}
});
