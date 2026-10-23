import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {windowDriver} from '../desktop/window-driver.mjs';
import {LOGIN_URLS,loginReturned} from '../desktop/security.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-desktop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const windows=[],partitions=[];
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.visible=options.show;windows.push(this);const wc=this.webContents=new EventEmitter();wc.url='';wc.getURL=()=>wc.url;wc.isLoadingMainFrame=()=>false;wc.loadURL=u=>this.loadURL(u);wc.setWindowOpenHandler=f=>wc.open=f;wc.executeJavaScript=async s=>{wc.lastScript=s;return {accountId:'fixture'}};}
  async loadURL(url){this.webContents.url=url;queueMicrotask(()=>this.webContents.emit('did-navigate',{},url))}isDestroyed(){return !!this.closed}isVisible(){return this.visible}show(){this.visible=true}focus(){}destroy(){this.closed=true;this.emit('closed')}
 }
 const session={fromPartition:p=>{partitions.push(p);return {setPermissionRequestHandler(f){this.permission=f},setPermissionCheckHandler(f){this.check=f}}}};
 const connection={sessionId:'session-a',platform:'toutiao'},create=(c,extra={})=>windowDriver({BrowserWindow:Window,session,root,connection:c||connection,...extra});return {root,windows,partitions,create,connection};
}
test('desktop login has no page privileges, returns to editor automatically, and retains its own private session',async t=>{
 const x=fixture(t),d=x.create();await d.initialize();await d.openLogin();assert.equal(x.windows.length,1);const w=x.windows[0];assert.equal(w.webContents.url,LOGIN_URLS.toutiao);assert.equal(d.loginEditorReady(),false);
 assert.deepEqual([w.options.webPreferences.nodeIntegration,w.options.webPreferences.contextIsolation,w.options.webPreferences.sandbox],[false,true,true]);assert.equal(w.options.webPreferences.preload,undefined);assert.equal(w.options.webPreferences.session.check(),false);
 let permission;w.options.webPreferences.session.permission(null,'camera',v=>permission=v);assert.equal(permission,false);
 await w.loadURL('https://mp.toutiao.com/profile_v4/index');await new Promise(r=>setImmediate(r));assert.equal(d.loginEditorReady(),true);assert.match(w.webContents.url,/graphic\/publish/);
 await d.openLogin();assert.equal(x.windows.length,1);const id=(await d.chrome.storage.local.get('editorTab:toutiao'))['editorTab:toutiao'];assert.ok(id);
 d.close();const restored=x.create();await restored.initialize();const tab=await restored.chrome.tabs.get(id);assert.equal(tab.id,id);assert.equal(x.windows.at(-1).visible,false);assert.equal(x.partitions[0],x.partitions[1]);
 assert.equal(fs.statSync(path.join(x.root,'executor.json')).mode&0o777,0o600);
});
test('external navigation is rejected and scripts cannot run on login or foreign origins',async t=>{
 const x=fixture(t),d=x.create();await d.openLogin();const w=x.windows[0];let prevented=false;w.webContents.emit('will-navigate',{preventDefault:()=>prevented=true},'https://evil.test');assert.equal(prevented,true);
 assert.equal(w.webContents.open({url:'file:///secret'}).action,'deny');assert.equal(x.windows.length,1);
 const tab=await d.chrome.tabs.create({url:'https://byteacct.com/login',active:true});await assert.rejects(d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>true,args:[]}),/登录完成/);
 await assert.rejects(d.chrome.tabs.create({url:'https://evil.test/'}),/阻止/);
});
test('login recovery never replaces an in-flight original editor',async t=>{
 const x=fixture(t),d=x.create();await d.chrome.storage.local.set({'editorTab:toutiao':44,inflightByPlatform:{toutiao:{tabId:44,job:{id:'original'}}}});await d.openLogin();assert.equal((await d.chrome.storage.local.get('editorTab:toutiao'))['editorTab:toutiao'],44);
 for(const p of ['csdn','toutiao','zhihu']){assert.equal(loginReturned(p,'https://evil.test/'),false);assert.equal(loginReturned(p,LOGIN_URLS[p].replace('https:','http:')),false)}
});

test('late login signals readiness only from its own editor window, without writing content',async t=>{
 const x=fixture(t);let signals=0;const d=x.create(null,{onLoginReady:()=>signals++});await d.openLogin();const login=x.windows[0];
 login.webContents.emit('did-finish-load');assert.equal(signals,0);
 await login.loadURL('https://mp.toutiao.com/profile_v4/graphic/publish');login.webContents.emit('did-finish-load');assert.equal(signals,1);
 await d.chrome.tabs.create({url:'https://mp.toutiao.com/profile_v4/graphic/publish',active:true});x.windows[1].webContents.emit('did-finish-load');assert.equal(signals,1);
 login.webContents.emit('did-navigate-in-page',{},login.webContents.url,false);assert.equal(signals,1);
 login.webContents.emit('did-navigate-in-page',{},login.webContents.url,true);assert.equal(signals,2);
 assert.equal(login.webContents.lastScript,undefined);
});


