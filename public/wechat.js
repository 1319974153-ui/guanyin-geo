// Personal accounts use a durable local task, never a simulated platform receipt.
// The task stays in the background: a user should only ever see a platform
// login / verification window, never a form asking them to paste a receipt URL.
let wechatPrepared=null;
async function wechatPrepare(contentId){
 wechatPrepared=null;
 const rows=own('contents').filter(c=>c.status==='已审核'&&!c.demo);
 if(contentId&&rows.some(c=>c.id===contentId)){const scope=wordpressBaseScope();openDrawer('公众号稿件','<p role="status">正在准备当前文章排版…</p>');try{await wechatLoadPackage({contentId},scope)}catch(e){if(scope===wordpressBaseScope())openDrawer('公众号稿件','<p role="alert">'+esc(e.message)+'</p>')}return;}
 openDrawer('公众号发布',`<p>选择已审核文章后，观引自动生成排版和摘要，并保存为本机待发任务。</p><p class="helper">个人主体使用浏览器辅助流程：首次登录、扫码或平台安全验证只在公众号窗口完成；无需填写署名、摘要、链接或回执。</p>${rows.length?`<form data-wechat-prepare><label class="field">文章<select name="contentId" required>${rows.map(c=>`<option value="${esc(c.id)}" ${c.id===contentId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label><button class="button primary" type="submit">加入公众号发布队列</button><p data-wechat-error class="form-error" role="alert"></p></form>`:'<p>还没有已审核文章。请先在「写文章」中生成或导入正文，再审核。</p>'}<p class="helper">封面由已连接的公众号窗口选择或上传。未连接窗口时，任务会保留在本机等待一次登录，不会丢失或重复创建。</p>`,'本机队列 · 平台验证时再提示');
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-wechat-prepare]');if(!f)return;e.preventDefault();
 const scope=wordpressBaseScope(),button=f.querySelector('button'),error=f.querySelector('[data-wechat-error]');button.disabled=true;error.textContent='';
 try{
  await wechatLoadPackage(Object.fromEntries(new FormData(f)),scope);
 }catch(err){if(scope===wordpressBaseScope()&&f.isConnected)error.textContent=err.message;}finally{button.disabled=false;}
});
async function wechatLoadPackage(fields,scope){
  const args=new URLSearchParams({brandId:brand().id,...fields});
  const r=await apiRequest('/api/wechat/package?'+args);if(scope!==wordpressBaseScope())return;
  const handoff=await wechatLocalHandoff(fields.contentId);
  wechatPrepared={...r.package,scope,handoffId:handoff?.id||''};
  const handoffStatus=handoff?`<p class="helper" data-wechat-handoff-status>待发任务已保存到本机。登录窗口准备好后将自动接续；不需要填写公开链接或回执。</p>`:'<p class="helper">当前不是本机桌面版，无法保存待发任务；仍可使用仅用于排障的导出。</p>';
  openDrawer('公众号待发任务已创建',`<p role="status">已完成本地排版，尚未保存到公众号或发表。</p><h3>${esc(r.package.title)}</h3>${r.package.digest?`<p>摘要已自动生成。</p>`:''}${handoffStatus}<p class="helper">下一步由已连接的公众号窗口处理：若平台要求扫码、短信或最终发表确认，会显示在该窗口。观引不会要求你回填文章链接。</p><details class="simple-detail"><summary>排障时导出稿件</summary><p class="helper">仅当公众号窗口临时不可用时使用；正常发布无需复制或下载。</p><div class="button-row"><button class="button" data-wechat-export="text">下载纯文本</button><button class="button" data-wechat-export="html">下载排版文件</button></div><p data-wechat-result role="status"></p></details><iframe title="公众号正文预览" sandbox="" referrerpolicy="no-referrer" style="width:100%;height:45vh;border:1px solid var(--border)" srcdoc="${esc(wechatDocument(r.package))}"></iframe>`,'个人主体 · 自动准备 · 平台确认时提示');
}
async function wechatLocalHandoff(contentId){
 if(!['127.0.0.1','localhost'].includes(location.hostname)||!contentId)return null;
 try{return (await apiRequest('/api/local-wechat-handoff/prepare',{method:'POST',body:JSON.stringify({brandId:brand().id,contentId})})).task}catch{return null}
}
function wechatDocument(p){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(p.title)+'</title><body style="max-width:680px;margin:24px auto;padding:0 16px;line-height:1.9;color:#222;font-family:-apple-system, BlinkMacSystemFont, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif">'+p.content+'</body></html>'}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-wechat-export]');if(!b)return;
 const result=b.parentElement.parentElement.querySelector('[data-wechat-result]'),p=wechatPrepared;
 if(!p||p.scope!==wordpressBaseScope()){result.textContent='品牌或工作区已切换，请重新准备。';return;}
 b.disabled=true;
 try{const kind=b.dataset.wechatExport;
  if(kind==='title'||kind==='digest'){if(window.guanyinDesktop?.copyContent)await window.guanyinDesktop.copyContent({text:p[kind]});else await navigator.clipboard.writeText(p[kind]);}
  else if(kind==='rich'){
   if(window.guanyinDesktop?.copyContent)await window.guanyinDesktop.copyContent({text:p.plainText,html:p.content});else {
   if(!window.ClipboardItem||!navigator.clipboard?.write)throw Error('此浏览器不支持排版复制，请下载排版文件。');
   await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([p.content],{type:'text/html'}),'text/plain':new Blob([p.plainText],{type:'text/plain'})})]);
   }
  }else if(['text','html'].includes(kind)){
   const html=kind==='html',url=URL.createObjectURL(new Blob([html?wechatDocument(p):p.title+'\n\n'+p.plainText],{type:html?'text/html;charset=utf-8':'text/plain;charset=utf-8'}));
   const a=document.createElement('a');a.href=url;a.download='公众号稿件.'+(html?'html':'txt');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  result.textContent=['title','digest','rich'].includes(kind)?'已复制；尚未发表。':'已下载；尚未发表。';
 }catch(err){result.textContent=err.message;}finally{b.disabled=false;}
});
