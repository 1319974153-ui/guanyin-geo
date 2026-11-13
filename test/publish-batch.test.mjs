import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(t){
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 t.after(()=>db.close());return {DB:d1Adapter(db),db};
}
async function call(env,path,method='GET',body,actor='owner',headers={}){
 const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':actor,'x-geo-request':'1','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
 return {status:response.status,data:await response.json()};
}
async function seed(env){
 const workspace=(await call(env,'/api/state')).data;
 workspace.state.brands=[{id:'b1',name:'测试品牌'},{id:'b2',name:'其他品牌'}];
 workspace.state.contents=[{id:'c1',brandId:'b1',title:'可核对的发布稿',text:'这是一篇经过审核的真实测试正文。',status:'已审核',ai:true,factSnapshots:[],demo:false}];
 assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 env.db.prepare('INSERT INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run('owner','wordpress:b1',JSON.stringify({brandId:'b1',site:'https://example.org/',username:'author',enabled:true,revision:'connection-v1',verifiedAt:'2026-11-01T00:00:00.000Z',userId:7,canPublish:true}),'not-a-secret','2026-11-01T00:00:00.000Z');
}
function authorization(id='a'){
 return {id:'pa-'+id.repeat(64),brandId:'b1',contentId:'c1',mode:'publish',confirmed:true,expiresAt:new Date(Date.now()+10*60_000).toISOString(),targets:[{platform:'wordpress',accountId:'default'}]};
}
function batch(id='b',authorizationId='pa-'+'a'.repeat(64)){
 return {id:'pb-'+id.repeat(64),brandId:'b1',contentId:'c1',mode:'publish',authorizationId,targets:[{platform:'wordpress',accountId:'default'}]};
}
function claim(id='b',lease='a',stage='draft'){
 return {id:'pb-'+id.repeat(64),brandId:'b1',platform:'wordpress',accountId:'default',stage,leaseId:'pl-'+lease.repeat(64)};
}

test('a publish batch persists one exact approved server-owned intent without contacting a platform',async t=>{
 const env=environment(t);await seed(env);const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected platform contact')};t.after(()=>globalThis.fetch=oldFetch);
 const auth=authorization();assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 const created=await call(env,'/api/publish-batches','POST',batch());
 assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.batch.state,'prepared');assert.equal(created.data.batch.authorizationId,undefined);assert.equal(created.data.batch.targets[0].state,'not_started');assert.match(created.data.batch.targets[0].dispatchId,/^gy-[a-f0-9]{64}$/);
 const replay=await call(env,'/api/publish-batches','POST',batch());assert.equal(replay.status,200);assert.equal(replay.data.existing,true);assert.equal(replay.data.batch.id,created.data.batch.id);
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='publish-batch'").get().n,1);
});

test('batch listing reads the existing durable target receipt without turning it into a public claim',async t=>{
 const env=environment(t);await seed(env);const auth=authorization('c');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 const created=await call(env,'/api/publish-batches','POST',batch('d',auth.id));assert.equal(created.status,200);
 const target=created.data.batch.targets[0];
 env.db.prepare("INSERT INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,'draft',?,?)").run('owner',target.dispatchId,'wordpress','2026-11-10T00:00:00.000Z',JSON.stringify({stage:'draft',error:'',remote:{postId:12,status:'draft',url:'https://example.org/?p=12',publicVerified:false}}));
 const listed=await call(env,'/api/publish-batches?brandId=b1&contentId=c1');assert.equal(listed.status,200);assert.equal(listed.data.batches.length,1);assert.equal(listed.data.batches[0].targets[0].state,'draft');assert.equal(listed.data.batches[0].targets[0].remote.status,'draft');assert.equal(listed.data.batches[0].targets[0].remote.publicVerified,false);
});

test('batch listing marks a persisted intent stale when the reviewed article later changes',async t=>{
 const env=environment(t);await seed(env);const auth=authorization('f');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 assert.equal((await call(env,'/api/publish-batches','POST',batch('b',auth.id))).status,200);
 let listed=await call(env,'/api/publish-batches?brandId=b1&contentId=c1');assert.equal(listed.status,200);assert.equal(listed.data.batches[0].currentRevision,true);
 const workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].text='之后修改过的正文。';assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 listed=await call(env,'/api/publish-batches?brandId=b1&contentId=c1');assert.equal(listed.status,200);assert.equal(listed.data.batches[0].currentRevision,false);
});

