import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(t){
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 t.after(()=>db.close());
 return {DB:d1Adapter(db),db};
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
}

function wordpressConnection(env,{brandId='b1',revision='connection-v1'}={}){
 env.db.prepare('INSERT OR REPLACE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run('owner','wordpress:'+brandId,JSON.stringify({brandId,site:'https://example.org/',username:'author',enabled:true,revision,verifiedAt:'2026-11-01T00:00:00.000Z',userId:7,canPublish:true}),'never-return-this-secret','2026-11-01T00:00:00.000Z');
}

function payload(id='a'){
 return {id:'pa-'+id.repeat(64),brandId:'b1',contentId:'c1',mode:'publish',confirmed:true,expiresAt:new Date(Date.now()+10*60_000).toISOString(),targets:[{platform:'wordpress',accountId:'default'}]};
}

test('an explicit release authorization snapshots the reviewed content and verified server-owned account without contacting a platform',async t=>{
 const env=environment(t);await seed(env);wordpressConnection(env);
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('unexpected platform contact')};t.after(()=>globalThis.fetch=oldFetch);
 const request=payload();
 const created=await call(env,'/api/publish-authorizations','POST',request);
 assert.equal(created.status,200,JSON.stringify(created.data));
 assert.equal(created.data.authorization.state,'authorized');
 assert.equal(created.data.authorization.contentId,'c1');
 assert.equal(created.data.authorization.targets[0].connectionRevision,'connection-v1');
 assert.ok(!JSON.stringify(created.data).includes('never-return-this-secret'));
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='publish-authorization'").get().n,1);
 const replay=await call(env,'/api/publish-authorizations','POST',request);
 assert.equal(replay.status,200);assert.equal(replay.data.existing,true);assert.equal(replay.data.authorization.id,created.data.authorization.id);
 const checked=await call(env,'/api/publish-authorizations/validate','POST',{brandId:'b1',id:request.id});
 assert.equal(checked.status,200,JSON.stringify(checked.data));assert.equal(checked.data.valid,true);
});

test('the authorization fails closed when the exact content or account connection changes',async t=>{
 const env=environment(t);await seed(env);wordpressConnection(env);
 const request=payload('b');assert.equal((await call(env,'/api/publish-authorizations','POST',request)).status,200);
 let workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].text='已经改变的正文，原发布确认不应继续有效。';assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 let result=await call(env,'/api/publish-authorizations/validate','POST',{brandId:'b1',id:request.id});
 assert.equal(result.status,409);assert.match(result.data.error,/稿件|事实依据|账号连接/);
 let stored=env.db.prepare('SELECT state,result FROM runs WHERE id=?').get(request.id);assert.equal(stored.state,'stale');assert.match(JSON.parse(stored.result).invalidReason,/稿件/);

 workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].text='这是一篇经过审核的真实测试正文。';assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 const changed=payload('c');assert.equal((await call(env,'/api/publish-authorizations','POST',changed)).status,200);
 wordpressConnection(env,{revision:'connection-v2'});
 result=await call(env,'/api/publish-authorizations/validate','POST',{brandId:'b1',id:changed.id});
 assert.equal(result.status,409);stored=env.db.prepare('SELECT state,result FROM runs WHERE id=?').get(changed.id);assert.equal(stored.state,'stale');assert.match(JSON.parse(stored.result).invalidReason,/账号|发布/);
});

test('only an owner or admin can create a release authorization, and the record remains brand-scoped',async t=>{
 const env=environment(t);await seed(env);wordpressConnection(env);
 assert.equal((await call(env,'/api/manage/members','POST',{email:'editor@example.com',role:'editor',brands:['b1']})).status,200);
 const editorHeaders={'x-geo-workspace':'owner','oai-authenticated-user-email':'editor@example.com'};
 assert.equal((await call(env,'/api/publish-authorizations','POST',payload('d'),'editor',editorHeaders)).status,403);
 assert.equal((await call(env,'/api/publish-authorizations','POST',{...payload('e'),targets:[{platform:'csdn',accountId:'not-server-owned'}]})).status,400);
 assert.equal((await call(env,'/api/publish-authorizations','POST',{...payload('f'),brandId:'b2'})).status,400);
 const created=await call(env,'/api/publish-authorizations','POST',payload('f'));assert.equal(created.status,200);
 assert.equal((await call(env,'/api/publish-authorizations/validate','POST',{brandId:'b2',id:created.data.authorization.id})).status,404);
});

test('a release authorization freezes one-shot execution policy and media hashes before any platform request',async t=>{
 const env=environment(t);await seed(env);wordpressConnection(env);
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected platform contact')};t.after(()=>globalThis.fetch=oldFetch);
 const media=[{sha256:'a'.repeat(64)}],executionPolicy={frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0};
 const created=await call(env,'/api/publish-authorizations','POST',{...payload('a'),media,executionPolicy});
 assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.authorization.mediaCount,1);assert.deepEqual(created.data.authorization.media,media);assert.deepEqual(created.data.authorization.executionPolicy,executionPolicy);
 const scheduled=await call(env,'/api/publish-authorizations','POST',{...payload('b'),executionPolicy:{...executionPolicy,frequency:'daily'}});
 assert.equal(scheduled.status,400);assert.match(scheduled.data.error,/单次发布|定时任务/);
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='publish-authorization'").get().n,1);
});

test('saved image references, order and version are part of server authorization; missing usage rights cannot authorize',async t=>{
 const env=environment(t);await seed(env);wordpressConnection(env);let workspace=(await call(env,'/api/state')).data;
 const refs=[{id:'am-'+'a'.repeat(64),sha256:'a'.repeat(64),rightsConfirmed:false}];Object.assign(workspace.state.contents[0],{mediaRefs:refs,mediaVersion:1});assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 let result=await call(env,'/api/publish-authorizations','POST',{...payload('a'),media:[{sha256:'a'.repeat(64)}]});assert.equal(result.status,409);assert.match(result.data.error,/有权/);
 workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].mediaRefs[0].rightsConfirmed=true;assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 assert.equal((await call(env,'/api/publish-authorizations','POST',payload('a'))).status,409);
 assert.equal((await call(env,'/api/publish-authorizations','POST',{...payload('b'),media:[{sha256:'a'.repeat(64)}]})).status,200);
 workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].mediaVersion=2;assert.equal((await call(env,'/api/state','PUT',workspace)).status,200);
 result=await call(env,'/api/publish-authorizations/validate','POST',{brandId:'b1',id:payload('b').id});assert.equal(result.status,409);
 workspace=(await call(env,'/api/state')).data;workspace.state.contents[0].mediaRefs[0].dataUrl='secret bytes';assert.equal((await call(env,'/api/state','PUT',workspace)).status,400);
});
