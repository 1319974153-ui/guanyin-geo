import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(t){
 const db=new DatabaseSync(':memory:');
 for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const external=t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected external request')});
 t.after(()=>assert.equal(external.mock.callCount(),0,'reading publishing availability must not contact a platform'));
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
 const account=patch.accountId&&patch.accountId!=='default'?':'+patch.accountId:'';
 e.db.prepare('INSERT OR REPLACE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run(owner,'wordpress:'+brand+account,JSON.stringify({brandId:brand,site:'https://example.org/',username:'author',enabled:true,revision:'fixture-revision',verifiedAt:'2026-10-16T00:00:00.000Z',userId:7,canPublish:true,...patch}),'never-return-this-secret','2026-10-16T00:00:00.000Z');
}
function apiConnection(e,platform,patch={},owner='owner',brand='b1'){
 const prefixes={cnblogs:'cb-',typecho:'tc-',metaweblog:'mw-',yuque:'yq-'},accountId=patch.accountId||(platform==='personal-site'?'site-test':prefixes[platform]+'00000000-0000-0000-0000-000000000001');
 const model={brandId:brand,accountId,site:'https://example.org/',username:platform+'-author',enabled:true,revision:'fixture-revision',verifiedAt:'2026-10-16T00:00:00.000Z',blog:'author',blogId:'1',userId:7,endpoint:'https://example.org/xmlrpc.php',repoId:'9',groupLogin:'author',bookSlug:'articles',canPublish:true,...patch};
 e.db.prepare('INSERT OR REPLACE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run(owner,platform+':'+brand+':'+accountId,JSON.stringify(model),'never-return-this-secret','2026-10-16T00:00:00.000Z');
 return model;
}
function summary(data,connected,draft,publish){
 assert.deepEqual(data.batchPublishingSummary,{connected,draft,publish,scope:'self_hosted_and_api_accounts_only'});
 assert.equal(data.batchPublishingAvailable,connected>0);
}
const read=e=>call(e,'/api/publishing-center?brandId=b1');

test('publishing directory never represents planned connectors or exports as automatic publishers',async t=>{
 const e=environment(t);await seed(e);const r=await read(e);assert.equal(r.status,200);
 summary(r.data,0,0,0);assert.equal(r.data.accounts.length,0);
 assert.deepEqual(r.data.platforms.filter(p=>p.implementation==='adapter_available').map(p=>p.id),['wordpress']);
 assert.equal(new Set(r.data.platforms.map(p=>p.id)).size,r.data.platforms.length);
 for(const p of r.data.platforms.filter(p=>p.implementation==='planned')){assert.deepEqual(p.contentTypes,[]);assert.equal(p.connectionMethod,null);assert.equal(p.acceptance,'not_implemented');}
 assert.deepEqual(r.data.platforms.filter(p=>p.implementation==='browser_adapter_acceptance').map(p=>p.id).sort(),['51cto','aliyun','baijiahao','bilibili','csdn','douyin','jianshu','juejin','netease','oschina','segmentfault','sohu','tencentcloud','toutiao','weibo','xiaohongshu','zhihu']);
 const wechat=r.data.platforms.find(p=>p.id==='wechat');assert.equal(wechat.implementation,'desktop_personal_browser');assert.equal(wechat.connectionMethod,'desktop_personal_browser');assert.deepEqual(wechat.contentTypes,['article']);assert.equal(wechat.acceptance,'live_acceptance_pending');
 const segmentfault=r.data.platforms.find(p=>p.id==='segmentfault');assert.equal(segmentfault.connectionMethod,'desktop_browser');assert.equal(segmentfault.actionEvidence.prepare.implemented,true);assert.equal(segmentfault.actionEvidence.draft.implemented,false);assert.equal(segmentfault.actionEvidence.publish.implemented,false);
 const xiaohongshu=r.data.platforms.find(p=>p.id==='xiaohongshu');assert.equal(xiaohongshu.actionEvidence.prepare.implemented,true);assert.equal(xiaohongshu.actionEvidence.prepare.liveAcceptance,'pending');assert.equal(xiaohongshu.actionEvidence.publish.implemented,true);assert.equal(xiaohongshu.actionEvidence.publish.liveAcceptance,'pending');
 const oschina=r.data.platforms.find(p=>p.id==='oschina');assert.equal(oschina.connectionMethod,'desktop_browser');assert.equal(oschina.actionEvidence.prepare.implemented,true);assert.equal(oschina.actionEvidence.draft.implemented,false);assert.equal(oschina.actionEvidence.publish.implemented,true);assert.equal(oschina.actionEvidence.publish.liveAcceptance,'pending');
 const jianshu=r.data.platforms.find(p=>p.id==='jianshu');assert.equal(jianshu.connectionMethod,'desktop_browser');assert.equal(jianshu.actionEvidence.prepare.implemented,true);assert.equal(jianshu.actionEvidence.draft.implemented,false);assert.equal(jianshu.actionEvidence.publish.implemented,true);assert.equal(jianshu.actionEvidence.publish.liveAcceptance,'pending');
 const bilibili=r.data.platforms.find(p=>p.id==='bilibili');assert.equal(bilibili.connectionMethod,'desktop_browser');assert.equal(bilibili.actionEvidence.prepare.implemented,true);assert.equal(bilibili.actionEvidence.draft.implemented,false);assert.equal(bilibili.actionEvidence.publish.implemented,true);assert.equal(bilibili.actionEvidence.publish.liveAcceptance,'pending');
 const weibo=r.data.platforms.find(p=>p.id==='weibo');assert.equal(weibo.connectionMethod,'desktop_browser');assert.equal(weibo.actionEvidence.prepare.implemented,true);assert.equal(weibo.actionEvidence.draft.implemented,false);assert.equal(weibo.actionEvidence.publish.implemented,true);assert.equal(weibo.actionEvidence.publish.liveAcceptance,'pending');
 const sohu=r.data.platforms.find(p=>p.id==='sohu');assert.equal(sohu.connectionMethod,'desktop_browser');assert.equal(sohu.actionEvidence.prepare.implemented,true);assert.equal(sohu.actionEvidence.draft.implemented,false);assert.equal(sohu.actionEvidence.publish.implemented,true);assert.equal(sohu.actionEvidence.publish.liveAcceptance,'pending');
 const netease=r.data.platforms.find(p=>p.id==='netease');assert.equal(netease.connectionMethod,'desktop_browser');assert.equal(netease.actionEvidence.prepare.implemented,true);assert.equal(netease.actionEvidence.draft.implemented,false);assert.equal(netease.actionEvidence.publish.implemented,true);assert.equal(netease.actionEvidence.publish.liveAcceptance,'pending');
 const baijiahao=r.data.platforms.find(p=>p.id==='baijiahao');assert.equal(baijiahao.connectionMethod,'desktop_browser');assert.equal(baijiahao.actionEvidence.prepare.implemented,true);assert.equal(baijiahao.actionEvidence.draft.implemented,false);assert.equal(baijiahao.actionEvidence.publish.implemented,false);
 assert.deepEqual(r.data.platforms.filter(p=>p.referenceIncluded).map(p=>p.id).sort(),['wechat','weibo','zhihu','juejin','baijiahao','cnblogs','douyin_article','douyin','xiaohongshu_article','xiaohongshu','toutiao','51cto','jianshu','segmentfault','oschina','bilibili','tencentcloud','aliyun'].sort());
 for(const id of ['douyin_article','xiaohongshu_article'])assert.equal(r.data.platforms.find(p=>p.id===id).implementation,'planned');
 const juejin=r.data.platforms.find(p=>p.id==='juejin');assert.equal(juejin.connectionMethod,'desktop_browser');assert.equal(juejin.actionEvidence.draft.liveAcceptance,'passed');assert.equal(juejin.actionEvidence.publish.implemented,true);assert.equal(juejin.actionEvidence.publish.liveAcceptance,'pending');
 const aliyun=r.data.platforms.find(p=>p.id==='aliyun');assert.equal(aliyun.connectionMethod,'desktop_browser');assert.equal(aliyun.actionEvidence.draft.implemented,true);assert.equal(aliyun.actionEvidence.draft.liveAcceptance,'passed');assert.equal(aliyun.actionEvidence.publish.implemented,true);
 assert.equal(aliyun.actionEvidence.publish.liveAcceptance,'pending');
 assert.ok(r.data.platforms.every(p=>p.accountRequired&&!p.capabilities));
 assert.ok(r.data.exports.every(p=>p.kind==='local_export'));
});
test('account view scopes owner and brand, omits credentials, and does not contact platforms',async t=>{
 const e=environment(t);await seed(e);connection(e);connection(e,{username:'other-brand'},'owner','b2');connection(e,{username:'prefix-brand'},'owner','b10');connection(e,{username:'other-owner'},'other');
 const r=await read(e);assert.equal(r.status,200);assert.equal(r.data.accounts.length,1);
 summary(r.data,1,1,1);
 const a=r.data.accounts[0];assert.equal(a.username,'author');assert.equal(a.remoteAccountId,'7');assert.equal(a.status,'verified');assert.equal(a.verification,'last_saved_check');assert.equal(a.capabilities.publish,true);
 assert.ok(!JSON.stringify(r).includes('never-return'));assert.ok(!JSON.stringify(r).includes('other-owner'));assert.ok(!JSON.stringify(r).includes('other-brand'));
 assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
});
test('saved credentials, disabled connections and limited permissions do not imply publishing eligibility',async t=>{
 const e=environment(t);await seed(e);
 for(const [patch,status,draft,publish] of [[{verifiedAt:null},'unverified',false,false],[{userId:null},'unverified',false,false],[{enabled:false},'disabled',false,false],[{enabled:'false'},'disabled',false,false],[{canPublish:false},'permission_limited',true,false]]){
  connection(e,patch);const d=(await read(e)).data,a=d.accounts[0];assert.equal(a.status,status);assert.equal(a.capabilities.createDraft,draft);assert.equal(a.capabilities.publish,publish);summary(d,draft||publish?1:0,Number(draft),Number(publish));
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
 summary(r.data,0,0,0);
});
test('availability counts eligible accounts, not platforms or other workspaces and brands',async t=>{
 const e=environment(t);await seed(e);connection(e);connection(e,{accountId:'wp-00000000-0000-0000-0000-000000000002',canPublish:false});
 for(const platform of ['cnblogs','typecho','metaweblog','yuque']){
  apiConnection(e,platform);apiConnection(e,platform,{username:'other-brand'},'owner','b2');apiConnection(e,platform,{username:'prefix-brand'},'owner','b10');apiConnection(e,platform,{username:'other-owner'},'other');
 }
 const site=apiConnection(e,'personal-site');e.GEO_LOCAL_MODE='true';e.STATIC_SITE={list:()=>[{id:site.accountId,site:site.site}]};
 e.db.prepare('INSERT INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run('owner','xiaohongshu:b1:desktop-account',JSON.stringify({brandId:'b1',accountId:'desktop-account',enabled:true,verifiedAt:'2026-10-16T00:00:00.000Z',canPublish:true}),'desktop-secret','2026-10-16T00:00:00.000Z');
 const r=await read(e);assert.equal(r.status,200);summary(r.data,7,7,6);assert.equal(r.data.accounts.length,7);
 assert.ok(!JSON.stringify(r.data).includes('other-brand'));assert.ok(!JSON.stringify(r.data).includes('prefix-brand'));assert.ok(!JSON.stringify(r.data).includes('other-owner'));assert.ok(!JSON.stringify(r.data.accounts).includes('desktop-account'));
 assert.equal(e.db.prepare('SELECT count(*) AS n FROM runs').get().n,0);
});
test('API availability excludes paused and unverified accounts and keeps draft-only permissions',async t=>{
 const e=environment(t);await seed(e);
 for(const platform of ['cnblogs','typecho','metaweblog','yuque','personal-site']){
  for(const patch of [{enabled:false},{enabled:'false'},{verifiedAt:null},{blogId:null}]){
   e.db.prepare('DELETE FROM connections').run();const site=apiConnection(e,platform,patch);e.GEO_LOCAL_MODE='true';e.STATIC_SITE={list:()=>[{id:site.accountId,site:site.site}]};
   const r=await read(e);assert.equal(r.status,200);summary(r.data,0,0,0);assert.equal(r.data.accounts[0].capabilities.createDraft,false);assert.equal(r.data.accounts[0].capabilities.publish,false);
  }
 }
 e.db.prepare('DELETE FROM connections').run();apiConnection(e,'yuque',{canPublish:false});
 const r=await read(e);assert.equal(r.status,200);summary(r.data,1,1,0);assert.equal(r.data.accounts[0].status,'permission_limited');assert.equal(r.data.accounts[0].verification,'api_access_and_repo_read');
});
test('personal site eligibility requires its matching local publishing connection',async t=>{
 const e=environment(t);await seed(e);const site=apiConnection(e,'personal-site');
 summary((await read(e)).data,0,0,0);e.GEO_LOCAL_MODE='true';summary((await read(e)).data,0,0,0);
 e.STATIC_SITE={list:()=>[{id:site.accountId,site:'https://different.example/'}]};summary((await read(e)).data,0,0,0);
 e.STATIC_SITE={list:()=>[{id:site.accountId,site:site.site}]};summary((await read(e)).data,1,1,1);
});
test('current member role limits the same accounts without counting read-only access',async t=>{
 const e=environment(t);await seed(e);connection(e);apiConnection(e,'yuque');
 for(const role of ['viewer','reviewer','editor','admin']){
  const email=role+'@example.com';assert.equal((await call(e,'/api/manage/members','POST',{email,role,brands:['b1']})).status,200);
  const r=await call(e,'/api/publishing-center?brandId=b1','GET',null,role,{'x-geo-workspace':'owner','oai-authenticated-user-email':email});
  assert.equal(r.status,200);assert.equal(r.data.accounts.length,2);const n=['editor','admin'].includes(role)?2:0;summary(r.data,n,n,n);
 }
});
test('an unauthenticated request cannot read account availability',async t=>{
 const e=environment(t);await seed(e);connection(e);
 const r=await worker.fetch(new Request('https://geo.test/api/publishing-center?brandId=b1'),e);assert.equal(r.status,401);assert.equal((await r.json()).batchPublishingSummary,undefined);
});
test('publishing directory is read-only and corrupt account metadata fails closed',async t=>{
 const e=environment(t);await seed(e);
 assert.equal((await call(e,'/api/publishing-center','POST',{brandId:'b1'})).status,405);
 assert.equal((await call(e,'/api/publishing-center/unknown?brandId=b1')).status,404);
 connection(e,{brandId:'b2'});assert.equal((await read(e)).status,409);
 e.db.prepare("UPDATE connections SET model='invalid-json'").run();assert.equal((await read(e)).status,409);
});
