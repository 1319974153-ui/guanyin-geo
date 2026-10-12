import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import worker from '../src/worker.js';import {d1Adapter} from '../local/d1-adapter.mjs';import {reportPeriod,tickReportSchedules,reportSchedules} from '../src/report-schedules.js';import {digest} from '../src/access.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db};}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
const current=async e=>(await call(e,'/api/state')).data;
async function seed(e){const w=await current(e);w.state.brands.push({id:'b1',name:'甲品牌'},{id:'b2',name:'乙品牌'});w.state.questions.push({id:'q1',brandId:'b1',text:'如何选择？',version:'v1'});w.state.answers.push({id:'a1',brandId:'b1',promptId:'q1',questionVersion:'v1',questionText:'如何选择？',platform:'夹具平台',surface:'import',entry:'web',mode:'联网',date:'2026-09-29T09:00:00Z',text:'甲品牌提供资料管理。',status:'ok',citationKnown:true,citations:[],recommended:false,recommendationLabeled:true});assert.equal((await call(e,'/api/state','PUT',w)).status,200);}
async function create(e,overrides={}){return call(e,'/api/reports/schedule','POST',{brandId:'b1',frequency:'weekly',surface:'import',enabled:true,revision:0,options:{},...overrides});}
const ctx={owner:'owner',actor:'owner',role:'owner',brands:null};
const h={workspace:async(e,owner)=>{const r=e.db.prepare('SELECT body,revision FROM workspaces WHERE owner=?').get(owner);return{state:JSON.parse(r.body),revision:r.revision}}};
const due=()=>new Date('2026-10-05T00:10:01Z');
function makeDue(e,id,at='2026-09-28T00:10:00.000Z'){e.db.prepare("UPDATE operation_records SET body=json_set(body,'$.nextAt',?) WHERE id=?").run(at,id);}

