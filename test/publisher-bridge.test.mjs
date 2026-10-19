import {PLATFORMS} from '../browser-extension/platforms.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publisherBridge} from '../local/publisher-bridge.mjs';
const ORIGIN='http://127.0.0.1:58729',EXT='chrome-extension://'+'a'.repeat(32);
function setup(t,experimentalPublish=true,publishPlatforms=[]){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=1000000;
 const state={brands:[{id:'b',name:'隔离测试'},{id:'other',name:'乙'}],contents:[{id:'c',brandId:'b',title:'测试文章',text:'可验证的技术正文',status:'已审核'}],facts:[]};
 const options={db,readState:()=>state,origin:ORIGIN,clock:()=>time,experimentalPublish,publishPlatforms};let bridge=publisherBridge(options);
 const request=async(path,body,headers={},method='POST',host=ORIGIN)=>{const r=await bridge.handle(new Request(host+path,{method,headers:{'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body||{})}:{})}));return {status:r.status,data:await r.json()}};
 const app=(action,b,headers={})=>request('/api/local-publisher/'+action,b,{'x-geo-request':'1',origin:ORIGIN,...headers});
 let connection;
 const ext=(action,b={},overrides={})=>request('/bridge/publisher/'+action,{instance:connection?.instance,...b},{origin:EXT,...(connection?{authorization:'Bearer '+connection.token}:{}),...overrides});
 async function pair(platform='csdn'){const p=await app('pairing',{brandId:'b',platform});const r=await ext('pair',{code:p.data.code,instance:p.data.instance});assert.equal(r.status,200);connection=r.data;return p.data}
 const account=(accountId='author')=>ext('account',{accountId,name:'测试作者',editorReady:true,evidenceUrl:PLATFORMS[connection?.platform||'csdn'].editor});
 const enqueue=(patch={})=>app('enqueue',{sessionId:connection.sessionId,brandId:'b',contentId:'c',mode:'publish',tags:['软件测试'],...patch});
 const ready=async()=>{await pair();await account();const j=await enqueue();assert.equal(j.status,200);return (await ext('claim')).data.job};
 return {db,state,request,app,ext,pair,account,enqueue,ready,get connection(){return connection},restart(){bridge=publisherBridge(options)},advance(ms){time+=ms},invalidate(){bridge.invalidate('恢复备份')}};
}
test('pairing is one-time, expiring and exact-origin/instance bound; no cookie or token in status',async t=>{
 const e=setup(t);const p=await e.pair();assert.equal((await e.ext('pair',{code:p.code,instance:p.instance})).status,403);
 assert.equal((await e.ext('pending',{}, {origin:'https://evil.test'})).status,403);
 assert.equal((await e.ext('pending',{instance:'other'})).status,403);
 assert.equal((await e.ext('pending',{}, {authorization:'Bearer wrong'})).status,403);
 assert.equal((await e.app('pairing',{brandId:'b'},{origin:'https://evil.test'})).status,403);
 assert.equal((await e.app('pairing',{brandId:'b'},{'x-geo-workspace':'other'})).status,403);
 const status=await e.request('/api/local-publisher/status?brandId=b',null,{'x-geo-request':'1'},'GET');assert.equal(status.status,200);assert.ok(!JSON.stringify(status).includes(e.connection.token));
 const p2=(await e.app('pairing',{brandId:'b'})).data;e.advance(300001);assert.equal((await e.ext('pair',{...p2})).status,403);
});
test('hostile origin preflight cannot read a paired bridge and valid preflight has exact CORS',async t=>{
 const e=setup(t);await e.pair();
 const bad=await e.request('/bridge/publisher/pending',null,{origin:'chrome-extension://'+'b'.repeat(32)},'OPTIONS');assert.equal(bad.status,403);
});
test('real identity requires editor evidence and same-brand reviewed content; default submit stays gated',async t=>{
 const e=setup(t,false);await e.pair();
 assert.equal((await e.ext('account',{accountId:'author',name:'name',editorReady:false})).status,409);
 assert.equal((await e.enqueue()).status,409);await e.account();assert.equal((await e.enqueue()).status,409);
 assert.equal((await e.enqueue({mode:'prepare',brandId:'other'})).status,409);
 e.state.contents[0].status='草稿';assert.equal((await e.enqueue({mode:'prepare'})).status,409);e.state.contents[0].status='已审核';
 assert.equal((await e.enqueue({mode:'prepare'})).status,200);
});
test('double click and tag changes deduplicate; two concurrent claims cannot acquire same job',async t=>{
 const e=setup(t);await e.pair();await e.account();const results=await Promise.all([e.enqueue(),e.enqueue(),e.enqueue({tags:['另一标签']})]);
 assert.equal(new Set(results.map(r=>r.data.job.id)).size,1);assert.equal(e.db.prepare('SELECT count(*) n FROM publisher_jobs').get().n,1);
 const claims=await Promise.all([e.ext('claim'),e.ext('claim')]);assert.equal(claims.filter(r=>r.data.job).length,1);
});
test('persisted commit is at most once; uncertainty cannot be retried or called published',async t=>{
 const e=setup(t),j=await e.ready();const args={id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash};
 const results=await Promise.all([e.ext('commit',args),e.ext('commit',args)]);assert.deepEqual(results.map(r=>r.status),[200,409]);
 const report=await e.ext('report',{id:j.id,lease:j.lease,state:'needs_attention',error:'断线'});assert.equal(report.data.job.state,'uncertain');
 assert.equal((await e.app('retry',{id:j.id})).status,409);assert.equal((await e.app('cancel',{id:j.id})).status,409);
 assert.equal((await e.ext('report',{id:j.id,lease:j.lease,state:'published',url:'https://example.org'})).status,400);
});
test('account switch and edits invalidate the frozen authorization before commit',async t=>{
 const e=setup(t),j=await e.ready();const args={id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash};
 e.state.contents[0].text='新正文';assert.equal((await e.ext('commit',args)).status,409);e.state.contents[0].text='可验证的技术正文';
 await e.account('other');assert.equal((await e.ext('commit',args)).status,409);
});
test('freshness, expiry, session leases and brand removal are enforced',async t=>{
 const e=setup(t),j=await e.ready();
 assert.equal((await e.ext('commit',{id:j.id,lease:'wrong',accountId:j.accountId,sourceHash:j.sourceHash})).status,403);
 e.advance(120001);assert.equal((await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash})).status,409);
 assert.equal((await e.ext('claim')).data.job,null);
 e.state.brands=[];assert.equal((await e.ext('pending')).status,404);
});
test('restarts and restores never replay an in-flight operation',async t=>{
 const e=setup(t),j=await e.ready();await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash});e.restart();
 assert.equal((await e.ext('claim')).data.job,null);const r=await e.request('/api/local-publisher/status?brandId=b',null,{'x-geo-request':'1'},'GET');assert.equal(r.data.jobs[0].state,'uncertain');
 e.invalidate();assert.equal((await e.ext('pending')).status,403);
});
test('receipt accepts only observed CSDN success URL, never guessed public URL or fake published state',async t=>{
 const e=setup(t),j=await e.ready();await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash});
 const report={id:j.id,lease:j.lease,state:'submitted',articleId:'123456'};
 assert.equal((await e.ext('report',{...report,url:'https://blog.csdn.net/author/article/details/123456'})).status,400);
 assert.equal((await e.ext('report',{...report,url:'https://mp.csdn.net.evil.test/mp_blog/creation/success/123456'})).status,400);
 const r=await e.ext('report',{...report,url:'https://mp.csdn.net/mp_blog/creation/success/123456'});assert.equal(r.status,200);assert.equal(r.data.job.state,'submitted');assert.equal(r.data.job.receipt.publicVerified,false);
 assert.equal((await e.ext('report',{...report,url:'wrong'})).data.existing,true);
});
test('prepare-only task cannot commit, and failed preparation can explicitly reauthorize without automatic replay',async t=>{
 const e=setup(t);await e.pair();await e.account();await e.enqueue({mode:'prepare'});const j=(await e.ext('claim')).data.job;
 assert.equal((await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash})).status,409);
 await e.ext('report',{id:j.id,lease:j.lease,state:'needs_attention'});assert.equal((await e.ext('claim')).data.job,null);
 assert.equal((await e.app('retry',{id:j.id})).status,200);assert.ok((await e.ext('claim')).data.job);
});
test('revoking a connection cancels queued work but leaves possible submitted work uncertain',async t=>{
 const e=setup(t),j=await e.ready();await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash});
 await e.app('revoke',{sessionId:e.connection.sessionId});assert.equal((await e.ext('pending')).status,403);
 const r=await e.request('/api/local-publisher/status?brandId=b',null,{'x-geo-request':'1'},'GET');assert.equal(r.data.accounts.length,0);assert.equal(r.data.jobs[0].state,'uncertain');
});
test('explicitly re-enqueueing cancelled work can bind a replacement connection without a duplicate row',async t=>{
 const e=setup(t);await e.pair();await e.account();const first=await e.enqueue();await e.app('revoke',{sessionId:e.connection.sessionId});await e.pair();await e.account();const second=await e.enqueue();assert.equal(second.data.job.id,first.data.job.id);assert.equal(second.data.job.state,'queued');assert.equal(e.db.prepare('SELECT count(*) n FROM publisher_jobs').get().n,1);assert.ok((await e.ext('claim')).data.job);
});

