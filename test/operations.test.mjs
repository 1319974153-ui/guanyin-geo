import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';import worker from '../src/worker.js';import {alertCandidates,DEFAULT_ALERT_RULES} from '../src/operations.js';import {enterOperation,leaveOperation} from '../src/governance.js';
import {makeReport,decisionActionToken} from '../src/analytics-core.js';import {credibilityToken} from '../src/credibility-plan.js';import {digest} from '../src/access.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_RUNNINGHUB_OWNER_ID:'owner',GEO_RUNNINGHUB_KEY:'FIXTURE_ONLY',GEO_RUNNINGHUB_MODEL:'fixture'}}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands.push({id:'b1',name:'甲产品',site:'https://brand.example'},{id:'b2',name:'乙产品'});w.state.questions.push({id:'q1',brandId:'b1',text:'如何使用产品？',version:'v1',topic:'使用',intent:'使用'});assert.equal((await call(e,'/api/state','PUT',w)).status,200);return (await call(e,'/api/state')).data;}
const get=e=>call(e,'/api/operations?brandId=b1');const evaluate=e=>call(e,'/api/operations/evaluate','POST',{brandId:'b1'});
const action={id:'action-fixture-request-001',brandId:'b1',title:'补齐问题采样',description:'使用原版本问题复测并记录变化',assignee:'owner',dueDate:'2026-12-31',status:'待处理',diagnosis:'coverage',options:{period:'all'}};
async function plan(e){const r=await call(e,'/api/tasks','POST',{id:'fixture-plan-request-001',brandId:'b1',name:'夹具采样计划',kind:'sample',providers:['runninghub'],questionIds:['q1'],repeats:1,intervalMinutes:0});assert.equal(r.status,200);return e.db.prepare('SELECT * FROM task_items').get();}
const answer=(id,date,official=true)=>({id,brandId:'b1',promptId:'q1',questionVersion:'v1',questionText:'如何使用产品？',surface:'import',entry:'web',status:'ok',text:'甲产品的一条实际回答',platform:'平台',mode:'联网标准',region:'中国',language:'zh-CN',model:'记录模型',date,citationKnown:true,citations:official?[{url:'https://brand.example/a'}]:[]});
test('diagnosis actions retain origin, validate brand assignees, and require fresh evidence and reviewer authority',async()=>{
 const e=env();await seed(e);let r=await call(e,'/api/operations/actions','POST',action);assert.equal(r.status,200);assert.equal((await get(e)).data.actions[0].origin.diagnosis.type,'coverage');assert.equal((await call(e,'/api/operations/actions','POST',action)).data.existing,true);
 let a=(await get(e)).data.actions[0];assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:a.revision,assignee:'not-a-member@example.com'})).status,400);
 assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:a.revision,status:'已复核',note:'这是一条足够长的复核记录',evidence:[]})).status,400);
 const w=(await call(e,'/api/state')).data;w.state.answers.push(answer('a1',new Date(Date.now()+1000).toISOString()));assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 r=await call(e,'/api/operations/actions','POST',{...action,revision:a.revision,status:'已复核',note:'复测已补齐样本，效果变化仍继续观察。',evidence:[{kind:'answer',id:'a1'}]});assert.equal(r.status,200);a=(await get(e)).data.actions[0];assert.equal(a.evidence[0].sha256.length,64);assert.equal(a.history.length,2);assert.equal(a.status,'已复核');assert.equal(a.origin.kind,'diagnosis');
 assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:1})).status,409);
});
test('credibility actions bind to the current recommendation and never start a task or accept a mixed source',async()=>{
 const e=env();await seed(e);const state=(await call(e,'/api/state')).data,r=makeReport(state.state,'b1',{period:'all'}),item=r.credibilityPlan.items.find(item=>item.id==='ranking');
 const input={id:'credibility-action-fixture-001',brandId:'b1',title:'任意客户端标题',description:'任意客户端说明',assignee:'owner',dueDate:'',status:'待处理',options:r.options,credibility:{id:item.id,token:await digest(credibilityToken(item,r))}};
 assert.equal((await call(e,'/api/operations/actions','POST',input)).status,200);const saved=(await get(e)).data.actions[0];assert.equal(saved.origin.kind,'credibility');assert.equal(saved.origin.credibility.id,'ranking');assert.match(saved.title,/不要把“行业第一”写成事实/);assert.match(saved.description,/下一步：/);assert.equal(e.db.prepare('SELECT count(*) AS n FROM task_plans').get().n,0);
 const next=(await call(e,'/api/state')).data;next.state.facts.push({id:'rank-material',brandId:'b1',status:'已确认',key:'行业排名材料',value:'公开评选材料',source:'https://industry.example/ranking'});assert.equal((await call(e,'/api/state','PUT',next)).status,200);
 assert.equal((await call(e,'/api/operations/actions','POST',{...input,id:'credibility-action-stale-001'})).status,409);
 assert.equal((await call(e,'/api/operations/actions','POST',{...input,id:'credibility-action-mixed-001',diagnosis:'coverage'})).status,400);
});
async function decisionInput(e,stepId='retest'){
 const state=(await call(e,'/api/state')).data,report=makeReport(state.state,'b1',{period:'all'}),step=report.decision.steps.find(s=>s.id===stepId);
 return {brandId:'b1',options:report.options,decision:{id:step.id,token:await digest(decisionActionToken(report,step))}};
}
test('report steps save one server-owned action with the original goal and evidence without triggering model calls',async()=>{
 const e=env(),w=await seed(e);w.state.brands[0].goalQuery='如何使用产品？';w.state.answers.push({...answer('decision-source',new Date().toISOString()),recommended:false,recommendationLabeled:true,text:'请进一步提供案例'});await call(e,'/api/state','PUT',w);
 const input=await decisionInput(e),original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not call external service')};
 try{
  const [first,second]=await Promise.all([call(e,'/api/operations/actions','POST',{...input,id:'untrusted-client-id-001',title:'伪造标题',status:'已复核',evidence:[{kind:'answer',id:'fake'}]}),call(e,'/api/operations/actions','POST',{...input,id:'untrusted-client-id-002'})]);
  assert.equal(first.status,200);assert.equal(second.status,200);
  const actions=(await get(e)).data.actions;assert.equal(actions.length,1);const saved=actions[0];assert.equal(saved.status,'待处理');assert.equal(saved.history.length,1);assert.equal(saved.revision,1);assert.equal(saved.assignee,'owner');assert.equal(saved.origin.kind,'decision');assert.equal(saved.origin.goalQuery,'如何使用产品？');assert.deepEqual(saved.origin.evidence.currentIds,['decision-source']);assert.deepEqual(saved.origin.questionIds,['q1']);assert.equal(saved.origin.options.to,input.options.to);assert.equal(saved.evidence.length,0);assert.match(saved.description,/完成标准：/);assert.match(saved.title,/发布后按原条件复测/);assert.notEqual(saved.id,'untrusted-client-id-001');
  const again=await call(e,'/api/operations/actions','POST',input);assert.equal(again.data.existing,true);assert.equal(again.data.action.id,saved.id);assert.equal((await get(e)).data.actions.length,1);assert.equal(calls,0);assert.equal(e.db.prepare('SELECT count(*) AS n FROM task_plans').get().n,0);assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
 }finally{globalThis.fetch=original}
});
test('report action creation rejects stale evidence, mixed origins and unauthorized roles or brands',async()=>{
 const e=env(),w=await seed(e);w.state.brands[0].goalQuery='如何使用产品？';w.state.answers.push({...answer('decision-edit',new Date().toISOString()),recommended:false,recommendationLabeled:true});await call(e,'/api/state','PUT',w);
 const input=await decisionInput(e);assert.equal((await call(e,'/api/operations/actions','POST',{...input,diagnosis:'coverage'})).status,400);assert.equal((await call(e,'/api/operations/actions','POST',{...input,revision:1})).status,400);assert.equal((await call(e,'/api/operations/actions','POST',{...input,decision:{...input.decision,id:'missing'}})).status,409);
 const h={'x-geo-workspace':'owner','oai-authenticated-user-email':'decision-member@test.example'};
 for(const [role,brands,status]of [['viewer',['b1'],403],['reviewer',['b1'],403],['editor',['b2'],404]]){await call(e,'/api/manage/members','POST',{email:'decision-member@test.example',role,brands});assert.equal((await call(e,'/api/operations/actions','POST',input,'member',h)).status,status)}
 assert.equal((await call(e,'/api/operations/actions','POST',input,'unrelated-owner')).status,404);
 const next=(await call(e,'/api/state')).data;next.state.answers[0].text='改过的回答内容，样本数量保持不变';assert.equal((await call(e,'/api/state','PUT',next)).status,200);assert.equal((await call(e,'/api/operations/actions','POST',input)).status,409);assert.equal((await get(e)).data.actions.length,0);
 assert.equal((await call(e,'/api/operations/actions','POST',await decisionInput(e))).status,200);
});
test('operations roles and brand scopes are enforced and revoked members cannot be assigned',async()=>{
 const e=env();await seed(e);await call(e,'/api/operations/actions','POST',action);const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'member@test.example'};
 for(const [role,brands,expected]of [['editor',['b2'],404],['viewer',['b1'],403]]){await call(e,'/api/manage/members','POST',{email:'member@test.example',role,brands});assert.equal((await call(e,'/api/operations/actions','POST',{...action,id:'other-action-fixture-001'},'member',headers)).status,expected)}
 await call(e,'/api/manage/members','POST',{email:'member@test.example',role:'editor',brands:['b1']});let a=(await get(e)).data.actions[0];assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:a.revision,status:'已复核',note:'编辑尝试跳过审核人进行复核'},'member',headers)).status,403);
 assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:a.revision,assignee:'member@test.example'})).status,200);await call(e,'/api/manage/members','DELETE',{email:'member@test.example'});assert.ok(!(await get(e)).data.assignees.some(x=>x.id==='member@test.example'));
 const other=await call(e,'/api/operations?brandId=b1','GET',null,'other');assert.equal(other.status,404);
});
test('old, future, unrelated and incomplete evidence cannot close a follow-up',async()=>{
 const e=env(),w=await seed(e);w.state.answers.push(answer('old','2000-01-01T00:00:00Z'),answer('future','2099-01-01T00:00:00Z'),{...answer('foreign',new Date().toISOString()),brandId:'b2'});await call(e,'/api/state','PUT',w);assert.equal((await call(e,'/api/operations/actions','POST',{...action,diagnosis:undefined})).status,200);
 for(const [id,status]of [['old',400],['future',400],['foreign',404],['missing',404]])assert.equal((await call(e,'/api/operations/actions','POST',{...action,revision:1,status:'已复核',note:'应当拒绝没有有效新证据的结论',evidence:[{kind:'answer',id}]})).status,status);
});
test('task failures deduplicate into a persistent alert, acknowledgment holds until changed evidence, and clearing is not labeled resolved work',async()=>{
 const e=env();await seed(e);const item=await plan(e);e.db.prepare("UPDATE task_items SET status='uncertain',error='供应商回执未知' WHERE id=?").run(item.id);await evaluate(e);let alerts=(await get(e)).data.alerts;assert.equal(alerts.length,1);assert.equal(alerts[0].evidence.items[0].id,item.id);
 const rev=alerts[0].revision;await evaluate(e);assert.equal((await get(e)).data.alerts[0].revision,rev);await call(e,'/api/operations/acknowledge','POST',{brandId:'b1',id:alerts[0].id,revision:rev});await evaluate(e);assert.equal((await get(e)).data.alerts[0].status,'已知悉');
 e.db.prepare("UPDATE task_items SET error='需要检查新的回执' WHERE id=?").run(item.id);await evaluate(e);assert.equal((await get(e)).data.alerts[0].status,'待处理');e.db.prepare("UPDATE task_items SET status='complete' WHERE id=?").run(item.id);await evaluate(e);alerts=(await get(e)).data.alerts;assert.equal(alerts[0].status,'已消退');assert.match(alerts[0].resolution,/不等同问题已解决/);
});
test('citation alerts require sufficient fully labeled comparable samples and complete context',async()=>{
 const e=env(),w=await seed(e),clock=new Date('2026-09-29T12:00:00Z'),rules={...DEFAULT_ALERT_RULES,failures:false,conflicts:false,budget:false};
 for(let i=0;i<5;i++){w.state.answers.push(answer('old'+i,'2026-09-20T08:00:00Z',true),answer('new'+i,'2026-09-27T08:00:00Z',false));}
 let candidates=alertCandidates(w.state,'b1',rules,[],0,20,clock);assert.equal(candidates.length,1);assert.equal(candidates[0].evidence.points,-100);assert.equal(candidates[0].evidence.currentN,5);
 w.state.answers[0].citationKnown=false;assert.equal(alertCandidates(w.state,'b1',rules,[],0,20,clock).length,0);w.state.answers[0].citationKnown=true;w.state.answers[0].region='';assert.equal(alertCandidates(w.state,'b1',rules,[],0,20,clock).length,0);
});
test('alert rules use revisions and admin access; budget is shared usage but is hidden from scoped members',async()=>{
 const e=env();await seed(e);for(let i=0;i<16;i++)e.db.prepare('INSERT INTO runs(owner,id,kind,state,created) VALUES(?,?,?,?,?)').run('owner','bill'+i,'verify','failed',new Date().toISOString());await evaluate(e);assert.equal((await get(e)).data.alerts[0].type,'budget');
 const b={brandId:'b1',...DEFAULT_ALERT_RULES,enabled:false,revision:0};assert.equal((await call(e,'/api/operations/rules','POST',b)).status,200);assert.equal((await call(e,'/api/operations/rules','POST',b)).status,409);await evaluate(e);assert.equal((await get(e)).data.alerts[0].status,'已消退');
 await call(e,'/api/manage/members','POST',{email:'editor@test.example',role:'editor',brands:['b1']});const h={'x-geo-workspace':'owner','oai-authenticated-user-email':'editor@test.example'};assert.equal((await call(e,'/api/operations?brandId=b1','GET',null,'editor',h)).data.alerts.length,0);assert.equal((await call(e,'/api/operations/rules','POST',{...b,revision:1},'editor',h)).status,403);
});
test('full backup includes tasks, reports, operations and receipts, excludes access credentials, and restores paused without rebilling',async()=>{
 const e=env();await seed(e);const item=await plan(e);await call(e,'/api/operations/actions','POST',action);await call(e,'/api/reports/archive','POST',{id:'report-before-copy-001',brandId:'b1',options:{period:'all'}});
 const backup=(await call(e,'/api/manage/backups','POST',{label:'完整备份'})).data;
 const original=globalThis.fetch;let paid=0;globalThis.fetch=async()=>{paid++;return Response.json({id:'paid-receipt',choices:[{message:{content:'真实请求路径的本地夹具输出'}}]})};try{
  assert.equal((await call(e,'/api/tasks/tick','POST',{})).data.state,'complete');const current=(await call(e,'/api/state')).data;
  const r=await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:current.revision});assert.equal(r.status,200);assert.equal(r.data.full,true);assert.equal(r.data.state.answers.length,0);assert.equal(e.db.prepare('SELECT status FROM task_plans').get().status,'paused');assert.equal(e.db.prepare('SELECT status FROM task_items').get().status,'ready');assert.equal(e.db.prepare('SELECT attempts FROM task_items').get().attempts,1);assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,1);
  assert.equal((await call(e,'/api/tasks/tick','POST',{})).data.state,'idle');assert.equal(paid,1);
  assert.equal((await call(e,'/api/tasks/action','POST',{planId:item.plan_id,action:'resume'})).status,200);assert.equal((await call(e,'/api/tasks/tick','POST',{})).data.state,'complete');assert.equal(paid,1);assert.equal((await get(e)).data.actions.length,1);assert.equal((await call(e,'/api/reports?brandId=b1')).data.reports.length,1);
 }finally{globalThis.fetch=original}
 const copy=(await call(e,'/api/manage/backups/download','POST',{id:backup.id})).data;assert.equal(copy.format,'guanyin-backup-v2');assert.equal(copy.tables.task_items.length,1);assert.equal(copy.tables.report_snapshots.length,1);assert.equal(copy.tables.operation_records.length,1);assert.equal(copy.checksum.length,64);assert.ok(!('connections' in copy.tables));assert.ok(!JSON.stringify(copy).includes('FIXTURE_ONLY'));
});
test('restore never automatically repeats an unknown paid call or reduces attempt counters',async()=>{
 const e=env();await seed(e);const item=await plan(e),b=(await call(e,'/api/manage/backups','POST',{})).data;
 e.db.prepare('INSERT INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,?,?,?)').run('owner',item.id+'-2','sample','uncertain',new Date().toISOString(),'{"error":"unknown"}');e.db.prepare("UPDATE task_items SET attempts=2,status='uncertain'").run();
 const w=(await call(e,'/api/state')).data,r=await call(e,'/api/manage/backups/restore','POST',{id:b.id,revision:w.revision});assert.equal(r.status,200);const row=e.db.prepare('SELECT * FROM task_items').get();assert.equal(row.attempts,2);assert.equal(row.status,'uncertain');assert.equal(row.lease_token,null);
});
test('maintenance excludes active writes while independent normal writes remain possible',async()=>{
 const e=env();await seed(e);const b=(await call(e,'/api/manage/backups','POST',{})).data,w=(await call(e,'/api/state')).data,lease=await enterOperation(e,'owner');
 assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:b.id,revision:w.revision})).status,409);assert.equal((await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'甲产品'})).status,409);
 const second=await enterOperation(e,'owner');await leaveOperation(e,second);await leaveOperation(e,lease);const exclusive=await enterOperation(e,'owner',true);assert.equal((await call(e,'/api/state','PUT',w)).status,409);assert.equal((await call(e,'/api/state')).status,200);await leaveOperation(e,exclusive);
});
test('brand deletion backs up and removes linked task/report/action rows; restore recovers them',async()=>{
 const e=env();await seed(e);await plan(e);await call(e,'/api/operations/actions','POST',action);await call(e,'/api/reports/archive','POST',{id:'report-delete-fixture-001',brandId:'b1'});
 const r=await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'甲产品'});assert.equal(r.status,200);for(const table of ['task_items','task_plans','operation_records','report_snapshots'])assert.equal(e.db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);assert.equal(r.data.state.brands[0].id,'b2');
 const restored=await call(e,'/api/manage/backups/restore','POST',{id:r.data.backupId,revision:r.data.revision});assert.equal(restored.status,200);assert.equal(e.db.prepare('SELECT count(*) AS n FROM task_items').get().n,1);assert.equal((await get(e)).data.actions.length,1);
});
test('backup restore rolls back all table changes on a database failure and leaves protection copy',async()=>{
 const e=env();await seed(e);await plan(e);const b=(await call(e,'/api/manage/backups','POST',{})).data;await call(e,'/api/operations/actions','POST',action);const w=(await call(e,'/api/state')).data;
 e.db.exec("CREATE TRIGGER fixture_restore_failure BEFORE INSERT ON task_items BEGIN SELECT RAISE(ABORT,'fixture'); END;");const r=await call(e,'/api/manage/backups/restore','POST',{id:b.id,revision:w.revision});assert.equal(r.status,503);assert.equal((await get(e)).data.actions.length,1);assert.equal((await call(e,'/api/state')).data.revision,w.revision);assert.equal(e.db.prepare('SELECT count(*) AS n FROM backups').get().n,2);assert.equal(e.db.prepare('SELECT count(*) AS n FROM operation_leases').get().n,0);
});
test('legacy backups preserve modern tables and pause current plans rather than silently discarding them',async()=>{
 const e=env(),w=await seed(e);await plan(e);e.db.prepare('INSERT INTO backups(id,owner,label,body,revision,created) VALUES(?,?,?,?,?,?)').run('legacy','owner','旧版',JSON.stringify(w.state),w.revision,new Date().toISOString());const r=await call(e,'/api/manage/backups/restore','POST',{id:'legacy',revision:w.revision});assert.equal(r.status,200);assert.equal(r.data.full,false);assert.equal(e.db.prepare('SELECT status FROM task_plans').get().status,'paused');assert.equal(e.db.prepare('SELECT count(*) AS n FROM task_items').get().n,1);
});
test('newly archived reports cannot disguise old samples as post-action retests',async()=>{
 const e=env(),w=await seed(e);w.state.answers.push(answer('old','2000-01-01T00:00:00Z'));await call(e,'/api/state','PUT',w);await call(e,'/api/operations/actions','POST',{...action,diagnosis:undefined});await call(e,'/api/reports/archive','POST',{id:'new-report-old-samples-01',brandId:'b1',options:{period:'all'}});
 const r=await call(e,'/api/operations/actions','POST',{...action,revision:1,status:'已复核',note:'本次报告只是重新打包旧的回答',evidence:[{kind:'report',id:'new-report-old-samples-01'}]});assert.equal(r.status,400);assert.match(r.data.error,/没有待办创建之后的新样本/);
});
test('task tick evaluates station alerts and invalid calendar dates fail before writing',async()=>{
 const e=env();await seed(e);assert.equal((await call(e,'/api/operations/actions','POST',{...action,dueDate:'2026-99-99'})).status,400);
 const r=await call(e,'/api/tasks/tick','POST',{});assert.equal(r.status,200);assert.ok(r.data.alerts.checkedAt);assert.ok((await get(e)).data.scan.checkedAt);assert.equal((await get(e)).data.alerts.length,0);
});
test('consumer diagnostic retests reject unrelated or API evidence and preserve a server-owned review receipt',async()=>{
 const e=env(),w=await seed(e);w.state.brands[0].goalQuery='如何使用产品？';w.state.answers.push({...answer('review-original',new Date().toISOString()),productId:'',mode:'联网搜索',recommendationLabeled:true,recommended:false});await call(e,'/api/state','PUT',w);
 assert.equal((await call(e,'/api/operations/actions','POST',await decisionInput(e))).status,200);let a=(await get(e)).data.actions[0];assert.equal(a.origin.reviewPlan.schema,1);assert.equal(a.origin.reviewPlan.baseline.length,1);assert.equal(a.reviewReadiness.ready,false);
 const next=(await call(e,'/api/state')).data;const fresh={...answer('review-after',new Date(Date.now()+1000).toISOString(),false),productId:'',mode:'联网搜索',recommendationLabeled:true,recommended:false};next.state.answers.push(fresh,{...fresh,id:'review-api',surface:'api',entry:'api'},{...fresh,id:'review-other',questionText:'这是另一个问题？'},{...fresh,id:'review-unknown',recommendationLabeled:false});assert.equal((await call(e,'/api/state','PUT',next)).status,200);
 const request={id:a.id,brandId:'b1',revision:a.revision,title:a.title,description:a.description,assignee:'owner',dueDate:'',status:'已复核',note:'本轮真实回答已核对，未观察到推荐或引用，不推断指标提升。'};
 for(const id of ['review-api','review-other','review-unknown']){const r=await call(e,'/api/operations/actions','POST',{...request,evidence:[{kind:'answer',id}],reviewReceipt:{ready:true},origin:{reviewPlan:null}});assert.equal(r.status,400,id);assert.match(r.data.error,/诊断复测尚不能完成复核/);}
 const valid=await call(e,'/api/operations/actions','POST',{...request,evidence:[{kind:'answer',id:'review-after'}],reviewReceipt:{linkedAnswerIds:['fake']}});assert.equal(valid.status,200,JSON.stringify(valid.data));a=(await get(e)).data.actions[0];assert.equal(a.status,'已复核');assert.equal(a.reviewReadiness.ready,true);assert.deepEqual(a.reviewReceipt.linkedAnswerIds,['review-after']);assert.equal(a.reviewReceipt.coveredGroups,1);assert.ok(a.reviewReceipt.checkedAt);assert.match(a.reviewReceipt.method,/是否被推荐、是否改善/);assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
});
test('an archived report can supply fresh consumer retest evidence, and reopening clears the old completion receipt',async()=>{
 const e=env(),w=await seed(e);w.state.brands[0].goalQuery='如何使用产品？';await call(e,'/api/state','PUT',w);assert.equal((await call(e,'/api/operations/actions','POST',await decisionInput(e,'baseline'))).status,200);let a=(await get(e)).data.actions[0];
 const next=(await call(e,'/api/state')).data;next.state.answers.push({...answer('archive-fresh',new Date(Date.now()+1000).toISOString()),productId:'',mode:'联网搜索',recommendationLabeled:true,recommended:false});await call(e,'/api/state','PUT',next);assert.equal((await call(e,'/api/reports/archive','POST',{id:'review-complete-report-001',brandId:'b1',options:{period:'all'}})).status,200);
 const request={id:a.id,brandId:'b1',revision:a.revision,title:a.title,description:a.description,assignee:'owner',dueDate:'',status:'已复核',note:'真实基线已建立，后续效果另行比较。',evidence:[{kind:'report',id:'review-complete-report-001'}]};assert.equal((await call(e,'/api/operations/actions','POST',request)).status,200);a=(await get(e)).data.actions[0];assert.deepEqual(a.evidence[0].answerIds,['archive-fresh']);assert.deepEqual(a.reviewReceipt.linkedAnswerIds,['archive-fresh']);
 assert.equal((await call(e,'/api/operations/actions','POST',{...request,revision:a.revision,status:'处理中'})).status,200);a=(await get(e)).data.actions[0];assert.equal(a.reviewReceipt,null);
});

