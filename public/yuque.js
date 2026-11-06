async function yuqueConfigure(account){
 if(!isManager())throw Error('只有管理员可以连接账号');
 const scope=wordpressBaseScope(),id=account?.accountId||'yq-'+crypto.randomUUID();
 const form='<form data-yuque-form data-account="'+esc(id)+'" data-scope="'+esc(scope)+'" data-revision="'+esc(account?.connectionRevision||'')+'">'+
  '<p>使用语雀官方 API，无需浏览器插件。连接一次后，可在文章中勾选保存草稿或发布。</p>'+
  catalogInput('知识库地址','site',account?.site||'','url',true,240)+
  '<p class="helper">填写知识库首页，例如 https://www.yuque.com/team-name/knowledge-base；不要填写具体文档链接。</p>'+
  '<label class="field">语雀 API Token<input type="password" name="token" autocomplete="new-password" maxlength="1024" '+(account?'':'required')+' placeholder="'+(account?'留空保留原 Token':'填写你在语雀生成的 API Token')+'"></label>'+
  '<p class="helper">在<a href="https://www.yuque.com/yuque/developer/openapi" target="_blank" rel="noopener noreferrer">语雀开放接口说明</a>中查看 Token 使用方式。不要填写登录密码；Token 会加密保存在你的工作区。</p>'+
  '<p class="form-error" role="alert"></p><button class="button primary" type="submit">连接并保存</button>'+
  '<p class="helper">保存连接不会发文。公开发布只在你选择“发布文章”并点击发布后执行；平台审核与公开可见分别显示。</p></form>';
 openDrawer('连接语雀',form,'首次连接 · 自动核对账号与知识库');
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-yuque-form]');if(!f)return;e.preventDefault();if(runtimeBusy)return;
 const error=f.querySelector('.form-error'),button=f.querySelector('button[type=submit]');
 try{
  if(f.dataset.scope!==wordpressBaseScope())throw Error('工作区或品牌已切换，请重新打开');
  runtimeLock(true);button.disabled=true;error.textContent='';
  const values=Object.fromEntries(new FormData(f));
  await apiRequest('/api/yuque/connection',{method:'POST',body:JSON.stringify({...values,brandId:brand().id,accountId:f.dataset.account,revision:f.dataset.revision})});
  f.elements.token.value='';
  if(f.dataset.scope!==wordpressBaseScope())return;publishingCenterInvalidate();closeDrawer();await refreshPublishingCenter();toast('语雀已连接。打开稿件，选择保存平台草稿或发布并勾选语雀。');
 }catch(errorValue){if(f.isConnected)error.textContent=errorValue.message}finally{runtimeLock(false);if(f.isConnected)button.disabled=false}
});
async function yuqueReceipts(account){
 const scope=wordpressBaseScope(),d=await apiRequest('/api/yuque/records?'+new URLSearchParams({brandId:brand().id,accountId:account.accountId}));if(scope!==wordpressBaseScope())return;
 const rows=d.records.map(r=>'<article class="panel"><h3>'+esc(r.snapshot.title)+'</h3><p>'+esc(distributionResultLabel(r))+(r.remote?.docId?' · #'+esc(r.remote.docId):'')+'</p>'+(r.error?'<p class="form-error">'+esc(r.error)+'</p>':'')+'<button class="button small" data-yuque-reconcile="'+esc(r.id)+'" data-account="'+esc(account.accountId)+'" data-scope="'+esc(scope)+'">核对原稿结果</button></article>').join('');
 openDrawer('语雀稿件与回执','<p>'+esc(account.site)+' · '+esc(account.username)+'</p>'+((rows)||'<p>还没有任务。请从文章编辑页选择保存草稿或发布。</p>')+'<p class="helper">核对只读取已有文档和公开页，不会重新创建或公开发布。</p>','最近 100 条任务 · 不重新发送');
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-yuque-reconcile]');if(!b||runtimeBusy)return;
 try{
  if(b.dataset.scope!==wordpressBaseScope())throw Error('工作区已变化');b.disabled=true;runtimeLock(true);
  await apiRequest('/api/yuque/reconcile',{method:'POST',body:JSON.stringify({brandId:brand().id,accountId:b.dataset.account,id:b.dataset.yuqueReconcile})});
  if(b.dataset.scope===wordpressBaseScope())await yuqueReceipts(publishingCenterCurrent().accounts.find(a=>a.accountId===b.dataset.account&&a.platform==='yuque'));
 }catch(error){toast(error.message)}finally{runtimeLock(false);if(b.isConnected)b.disabled=false}
});