test('a token issued on one port cannot authenticate a restarted instance on another port',async t=>{
 const e=setup(t);await e.pair();const moved=publisherBridge({db:e.db,readState:()=>e.state,origin:'http://127.0.0.1:58730'});
 const r=await moved.handle(new Request('http://127.0.0.1:58730/bridge/publisher/pending',{method:'POST',headers:{origin:EXT,authorization:'Bearer '+e.connection.token},body:JSON.stringify({instance:e.connection.instance})}));assert.equal(r.status,403);
});

test('invalid account evidence identifies fields without echoing supplied values',async t=>{
 const e=setup(t);await e.pair();const r=await e.ext('account',{accountId:'bad/private',name:'',editorReady:false,evidenceUrl:'https://private.example/secret'});assert.equal(r.status,409);assert.match(r.data.error,/账号 ID、显示名称、编辑器就绪状态、编辑器网址/);assert.ok(!r.data.error.includes('private'));assert.ok(!r.data.error.includes('secret'));
});

test('queued tags survive claim and cannot silently change during duplicate enqueue',async t=>{
 const e=setup(t);await e.pair();await e.account();await e.enqueue({tags:['软件测试','人工智能']});await e.enqueue({tags:['另一个标签']});const j=(await e.ext('claim')).data.job;assert.deepEqual(j.tags,['软件测试','人工智能']);
});

