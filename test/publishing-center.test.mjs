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
function connection(e,patch={},owner='owner',brand='b1'){
 e.db.prepare('INSERT OR REPLACE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run(owner,'wordpress:'+brand,JSON.stringify({brandId:brand,site:'https://example.org/',username:'author',enabled:true,revision:'fixture-revision',verifiedAt:'2026-10-16T00:00:00.000Z',userId:7,canPublish:true,...patch}),'never-return-this-secret','2026-10-16T00:00:00.000Z');
}
const read=e=>call(e,'/api/publishing-center?brandId=b1');

test('publishing directory never represents planned connectors or exports as automatic publishers',async t=>{
 const e=environment(t);await seed(e);const r=await read(e);assert.equal(r.status,200);
 assert.equal(r.data.batchPublishingAvailable,false);assert.equal(r.data.accounts.length,0);
 assert.deepEqual(r.data.platforms.filter(p=>p.implementation==='adapter_available').map(p=>p.id),['wordpress']);
 assert.equal(new Set(r.data.platforms.map(p=>p.id)).size,r.data.platforms.length);
 for(const p of r.data.platforms.filter(p=>p.implementation==='planned')){assert.deepEqual(p.contentTypes,[]);assert.equal(p.connectionMethod,null);assert.equal(p.acceptance,'not_implemented');}
 assert.deepEqual(r.data.platforms.filter(p=>p.implementation==='browser_adapter_acceptance').map(p=>p.id).sort(),['51cto','aliyun','csdn','douyin','tencentcloud','toutiao','xiaohongshu','zhihu']);
 assert.deepEqual(r.data.platforms.filter(p=>p.referenceIncluded).map(p=>p.id).sort(),['wechat','weibo','zhihu','juejin','baijiahao','cnblogs','douyin_article','douyin','xiaohongshu_article','xiaohongshu','toutiao','51cto','jianshu','segmentfault','oschina','bilibili','tencentcloud','aliyun'].sort());
 for(const id of ['douyin_article','xiaohongshu_article'])assert.equal(r.data.platforms.find(p=>p.id===id).implementation,'planned');
 const aliyun=r.data.platforms.find(p=>p.id==='aliyun');assert.equal(aliyun.connectionMethod,'desktop_browser');assert.equal(aliyun.actionEvidence.draft.implemented,true);assert.equal(aliyun.actionEvidence.draft.liveAcceptance,'passed');assert.equal(aliyun.actionEvidence.publish.implemented,true);
 assert.equal(aliyun.actionEvidence.publish.liveAcceptance,'pending');
 assert.ok(r.data.platforms.every(p=>p.accountRequired&&!p.capabilities));
 assert.ok(r.data.exports.every(p=>p.kind==='local_export'));
});
test('account view scopes owner and brand, omits credentials, and does not contact platforms',async t=>{
 const e=environment(t);await seed(e);connection(e);connection(e,{username:'other-brand'},'owner','b2');connection(e,{username:'other-owner'},'other');
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('unexpected external request')};t.after(()=>globalThis.fetch=old);
 const r=await read(e);assert.equal(r.status,200);assert.equal(r.data.accounts.length,1);
 const a=r.data.accounts[0];assert.equal(a.username,'author');assert.equal(a.remoteAccountId,'7');assert.equal(a.status,'verified');assert.equal(a.verification,'last_saved_check');assert.equal(a.capabilities.publish,true);
 assert.ok(!JSON.stringify(r).includes('never-return'));assert.ok(!JSON.stringify(r).includes('other-owner'));assert.ok(!JSON.stringify(r).includes('other-brand'));
 assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
});
test('saved credentials, disabled connections and limited permissions do not imply publishing eligibility',async t=>{
 const e=environment(t);await seed(e);
 for(const [patch,status,draft,publish] of [[{verifiedAt:null},'unverified',false,false],[{userId:null},'unverified',false,false],[{enabled:false},'disabled',false,false],[{canPublish:false},'permission_limited',true,false]]){
  connection(e,patch);const a=(await read(e)).data.accounts[0];assert.equal(a.status,status);assert.equal(a.capabilities.createDraft,draft);assert.equal(a.capabilities.publish,publish);
 }
});
test('unauthorized brands and other owners cannot read publishing accounts',async t=>{
 const e=environment(t);await seed(e);connection(e);
 assert.equal((await call(e,'/api/publishing-center?brandId=missing')).status,404);
 assert.equal((await call(e,'/api/publishing-center?brandId=b1','GET',null,'stranger')).status,404);
 assert.equal((await call(e,'/api/manage/members','POST',{email:'viewer@example.com',role:'viewer',brands:['b2']})).status,200);
 const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'viewer@example.com'};
 assert.equal((await call(e,'/api/publishing-center?brandId=b1','GET',null,'viewer',headers)).status,404);
 connection(e,{},'owner','b2');const r=await call(e,'/api/publishing-center?brandId=b2','GET',null,'viewer',headers);
 assert.equal(r.status,200);assert.equal(r.data.accounts[0].capabilities.publish,false);assert.equal(r.data.accounts[0].capabilities.createDraft,false);
});
test('publishing directory is read-only and corrupt account metadata fails closed',async t=>{
 const e=environment(t);await seed(e);
 assert.equal((await call(e,'/api/publishing-center','POST',{brandId:'b1'})).status,405);
 assert.equal((await call(e,'/api/publishing-center/unknown?brandId=b1')).status,404);
 connection(e,{brandId:'b2'});assert.equal((await read(e)).status,409);
 e.db.prepare("UPDATE connections SET model='invalid-json'").run();assert.equal((await read(e)).status,409);
});
