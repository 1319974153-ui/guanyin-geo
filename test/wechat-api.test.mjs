import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(t){
 const db=new DatabaseSync(':memory:');
 for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 t.after(()=>db.close());return{DB:d1Adapter(db),db};
}
async function call(e,path,method='GET',body,actor='owner',headers={}){
 const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':actor,'x-geo-request':'1',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);
 return{status:r.status,data:await r.json()};
}
async function seed(e){
 const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'测试甲'},{id:'b2',name:'测试乙'}];
 assert.equal((await call(e,'/api/state','PUT',w)).status,200);
}

test('local handoff exports reviewed real content without external calls',async t=>{
 const e=environment(t);await seed(e);const w=(await call(e,'/api/state')).data;
 w.state.contents=[{id:'c1',brandId:'b1',title:'订单交接',text:'## 操作流程\n\n核对订单。',status:'已审核',ai:true},{id:'c2',brandId:'b2',title:'其他品牌',text:'不可越权',status:'已审核'}];
 assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('local handoff must not call external service');t.after(()=>globalThis.fetch=old);
 const r=await call(e,'/api/wechat/package?brandId=b1&contentId=c1&author=温舒');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.liveEnabled,false);assert.equal(r.data.package.author,'温舒');assert.match(r.data.package.content,/AI 辅助/);
 assert.equal((await call(e,'/api/wechat/package?brandId=b1&contentId=c2')).status,400);
 assert.equal((await call(e,'/api/wechat/package?brandId=b1&contentId=c1','GET',null,'stranger')).status,404);
 assert.equal((await call(e,'/api/wechat/publish','POST',{brandId:'b1'})).status,405);
 const readiness=(await call(e,'/api/wechat/readiness?brandId=b1&accountType=personal')).data;assert.equal(readiness.publish,false);assert.equal(readiness.createDraft,false);
 assert.equal(e.db.prepare('SELECT count(*) n FROM runs').get().n,0);
});
test('unreviewed, demo and stale facts cannot be exported as approved articles',async t=>{
 const e=environment(t);await seed(e);
 for(const extra of [{status:'待审核'},{demo:true},{factSnapshots:[{id:'missing',value:'unsupported'}]}]){
 const w=(await call(e,'/api/state')).data;w.state.contents=[{id:'c1',brandId:'b1',title:'订单交接',text:'正文',status:'已审核',...extra}];e.db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(w.state),'owner');
 assert.notEqual((await call(e,'/api/wechat/package?brandId=b1&contentId=c1')).status,200);
 }
});
