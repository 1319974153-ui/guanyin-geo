import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
const owner='owner-A',email='member@unit.test';
function environment(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return{DB:d1Adapter(db),GEO_ENCRYPTION_KEY:btoa('12345678901234567890123456789012')}}
async function request(env,user,path,method='GET',value,headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),'x-geo-request':'1',origin:'https://geo.test','content-type':'application/json',...headers},...(value?{body:JSON.stringify(value)}:{})}),env);return {status:r.status,data:await r.json()}}
async function seed(env){const w=(await request(env,owner,'/api/state')).data;for(const id of ['brand-A','brand-B']){w.state.brands.push({id,name:id,aliases:id});w.state.questions.push({id:id+'-q',brandId:id,text:'如何选型？',version:'v1'});w.state.facts.push({id:id+'-f',brandId:id,key:'定位',value:id+' 的内部产品信息',source:id+'的手册',status:'待确认'});w.state.sourceDocuments.push({id:id+'-d',brandId:id,title:id+'的手册',text:id+'机密原文'});w.state.contents.push({id:id+'-c',brandId:id,title:'标题',text:id+'正文',status:'待审核'});w.state.logs.push({id:id+'-log',brandId:id,message:id+'内部日志'})}w.state.currentBrand='brand-A';assert.equal((await request(env,owner,'/api/state','PUT',w)).status,200);return (await request(env,owner,'/api/state')).data;}
const memberHeaders={'x-geo-workspace':owner,'oai-authenticated-user-email':email};
async function invite(env,role='editor'){assert.equal((await request(env,owner,'/api/manage/members','POST',{email,role,brands:['brand-A']})).status,200)}
async function newKey(env,options={}){const r=await request(env,owner,'/api/manage/keys','POST',{name:'fixture-key',brands:['brand-A'],scopes:['read','write'],dailyLimit:50,days:30,...options});assert.equal(r.status,200);return r.data;}
test('workspace selection uses verified email, isolates unassigned brands, and revocation takes effect',async()=>{
 const env=environment();await seed(env);await invite(env);
 assert.equal((await request(env,'member','/api/state','GET',null,{'x-geo-workspace':owner})).status,403);
 assert.equal((await request(env,'member','/api/state','GET',null,{...memberHeaders,'oai-authenticated-user-email':'other@unit.test'})).status,403);
 const visible=await request(env,'member','/api/state','GET',null,memberHeaders);assert.equal(visible.status,200);assert.deepEqual(visible.data.state.brands.map(b=>b.id),['brand-A']);assert.ok(!JSON.stringify(visible).includes('brand-B'));
 assert.equal((await request(env,'member','/api/import-facts','POST',{brandId:'brand-B',source:'attack',material:'not allowed'},memberHeaders)).status,404);
 assert.equal((await request(env,'member','/api/manage','GET',null,memberHeaders)).status,403);
 assert.equal((await request(env,owner,'/api/manage/members','DELETE',{email})).status,200);
 assert.equal((await request(env,'member','/api/state','GET',null,memberHeaders)).status,403);
});
test('scoped edits preserve hidden assets, cannot escalate approval, and reject injected brand IDs',async()=>{
 const env=environment();await seed(env);await invite(env);
 let w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.contents[0].text='编辑的新稿';w.state.contents[0].status='草稿';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,200);
 let full=(await request(env,owner,'/api/state')).data;assert.equal(full.state.contents.find(x=>x.brandId==='brand-B').text,'brand-B正文');assert.equal(full.state.contents.find(x=>x.brandId==='brand-A').text,'编辑的新稿');
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.contents[0].status='已审核';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.contents.push({id:'attack',brandId:'brand-B',status:'草稿',text:'attack'});assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.facts[0].status='已确认';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 assert.equal((await request(env,'member','/api/connections','POST',{provider:'deepseek',model:'model',key:'FAKE'},memberHeaders)).status,403);
});
test('reviewer can review existing content but cannot replace evidence or generate content; viewer cannot write',async()=>{
 const env=environment();await seed(env);await invite(env,'reviewer');
 let w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.contents[0].status='已审核';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,200);
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.facts[0].value='篡改证据';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 assert.equal((await request(env,'member','/api/sample','POST',{brandId:'brand-A'},memberHeaders)).status,403);
 await invite(env,'viewer');w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.scope='api';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,200);
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.contents[0].text='tamper';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 assert.equal((await request(env,'member','/api/v1/answers','POST',{brandId:'brand-A'},memberHeaders)).status,403);
});
test('API keys enforce brand/scope/request quota, hashed storage, expiration, atomic rotation and revocation',async()=>{
 const env=environment();await seed(env);const k=await newKey(env,{scopes:['read'],dailyLimit:2});const h={authorization:'Bearer '+k.key};
 let r=await request(env,null,'/api/v1/state','GET',null,h);assert.equal(r.status,200);assert.ok(!JSON.stringify(r).includes('brand-B'));
 r=await request(env,null,'/api/v1/answers','POST',{},h);assert.equal(r.status,403);
 assert.equal((await request(env,null,'/api/v1/state','GET',null,h)).status,429);
 const rows=await env.DB.prepare('SELECT * FROM api_keys WHERE owner=?').bind(owner).all();assert.ok(!JSON.stringify(rows).includes(k.key));assert.equal(rows.results[0].digest.length,64);
 const rotated=await newKey(env,{rotateId:k.id});assert.equal((await request(env,null,'/api/v1/state','GET',null,h)).status,401);
 const h2={authorization:'Bearer '+rotated.key};assert.equal((await request(env,null,'/api/state','GET',null,h2)).status,401);
 await request(env,owner,'/api/manage/keys','DELETE',{id:rotated.id});assert.equal((await request(env,null,'/api/v1/state','GET',null,h2)).status,401);
 const exp=await newKey(env);await env.DB.prepare('UPDATE api_keys SET expires=? WHERE id=?').bind('2000-01-01T00:00:00Z',exp.id).run();assert.equal((await request(env,null,'/api/v1/state','GET',null,{authorization:'Bearer '+exp.key})).status,401);
 assert.ok(!JSON.stringify((await request(env,owner,'/api/manage')).data).includes(rotated.key));
});
test('answer ingestion is idempotent, retains public evidence and separates API/Web samples',async()=>{
 const env=environment();await seed(env);const key=await newKey(env),h={authorization:'Bearer '+key.key};
 const data={brandId:'brand-A',questionId:'brand-A-q',externalId:'capture-001',entry:'web',platform:'source-platform',mode:'快速',region:'CN',language:'zh-CN',collectedAt:'2026-09-29T01:00:00Z',text:'brand-A 是一种选项。',citations:[{url:'https://example.com/page',title:'实际引用'}],citationKnown:true,publicSearchProcess:'公开检索词'};
 const a=await request(env,null,'/api/v1/answers','POST',data,h),b=await request(env,null,'/api/v1/answers','POST',data,h);assert.equal(a.status,200);assert.equal(a.data.id,b.data.id);
 assert.equal((await request(env,null,'/api/v1/answers','POST',{...data,brandId:'brand-B',questionId:'brand-B-q'},h)).status,404);
 const w=(await request(env,owner,'/api/state')).data;assert.equal(w.state.answers.length,1);const saved=w.state.answers[0];assert.equal(saved.entry,'web');assert.equal(saved.surface,'import');assert.equal(saved.questionVersion,'v1');assert.equal(saved.publicSearchProcess,'公开检索词');assert.equal(saved.recommendationLabeled,false);
 assert.equal((await request(env,null,'/api/v1/answers','POST',{...data,externalId:'api-001',entry:'api'},h)).status,200);
 assert.equal((await request(env,owner,'/api/state')).data.state.answers.at(-1).surface,'api');
});
test('owner-only backups restore assets with optimistic concurrency and preserve credentials/roles',async()=>{
 const env=environment();await seed(env);await invite(env,'admin');const backup=await request(env,owner,'/api/manage/backups','POST',{label:'原始资料'});assert.equal(backup.status,200);
 assert.equal((await request(env,'member','/api/manage/backups/restore','POST',{id:backup.data.id},memberHeaders)).status,403);
 let w=(await request(env,owner,'/api/state')).data;const oldRevision=w.revision;w.state.contents[0].text='后续改动';await request(env,owner,'/api/state','PUT',w);
 assert.equal((await request(env,owner,'/api/manage/backups/restore','POST',{id:backup.data.id,revision:oldRevision})).status,409);
 w=(await request(env,owner,'/api/state')).data;const restored=await request(env,owner,'/api/manage/backups/restore','POST',{id:backup.data.id,revision:w.revision});assert.equal(restored.status,200);assert.equal(restored.data.state.contents[0].text,'brand-A正文');
 const d=(await request(env,owner,'/api/manage')).data;assert.equal(d.members.length,1);assert.equal(d.backups.length,2);assert.ok(d.audit.some(a=>a.action==='POST /api/manage/backups/restore'&&a.status===409));
 assert.equal((await request(env,'other','/api/manage/backups/download','POST',{id:backup.data.id})).status,404);
});
test('brand deletion requires explicit name, protects a backup and removes only its linked records',async()=>{
 const env=environment();await seed(env);assert.equal((await request(env,owner,'/api/manage/brands/delete','POST',{brandId:'brand-A',confirmName:'wrong'})).status,400);
 const d=await request(env,owner,'/api/manage/brands/delete','POST',{brandId:'brand-A',confirmName:'brand-A'});assert.equal(d.status,200);assert.deepEqual(d.data.state.brands.map(b=>b.id),['brand-B']);assert.ok(d.data.backupId);assert.equal(d.data.state.sourceDocuments.length,1);assert.equal(d.data.state.sourceDocuments[0].brandId,'brand-B');
});
test('server quotas reject oversized asset counts and stop paid calls at the configured daily limit',async()=>{
 const env=environment();await seed(env);const p={brands:2,questions:2,dailyModelCalls:1,platformsPerJob:2,repeatsPerJob:2,jobs:10};assert.equal((await request(env,owner,'/api/manage/policy','PUT',p)).status,200);
 const w=(await request(env,owner,'/api/state')).data;w.state.brands.push({id:'brand-C',name:'超限品牌'});assert.equal((await request(env,owner,'/api/state','PUT',w)).status,429);
 env.GEO_RUNNINGHUB_OWNER_ID=owner;env.GEO_RUNNINGHUB_KEY='FIXTURE_ONLY';env.GEO_RUNNINGHUB_MODEL='fixture';const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'OK'}}]})};
 try{assert.equal((await request(env,owner,'/api/connections/test','POST',{provider:'runninghub',runId:'quota-test-call-0001'})).status,200);assert.equal((await request(env,owner,'/api/connections/test','POST',{provider:'runninghub',runId:'quota-test-call-0002'})).status,429);assert.equal(calls,1)}finally{globalThis.fetch=old}
});
test('editor platform entries persist without allowing brand renames; reviewer manual confirmation round-trips',async()=>{
 const env=environment();await seed(env);await invite(env,'editor');let w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;
 w.state.brands[0].channelUrls={'知乎':'https://zhuanlan.zhihu.com/write'};assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,200);
 w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.brands[0].name='伪造';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,403);
 await invite(env,'reviewer');w=(await request(env,'member','/api/state','GET',null,memberHeaders)).data;w.state.facts[0].status='已确认';w.state.facts[0].confirmationMethod='manual';assert.equal((await request(env,'member','/api/state','PUT',w,memberHeaders)).status,200);
});
