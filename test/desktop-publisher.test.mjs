import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publisherBridge} from '../local/publisher-bridge.mjs';
import {navigationAllowed,trustedFrame,connectionPartition,connectionInput,targetInput} from '../desktop/security.mjs';
import {PLATFORMS} from '../browser-extension/platforms.js';
const origin='http://127.0.0.1:58729';
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=10000;const state={brands:[{id:'a'},{id:'b'}],contents:[{id:'c',brandId:'a',status:'已审核',title:'测试稿',text:'测试正文'}],facts:[]};const opts={db,origin,readState:()=>state,clock:()=>time};let bridge=publisherBridge(opts);return {db,state,get bridge(){return bridge},advance:n=>time+=n,restart:(o=origin)=>bridge=publisherBridge({...opts,origin:o}),async app(action,data){const r=await bridge.handle(new Request(origin+'/api/local-publisher/'+action,{method:'POST',headers:{'x-geo-request':'1',origin},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}}}}
const identity=(platform='csdn',accountId='author')=>({accountId,name:'验收账号',editorReady:true,evidenceUrl:PLATFORMS[platform].editor,draftProtocol:PLATFORMS[platform].draftProtocol});
test('desktop connection is private IPC-only, brand isolated and has no browser token',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'csdn'});assert.equal(c.sessionId,e.bridge.connectDesktop({brandId:'a',platform:'csdn'}).sessionId);assert.notEqual(c.sessionId,e.bridge.connectDesktop({brandId:'b',platform:'csdn'}).sessionId);
 assert.throws(()=>e.bridge.connectDesktop({brandId:'missing',platform:'csdn'}));assert.throws(()=>e.bridge.connectDesktop({brandId:'a',platform:'unknown'}));assert.ok(!JSON.stringify(c).includes('token'));
 for(const fakeOrigin of ['guanyin-desktop://main','chrome-extension://'+'a'.repeat(32)]){const r=await e.bridge.handle(new Request(origin+'/bridge/publisher/account',{method:'POST',headers:{origin:fakeOrigin},body:JSON.stringify({...identity(),sessionId:c.sessionId,instance:c.instance,transport:'desktop'})}));assert.equal(r.status,403)}
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity()});assert.equal(e.bridge.desktopConnections()[0].accountId,'author');
});
test('automatic desktop verification still binds dispatch to expected account and freshness',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'csdn'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity());
 const body={sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'draft',tags:['测试'],expectedAccountId:'author'};
 assert.equal((await e.app('enqueue',{...body,expectedAccountId:'other'})).status,409);e.advance(300001);assert.equal((await e.app('enqueue',body)).status,409);
 await call('account',identity());assert.equal((await e.app('enqueue',body)).status,200);const j=(await call('claim')).job;assert.equal(j.accountId,'author');assert.equal(j.platform,'csdn');
 assert.equal((await e.app('enqueue',body)).data.existing,true);
 await assert.rejects(call('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash}),/不允许/);
 await call('account',identity('csdn','other'));await assert.rejects(call('report',{id:j.id,lease:j.lease,state:'draft',draft:{url:'https://mp.csdn.net/mp_blog/creation/editor/123',articleId:'123',accountId:'author',sourceHash:j.sourceHash,savedVerified:true,contentVerified:true}}),/账号已变化/);
});
test('desktop restart preserves own connection across port changes but never replays pending writes',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'csdn'});await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity()});
 const j=(await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'draft',tags:['测试'],expectedAccountId:'author'})).data.job;
 e.restart('http://127.0.0.1:58730');assert.equal(e.bridge.desktopConnections()[0].sessionId,c.sessionId);
 assert.equal((await e.bridge.desktopRequest({sessionId:c.sessionId,action:'claim'})).job,null);const saved=JSON.parse(e.db.prepare('SELECT body FROM publisher_jobs WHERE id=?').get(j.id).body);assert.equal(saved.state,'needs_attention');
 e.bridge.invalidate('恢复备份');assert.equal(e.bridge.desktopConnections().length,0);await assert.rejects(e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity()}),/失效/);
});
test('desktop navigation and IPC reject other websites, subframes, malformed input and arbitrary actions',()=>{
 for(const url of ['file:///tmp/secret','javascript:alert(1)','http://mp.csdn.net/','https://csdn.net.evil.test/','https://user:pass@mp.csdn.net/','https://mp.csdn.net:444/'])assert.equal(navigationAllowed('csdn',url),false);
 assert.equal(navigationAllowed('csdn','https://passport.csdn.net/login'),true);assert.equal(navigationAllowed('toutiao','https://mp.toutiao.com/profile_v4'),true);
 const frame={url:origin+'/#today'},contents={mainFrame:frame};assert.equal(trustedFrame({sender:contents,senderFrame:frame},contents,origin),true);assert.equal(trustedFrame({sender:contents,senderFrame:{url:origin}},contents,origin),false);assert.equal(trustedFrame({sender:{},senderFrame:frame},contents,origin),false);
 assert.notEqual(connectionPartition('one'),connectionPartition('two'));assert.throws(()=>connectionPartition('../secret'));assert.throws(()=>connectionInput({brandId:'a',platform:'other'}));assert.throws(()=>targetInput([{sessionId:'a',accountId:'../b'}]));
});


