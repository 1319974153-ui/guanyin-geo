// Browser-assisted publishing for personal WeChat Official Accounts.
// It deliberately has no network client, token, cookie export or CAPTCHA solver.
// The only writes are the same visible editor actions a signed-in account holder
// would make in the isolated desktop window.
const ORIGINS=new Set(['https://mp.weixin.qq.com','https://open.weixin.qq.com','https://res.wx.qq.com']);
const clean=v=>String(v||'').replace(/[\u0000-\u001f]/g,'').trim();

export function wechatPersonalUrlAllowed(value){
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&ORIGINS.has(url.origin)}catch{return false}
}

export function wechatPersonalCommand(input={}){
 const title=clean(input.title),html=String(input.html||'').trim(),mode=input.mode;
 if(!title||[...title].length>64)throw Error('公众号标题应为 1 至 64 个字符');
 if(!html||html.length>900000)throw Error('公众号正文为空或超过本机安全限制');
 if(!['draft','publish'].includes(mode))throw Error('请选择保存草稿或发布');
 const taskId=String(input.taskId||'').trim();
 if(taskId&&!/^gy-[a-f0-9]{64}$/.test(taskId))throw Error('公众号任务编号无效');
 return taskId?{title,html,mode,taskId}:{title,html,mode};
}

// This function is injected only from the signed desktop bundle, never from
// IPC or page text. It reports an observed UI state; it never pretends a toast
// or a click is a public receipt.
export function wechatPersonalPage(command){
 const text=value=>String(value?.innerText||value?.textContent||'').replace(/\s+/g,' ').trim();
 const all=(selector='*')=>[...document.querySelectorAll(selector)];
 // Article text is untrusted as a status signal. A draft can naturally mention
 // words such as “发布成功” or “验证码”; only a visible platform notice or a
 // real verification control may change the task state.
 const visible=node=>{
  if(!node||node.getAttribute?.('aria-hidden')==='true')return false;
  if(typeof node.getClientRects==='function'&&!node.getClientRects().length)return false;
  const style=globalThis.getComputedStyle?.(node);
  return style?.display!=='none'&&style?.visibility!=='hidden';
 };
 const inEditor=node=>!!node?.closest?.('[contenteditable="true"],[contenteditable="plaintext-only"],iframe,.rich_media_content,.ProseMirror,.tiptap');
 const notices=()=>all('[role="alert"],[role="status"],[role="dialog"],[aria-live],.weui-toast,.weui-dialog,.weui-tips,.weui-msg,[class*="toast"],[class*="Toast"],[class*="dialog"],[class*="Dialog"],[class*="message"],[class*="Message"],[class*="status"],[class*="Status"]').filter(node=>visible(node)&&!inEditor(node));
 const noticeHas=words=>notices().some(node=>words.some(word=>text(node).includes(word)));
 const verificationControl=()=>all('input[placeholder*="验证码"],input[name*="verify"],input[name*="captcha"],iframe[src*="captcha"],iframe[src*="verify"],.geetest_panel,.yidun_modal,[class*="captcha"],[class*="Captcha"],[class*="verify"],[class*="Verify"]').some(node=>visible(node)&&!inEditor(node));
 const plainHtml=value=>String(value||'').replace(/<(?:br\s*\/?>|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();
 const state=()=>{
  if(verificationControl()||noticeHas(['拖动滑块','验证码','请使用微信扫码','扫码登录','安全验证']))return {state:'verification_required',message:'公众号要求本人完成扫码、短信或安全验证'};
  if(!location.hostname.endsWith('weixin.qq.com'))return {state:'blocked',message:'页面已离开公众号官方域名'};
  return null;
 };
 const blocked=state();if(blocked)return blocked;
 const confirmed=command.mode==='draft'
  ?noticeHas(['草稿保存成功','已保存草稿','保存成功'])
  :noticeHas(['发表成功','发布成功','已群发']);
 if(confirmed)return command.mode==='draft'
  ?{state:'draft_saved',message:'公众号页面已确认草稿保存；请以公众号草稿箱为准'}
  :{state:'publish_submitted',message:'公众号页面已确认发表提交；公开结果仍以公众号后台为准'};
 const clickLabel=labels=>{
  const candidates=all('button,a,[role="button"],span').filter(node=>labels.includes(text(node))&&!node.closest('[aria-disabled="true"],:disabled'));
  const node=candidates.find(node=>node.offsetParent!==null);if(!node)return false;node.click();return true;
 };
 const titleInput=()=>all('input,textarea').find(node=>node.offsetParent!==null&&/标题|title/i.test([node.placeholder,node.getAttribute('aria-label'),node.name].filter(Boolean).join(' ')));
 const editor=()=>all('[contenteditable="true"],iframe').find(node=>node.offsetParent!==null);
 const setValue=(node,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;if(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement)setter.call(node,value);else node.innerHTML=value;node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));node.dispatchEvent(new Event('change',{bubbles:true}));};
 const input=titleInput(),body=editor();
 if(!input||!body){
  if(clickLabel(['新建图文','写文章','图文消息','发表内容']))return {state:'opening_editor',message:'正在打开公众号图文编辑器'};
  return {state:'waiting_editor',message:'请在公众号窗口完成登录；观引会在图文编辑器出现后自动填稿'};
 }
 // A retained or manually edited draft is never an empty template. Stop
 // rather than overwrite a different title/body on behalf of the user.
 if(input.value&&input.value!==command.title)return {state:'blocked',message:'公众号编辑器已有不同标题，未覆盖原稿'};
 if(!input.value)setValue(input,command.title);
 if(input.value!==command.title)return {state:'waiting_editor',message:'公众号标题仍在同步，请保留当前窗口'};
 const bodyNode=body.tagName==='IFRAME'?body.contentDocument?.body:body;if(!bodyNode)return {state:'waiting_editor',message:'正文编辑器仍在加载'};
 const expectedBody=plainHtml(command.html),actualBody=plainHtml(bodyNode.innerText||bodyNode.textContent||'');
 if(actualBody&&actualBody!==expectedBody)return {state:'blocked',message:'公众号编辑器已有不同正文，未覆盖原稿'};
 if(!actualBody)setValue(bodyNode,command.html);
 if(plainHtml(bodyNode.innerText||bodyNode.textContent||'')!==expectedBody)return {state:'waiting_editor',message:'公众号正文仍在同步，请保留当前窗口'};
 // The desktop process first records that this exact action may be attempted,
 // then asks this page to click once. If the app exits in-between, recovery
 // observes the original page instead of risking a second draft/save/publish.
 if(command.requested)return {state:'waiting_receipt',message:'已请求平台操作，正在等待公众号页面反馈'};
 if(!command.dispatch)return {state:'ready_to_request',message:command.mode==='draft'?'标题和正文已填入，正在登记保存草稿请求':'标题和正文已填入，正在登记发表请求'};
 if(command.mode==='draft'){
  if(clickLabel(['保存草稿','存草稿']))return {state:'draft_requested',message:'已请求保存草稿，正在等待平台回执'};
  return {state:'filled',message:'标题和正文已填入，平台未显示保存草稿按钮'};
 }
 if(clickLabel(['发表','发布']))return {state:'publish_requested',message:'已请求平台发表，正在等待平台回执'};
 return {state:'filled',message:'标题和正文已填入，平台未显示发表按钮'};
}