async function credibilityInput(e,id='facts'){
 const state=(await call(e,'/api/state')).data,report=makeReport(state.state,'b1',{period:'all'}),row=report.credibilityPlan.items.find(x=>x.id===id);
 return {id:crypto.randomUUID(),brandId:'b1',title:'待办',options:report.options,credibility:{id,token:await digest(credibilityToken(row,report))}};
}
test('credibility source rejects another brand, report range and legacy item-only tokens even when suggestion text matches',async()=>{
 const e=env();await seed(e);const input=await credibilityInput(e);
 for(const change of [{brandId:'b2'},{options:{...input.options,platform:'其他平台'}},{options:{...input.options,to:'2026-11-01'}},{options:{...input.options,surface:'api'}},{options:{...input.options,productId:'@brand'}}])assert.equal((await call(e,'/api/operations/actions','POST',{...input,...change,id:crypto.randomUUID()})).status,409);
 const w=(await call(e,'/api/state')).data,r=makeReport(w.state,'b1',input.options),row=r.credibilityPlan.items.find(x=>x.id==='facts');
 assert.equal((await call(e,'/api/operations/actions','POST',{...input,credibility:{id:'facts',token:await digest(credibilityToken(row))}})).status,409);
 assert.equal((await get(e)).data.actions.length,0);assert.equal((await call(e,'/api/operations/actions','POST',input)).status,200);const retry=await call(e,'/api/operations/actions','POST',input);assert.equal(retry.data.existing,true);assert.equal((await get(e)).data.actions.length,1);assert.equal((await call(e,'/api/operations/actions','POST',{...input,options:{...input.options,platform:'已存在 ID 也不能换范围'}})).status,409);
});
test('credibility fingerprint tracks material version changes even when counts and suggestion wording are unchanged',async()=>{
 const e=env();let w=await seed(e);w.state.facts.push({id:'fact-version',brandId:'b1',key:'服务',value:'提供资料整理服务',source:'https://brand.example/case',status:'已确认'});assert.equal((await call(e,'/api/state','PUT',w)).status,200);const input=await credibilityInput(e);w=(await call(e,'/api/state')).data;const before=makeReport(w.state,'b1',input.options);w.state.facts[0].reviewNote='补充核对说明，事实内容不变';assert.equal((await call(e,'/api/state','PUT',w)).status,200);const next=(await call(e,'/api/state')).data,after=makeReport(next.state,'b1',input.options);assert.deepEqual(after.credibilityPlan.signals,before.credibilityPlan.signals);assert.deepEqual(after.credibilityPlan.items,before.credibilityPlan.items);assert.equal((await call(e,'/api/operations/actions','POST',input)).status,409);assert.equal((await call(e,'/api/operations/actions','POST',await credibilityInput(e))).status,200);
});
test('credibility fingerprint tracks public URL and original-answer changes rather than only source counts',async()=>{
 for(const kind of ['publication','answer']){
  const e=env();let w=await seed(e);w.state.publications.push({id:'proof-url',brandId:'b1',title:'原始案例',url:'https://brand.example/first',status:'已发布'});w.state.answers.push(answer('source-answer',new Date().toISOString()));assert.equal((await call(e,'/api/state','PUT',w)).status,200);const input=await credibilityInput(e,'public-work');w=(await call(e,'/api/state')).data;const before=makeReport(w.state,'b1',input.options);
  if(kind==='publication')w.state.publications[0].url='https://brand.example/replaced';else w.state.answers[0].text='同数量的原回答被修改，不能复用旧报告';assert.equal((await call(e,'/api/state','PUT',w)).status,200);const next=(await call(e,'/api/state')).data,after=makeReport(next.state,'b1',input.options);assert.deepEqual(before.credibilityPlan.items,after.credibilityPlan.items);assert.equal((await call(e,'/api/operations/actions','POST',input)).status,409);
 }
});