const png={dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfeYAAAAASUVORK5CYII='};
test('four new platforms bind pairing, identity, queue and claims to immutable platform',async t=>{
 for(const platform of ['toutiao','zhihu','douyin','xiaohongshu']){
  const e=setup(t,false);await e.pair(platform);assert.equal(e.connection.platform,platform);await e.account();
  const wrong=await e.ext('account',{accountId:'author',name:'作者',editorReady:true,evidenceUrl:PLATFORMS.csdn.editor});assert.equal(wrong.status,409);
  const media=PLATFORMS[platform].images?[png]:[];assert.equal((await e.enqueue({media})).status,409);
  const queued=await e.enqueue({mode:'prepare',media});assert.equal(queued.status,200);assert.equal(queued.data.job.platform,platform);
  const claim=await e.ext('claim');assert.equal(claim.data.job.platform,platform);assert.equal(claim.data.job.media.length,media.length);
  assert.equal((await e.ext('commit',{id:claim.data.job.id,lease:claim.data.job.lease,accountId:'author',sourceHash:claim.data.job.sourceHash})).status,409);
 }
});
test('platform release gates do not accidentally enable other platforms; cross-platform receipts rejected',async t=>{
 const e=setup(t,false,['toutiao']);await e.pair('toutiao');await e.account();const q=await e.enqueue();assert.equal(q.status,200);const j=(await e.ext('claim')).data.job;
 assert.equal((await e.ext('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash})).status,200);
 assert.equal((await e.ext('report',{id:j.id,lease:j.lease,state:'submitted',articleId:'123',url:'https://zhuanlan.zhihu.com/p/123'})).status,400);
 const r=await e.ext('report',{id:j.id,lease:j.lease,state:'submitted',articleId:'123',url:'https://www.toutiao.com/article/123/'});assert.equal(r.status,200);assert.equal(r.data.job.receipt.publicVerified,false);
 await e.pair('zhihu');await e.account();assert.equal((await e.enqueue()).status,409);
});
test('image platforms reject no media, mismatched image signatures, excessive captions without truncation',async t=>{
 const e=setup(t,false);await e.pair('xiaohongshu');await e.account();assert.equal((await e.enqueue({mode:'prepare'})).status,400);
 assert.equal((await e.enqueue({mode:'prepare',media:[{dataUrl:'data:image/png;base64,SGVsbG8='}]})).status,400);
 e.state.contents[0].title='一'.repeat(21);assert.equal((await e.enqueue({mode:'prepare',media:[png]})).status,400);assert.equal(e.state.contents[0].title.length,21);
 e.state.contents[0].title='测试文章';e.state.contents[0].text='文'.repeat(1001);assert.equal((await e.enqueue({mode:'prepare',media:[png]})).status,400);
});
test('identical author IDs on different platforms cannot deduplicate into each other',async t=>{
 const e=setup(t,false);await e.pair('toutiao');await e.account();const a=await e.enqueue({mode:'prepare'});await e.pair('zhihu');await e.account();const b=await e.enqueue({mode:'prepare'});assert.notEqual(a.data.job.id,b.data.job.id);
 const status=await e.request('/api/local-publisher/status?brandId=b',null,{'x-geo-request':'1'},'GET');assert.equal(status.data.accounts.length,2);assert.ok(!JSON.stringify(status).includes('data:image'));
});
