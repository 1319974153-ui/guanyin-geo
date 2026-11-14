import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {authorizeDesktopWechat} from '../local/wechat-authorization.mjs';
import {authorizedWechatCommand,authorizedWechatStep} from '../desktop/wechat-authorized-command.mjs';
import {dispatchId} from '../src/publish-dispatch-core.js';

async function call(env,path,method='GET',body,actor='local-owner',extra={}){
 const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':actor,'x-geo-request':'1','content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}),env);
 return {status:response.status,data:await response.json()};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const env={db,DB:d1Adapter(db),GEO_LOCAL_MODE:'true',GEO_DESKTOP_WECHAT_SESSION:'dw-'+'a'.repeat(64)};
 const w=(await call(env,'/api/state')).data;
 w.state.brands=[{id:'b1',name:'品牌一'},{id:'b2',name:'品牌二'}];w.state.currentBrand='b1';
 w.state.contents=[{id:'c1',brandId:'b1',title:'已审核原稿',text:'可核对的完整正文。',status:'已审核',ai:true,factSnapshots:[],demo:false}];
 assert.equal((await call(env,'/api/state','PUT',w)).status,200);
 const body={id:'pa-'+'b'.repeat(64),brandId:'b1',contentId:'c1',mode:'publish',confirmed:true,expiresAt:new Date(Date.now()+600000).toISOString(),targets:[{platform:'wechat',accountId:'personal-browser'}],media:[],executionPolicy:{frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0}};
 const mint=async(patch={})=>call(env,'/api/publish-authorizations','POST',{...body,...patch});
 const created=await mint();assert.equal(created.status,200,JSON.stringify(created.data));
 const input={authorizationId:body.id,desktopToken:created.data.authorization.desktopToken,brandId:'b1',contentId:'c1',mode:'publish',taskId:await dispatchId(w.state.contents[0],body.targets[0])};
 const mutate=patch=>{const row=db.prepare('SELECT body FROM workspaces WHERE owner=?').get('local-owner'),state=JSON.parse(row.body);patch(state);db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(state),'local-owner');};
 const changeRecord=patch=>{const row=db.prepare('SELECT result FROM runs WHERE owner=? AND id=?').get('local-owner',body.id),record=JSON.parse(row.result);patch(record);db.prepare('UPDATE runs SET result=? WHERE owner=? AND id=?').run(JSON.stringify(record),'local-owner',body.id);};
 return {env,body,input,mint,mutate,changeRecord,request:(action,data)=>authorizeDesktopWechat(env,data,action==='desktop-wechat-claim'?'claim':'prepare')};
}

test('desktop WeChat requires owner approval and produces canonical content with a one-time durable claim',async t=>{
 const x=await fixture(t),command=await authorizedWechatCommand(x.input,x.request);
 assert.equal(command.title,'已审核原稿');assert.match(command.html,/可核对的完整正文/);
 assert.equal(command.authorization.desktopToken,x.input.desktopToken);assert.equal(command.requested,false);
 const claims=await Promise.all([authorizeDesktopWechat(x.env,x.input,'claim'),authorizeDesktopWechat(x.env,x.input,'claim')]);
 assert.equal(claims.filter(c=>c.claimed).length,1);
 const replay=await authorizeDesktopWechat(x.env,x.input);assert.equal(replay.requested,true);assert.equal((await authorizeDesktopWechat(x.env,x.input,'claim')).claimed,false);
 assert.equal(x.env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='wechat-personal-intent'").get().n,1);
});

test('readable authorization IDs and public authorization history never disclose a desktop capability',async t=>{
 const x=await fixture(t);
 for(const response of [await call(x.env,'/api/publish-authorizations?brandId=b1'),await call(x.env,'/api/publish-authorizations/validate','POST',{id:x.body.id,brandId:'b1'})]){
  assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(response.data),new RegExp(x.input.desktopToken));assert.doesNotMatch(JSON.stringify(response.data),/desktopCapability|desktopToken/);
 }
 await assert.rejects(()=>authorizeDesktopWechat(x.env,{...x.input,desktopToken:undefined}),/缺少本次精确授权/);
 await assert.rejects(()=>authorizeDesktopWechat(x.env,{...x.input,desktopToken:'f'.repeat(64)}),/不匹配/);
});