test('credibility duplicate forms and concurrent requests reuse one server identity, including stopped and reviewed tasks',async()=>{
 for(const status of ['待处理','停止跟进','已复核']){
  const e=env();await seed(e);const input=await credibilityInput(e);const created=await Promise.all([call(e,'/api/operations/actions','POST',input),call(e,'/api/operations/actions','POST',{...input,id:crypto.randomUUID()})]);assert.deepEqual(created.map(x=>x.status),[200,200]);let list=(await get(e)).data.actions;assert.equal(list.length,1);assert.notEqual(list[0].id,input.id);
  const original=list[0],stored=e.db.prepare('SELECT body FROM operation_records WHERE id=?').get(original.id),body=JSON.parse(stored.body);body.status=status;body.history.push({at:new Date().toISOString(),actor:'fixture:historical',to:status,note:'只读历史夹具'});e.db.prepare('UPDATE operation_records SET body=? WHERE id=?').run(JSON.stringify(body),original.id);
  const retry=await call(e,'/api/operations/actions','POST',{...input,id:crypto.randomUUID(),status:'待处理'});assert.equal(retry.status,200);assert.equal(retry.data.existing,true);assert.equal(retry.data.action.status,status);assert.equal(retry.data.action.id,original.id);list=(await get(e)).data.actions;assert.equal(list.length,1);assert.deepEqual(list[0].history,body.history);
 }
});
test('credibility deterministic identity preserves legacy UUID records and only changed evidence can create a new action',async()=>{
 const e=env();await seed(e);const input=await credibilityInput(e),first=await call(e,'/api/operations/actions','POST',input),legacyId='legacy-credibility-uuid-00001';e.db.prepare('UPDATE operation_records SET id=? WHERE id=?').run(legacyId,first.data.id);const historical=e.db.prepare('SELECT body FROM operation_records WHERE id=?').get(legacyId).body;
 const retry=await call(e,'/api/operations/actions','POST',{...input,id:crypto.randomUUID()});assert.equal(retry.status,200);assert.equal(retry.data.action.id,legacyId);assert.equal(e.db.prepare('SELECT body FROM operation_records WHERE id=?').get(legacyId).body,historical);assert.equal((await get(e)).data.actions.length,1);
 const w=(await call(e,'/api/state')).data;w.state.facts.push({id:'new-credibility-fact',brandId:'b1',key:'补充材料',value:'新的材料版本需要独立处理',source:'https://brand.example/new',status:'待确认'});assert.equal((await call(e,'/api/state','PUT',w)).status,200);const fresh=await credibilityInput(e),saved=await call(e,'/api/operations/actions','POST',fresh);assert.equal(saved.status,200);assert.notEqual(saved.data.id,legacyId);assert.equal((await get(e)).data.actions.length,2);assert.equal(e.db.prepare('SELECT body FROM operation_records WHERE id=?').get(legacyId).body,historical);
});
