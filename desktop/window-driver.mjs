import fs from 'node:fs';
import {observeResourceHealth} from './resource-health.mjs';
import {flushSessionStore} from './session-store.mjs';
import {aliyunSecureReturn} from './platform-preview.mjs';
import path from 'node:path';
import {randomInt} from 'node:crypto';
import {navigationAllowed,connectionPartition,LOGIN_URLS,loginReturned} from './security.mjs';
import {editorEvidence,platformConfig} from '../browser-extension/platforms.js';
import {readLoginWarning,loginPageRequired,pageLoadFailure} from './login-state.mjs';
// No Chrome profiles, remote debugging port, arbitrary renderer scripts, or credential exports.
export function windowDriver({BrowserWindow,session,root,connection,partition,onStatus=()=>{},onLoginReady=()=>{},onLoginRequired=()=>{},onLoadError=()=>{}}){
 fs.mkdirSync(root,{recursive:true,mode:0o700});const filename=path.join(root,'executor.json');
 let state={};if(fs.existsSync(filename)){state=JSON.parse(fs.readFileSync(filename,'utf8'));if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('发布记录损坏，已停止以防重发')}
 let loginTab=null;const windows=new Map(),loadFailures=new Map(),domReady=new Set();const savedTabs=state._tabs||{};const browserSession=session.fromPartition(partition||connectionPartition(connection.sessionId));
 browserSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));browserSession.setPermissionCheckHandler(()=>false);
 const resources=observeResourceHealth(browserSession,connection.platform,wcId=>{for(const [id,win] of windows)if(win.webContents.id===wcId)return {id,win}},onLoadError);
 const loadError=id=>loadFailures.get(id)||resources.get(id);
 const flushSession=()=>flushSessionStore(browserSession);
 function persist(){const tmp=filename+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,filename)}
 function saveTab(id,url,openerTabId){if(!navigationAllowed(connection.platform,url))return;savedTabs[id]={id,url,...(openerTabId?{openerTabId}:{})};state._tabs=savedTabs;persist()}
 function createWindow(url,{id=randomInt(1,2**30),active=true,openerTabId}={}){
  if(!navigationAllowed(connection.platform,url))throw new Error('已阻止离开账号平台的页面');
  const win=new BrowserWindow({width:1100,height:820,show:active,title:'观引 · '+platformConfig(connection.platform).name,webPreferences:{session:browserSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  windows.set(id,win);saveTab(id,url,openerTabId);const wc=win.webContents;
  wc.on('did-fail-load',(_event,code,_description,_url,main)=>{const error=pageLoadFailure(code);if(!main||!error)return;const changed=loadFailures.get(id)!==error;loadFailures.set(id,error);if(changed&&win.isVisible())onLoadError(error)});
  wc.on('did-start-navigation',(_e,_url,inPlace,isMain)=>{if(isMain&&!inPlace){resources.reset(id);loadFailures.delete(id);domReady.delete(id)}});
  wc.on('dom-ready',()=>domReady.add(id));
  wc.on('did-finish-load',()=>{if(navigationAllowed(connection.platform,wc.getURL()))loadFailures.delete(id)});
  for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,legacyUrl)=>{const url=e.url||legacyUrl,secure=connection.platform==='aliyun'?aliyunSecureReturn(url):null;if(secure){e.preventDefault();void wc.loadURL(secure).catch(()=>{})}else if(!navigationAllowed(connection.platform,url))e.preventDefault()});
  wc.on('will-attach-webview',e=>e.preventDefault());
  // Resume a bounded login check after the human returns, even if the initial
  // wait expired. Only this connection's login window can signal readiness.
  let signInReported=false,returnToEditor=true;
  const loginReady=()=>{if(win.isDestroyed()||wc.isLoadingMainFrame()||loadError(id))return;
   if(win.isVisible()&&loginPageRequired(connection.platform,wc.getURL())){loginTab=id;returnToEditor=true;if(!signInReported){signInReported=true;onLoginRequired()}return}
   signInReported=false;
   if(id===loginTab&&!win.isDestroyed()&&!wc.isLoadingMainFrame()&&editorEvidence(connection.platform,wc.getURL()))onLoginReady()};
  wc.on('did-finish-load',loginReady);wc.on('did-stop-loading',loginReady);win.on('focus',loginReady);wc.on('did-navigate-in-page',(_e,_url,main)=>{if(main)loginReady()});
  wc.setWindowOpenHandler(({url})=>{if(navigationAllowed(connection.platform,url))createWindow(url,{openerTabId:id,active:true});return {action:'deny'}});
  wc.on('did-navigate',(_e,url)=>{saveTab(id,url,openerTabId);if(id===loginTab&&returnToEditor&&loginReturned(connection.platform,url)){returnToEditor=false;void wc.loadURL(platformConfig(connection.platform).editor).catch(()=>{})};});wc.on('did-navigate-in-page',(_e,url,main)=>{if(main){saveTab(id,url,openerTabId);if(id===loginTab&&returnToEditor&&loginReturned(connection.platform,url)){returnToEditor=false;void wc.loadURL(platformConfig(connection.platform).editor).catch(()=>{})}}});
  win.on('closed',()=>{windows.delete(id);loadFailures.delete(id);resources.reset(id);domReady.delete(id)});win.loadURL(url).catch(()=>onStatus('平台页面未加载完成，请检查网络或登录状态'));
  return {id,url,...(openerTabId?{openerTabId}:{})};
 }
 function ensureWindow(id){let win=windows.get(id);if(win&&!win.isDestroyed())return win;const saved=savedTabs[id];if(!saved)throw new Error('原编辑页已不存在，未创建新稿');createWindow(saved.url,{id,active:false,openerTabId:saved.openerTabId});return windows.get(id)}
 async function ready(win){const id=[...windows].find(([,w])=>w===win)?.[0];if(loadError(id))throw Error(loadError(id));if(domReady.has(id)||!win.webContents.isLoadingMainFrame())return;await new Promise((resolve,reject)=>{const wc=win.webContents;const timer=setTimeout(()=>done(new Error('平台加载超时，原稿已保留')),20000);const finish=()=>done();const closed=()=>done(new Error('平台窗口已关闭'));function done(error){clearTimeout(timer);wc.removeListener('did-stop-loading',finish);wc.removeListener('dom-ready',finish);win.removeListener('closed',closed);error?reject(error):resolve()}wc.once('did-stop-loading',finish);wc.once('dom-ready',finish);win.once('closed',closed)});if(loadError(id))throw Error(loadError(id))}
 const chrome={
  storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])]))},async set(values){Object.assign(state,structuredClone(values));persist();if(values.status)onStatus(values.status)},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete state[k];persist()}}},
  runtime:{id:'desktop',getURL:p=>'guanyin-desktop://'+p,onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  alarms:{async get(){return {name:'publisher'}},async create(){},onAlarm:{addListener(){}}},
  tabs:{async remove(id){const win=windows.get(id);if(win&&!win.isDestroyed())win.destroy();delete savedTabs[id];state._tabs=savedTabs;persist()},async reload(id){const win=ensureWindow(id);win.webContents.reload();},async create(options){return createWindow(options.url,options)},async get(id){const win=ensureWindow(id);return {...savedTabs[id],url:win.webContents.getURL()||savedTabs[id].url}},async query({url}){const prefix=url.replace(/\*$/,'');return [...windows].filter(([,w])=>!w.isDestroyed()&&w.webContents.getURL().startsWith(prefix)).map(([id,w])=>({...savedTabs[id],id,url:w.webContents.getURL()}))}},
  scripting:{async executeScript({target,func,args}){
   const win=ensureWindow(target.tabId);await ready(win);const url=win.webContents.getURL();
   if(!platformConfig(connection.platform).hosts.some(pattern=>new URL(url).origin===new URL(pattern.replace('*','')).origin))throw new Error('请在平台登录完成后继续');
   // func comes solely from the bundled adapter, never from IPC, page content or a URL.
   let timer;try{const result=await Promise.race([win.webContents.executeJavaScript('('+func.toString()+')('+args.map(a=>JSON.stringify(a)).join(',')+')',true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('平台检查未返回，原稿保留')),20000)})]);if(['51cto','aliyun','juejin','douyin'].includes(connection.platform)&&args[0]?.action==='fill'&&typeof result?.nativeInsertTitle==='string'){
    await win.webContents.insertText(result.nativeInsertTitle);
    const next={...args[0],action:'fill-body'},body=await win.webContents.executeJavaScript('('+func.toString()+')('+JSON.stringify(next)+')',true);
    if(body?.connectorError)return [{result:body}];if(typeof body?.nativeInsertText!=='string')throw Error('正文输入未准备，原稿保留');
    await win.webContents.insertText(body.nativeInsertText);
    if(connection.platform==='aliyun'){
     const summaryArgs={...args[0],action:'fill-summary'};
     const summary=await win.webContents.executeJavaScript('('+func.toString()+')('+JSON.stringify(summaryArgs)+')',true);
     if(summary?.connectorError)return [{result:summary}];
     if(typeof summary?.nativeInsertSummary==='string')await win.webContents.insertText(summary.nativeInsertSummary);
     else if(summary?.summaryPresent!==true)throw Error('摘要未准备，原稿保留');
    }
    return [{result:{filled:true}}];
   }if(['tencentcloud','51cto'].includes(connection.platform)&&args[0]?.action==='fill'&&result?.nativeInsertText){await win.webContents.insertText(result.nativeInsertText);return [{result:{filled:true}}]}if(connection.platform==='tencentcloud'&&args[0]?.action==='preflight'&&typeof result?.nativeInsertTag==='string'){await win.webContents.insertText(result.nativeInsertTag);const next={...args[0],tagInputReady:true};const verified=await win.webContents.executeJavaScript('('+func.toString()+')('+JSON.stringify(next)+')',true);return [{result:verified}]}return [{result}]}finally{clearTimeout(timer)}
  }}
 };
 return {chrome,loginHeld(){return state._loginHold==='rate_limited'},clearLoginHold(){delete state._loginHold;persist()},async detectLoginHold(){
  if(state._loginHold==='rate_limited')return true;
  const w=windows.get(loginTab);if(!w||w.isDestroyed()||w.webContents.isLoadingMainFrame())return false;
  if(!navigationAllowed(connection.platform,w.webContents.getURL()))return false;
  let timer;try{const result=await Promise.race([w.webContents.executeJavaScript('('+readLoginWarning.toString()+')()'),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000)})]);if(result==='rate_limited'){state._loginHold=result;persist();return true}return false}catch{return false}finally{clearTimeout(timer)}
 },openReceipt(url){if(!editorEvidence(connection.platform,url))throw Error('不是已核验的平台编辑地址');for(const [id,win]of windows){if(!win.isDestroyed()&&(win.webContents.getURL()===url||savedTabs[id]?.url===url)){win.show();win.focus();return {id,url}}}return createWindow(url,{active:true})},showOriginal(){const entry=state.inflightByPlatform?.[connection.platform]||(connection.platform==='csdn'?state.inflight:null);if(!entry?.tabId)return false;const win=ensureWindow(entry.tabId);win.show();win.focus();return true},async openLogin(){
  if(loginTab&&windows.has(loginTab)){const w=windows.get(loginTab);w.show();w.focus();if(loadError(loginTab)){loadFailures.delete(loginTab);resources.reset(loginTab);w.webContents.reload()}return}
  const tab=createWindow(LOGIN_URLS[connection.platform]);loginTab=tab.id;
  // Reuse this window for the first identity check. Never replace an in-flight original editor.
  if(!state.inflightByPlatform?.[connection.platform]&&!state.inflight)await chrome.storage.local.set({['editorTab:'+connection.platform]:tab.id});
 },loginEditorReady(){const w=windows.get(loginTab);return !!w&&!w.isDestroyed()&&!loadError(loginTab)&&!w.webContents.isLoadingMainFrame()&&editorEvidence(connection.platform,w.webContents.getURL())},async initialize(){await chrome.storage.local.set({connections:{[connection.platform]:connection},...(connection.platform==='csdn'?{connection}:{} )})},showAccount(){const id=state['editorTab:'+connection.platform];if(id){const win=ensureWindow(id);win.show();win.focus();return true}return false},hasVisibleWindow:()=>[...windows.values()].some(w=>!w.isDestroyed()&&w.isVisible()),flushSession,async close(){resources.close();for(const w of windows.values())if(!w.isDestroyed())w.destroy();await flushSession()},state};
}