test('report periods use completed UTC calendar weeks/months and handle Monday, year change and leap February',()=>{
 assert.deepEqual(reportPeriod('weekly',new Date('2026-09-28T00:09:00Z')),{from:'2026-09-21',to:'2026-09-27',nextAt:'2026-09-28T00:10:00.000Z'});
 assert.equal(reportPeriod('weekly',new Date('2026-09-28T00:10:00Z')).nextAt,'2026-10-05T00:10:00.000Z');
 assert.deepEqual(reportPeriod('monthly',new Date('2028-03-01T00:10:00Z')),{from:'2028-02-01',to:'2028-02-29',nextAt:'2028-04-01T00:10:00.000Z'});
 assert.deepEqual(reportPeriod('monthly',new Date('2027-01-20T12:00:00Z')),{from:'2026-12-01',to:'2026-12-31',nextAt:'2027-02-01T00:10:00.000Z'});
});
test('schedule persistence enforces one slot per brand/frequency/data type, revisions and real role/brand boundaries',async()=>{
 const e=env();await seed(e);const one=await create(e);assert.equal(one.status,200);assert.equal(one.data.schedules.length,1);assert.equal((await create(e)).status,409);assert.equal((await create(e,{frequency:'daily'})).status,400);assert.equal((await create(e,{options:{entry:'other'},revision:1})).status,400);
 for(const role of ['viewer','reviewer','editor']){await call(e,'/api/manage/members','POST',{email:role+'@example.com',role,brands:['b1']});const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':role+'@example.com'};const read=await call(e,'/api/reports?brandId=b1','GET',null,role,headers);assert.equal(read.status,200);assert.equal(read.data.schedules.length,1);assert.equal((await call(e,'/api/reports?brandId=b2','GET',null,role,headers)).status,404);
  const save=await call(e,'/api/reports/schedule','POST',{brandId:'b1',frequency:'monthly',surface:'api',enabled:true,revision:0},role,headers);assert.equal(save.status,role==='editor'?200:403);
 }
 assert.equal((await call(e,'/api/reports?brandId=b1','GET',null,'stranger')).status,404);
});
test('due report generation freezes a complete window and repeated runs reuse immutable archives',async()=>{
 const e=env();await seed(e);const c=await create(e),id=c.data.id;makeDue(e,id);const first=await tickReportSchedules(e,ctx,h,due());assert.equal(first.results.length,1);const saved=first.results[0];assert.equal(saved.state,'complete');const row=e.db.prepare('SELECT * FROM report_snapshots WHERE id=?').get(saved.id),body=JSON.parse(row.body);assert.equal(body.options.from,'2026-09-28');assert.equal(body.options.to,'2026-10-04');assert.equal(body.answers.length,1);assert.equal(body.automation.manual,false);assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
 const w=await current(e);w.state.answers[0].text='后续改写的内容';await call(e,'/api/state','PUT',w);makeDue(e,id);const repeat=await tickReportSchedules(e,ctx,h,due());assert.equal(repeat.results[0].existing,true);assert.equal(e.db.prepare('SELECT body FROM report_snapshots WHERE id=?').get(saved.id).body,row.body);assert.equal((await reportSchedules(e,'owner','b1'))[0].lastGeneratedAt,row.created);
 assert.equal((await tickReportSchedules(e,ctx,h,due())).results.length,0);
});
test('concurrent schedule ticks do not duplicate a period and delayed execution does not invent missed periods',async()=>{
 const e=env();await seed(e);const c=await create(e);makeDue(e,c.data.id,'2026-01-01T00:10:00.000Z');const results=await Promise.all([tickReportSchedules(e,ctx,h,due()),tickReportSchedules(e,ctx,h,due())]);assert.equal(results.flatMap(x=>x.results).filter(x=>x.state==='complete').length,1);assert.equal(e.db.prepare('SELECT count(*) AS n FROM report_snapshots').get().n,1);assert.equal((await reportSchedules(e,'owner','b1'))[0].nextAt,'2026-10-12T00:10:00.000Z');
});
test('report capacity failure saves an error, delays retries and clears the error only after actual archive success',async()=>{
 const e=env();await seed(e);const c=await create(e);makeDue(e,c.data.id);const insert=e.db.prepare('INSERT INTO report_snapshots(id,owner,brand_id,title,body,source_revision,created) VALUES(?,?,?,?,?,?,?)');for(let i=0;i<1000;i++)insert.run('fixture-'+i,'owner','b1','测试','{}',1,'2026-01-01T00:00:00Z');
 const fail=await tickReportSchedules(e,ctx,h,due());assert.equal(fail.results[0].state,'failed');assert.match(fail.results[0].error,/1000/);assert.equal((await tickReportSchedules(e,ctx,h,due())).results.length,0);e.db.prepare("DELETE FROM report_snapshots WHERE id='fixture-0'").run();const success=await tickReportSchedules(e,ctx,h,new Date(due().getTime()+3600001));assert.equal(success.results[0].state,'complete');assert.equal((await reportSchedules(e,'owner','b1'))[0].lastError,'');
});
test('a failed schedule update rolls back the newly inserted archive as one transaction',async()=>{
 const e=env();await seed(e);const c=await create(e),r=c.data.schedules[0];e.db.exec("CREATE TRIGGER schedule_failure BEFORE UPDATE ON operation_records WHEN NEW.kind='report_schedule' AND json_extract(NEW.body,'$.lastReportId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture'); END;");
 const out=await call(e,'/api/reports/schedule/run','POST',{id:r.id,brandId:'b1',revision:r.revision});assert.equal(out.status,503);assert.equal(e.db.prepare('SELECT count(*) AS n FROM report_snapshots').get().n,0);assert.equal((await reportSchedules(e,'owner','b1'))[0].revision,1);
});
test('manual scheduled reports respect scoped brands and freeze empty windows without invented samples',async()=>{
 const e=env();await seed(e);const c=await create(e,{surface:'api'}),r=c.data.schedules[0];assert.equal((await call(e,'/api/reports/schedule/run','POST',{id:r.id,brandId:'b2',revision:r.revision})).status,404);const out=await call(e,'/api/reports/schedule/run','POST',{id:r.id,brandId:'b1',revision:r.revision});assert.equal(out.status,200);const report=(await call(e,'/api/reports/snapshot?id='+out.data.id)).data.report;assert.equal(report.metrics.n,0);assert.equal(report.options.surface,'api');assert.equal(report.automation.manual,true);
});
test('business backup restore pauses automated reports and preserves existing immutable archives',async()=>{
 const e=env();await seed(e);const c=await create(e);makeDue(e,c.data.id);const generated=await tickReportSchedules(e,ctx,h,due());const backup=await call(e,'/api/manage/backups','POST',{label:'包含周期报告'});assert.equal(backup.status,200);const w=await current(e),restored=await call(e,'/api/manage/backups/restore','POST',{id:backup.data.id,revision:w.revision});assert.equal(restored.status,200);const r=(await reportSchedules(e,'owner','b1'))[0];assert.equal(r.enabled,false);assert.equal(r.nextAt,null);assert.ok(r.lastError);assert.equal((await tickReportSchedules(e,ctx,h,new Date('2030-01-01'))).results.length,0);assert.equal((await call(e,'/api/reports/snapshot?id='+generated.results[0].id)).status,200);
});
test('only the owner-bound runner automatically dispatches report schedules; browser model ticks keep their original scope',async()=>{
 const e=env();await seed(e);const c=await create(e);makeDue(e,c.data.id,'2000-01-01T00:10:00Z');await call(e,'/api/tasks/tick','POST',{brandId:'b2'});assert.equal(e.db.prepare('SELECT count(*) AS n FROM report_snapshots').get().n,0);
 const token='gr_'+'c'.repeat(64);e.GEO_RUNNER_ENABLED='true';e.GEO_RUNNER_KEY_HASH=await digest(token);e.GEO_RUNNINGHUB_OWNER_ID='owner';const r=await call(e,'/api/runner/tick','POST',{},'unused',{authorization:'Bearer '+token});assert.equal(r.status,200);assert.equal(r.data.state,'idle');assert.equal(r.data.reports.results[0].state,'complete');assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
});
test('changing schedule filters clears the old result link while preserving the old archive and creating a separate filtered snapshot',async()=>{
 const e=env();await seed(e);const c=await create(e);makeDue(e,c.data.id);const first=await tickReportSchedules(e,ctx,h,due()),old=(await reportSchedules(e,'owner','b1'))[0];
 const updated=await create(e,{revision:old.revision,options:{platform:'另一平台'}});assert.equal(updated.status,200);assert.equal(updated.data.schedules[0].lastReportId,null);makeDue(e,c.data.id);const next=await tickReportSchedules(e,ctx,h,due());assert.notEqual(next.results[0].id,first.results[0].id);assert.equal(e.db.prepare('SELECT count(*) AS n FROM report_snapshots').get().n,2);assert.equal(JSON.parse(e.db.prepare('SELECT body FROM report_snapshots WHERE id=?').get(next.results[0].id).body).metrics.n,0);
});
test('Chinese report payload capacity is measured in UTF-8 bytes before archive writes',async()=>{
 const e=env();await seed(e);const w=await current(e);w.state.answers[0].text='中'.repeat(400000);assert.equal((await call(e,'/api/state','PUT',w)).status,200);const manual=await call(e,'/api/reports/archive','POST',{id:'oversized-report-fixture-001',brandId:'b1',options:{period:'all',surface:'import'}});assert.equal(manual.status,413);const c=await create(e);makeDue(e,c.data.id);const result=await tickReportSchedules(e,ctx,h,due());assert.equal(result.results[0].state,'failed');assert.match(result.results[0].error,/1 MB/);assert.equal(e.db.prepare('SELECT count(*) AS n FROM report_snapshots').get().n,0);
});