test('Douyin desktop connection exposes preparation only until draft and publish are verified',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'douyin'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('douyin')});
 const r=await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'draft',expectedAccountId:'author'});
 assert.notEqual(r.status,200);
 assert.equal(navigationAllowed('douyin','https://creator.douyin.com/creator-micro/home'),true);
 assert.equal(navigationAllowed('douyin','https://evil.douyin.com.example/'),false);
});

test('Xiaohongshu desktop connection uses isolated own login and remains preparation only',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'xiaohongshu'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('xiaohongshu')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'xiaohongshu');
 assert.equal(navigationAllowed('xiaohongshu','https://creator.xiaohongshu.com/new/home'),true);
 for(const url of ['https://xiaohongshu.com.evil.test/','https://creator.douyin.com/'])assert.equal(navigationAllowed('xiaohongshu',url),false);
 for(const mode of ['publish','draft'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});

test('51CTO prepared article upgrades to read-only draft recovery without a second job',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'51cto'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('51cto'));
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'prepare',expectedAccountId:'author'};
 await e.app('enqueue',args);const j=(await call('claim')).job;
 await call('report',{id:j.id,lease:j.lease,state:'prepared',preparation:{editorUrl:PLATFORMS['51cto'].editor,accountId:'author',contentVerified:true,sourceHash:j.sourceHash}});
 const r=await e.app('enqueue',{...args,mode:'draft'});assert.equal(r.status,200);assert.equal(r.data.job.id,j.id);assert.equal((await call('pending')).recoverPreparation,true);assert.equal((await call('claim')).job.recoverPreparation,true);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM publisher_jobs').get().n,1);
});

test('51CTO image draft preserves media, rejects missing proof and restores the exact revision',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'51cto'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('51cto'));
 const media=[{dataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}];
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'draft',expectedAccountId:'author',media};const r=await e.app('enqueue',args);assert.equal(r.status,200);
 const j=(await call('claim')).job;const draft={url:'https://blog.51cto.com/blogger/draft/123',articleId:'123',accountId:'author',sourceHash:j.sourceHash,savedVerified:true,contentVerified:true};
 await assert.rejects(call('report',{id:j.id,lease:j.lease,state:'draft',draft}));
 const proof=[{sha256:j.media[0].sha256,url:'https://s2.51cto.com/images/blog/one.png'}];await call('report',{id:j.id,lease:j.lease,state:'draft',draft:{...draft,mediaProof:proof}});
 assert.equal((await e.app('enqueue',{...args,media:[]})).status,409);
 const restored=await e.app('media',{brandId:'a',contentId:'c'});assert.equal(restored.status,200);assert.equal(restored.data.media[0].dataUrl,media[0].dataUrl);
 assert.equal((await e.app('media',{brandId:'b',contentId:'c'})).status,409);
 e.state.contents[0].text='changed';assert.equal((await e.app('media',{brandId:'a',contentId:'c'})).data.media.length,0);
});

test('Alibaba desktop connection exposes draft only and rejects public dispatch',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'aliyun'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('aliyun'));
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',expectedAccountId:'author'};
 assert.equal((await e.app('enqueue',{...args,mode:'publish'})).status,409);
 assert.equal((await e.app('enqueue',{...args,mode:'draft'})).status,200);
 const j=(await call('claim')).job;
 const draft={url:'https://developer.aliyun.com/article/new?edit=123',articleId:'123',accountId:'author',sourceHash:j.sourceHash,savedVerified:true,contentVerified:true};
 await call('report',{id:j.id,lease:j.lease,state:'draft',draft});
 const duplicate=await e.app('enqueue',{...args,mode:'draft'});assert.equal(duplicate.data.existing,true);assert.equal(duplicate.data.job.receipt.publicVerified,false);
});
