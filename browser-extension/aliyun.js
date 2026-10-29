// Alibaba Community's rendered editor/profile UI. No cookies, hidden application
// state or private endpoints. This function is serialized into an isolated window.
export async function aliyunPage({action,article,accountId,profileEvidence}){
 try{
 const fail=m=>{throw Error(m)},norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const all=s=>[...document.querySelectorAll(s)].filter(visible),text=e=>norm(/^(INPUT|TEXTAREA)$/.test(e?.tagName)?e.value:e?.innerText??e?.textContent);
 const one=(s,label)=>{const a=all(s);if(a.length!==1)fail(label+'结构不明确，原稿已保留');return a[0]};
 if(location.origin!=='https://developer.aliyun.com')fail('请在阿里云官方窗口完成登录');
 if(all('iframe[src*="captcha"],input[placeholder*="验证码"]').length)fail('阿里云需要本人验证，未继续');
 if(action==='account'){
  if(location.pathname!=='/myProfile'||location.search)fail('不是本人社区主页，未读取账号');
  const ids=[...new Set(all('a.tab-item[href]').map(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.pathname.match(/^\/profile\/([a-zA-Z0-9_-]{1,80})(?:\/highScore_1)?$/)?.[1]}catch{return null}}).filter(Boolean))];
  const name=text(one('span.nickname','社区昵称'));if(ids.length!==1||!name)fail('尚未取得本人社区身份');
  return {accountId:ids[0],name,profileUrl:'https://developer.aliyun.com/profile/'+ids[0]};
 }
 // Article receipt inspection is read-only. Logged-in visibility is not proof
 // that anonymous visitors can read it, including when no review banner exists.
 if(action==='receipt'){
  const id=location.pathname.match(/^\/article\/([1-9]\d{0,19})$/)?.[1];
  if(!id||location.search||location.hash)return null;
  const me=profileEvidence;
  if(!me||!accountId||me.accountId!==accountId||me.profileUrl!=='https://developer.aliyun.com/profile/'+accountId)fail('阿里云登录账号已变化，未核对回执');
  if(!article?.title||!article?.html)fail('缺少确认稿件，未核对回执');
  if(/<(?:img|video|audio)\b/i.test(article.html))fail('媒体稿回执尚未验收');
  const title=one('h1.article-title','文章标题'),body=one('.article-content .article-inner.markdown-body','文章正文');
  const authors=all('.user-msg a.user-name,a.aigc-fixed-left-name');
  if(!authors.length||authors.some(a=>a.href!==me.profileUrl))fail('文章作者与当前账号不一致');
  const parsed=new DOMParser().parseFromString(article.html.replace(/<(?:br\s*\/?|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,'$& '),'text/html');
  const expected=norm(parsed.body.textContent+(article.ai?' 本文包含 AI 辅助生成或整理的内容。':''));
  if(text(title)!==norm(article.title)||text(body)!==expected)fail('原文标题或完整正文已变化，未核对为本次稿件');
  const alerts=all('.content-wrapper > .sens-word-alert,.content-wrapper .sens-word-alert').filter(e=>!body.contains(e));
  if(alerts.length>1)fail('平台审核提示不明确');
  const status=text(alerts[0]);
  if(/未能通过审核|审核未通过/.test(status))return {blocked:true,reviewState:'rejected',error:'阿里云审核未通过，请修改原稿后再提交'};
  if(status&&!/内容审核中.*请耐心等待/.test(status))fail('平台审核状态尚未识别，未确认公开');
  return {state:'submitted',url:location.href,articleId:id,accountId,contentVerified:true,publicVerified:false,reviewState:status?'reviewing':'public_unverified'};
 }
 if(!/^\/article\/new$/.test(location.pathname)||location.hash&&!['#','#/'].includes(location.hash)||location.search&&!(new URLSearchParams(location.search).size===1&&/^[1-9]\d{0,19}$/.test(new URLSearchParams(location.search).get('edit'))))fail('当前不是阿里云文章编辑器');
 const me=profileEvidence;
 if(!me||!/^[-\w]{1,80}$/.test(me.accountId)||!me.name||me.profileUrl!=='https://developer.aliyun.com/profile/'+me.accountId)fail('缺少本次登录身份核对，未操作');
 if(accountId&&me.accountId!==accountId)fail('阿里云登录账号已变化，未继续');
 const evidence={accountId:me.accountId,name:me.name,editorReady:true,evidenceUrl:location.href};
 const title=one('input#title[placeholder="请填写标题"]','标题'),editor=one('.left-content textarea.textarea','正文编辑器');
 if(action==='identity')return evidence;
 if(!article?.title||!article?.text||!article?.html)fail('缺少完整确认稿件');
 if(/!\[[^\]]*\]\(|<(?:img|video|audio)\b/i.test(article.text+' '+article.html))fail('阿里云当前仅验收纯文本稿，图片和音视频尚未开放');
 const disclosure=article.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'';
 const expectedText=article.text+disclosure;
 const parsed=new DOMParser().parseFromString(article.html.replace(/<(?:br\s*\/?|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,'$& '),'text/html');
 const expected=norm(parsed.body.textContent+disclosure);
 // An empty Mditor has no rendered markdown body. Identity and draft-list
 // discovery must not depend on a nonempty preview; saved content still must.
 const previews=()=>all('.markdown-body');
 const blankPreview=()=>{const p=previews();return p.length<=1&&p.every(e=>!text(e))};
 const matches=()=>{const p=previews();return p.length===1&&text(title)===norm(article.title)&&text(editor)===norm(expectedText)&&text(p[0])===expected};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 if(action==='fill'){
  if(text(title)||text(editor)||!blankPreview())fail('编辑器已有内容，未覆盖');
  title.focus();return {nativeInsertTitle:article.title};
 }
 if(action==='fill-body'){
  if(text(title)!==norm(article.title)||text(editor)||!blankPreview())fail('标题或空白正文校验失败，未覆盖');
  editor.focus();return {nativeInsertText:expectedText};
 }
 if(['draft-list-inspect','draft-list-open'].includes(action)){
  let dialog=all('.draft-list-dialog');
  if(!dialog.length){const candidates=all('span,a,p,button').filter(e=>text(e)==='草稿箱'&&!e.querySelector('span,a,p,button'));if(candidates.length!==1)fail('草稿箱入口不唯一');candidates[0].click();for(let i=0;i<12&&!dialog.length;i++){await wait(250);dialog=all('.draft-list-dialog')}}
  if(dialog.length!==1)fail('草稿箱未打开，未重新保存');
  const rows=[...dialog[0].querySelectorAll('li:not(.head)')].filter(visible).filter(r=>text(r.querySelector('p.title.con'))===norm(article.title));
  if(rows.length!==1)fail('草稿箱没有唯一同标题原稿，未重新创建');
  if(action==='draft-list-open')rows[0].querySelector('p.title.con').click();
  return {...evidence,matched:true,draftListed:true};
 }
 for(let i=0;i<10&&!matches();i++)await wait(200);
 if(!matches())fail('阿里云标题或完整正文与确认稿不一致，未继续');
 if(action==='prepared')return {...evidence,contentVerified:true};
 if(action==='fill-summary'){
  const summary=one('textarea#abstractContent[placeholder="请填写摘要"]','摘要');
  if(text(summary))return {summaryPresent:true};
  summary.focus();return {nativeInsertSummary:expected.slice(0,180)};
 }

 if(['preflight','submit'].includes(action)){
  // Both checks require the same complete article and a human-accepted declaration.
  // Never toggle the declaration or solve platform security verification.
  const summary=one('textarea#abstractContent[placeholder="请填写摘要"]','摘要');
  if(!text(summary))fail('请在阿里云填写摘要；未点击 AI 摘要或发布');
  const disclaimer=one('input#agreeDisclaimer[type="checkbox"]','发布声明');
  if(!disclaimer.checked)fail('请本人阅读并决定是否接受阿里云发布声明；观引不会代为勾选');
  const buttons=all('button').filter(e=>text(e)==='发布文章');
  if(buttons.length!==1||buttons[0].disabled)fail('阿里云发布按钮未就绪，原稿已保留');
  if(action==='submit'){
   if(document.documentElement.hasAttribute('data-guanyin-submit-attempted'))fail('本页已经尝试提交，请核对原回执，未重复点击');
   document.documentElement.setAttribute('data-guanyin-submit-attempted','1');
   buttons[0].click();
   // Confirm only the observed ordinary publish prompt, in this invocation.
   // A restart may inspect the receipt, but must never replay this confirmation.
   for(let i=0;i<12;i++){
    await wait(250);
    if(all('iframe[src*="captcha"],input[placeholder*="验证码"]').length)fail('阿里云需要本人验证，原提交已保留');
    const dialogs=all('[role="dialog"]').filter(e=>/您确定发布文章[？?]/.test(text(e)));
    if(dialogs.length>1)fail('发布确认框不唯一，未继续');
    if(dialogs.length===1){
     if(!matches()||!disclaimer.checked)fail('发布确认时正文或声明已变化，未继续');
     const confirm=[...dialogs[0].querySelectorAll('button')].filter(e=>visible(e)&&text(e)==='确认'&&!e.disabled);
     if(confirm.length!==1)fail('发布确认按钮不明确，未继续');
     confirm[0].click();return {attempted:true};
    }
   }
   fail('发布确认结果待核对，未重复点击');
  }
  return {...evidence,contentVerified:true,summaryPresent:true,disclaimerAccepted:true,publishButtonReady:true};
 }

 if(action==='save-draft'){
  // Draft saving does not require the public-post disclaimer. Never accept it.
  const labels=all('label').filter(e=>/免责声明/.test(text(e)));
  const checkboxes=[...new Set(labels.map(label=>label.querySelector('input[type="checkbox"]')).filter(Boolean))];
  if(checkboxes.length!==1)fail('无法确认发布声明控件，未保存');
  const checkbox=checkboxes[0];if(checkbox.checked){checkbox.click();if(checkbox.checked)fail('无法取消发布声明，未保存');}
  const buttons=all('button').filter(e=>text(e)==='存为草稿'&&!e.disabled);
  if(buttons.length!==1)fail('存为草稿按钮未就绪，未点击保存');
  buttons[0].click();return {saveAttempted:true};
 }
 if(action==='draft-receipt'){
  const id=new URLSearchParams(location.search).get('edit'),proof=article.verifiedDraftList;
  const url=id?'https://developer.aliyun.com/article/new?edit='+id:null;
  if(!id||!proof?.draftListed||proof.accountId!==me.accountId||proof.url!==url||proof.articleId!==id)return null;
  return {url,articleId:id,accountId:me.accountId,savedVerified:true,contentVerified:true,verification:'draft_list_and_reopened_content'};
 }
 fail('不支持此操作');
 }catch(e){return {connectorError:String(e.message||e).slice(0,240)}}
}
