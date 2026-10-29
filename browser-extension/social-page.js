// Guanyin's own visible-editor adapter. No private write API, cookie export,
// CAPTCHA automation, paywall workaround, or fallback second submission.
// executeScript serializes this function: all helpers deliberately live inside it.
export async function socialPage({platform,action,article,accountId,media=[],profileEvidence,nativeInput=false}){
 try{
 const fail=m=>{throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const cfg={
  toutiao:{origin:'https://mp.toutiao.com',paths:[/^\/profile_v4\/graphic\/publish$/],title:'.publish-editor-title textarea, textarea[placeholder*="文章标题"]',body:'.ProseMirror[contenteditable="true"]',profile:/^https:\/\/(?:www\.)?toutiao.com\/c\/user\/(\d+)\//,publish:['预览并发布','发布文章'],confirm:['确认发布'],images:false},
  zhihu:{origin:'https://zhuanlan.zhihu.com',paths:[/^\/write$/, /^\/p\/\d+\/edit$/],title:'textarea[placeholder*="标题"], .WriteIndex-titleInput textarea',body:'.public-DraftEditor-content[contenteditable="true"], .DraftEditor-root [contenteditable="true"], .ProseMirror[contenteditable="true"], .tiptap[contenteditable="true"]',profile:/^https:\/\/(?:www\.)?zhihu.com\/people\/([\w-]+)\/?(?:\?.*)?$/,publish:['发布'],confirm:['发布文章','确认发布'],images:false},
  douyin:{origin:'https://creator.douyin.com',paths:[/^\/creator-micro\/content\/(?:upload|post\/image)$/],title:'input[placeholder*="标题"]',body:'[contenteditable="true"]',publish:['发布'],confirm:[],images:true,switchText:'发布图文',id:/抖音号\s*[:：]\s*([\w-]+)/},
  xiaohongshu:{origin:'https://creator.xiaohongshu.com',paths:[/^\/publish\/publish$/],title:'input[placeholder*="标题"]',body:'.tiptap[contenteditable="true"], .ql-editor[contenteditable="true"]',publish:['发布'],confirm:[],images:true,switchText:'上传图文',id:/小红书号\s*[:：]\s*([\w-]+)/}
 }[platform];if(!cfg)fail('平台适配器不存在');
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const many=s=>[...document.querySelectorAll(s)].filter(visible);
 const unique=(s,label)=>{const list=many(s);if(list.length!==1)fail(label+'结构未通过适配检查（'+list.length+' 个可见输入区）');return list[0]};
 const text=e=>((/^(INPUT|TEXTAREA|SELECT)$/.test(e?.tagName||'')?e.value:undefined)??e?.innerText??e?.textContent??'').replace(/\s+/g,' ').trim();
 // Toutiao renders a non-editable placeholder widget INSIDE the document.
 // Strip only that observed decoration from a detached clone; never treat plain
 // text equal to the prompt as empty, and never mutate the live document here.
 const bodyContent=e=>{
  if(platform==='douyin'){const clone=e.cloneNode(true);for(const node of clone.querySelectorAll('[contenteditable="false"]'))if(text(node)==='添加作品描述...')node.remove();for(const block of clone.querySelectorAll('div,p,li,br'))block.appendChild(document.createTextNode(' '));return (clone.textContent||'').replace(/[\u200B\uFEFF]/g,'').replace(/\s+/g,' ').trim();}
  if(platform!=='toutiao'||!e.querySelector('span.syl-placeholder.ProseMirror-widget[ignoreel="true"][contenteditable="false"]'))return text(e);
  const clone=e.cloneNode(true);
  for(const widget of clone.querySelectorAll('span.syl-placeholder.ProseMirror-widget[ignoreel="true"][contenteditable="false"]')){
   if(text(widget)==='请输入正文')widget.remove();
  }
  return (clone.textContent||'').replace(/\s+/g,' ').trim();
 };
 const buttons=names=>many('button,[role="button"]').filter(e=>names.includes(text(e))&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
 const verifyChallenge=()=>{if(many('iframe[src*="captcha"],.geetest_panel,.yidun_modal,[class*="captcha"]').length||many('input[placeholder*="验证码"]').length)fail('平台要求本人验证，请处理后核对状态；不会自动发送验证码')};
 const saveFailure=()=>many('[role="alert"],[role="status"],[class*="message"],[class*="toast"]').some(e=>!e.closest('[contenteditable],article,aside')&&text(e)==='保存失败');
 if(location.origin!==cfg.origin)fail('页面已跳转，请先完成本人登录');
 // The official setup page is an account eligibility gate, not a saved draft.
 if(platform==='toutiao'&&(location.pathname==='/profile_v4/personal/landing-type'||many('div,span,p').some(e=>!e.closest('[contenteditable],article,aside')&&/^请完善账号信息[，,\s]*解锁发布文章、视频等权益功能$/.test(text(e)))))fail('头条要求完善账号信息以开通发布权益。请在官方账号页完成后继续原任务；未新建或提交文章');
 if(action==='receipt'){
  const patterns={toutiao:/^https:\/\/(?:www\.)?toutiao.com\/article\/(\d+)\/?(?:\?.*)?$/,zhihu:/^https:\/\/zhuanlan.zhihu.com\/p\/(\d+)\/?(?:\?.*)?$/,douyin:/^https:\/\/www.douyin.com\/(?:video|note)\/(\d+)\/?(?:\?.*)?$/,xiaohongshu:/^https:\/\/www.xiaohongshu.com\/explore\/([a-fA-F0-9]{24})\/?(?:\?.*)?$/};
  const candidates=[location.href,...many('a[href]').filter(a=>/^(查看文章|查看作品|查看笔记|查看发布内容)$/.test(text(a))&&/发布成功|提交成功|审核中/.test(text(a.closest('[role="alert"],[role="dialog"],[class*="success"],[class*="result"]')))).map(a=>a.href)];
  const matches=candidates.map(url=>({url,id:url.match(patterns[platform])?.[1]})).filter(r=>r.id);
  const ids=[...new Set(matches.map(m=>m.id))];if(ids.length!==1)return null;
  return {state:'submitted',articleId:ids[0],url:matches[0].url};
 }
 const draftList=platform==='toutiao'&&location.pathname==='/profile_v4/manage/draft'&&['draft-list-inspect','draft-list-open'].includes(action);
 if(!draftList&&!cfg.paths.some(p=>p.test(location.pathname)))fail('当前不是支持的创作页，未继续');verifyChallenge();
 if(platform==='douyin'&&action!=='inspect'&&many('div,span').some(e=>text(e)==='你还有上次未发布的图文，是否继续编辑？'))fail('抖音有上次未发布的图文，请先在平台保存或处理；不会放弃、覆盖或上传测试图片');
 if(action==='inspect'){
  const ts=many(cfg.title),bs=many(cfg.body);return {platform,titleMatches:ts.length,bodyMatches:bs.length,bodyVisibleChars:bs.map(e=>text(e).length),bodyContentChars:bs.map(e=>bodyContent(e).length),bodyTextChars:bs.map(e=>(e.textContent||'').trim().length),bodyIsPlaceholder:bs.map(e=>text(e)==='请输入正文'),editableStructure:many('[contenteditable="true"]').map(e=>({tag:e.tagName,classes:String(e.className||'').slice(0,180)})),imageInputs:[...document.querySelectorAll('input[type="file"]')].map(e=>e.accept||'')};
 }
 if(platform==='zhihu'&&!many('a[href]').some(a=>cfg.profile.test(a.href))){
  const avatars=many('button img[alt], [role="button"] img[alt]').filter(e=>/^点击打开.+的主页$/.test(e.alt));
  if(avatars.length===1){avatars[0].closest('button,[role="button"]').click();await wait(150)}
 }
 // Never infer identity from an article author, a display name, or a login cookie.
 const identities=[];
 if(cfg.profile){for(const a of many('a[href]')){if(a.closest('[contenteditable],article,aside'))continue;const m=a.href.match(cfg.profile);if(m)identities.push({accountId:m[1],name:(text(a)||a.title||m[1]).slice(0,100)})}}
 else {for(const e of many('header,[class*="user-info"],[class*="userInfo"],.creator-info,[class*="account-info"]')){const m=text(e).match(cfg.id);if(m)identities.push({accountId:m[1],name:m[1]})}}
 if(platform==='douyin'&&profileEvidence){
  if(profileEvidence.evidenceUrl!=='https://creator.douyin.com/creator-micro/home'||profileEvidence.accountVerified!==true||!/^[-\w]{1,64}$/.test(profileEvidence.accountId||'')||typeof profileEvidence.name!=='string'||!profileEvidence.name.trim())fail('抖音本人主页身份依据不完整');
  identities.push({accountId:profileEvidence.accountId,name:profileEvidence.name.slice(0,100)});
 }
 const ids=[...new Set(identities.map(i=>i.accountId))];if(ids.length!==1)fail('未读到唯一账号 ID；请展开创作者账号信息后再核验');
 const me=identities[0];
 // The account menu link may say only “我的主页”. Prefer the visible profile
 // control's accessible display name; account identity still comes from its URL.
 if(platform==='zhihu'&&/^(我的主页|个人主页)$/.test(me.name)){
  const names=[...new Set(many('[aria-label^="点击打开"][aria-label$="的主页"]').filter(e=>!e.closest('[contenteditable],article,aside')).map(e=>e.getAttribute('aria-label')?.match(/^点击打开(.+)的主页$/)?.[1]).filter(Boolean))];
  me.name=names.length===1?names[0].slice(0,100):me.accountId;
 }
 if(accountId&&me.accountId!==accountId)fail('当前登录账号已变化，任务已停止');
 // The upload landing page defaults to video. Switch only an empty landing
 // page, never an existing image draft; all fill operations still recheck identity.
 if(platform==='douyin'&&action==='identity'&&location.pathname==='/creator-micro/content/upload'&&!many(cfg.title).length&&!many(cfg.body).length){
  const imageInputs=()=>[...document.querySelectorAll('input[type="file"]')].filter(e=>/image|\.png|\.jpg|\.jpeg/.test(e.accept));
  if(!imageInputs().length){
   if([...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))fail('页面已有上传文件，未切换创作模式');
   const allModes=many('button,[role="tab"],span,div').filter(e=>text(e)==='发布图文');
   const modes=allModes.filter(e=>!allModes.some(child=>child!==e&&e.contains(child)));
   if(modes.length!==1)fail('未找到唯一图文创作入口');modes[0].click();await wait(250);
   if(many('div,span').some(e=>text(e)==='你还有上次未发布的图文，是否继续编辑？'))fail('抖音有上次未发布的图文，请先在平台保存或处理；不会覆盖');
  }
 }
 const evidence={...me,editorReady:true,evidenceUrl:location.href};if(action==='identity'){const hasFields=many(cfg.title).length===1&&many(cfg.body).length===1;const hasUpload=cfg.images&&[...document.querySelectorAll('input[type="file"]')].some(e=>/image|\.png|\.jpg|\.jpeg/.test(e.accept));if(!hasFields&&!hasUpload)fail('已登录，但编辑器还未就绪');return evidence;}
 if(draftList){
  const titles=many('main a.title').filter(e=>text(e)===article.title.trim());
  if(titles.length!==1)fail('草稿箱中没有唯一同标题原稿，请手动核对；不会新建或删除');
  if(action==='draft-list-inspect')return {...evidence,matched:true};
  if(globalThis.__guanyinDraftOpenAttempted)fail('已尝试打开原稿，请核对已打开的标签');
  globalThis.__guanyinDraftOpenAttempted=true;titles[0].click();return {attempted:true};
 }
 if(action==='media'){
  if(!cfg.images)return {uploaded:0};if(!media.length)fail('图文发布需要图片');
  const uploadReady=[...document.querySelectorAll('input[type="file"]')].some(e=>/image|\.png|\.jpg|\.jpeg/.test(e.accept));
  if(!uploadReady){const allModes=many('button,[role="tab"],span,div').filter(e=>text(e)===cfg.switchText);const mode=allModes.filter(e=>!allModes.some(child=>child!==e&&e.contains(child)));if(mode.length===1){mode[0].click();await wait(250)}}
  const inputs=[...document.querySelectorAll('input[type="file"]')].filter(e=>/image|\.png|\.jpg|\.jpeg/.test(e.accept));if(inputs.length!==1)fail('未找到唯一的图文图片上传入口');
  if(inputs[0].files?.length||many('.image-item,.img-preview,[class*="image-preview"]').length)fail('页面已有图片，未覆盖');
  const dt=new DataTransfer();for(const image of media){const raw=atob(image.dataUrl.split(',')[1]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));dt.items.add(new File([bytes],image.name,{type:image.type}))}
  inputs[0].files=dt.files;inputs[0].dispatchEvent(new Event('change',{bubbles:true}));return {uploaded:media.length};
 }
 if(platform==='douyin'&&action==='check-retained-media'){
  const counts=[...new Set(many('*').filter(e=>!e.closest('[contenteditable="true"],textarea')).map(e=>(e.textContent||'').replace(/\s+/g,'').match(/^已添加(\d+)张图片(?:继续添加)?$/)?.[1]).filter(Boolean))];
  if(!media.length||counts.length!==1||Number(counts[0])!==media.length)fail('原稿图片数量未匹配（检测 '+(counts.join('/')||'未知')+'，需要 '+media.length+'），未补填、未重新上传');
  if(many('.uploading,[class*="upload-progress"],[class*="upload-error"]').length)fail('原稿图片上传状态待核对，未补填、未重新上传');
  return {...evidence,mediaCount:media.length};
 }
 const title=unique(cfg.title,'标题'),editor=unique(cfg.body,'正文');
 const plain=html=>new DOMParser().parseFromString(html.replace(/<(?:br\s*\/?|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,'$& '),'text/html').body.textContent.replace(/\s+/g,' ').trim();
 const expected=cfg.images?article.text.replace(/\s+/g,' ').trim():plain(article.html);
 const matches=()=>text(title)===article.title.trim()&&(platform==='douyin'?bodyContent(editor):text(editor))===expected;
 if(platform==='douyin'&&action==='fill-body'){if(text(title)!==article.title.trim()||bodyContent(editor)||editor.querySelector('img,video,iframe'))fail('标题未完整填写或原正文非空，未覆盖');editor.focus();return {nativeInsertText:article.text.replace(/\s+/g,' ').trim()};}
 if(action==='prepared'){if(!matches())fail('编辑器正文已变化，未登记填稿回执');return {...evidence,contentVerified:true};}
 if(action==='draft-location'){
  if(platform!=='toutiao'||!matches())fail('原稿正文或标题不匹配，未定位草稿');
  const u=new URL(location.href);if(u.searchParams.has('pgc_id'))return null;
  const saved=many('.footer-draft-save .footer-tip-save').filter(e=>!e.closest('[contenteditable],article,aside'));
  if(saved.length!==1||text(saved[0])!=='草稿已保存')return null;
  const links=many('a[href]').filter(e=>text(e)==='更多草稿'&&!e.closest('[contenteditable],article,aside'));
  if(links.length!==1)return null;
  const list=new URL(links[0].href,location.href);
  if(list.origin!==cfg.origin||list.pathname!=='/profile_v4/manage/draft'||list.username||list.password||list.hash)return null;
  return {accountId:me.accountId,url:list.origin+list.pathname,contentVerified:true};
 }
 if(action==='draft-receipt'){
  if(platform==='toutiao'&&saveFailure())fail('头条提示保存失败，尚未取得草稿编号；原稿已保留，不会重复发送');
  if(!['zhihu','toutiao'].includes(platform))fail('此平台尚未支持草稿回执');
  if(!matches())fail('草稿正文或标题与已确认版本不同');
  if(platform==='toutiao'){
   const url=new URL(location.href),ids=url.searchParams.getAll('pgc_id');
   const status=many('.footer-draft-save .footer-tip-save').filter(e=>!e.closest('[contenteditable],article,aside'));
   if(url.hash||url.username||url.password||ids.length!==1||!/^[1-9]\d{0,29}$/.test(ids[0])||status.length!==1||text(status[0])!=='草稿已保存')return null;
   return {...evidence,url:url.origin+url.pathname+'?pgc_id='+ids[0],articleId:ids[0],contentVerified:true,savedVerified:true};
  }
  const id=location.pathname.match(/^\/p\/(\d+)\/edit$/)?.[1];
  const status=many('.DraftStatusTip').filter(e=>!e.closest('[contenteditable],article,aside'));
  if(!id||status.length!==1||!/^(?:刚刚|\d+\s*(?:秒|分钟|小时|天)前)\s*·\s*草稿$/.test(text(status[0])))return null;
  return {...evidence,url:location.origin+location.pathname,articleId:id,contentVerified:true,savedVerified:true};
 }
 if(action==='fill'){
  // Focus can dismiss a visual empty-state prompt; genuine existing text remains protected.
  editor.focus();await wait(100);
  if(text(title)||bodyContent(editor)||editor.querySelector('img,video,iframe'))fail('编辑器已有内容，未覆盖已有稿件（标题 '+text(title).length+' 字，正文 '+bodyContent(editor).length+' 字）');
  if(platform==='douyin'&&nativeInput){title.focus();return {nativeInsertTitle:article.title};}
  const proto=title.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(title,article.title);title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));
  editor.focus();const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  const data=new DataTransfer();data.setData('text/plain',cfg.images?article.text:plain(article.html));if(!cfg.images)data.setData('text/html',article.html);
  editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));await wait(350);
  if(!matches())fail('编辑器未完整接收标题或正文，已停止；请保留现场核对，不会换接口重试');
  // Do not opt into exclusive-first publication, ads, or extra cross-posts.
  if(platform==='toutiao'){
   for(const label of ['无封面','不投放广告']){const candidates=many('label').filter(e=>text(e)===label);if(candidates.length===1&&!candidates[0].querySelector('input:checked'))candidates[0].click()}
  }
  if(article.ai){const labels=many('label').filter(e=>/^(引用AI|AI辅助创作|内容由AI生成|包含AI生成内容)$/.test(text(e)));if(labels.length===1&&!labels[0].querySelector('input:checked'))labels[0].click()}
  return {...evidence,prepared:true};
 }
 const aiLabel='包含 AI 辅助创作',aiLabels=[aiLabel,aiLabel+' 作者对内容负责'];
 const aiCombo=()=>{const items=many('[role="combobox"]').filter(e=>!e.closest('[contenteditable],article,aside')&&['无声明',...aiLabels].includes(text(e)));return items.length===1?items[0]:null};
 const aiDeclared=()=>platform==='zhihu'?aiLabels.includes(text(aiCombo())):many('label').some(e=>/引用AI|AI辅助|AI生成|人工智能/.test(text(e))&&e.querySelector('input:checked'));
 if(action==='preflight'||action==='submit'){
  if(!matches())fail('正文或标题与已确认版本不同');verifyChallenge();
  if(platform==='zhihu'&&article.ai&&action==='preflight'&&!aiDeclared()){
   const combo=aiCombo();if(!combo)fail('未找到唯一的 AI 创作声明选项，请在原稿核对');
   combo.click();await wait(200);
   const options=many('[role="option"],li').filter(e=>aiLabels.includes(text(e))&&!e.closest('[contenteditable],article,aside'));
   if(options.length!==1)fail('AI 创作声明选项不唯一，未提交');options[0].click();await wait(200);
   if(!aiDeclared())fail('平台尚未保存 AI 创作声明，未提交');
  }
  if(cfg.images){if(many('.uploading,[class*="upload-progress"],[class*="upload-error"]').length)fail('图片仍在上传或上传失败');const previews=many('.image-item img,.img-preview img,[class*="image-preview"] img,.image-preview');if(!media.length||previews.length!==media.length)fail('未核对到全部图片上传结果，未提交');}
  const exclusive=many('label').find(e=>/独家|独占|首发/.test(text(e))&&e.querySelector('input:checked'));if(exclusive)fail('请关闭独家/首发选项，再继续');
  if(article.ai&&!aiDeclared())fail('平台 AI 声明尚未核对，请先完成声明');
  const widgets=platform==='xiaohongshu'?many('xhs-publish-btn').filter(e=>e.getAttribute('is-publish')!=='false'&&e.getAttribute('submit-disabled')!=='true'):[];const b=widgets.length?widgets:buttons(cfg.publish);if(b.length!==1)fail('未找到唯一可用的发布按钮');
  if(action==='preflight')return {...evidence,ready:true};
  if(globalThis.__guanyinSubmitAttempted)fail('本页已执行提交，不会再点击');globalThis.__guanyinSubmitAttempted=true;
  b[0].click();
  // Some platforms have a preview confirmation. Never fall back to a private API.
  if(cfg.confirm.length){for(let i=0;i<12;i++){await wait(250);verifyChallenge();const c=buttons(cfg.confirm);if(c.length===1){c[0].click();return {attempted:true}}if(c.length>1)fail('确认按钮不唯一，结果待核对')}}
  return {attempted:true};
 }
 fail('未知操作');
 }catch(e){return {connectorError:String(e.message||'平台接入失败').slice(0,240)}}
}
