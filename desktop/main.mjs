import {clipboardContent} from './clipboard-content.mjs';
import {DESKTOP_PUBLIC_PLATFORMS} from './build-capabilities.mjs';
import {asciiProductUserAgent} from './user-agent.mjs';
import {publishingPartition} from './preview-adoption.mjs';
import {platformPreview} from './platform-preview.mjs';
import {publicProof} from './public-proof.mjs';
import {app,BrowserWindow,ipcMain,utilityProcess,session,dialog,shell,Menu,MenuItem,clipboard} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {createPublisherRuntime} from '../browser-extension/runtime.js';
import {windowDriver} from './window-driver.mjs';
import {LOGIN_RATE_LIMIT_MESSAGE,LOGIN_EXPIRED_MESSAGE,connectionFailureState} from './login-state.mjs';
import {trustedFrame,connectionInput,targetInput} from './security.mjs';
import {installQuitFlow} from './quit-flow.mjs';
import {desktopDataRoot} from './data-root.mjs';
import {desktopBuildIdentity,beginDesktopUpgrade,completeDesktopUpgrade,requestDesktopUpgradeRestore,restoreRequestedDesktopUpgrade} from './data-upgrade.mjs';
import {wechatPersonalLoginPage,wechatPersonalPage,wechatPersonalUrlAllowed} from './wechat-personal-publisher.mjs';
import {authorizedWechatCommand,authorizedWechatStep} from './wechat-authorized-command.mjs';
import {WECHAT_PERSONAL_PARTITION,persistWechatPersonalSession} from './wechat-personal-session.mjs';
import {beginWechatPersonalTask,loadWechatPersonalTask,updateWechatPersonalTask,wechatPersonalRequestMarker,wechatPersonalTaskActive,wechatPersonalTaskSummary} from './wechat-personal-task.mjs';
import {resumePendingWechatPersonalTask} from './wechat-personal-startup.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),bundleRoot=path.resolve(here,'..');
app.setName('观引桌面版');
app.userAgentFallback=asciiProductUserAgent(app.userAgentFallback);
const dataRoot=desktopDataRoot({args:process.argv,env:process.env,isPackaged:app.isPackaged,appData:app.getPath('appData')});
fs.mkdirSync(dataRoot,{recursive:true,mode:0o700});app.setPath('userData',dataRoot);
let main,service,origin,stopping=false,sequence=0,pollTimer,upgradeRecord;const pending=new Map(),controllers=new Map();let wechatPersonalWindow,wechatPersonalLoginWindow,wechatPersonalTimer,wechatPersonalSession,wechatPersonalFlush,wechatPersonalRun,wechatPersonalTaskId='';
let wechatPersonalLoginState={state:'unknown',message:'公众号尚未完成本次应用内登录检查',checkedAt:0};
const upcomingPlatform=platformPreview({BrowserWindow,session});
const bindMainQuit=installQuitFlow({app,getMain:()=>main,confirmDiscard:win=>dialog.showMessageBoxSync(win,{type:'question',title:'退出观引',message:'当前页面有未保存的修改。',detail:'继续编辑可先保存；退出只会放弃当前页面尚未保存的修改，已保存的稿件、账号和回执保留。',buttons:['继续编辑','放弃修改并退出'],defaultId:0,cancelId:0})===1,shutdown:stopService});
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',()=>{if(main){main.show();main.focus()}});
 app.whenReady().then(start).catch(startupFailed);
}
async function startupFailed(error){
 let restore=false;
 if(upgradeRecord?.status==='prepared'){
  const answer=await dialog.showMessageBox({type:'error',title:'观引升级未完成',message:'新版未完成启动，自动写作和发布尚未启用。',detail:error.message+'\n升级前的完整业务备份已保留。可安排恢复后退出，再次打开时完成恢复；本次失败的资料也会另存，不会删除。',buttons:['保留资料并退出','安排恢复升级前资料'],defaultId:0,cancelId:0});restore=answer.response===1;
 }else dialog.showErrorBox('观引启动失败',error.message);
 if(restore)try{requestDesktopUpgradeRestore(dataRoot,upgradeRecord)}catch(e){dialog.showErrorBox('恢复未安排',e.message)}
 await stopService();app.quit();
}
function rpc(action,data){if(!service||stopping)return Promise.reject(new Error('本机服务未就绪'));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('本机服务响应超时，未自动重试'))},15000);pending.set(id,{resolve,reject,timer});service.postMessage({id,action,data})})}
async function freePort(preferred){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>{preferred?freePort(0).then(resolve,reject):reject(new Error('找不到可用本机端口'))});s.listen(preferred||0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})}
async function start(){
 if(restoreRequestedDesktopUpgrade(dataRoot)){dialog.showMessageBoxSync({type:'info',title:'观引资料已恢复',message:'已恢复升级前的业务资料，失败时的资料另存保留。',detail:'本次没有启动自动写作或发布。关闭后可使用上一个版本，或重新打开新版重试。',buttons:['关闭']});app.quit();return;}
 upgradeRecord=beginDesktopUpgrade(dataRoot,desktopBuildIdentity(here));
 const portFile=path.join(dataRoot,'port.json');let previous=0;try{previous=JSON.parse(fs.readFileSync(portFile)).port}catch{}
 const port=await freePort(Number.isInteger(previous)&&previous>1024&&previous<65536?previous:0);origin='http://127.0.0.1:'+port;fs.writeFileSync(portFile,JSON.stringify({port}),{mode:0o600});
 const env=Object.fromEntries(['PATH','HOME','USERPROFILE','SYSTEMROOT','TEMP','TMP','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const serverFile=fs.existsSync(path.join(here,'server.mjs'))?path.join(here,'server.mjs'):path.join(bundleRoot,'dev-server.mjs');
 service=utilityProcess.fork(serverFile,[],{cwd:fs.existsSync(path.join(here,'drizzle'))?here:bundleRoot,env:{...env,GEO_PORT:String(port),GEO_DATA_DIR:path.join(dataRoot,'business'),GEO_SOCIAL_PUBLISH_EXPERIMENTAL:'0',GEO_SOCIAL_PUBLISH_PLATFORMS:DESKTOP_PUBLIC_PLATFORMS.join(',')},stdio:'pipe',serviceName:'观引本机服务'});
 service.stdout?.on('data',b=>process.stdout.write(b));service.stderr?.on('data',b=>process.stderr.write(b));
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('本机服务启动超时')),30000);service.on('message',m=>{if(m.publicProofId){void publicProof({BrowserWindow,session},m.job).then(verified=>{if(!stopping)service?.postMessage({publicProofId:m.publicProofId,verified})}).catch(()=>{});return}if(m.ready){clearTimeout(timer);resolve()}else if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}});service.once('exit',()=>{clearTimeout(timer);reject(new Error('本机服务已退出'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('服务已中断，任务未自动重发'))}pending.clear();if(!stopping&&main)dialog.showErrorBox('观引服务已停止','请退出并重新打开观引。未确认的发布不会自动重发。')})});
 await ready;
 const menu=Menu.getApplicationMenu();if(menu){menu.append(new MenuItem({label:'平台接入验收',submenu:[{label:'思否登录与编辑器验收',click:()=>upcomingPlatform.open('segmentfault')},{label:'51CTO 登录与编辑器验收',click:()=>upcomingPlatform.open()},{label:'阿里云开发者社区登录验收',click:()=>upcomingPlatform.open('aliyun')}]}));Menu.setApplicationMenu(menu)}
 main=new BrowserWindow({width:1280,height:900,minWidth:800,minHeight:600,show:false,title:'观引 · 品牌工作台',webPreferences:{preload:path.join(here,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 main.webContents.on('will-navigate',(e,url)=>{try{if(new URL(url).origin!==origin)e.preventDefault()}catch{e.preventDefault()}});main.webContents.on('will-attach-webview',e=>e.preventDefault());main.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password)void shell.openExternal(u.href)}catch{}return {action:'deny'}});main.webContents.session.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
 const bind=(name,fn)=>ipcMain.handle('guanyin:'+name,(event,value)=>{if(!trustedFrame(event,main.webContents,origin))throw new Error('仅观引主窗口可执行此操作');return fn(value)});
 bind('connect',async input=>{const c=await rpc('desktop-connect',connectionInput(input)),controller=await control(c);await controller.login();return {sessionId:c.sessionId,waitingForLogin:true}});
 bind('open-receipt',async input=>{if(!input||typeof input.jobId!=='string'||!/^[-\w]{1,100}$/.test(input.jobId))throw Error('原稿编号无效');const c=await getConnection(input.sessionId),target=await rpc('desktop-request',{sessionId:c.sessionId,action:'receipt-target',data:{jobId:input.jobId}});(await control(c)).driver.openReceipt(target.url);return {ok:true}});
 bind('open-account',async id=>{const c=await getConnection(id),controller=await control(c);if(!controller.driver.showOriginal())await controller.login();else void controller.reconcileOriginal();return {ok:true}});
 bind('prepare',async input=>{for(const t of targetInput(input)){const c=await getConnection(t.sessionId),controller=await control(c);await controller.verify(t.accountId)}return {ok:true}});
 bind('resume',async input=>{const t=targetInput([input])[0];if(typeof input.jobId!=='string'||!/^[-\w]{1,100}$/.test(input.jobId))throw Error('原任务无效');const c=await getConnection(t.sessionId);if(c.accountId!==t.accountId)throw Error('账号已变化');const controller=await control(c);await controller.resume(input.jobId);return {ok:true}});
 bind('save-prepared',async input=>{const t=targetInput([input])[0];if(typeof input.jobId!=='string'||!/^[-\w]{1,100}$/.test(input.jobId))throw Error('原任务无效');const c=await getConnection(t.sessionId);if(c.platform!=='douyin'||c.accountId!==t.accountId)throw Error('账号已变化');await (await control(c)).savePrepared(input.jobId);return {ok:true}});
 bind('copy-content',input=>{clipboard.write(clipboardContent(input));return {ok:true}});
 bind('wechat-personal-publish',async input=>openWechatPersonalPublisher(input));
 bind('wechat-personal-resume',async input=>resumeWechatPersonalPublisher(input));
 bind('wechat-personal-login',async()=>openWechatPersonalLogin());
 bind('wechat-personal-login-state',async()=>wechatPersonalLoginState);
 bind('wechat-personal-task',async()=>wechatPersonalTaskSummary(dataRoot));
 bind('wake',async()=>{void poll();return {ok:true}});
 bindMainQuit(main);await main.loadURL(origin+'/#today');
 // A restart resumes only the one retained original WeChat task in its visible
 // official window. If the request marker was already recorded, the page
 // helper observes the original result instead of clicking save/publish again.
 for(const c of await rpc('desktop-list'))await control(c);
 completeDesktopUpgrade(dataRoot,upgradeRecord);
 upgradeRecord={...upgradeRecord,status:'complete'};
 await rpc('desktop-start-runner');
 main.show();
 void resumePendingWechatPersonalTask({root:dataRoot,openTask:task=>openWechatPersonalTask(task,{observeOnly:true})}).catch(error=>console.error('公众号原任务恢复：'+error.message));
 pollTimer=setInterval(()=>void poll(),4000);
 console.log('Guanyin desktop ready: '+origin);
}
async function openWechatPersonalPublisher(input){
 const command=await authorizedWechatCommand(input,rpc);
 if(!command.taskId)throw Error('公众号原任务编号缺失，未打开发布窗口');
 if(wechatPersonalWindow&&!wechatPersonalWindow.isDestroyed()&&wechatPersonalTaskId!==command.taskId)throw Error('当前公众号窗口仍在处理另一篇原稿，请先在该窗口完成或关闭；不会覆盖');
 const task=beginWechatPersonalTask(dataRoot,command);
 if(!wechatPersonalTaskActive(task))throw Error('公众号原任务已有完成回执，请先刷新发布结果；不会重复填稿或发表');
 return openWechatPersonalTask(task);
}
async function resumeWechatPersonalPublisher(input){
 const taskId=String(input?.taskId||'').trim();
 if(!/^gy-[a-f0-9]{64}$/.test(taskId))throw Error('公众号原任务编号无效');
 let task=loadWechatPersonalTask(dataRoot);
 if(!task||task.taskId!==taskId)throw Error('未找到对应公众号原任务；不会新建或重复提交');
 if(!wechatPersonalTaskActive(task))throw Error('公众号原任务已有完成回执，请先刷新发布结果；不会重复填稿或发表');
 const command=await authorizedWechatCommand(input,rpc);
 task=beginWechatPersonalTask(dataRoot,command);
 return openWechatPersonalTask(task);
}
function wechatPersonalBrowserSession(){
 const publisherSession=wechatPersonalSession||session.fromPartition(WECHAT_PERSONAL_PARTITION);wechatPersonalSession=publisherSession;
 publisherSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));publisherSession.setPermissionCheckHandler(()=>false);
 return publisherSession;
}
function secureWechatPersonalWindow(win){
 const wc=win.webContents;
 for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,legacyUrl)=>{const url=e.url||legacyUrl;if(!wechatPersonalUrlAllowed(url))e.preventDefault()});
 wc.on('will-attach-webview',e=>e.preventDefault());wc.setWindowOpenHandler(({url})=>wechatPersonalUrlAllowed(url)?{action:'allow'}:{action:'deny'});
 return wc;
}
function setWechatPersonalLoginState(value){
 const state=['unknown','waiting_login','connected'].includes(value?.state)?value.state:'unknown';
 const messages={unknown:'公众号尚未完成本次应用内登录检查',waiting_login:'请在公众号官方窗口完成登录',connected:'已进入公众号官方管理页；登录状态仅保存在本机'};
 const next={state,message:messages[state],checkedAt:Date.now()};
 const changed=next.state!==wechatPersonalLoginState.state||next.message!==wechatPersonalLoginState.message;
 wechatPersonalLoginState=next;
 if(changed&&main&&!main.isDestroyed())main.webContents.send('guanyin:wechat-personal-login-status',next);
 return next;
}
async function observeWechatPersonalLogin(wc){
 if(!wc||wc.isDestroyed()||!wechatPersonalUrlAllowed(wc.getURL())||wc.isLoadingMainFrame())return wechatPersonalLoginState;
 try{return setWechatPersonalLoginState(await wc.executeJavaScript('('+wechatPersonalLoginPage.toString()+')()',true))}catch{return wechatPersonalLoginState}
}
async function openWechatPersonalLogin(){
 // A first-party login window is deliberately separate from a content task.
 // It shares only the isolated local partition, so a later article can reuse
 // the completed platform login without treating that login as a publication.
 if(wechatPersonalLoginWindow&&!wechatPersonalLoginWindow.isDestroyed()){
  wechatPersonalLoginWindow.show();wechatPersonalLoginWindow.focus();void observeWechatPersonalLogin(wechatPersonalLoginWindow.webContents);return wechatPersonalLoginState;
 }
 const win=new BrowserWindow({width:1100,height:820,title:'观引 · 微信公众号登录',webPreferences:{session:wechatPersonalBrowserSession(),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 wechatPersonalLoginWindow=win;const wc=secureWechatPersonalWindow(win);
 win.on('closed',()=>{wechatPersonalLoginWindow=null;void flushWechatPersonalSession().catch(()=>{})});
 setWechatPersonalLoginState({state:'waiting_login'});
 wc.on('did-finish-load',()=>void observeWechatPersonalLogin(wc));wc.on('did-stop-loading',()=>void observeWechatPersonalLogin(wc));
 await wc.loadURL('https://mp.weixin.qq.com/');
 return wechatPersonalLoginState;
}
async function openWechatPersonalTask(task,{observeOnly=false}={}){
 if(wechatPersonalWindow&&!wechatPersonalWindow.isDestroyed()){
  if(wechatPersonalTaskId!==task.taskId)throw Error('当前公众号窗口仍在处理另一篇原稿，请先完成或关闭；不会覆盖');
  wechatPersonalWindow.show();wechatPersonalWindow.focus();wechatPersonalRun?.(!observeOnly);return {state:'waiting_login',message:'公众号原任务窗口已打开，正在核对原稿与当前授权'};
 }
 const win=new BrowserWindow({width:1100,height:820,title:'观引 · 微信公众号',webPreferences:{session:wechatPersonalBrowserSession(),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 wechatPersonalWindow=win;wechatPersonalTaskId=task.taskId;const wc=secureWechatPersonalWindow(win);
 let attempts=0,busy=false,current=task,allowWrites=!observeOnly;
 const notify=result=>{
  if(!result?.state)return;
  const requested=wechatPersonalRequestMarker(current.requested,result.state);
  current=updateWechatPersonalTask(dataRoot,current.taskId,{state:result.state,message:result.message,requested});
  if(!main.isDestroyed())main.webContents.send('guanyin:wechat-personal-status',{...result,taskId:current.taskId,mode:current.mode});
 };
 const run=async()=>{
  if(busy||win.isDestroyed()||!wechatPersonalUrlAllowed(wc.getURL())||wc.isLoadingMainFrame())return;
  busy=true;try{
   current=loadWechatPersonalTask(dataRoot);
   if(!current||current.taskId!==task.taskId)throw Error('公众号原任务已变化，未继续操作');
   const result=await authorizedWechatStep(current,{request:rpc,observeOnly:!allowWrites,page:command=>wc.executeJavaScript('('+wechatPersonalPage.toString()+')('+JSON.stringify(command)+')',true),persist:patch=>{current=updateWechatPersonalTask(dataRoot,current.taskId,patch);}});
   notify(result);
   if(['ready_to_request','requesting','waiting_receipt','draft_requested','publish_requested','draft_saved','publish_submitted'].includes(result?.state))setWechatPersonalLoginState({state:'connected'});
   if(result?.state==='verification_required')setWechatPersonalLoginState({state:'waiting_login'});
   if(['draft_saved','publish_submitted','verification_required','filled','blocked'].includes(result?.state)){if(wechatPersonalTimer)clearTimeout(wechatPersonalTimer);wechatPersonalTimer=null;return;}
   if(++attempts<20)wechatPersonalTimer=setTimeout(()=>void run(),1000);
  }catch(error){notify({state:'blocked',message:error.message||'公众号授权或页面核对失败，未自动重试'});if(wechatPersonalTimer)clearTimeout(wechatPersonalTimer);wechatPersonalTimer=null;}finally{busy=false}
 };
 wechatPersonalRun=enableWrites=>{if(enableWrites)allowWrites=true;attempts=0;void run();};
 wc.on('did-finish-load',()=>void run());wc.on('did-stop-loading',()=>void run());win.on('closed',()=>{if(wechatPersonalTimer)clearTimeout(wechatPersonalTimer);wechatPersonalTimer=null;wechatPersonalWindow=null;wechatPersonalTaskId='';wechatPersonalRun=null;void flushWechatPersonalSession().catch(()=>{})});
 await wc.loadURL('https://mp.weixin.qq.com/');
 return {state:'waiting_login',message:observeOnly?'已打开公众号原任务，仅核对原页面；尚未发送的任务需重新确认。':task.mode==='publish'?'公众号窗口已打开；本次授权有效且稿件未变化时，完成验证后继续原稿':'公众号窗口已打开；本次授权有效且稿件未变化时，完成验证后继续保存草稿'};
}
function flushWechatPersonalSession(){
 if(!wechatPersonalSession)return Promise.resolve();
 if(!wechatPersonalFlush)wechatPersonalFlush=persistWechatPersonalSession(wechatPersonalSession).finally(()=>{wechatPersonalFlush=null});
 return wechatPersonalFlush;
}
async function getConnection(id){if(typeof id!=='string')throw new Error('账号连接无效');const list=await rpc('desktop-list');const c=list.find(c=>c.sessionId===id);if(!c)throw new Error('账号连接已撤销');return c}
async function control(connection){
 if(controllers.has(connection.sessionId))return controllers.get(connection.sessionId);
 let controller,busy=false,loginUntil=0,paused=false,lastLoginCheck=0;
 const driver=windowDriver({BrowserWindow,session,root:path.join(dataRoot,'accounts',connection.sessionId),connection,partition:publishingPartition(dataRoot,connection),onLoadError(error){if(!controller)return;loginUntil=0;paused=true;void request('connection-state',{state:'error',error}).catch(()=>{})},onLoginRequired(){if(!controller)return;loginUntil=Date.now()+600000;paused=false;void request('connection-state',{state:'needs_login',error:LOGIN_EXPIRED_MESSAGE}).catch(()=>{})},onLoginReady(){if(controller&&(paused||loginUntil)&&!busy&&!driver.loginHeld()){loginUntil=Date.now()+60000;paused=false;void controller.checkLogin()}}});await driver.initialize();paused=driver.loginHeld();
 const request=(action,data)=>rpc('desktop-request',{sessionId:connection.sessionId,action,data});const runtime=createPublisherRuntime(driver.chrome,{request});await runtime.ready;
 async function verify(expected){if(driver.loginHeld())throw new Error(LOGIN_RATE_LIMIT_MESSAGE);if(busy)throw new Error('该账号正在处理原任务，请等待结果');busy=true;try{await runtime.command({action:'verify',platform:connection.platform});const c=await getConnection(connection.sessionId);if(expected&&c.accountId!==expected)throw new Error('登录账号已变化，请在观引重新选择账号');await driver.flushSession();paused=false;loginUntil=0;return true}catch(e){const state=connectionFailureState(e);if(state==='error'){loginUntil=0;paused=true}await request('connection-state',{state,error:e.message}).catch(()=>{});throw e}finally{busy=false}}
 controller={driver,async reconcileOriginal(){if(busy)return;const saved=await driver.chrome.storage.local.get(['inflightByPlatform','inflight']),entry=saved.inflightByPlatform?.[connection.platform]||saved.inflight;if(!entry||entry.job.mode!=='publish')return;const status=await request('job-state',{id:entry.job.id,lease:entry.job.lease});if(!['uncertain','submitting'].includes(status.job?.state))return;busy=true;try{await runtime.reconcile(connection.platform)}finally{busy=false}},async login(){if(busy)throw new Error('原任务正在执行，请等待结果');driver.clearLoginHold();await driver.openLogin();loginUntil=Date.now()+600000;paused=false;await request('connection-state',{state:'awaiting_login'});void controller.checkLogin()},verify,
  async savePrepared(jobId){if(busy||driver.loginHeld())throw Error('账号尚未就绪，请稍后');busy=true;try{if(!driver.showAccount())throw Error('原编辑窗口不存在，未创建新稿');await runtime.command({action:'save-prepared',platform:connection.platform,jobId})}finally{busy=false}},
  async resume(jobId){if(driver.loginHeld())throw Error(LOGIN_RATE_LIMIT_MESSAGE);if(busy)throw Error('原账号任务正在处理中');busy=true;try{await runtime.command({action:'resume',platform:connection.platform,jobId})}finally{busy=false}},
  async checkLogin(){if(busy||!loginUntil)return;if(Date.now()>loginUntil){loginUntil=0;paused=true;await request('connection-state',{state:'needs_login',error:'登录等待已暂停，点击去登录可继续'});return}if(!driver.hasVisibleWindow()){loginUntil=0;await request('connection-state',{state:'needs_login',error:'登录窗口已关闭，可重新打开'});return}lastLoginCheck=Date.now();if(await driver.detectLoginHold()){loginUntil=0;paused=true;await request('connection-state',{state:'needs_login',error:LOGIN_RATE_LIMIT_MESSAGE});return}if(!driver.loginEditorReady())return;try{await verify()}catch{}},
  async tick(){if(busy)return;if(loginUntil){if(Date.now()-lastLoginCheck>4000)await controller.checkLogin();return}if(paused)return;busy=true;try{const saved=await driver.chrome.storage.local.get(['inflightByPlatform','inflight']);if(saved.inflightByPlatform?.[connection.platform]||saved.inflight)await runtime.reconcile(connection.platform);else{const r=await runtime.run(connection.platform);if(r?.error&&!r.hasJob){paused=true;await request('connection-state',{state:connectionFailureState(r.error),error:r.error})}}}finally{busy=false}},close:()=>driver.close()};
 controllers.set(connection.sessionId,controller);return controller;
}
let polling=false;async function poll(){if(polling||stopping)return;polling=true;try{const list=await rpc('desktop-list'),active=new Set(list.map(c=>c.sessionId));for(const [id,c]of controllers)if(!active.has(id)){await c.close();controllers.delete(id)}for(const c of list)await (await control(c)).tick()}catch(e){console.error('发布检查：'+e.message)}finally{polling=false}}
async function stopService(){
 if(stopping)return;stopping=true;clearInterval(pollTimer);
 if(wechatPersonalTimer)clearTimeout(wechatPersonalTimer);if(wechatPersonalWindow&&!wechatPersonalWindow.isDestroyed())wechatPersonalWindow.destroy();if(wechatPersonalLoginWindow&&!wechatPersonalLoginWindow.isDestroyed())wechatPersonalLoginWindow.destroy();const closed=await Promise.allSettled([upcomingPlatform.close(),flushWechatPersonalSession(),...[...controllers.values()].map(c=>c.close())]);if(closed.some(r=>r.status==='rejected'))console.error('部分平台会话保存未完成，账号目录保留');for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('观引已退出，任务未自动重发'))}pending.clear();
 if(service)await new Promise(resolve=>{let done=false,timer;const finish=()=>{if(done)return;done=true;clearTimeout(timer);service?.kill();service=null;resolve()};service.once('exit',finish);timer=setTimeout(finish,3000);try{service.postMessage({id:++sequence,action:'shutdown'})}catch{finish()}});
}
app.on('window-all-closed',()=>app.quit());
