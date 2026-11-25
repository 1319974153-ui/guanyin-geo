import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {flushSessionStore} from './session-store.mjs';
import {kimiConversationUrl} from '../src/kimi-conversation.js';

const adapters={
 'DeepSeek':{url:'https://chat.deepseek.com/',input:'textarea[placeholder*="DeepSeek"],textarea[placeholder*="消息"],textarea[placeholder*="message" i]',user:'[data-message-role="user"],[data-role="user"]',answer:'.ds-assistant-message-main-content,[data-message-role="assistant"],[data-role="assistant"]'},
 'Kimi':{
  url:'https://www.kimi.com/',
  input:'.chat-input-editor[contenteditable="true"][role="textbox"]',
  user:'.segment-user .user-content__text',
  answer:'.segment-assistant'
 },
 '豆包':{url:'https://www.doubao.com/chat/',user:'[data-testid="send_message"],[data-message-role="user"]',answer:'[data-testid="receive_message"],[data-message-role="assistant"]'},
 '腾讯元宝':{url:'https://yuanbao.tencent.com/',input:'.ql-editor[contenteditable="true"],[role="textbox"][contenteditable="true"],textarea:not([disabled]):not([readonly])',user:'.agent-chat__bubble--human,[data-role="user"]',answer:'.agent-chat__bubble--ai,[data-role="assistant"]'},
 '通义千问':{url:'https://www.qianwen.com/',user:'.user-message,[class*="userMessage"],[data-role="user"]',answer:'.chat-answers-card-wrap,.assistant-message,[class*="assistantMessage"],[data-role="assistant"]'}
};
// Serialized into the isolated official window. Only visible conversation elements are read.
export function inspectConversation(config,question,focus){
 const visible=node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
 const all=(s,parent=document)=>Array.from(parent.querySelectorAll(s)).filter(visible);
 const clean=s=>s.replace(/\s+/g,' ').trim();
 const users=all(config.user),answers=all(config.answer);
 const input=all(config.input||'textarea:not([readonly]):not([disabled]),[contenteditable="true"][role="textbox"],[contenteditable="true"]').at(-1);
 const login=all('button,a,[role="button"]').some(el=>/^(登录|立即登录|登录后使用|登录\/注册)$/.test(el.innerText.trim()));
 const kimi=config.url==='https://www.kimi.com/';
 const dialogs=all('[role="dialog"],[aria-modal="true"]');
 const membershipRequired=kimi&&all('[role="dialog"],[aria-modal="true"],.modal-mask').some(el=>
  /(?:开通|订阅|升级|购买)\s*(?:Kimi\s*)?(?:会员|套餐)|会员专享|仅(?:限|对)会员|membership required/i.test(el.innerText)
 );
 const environmentBlocked=dialogs.some(el=>/使用环境异常|当前环境存在风险|unsupported browser/i.test(el.innerText));
 const phoneLogin=config.url==='https://yuanbao.tencent.com/'&&all('input[placeholder*="手机号"]').length>0&&all('input[placeholder*="验证码"]').length>0;
 const kimiPhoneLogin=kimi&&all('input.phone-form__phone-input').length>0&&all('input.phone-form__code-input').length>0;
 const blocked=membershipRequired||phoneLogin||kimiPhoneLogin||environmentBlocked||dialogs.some(el=>/登录|扫码|验证|sign in/i.test(el.innerText));
 const signIn=/\/(?:sign_in|sign-in|login)(?:\/|$)/i.test(location.pathname);
 const requiresLogin=!environmentBlocked&&!membershipRequired&&(blocked||kimi&&login&&!users.length||signIn&&!input||config.url==='https://yuanbao.tencent.com/'&&location.pathname==='/scan');
 if(focus&&input&&!requiresLogin&&!blocked&&!users.length&&!answers.length)input.focus();
 let inputText=input?(input.value??input.innerText):'';
 if(input?.querySelector('[data-slate-node="element"]')){
  inputText=[...input.querySelectorAll('[data-slate-node="element"]')].filter(el=>!el.querySelector('[data-slate-node="element"]')).map(el=>
   [...el.querySelectorAll('[data-slate-string]')].map(span=>span.textContent).join('')
  ).join('\n');
 }
 const empty=!!input&&!inputText.trim();
 const contentSelector=kimi?'.markdown-container':'[data-testid="message_text_content"],.markdown-body,.markdown,.hyc-content-md,.qk-markdown,.ds-markdown,[class*="markdown" i]';
 const exactPrompt=el=>!el.closest('textarea,[contenteditable="true"],nav,aside,button')&&clean(el.innerText||'')===clean(question);
 const lastUser=users.at(-1)||(!kimi&&!focus&&all('p,span,div').find(el=>el.childElementCount===0&&exactPrompt(el)));
 const follows=el=>lastUser&&!!(lastUser.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
 const roots=lastUser?all(contentSelector).filter(el=>follows(el)&&!el.closest('nav,aside,button,textarea,[contenteditable="true"]')):[];
 const lastAnswer=answers.at(-1)||roots.find(el=>!roots.some(parent=>parent!==el&&parent.contains(el)));
 
 const matched=lastUser&&(!kimi||users.length===1)&&[lastUser,...lastUser.querySelectorAll('p,[data-testid="message_text_content"],.bubble-content')].some(el=>clean(el.innerText||'')===clean(question));
 const belongs=matched&&lastAnswer&&!!(lastUser.compareDocumentPosition(lastAnswer)&Node.DOCUMENT_POSITION_FOLLOWING);
 const markdown=belongs?(lastAnswer.matches(contentSelector)?[lastAnswer]:all(contentSelector,lastAnswer)):[];
 const primary=belongs&&all('[data-testid="message_text_content"]',lastAnswer);
 const blocks=primary?.length?primary:markdown.filter(el=>!markdown.some(other=>other!==el&&other.contains(el)));
 const text=blocks.map(el=>el.innerText.trim()).filter(Boolean).join('\n\n');
 const actionSelector='button,[role="button"],[title],[aria-label],[data-testid]';
 const label=el=>[el.title,el.getAttribute('aria-label'),el.getAttribute('data-testid'),el.matches('button,[role="button"]')?el.innerText:''].filter(Boolean).join(' ');
 const postAnswer=config.url==='https://www.doubao.com/chat/'&&belongs&&users.length===1&&all('[data-testid="suggest_message_list"],[data-testid="after_message_download_desktop_button"]').some(el=>blocks.some(b=>b.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING));
 const qwenIdle=config.url==='https://www.qianwen.com/'&&belongs&&lastAnswer.closest('.chat-answers-card-wrap')&&all('button').some(el=>[el.title,el.getAttribute('aria-label'),el.getAttribute('data-testid')].includes('发送消息')||Array.from(el.querySelectorAll('use')).some(icon=>(icon.getAttribute('href')||icon.getAttribute('xlink:href'))==='#qwpcicon-sendChat'));
 // DeepSeek adds a read-aloud action beside the finished reply. Code blocks
 // and other messages may also have tools, so bind it to the matched reply.
 const dsMessage=config.url==='https://chat.deepseek.com/'&&belongs&&lastAnswer.closest('.ds-message');
 // The read-aloud toolbar may be inside this answer or immediately after
 // its message. Don't use toolbar controls from an adjacent assistant turn.
 const dsReadAloud=dsMessage&&dsMessage.parentElement&&all('[aria-label="朗读"],[aria-label="Read aloud" i]',dsMessage.parentElement).some(el=>{
  if(!blocks.some(block=>block.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)||blocks.some(block=>block.contains(el)))return false;
  const owner=el.closest('.ds-message');
  if(owner)return owner===dsMessage;
  const preceding=all('.ds-message',dsMessage.parentElement).filter(message=>message.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
  return preceding.at(-1)===dsMessage;
 });
 const isCompletionAction=el=>/复制回答|复制全文|^复制$|copy[-_ ]?(answer|message)|message[-_a-z]*copy|^copy$|重新生成|重新回答/i.test(label(el).trim());
 // Kimi renders its finished reply toolbar next to the answer segment.
 const kimiTurn=kimi&&belongs&&lastAnswer.closest('.chat-content-item-assistant');
 const completionActions=kimi&&belongs?all(actionSelector,kimiTurn||lastAnswer):all(actionSelector);
 const finished=dsReadAloud||qwenIdle||postAnswer||belongs&&completionActions.some(el=>
  follows(el)&&!el.closest(config.user)&&!el.closest('pre,code,nav,aside')&&
  (!kimi||blocks.some(block=>!block.contains(el)&&(block.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)))&&
  (isCompletionAction(el)||kimi&&el.matches('.speech-button[aria-label="朗读"],.speech-button[aria-label="Read aloud" i]'))
 );
 const streaming=all('button,[role="button"],[data-testid*="stop"]').some(el=>/停止(生成|回答|输出)|stop[-_ ]?(generating|generation|answer|button)/i.test(label(el))||kimi&&/^(停止|Stop)$/i.test(label(el).trim()));
 const links=new Map();
 if(belongs)for(const a of all('a[href]',lastAnswer)){
  const root=blocks.find(b=>b.contains(a));
  const heading=root&&all('h1,h2,h3,h4,h5,h6,strong',root).filter(el=>el.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
  const sourced=heading&&/^(?:可核对的)?(?:参考(?:来源|资料|文献|链接)|引用来源|Sources|References)[：:]?$/i.test(heading.innerText.trim());
  // DeepSeek places the numbered marker inside its link, within the answer.
  const marker=config.url==='https://chat.deepseek.com/'&&root&&all('.ds-markdown-cite',a).length===1&&a.getAttribute('aria-label');
  const numbered=!!marker&&/^\d{1,4}$/.test(marker);
  const kimiCitation=kimi&&root&&a.matches('a.pua-ref-cite-tag');
  if(!kimiCitation&&!numbered&&!sourced&&!a.closest('sup,[data-citation],[class*="citation" i],[class*="reference" i],[class*="source" i]'))continue;
  try{
   const url=new URL(a.href);
   if(kimiCitation&&url.hash.includes(':~:')){
    const anchor=url.hash.split(':~:')[0];
    url.hash=anchor==='#'?'':anchor;
   }
   if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.origin===location.origin||links.has(url.href))continue;
   const title=a.title||(numbered?'引用 '+marker+' · '+url.hostname:a.innerText||(kimiCitation?url.hostname:''));
   links.set(url.href,{url:url.href,title:title.trim().slice(0,300)});
  }catch{}
 }
 const kimiThreads=kimi?[...new Set(all('a[href^="/chat/"]').map(a=>a.href))].slice(0,100):[];
 let kimiSend;
 if(kimi&&input&&!blocked&&!requiresLogin&&!users.length&&!answers.length&&inputText.trim()===question){
  const composer=input.closest('.chat-editor-content');
  const control=composer&&all('.send-button-container',composer).find(el=>
   el.querySelector('.send-icon')&&!el.closest('.disabled,[disabled],[aria-disabled="true"],[inert]')
  );
  if(control){
   const rect=control.getBoundingClientRect();
   const x=Math.floor(rect.left+rect.width/2),y=Math.floor(rect.top+rect.height/2);
   if(control.contains(document.elementFromPoint(x,y)))kimiSend={x,y};
  }
 }
 return {kimiThreads,kimiSend,observedUrl:kimi?location.href:undefined,matched:!!matched,blocked,requiresLogin,environmentBlocked,membershipRequired,login,history:!!(users.length||answers.length),ready:!!(empty&&!requiresLogin&&!blocked&&!users.length&&!answers.length),focused:document.activeElement===input,inputText,text,finished:!!finished&&!streaming,citations:[...links.values()].slice(0,100)};
}

const busy=new Set();
const pendingLoginWindows=new Map();
export function consumerPartition(job){
 return 'persist:geo-search-'+createHash('sha256').update(JSON.stringify([job.owner,job.brand,job.platform])).digest('hex');
}
// Only one official editor takes keyboard focus while entering a question.
// Streaming and waiting for authentication remain independent across windows.
let inputTurn=Promise.resolve();
function enterInOrder(fn){
 const run=inputTurn.then(fn);inputTurn=run.catch(()=>{});return run;
}
export async function collectConsumer({BrowserWindow,session,retainLoginWindow=true},job,progress,saveCheckpoint){
 const config=Object.hasOwn(adapters,job.platform)&&adapters[job.platform];
 if(!config||typeof job.text!=='string'||!job.text.trim()||job.text.length>500)throw Error('平台或问题无效');
 const partition=consumerPartition(job);
 if(busy.has(partition))throw Error('此账号已有查询正在进行，请稍后单独重试');
 busy.add(partition);
 let win,kimiReader,browserSession,detachNavigation;
 try{
  browserSession=session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const origin=new URL(config.url).origin;
  const allowed=url=>{try{return new URL(url).origin===origin}catch{return false}};
  const isKimi=job.platform==='Kimi';
  if(isKimi&&!saveCheckpoint)throw Error('Kimi 查询状态保存服务未就绪');
  let attempted=isKimi&&!!job.checkpoint;
  let kimiThread=isKimi?kimiConversationUrl(job.checkpoint?.sourceUrl):'';
  const pending=pendingLoginWindows.get(partition);
  const resume=pending&&!pending.win.isDestroyed()&&allowed(pending.win.webContents.getURL());
  if(resume&&isKimi&&(pending.run!==job.run||pending.text!==job.text))throw Error('上一条 Kimi 查询窗口仍在等待处理，请先完成或关闭该窗口');
  if(attempted&&!kimiThread&&!resume)throw Error('Kimi 发送结果未确认，原窗口已关闭。请先在 Kimi 查看是否已有该题');
  const makeWindow=()=>{
   const window=new BrowserWindow({width:1040,height:780,show:false,title:'观引查询 · '+job.platform,webPreferences:{session:browserSession,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
   const wc=window.webContents;
   wc.setWindowOpenHandler(()=>({action:'deny'}));
   wc.on('will-attach-webview',e=>e.preventDefault());
   wc.on('will-navigate',(e,url)=>{if(!allowed(e.url||url))e.preventDefault()});
   wc.on('will-redirect',(e,url,_inPlace,isMainFrame)=>{if((e.isMainFrame??isMainFrame)!==false&&!allowed(e.url||url))e.preventDefault()});
   return window;
  };
  if(resume){win=pending.win;pendingLoginWindows.delete(partition)}
  else{
   win=makeWindow();
   win.once('closed',()=>{if(pendingLoginWindows.get(partition)?.win===win)pendingLoginWindows.delete(partition)});
  }
  const wc=win.webContents;
  const inspect=async(focus,window=win)=>{
   if(window.isDestroyed())throw Error('官方查询窗口已关闭');
   const contents=window.webContents,url=contents.getURL();
   if((!url||url==='about:blank')&&contents.isLoadingMainFrame())return {};
   if(!allowed(url))throw Error('平台导航未进入官方对话页，请检查网络后重试');
   try{return await contents.mainFrame.executeJavaScript('('+inspectConversation.toString()+')('+JSON.stringify(config)+','+JSON.stringify(job.text)+','+Boolean(focus)+')');}catch(error){if(!window.isDestroyed()&&/execution context was destroyed|frame was disposed|render frame was disposed/i.test(error.message))return {};throw error}
  };
  let knownKimiThreads=new Set(resume&&isKimi?pending.knownKimiThreads:[]);
  const observedThreads=new Set(resume&&isKimi?pending.observedThreads:[]);
  const rememberThread=url=>{
   const thread=kimiConversationUrl(url);
   if(attempted&&thread&&!knownKimiThreads.has(thread))observedThreads.add(thread);
  };
  const onNavigate=(event,url)=>rememberThread(event.url||url);
  const onPageNavigate=(event,url,isMainFrame)=>{
   if((event.isMainFrame??isMainFrame)===true)onNavigate(event,url);
  };
  if(isKimi){
   wc.on('did-navigate',onNavigate);wc.on('did-navigate-in-page',onPageNavigate);
   detachNavigation=()=>{if(!win.isDestroyed()){wc.removeListener('did-navigate',onNavigate);wc.removeListener('did-navigate-in-page',onPageNavigate)}};
  }
  let sentAt=attempted?Date.now():0;
  let readerTarget='';
  let loadTimer;
  try{if(!resume){
   const ready=new Promise(resolve=>wc.once('dom-ready',()=>{if(allowed(wc.getURL()))resolve()}));
   await Promise.race([ready,win.loadURL(kimiThread||config.url),new Promise((_,reject)=>{loadTimer=setTimeout(()=>reject(Error('平台页面加载超时')),45000)})]);
  }}finally{clearTimeout(loadTimer)}
  let lastNotice='',sent=attempted||!!(resume&&pending.sent&&pending.text===job.text),previous='',stable=0,displayed=false,awaitingLogin=false,lastPage,loginAtSend=false,inserted=!!(resume&&pending.inserted&&pending.text===job.text),deadline=Date.now()+180000;
  const keepWindow=()=>{
   if(!retainLoginWindow||win.isDestroyed())return false;
   pendingLoginWindows.set(partition,{win,sent:sent||attempted,inserted,run:job.run,text:job.text,knownKimiThreads,observedThreads});
   win.show();return true;
  };
  while(Date.now()<deadline){
   let page=await inspect(false);
   let answerWindow=win;
   // The user may have completed the pending draft in its retained window.
   if(isKimi&&resume&&!sent&&inserted&&page.matched&&kimiConversationUrl(page.observedUrl)){
    await saveCheckpoint({stage:'sending'});attempted=true;
    sent=true;sentAt=Date.now();deadline=sentAt+150000;
   }
   // Some Kimi sessions only expose a complete transcript when reopened.
   // Read the new session separately so the original can keep streaming.
   if(isKimi&&sent&&!page.blocked&&!page.requiresLogin&&!page.environmentBlocked){
    const current=kimiConversationUrl(page.observedUrl);
    if(current&&current===kimiConversationUrl(wc.getURL()))rememberThread(current);
    let bound=page.matched&&current===kimiConversationUrl(wc.getURL())&&current&&(kimiThread===current||!kimiThread&&observedThreads.has(current))?current:'';
    const elapsed=Date.now()-sentAt;
    const target=kimiThread||(observedThreads.size===1?[...observedThreads][0]:'');
    if(!kimiReader&&target&&!(bound&&page.finished)&&(!current||elapsed>(page.text?70000:14000))){
     kimiReader=makeWindow();
     readerTarget=target;
     void kimiReader.loadURL(readerTarget).catch(()=>{});
     progress('正在回读这次 Kimi 原对话');
    }
    if(kimiReader&&!kimiReader.isDestroyed()){
     const recovered=await inspect(false,kimiReader).catch(()=>({}));
     const recoveredUrl=kimiConversationUrl(recovered.observedUrl);
     if(recovered.membershipRequired&&recoveredUrl===readerTarget){
      keepWindow();
      throw Error('Kimi 页面提示需要会员权限，本次查询已暂停');
     }
     if(recovered.matched&&!recovered.blocked&&!recovered.requiresLogin&&recoveredUrl===readerTarget&&recoveredUrl===kimiConversationUrl(kimiReader.webContents.getURL())&&
        (kimiThread===recoveredUrl||!kimiThread&&observedThreads.size===1&&observedThreads.has(recoveredUrl))&&(!bound||!page.finished)){
      bound=recoveredUrl;page=recovered;answerWindow=kimiReader;
     }
    }
    if(!kimiThread&&bound){
     await saveCheckpoint({stage:'confirmed',sourceUrl:bound});
     kimiThread=bound;
     progress('Kimi 已收到本题，正在等待完整回答');
    }
    if(!kimiThread&&observedThreads.size===0&&elapsed>30000&&page.inputText?.trim()===job.text&&!page.history){
     const kept=keepWindow();
     throw Error(kept?'Kimi 未确认发送，已保留题目和窗口。可在原窗口确认后重试读取':'Kimi 未确认发送，题目仍在官方输入框中');
    }
   }
   lastPage=page;
   if(page.environmentBlocked)throw Error('平台提示使用环境异常。请按平台提示检查当前环境，本次查询已停止');
   if(page.membershipRequired){
    keepWindow();
    throw Error('Kimi 页面提示需要会员权限，本次查询已暂停');
   }
   if(!sent&&page.history)throw Error('平台打开了已有会话，未向原对话写入问题');
   if(!sent&&(page.ready||inserted&&!page.blocked&&!page.requiresLogin&&page.inputText===job.text)){
    sent=await enterInOrder(async()=>{
     if(win.isDestroyed())throw Error('平台窗口已关闭');
     win.show();win.focus();wc.focus();
     const candidate=await inspect(true);
     if(candidate.blocked||candidate.requiresLogin||(!candidate.ready&&!(inserted&&candidate.inputText===job.text))||!candidate.focused)return false;
     // Some guest editors open the sign-in dialog asynchronously on focus.
     await wait(450);
     const editor=await inspect(false);
     if(editor.blocked||editor.requiresLogin||(!editor.ready&&!(inserted&&editor.inputText===job.text))||!editor.focused)return false;
     loginAtSend=editor.login;
     if(isKimi)knownKimiThreads=new Set((editor.kimiThreads||[]).map(kimiConversationUrl).filter(Boolean));
     if(editor.ready){await wc.insertText(job.text);inserted=true}
     let filled=await inspect(false);
     if(filled.blocked||filled.requiresLogin)return false;
     if(filled.history||!filled.focused||filled.inputText?.trim()!==job.text)throw Error('平台输入框已变化，问题未发送');
     if(isKimi){
      // Kimi can leave the question in its editor after a native Return.
      // Wait for its rendered send control to accept this exact draft.
      for(let i=0;i<20&&!filled.kimiSend;i++){
       await wait(250);
       filled=await inspect(false);
       if(filled.blocked||filled.requiresLogin)return false;
       if(filled.history||filled.inputText?.trim()&&filled.inputText.trim()!==job.text)throw Error('Kimi 输入框已变化，问题未发送');
      }
      if(!filled.kimiSend){
       const kept=filled.inputText?.trim()===job.text&&keepWindow();
       if(filled.membershipRequired)throw Error('Kimi 页面提示需要会员权限，本次查询已暂停');
       throw Error(kept?'未识别到 Kimi 可用的发送按钮，已保留题目和窗口':'未识别到 Kimi 可用的发送按钮，问题未发送');
      }
      for(const url of filled.kimiThreads||[]){
       const thread=kimiConversationUrl(url);
       if(thread)knownKimiThreads.add(thread);
      }
      await saveCheckpoint({stage:'sending'});attempted=true;
      const ready=await inspect(false);
      if(!ready.kimiSend){
       keepWindow();
       if(ready.membershipRequired)throw Error('Kimi 页面提示需要会员权限，本次查询已暂停');
       throw Error('Kimi 发送区域已变化，请核对原窗口');
      }
      const {x,y}=ready.kimiSend;
      wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
      wc.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
      return true;
     }
     wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'});return true;
    });
    if(sent){sentAt=Date.now();deadline=sentAt+(isKimi?150000:120000);progress(isKimi?'正在确认 Kimi 收到本题':'等待平台返回完整回答')}
   }else if(!sent){
    const notice=page.requiresLogin?'请在'+job.platform+'官方窗口登录或完成验证，完成后自动继续':'正在等待官方对话输入框就绪';
    if(!displayed||notice!==lastNotice){
     displayed=true;lastNotice=notice;
     if(page.requiresLogin){win.show();deadline=Date.now()+180000}progress(notice);
    }
   }else if(sent&&page.requiresLogin){
    if(!awaitingLogin){win.show();awaitingLogin=true;deadline=Date.now()+180000;progress('平台要求本人登录或验证，完成后继续核对原回答')}
   }else if(sent&&page.finished&&page.text){
    if(isKimi&&(!kimiThread||!page.matched||page.blocked||kimiConversationUrl(page.observedUrl)!==kimiThread||kimiConversationUrl(answerWindow.webContents.getURL())!==kimiThread)){
     stable=0;previous='';
     await wait(800);continue;
    }
    const signature=JSON.stringify([page.text,page.citations]);stable=signature===previous?stable+1:0;previous=signature;
    if(stable>=2){
     if(page.text.length>100000)throw Error('回答超过保存上限，未截断原文');
     const source=new URL(answerWindow.webContents.getURL());
     const refused=page.text.length<=160&&/(?:我无法回答这个问题|我不能回答这个问题|无法为你提供回答|暂时无法回答这个问题|请登录后(?:继续|再试))/.test(page.text);
     return {outcome:refused?'declined':'answer',text:page.text,citations:page.citations,loginPromptVisible:loginAtSend,sourceUrl:kimiThread||(source.pathname===new URL(config.url).pathname?'':source.origin+source.pathname),collectedAt:new Date().toISOString()};
    }
   }else{stable=0;previous=''}
   await wait(800);
  }
  if(lastPage?.requiresLogin&&keepWindow()){
   throw Error('官方登录窗口已保留。完成登录后可继续使用同一账号查询');
  }
  if(isKimi&&sent&&keepWindow()){
   throw Error('Kimi 完整回答尚未确认，已保留原对话。重试会继续读取这条对话');
  }
  throw Error(!sent?(lastPage?.requiresLogin?'平台仍在登录或验证页，请完成后重试':'尚未识别可用的官方输入框，可单独重试'):lastPage?.requiresLogin?'平台尚未通过登录或验证':lastPage?.text?'平台回答尚无可确认的完成标记，未保存片段' :awaitingLogin?'登录后未查到本题原回答，尚未记录结果':'未读到与这道题对应的回答，未保存其他会话');
 }finally{
  detachNavigation?.();
  try{if(browserSession)await flushSessionStore(browserSession)}
  finally{if(kimiReader&&!kimiReader.isDestroyed())kimiReader.destroy();if(win&&!win.isDestroyed()&&pendingLoginWindows.get(partition)?.win!==win)win.destroy();busy.delete(partition)}
 }
}
