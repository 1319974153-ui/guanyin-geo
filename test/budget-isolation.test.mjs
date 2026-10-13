import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {reserveBudget,settleBudget,validateBudget} from '../src/budget.js';
import {makeReport} from '../src/analytics-core.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64')}}
async function call(e,path,method='GET',body,user='alice',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}];w.state.questions=[{id:'q1',brandId:'a',text:'有什么产品？',version:'v1'},{id:'q2',brandId:'b',text:'另一个问题',version:'v1'}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
const capture={brandId:'a',questionId:'q1',externalId:'trial-1',platform:'腾讯元宝',entry:'web',mode:'未记录',region:'未记录',language:'zh-CN',collectedAt:'2026-09-29T01:00:00Z',text:'Alpha synthetic test',citations:[],dataPurpose:'trial'};
const cfg={enabled:true,dailyCny:0.01,rates:[{provider:'deepseek',model:'test-model',inputCny:1,outputCny:1}]};
test('trial captures are kept readable but excluded from metrics and cannot become formal or a retest baseline',async()=>{
 const e=env();await seed(e);const result=await call(e,'/api/v1/answers','POST',capture);assert.equal(result.status,200,JSON.stringify(result));const w=(await call(e,'/api/state')).data;assert.equal(w.state.answers[0].demo,true);assert.equal(makeReport(w.state,'a',{period:'all'}).metrics.n,0);
 assert.equal((await call(e,'/api/v1/answers','POST',{...capture,dataPurpose:'formal'})).status,409);
 assert.equal((await call(e,'/api/v1/answers','POST',{...capture,dataPurpose:'formal',externalId:'second',baselineAnswerId:result.data.id,collectedAt:'2026-09-30T01:00:00Z'})).status,400);
 w.state.answers[0].demo=false;assert.equal((await call(e,'/api/state','PUT',w)).status,400);
 assert.equal((await call(e,'/api/v1/answers','POST',{...capture,externalId:'invalid',dataPurpose:'anything'})).status,400);
});
test('simultaneous calls atomically reserve budget; uncertain outcomes keep reserved spend and other owners stay separate',async()=>{
 const e=env();assert.equal((await call(e,'/api/budget','PUT',cfg)).status,200);
 const req={messages:[{role:'user',content:'test'}]},result=await Promise.allSettled(Array.from({length:6},()=>reserveBudget(e,'alice','deepseek','test-model',req)));
 const ok=result.filter(r=>r.status==='fulfilled');assert.equal(ok.length,2);assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.status===429).length,4);
 await settleBudget(e,ok[0].value,null);await settleBudget(e,ok[1].value,{prompt_tokens:100,completion_tokens:200});
 const view=(await call(e,'/api/budget')).data;assert.equal(view.records.filter(r=>r.state==='uncertain').length,1);assert.equal(view.records.filter(r=>r.state==='estimated').length,1);assert.ok(view.usedCny>0.004&&view.usedCny<0.01);
 const other=(await call(e,'/api/budget','GET',undefined,'bob')).data;assert.equal(other.records.length,0);assert.equal(other.config.enabled,false);
 await assert.rejects(reserveBudget(e,'alice','deepseek','unknown',req),{status:429});
 for(const patch of [{dailyCny:-1},{rates:[{...cfg.rates[0],inputCny:NaN}]},{rates:[cfg.rates[0],{...cfg.rates[0],model:' test-model '}]}])assert.throws(()=>validateBudget({...cfg,...patch}),{status:400});
});
test('request budget applies to actual model gateway before fetch and failures keep charges uncertain',async()=>{
 const e=env();await call(e,'/api/connections','POST',{provider:'deepseek',model:'test-model',key:'test-only-not-a-real-secret'});await call(e,'/api/budget','PUT',{...cfg,rates:[{...cfg.rates[0],inputCny:100,outputCny:100}]});
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1}})};
 try{
  const blocked=await call(e,'/api/connections/test','POST',{provider:'deepseek',runId:crypto.randomUUID()});assert.equal(blocked.status,429,JSON.stringify(blocked));assert.equal(calls,0);
  await call(e,'/api/budget','PUT',cfg);const pass=await call(e,'/api/connections/test','POST',{provider:'deepseek',runId:crypto.randomUUID()});assert.equal(pass.status,200,JSON.stringify(pass));assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;throw new Error('connection lost')};assert.equal((await call(e,'/api/connections/test','POST',{provider:'deepseek',runId:crypto.randomUUID()})).status,502);
  assert.equal((await call(e,'/api/budget')).data.records.filter(r=>r.state==='uncertain').length,1);
 }finally{globalThis.fetch=original}
});
test('two owners and scoped members cannot see another workspace or spend its key outside their role',async()=>{
 const e=env();await seed(e);await call(e,'/api/connections','POST',{provider:'deepseek',model:'test-model',key:'test-only-alice-key'});
 const bob=(await call(e,'/api/state','GET',undefined,'bob')).data;assert.equal(bob.state.brands.length,0);assert.equal(bob.connections.length,0);
 assert.equal((await call(e,'/api/state','GET',undefined,'bob',{'x-geo-workspace':'alice','oai-authenticated-user-email':'bob@example.com'})).status,403);
 for(const role of ['viewer','reviewer','editor']){
  assert.equal((await call(e,'/api/manage/members','POST',{email:role+'@example.com',role,brands:['a']})).status,200);
  const h={'x-geo-workspace':'alice','oai-authenticated-user-email':role+'@example.com'},w=(await call(e,'/api/state','GET',undefined,role,h)).data;assert.deepEqual(w.state.brands.map(b=>b.id),['a']);
  assert.equal((await call(e,'/api/budget','GET',undefined,role,h)).status,403);assert.equal((await call(e,'/api/budget','PUT',cfg,role,h)).status,403);
  assert.equal((await call(e,'/api/connections/test','POST',{provider:'deepseek',runId:crypto.randomUUID()},role,h)).status,403);
  const imported=await call(e,'/api/v1/answers','POST',{...capture,externalId:role},role,h);assert.equal(imported.status,role==='editor'?200:403);
  assert.equal((await call(e,'/api/v1/answers','POST',{...capture,brandId:'b',questionId:'q2',externalId:role+'-hidden'},role,h)).status,role==='editor'?404:403);
 }
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({})};try{assert.equal((await call(e,'/api/connections/test','POST',{provider:'deepseek',runId:crypto.randomUUID()},'bob')).status,400);assert.equal(calls,0)}finally{globalThis.fetch=original}
});
