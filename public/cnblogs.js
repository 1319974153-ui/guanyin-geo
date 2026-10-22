async function cnblogsConfigure(account){
 if(!isManager())throw Error('只有管理员可以连接账号');
 const scope=wordpressBaseScope(),id=account?.accountId||'cb-'+crypto.randomUUID();
 openDrawer('连接博客园',`<form data-cnblogs-form data-account="${esc(id)}" data-scope="${esc(scope)}" data-revision="${esc(account?.connectionRevision||'')}"><p>使用博客园官方 MetaWeblog 接口，无需浏览器插件。连接一次后，可在文章中勾选保存草稿。</p>${catalogInput('博客地址名称','blog',account?.blog||'','text',true,80)}<p class="helper">例如 https://www.cnblogs.com/wenshu-geo/ 中的 wenshu-geo。</p>${catalogInput('博客园用户名','username',account?.username||'','text',true,100)}<label class="field">访问令牌<input type="password" name="token" autocomplete="new-password" maxlength="1024" ${account?'':'required'} placeholder="${account?'留空保留原令牌':'填写平台提供的 MetaWeblog 访问令牌'}"></label><p class="helper">在<a href="https://i.cnblogs.com/settings" target="_blank" rel="noopener noreferrer">博客园官方设置</a>查看接口访问设置。不要填写登录密码。令牌加密保存在你的工作区。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">连接并保存</button><p class="helper">本轮仅开放草稿；平台真实账号验收尚待完成。不会自动公开文章。</p></form>`,'首次连接 · 自动核对博客归属');
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-cnblogs-form]');if(!f)return;e.preventDefault();if(runtimeBusy)return;
 const error=f.querySelector('.form-error'),button=f.querySelector('button[type=submit]');
 try{
  if(f.dataset.scope!==wordpressBaseScope())throw Error('工作区或品牌已切换，请重新打开');
  runtimeLock(true);button.disabled=true;error.textContent='';
  const values=Object.fromEntries(new FormData(f));
  await apiRequest('/api/cnblogs/connection',{method:'POST',body:JSON.stringify({...values,brandId:brand().id,accountId:f.dataset.account,revision:f.dataset.revision})});
  f.elements.token.value='';
  if(f.dataset.scope!==wordpressBaseScope())return;publishingCenterInvalidate();closeDrawer();await refreshPublishingCenter();toast('博客园已连接。打开稿件，选择保存平台草稿并勾选博客园。');
 }catch(e){if(f.isConnected)error.textContent=e.message}finally{runtimeLock(false);if(f.isConnected)button.disabled=false}
});
async function cnblogsReceipts(account){
 const scope=wordpressBaseScope(),d=await apiRequest('/api/cnblogs/records?'+new URLSearchParams({brandId:brand().id,accountId:account.accountId}));if(scope!==wordpressBaseScope())return;
 openDrawer('博客园草稿与回执',`<p>${esc(account.site)} · ${esc(account.username)}</p>${d.records.map(r=>`<article class="panel"><h3>${esc(r.snapshot.title)}</h3><p>${esc(distributionResultLabel(r))}${r.remote?.postId?' · #'+esc(r.remote.postId):''}</p>${r.error?'<p class="form-error">'+esc(r.error)+'</p>':''}<button class="button small" data-cnblogs-reconcile="${esc(r.id)}" data-account="${esc(account.accountId)}" data-scope="${esc(scope)}">核对原稿结果</button></article>`).join('')||'<p>还没有草稿任务。请从文章编辑页选择保存平台草稿。</p>'}<p class="helper">核对只读取已有文章，不会重新创建或公开发布。</p>`,'最近 100 条任务 · 不重新发送');
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-cnblogs-reconcile]');if(!b||runtimeBusy)return;
 try{if(b.dataset.scope!==wordpressBaseScope())throw Error('工作区已变化');b.disabled=true;runtimeLock(true);
  await apiRequest('/api/cnblogs/reconcile',{method:'POST',body:JSON.stringify({brandId:brand().id,accountId:b.dataset.account,id:b.dataset.cnblogsReconcile})});
  if(b.dataset.scope===wordpressBaseScope())await cnblogsReceipts(publishingCenterCurrent().accounts.find(a=>a.accountId===b.dataset.account));
 }catch(e){toast(e.message)}finally{runtimeLock(false);if(b.isConnected)b.disabled=false}
});
