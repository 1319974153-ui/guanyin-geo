import test from 'node:test';
import assert from 'node:assert/strict';
import {flushSessionStore} from '../desktop/session-store.mjs';
import {platformPreview} from '../desktop/platform-preview.mjs';
import {EventEmitter} from 'node:events';

test('store flush waits for Chromium without reading or rewriting credentials',async()=>{
 let finish;const calls=[];
 const store={flushStorageData(){calls.push('storage')},cookies:{flushStore(){calls.push('cookies');return new Promise(r=>finish=r)},get(){throw Error('must not read credentials')},set(){throw Error('must not extend expiry')}}};
 let complete=false;const p=flushSessionStore(store).then(()=>complete=true);
 await Promise.resolve();assert.equal(complete,false);assert.deepEqual(calls,['storage','cookies']);finish();await p;assert.equal(complete,true);
});
test('failed and hung storage writes return bounded sanitized failure',async()=>{
 for(const flushStore of [()=>Promise.reject(Error('sensitive-platform-detail')),()=>new Promise(()=>{})]){
  await assert.rejects(flushSessionStore({flushStorageData(){},cookies:{flushStore}},{timeoutMs:10}),{message:'本机会话保存未完成，账号目录保留'});
 }
});
test('acceptance preview waits for every isolated store even after its window closes',async()=>{
 const stores=[],windows=[];let release;
 class Window{constructor(){this.dead=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};windows.push(this)}loadURL(){return Promise.resolve()}isDestroyed(){return this.dead}show(){}focus(){}destroy(){this.dead=true}}
 const session={fromPartition(partition){const s={partition,flushed:false,flushStorageData(){},cookies:{flushStore(){s.flushed=true;return partition.includes('aliyun')?new Promise(r=>release=r):Promise.resolve()}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}};stores.push(s);return s}};
 const p=platformPreview({BrowserWindow:Window,session});p.open('aliyun');p.open('51cto');windows[0].destroy();let done=false;const closing=p.close().then(()=>done=true);await Promise.resolve();assert.equal(done,false);assert.ok(windows.every(w=>w.dead));assert.ok(stores.every(s=>s.flushed));release();await closing;assert.equal(done,true);
});