test('a changed reviewed content makes the linked authorization stale before a batch is created',async t=>{
 const env=environment(t);await seed(env);const auth=authorization('e');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 const workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].text='已变更的审核稿件。';assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 const result=await call(env,'/api/publish-batches','POST',batch('f',auth.id));assert.equal(result.status,409,JSON.stringify(result.data));assert.match(result.data.error,/稿件|事实依据/);assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='publish-batch'").get().n,0);assert.equal(env.db.prepare('SELECT state FROM runs WHERE id=?').get(auth.id).state,'stale');
});

test('a batch can only reuse the exact authorized image snapshot and one-shot execution policy',async t=>{
 const env=environment(t);await seed(env);
 const media=[{sha256:'a'.repeat(64)}],executionPolicy={frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0};
 const auth={...authorization('a'),media,executionPolicy};assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 const created=await call(env,'/api/publish-batches','POST',{...batch('b',auth.id),media,executionPolicy});
 assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.batch.mediaCount,1);assert.deepEqual(created.data.batch.executionPolicy,executionPolicy);
 const changed=await call(env,'/api/publish-batches','POST',{...batch('c',auth.id),media:[{sha256:'b'.repeat(64)}],executionPolicy});
 assert.equal(changed.status,409);assert.match(changed.data.error,/图片|执行范围/);
 const scheduled=await call(env,'/api/publish-batches','POST',{...batch('d',auth.id),media,executionPolicy:{...executionPolicy,autoRetry:true}});
 assert.equal(scheduled.status,400);assert.match(scheduled.data.error,/单次发布|自动重试/);
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='publish-batch'").get().n,1);
});

test('a batch target claim reserves one exact adapter step without contacting a platform',async t=>{
 const env=environment(t);await seed(env);const oldFetch=globalThis.fetch;let platformCalls=0;globalThis.fetch=async()=>{platformCalls++;throw Error('unexpected platform contact')};t.after(()=>globalThis.fetch=oldFetch);
 const auth=authorization('d');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 assert.equal((await call(env,'/api/publish-batches','POST',batch('e',auth.id))).status,200);
 const first=await call(env,'/api/publish-batches/claim','POST',claim('e','f'));
 assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.existing,false);assert.equal(first.data.lease.stage,'draft');assert.equal(first.data.batch.targets[0].state,'claim_pending');
 const replay=await call(env,'/api/publish-batches/claim','POST',claim('e','f'));
 assert.equal(replay.status,200);assert.equal(replay.data.existing,true);assert.equal(replay.data.lease.id,first.data.lease.id);
 const competing=await call(env,'/api/publish-batches/claim','POST',claim('e','a'));
 assert.equal(competing.status,409);assert.match(competing.data.error,/不会重复提交/);assert.equal(platformCalls,0);
});

test('concurrent target claims cannot both reserve the same account step',async t=>{
 const env=environment(t);await seed(env);const auth=authorization('a');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 assert.equal((await call(env,'/api/publish-batches','POST',batch('b',auth.id))).status,200);
 const results=await Promise.all([call(env,'/api/publish-batches/claim','POST',claim('b','c')),call(env,'/api/publish-batches/claim','POST',claim('b','d'))]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='wordpress'").get().n,0);
});

test('an expired target claim becomes result-unknown and cannot be silently reclaimed',async t=>{
 const env=environment(t);await seed(env);const oldFetch=globalThis.fetch;let platformCalls=0;globalThis.fetch=async()=>{platformCalls++;throw Error('unexpected platform contact')};t.after(()=>globalThis.fetch=oldFetch);
 const auth=authorization('a');assert.equal((await call(env,'/api/publish-authorizations','POST',auth)).status,200);
 assert.equal((await call(env,'/api/publish-batches','POST',batch('b',auth.id))).status,200);
 const row=env.db.prepare("SELECT result FROM runs WHERE owner=? AND id=? AND kind='publish-batch'").get('owner','pb-'+'b'.repeat(64));
 const record=JSON.parse(row.result),key='wordpress\u0000default\u0000draft';record.targetLeases={[key]:{id:'pl-'+'c'.repeat(64),stage:'draft',claimedAt:'2020-01-01T00:00:00.000Z',expiresAt:'2020-01-01T00:03:00.000Z'}};
 env.db.prepare("UPDATE runs SET result=? WHERE owner=? AND id=? AND kind='publish-batch'").run(JSON.stringify(record),'owner','pb-'+'b'.repeat(64));
 const listed=await call(env,'/api/publish-batches?brandId=b1&contentId=c1');
 assert.equal(listed.status,200);assert.equal(listed.data.batches[0].targets[0].state,'result_unknown');assert.match(listed.data.batches[0].targets[0].notice,/不会自动重发/);
 const retry=await call(env,'/api/publish-batches/claim','POST',claim('b','d'));
 assert.equal(retry.status,409);assert.match(retry.data.error,/结果待核对/);assert.equal(platformCalls,0);
});
