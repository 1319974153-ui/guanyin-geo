// 51CTO ordinary creator editor. All evidence comes from the visible UI.
export async function fiftyonePage({action,article,accountId}){
 try{
 const fail=m=>{throw Error(m)},norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const all=s=>[...document.querySelectorAll(s)].filter(visible),text=e=>norm(/^(INPUT|TEXTAREA)$/.test(e?.tagName)?e.value:e?.innerText??e?.textContent);
 const one=(s,label)=>{const a=all(s);if(a.length!==1)fail(label+'结构不明确，已保留原稿');return a[0]};
 if(action==='receipt'){
  if(location.origin!=='https://blog.51cto.com'||location.search||location.hash)return null;
  const id=location.pathname.match(/^\/blogger\/success\/([1-9]\d{0,19})$/)?.[1];
  const body=text(document.body);
  if(!id||!body.includes('发布成功')||!article?.title||!body.includes(norm(article.title)))return null;
  return {state:'submitted',url:location.href,articleId:id};
 }
 const isList=location.pathname==='/creative-center/draft',draftId=location.pathname.match(/^\/blogger\/draft\/([1-9]\d{0,19})$/)?.[1];
 if(location.origin!=='https://blog.51cto.com'||!isList&&!draftId&&location.pathname!=='/blogger/publish')fail('请在 51CTO 普通文章编辑器完成登录');
 if(all('iframe[src*="captcha"],input[placeholder*="验证码"]').length)fail('51CTO 需要本人验证，请在官方窗口完成');
 const ids=[...new Set(all('a[href]').filter(a=>isList||a.querySelector('img')).map(a=>a.href.match(isList?/^https:\/\/blog\.51cto\.com\/u_([1-9]\d{0,19})$/:/^https:\/\/blog\.51cto\.com\/([1-9]\d{0,19})\/?$/)?.[1]).filter(Boolean))];
 if(ids.length!==1)fail('未取得唯一的 51CTO 登录账号，未继续');
 if(accountId&&accountId!==ids[0])fail('51CTO 登录账号已变化，未继续');
 const evidence={accountId:ids[0],name:'51CTO · '+ids[0],editorReady:true,evidenceUrl:location.href};
 if(isList){if(action!=='draft-list-inspect')fail('草稿箱仅用于查询原稿');const a=all('h3 a[href]').filter(a=>text(a)===norm(article?.title)&&/^https:\/\/blog\.51cto\.com\/blogger\/draft\/[1-9]\d{0,19}$/.test(a.href));if(a.length!==1)fail('草稿箱没有唯一匹配原稿，不会重新创建');return {...evidence,url:a[0].href,articleId:a[0].href.split('/').pop(),draftListed:true};}
 const title=one('input[placeholder="请输入标题"]','标题'),editor=one('[contenteditable="true"]','正文编辑器');
 if(action==='identity')return evidence;
 if(action==='inspect')return {...evidence,titleChars:text(title).length,bodyChars:text(editor).length};
 if(!article?.title||!article?.text||!article?.html)fail('没有完整审核稿件');
 const disclosure=article.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'';
 const expected=norm(article.text+disclosure);
 const matches=()=>text(title)===norm(article.title)&&text(editor)===expected;
 if(action==='fill'){
  if(text(title)||text(editor)||editor.querySelector('img,video'))fail('编辑器已有内容，未覆盖');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,article.title);
  title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));
  editor.focus();return {nativeInsertText:article.text+disclosure};
 }
 for(let i=0;i<10&&!matches();i++)await new Promise(r=>setTimeout(r,200));
 if(!matches())fail('51CTO 标题或完整正文与确认稿不一致，未继续');
 if(action==='prepared')return {...evidence,contentVerified:true};
 if(action==='draft-receipt'){
  const proof=article.verifiedDraftList;
  if(!draftId||!proof?.draftListed||proof.accountId!==ids[0]||proof.articleId!==draftId||proof.url!==location.href)return null;
  return {url:location.href,articleId:draftId,accountId:ids[0],savedVerified:true,contentVerified:true,verification:'draft_list_and_reopened_content'};
 }
 const leaf=label=>{const a=all('*').filter(e=>text(e)===label&&![...e.children].some(c=>text(c)===label));if(a.length!==1)fail('未找到唯一的“'+label+'”选项');return a[0]};
 const button=label=>{const a=all('button').filter(e=>text(e).replace(/[\ue000-\uf8ff]/g,'').trim()===label&&!e.disabled);if(a.length!==1)fail('未找到唯一可用的“'+label+'”按钮');return a[0]};
 if(action==='preflight'){
  let source=()=>all('input,textarea').filter(e=>['原创','转载','翻译'].includes(text(e)));
  if(!source().length){leaf('基础信息').click();}
  for(let i=0;i<30&&!source().length;i++)await new Promise(r=>setTimeout(r,200));
  const types=source();if(types.length!==1||text(types[0])!=='原创')fail('请确认文章来源，未自动改为原创');
  if(/幂等|重复提交|任务|开发|接口/.test(article.title+' '+article.text))leaf('软件研发').click();else fail('请先为这篇文章选择准确分类，原稿已保留');
  const cover=all('label').filter(e=>text(e)==='无图');if(cover.length!==1)fail('无图封面选项不明确');cover[0].click();
  const pub=all('label').filter(e=>text(e)==='公开');if(pub.length!==1)fail('可见性选项不明确');const input=pub[0].querySelector('input');if(!input?.checked)fail('原稿不是公开可见，请在平台确认');
  const tag=one('input[placeholder*="请设置标签"]','文章标签');if(!text(tag.parentElement))fail('平台未生成标签，请为原稿选择标签');
  button('确认').click();
  for(let i=0;i<30&&source().length;i++)await new Promise(r=>setTimeout(r,200));
  if(source().length)fail('基础信息尚未保存，未提交');
  button('发布文章');return {ready:true};
 }
 if(action==='submit'){button('发布文章').click();return {submitted:true};}
 fail('不支持此操作');
 }catch(e){return {connectorError:String(e.message||e).slice(0,240)}}
}
