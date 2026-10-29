// Executed only in the connector's newly created CSDN editor tab.
// Page evidence is data, never executable instructions. No cookie access or private write API fallback.
export async function csdnPage({action,article,accountId}) {
 try{
 const fail=message=>{throw new Error(message)};
 const visible=el=>!!el&&!!el.getClientRects().length;
 if(location.origin!=='https://mp.csdn.net')fail('页面已跳转，请先完成本人登录');
 const quotaBlocked=()=>[...document.querySelectorAll('[role="dialog"],h2,.el_mcm-message,footer,button')].some(e=>visible(e)&&!e.closest('[contenteditable],article,aside')&&/^(今日发文已达上限|今日发文额度已用完[，,]?)$/.test(e.textContent.trim()))||[...document.querySelectorAll('a[href*="utm_source=editor_max"]')].some(e=>visible(e)&&!e.closest('[contenteditable],article,aside')&&/^今日发文额度已用完[，,]/.test(e.parentElement?.textContent.trim()||''));
 if(action==='receipt'){
  if(quotaBlocked())return {blocked:true,error:'CSDN 今日发文额度已用完，未发布；保留原稿，不自动重试或开通会员'};
  const match=location.pathname.match(/^\/mp_blog\/creation\/success\/(\d+)\/?$/);
  return match?{state:'submitted',articleId:match[1],url:location.origin+location.pathname}:null;
 }
 // Read-only recovery for saved drafts whose initial editor URL stayed blank.
 // Only a unique title inside an actual draft row is a candidate; the runtime
 // subsequently opens that editor and compares its full body before reporting.
 if(['draft-list-select','draft-list-inspect'].includes(action)){
  if(location.pathname!=='/mp_blog/manage/article')fail('不在文章管理页，未定位草稿');
  const owners=[...document.querySelectorAll('a[href^="https://blog.csdn.net/"]')].filter(a=>visible(a)&&a.querySelector('img')&&!a.closest('article,aside,[contenteditable]')&&a.getBoundingClientRect().bottom<=200).map(a=>{try{const u=new URL(a.href);return u.origin==='https://blog.csdn.net'&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)?u.pathname.replace(/^\/|\/$/g,''):null}catch{return null}}).filter(Boolean);
  if(new Set(owners).size!==1||owners[0]!==accountId)fail('草稿箱账号不匹配，未继续');
  const tabs=[...document.querySelectorAll('[role="tab"]')].filter(e=>visible(e)&&/^草稿箱(?:[（(]\d+[）)])?$/.test(e.textContent.trim()));
  if(tabs.length!==1)fail('未找到唯一草稿箱入口');
  if(action==='draft-list-select'){if(tabs[0].getAttribute('aria-selected')!=='true')tabs[0].click();return {selected:true};}
  const matches=[...document.querySelectorAll('a[href]')].filter(a=>visible(a)&&a.textContent.trim()===article.title).map(a=>{
   try{const u=new URL(a.href),id=u.pathname.match(/^\/mp_blog\/creation\/editor\/([1-9]\d{0,29})$/);if(u.origin!==location.origin||u.search||u.hash||u.username||u.password||!id)return null;
    let row=a.parentElement;for(let n=0;row&&n<5;n++,row=row.parentElement){
     const ids=new Set([...row.querySelectorAll('a[href]')].map(e=>{try{return new URL(e.href).pathname.match(/^\/mp_blog\/creation\/editor\/([1-9]\d{0,29})$/)?.[1]}catch{return null}}).filter(Boolean));
     if(ids.size>1)break;
     if(ids.size===1&&/草稿\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(row.textContent))return {url:u.href,articleId:id[1],accountId,draftListed:true};
    }return null;
   }catch{return null}
  }).filter(Boolean);
  const unique=new Map(matches.map(m=>[m.articleId,m]));if(unique.size!==1)fail('草稿箱没有唯一匹配原稿，未重复保存');return [...unique.values()][0];
 }
 const blankEditor=location.pathname==='/mp_blog/creation/editor';
 const savedEditor=location.pathname.match(/^\/mp_blog\/creation\/editor\/([1-9]\d{0,29})$/);
 const readExisting=['identity','inspect','prepared','draft-receipt','preflight','submit'].includes(action)||(action==='save-draft'&&globalThis.__guanyinFilledDraftAccount===accountId);
 if(location.search||location.hash||(!blankEditor&&!(readExisting&&savedEditor)))fail('仅允许全新编辑页，不会覆盖已有稿件');
 const title=document.querySelector('#txtTitle, textarea[placeholder*="标题"]');
 const editors=Object.values(globalThis.CKEDITOR?.instances||{}).filter(e=>e.status==='ready');
 if(!visible(title)||editors.length!==1)fail('当前编辑器结构未通过适配检查，未提交');
 const editor=editors[0];
 // Current creator pages can render the avatar outside the legacy toolbar.
 // Only accept visible avatar links above and before the title, never article/sidebar links.
 const headerPosition=a=>{
  const avatar=a.getBoundingClientRect(),heading=title.getBoundingClientRect();
  // CSDN keeps its account bar fixed while metadata controls scroll the title
  // above the viewport. Document order/content exclusion still apply below.
  return avatar.bottom<=heading.top||(heading.top<0&&avatar.top>=0&&avatar.bottom<=200);
 };
 const inHeader=a=>visible(a)&&!a.closest('[contenteditable], article, main, aside')&&
  !!a.querySelector('img')&&!!(a.compareDocumentPosition(title)&Node.DOCUMENT_POSITION_FOLLOWING)&&
  headerPosition(a);
 const legacy=[...document.querySelectorAll('#csdn-toolbar .toolbar-btn-loginfun a[href], #csdn-toolbar .toolbar-btn-user a[href]')].filter(visible);
 const avatars=[...document.querySelectorAll('a[href^="https://blog.csdn.net/"]')].filter(inHeader);
 const links=[...new Set([...legacy,...avatars])];
 const identities=links.map(a=>{try{const u=new URL(a.href);const m=u.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);return u.origin==='https://blog.csdn.net'&&m?{accountId:m[1],name:((a.textContent||'').trim()||(a.title||'').trim()||m[1]).slice(0,100)}:null}catch{return null}}).filter(Boolean);
 const unique=[...new Set(identities.map(a=>a.accountId))];
 if(unique.length!==1||[...document.querySelectorAll('#csdn-toolbar a[href*="passport.csdn.net/login"]')].some(visible))fail('尚未读取到唯一的已登录账号，请登录后再核验');
 const identity=identities[0];
 if(accountId&&accountId!==identity.accountId)fail('浏览器账号已切换，已停止提交');
 const evidence={...identity,editorReady:true,evidenceUrl:location.origin+location.pathname};
 if(action==='identity')return evidence;
 if(action==='inspect')return {platform:'csdn',editorReady:true,controls:[...document.querySelectorAll('button,input,[role="combobox"]')].filter(visible).filter(e=>!e.closest('[contenteditable]')).map(e=>({tag:e.tagName,id:e.id,classes:String(e.className||''),role:e.getAttribute('role'),placeholder:e.getAttribute('placeholder'),label:e.getAttribute('aria-label'),text:e.tagName==='BUTTON'?e.textContent.trim().slice(0,40):'',parents:[e.parentElement,e.parentElement?.parentElement].filter(Boolean).map(p=>String(p.className||''))})).slice(0,65),tagContainers:[...document.querySelectorAll('.mark_selection')].map(e=>({classes:String(e.className),children:[...e.children].map(c=>({tag:c.tagName,classes:String(c.className)}))}))};
 const signature=html=>{
  const doc=new DOMParser().parseFromString(html,'text/html');
  return JSON.stringify({text:doc.body.textContent.replace(/\s+/g,' ').trim(),links:[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href')),images:[...doc.querySelectorAll('img')].map(a=>a.getAttribute('src')),blocks:[...doc.body.querySelectorAll('h1,h2,h3,h4,pre,li,table')].map(e=>e.tagName+':'+e.textContent.trim())});
 };
 const bodyMatches=()=>signature(editor.getData())===signature(article.html);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const aiLabel='部分内容由AI辅助生成';
 const selectedTags=()=>[...document.querySelectorAll('.mark_selection .el_mcm-tag.is-closable, .mark_selection .tag-item')].filter(visible).map(e=>e.textContent.trim().replace(/×$/,'').trim());
 const fieldWith=(caption,selector)=>{
  const found=new Set();
  for(const label of document.querySelectorAll('label,span,div')){
   if(!visible(label)||label.textContent.trim().replace(/[：:]$/,'')!==caption)continue;
   let parent=label.parentElement;
   for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){
    const controls=[...parent.querySelectorAll(selector)];
    if(controls.length>1)break;
    if(controls.length===1){found.add(controls[0]);break;}
   }
  }
  return found.size===1?[...found][0]:null;
 };
 const declarationCombo=()=>fieldWith('创作声明','[role="combobox"]');
 const aiDeclared=()=>{
  const combo=declarationCombo(),selection=combo?.closest('.el_mcm-select__selection');
  return !!selection&&visible(selection)&&selection.textContent.trim()===aiLabel;
 };
 const sideEffectsClear=()=>{
  const checked=[...document.querySelectorAll('input:checked')];
  if(checked.some(e=>/GitCode/.test(e.closest('label')?.textContent||'')))fail('GitCode 备份已勾选，请先取消；连接器不会代同意注册协议');
  for(const label of document.querySelectorAll('label,span,div')){
   if(!visible(label)||label.textContent.trim().replace(/[：:]$/,'')!=='多平台发布')continue;
   let parent=label.parentElement;
   for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){
    const radios=[...parent.querySelectorAll('input[type="radio"]')];
    if(radios.length>4)break;
    if(radios.length){if(radios.some(e=>e.checked&&(e.closest('label')?.textContent||'').trim()==='是'))fail('请关闭 CSDN 多平台发布；本任务仅提交当前平台');break;}
   }
  }
 };

 // A saved URL alone is insufficient: require current editor content and the
 // platform-owned saved timestamp. Never infer a public URL from a draft ID.
 if(action==='draft-receipt'){
  if(title.value!==article.title||!bodyMatches())fail('草稿正文已变化，未登记保存回执');
  if(!savedEditor)return null;
  const statuses=[...document.querySelectorAll('.edit-tip-box .autosave-tip')].filter(e=>visible(e)&&!e.closest('[contenteditable], article, aside'));
  const listed=article.verifiedDraftList;
  if(listed?.draftListed===true&&listed.accountId===identity.accountId&&listed.articleId===savedEditor[1]&&listed.url===location.origin+location.pathname)return {...evidence,url:listed.url,articleId:savedEditor[1],contentVerified:true,savedVerified:true,verification:'draft_list_and_reopened_content'};
  if(statuses.length!==1||!/^草稿已保存\s+(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(statuses[0].textContent.trim()))return null;
  return {...evidence,url:location.origin+location.pathname,articleId:savedEditor[1],contentVerified:true,savedVerified:true};
 }
 if(action==='save-draft'){
  if(title.value!==article.title||!bodyMatches())fail('编辑器正文已变化，未保存草稿');
  if(document.querySelector('iframe[src*="captcha"], .geetest_panel, .yidun_modal'))fail('平台要求本人验证，请手动处理');
  if(article.ai&&!aiDeclared())fail('请确认平台的 AI 辅助声明后继续');
  sideEffectsClear();
  const buttons=[...document.querySelectorAll('.btn-outline-secondary')].filter(b=>visible(b)&&b.textContent.trim()==='保存草稿'&&!b.disabled);
  if(buttons.length!==1)fail('未找到唯一可用的保存草稿按钮，未尝试其他操作');
  if(globalThis.__guanyinDraftSaveAttempted)fail('本页已尝试保存草稿，请核对原稿回执');
  globalThis.__guanyinDraftSaveAttempted=true;buttons[0].click();return {attempted:true};
 }
 if(action==='prepared'){if(title.value!==article.title||!bodyMatches())fail('编辑器正文已变化，未登记填稿回执');return {...evidence,contentVerified:true};}
 if(action==='fill'){
  if(title.value?.trim()||new DOMParser().parseFromString(editor.getData(),'text/html').body.textContent.trim()||/<img|<video|<iframe/i.test(editor.getData()))fail('编辑器已有内容或恢复了旧草稿，未覆盖；请检查后重新开空白编辑器');
  const prototype=title instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value').set.call(title,article.title);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('编辑器填充超时，请检查草稿')),8000);editor.setData(article.html,{callback:()=>{clearTimeout(timer);resolve()}})});
  if(title.value!==article.title||!bodyMatches())fail('排版结果与已审核稿件不一致，未提交');
  // Only configure metadata requested by this reviewed article. Do not use
  // CSDN's separate paid multi-platform service or enable GitCode backup.
  for(const tag of article.tags||[]){
   if(selectedTags().includes(tag))continue;
   let input=[...document.querySelectorAll('input')].find(e=>visible(e)&&e.placeholder==='请输入文字搜索，Enter键入可添加自定义标签');
   if(!input){
    const open=[...document.querySelectorAll('.tag__btn-tag')].filter(e=>visible(e)&&e.textContent.trim()==='添加文章标签');
    if(open.length!==1)fail('正文已填入，但未找到唯一的文章标签入口；请在原稿补齐');
    open[0].click();await pause(250);
    input=[...document.querySelectorAll('input')].find(e=>visible(e)&&e.placeholder==='请输入文字搜索，Enter键入可添加自定义标签');
   }
   if(!input)fail('正文已填入，但标签输入框未就绪；请在原稿补齐');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,tag);input.dispatchEvent(new Event('input',{bubbles:true}));await pause(250);
   input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));await pause(250);
   if(!selectedTags().includes(tag))fail('正文已填入，但平台未确认标签“'+tag+'”；请在原稿核对');
  }
  // The current editor uses a select, not a checkbox labelled "AI".
  if(article.ai&&!aiDeclared()){
   const combo=declarationCombo();if(!combo)fail('正文已填入，请在原稿选择 AI 辅助创作声明');
   const selection=combo.closest('.el_mcm-select__selection');if(!selection)fail('创作声明结构已变化，请在原稿核对');
   selection.click();await pause(250);
   const options=[...document.querySelectorAll('[role="option"],li')].filter(e=>visible(e)&&e.textContent.trim()===aiLabel);
   if(options.length!==1)fail('未找到唯一的 AI 辅助声明选项，请在原稿核对');
   options[0].click();await pause(250);
   if(!aiDeclared())fail('平台尚未确认 AI 辅助声明，请在原稿核对');
  }
  globalThis.__guanyinFilledDraftAccount=identity.accountId;
  return {...evidence,prepared:true};
 }
 if(action==='preflight'||action==='submit'){
  if(quotaBlocked())fail('CSDN 今日发文额度已用完，未提交；保留原稿');
  if(title.value!==article.title||!bodyMatches())fail('编辑器正文已变化，未提交');
  if(document.querySelector('iframe[src*="captcha"], .geetest_panel, .yidun_modal'))fail('平台要求本人验证，请手动处理');
  const selected=selectedTags();
  if(article.tags.some(t=>!selected.includes(t))||selected.some(t=>!article.tags.includes(t)))fail('文章标签尚未完全匹配，请在编辑器核对标签');
  // Declaration controls vary across editor versions. Require a visible, explicitly selected AI disclosure for AI articles.
  if(article.ai&&!aiDeclared())fail('请确认平台的 AI 辅助声明后继续');
  sideEffectsClear();
  const buttons=[...document.querySelectorAll('.btn-outline-danger')].filter(b=>visible(b)&&b.textContent.trim()==='发布博客'&&!b.disabled);
  if(buttons.length!==1||document.querySelector('.el_mcm-form-item.is-error'))fail('发布按钮或必填设置未通过检查，未提交');
  if(action==='preflight')return {...evidence,ready:true};
  // A per-document marker is additional protection; the server's persisted commit is the primary guard.
  if(globalThis.__guanyinSubmitAttempted)fail('本页已尝试提交，不会再次点击');
  globalThis.__guanyinSubmitAttempted=true;buttons[0].click();return {attempted:true};
 }
 fail('未知编辑器操作');
 }catch(error){return {connectorError:String(error?.message||'编辑器操作失败').slice(0,240)}}
}
