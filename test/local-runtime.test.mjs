import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {localEncryptionKey} from '../local/security.mjs';
import {localBackgroundRunner} from '../local/background-runner.mjs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('fresh installations get distinct durable keys; restarting decrypts the original connection',async t=>{
 const a=directory(t),b=directory(t),key=localEncryptionKey(a);
 assert.notEqual(key,localEncryptionKey(b));assert.equal(localEncryptionKey(a),key);
 assert.equal(fs.statSync(path.join(a,'.encryption-key')).mode&0o777,0o600);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const importKey=value=>crypto.subtle.importKey('raw',Buffer.from(value,'base64'),'AES-GCM',false,['encrypt','decrypt']);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await importKey(key),new TextEncoder().encode('fixture-model-key'));
 assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},await importKey(localEncryptionKey(a)),encrypted)),'fixture-model-key');
 const otherKey=await importKey(localEncryptionKey(b));
 await assert.rejects(()=>crypto.subtle.decrypt({name:'AES-GCM',iv},otherKey,encrypted));
});
test('existing encrypted data never silently gets a replacement key',t=>{
 const dir=directory(t),key=Buffer.alloc(32,7).toString('base64');
 assert.throws(()=>localEncryptionKey(dir,{hasEncryptedData:true}),/恢复/);
 assert.equal(localEncryptionKey(dir,{configured:key,hasEncryptedData:true}),key);
 assert.throws(()=>localEncryptionKey(dir,{configured:Buffer.alloc(32,8).toString('base64')}),/不一致/);
 assert.throws(()=>localEncryptionKey(directory(t),{configured:'invalid'}),/32 字节/);
 assert.equal(fs.readFileSync(path.join(dir,'.encryption-key'),'utf8').trim(),key);
});
test('background execution is opt-in, serialized, restartable and stops dispatching when disabled',async t=>{
 const dir=directory(t);let calls=0,release;
 const runner=localBackgroundRunner(dir,()=>{calls++;return new Promise(resolve=>release=resolve)},{intervalMs:10});
 runner.start();await delay(20);assert.equal(calls,0);
 runner.setEnabled(true);await delay(20);assert.equal(calls,1);
 runner.setEnabled(true);await delay(20);assert.equal(calls,1);
 runner.setEnabled(false);release();await delay(30);assert.equal(calls,1);await runner.stop();
 assert.equal(localBackgroundRunner(dir,()=>{}).status().enabled,false);
 let next=0;const persisted=localBackgroundRunner(dir,async()=>{next++},{intervalMs:10000});
 persisted.setEnabled(true);persisted.start();await delay(10);assert.equal(next,1);await persisted.stop();
 const restarted=localBackgroundRunner(dir,async()=>{next++},{intervalMs:10000});
 assert.equal(restarted.status().enabled,true);restarted.start();await delay(10);assert.equal(next,2);await restarted.stop();
});
test('runner failures are visible without leaking provider error payloads',async t=>{
 const runner=localBackgroundRunner(directory(t),async()=>{throw new Error('private-provider-secret')},{intervalMs:10000});
 runner.setEnabled(true);runner.start();await delay(10);
 assert.match(runner.status().lastError,/未完成/);assert.ok(!JSON.stringify(runner.status()).includes('private-provider-secret'));await runner.stop();
});
function env(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const f of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),GEO_LOCAL_MODE:'true'};}
async function request(e,method='POST',value={enabled:true},headers={}){return worker.fetch(new Request('http://localhost/api/local/runner',{method,headers:{'content-type':'application/json','x-geo-request':'1',...headers},body:JSON.stringify(value)}),e)}
test('runtime control cannot be invoked cross-origin, as a team editor, or on a hosted deployment',async t=>{
 const e=env(t);let changes=0;e.LOCAL_RUNTIME={status:()=>({enabled:false}),setEnabled:enabled=>{changes++;return {enabled}}};
 assert.equal((await request(e,'POST',{enabled:true},{origin:'https://other.example'})).status,403);
 assert.equal((await request(e,'POST',{enabled:'true'})).status,400);
 assert.equal((await request(e,'POST',{enabled:true},{'x-geo-workspace':'other-owner'})).status,403);
 await e.DB.prepare('INSERT INTO members(owner,email,role,brands,created,updated) VALUES(?,?,?,?,?,?)').bind('other-owner','member@test.example','editor','[]','2026-01-01','2026-01-01').run();
 assert.equal((await request(e,'POST',{enabled:true},{'x-geo-workspace':'other-owner','oai-authenticated-user-email':'member@test.example'})).status,403);
 assert.equal(changes,0);assert.equal((await request(e)).status,200);assert.equal(changes,1);
 e.GEO_LOCAL_MODE='false';assert.equal((await request(e,'POST',{enabled:true},{'oai-authenticated-user-id':'owner'})).status,404);
});
