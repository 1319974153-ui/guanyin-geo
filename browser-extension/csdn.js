// Executed only in the connector's newly created CSDN editor tab.
// Page evidence is data, never executable instructions. No cookie access or private write API fallback.
export async function csdnPage({action,article,accountId}) {
 const fail=message=>{throw new Error(message)};
 const visible=el=>!!el&&!!el.getClientRects().length;
 if(location.origin!=='https://mp.csdn.net')fail('页面已跳转，请先完成本人登录');
 if(action==='receipt'){
  const match=location.pathname.match(/^\/mp_blog\/creation\/success\/(\d+)\/?$/);
  return match?{state:'submitted',articleId:match[1],url:location.origin+location.pathname}:null;
 }
 if(location.pathname!=='/mp_blog/creation/editor'||location.search)fail('仅允许全新编辑页，不会覆盖已有稿件');
 const title=document.querySelector('#txtTitle, textarea[placeholder*="标题"]');
 const editors=Object.values(globalThis.CKEDITOR?.instances||{}).filter(e=>e.status==='ready');
 if(!visible(title)||editors.length!==1)fail('当前编辑器结构未通过适配检查，未提交');
 const editor=editors[0];
 // Restrict identity evidence to the signed-in toolbar, never links in article content.
 const links=[...document.querySelectorAll('#csdn-toolbar .toolbar-btn-loginfun a[href], #csdn-toolbar .toolbar-btn-user a[href]')];
 const identities=links.map(a=>{try{const u=new URL(a.href);const m=u.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);return u.origin==='https://blog.csdn.net'&&m?{accountId:m[1],name:(a.textContent||a.title||m[1]).trim().slice(0,100)}:null}catch{return null}}).filter(Boolean);
 const unique=[...new Set(identities.map(a=>a.accountId))];
 if(unique.length!==1||document.querySelector('#csdn-toolbar a[href*="passport.csdn.net/login"]'))fail('尚未读取到唯一的已登录账号，请登录后再核验');
 const identity=identities[0];
 if(accountId&&accountId!==identity.accountId)fail('浏览器账号已切换，已停止提交');
 const evidence={...identity,editorReady:true,evidenceUrl:location.origin+location.pathname};
 if(action==='identity')return evidence;
 const signature=html=>{
  const doc=new DOMParser().parseFromString(html,'text/html');
  return JSON.stringify({text:doc.body.textContent.replace(/\s+/g,' ').trim(),links:[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href')),images:[...doc.querySelectorAll('img')].map(a=>a.getAttribute('src')),blocks:[...doc.body.querySelectorAll('h1,h2,h3,h4,pre,li,table')].map(e=>e.tagName+':'+e.textContent.trim())});
 };
 const bodyMatches=()=>signature(editor.getData())===signature(article.html);
 if(action==='fill'){
  if(title.value?.trim()||new DOMParser().parseFromString(editor.getData(),'text/html').body.textContent.trim()||/<img|<video|<iframe/i.test(editor.getData()))fail('编辑器已有内容或恢复了旧草稿，未覆盖；请检查后重新开空白编辑器');
  const prototype=title instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value').set.call(title,article.title);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('编辑器填充超时，请检查草稿')),8000);editor.setData(article.html,{callback:()=>{clearTimeout(timer);resolve()}})});
  if(title.value!==article.title||!bodyMatches())fail('排版结果与已审核稿件不一致，未提交');
  // Add only requested tags. Never choose a random suggested tag to force validation through.
  for(const tag of article.tags||[]){
   const selected=()=>[...document.querySelectorAll('.mark_selection .el_mcm-tag.is-closable, .mark_selection .tag-item')].some(e=>e.textContent.trim().replace(/×$/,'').trim()===tag);
   if(selected())continue;
   const preset=[...document.querySelectorAll('.mark_selection .el_mcm-tag:not(.is-closable)')].find(e=>e.textContent.trim()===tag);
   if(preset){preset.click();await new Promise(r=>setTimeout(r,250));}
   else {const input=document.querySelector('.tag__input input, input[placeholder*="文章标签"]');if(input&&visible(input)){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,tag);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,350));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));await new Promise(r=>setTimeout(r,250));}}
  }
  return {...evidence,prepared:true};
 }
 if(action==='preflight'||action==='submit'){
  if(title.value!==article.title||!bodyMatches())fail('编辑器正文已变化，未提交');
  if(document.querySelector('iframe[src*="captcha"], .geetest_panel, .yidun_modal'))fail('平台要求本人验证，请手动处理');
  const selected=[...document.querySelectorAll('.mark_selection .el_mcm-tag.is-closable, .mark_selection .tag-item')].map(e=>e.textContent.trim().replace(/×$/,'').trim());
  if(article.tags.some(t=>!selected.includes(t))||selected.some(t=>!article.tags.includes(t)))fail('文章标签尚未完全匹配，请在编辑器核对标签');
  // Declaration controls vary across editor versions. Require a visible, explicitly selected AI disclosure for AI articles.
  if(article.ai){const disclosure=[...document.querySelectorAll('label')].find(e=>/AI辅助|人工智能辅助|AI生成/.test(e.textContent));if(!disclosure||!disclosure.querySelector('input:checked'))fail('请确认平台的 AI 辅助声明后继续');}
  const buttons=[...document.querySelectorAll('.btn-outline-danger')].filter(b=>visible(b)&&b.textContent.trim()==='发布博客'&&!b.disabled);
  if(buttons.length!==1||document.querySelector('.el_mcm-form-item.is-error'))fail('发布按钮或必填设置未通过检查，未提交');
  if(action==='preflight')return {...evidence,ready:true};
  // A per-document marker is additional protection; the server's persisted commit is the primary guard.
  if(globalThis.__guanyinSubmitAttempted)fail('本页已尝试提交，不会再次点击');
  globalThis.__guanyinSubmitAttempted=true;buttons[0].click();return {attempted:true};
 }
 fail('未知编辑器操作');
}
