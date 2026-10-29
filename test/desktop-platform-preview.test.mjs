import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {platformPreview,aliyunSecureReturn,aliyunLoginRelay} from '../desktop/platform-preview.mjs';
test('new platform acceptance reuses an isolated window without enabling publication',async()=>{let created=0,window,partition;const loaded=[];class Window{constructor(options){created++;window=this;this.dead=false;this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=f=>this.popup=f}loadURL(u){loaded.push(u);return Promise.resolve()}isDestroyed(){return this.dead}show(){}focus(){}destroy(){this.dead=true}}const session={fromPartition(p){partition=p;return {flushStorageData(){},cookies:{async flushStore(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};const preview=platformPreview({BrowserWindow:Window,session});preview.open();preview.open();assert.equal(created,1);assert.match(partition,/51cto/);assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.options.webPreferences.nodeIntegration,false);assert.deepEqual(loaded,['https://blog.51cto.com/']);let denied=false;window.webContents.emit('will-navigate',{preventDefault(){denied=true}},'https://evil.test');assert.equal(denied,true);window.popup({url:'https://home.51cto.com/index'});window.popup({url:'https://blog.51cto.com.evil.test'});assert.equal(loaded.length,2);await preview.close();assert.equal(window.dead,true)});

test('Alibaba return upgrades only the exact official HTTP host',()=>{
 assert.equal(aliyunSecureReturn('http://developer.aliyun.com/article/new?spm=example'),'https://developer.aliyun.com/article/new?spm=example');
 for(const value of ['http://developer.aliyun.com.evil.test/article/new','http://evil.test','http://user:secret@developer.aliyun.com/','http://developer.aliyun.com:8080/','javascript:alert(1)','https://developer.aliyun.com/'])assert.equal(aliyunSecureReturn(value),null);
});
test('Alibaba navigation and redirects recover securely without opening external hosts',()=>{
 const loaded=[];let win;class Window{constructor(){win=this;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{}}loadURL(u){loaded.push(u);return Promise.resolve()}show(){}focus(){}isDestroyed(){return false}destroy(){}}
 const session={fromPartition(){return {flushStorageData(){},cookies:{async flushStore(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 platformPreview({BrowserWindow:Window,session}).open('aliyun');
 for(const event of ['will-navigate','will-redirect']){let prevented=false;win.webContents.emit(event,{preventDefault(){prevented=true}},'http://developer.aliyun.com/article/new');assert.equal(prevented,true);assert.equal(loaded.at(-1),'https://developer.aliyun.com/article/new')}
 const count=loaded.length;let blocked=false;win.webContents.emit('will-redirect',{preventDefault(){blocked=true}},'http://evil.test/');assert.equal(blocked,true);assert.equal(loaded.length,count);
});

test('Alibaba SMS relay allows only the observed HTTPS login path',()=>{
 assert.equal(aliyunLoginRelay('https://account-s.aliyun.com/pass/adding?relay=opaque'),true);
 for(const url of ['http://account-s.aliyun.com/pass/adding','https://account-s.aliyun.com.evil.test/pass/adding','https://account-s.aliyun.com/other','https://user:secret@account-s.aliyun.com/pass/adding','https://account-s.aliyun.com:8443/pass/adding'])assert.equal(aliyunLoginRelay(url),false);
});
test('Alibaba observed SMS redirect is permitted using current Electron details.url',()=>{
 let win;class Window{constructor(){win=this;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{}}loadURL(){return Promise.resolve()}show(){}focus(){}isDestroyed(){return false}destroy(){}}
 const session={fromPartition(){return {flushStorageData(){},cookies:{async flushStore(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 const preview=platformPreview({BrowserWindow:Window,session});preview.open('aliyun');let blocked=false;
 win.webContents.emit('will-redirect',{url:'https://account-s.aliyun.com/pass/adding?relay=opaque',preventDefault(){blocked=true}});assert.equal(blocked,false);
 win.webContents.emit('will-redirect',{url:'https://account-s.aliyun.com/unknown',preventDefault(){blocked=true}});assert.equal(blocked,true);
 preview.open('51cto');blocked=false;win.webContents.emit('will-redirect',{url:'https://account-s.aliyun.com/pass/adding',preventDefault(){blocked=true}});assert.equal(blocked,true);
});

test('Alibaba regional SMS relay is exact HTTPS path only, never a broad cloud allowlist',()=>{
 assert.equal(aliyunLoginRelay('https://account-cn-s.alibabacloud.com/pass/adding?relay=opaque'),true);
 for(const url of ['http://account-cn-s.alibabacloud.com/pass/adding','https://account-cn-s.alibabacloud.com/other','https://account-cn-s.alibabacloud.com.evil.test/pass/adding','https://user:secret@account-cn-s.alibabacloud.com/pass/adding','https://account-cn-s.alibabacloud.com:8443/pass/adding','https://other.alibabacloud.com/pass/adding'])assert.equal(aliyunLoginRelay(url),false);
});

test('SegmentFault official login retains its own session and never grants unrelated host navigation',()=>{
 const windows=[],partitions=[];class Window{constructor(options){this.options=options;this.loaded=[];this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=f=>this.popup=f;windows.push(this)}loadURL(u){this.loaded.push(u);return Promise.resolve()}isDestroyed(){return false}show(){}focus(){}destroy(){}}
 const session={fromPartition(p){partitions.push(p);return {flushStorageData(){},cookies:{async flushStore(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 const preview=platformPreview({BrowserWindow:Window,session});preview.open('segmentfault');preview.open('segmentfault');preview.open('aliyun');
 assert.equal(windows.length,2);assert.deepEqual(partitions,['persist:guanyin-platform-segmentfault-acceptance','persist:guanyin-platform-aliyun-acceptance']);
 const win=windows[0];assert.deepEqual(win.loaded,['https://segmentfault.com/user/login']);assert.equal(win.options.webPreferences.sandbox,true);
 for(const url of ['https://segmentfault.com.evil.test/user/login','https://sub.segmentfault.com/','http://segmentfault.com/','https://user:password@segmentfault.com/','https://segmentfault.com:8080/','https://account.aliyun.com/']){let blocked=false;win.webContents.emit('will-navigate',{url,preventDefault(){blocked=true}});assert.equal(blocked,true);win.popup({url});assert.equal(win.loaded.length,1)}
 let blocked=false;win.webContents.emit('will-navigate',{url:'https://segmentfault.com/',preventDefault(){blocked=true}});assert.equal(blocked,false);
});
