import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publisherBridge} from '../local/publisher-bridge.mjs';
import {navigationAllowed,trustedFrame,connectionPartition,connectionInput,targetInput} from '../desktop/security.mjs';
import {PLATFORMS} from '../browser-extension/platforms.js';
import {DESKTOP_PUBLIC_PLATFORMS} from '../desktop/build-capabilities.mjs';
const origin='http://127.0.0.1:58729';
function setup(t,publishPlatforms=[]){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=10000;const state={brands:[{id:'a'},{id:'b'}],contents:[{id:'c',brandId:'a',status:'已审核',title:'测试稿',text:'测试正文'}],facts:[]};const opts={db,origin,readState:()=>state,clock:()=>time,publishPlatforms};let bridge=publisherBridge(opts);return {db,state,get bridge(){return bridge},advance:n=>time+=n,restart:(o=origin)=>bridge=publisherBridge({...opts,origin:o}),async app(action,data){const r=await bridge.handle(new Request(origin+'/api/local-publisher/'+action,{method:'POST',headers:{'x-geo-request':'1',origin},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}}}}
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
test('the packaged desktop gate never enables public dispatch for a merely implemented candidate',async t=>{
 const e=setup(t,DESKTOP_PUBLIC_PLATFORMS);
 for(const platform of ['csdn','aliyun']){
  const c=e.bridge.connectDesktop({brandId:'a',platform});
  await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity(platform)});
  const result=await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'publish',...(platform==='csdn'?{tags:['测试']}:{}),expectedAccountId:'author'});
  assert.equal(result.status,409,platform+' cannot be enabled before public acceptance');
 }
 const c=e.bridge.connectDesktop({brandId:'a',platform:'zhihu'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('zhihu')});
 assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'publish',expectedAccountId:'author'})).status,200);
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

test('SegmentFault desktop connection uses the official editor and allows preparation only',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'segmentfault'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('segmentfault')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'segmentfault');
 assert.equal(navigationAllowed('segmentfault','https://segmentfault.com/write'),true);
 assert.equal(navigationAllowed('segmentfault','https://segmentfault.com.evil.test/write'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});
test('visible autosave observation remains a preparation, never a draft or publish receipt',async t=>{
 for(const platform of ['segmentfault','jianshu']){
  const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity(platform));
  const args={sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'prepare',expectedAccountId:'author'};assert.equal((await e.app('enqueue',args)).status,200);const j=(await call('claim')).job;
  const base={id:j.id,lease:j.lease,state:'prepared',preparation:{editorUrl:PLATFORMS[platform].editor,accountId:'author',sourceHash:j.sourceHash}};
  await assert.rejects(call('report',{...base,preparation:{...base.preparation,autosaveObserved:true,autosaveStatus:'unknown'}}),/自动保存观察回执不完整/);
  const result=await call('report',{...base,preparation:{...base.preparation,autosaveObserved:true,autosaveStatus:'visible_autosave_notice'}});
  assert.equal(result.job.state,'prepared');assert.equal(result.job.preparation.autosaveObserved,true);assert.equal(result.job.preparation.savedVerified,false);assert.equal(result.job.receipt,null);
  for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{...args,mode})).status,409);
 }
});

test('OSCHINA desktop connection permits only its official editor and preparation workflow',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'oschina'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('oschina')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'oschina');
 assert.equal(navigationAllowed('oschina','https://my.oschina.net/u/0/blog/write'),true);
 assert.equal(navigationAllowed('oschina','https://my.oschina.net.evil.test/u/0/blog/write'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});

test('Jianshu desktop connection permits only its official writer and preparation workflow',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'jianshu'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('jianshu')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'jianshu');
 assert.equal(navigationAllowed('jianshu','https://www.jianshu.com/writer'),true);
 assert.equal(navigationAllowed('jianshu','https://www.jianshu.com.evil.test/writer'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});

test('Bilibili desktop connection permits creator-center preparation only',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'bilibili'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('bilibili')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'bilibili');
 assert.equal(navigationAllowed('bilibili','https://member.bilibili.com/platform/upload/text/apply'),true);
 assert.equal(navigationAllowed('bilibili','https://passport.bilibili.com/login?gourl=https%3A%2F%2Fmember.bilibili.com%2Fplatform%2Fupload%2Ftext%2Fapply'),true);
 assert.equal(navigationAllowed('bilibili','https://member.bilibili.com.evil.test/platform/upload/text/apply'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});

test('Weibo long-form desktop connection permits official editor preparation only',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'weibo'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('weibo')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'weibo');
 assert.equal(navigationAllowed('weibo','https://weibo.com/ttarticle/p/editor'),true);
 assert.equal(navigationAllowed('weibo','https://passport.weibo.com/login?entry=account'),true);
 assert.equal(navigationAllowed('weibo','https://weibo.com.evil.test/ttarticle/p/editor'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'author'})).status,409);
});

