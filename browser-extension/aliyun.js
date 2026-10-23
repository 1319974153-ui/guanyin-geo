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
 if(!/^\/article\/new$/.test(location.pathname)||location.hash&&!['#','#/'].includes(location.hash)||location.search&&!(new URLSearchParams(location.search).size===1&&/^[1-9]\d{0,19}$/.test(new URLSearchParams(location.search).get('edit'))))fail('当前不是阿里云文章编辑器');
 const me=profileEvidence;
 if(!me||!/^[-\w]{1,80}$/.test(me.accountId)||!me.name||me.profileUrl!=='https://developer.aliyun.com/profile/'+me.accountId)fail('缺少本次登录身份核对，未操作');
 if(accountId&&me.accountId!==accountId)fail('阿里云登录账号已变化，未继续');
 const evidence={accountId:me.accountId,name:me.name,editorReady:true,evidenceUrl:location.href};
 const title=one('input#title[placeholder="请填写标题"]','标题'),editor=one('.left-content textarea.textarea','正文编辑器'),preview=one('.markdown-body','完整正文预览');
 if(action==='identity')return evidence;
 if(['preflight','submit','receipt'].includes(action))fail('阿里云公开发布尚未开放，未点击发布或接受声明');
 if(!article?.title||!article?.text||!article?.html)fail('缺少完整确认稿件');
 if(/!\[[^\]]*\]\(|<(?:img|video|audio)\b/i.test(article.text+' '+article.html))fail('阿里云当前仅验收纯文本稿，图片和音视频尚未开放');
 const disclosure=article.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'';
 const expectedText=article.text+disclosure;
 const parsed=new DOMParser().parseFromString(article.html.replace(/<(?:br\s*\/?|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,'$& '),'text/html');
 const expected=norm(parsed.body.textContent+disclosure);
 const matches=()=>text(title)===norm(article.title)&&text(editor)===norm(expectedText)&&text(preview)===expected;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 if(action==='fill'){
  if(text(title)||text(editor)||text(preview))fail('编辑器已有内容，未覆盖');
  title.focus();return {nativeInsertTitle:article.title};
 }
 if(action==='fill-body'){
  if(text(title)!==norm(article.title)||text(editor)||text(preview))fail('标题或空白正文校验失败，未覆盖');
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
 if(action==='save-draft'){
  // Draft saving does not require the public-post disclaimer. Never accept it.
  const labels=all('label').filter(e=>/免责声明/.test(text(e)));
  for(const label of labels){const checkbox=label.querySelector('input[type="checkbox"]');if(checkbox?.checked){checkbox.click();if(checkbox.checked)fail('无法取消发布声明，未保存');}}
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
