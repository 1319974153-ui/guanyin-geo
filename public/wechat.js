// Personal accounts use a local handoff, never a simulated platform receipt.
let wechatPrepared=null;
function wechatPrepare(){
 wechatPrepared=null;
 const rows=own('contents').filter(c=>c.status==='已审核'&&!c.demo);
 openDrawer('公众号稿件',`<p>选择已审核文章 → 复制排版 → 在公众号发表。</p><p class="helper">个人主体不支持官方自动发表接口。这里准备稿件，不要求你安装插件、提供密码或反复核验。</p>${rows.length?`<form data-wechat-prepare><label class="field">文章<select name="contentId" required>${rows.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></label><details class="simple-detail"><summary>可选设置 · 摘要默认自动提取</summary><label class="field">署名（可选）<input name="author" maxlength="16"></label><label class="field">摘要（可选）<textarea name="digest" maxlength="120" placeholder="留空时从正文自动提取，不消耗模型费用"></textarea></label><label class="field">阅读原文（可选）<input name="sourceUrl" type="url" placeholder="https://"></label></details><button class="button primary" type="submit">准备公众号稿件</button><p data-wechat-error class="form-error" role="alert"></p></form>`:'<p>还没有已审核文章。请先在「写文章」中生成或导入正文，再审核。</p>'}<p class="helper">自动写稿使用你配置的文本模型。未连接模型时不会调用或产生模型费用。封面请在公众号后台选择，本版本不会自动上传图片。</p>`,'本地准备 · 本人发表');
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-wechat-prepare]');if(!f)return;e.preventDefault();
 const scope=wordpressBaseScope(),button=f.querySelector('button'),error=f.querySelector('[data-wechat-error]');button.disabled=true;error.textContent='';
 try{
  const args=new URLSearchParams({brandId:brand().id,...Object.fromEntries(new FormData(f))});
  const r=await apiRequest('/api/wechat/package?'+args);if(scope!==wordpressBaseScope())return;
  wechatPrepared={...r.package,scope};
  openDrawer('公众号稿件已准备',`<p role="status">已完成本地排版，尚未保存到公众号或发表。</p><h3>${esc(r.package.title)}</h3>${r.package.author?`<p>署名：${esc(r.package.author)}</p>`:''}${r.package.digest?`<p>摘要：${esc(r.package.digest)}</p>`:''}${r.package.content_source_url?`<p>阅读原文：${esc(r.package.content_source_url)}</p>`:''}<div class="button-row"><button class="button" data-wechat-export="title">复制标题</button><button class="button" data-wechat-export="digest">复制摘要</button><button class="button primary" data-wechat-export="rich">复制排版正文</button><button class="button" data-wechat-export="text">下载纯文本</button><button class="button" data-wechat-export="html">下载排版文件</button></div><p data-wechat-result role="status"></p><iframe title="公众号正文预览" sandbox="" referrerpolicy="no-referrer" style="width:100%;height:45vh;border:1px solid var(--border)" srcdoc="${esc(wechatDocument(r.package))}"></iframe><p class="helper">在公众号新建图文，粘贴正文并选择封面；发表后保存公开链接。审核中与已发表分别记录。若排版复制不可用，可下载排版文件后打开复制。</p>`,'个人主体 · 本人完成发表');
 }catch(err){if(scope===wordpressBaseScope()&&f.isConnected)error.textContent=err.message;}finally{button.disabled=false;}
});
function wechatDocument(p){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(p.title)+'</title><body style="max-width:680px;margin:24px auto;padding:0 16px;line-height:1.9;color:#222;font-family:-apple-system, BlinkMacSystemFont, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif">'+p.content+'</body></html>'}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-wechat-export]');if(!b)return;
 const result=b.parentElement.parentElement.querySelector('[data-wechat-result]'),p=wechatPrepared;
 if(!p||p.scope!==wordpressBaseScope()){result.textContent='品牌或工作区已切换，请重新准备。';return;}
 b.disabled=true;
 try{const kind=b.dataset.wechatExport;
  if(kind==='title'||kind==='digest')await navigator.clipboard.writeText(p[kind]);
  else if(kind==='rich'){
   if(!window.ClipboardItem||!navigator.clipboard?.write)throw Error('此浏览器不支持排版复制，请下载排版文件。');
   await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([p.content],{type:'text/html'}),'text/plain':new Blob([p.plainText],{type:'text/plain'})})]);
  }else if(['text','html'].includes(kind)){
   const html=kind==='html',url=URL.createObjectURL(new Blob([html?wechatDocument(p):p.title+'\n\n'+p.plainText],{type:html?'text/html;charset=utf-8':'text/plain;charset=utf-8'}));
   const a=document.createElement('a');a.href=url;a.download='公众号稿件.'+(html?'html':'txt');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  result.textContent=['title','digest','rich'].includes(kind)?'已复制；尚未发表。':'已下载；尚未发表。';
 }catch(err){result.textContent=err.message;}finally{b.disabled=false;}
});