test('open original shows the journal window without login or creating a second draft',async t=>{
 const x=fixture(t),d=x.create();assert.equal(d.showOriginal(),false);
 const original=await d.chrome.tabs.create({url:'https://mp.toutiao.com/profile_v4/graphic/publish',active:false});
 await d.chrome.storage.local.set({inflightByPlatform:{toutiao:{tabId:original.id,job:{id:'same-job'}}}});
 assert.equal(d.showOriginal(),true);assert.equal(x.windows.length,1);assert.equal(x.windows[0].visible,true);
 assert.equal(x.windows[0].webContents.lastScript,undefined);
});

test('Douyin desktop login stays in its own session and reaches the supported editor',async t=>{
 const x=fixture(t),d=x.create({sessionId:'douyin-session',platform:'douyin'});await d.openLogin();
 const w=x.windows[0];assert.equal(w.webContents.url,LOGIN_URLS.douyin);
 await w.loadURL('https://creator.douyin.com/creator-micro/home');await new Promise(r=>setImmediate(r));
 assert.equal(d.loginEditorReady(),true);assert.match(w.webContents.url,/content\/upload$/);
 assert.equal(w.options.webPreferences.preload,undefined);assert.equal(w.options.webPreferences.nodeIntegration,false);
});

test('login rate limit persists across restart and only explicit user retry clears it',async t=>{
 const x=fixture(t),d=x.create({sessionId:'douyin-session',platform:'douyin'});await d.openLogin();
 let reads=0;const w=x.windows[0];w.webContents.executeJavaScript=async()=>{reads++;return 'rate_limited'};
 assert.equal(await d.detectLoginHold(),true);assert.equal(d.loginHeld(),true);
 assert.equal(await d.detectLoginHold(),true);assert.equal(reads,1);
 await d.openLogin();assert.equal(x.windows.length,1);assert.equal(d.loginHeld(),true);
 d.close();const restored=x.create({sessionId:'douyin-session',platform:'douyin'});
 assert.equal(restored.loginHeld(),true);assert.equal(await restored.detectLoginHold(),true);assert.equal(x.windows.length,1);
 restored.clearLoginHold();assert.equal(restored.loginHeld(),false);
 assert.equal(await restored.detectLoginHold(),false);assert.equal(x.windows.length,1);
});
test('unavailable login inspection does not invent a platform rate-limit result',async t=>{
 const x=fixture(t),d=x.create();await d.openLogin();x.windows[0].webContents.executeJavaScript=async()=>{throw Error('closed')};
 assert.equal(await d.detectLoginHold(),false);assert.equal(d.loginHeld(),false);
});


test('Tencent native body entry is bound to the isolated owned editor and only fill action',async t=>{
 const x=fixture(t),d=x.create({sessionId:'tencent-1',platform:'tencentcloud'});const tab=await d.chrome.tabs.create({url:'https://cloud.tencent.com/developer/article/write-new',active:false});
 const wc=x.windows[0].webContents;let inserted=[];wc.insertText=async text=>inserted.push(text);wc.executeJavaScript=async()=>({nativeInsertText:'确认稿件'});
 const r=await d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>null,args:[{action:'fill'}]});assert.equal(r[0].result.filled,true);assert.deepEqual(inserted,['确认稿件']);
 await d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>null,args:[{action:'receipt'}]});assert.equal(inserted.length,1);
 wc.url='https://evil.test';await assert.rejects(d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>null,args:[{action:'fill'}]}),/登录完成/);assert.equal(inserted.length,1);
});

test('51CTO native title precedes body and aborts if title acknowledgement fails',async t=>{
 const x=fixture(t),d=x.create({sessionId:'fifty-title',platform:'51cto'});const tab=await d.chrome.tabs.create({url:'https://blog.51cto.com/blogger/publish?old=1',active:false});const wc=x.windows[0].webContents,inserted=[];
 wc.insertText=async text=>inserted.push(text);let calls=0;wc.executeJavaScript=async()=>++calls===1?{nativeInsertTitle:'图片稿标题'}:{nativeInsertText:'完整正文'};
 const r=await d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>null,args:[{action:'fill'}]});assert.equal(r[0].result.filled,true);assert.deepEqual(inserted,['图片稿标题','完整正文']);
 calls=0;inserted.length=0;wc.executeJavaScript=async()=>++calls===1?{nativeInsertTitle:'图片稿标题'}:{connectorError:'标题未确认'};
 const stopped=await d.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>null,args:[{action:'fill'}]});assert.equal(stopped[0].result.connectorError,'标题未确认');assert.deepEqual(inserted,['图片稿标题']);
});