test('Sohu desktop connection permits official article preparation only',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'sohu'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('sohu','opaqueAccount9')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'sohu');
 assert.equal(navigationAllowed('sohu','https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle'),true);
 assert.equal(navigationAllowed('sohu','https://mp.sohu.com/mpfe/v4/login'),true);
 assert.equal(navigationAllowed('sohu','https://v4.passport.sohu.com/i/login'),true);
 assert.equal(navigationAllowed('sohu','https://mp.sohu.com.evil.test/mpfe/v4/contentManagement/news/addarticle'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'opaqueAccount9'})).status,409);
});

test('Netease desktop connection permits only official article preparation',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'netease'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('netease','W12345678')});
 assert.equal(e.bridge.desktopConnections()[0].platform,'netease');
 assert.equal(navigationAllowed('netease','https://mp.163.com/subscribe_v4/index.html#/article-publish'),true);
 assert.equal(navigationAllowed('netease','https://mp.163.com/login.html'),true);
 assert.equal(navigationAllowed('netease','https://id.163.com/login'),true);
 assert.equal(navigationAllowed('netease','https://mp.163.com.evil.test/subscribe_v4/index.html'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:'W12345678'})).status,409);
});

test('Baijiahao desktop connection permits only official article preparation',async t=>{
 const e=setup(t),accountId='1234567890123456',c=e.bridge.connectDesktop({brandId:'a',platform:'baijiahao'});
 await e.bridge.desktopRequest({sessionId:c.sessionId,action:'account',data:identity('baijiahao',accountId)});
 assert.equal(e.bridge.desktopConnections()[0].platform,'baijiahao');
 assert.equal(navigationAllowed('baijiahao','https://baijiahao.baidu.com/builder/rc/edit?type=news'),true);
 assert.equal(navigationAllowed('baijiahao','https://baijiahao.baidu.com/builder/theme/bjh/login'),true);
 assert.equal(navigationAllowed('baijiahao','https://passport.baidu.com/v2/?login'),true);
 assert.equal(navigationAllowed('baijiahao','https://baijiahao.baidu.com.evil.test/builder/rc/edit?type=news'),false);
 for(const mode of ['draft','publish'])assert.equal((await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode,expectedAccountId:accountId})).status,409);
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

test('desktop receipt opens only persisted same-brand same-account draft and never a renderer-supplied URL',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'aliyun'}),other=e.bridge.connectDesktop({brandId:'b',platform:'aliyun'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('aliyun'));
 await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',expectedAccountId:'author',mode:'draft'});const j=(await call('claim')).job;
 await assert.rejects(call('receipt-target',{jobId:j.id,url:'https://evil.test'}),/没有已核验/);
 const draft={url:'https://developer.aliyun.com/article/new?edit=123',articleId:'123',accountId:'author',sourceHash:j.sourceHash,savedVerified:true,contentVerified:true};
 await call('report',{id:j.id,lease:j.lease,state:'draft',draft});
 assert.equal((await call('receipt-target',{jobId:j.id,url:'https://evil.test'})).url,draft.url);
 await assert.rejects(e.bridge.desktopRequest({sessionId:other.sessionId,action:'receipt-target',data:{jobId:j.id}}),/不属于/);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM publisher_jobs').get().n,1);
 await call('account',identity('aliyun','someone-else'));await assert.rejects(call('receipt-target',{jobId:j.id}),/不属于/);
});


test('expired desktop login blocks dispatch even when its old identity is still recent',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'aliyun'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});
 await call('account',identity('aliyun'));await call('connection-state',{state:'needs_login'});
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',expectedAccountId:'author',mode:'draft'};
 assert.equal((await e.app('enqueue',args)).status,409);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM publisher_jobs').get().n,0);
 await call('account',identity('aliyun'));assert.equal((await e.app('enqueue',args)).status,200);
 const job=(await call('claim')).job;await call('connection-state',{state:'needs_login'});
 await assert.rejects(call('commit',{id:job.id,lease:job.lease,accountId:'author',sourceHash:job.sourceHash}));
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM publisher_jobs').get().n,1);
});