test('desktop verifier refuses mismatched brand, article, action, stable task and caller content before creating an intent',async t=>{
 const x=await fixture(t);
 for(const patch of [{brandId:'b2'},{contentId:'c2'},{mode:'draft'},{taskId:'gy-'+'c'.repeat(64)},{title:'未审核替换标题'},{html:'<p>未审核替换正文</p>'}])await assert.rejects(()=>authorizeDesktopWechat(x.env,{...x.input,...patch}));
 assert.equal(x.env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='wechat-personal-intent'").get().n,0);
});

test('stored authorization must belong to the exact local owner and actor',async t=>{
 const x=await fixture(t);
 x.changeRecord(r=>r.requestedBy='invited-admin');await assert.rejects(()=>authorizeDesktopWechat(x.env,x.input),/不匹配/);
 x.changeRecord(r=>{r.requestedBy='local-owner';r.ownerId='other-owner';});await assert.rejects(()=>authorizeDesktopWechat(x.env,x.input),/不匹配/);
});
test('viewer, reviewer and invited admin cannot mint or reuse the local personal account authorization',async t=>{
 const x=await fixture(t);
 for(const role of ['viewer','reviewer','admin']){
  const email=role+'@example.com';assert.equal((await call(x.env,'/api/manage/members','POST',{email,role,brands:['b1']})).status,200);
  const headers={'x-geo-workspace':'local-owner','oai-authenticated-user-email':email};
  assert.equal((await call(x.env,'/api/publish-authorizations','POST',{...x.body,id:'pa-'+'e'.repeat(64)},role,headers)).status,403);
  const list=await call(x.env,'/api/publish-authorizations?brandId=b1','GET',undefined,role,headers);assert.equal(list.status,200);assert.doesNotMatch(JSON.stringify(list.data),new RegExp(x.input.desktopToken));
 }
});

test('a changed fact version invalidates an otherwise unchanged approved article',async t=>{
 const x=await fixture(t),fact={id:'fact1',brandId:'b1',value:'已核对的产品事实',source:'https://example.org/source',version:1,status:'已确认'};
 x.mutate(s=>{s.facts=[fact];s.contents[0].factSnapshots=[{id:fact.id,value:fact.value,source:fact.source,version:1}];});
 const created=await x.mint({id:'pa-'+'e'.repeat(64)});assert.equal(created.status,200);
 const state=JSON.parse(x.env.db.prepare('SELECT body FROM workspaces WHERE owner=?').get('local-owner').body);
 const input={...x.input,authorizationId:created.data.authorization.id,desktopToken:created.data.authorization.desktopToken,taskId:await dispatchId(state.contents[0],x.body.targets[0])};
 x.mutate(s=>s.facts[0].version=2);await assert.rejects(()=>authorizeDesktopWechat(x.env,input),/事实依据已变化/);
});

test('expired approval and desktop restart cannot authorize any fill or send',async t=>{
 const x=await fixture(t);x.changeRecord(r=>r.expiresAt=new Date(Date.now()-1000).toISOString());
 await assert.rejects(()=>authorizeDesktopWechat(x.env,x.input),/过期/);
 const y=await fixture(t);y.env.GEO_DESKTOP_WECHAT_SESSION='dw-'+'f'.repeat(64);await assert.rejects(()=>authorizeDesktopWechat(y.env,y.input),/连接已变化/);
});

test('draft changes and removed approval invalidate the exact desktop capability',async t=>{
 for(const patch of [s=>s.contents[0].text+='新的内容',s=>s.contents[0].status='草稿',s=>s.contents[0].demo=true,s=>s.brands=s.brands.filter(b=>b.id!=='b1')]){
  const x=await fixture(t);x.mutate(patch);await assert.rejects(()=>authorizeDesktopWechat(x.env,x.input));
  assert.equal(x.env.db.prepare("SELECT count(*) AS n FROM runs WHERE kind='wechat-personal-intent'").get().n,0);
 }
});

test('WeChat authorization is unavailable to hosted sessions, other owners, mixed targets and media',async t=>{
 const x=await fixture(t);
 const other=await call(x.env,'/api/state','GET',undefined,'other-owner');other.data.state.brands=[{id:'b1',name:'其他'}];other.data.state.contents=[{id:'c1',brandId:'b1',title:'标题',text:'内容',status:'已审核'}];
 assert.equal((await call(x.env,'/api/state','PUT',other.data,'other-owner')).status,200);
 assert.equal((await call(x.env,'/api/publish-authorizations','POST',{...x.body,id:'pa-'+'c'.repeat(64)},'other-owner')).status,403);
 x.env.GEO_LOCAL_MODE='false';assert.equal((await x.mint({id:'pa-'+'d'.repeat(64)})).status,403);x.env.GEO_LOCAL_MODE='true';
 assert.equal((await x.mint({id:'pa-'+'d'.repeat(64),media:[{sha256:'e'.repeat(64)}]})).status,400);
 assert.equal((await x.mint({id:'pa-'+'d'.repeat(64),targets:[...x.body.targets,{platform:'wordpress',accountId:'default'}]})).status,403);
});

test('the dispatch coordinator revalidates immediately before clicking and never sends after stale approval',async t=>{
 const x=await fixture(t),task=await authorizedWechatCommand(x.input,x.request),pages=[],persisted=[];
 await assert.rejects(()=>authorizedWechatStep(task,{request:x.request,persist:async p=>persisted.push(p),page:async command=>{pages.push(command);x.mutate(s=>s.contents[0].text+='已改变');return {state:'ready_to_request'};}}),/变化/);
 assert.equal(pages.length,1);assert.equal(pages[0].dispatch,false);assert.deepEqual(persisted,[]);
});
test('atomic claim refuses a workspace edit or approval revocation that races after validation',async t=>{
 for(const change of [x=>x.mutate(s=>s.contents[0].text+='并发修改'),x=>x.env.db.prepare("UPDATE runs SET state='revoked' WHERE owner=? AND id=?").run('local-owner',x.body.id),x=>x.changeRecord(r=>r.expiresAt=new Date(Date.now()-1000).toISOString())]){
  const x=await fixture(t),task=await authorizedWechatCommand(x.input,x.request),base=x.env.DB;let raced=false,clicks=0;
  x.env.DB={...base,prepare(sql){const prepared=base.prepare(sql);return {bind(...args){const stmt=prepared.bind(...args);if(!sql.startsWith("UPDATE runs SET state='requested'"))return stmt;return {...stmt,async run(){if(!raced){raced=true;change(x);}return stmt.run();}};}};}};
  await assert.rejects(()=>authorizedWechatStep(task,{request:x.request,persist:async p=>Object.assign(task,p),page:async c=>{if(c.dispatch)clicks++;return {state:'ready_to_request'};}}),/发送前已变化/);
  assert.equal(raced,true);assert.equal(clicks,0);assert.equal(task.requested,false);assert.equal(x.env.db.prepare('SELECT state FROM runs WHERE id=?').get(x.input.taskId).state,'registered');
 }
});

test('successful step persists protection before a single click and does not leak authorization into the page',async t=>{
 const x=await fixture(t),task=await authorizedWechatCommand(x.input,x.request),order=[],pages=[];
 const hooks={request:x.request,persist:async patch=>{order.push('persist');Object.assign(task,patch)},page:async command=>{pages.push(command);order.push(command.dispatch?'click':'read');return {state:command.dispatch?'publish_requested':'ready_to_request'};}};
 await authorizedWechatStep(task,hooks);assert.deepEqual(order,['read','persist','click']);
 assert.ok(pages.every(p=>!('authorization' in p)&&!('desktopToken' in p)));
 await authorizedWechatStep(task,hooks);assert.equal(pages.filter(p=>p.dispatch).length,1);assert.equal(pages.at(-1).requested,true);
});

test('legacy and startup tasks cannot fill or send, and unknown claim response is not retried',async t=>{
 const x=await fixture(t),task=await authorizedWechatCommand(x.input,x.request);let fills=0;
 const stopped=await authorizedWechatStep(task,{observeOnly:true,page:async()=>{fills++},request:x.request,persist:async()=>{}});assert.equal(stopped.state,'blocked');assert.equal(fills,0);
 await assert.rejects(()=>authorizedWechatStep({...task,authorization:undefined},{request:x.request,page:async()=>{fills++}}),/缺少有效授权/);assert.equal(fills,0);
 let clicks=0;const failClaim=async(action,data)=>{if(action==='desktop-wechat-claim'){await x.request(action,data);throw Error('本机服务响应超时');}return x.request(action,data);};
 await assert.rejects(()=>authorizedWechatStep(task,{request:failClaim,persist:async p=>Object.assign(task,p),page:async c=>{if(c.dispatch)clicks++;return {state:'ready_to_request'}}}),/超时/);
 await authorizedWechatStep(task,{request:x.request,persist:async p=>Object.assign(task,p),page:async c=>{if(c.dispatch)clicks++;return {state:'waiting_receipt'}}});assert.equal(clicks,0);assert.equal(task.requested,true);
});
