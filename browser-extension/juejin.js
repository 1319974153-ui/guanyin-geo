// Rendered Juejin creator/editor UI only. No cookies, hidden store or private API.
// Public submission is deliberately guarded: the desktop product keeps the
// action closed until a real account proves the full submit-to-public-link flow.
export function juejinPage({action,article,accountId,profileEvidence}){
 try{
  const fail=m=>{throw Error(m)},visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const all=s=>[...document.querySelectorAll(s)].filter(visible),one=(s,label)=>{const a=all(s);if(a.length!==1)fail(label+'结构不明确，原稿保留');return a[0]};
  const u=new URL(location.href);
  if(u.origin!=='https://juejin.cn'||u.username||u.password||u.hash)fail('不是掘金官方页面');
  if(all('iframe[src*="captcha"],input[placeholder*="验证码"]').length)fail('掘金需要本人验证，请在官方窗口完成后继续原任务');
  if(action==='account'){
   if(u.pathname!=='/creator/home'||u.search)fail('不是本人创作者中心');
   const a=one('a.username[href]','本人账号'),p=new URL(a.href,location.href),id=p.pathname.match(/^\/user\/([1-9]\d{0,29})$/)?.[1];
   const names=[...a.querySelectorAll('span.name')].filter(visible),name=names.length===1?names[0].textContent.trim():'';
   if(p.origin!==u.origin||p.search||p.hash||!id||!name)fail('尚未取得本人掘金账号，请先登录');
   return {accountId:id,name,profileUrl:p.href};
  }
  // The current public article address has not yet been verified from a real
  // account. Never infer it from an editor, a toast, or a creator dashboard.
  // Returning null makes the runtime retain the original task for read-only
  // review instead of attempting another submission.
  if(action==='receipt')return null;
  const id=u.pathname.match(/^\/editor\/drafts\/([1-9]\d{0,29})$/)?.[1];
  if(!(id&&!u.search||u.pathname==='/editor/drafts/new'&&u.search==='?v=2'))fail('不是受支持的掘金编辑器');
  const me=profileEvidence;
  if(!me||!/^[1-9]\d{0,29}$/.test(me.accountId)||!me.name||me.profileUrl!=='https://juejin.cn/user/'+me.accountId)fail('缺少当前登录账号证据');
  if(accountId&&accountId!==me.accountId)fail('掘金账号已变化，未继续');
  const evidence={accountId:me.accountId,name:me.name,editorReady:true,evidenceUrl:u.href};
  const title=one('input.title-input','标题'),editor=one('.CodeMirror textarea','正文输入框');
  if(action==='identity')return evidence;
  if(action==='media')fail('掘金当前仅开放纯文本稿，不上传图片或其他媒体');
  if(!article?.title||!article?.text||article.title.length>80||/[\u200b\r]/.test(article.text)||/!\[[^\]]*\]\(|<(?:img|video|audio)\b/i.test(article.text+' '+(article.html||'')))fail('掘金草稿须为完整纯文本，标题不超过80字');
  const expected=article.text+(article.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'');
  const fullText=()=>{
   const code=one('.CodeMirror-code','正文区域');
   const lines=[...code.querySelectorAll('.CodeMirror-line')].map(e=>e.textContent==='\u200b'?'':e.textContent);
   const counts=all('strong').filter(e=>/^行数:\s*\d+$/.test(e.parentElement.textContent.trim()));
   if(counts.length!==1||Number(counts[0].textContent)!==lines.length)fail('正文未完整呈现，不能核对全文；原稿保留');
   return lines.join('\n');
  };
  if(action==='fill'){
   if(title.value||fullText())fail('编辑器已有内容，未覆盖');
   title.focus();return {nativeInsertTitle:article.title};
  }
  if(action==='fill-body'){
   if(title.value!==article.title||fullText())fail('标题或空白正文不匹配，未覆盖');
   editor.focus();return {nativeInsertText:expected};
  }
  if(title.value!==article.title||fullText()!==expected)fail('掘金标题或完整正文与确认稿不一致');
  if(action==='prepared')return {...evidence,contentVerified:true};
  if(action==='draft-location')return id?{url:u.href,articleId:id,accountId:me.accountId}:null;
  if(action==='draft-receipt'){
   // A numbered URL in the original editor is not enough. Runtime must reopen
   // that exact URL in a new read-only window before requesting this proof.
   if(!id||article.reopenedUrl!==u.href)return null;
   return {url:u.href,articleId:id,accountId:me.accountId,contentVerified:true,savedVerified:true,verification:'reopened_content'};
  }
  if(action==='preflight'||action==='submit'){
   const controls=all('button,[role="button"]').filter(e=>{
    const label=(e.innerText??e.textContent??'').replace(/\s+/g,' ').trim();
    return label==='发布'&&!e.disabled&&e.getAttribute?.('aria-disabled')!=='true';
   });
   if(controls.length!==1)fail('未找到唯一可用的掘金发布按钮；请先完成官方账号资格或必填项，未提交');
   if(action==='preflight')return {...evidence,ready:true};
   if(globalThis.__guanyinJuejinSubmitAttempted)fail('本页已尝试提交，结果待核对；不会重复点击发布');
   globalThis.__guanyinJuejinSubmitAttempted=true;
   controls[0].click();
   const outside=e=>typeof e.closest!=='function'||!e.closest('.CodeMirror,[contenteditable="true"],article,aside');
   const notices=all('[role="alert"],[role="status"],[aria-live],[class*="message"],[class*="toast"],[class*="modal"],[class*="dialog"]').filter(outside);
   const blocked=notices.filter(e=>/绑定手机|手机验证|实名认证|账号异常|账号受限|发布频繁|发布上限|风险验证/.test((e.innerText??e.textContent??'').replace(/\s+/g,' ').trim()));
   if(blocked.length===1)fail('掘金当前账号暂不能发布：'+(blocked[0].innerText??blocked[0].textContent??'').replace(/\s+/g,' ').trim().slice(0,100)+'；请在官方页面处理后继续原任务，不会重复点击发布');
   if(blocked.length>1)fail('掘金发布资格提示不唯一，未重复点击发布');
   const success=notices.filter(e=>/^(?:文章)?发布成功(?:，?.*)?$/.test((e.innerText??e.textContent??'').replace(/\s+/g,' ').trim()));
   if(success.length===1)fail('掘金已显示发布成功提示，但尚未读取到官方公开文章链接；请在官方文章管理页核对，不会重复点击发布');
   if(success.length>1)fail('掘金发布成功提示不唯一，未重复点击发布');
   return {...evidence,attempted:true};
  }
  fail('不支持的掘金草稿操作');
 }catch(e){return {connectorError:e.message}}
}