test('Alibaba enabled preview promotes the saved draft in place and still records review rather than public success',async t=>{
 const e=setup(t,['aliyun']),c=e.bridge.connectDesktop({brandId:'a',platform:'aliyun'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('aliyun'));
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',expectedAccountId:'author'};
 await e.app('enqueue',{...args,mode:'draft'});const original=(await call('claim')).job;
 await call('report',{id:original.id,lease:original.lease,state:'draft',draft:{url:'https://developer.aliyun.com/article/new?edit=123',articleId:'123',accountId:'author',sourceHash:original.sourceHash,savedVerified:true,contentVerified:true}});
 const promoted=await e.app('enqueue',{...args,mode:'publish'});assert.equal(promoted.data.job.id,original.id);
 const j=(await call('claim')).job;assert.equal(j.originalDraft.articleId,'123');await call('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash});
 const result=await call('report',{id:j.id,lease:j.lease,state:'submitted',url:'https://developer.aliyun.com/article/123',articleId:'123',reviewState:'reviewing'});
 assert.equal(result.job.state,'submitted');assert.equal(result.job.receipt.publicVerified,false);
 assert.equal((await e.app('enqueue',{...args,mode:'publish'})).data.job.id,j.id);assert.equal(e.db.prepare('select count(*) n from publisher_jobs').get().n,1);
});

test('Aliyun observed handoff requires original lease, full content and identity, then blocks another submit',async t=>{
 const e=setup(t,['aliyun']),c=e.bridge.connectDesktop({brandId:'a',platform:'aliyun'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('aliyun'));
 await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'publish',expectedAccountId:'author'});const j=(await call('claim')).job;
 const proof={id:j.id,lease:j.lease,state:'observed_submitted',accountId:j.accountId,sourceHash:j.sourceHash,url:'https://developer.aliyun.com/article/456',articleId:'456',contentVerified:true,publicVerified:false,reviewState:'reviewing'};
 await assert.rejects(call('report',proof),/不能登记/);
 await call('report',{id:j.id,lease:j.lease,state:'needs_attention',editorRetained:true,error:'超时'});
 for(const patch of [{accountId:'other'},{sourceHash:'other'},{contentVerified:false},{publicVerified:true},{url:'https://evil.test/article/456'},{reviewState:'approved'}])await assert.rejects(call('report',{...proof,...patch}),/证据不匹配/);
 await assert.rejects(call('report',{...proof,lease:'other'}));
 const r=await call('report',proof);assert.equal(r.job.state,'submitted');assert.equal(r.job.receipt.publicVerified,false);assert.equal(r.job.receipt.submissionMethod,'observed_after_handoff');
 await assert.rejects(call('commit',{id:j.id,lease:j.lease,accountId:j.accountId,sourceHash:j.sourceHash}),/不允许/);
 assert.equal((await e.app('retry',{id:j.id})).status,409);
});

test('Juejin desktop accepts draft and blocks public dispatch even if accidentally configured',async t=>{
 const e=setup(t,['juejin']),c=e.bridge.connectDesktop({brandId:'a',platform:'juejin'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('juejin'));
 const args={sessionId:c.sessionId,brandId:'a',contentId:'c',expectedAccountId:'author'};
 assert.equal((await e.app('enqueue',{...args,mode:'publish'})).status,409);
 assert.equal((await e.app('enqueue',{...args,mode:'draft'})).status,200);
 const j=(await call('claim')).job;
 const draft={url:'https://juejin.cn/editor/drafts/123',articleId:'123',accountId:'author',sourceHash:j.sourceHash,savedVerified:true,contentVerified:true};
 await assert.rejects(call('report',{id:j.id,lease:j.lease,state:'draft',draft}));
 await call('report',{id:j.id,lease:j.lease,state:'draft',draft:{...draft,verification:'reopened_content'}});
 const duplicate=await e.app('enqueue',{...args,mode:'draft'});assert.equal(duplicate.data.existing,true);assert.equal(duplicate.data.job.receipt.publicVerified,false);
});

test('explicit continuation restarts only a never-claimed task, never an interrupted editor',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'csdn'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity());
 const j=(await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'draft',tags:['测试'],expectedAccountId:'author'})).data.job;
 e.restart(origin);await call('account',identity());
 const resumed=await e.app('continue-unstarted',{id:j.id});assert.equal(resumed.status,200);assert.equal(resumed.data.job.id,j.id);assert.equal(resumed.data.job.state,'queued');
 await call('claim');e.restart(origin);await call('account',identity());
 assert.equal((await e.app('continue-unstarted',{id:j.id})).status,409);
 assert.equal((await call('pending')).count,0);
});

test('Douyin original preparation can resume empty fields but never gains public commit permission',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'douyin'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('douyin'));
 const media=[{dataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}];
 await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'prepare',expectedAccountId:'author',media});const j=(await call('claim')).job;
 await assert.rejects(call('resume-preparation',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash}));
 await call('report',{id:j.id,lease:j.lease,state:'needs_attention',editorRetained:true,error:'empty editor'});
 assert.equal((await call('job-state',{id:j.id,lease:j.lease})).canCompletePreparation,true);
 await call('resume-preparation',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash});
 await assert.rejects(call('commit',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash}));
 assert.equal((await e.app('continue-unstarted',{id:j.id})).status,409);
});

