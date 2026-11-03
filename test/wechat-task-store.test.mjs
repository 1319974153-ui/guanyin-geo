import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWechatTaskStore} from '../local/wechat-task-store.mjs';
import {wechatWorkflow} from '../src/wechat-workflow.js';
import {wechatPackage,wechatArticle} from '../src/wechat-core.js';
const scope={owner:'owner',brandId:'brand',accountId:'account'},key=JSON.stringify(Object.values(scope));
const pack=wechatPackage({title:'真实测试',text:'持久化保存后核对原任务。'}),cover={bytes:new Uint8Array([137,80,78,71]),mime:'image/png'};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-task-')),filename=path.join(root,'tasks.sqlite');let clock=1000;const stores=[];
 const open=(s=scope)=>{const store=createWechatTaskStore({filename,scope:s,now:()=>clock,leaseMs:60000});stores.push(store);return store};
 t.after(()=>{for(const s of stores){try{s.close()}catch{}}fs.rmSync(root,{recursive:true,force:true})});
 return{open,filename,tick:()=>clock+=61000};
}
function clients(){let article;const calls=[];return {calls,client:{async uploadCover(){calls.push('upload');return{media_id:'cover'}},async addDraft(a){article=a;calls.push('add');return{media_id:'draft'}},async getDraft(){calls.push('read');return{news_item:[article]}},async submit(){calls.push('submit');return{publish_id:'published'}},async status(){calls.push('status');return{publish_status:0,article_id:'article',article_detail:{item:[{article_url:'https://mp.weixin.qq.com/s/fixture'}]}}}}}
}
const run=(store,client,action,taskId)=>wechatWorkflow({store,client,action,taskId,scope,pack,cover,type:'verified_business',permissions:{draft:true,publish:true}});
test('persistent draft/publication retains original receipt across reopen without duplicate writes',async t=>{
 const f=setup(t),a=f.open(),{client,calls}=clients();const r=await run(a,client,'draft');assert.equal(r.state,'draft');a.close();
 const b=f.open();assert.equal((await run(b,client,'draft')).id,r.id);await run(b,client,'publish',r.id);b.close();
 const c=f.open();assert.equal((await run(c,client,'reconcile',r.id)).state,'platform_published');await run(c,client,'publish',r.id);
 assert.deepEqual(calls,['upload','add','read','read','submit','status']);assert.equal(fs.statSync(f.filename).mode&0o777,0o600);
});
test('separate connections claim once and protect workspace/account scope and immutable snapshots',async t=>{
 const f=setup(t),a=f.open(),b=f.open();const row={id:'r',scope,key,contentHash:'h',pack,state:'ready'};
 const [x,y]=await Promise.all([a.findOrCreate(key,'h',row),b.findOrCreate(key,'h',{...row,id:'r2'})]);assert.equal(x.id,y.id);
 const claimed=await Promise.all([a.claim(x.id,'ready','uploading'),b.claim(x.id,'ready','uploading')]);assert.equal(claimed.filter(Boolean).length,1);
 await assert.rejects(b.save({...x,state:'draft'}),/接管/);
 const current=await a.get(x.id);await assert.rejects(a.save({...current,pack:{...pack,title:'changed'}}),/来源/);
 const other=f.open({...scope,owner:'other'});assert.equal(await other.get(x.id),null);assert.deepEqual(await other.list(),[]);assert.equal(await other.claim(x.id,'uploading','checking'),false);await assert.rejects(other.save(current),/不属于/);
});
test('expired interrupted writes become uncertain; stale response cannot overwrite or resubmit',async t=>{
 const f=setup(t),a=f.open(),{client,calls}=clients(),r=await run(a,client,'draft');await a.claim(r.id,'draft','publishing');const old=await a.get(r.id);
 assert.equal((await run(a,client,'reconcile',r.id)).state,'publishing');f.tick();
 await assert.rejects(run(a,client,'reconcile',r.id),/禁止重发/);
 assert.equal((await a.get(r.id)).publishAttempted,true);await assert.rejects(a.save({...old,state:'submitted',publishId:'late'}),/接管/);
 await run(a,client,'publish',r.id);assert.ok(!calls.includes('submit'));
});
test('crash after numbered draft or publish receipt resumes by read-only calls',async t=>{
 const f=setup(t),a=f.open(),{client,calls}=clients(),r=await run(a,client,'draft');await a.claim(r.id,'draft','checking');f.tick();
 assert.equal((await run(a,client,'reconcile',r.id)).state,'draft');await run(a,client,'publish',r.id);await a.claim(r.id,'submitted','reconciling');f.tick();
 assert.equal((await run(a,client,'reconcile',r.id)).state,'platform_published');assert.equal(calls.filter(x=>x==='submit').length,1);assert.equal(calls.filter(x=>x==='add').length,1);
});
test('crash before draft ID never recreates a potentially written draft',async t=>{
 const f=setup(t),a=f.open();const r=await a.findOrCreate(key,'h',{id:'r',scope,key,contentHash:'h',pack,state:'ready'});await a.claim(r.id,'ready','creating');f.tick();
 const client=new Proxy({},{get(){return()=>assert.fail('must not call platform')}});
 assert.equal((await run(a,client,'reconcile',r.id)).state,'uncertain');
});
