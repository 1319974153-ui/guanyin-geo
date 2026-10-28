import {asciiProductUserAgent} from './user-agent.mjs';
import {publishingPartition} from './preview-adoption.mjs';
import {platformPreview} from './platform-preview.mjs';
import {publicProof} from './public-proof.mjs';
import {app,BrowserWindow,ipcMain,utilityProcess,session,dialog,shell,Menu,MenuItem} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {createPublisherRuntime} from '../browser-extension/runtime.js';
import {windowDriver} from './window-driver.mjs';
import {LOGIN_RATE_LIMIT_MESSAGE,LOGIN_EXPIRED_MESSAGE} from './login-state.mjs';
import {trustedFrame,connectionInput,targetInput} from './security.mjs';
import {installQuitFlow} from './quit-flow.mjs';
import {desktopDataRoot} from './data-root.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),bundleRoot=path.resolve(here,'..');
app.setName('观引桌面版');
app.userAgentFallback=asciiProductUserAgent(app.userAgentFallback);
const dataRoot=desktopDataRoot({args:process.argv,env:process.env,isPackaged:app.isPackaged,appData:app.getPath('appData')});
fs.mkdirSync(dataRoot,{recursive:true,mode:0o700});app.setPath('userData',dataRoot);
let main,service,origin,stopping=false,sequence=0,pollTimer;const pending=new Map(),controllers=new Map();
const upcomingPlatform=platformPreview({BrowserWindow,session});
const bindMainQuit=installQuitFlow({app,getMain:()=>main,confirmDiscard:win=>dialog.showMessageBoxSync(win,{type:'question',title:'退出观引',message:'当前页面有未保存的修改。',detail:'继续编辑可先保存；退出只会放弃当前页面尚未保存的修改，已保存的稿件、账号和回执保留。',buttons:['继续编辑','放弃修改并退出'],defaultId:0,cancelId:0})===1,shutdown:stopService});
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',()=>{if(main){main.show();main.focus()}});
 app.whenReady().then(start).catch(e=>{dialog.showErrorBox('观引启动失败',e.message);app.quit()});
}
function rpc(action,data){if(!service||stopping)return Promise.reject(new Error('本机服务未就绪'));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('本机服务响应超时，未自动重试'))},15000);pending.set(id,{resolve,reject,timer});service.postMessage({id,action,data})})}
async function freePort(preferred){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>{preferred?freePort(0).then(resolve,reject):reject(new Error('找不到可用本机端口'))});s.listen(preferred||0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})}
async function start(){
 const portFile=path.join(dataRoot,'port.json');let previous=0;try{previous=JSON.parse(fs.readFileSync(portFile)).port}catch{}
 const port=await freePort(Number.isInteger(previous)&&previous>1024&&previous<65536?previous:0);origin='http://127.0.0.1:'+port;fs.writeFileSync(portFile,JSON.stringify({port}),{mode:0o600});
 const env=Object.fromEntries(['PATH','HOME','USERPROFILE','SYSTEMROOT','TEMP','TMP','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const serverFile=fs.existsSync(path.join(here,'server.mjs'))?path.join(here,'server.mjs'):path.join(bundleRoot,'dev-server.mjs');
 service=utilityProcess.fork(serverFile,[],{cwd:fs.existsSync(path.join(here,'drizzle'))?here:bundleRoot,env:{...env,GEO_PORT:String(port),GEO_DATA_DIR:path.join(dataRoot,'business'),GEO_SOCIAL_PUBLISH_EXPERIMENTAL:'0',GEO_SOCIAL_PUBLISH_PLATFORMS:'csdn,zhihu,tencentcloud,51cto'},stdio:'pipe',serviceName:'观引本机服务'});
 service.stdout?.on('data',b=>process.stdout.write(b));service.stderr?.on('data',b=>process.stderr.write(b));
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('本机服务启动超时')),30000);service.on('message',m=>{if(m.publicProofId){void publicProof({BrowserWindow,session},m.job).then(verified=>{if(!stopping)service?.postMessage({publicProofId:m.publicProofId,verified})}).catch(()=>{});return}if(m.ready){clearTimeout(timer);resolve()}else if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}});service.once('exit',()=>{clearTimeout(timer);reject(new Error('本机服务已退出'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('服务已中断，任务未自动重发'))}pending.clear();if(!stopping&&main)dialog.showErrorBox('观引服务已停止','请退出并重新打开观引。未确认的发布不会自动重发。')})});
 await ready;
 const menu=Menu.getApplicationMenu();if(menu){menu.append(new MenuItem({label:'平台接入验收',submenu:[{label:'思否登录与编辑器验收',click:()=>upcomingPlatform.open('segmentfault')},{label:'51CTO 登录与编辑器验收',click:()=>upcomingPlatform.open()},{label:'阿里云开发者社区登录验收',click:()=>upcomingPlatform.open('aliyun')}]}));Menu.setApplicationMenu(menu)}
 main=new BrowserWindow({width:1280,height:900,minWidth:800,minHeight:600,title:'观引 · 品牌工作台',webPreferences:{preload:path.join(here,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 main.webContents.on('will-navigate',(e,url)=>{try{if(new URL(url).origin!==origin)e.preventDefault()}catch{e.preventDefault()}});main.webContents.on('will-attach-webview',e=>e.preventDefault());main.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password)void shell.openExternal(u.href)}catch{}return {action:'deny'}});main.webContents.session.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
 const bind=(name,fn)=>ipcMain.handle('guanyin:'+name,(event,value)=>{if(!trustedFrame(event,main.webContents,origin))throw new Error('仅观引主窗口可执行此操作');return fn(value)});
 bind('connect',async input=>{const c=await rpc('desktop-connect',connectionInput(input)),controller=await control(c);await controller.login();return {sessionId:c.sessionId,waitingForLogin:true}});
 bind('open-receipt',async input=>{if(!input||typeof input.jobId!=='string'||!/^[-\w]{1,100}$/.test(input.jobId))throw Error('原稿编号无效');const c=await getConnection(input.sessionId),target=await rpc('desktop-request',{sessionId:c.sessionId,action:'receipt-target',data:{jobId:input.jobId}});(await control(c)).driver.openReceipt(target.url);return {ok:true}});
 bind('open-account',async id=>{const c=await getConnection(id),controller=await control(c);if(!controller.driver.showOriginal())await controller.login();return {ok:true}});
 bind('prepare',async input=>{for(const t of targetInput(input)){const c=await getConnection(t.sessionId),controller=await control(c);await controller.verify(t.accountId)}return {ok:true}});
 bind('resume',async input=>{const t=targetInput([input])[0];if(typeof input.jobId!=='string'||!/^[-\w]{1,100}$/.test(input.jobId))throw Error('原任务无效');const c=await getConnection(t.sessionId);if(c.accountId!==t.accountId)throw Error('账号已变化');const controller=await control(c);await controller.resume(input.jobId);return {ok:true}});
 bind('wake',async()=>{void poll();return {ok:true}});
 bindMainQuit(main);await main.loadURL(origin+'/#today');
 for(const c of await rpc('desktop-list'))await control(c);
 pollTimer=setInterval(()=>void poll(),4000);
 console.log('Guanyin desktop ready: '+origin);
}
async function getConnection(id){if(typeof id!=='string')throw new Error('账号连接无效');const list=await rpc('desktop-list');const c=list.find(c=>c.sessionId===id);if(!c)throw new Error('账号连接已撤销');return c}
async function control(connection){
 if(controllers.has(connection.sessionId))return controllers.get(connection.sessionId);
 let controller,busy=false,loginUntil=0,paused=false,lastLoginCheck=0;
 const driver=windowDriver({BrowserWindow,session,root:path.join(dataRoot,'accounts',connection.sessionId),connection,partition:publishingPartition(dataRoot,connection),onLoadError(error){if(!controller)return;loginUntil=0;paused=true;void request('connection-state',{state:'error',error}).catch(()=>{})},onLoginRequired(){if(!controller)return;loginUntil=Date.now()+600000;paused=false;void request('connection-state',{state:'needs_login',error:LOGIN_EXPIRED_MESSAGE}).catch(()=>{})},onLoginReady(){if(controller&&(paused||loginUntil)&&!busy&&!driver.loginHeld()){loginUntil=Date.now()+60000;paused=false;void controller.checkLogin()}}});await driver.initialize();paused=driver.loginHeld();
 const request=(action,data)=>rpc('desktop-request',{sessionId:connection.sessionId,action,data});const runtime=createPublisherRuntime(driver.chrome,{request});await runtime.ready;
 async function verify(expected){if(driver.loginHeld())throw new Error(LOGIN_RATE_LIMIT_MESSAGE);if(busy)throw new Error('该账号正在处理原任务，请等待结果');busy=true;try{await runtime.command({action:'verify',platform:connection.platform});const c=await getConnection(connection.sessionId);if(expected&&c.accountId!==expected)throw new Error('登录账号已变化，请在观引重新选择账号');paused=false;loginUntil=0;return true}catch(e){const network=e.message.startsWith('平台页面未加载：');if(network){loginUntil=0;paused=true}await request('connection-state',{state:network?'error':'needs_login',error:e.message}).catch(()=>{});throw e}finally{busy=false}}
 controller={driver,async login(){if(busy)throw new Error('原任务正在执行，请等待结果');driver.clearLoginHold();await driver.openLogin();loginUntil=Date.now()+600000;paused=false;await request('connection-state',{state:'awaiting_login'});void controller.checkLogin()},verify,
  async resume(jobId){if(driver.loginHeld())throw Error(LOGIN_RATE_LIMIT_MESSAGE);if(busy)throw Error('原账号任务正在处理中');busy=true;try{await runtime.command({action:'resume',platform:connection.platform,jobId})}finally{busy=false}},
  async checkLogin(){if(busy||!loginUntil)return;if(Date.now()>loginUntil){loginUntil=0;paused=true;await request('connection-state',{state:'needs_login',error:'登录等待已暂停，点击去登录可继续'});return}if(!driver.hasVisibleWindow()){loginUntil=0;await request('connection-state',{state:'needs_login',error:'登录窗口已关闭，可重新打开'});return}lastLoginCheck=Date.now();if(await driver.detectLoginHold()){loginUntil=0;paused=true;await request('connection-state',{state:'needs_login',error:LOGIN_RATE_LIMIT_MESSAGE});return}if(!driver.loginEditorReady())return;try{await verify()}catch{}},
  async tick(){if(busy)return;if(loginUntil){if(Date.now()-lastLoginCheck>4000)await controller.checkLogin();return}if(paused)return;busy=true;try{const saved=await driver.chrome.storage.local.get(['inflightByPlatform','inflight']);if(saved.inflightByPlatform?.[connection.platform]||saved.inflight)await runtime.reconcile(connection.platform);else{const r=await runtime.run(connection.platform);if(r?.error&&!r.hasJob){paused=true;await request('connection-state',{state:'needs_login',error:r.error})}}}finally{busy=false}},close:()=>driver.close()};
 controllers.set(connection.sessionId,controller);return controller;
}
let polling=false;async function poll(){if(polling||stopping)return;polling=true;try{const list=await rpc('desktop-list'),active=new Set(list.map(c=>c.sessionId));for(const [id,c]of controllers)if(!active.has(id)){c.close();controllers.delete(id)}for(const c of list)await (await control(c)).tick()}catch(e){console.error('发布检查：'+e.message)}finally{polling=false}}
async function stopService(){
 if(stopping)return;stopping=true;clearInterval(pollTimer);upcomingPlatform.close();
 for(const c of controllers.values())c.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('观引已退出，任务未自动重发'))}pending.clear();
 if(service)await new Promise(resolve=>{let done=false,timer;const finish=()=>{if(done)return;done=true;clearTimeout(timer);service?.kill();service=null;resolve()};service.once('exit',finish);timer=setTimeout(finish,3000);try{service.postMessage({id:++sequence,action:'shutdown'})}catch{finish()}});
}
app.on('window-all-closed',()=>app.quit());