test('Douyin temporary save renews only same reviewed prepared job and cannot authorize publication',async t=>{
 const e=setup(t),c=e.bridge.connectDesktop({brandId:'a',platform:'douyin'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});
 await call('account',identity('douyin'));
 const media=[{dataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}];
 await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'prepare',expectedAccountId:'author',media});
 let j=(await call('claim')).job;
 const editorUrl='https://creator.douyin.com/creator-micro/content/post/image';
 await call('report',{id:j.id,lease:j.lease,state:'prepared',preparation:{editorUrl,accountId:'author',sourceHash:j.sourceHash}});
 await assert.rejects(call('save-prepared',{id:j.id,accountId:'other'}),/账号/);
 e.state.contents[0].text='changed';await assert.rejects(call('save-prepared',{id:j.id,accountId:'author'}),/稿件/);e.state.contents[0].text='测试正文';
 e.advance(700000);await call('account',identity('douyin'));j=(await call('save-prepared',{id:j.id,accountId:'author'})).job;
 assert.equal(j.mode,'prepare');assert.equal(j.state,'preparing');assert.equal(e.db.prepare('SELECT COUNT(*) n FROM publisher_jobs').get().n,1);
 await assert.rejects(call('commit',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash}),/不允许/);
 const proof={editorUrl,accountId:'author',sourceHash:j.sourceHash,temporaryVerified:true,verification:'temporary_reopened_content',mediaCount:1};
 await assert.rejects(call('report',{id:j.id,lease:j.lease,state:'prepared',preparation:{...proof,mediaCount:2}}),/不完整/);
 const result=await call('report',{id:j.id,lease:j.lease,state:'prepared',preparation:proof});
 assert.equal(result.job.preparation.temporaryVerified,true);assert.equal(result.job.preparation.savedVerified,false);assert.equal(result.job.preparation.storageScope,'current_device');assert.equal(result.job.receipt,null);
 await assert.rejects(call('save-prepared',{id:j.id,accountId:'author'}),/重复暂存/);
});

test('Douyin original media restores across restart but not changed content, brand or ambiguous image versions',async t=>{
 const e=setup(t,['douyin']),c=e.bridge.connectDesktop({brandId:'a',platform:'douyin'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('douyin'));
 const media=[{dataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}];
 const r=await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'publish',expectedAccountId:'author',media});assert.equal(r.status,200);
 e.restart();let restored=await e.app('media',{brandId:'a',contentId:'c'});assert.equal(restored.data.media[0].dataUrl,media[0].dataUrl);
 assert.equal((await e.app('media',{brandId:'b',contentId:'c'})).status,409);
 e.state.contents[0].text='changed';assert.equal((await e.app('media',{brandId:'a',contentId:'c'})).data.media.length,0);e.state.contents[0].text='测试正文';
 const job=JSON.parse(e.db.prepare('SELECT body FROM publisher_jobs WHERE id=?').get(r.data.job.id).body);job.id='other';job.mediaHash='other';e.db.prepare('INSERT INTO publisher_jobs (id,fingerprint,body) VALUES (?,?,?)').run(job.id,'other',JSON.stringify(job));
 assert.equal((await e.app('media',{brandId:'a',contentId:'c'})).status,409);
});

test('Douyin success requires committed original task, account, source and full-content receipt',async t=>{
 const e=setup(t,['douyin']),c=e.bridge.connectDesktop({brandId:'a',platform:'douyin'}),call=(action,data)=>e.bridge.desktopRequest({sessionId:c.sessionId,action,data});await call('account',identity('douyin'));
 const media=[{dataUrl:'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}];await e.app('enqueue',{sessionId:c.sessionId,brandId:'a',contentId:'c',mode:'publish',expectedAccountId:'author',media});const j=(await call('claim')).job;
 const receipt={id:j.id,lease:j.lease,state:'submitted',url:'https://www.douyin.com/note/123',articleId:'123',verification:'creator_list_and_full_content',contentVerified:true,accountId:'author',sourceHash:j.sourceHash};
 await assert.rejects(call('report',receipt));await call('commit',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash});
 for(const patch of [{sourceHash:'changed'},{accountId:'other'},{contentVerified:false},{verification:'toast'}])await assert.rejects(call('report',{...receipt,...patch}));
 const r=await call('report',receipt);assert.equal(r.job.state,'submitted');assert.equal(r.job.receipt.publicVerified,false);assert.equal(r.job.receipt.verification,'creator_list_and_full_content');
 await assert.rejects(call('commit',{id:j.id,lease:j.lease,accountId:'author',sourceHash:j.sourceHash}));
});
