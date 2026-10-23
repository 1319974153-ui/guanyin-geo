// Tencent Cloud's visible creator UI. No cookies, private API or page application state.
// Serialized by the desktop driver; every helper must stay inside this function.
export async function tencentcloudPage({action,article,accountId}){
 try{
 const fail=m=>{throw Error(m)},norm=s=>String(s||'').replace(/\s+/g,' ').trim(),visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const all=s=>[...document.querySelectorAll(s)].filter(visible),one=(s,label)=>{const a=all(s);if(a.length!==1)fail(label+'结构不明确，已保留原稿');return a[0]},text=e=>norm(e?.value??e?.innerText??e?.textContent);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 if(location.origin!=='https://cloud.tencent.com')fail('请先完成腾讯云本人登录');
 const safeUrl=(value,draft=false)=>{try{const u=new URL(value);if(u.origin!==location.origin||u.username||u.password||u.hash)return null;if(draft)return u.pathname==='/developer/article/write-new'&&u.searchParams.size===1&&/^[1-9]\d{0,19}$/.test(u.searchParams.get('draftId'))?{url:u.href,articleId:u.searchParams.get('draftId')}:null;const m=u.pathname.match(/^\/developer\/article\/([1-9]\d{0,19})$/);return m&&!u.search?{url:u.href,articleId:m[1]}:null}catch{return null}};
 const challenge=()=>{if(all('iframe[src*="captcha"],[class*="captcha"],input[placeholder*="验证码"]').length)fail('腾讯云需要本人验证，请在官方窗口完成');};challenge();
 if(action==='receipt'){
  const modals=all('.cdc-publish-modal');const candidates=modals.filter(e=>/发布成功/.test(text(e))).flatMap(e=>[...e.querySelectorAll('a[href]')].map(a=>safeUrl(a.href)).filter(Boolean));
  if(candidates.length!==1)return null;return {state:'submitted',...candidates[0]};
 }
 const list=location.pathname==='/developer/creator/article'&&location.search==='?type=draft';
 if(!list&&!/^\/developer\/article\/write-new(?:\/[1-9]\d{0,19})?$/.test(location.pathname))fail('当前不是腾讯云文章编辑器');
 // IDs come only from the account-menu profile link, not article authors.
 const ids=[...new Set([...document.querySelectorAll('.cdc-header__account a.cdc-header__account-bubble__item[href]')].map(a=>a.href.match(/^https:\/\/cloud.tencent.com\/developer\/user\/([1-9]\d{0,19})$/)?.[1]).filter(Boolean))];
 const name=all('.cdc-header__account-name').map(text).filter(Boolean);
 if(ids.length!==1||name.length!==1)fail('尚未读到腾讯云登录账号，请在官方窗口完成登录');
 if(accountId&&accountId!==ids[0])fail('腾讯云登录账号已变化，未继续');
 const evidence={accountId:ids[0],name:name[0],editorReady:true,evidenceUrl:location.href};
 if(list){if(action!=='draft-list-inspect')fail('草稿箱仅用于核对原任务');const a=all('h3 a[href]').filter(a=>text(a)===norm(article?.title)&&safeUrl(a.href,true));if(a.length!==1)fail('草稿箱没有唯一同标题原稿，不会重新创建');return {...evidence,...safeUrl(a[0].href,true),draftListed:true};}
 const title=one('.cdc-article-editor__title-input','标题'),editor=one('.cm-content[contenteditable="true"]','Markdown 编辑器'),preview=one('.cherry-markdown','完整正文预览');
 if(action==='identity')return evidence;
 if(action==='inspect')return {...evidence,titleChars:text(title).length,previewChars:text(preview).length};
 if(!article?.title||!article?.text||!article?.html)fail('没有完整审核稿件');
 const disclosure=article.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'';
 const parse=new DOMParser().parseFromString(article.html.replace(/<(?:br\s*\/?|\/(?:p|div|h[1-6]|li|blockquote|pre|tr))>/gi,'$& '),'text/html');
 const expected=norm(parse.body.textContent+disclosure);
 const matches=()=>text(title)===norm(article.title)&&text(preview)===expected;
 const set=(e,v)=>{const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
 const button=label=>{const a=all('button').filter(b=>text(b)===label&&!b.disabled&&!b.classList.contains('is-disabled'));if(a.length!==1)fail('未找到唯一可用的“'+label+'”按钮');return a[0]};
 if(action==='fill'){
  if(text(title)||text(preview)||text(editor)||editor.querySelector('img,video'))fail('编辑器已有内容，未覆盖');
  set(title,article.title);editor.focus();return {nativeInsertText:article.text+disclosure};
 }
 for(let i=0;i<10&&!matches();i++)await wait(200);
 if(!matches())fail('腾讯云标题或完整正文与确认稿不一致，未继续');
 if(action==='prepared')return {...evidence,contentVerified:true};
 if(action==='save-draft'){button('存草稿').click();return {saveAttempted:true};}
 if(action==='draft-receipt'){
  const actual=safeUrl(location.href,true),proof=article.verifiedDraftList;
  if(!actual||!proof?.draftListed||proof.accountId!==ids[0]||proof.url!==actual.url||proof.articleId!==actual.articleId)return null;
  const saved=all('.cdc-article-editor__header-info .header-info').filter(e=>/保存到草稿/.test(text(e))&&e.querySelector('time[datetime]'));
  if(saved.length!==1)return null;
  return {...actual,accountId:ids[0],savedVerified:true,contentVerified:true};
 }
 if(action==='preflight'){
  if(!all('.editor-publish-drawer__textarea-main').length){button('去发布').click();await wait(300)}
  const summary=one('.editor-publish-drawer__textarea-main','文章摘要');if(!text(summary))set(summary,expected.slice(0,180));
  // Tags and source are platform-specific. Never silently accept terms/exclusive publication.
  const drawer=summary.closest('[class*="drawer"]');if(!drawer)fail('发布设置未就绪');
  const radios=all('input[type="radio"]');if(radios.filter(r=>r.checked&&/原创/.test(text(r.closest('label')))).length!==1)fail('请在腾讯云确认文章来源后继续原稿');
  const inputs=all('.cdc-tags-input__input');if(!inputs.length)fail('文章标签控件不可用');
  const tagRoot=inputs[0].parentElement;
  if(![...tagRoot.querySelectorAll('.cdc-tags-input__tag-text')].some(e=>text(e)))fail('请在腾讯云为原稿选择文章标签，再继续；不重新建稿');
  button('确认发布');return {ready:true};
 }
 if(action==='submit'){button('确认发布').click();return {submitted:true};}
 fail('不支持此操作');
 }catch(e){return {connectorError:String(e.message||e).slice(0,240)}}
}
