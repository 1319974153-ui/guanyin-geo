import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db};}
async function call(e,path,body,method='POST',user='owner',extra={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...extra},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
const state=async e=>(await call(e,'/api/state',null,'GET')).data;
async function seed(e){const w=await state(e);w.state.brands.push({id:'b1',name:'隔离验收品牌'},{id:'b2',name:'另一个品牌'});for(let n=1;n<=3;n++)w.state.facts.push({id:'f'+n,brandId:'b1',key:'资料'+n,value:'仅供测试的品牌资料 '+n,source:'测试原文',status:'待确认'});w.state.facts.push({id:'other',brandId:'b2',key:'其他资料',value:'另一个品牌资料',source:'原文',status:'待确认'});const saved=await call(e,'/api/state',w,'PUT');assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await call(e,'/api/brands/product',{id:'p1',brandId:'b1',revision:saved.data.revision,name:'当前产品',status:'active'})).status,200);}
const preview=async(e,values={})=>call(e,'/api/knowledge/review-preview',{brandId:'b1',...values});
function input(plan,selectedIds=['f1','f2']){return {brandId:'b1',ids:plan.ids,selectedIds,previewHash:plan.previewHash,batchId:'material-review-fixture-0001',reviewed:true};}
test('material preview is read-only, and an explicitly selected batch preserves original content and version history',async()=>{
 const e=env();await seed(e);const before=await state(e),p=await preview(e);assert.equal(p.status,200);assert.equal(p.data.plan.modelCalls,0);assert.equal(p.data.plan.rows.length,3);assert.equal((await state(e)).revision,before.revision);
 const r=await call(e,'/api/knowledge/review-batch',input(p.data.plan));assert.equal(r.status,200,JSON.stringify(r.data));const f=r.data.state.facts.find(x=>x.id==='f1');assert.equal(f.status,'已确认');assert.equal(f.value,before.state.facts[0].value);assert.equal(f.version,2);assert.equal(f.history.length,2);assert.equal(f.history[0].values.status,'待确认');assert.equal(f.reviewBatch.actor,'owner');assert.equal(r.data.state.facts.find(x=>x.id==='f3').status,'待确认');assert.equal(r.data.state.facts.find(x=>x.id==='other').status,'待确认');
});
test('retrying a lost response reuses the same persisted batch without extra fact versions',async()=>{
 const e=env();await seed(e);const p=(await preview(e)).data.plan,b=input(p),first=await call(e,'/api/knowledge/review-batch',b),again=await call(e,'/api/knowledge/review-batch',b);assert.equal(again.status,200);assert.equal(again.data.existing,true);assert.equal(again.data.revision,first.data.revision);assert.deepEqual(again.data.state,first.data.state);
 const altered=await call(e,'/api/knowledge/review-batch',{...b,selectedIds:['f1']});assert.equal(altered.status,409);
});
test('changed material invalidates the displayed preview and the entire confirmation stays unapplied',async()=>{
 const e=env();await seed(e);const p=(await preview(e)).data.plan,w=await state(e);w.state.facts[1].value='已变化的新内容';assert.equal((await call(e,'/api/state',w,'PUT')).status,200);const r=await call(e,'/api/knowledge/review-batch',input(p));assert.equal(r.status,409);assert.ok((await state(e)).state.facts.every(f=>f.status==='待确认'));
});
test('expired, incomplete, replaced and archived-product materials are visible but cannot be confirmed',async()=>{
 const e=env();await seed(e);const w=await state(e);w.state.facts[0].expiresAt='2000-01-01T00:00:00Z';w.state.facts[1].source='';w.state.facts[2].productId='p1';assert.equal((await call(e,'/api/state',w,'PUT')).status,200);assert.equal((await call(e,'/api/brands/product',{id:'p1',brandId:'b1',revision:(await state(e)).revision,name:'当前产品',status:'archived'})).status,200);
 const p=(await preview(e)).data.plan;assert.equal(p.rows.filter(x=>x.eligible).length,0);const r=await call(e,'/api/knowledge/review-batch',input(p));assert.equal(r.status,400);assert.ok((await state(e)).state.facts.every(f=>f.status==='待确认'));
 const fresh=env();await seed(fresh);const x=await state(fresh);x.state.sourceDocuments.push({id:'doc',brandId:'b1',title:'旧文件',text:'原文',hash:'hash',supersededBy:'newdoc'});x.state.facts[0].sourceDocumentId='doc';assert.equal((await call(fresh,'/api/state',x,'PUT')).status,200);const y=(await preview(fresh)).data.plan;assert.match(y.rows.find(r=>r.id==='f1').reasons.join(''),/新版/);assert.equal((await call(fresh,'/api/knowledge/review-batch',input(y,['f1']))).status,400);
});
test('explicit human review and bounded, unique, same-brand selection are required',async()=>{
 const e=env();await seed(e);const p=(await preview(e)).data.plan,b=input(p);
 for(const edit of [{reviewed:false},{selectedIds:[]},{selectedIds:['f1','f1']},{selectedIds:['other']},{previewHash:'wrong'},{batchId:'short'}])assert.equal((await call(e,'/api/knowledge/review-batch',{...b,...edit})).status,400);
 assert.equal((await preview(e,{ids:['other']})).status,404);assert.equal((await preview(e,{ids:['f1','f1']})).status,400);
 assert.equal((await call(e,'/api/knowledge/review-preview',null,'GET')).status,405);
});
test('review roles and brand permissions are enforced, including the preview and replay',async()=>{
 const e=env();await seed(e);for(const role of ['editor','reviewer','viewer'])await call(e,'/api/manage/members',{email:role+'@example.com',role,brands:['b1']});
 for(const role of ['editor','viewer']){const r=await call(e,'/api/knowledge/review-preview',{brandId:'b1'},'POST',role,{'x-geo-workspace':'owner','oai-authenticated-user-email':role+'@example.com'});assert.equal(r.status,403);}
 const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'reviewer@example.com'},p=await call(e,'/api/knowledge/review-preview',{brandId:'b1'},'POST','reviewer',headers);assert.equal(p.status,200,JSON.stringify(p.data));const r=await call(e,'/api/knowledge/review-batch',input(p.data.plan),'POST','reviewer',headers);assert.equal(r.status,200);assert.equal(r.data.state.facts.find(x=>x.id==='f1').reviewBatch.actor,'reviewer');assert.equal((await call(e,'/api/knowledge/review-preview',{brandId:'b2'},'POST','reviewer',headers)).status,404);
});
test('batch receipts cannot be forged and a later fact edit invalidates an old result',async()=>{
 const e=env();await seed(e);const p=(await preview(e)).data.plan,b=input(p);assert.equal((await call(e,'/api/knowledge/review-batch',b)).status,200);let w=await state(e);w.state.facts[0].reviewBatch.actor='fake';assert.equal((await call(e,'/api/state',w,'PUT')).status,403);w=await state(e);w.state.facts[0].value='这条资料已被再次修改';assert.equal((await call(e,'/api/state',w,'PUT')).status,200);const f=(await state(e)).state.facts[0];assert.equal(f.status,'待确认');assert.equal(f.reviewBatch,undefined);assert.equal((await call(e,'/api/knowledge/review-batch',b)).status,409);
});
test('write failure leaves all selected materials pending and empty previews need no model',async()=>{
 const e=env();await seed(e);const p=(await preview(e)).data.plan;e.db.exec("CREATE TRIGGER fixture_write_fail BEFORE UPDATE ON workspaces BEGIN SELECT RAISE(ABORT,'fixture'); END;");const r=await call(e,'/api/knowledge/review-batch',input(p));assert.equal(r.status,503);assert.ok((await state(e)).state.facts.every(f=>f.status==='待确认'));const w=env(),s=await state(w);s.state.brands.push({id:'b1',name:'空品牌'});await call(w,'/api/state',s,'PUT');assert.deepEqual((await preview(w)).data.plan.rows,[]);
});
async function seedPages(e,count,expiredCount=0){
 await seed(e);const w=await state(e);w.state.facts=w.state.facts.filter(f=>f.brandId!=='b1');
 for(let n=count;n>=1;n--)w.state.facts.push({id:'page'+String(n).padStart(3,'0'),brandId:'b1',key:'分页资料'+n,value:'分页测试内容 '+n,source:'隔离测试原文',status:'待确认',...(n<=expiredCount?{expiresAt:'2000-01-01T00:00:00Z'}:{})});
 const saved=await call(e,'/api/state',w,'PUT');assert.equal(saved.status,200,JSON.stringify(saved.data));
}
test('ineligible first-page materials do not block viewing and confirming a later page',async()=>{
 const e=env();await seedPages(e,51,50);const first=(await preview(e)).data.plan;
 assert.equal(first.rows.length,50);assert.ok(first.rows.every(r=>!r.eligible));assert.equal(first.offset,0);assert.equal(first.hasMore,true);assert.equal(first.nextOffset,50);assert.equal(first.previousOffset,null);
 const second=(await preview(e,{offset:first.nextOffset})).data.plan;
 assert.deepEqual(second.ids,['page051']);assert.equal(second.rows[0].eligible,true);assert.equal(second.offset,50);assert.equal(second.hasMore,false);assert.equal(second.nextOffset,null);assert.equal(second.previousOffset,0);
 const confirmed=await call(e,'/api/knowledge/review-batch',input(second,['page051']));assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));assert.equal(confirmed.data.state.facts.find(f=>f.id==='page051').status,'已确认');assert.equal(confirmed.data.state.facts.filter(f=>f.brandId==='b1'&&f.status==='待确认').length,50);assert.equal(confirmed.data.state.facts.find(f=>f.id==='other').status,'待确认');
 const refreshed=(await preview(e,{offset:50})).data.plan;assert.equal(refreshed.offset,0);assert.equal(refreshed.rows.length,50);assert.equal(refreshed.hasMore,false);
});
test('default pagination is stably sorted, bounded to 50, and unchanged by stored array order',async()=>{
 const e=env();await seedPages(e,121);const first=(await preview(e)).data.plan,second=(await preview(e,{offset:50,limit:500})).data.plan,last=(await preview(e,{offset:100})).data.plan;
 assert.equal(first.ids[0],'page001');assert.equal(first.ids.at(-1),'page050');assert.equal(second.rows.length,50);assert.equal(second.maxSelected,50);assert.equal(second.ids[0],'page051');assert.equal(second.ids.at(-1),'page100');assert.equal(second.previousOffset,0);assert.equal(second.nextOffset,100);assert.equal(last.rows.length,21);assert.equal(last.previousOffset,50);assert.equal(last.hasMore,false);assert.equal(last.nextOffset,null);assert.equal(last.totalPending,121);
 const w=await state(e);w.state.facts.reverse();assert.equal((await call(e,'/api/state',w,'PUT')).status,200);const reordered=(await preview(e,{offset:50})).data.plan;assert.deepEqual(reordered.ids,second.ids);assert.equal(reordered.previewHash,second.previewHash);
 const partial=(await preview(e,{offset:1})).data.plan;assert.equal(partial.offset,1);assert.equal(partial.ids[0],'page002');assert.equal(partial.nextOffset,51);
 const beyond=(await preview(e,{offset:Number.MAX_SAFE_INTEGER})).data.plan;assert.equal(beyond.offset,100);assert.deepEqual(beyond.ids,last.ids);
});
test('preview rejects invalid offsets and leaves explicit ID snapshots separate from pagination',async()=>{
 const e=env();await seedPages(e,51);
 for(const offset of [-1,0.5,'50',null,true,Number.MAX_SAFE_INTEGER+1])assert.equal((await preview(e,{offset})).status,400,JSON.stringify(offset));
 const explicit=(await preview(e,{ids:['page051','page001'],offset:50})).data.plan;assert.deepEqual(explicit.ids,['page001','page051']);assert.equal(explicit.offset,0);assert.equal(explicit.hasMore,false);assert.equal(explicit.nextOffset,null);assert.equal(explicit.previousOffset,null);assert.equal(explicit.totalPending,51);
 assert.equal((await preview(e,{ids:Array.from({length:51},(_,n)=>'page'+String(n+1).padStart(3,'0'))})).status,400);
});
test('empty pending pages normalize stale offsets without links or a model call',async()=>{
 const e=env();await seedPages(e,0);const before=await state(e),p=(await preview(e,{offset:50})).data.plan;
 assert.deepEqual(p.rows,[]);assert.equal(p.offset,0);assert.equal(p.totalPending,0);assert.equal(p.hasMore,false);assert.equal(p.nextOffset,null);assert.equal(p.previousOffset,null);assert.equal(p.modelCalls,0);assert.equal((await state(e)).revision,before.revision);
});
