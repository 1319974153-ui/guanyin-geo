import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchArticle,availableActions,reconcileDispatch,dispatchId} from '../src/publish-dispatch-core.js';
const article={id:'c',brandId:'b',status:'已审核',tags:['软件测试']};
const wp=(key='one')=>({key,platform:'wordpress',accountId:key,name:key,modes:['draft','publish']});
const csdn={key:'csdn',platform:'csdn',sessionId:'s',name:'author',modes:['prepare']};
function fixture(options={}){
 const calls=[],journal={},saved=[];let posts=0;
 const request=async(path,init)=>{calls.push([path,init?.body&&JSON.parse(init.body)]);if(path.includes('/preview?'))return{previewHash:'hash'};
  if(options.failAccount&&init&&JSON.parse(init.body).accountId===options.failAccount)throw new Error('network lost');
  if(path.endsWith('/draft')){posts++;return{record:{state:'draft',remote:{url:'https://example.org/?p=1',postId:1}}}}
  if(path.endsWith('/publish'))return{record:{state:'published',remote:{url:'https://example.org/post',postId:1}}};
  if(path.includes('/detail?'))return{record:{state:'draft'}};
  if(path.endsWith('/enqueue'))return{job:{id:'job-1',state:'queued'}};
  if(path.includes('/status?'))return{jobs:[{id:'job-1',state:'prepared'}]};throw Error('unexpected '+path);
 };
 return{calls,journal,saved,get posts(){return posts},request,run:patch=>dispatchArticle({article,targets:[wp()],mode:'draft',journal,request,persist:async j=>{if(options.storageFailure)throw Error('storage full');saved.push(JSON.stringify(j))},assertScope:options.assertScope||(()=>{}),...patch})};
}
test('all selected accounts must support the requested action before any side effect',async()=>{
 const f=fixture();assert.equal(availableActions([wp(),csdn]).publish,false);await assert.rejects(f.run({targets:[wp(),csdn],mode:'publish'}),/所选账号/);assert.equal(f.calls.length,0);
 await assert.rejects(f.run({article:{...article,status:'草稿'}}),/确认稿件/);
});
test('draft then publish reuses the same remote article without creating a duplicate',async()=>{
 const f=fixture();await f.run();const id=f.journal.one.id;await f.run();assert.equal(f.posts,1);await f.run({mode:'publish'});assert.equal(f.posts,1);assert.equal(f.journal.one.id,id);assert.equal(f.journal.one.state,'published');await f.run({mode:'publish'});assert.equal(f.calls.filter(c=>c[0].endsWith('/publish')).length,1);
 assert.equal(JSON.parse(f.saved[0]).one.state,'sending');
});
test('one failed account does not prevent the next, and uncertain requests are never repeated',async()=>{
 const f=fixture({failAccount:'one'});await f.run({targets:[wp('one'),wp('two')]});assert.equal(f.journal.one.state,'uncertain');assert.equal(f.journal.two.state,'draft');const count=f.calls.length;await f.run({targets:[wp('one'),wp('two')]});assert.equal(f.calls.length,count);
});
test('journal failure and workspace changes stop before external writes',async()=>{
 const f=fixture({storageFailure:true});await assert.rejects(f.run(),/storage full/);assert.equal(f.posts,0);
 const changed=fixture({assertScope:()=>{throw Error('scope changed')}});await assert.rejects(changed.run(),/scope changed/);assert.equal(changed.calls.length,0);
});
test('CSDN preparation preserves tags and reads actual queued/fill states without claiming publication',async()=>{
 const f=fixture();await f.run({targets:[csdn],mode:'prepare'});assert.deepEqual(f.calls[0][1].tags,['软件测试']);assert.equal(f.journal.csdn.state,'queued');
 const count=f.calls.length;await reconcileDispatch({article,journal:f.journal,request:f.request,persist:async()=>{},assertScope:()=>{}});assert.equal(f.journal.csdn.state,'prepared');assert.ok(f.calls.slice(count).every(c=>!c[1]));
});

test('separate tabs or cleared browser journals use the same server idempotency ID',async()=>{
 const a=await dispatchId({...article,title:'正文标题',text:'正文'},wp());const b=await dispatchId({...article,title:'正文标题',text:'正文'},wp());assert.equal(a,b);assert.match(a,/^gy-[a-f0-9]{64}$/);assert.notEqual(a,await dispatchId({...article,title:'正文标题',text:'改稿'},wp()));assert.notEqual(a,await dispatchId({...article,title:'正文标题',text:'正文'},wp('other')));
});

test('upgrade keeps legacy no-media idempotency keys while image revisions get distinct keys',async()=>{
 const {createHash}=await import('node:crypto');const target=wp();const old='gy-'+createHash('sha256').update(JSON.stringify([article.brandId,article.id,article.title,article.text,!!article.ai,article.factSnapshots||[],target.platform,target.accountId])).digest('hex');assert.equal(await dispatchId(article,target),old);
 const x={platform:'xiaohongshu',accountId:'x'};assert.notEqual(await dispatchId({...article,media:[{sha256:'a'}]},x),await dispatchId({...article,media:[{sha256:'b'}]},x));assert.equal(await dispatchId({...article,media:[{sha256:'a'}]},target),old);
});

test('missing enqueue response is resolved with authoritative lookup before any retry',async()=>{
 const target={...csdn,accountId:'author'},id=await dispatchId(article,target);
 for(const result of [{notEnqueued:true},{job:{id:'original',state:'preparing'}}]){
  const journal={csdn:{...target,id,state:'uncertain'}},calls=[];
  await reconcileDispatch({article,journal,request:async(path)=>{calls.push(path);return path.includes('/status?')?{jobs:[]}:result},persist:async()=>{},assertScope:()=>{}});
  assert.equal(journal.csdn.state,result.job?'preparing':'not_queued');assert.ok(calls.every(p=>!p.endsWith('/enqueue')));
 }
 const journal={csdn:{...target,id,state:'uncertain'}};
 await reconcileDispatch({article,journal,request:async(path)=>{if(path.includes('/status?'))return{jobs:[]};throw Error('offline')},persist:async()=>{},assertScope:()=>{}});
 assert.equal(journal.csdn.state,'uncertain');
});

test('browser draft dispatch uses draft mode and never silently promotes existing preparation',async()=>{
 const f=fixture(),target={key:'zhihu',platform:'zhihu',accountId:'author',sessionId:'s',modes:['prepare','draft','publish']};
 await f.run({targets:[target],mode:'draft'});assert.equal(f.calls[0][1].mode,'draft');assert.equal(f.journal.zhihu.stage,'draft');
 for(const [state,mode] of [['prepared','draft'],['draft','publish']]){
  f.journal.zhihu.state=state;const count=f.calls.length;await f.run({targets:[target],mode});assert.equal(f.calls.length,count);assert.match(f.journal.zhihu.error,/原稿/);
 }
});

test('late read after brand or article change never mutates or persists the old journal',async()=>{
 let valid=true,writes=0;const journal={csdn:{...csdn,jobId:'j',state:'queued'}};
 await assert.rejects(reconcileDispatch({article,journal,request:async()=>{valid=false;return {jobs:[{id:'j',state:'draft'}]}},persist:async()=>writes++,assertScope:()=>{if(!valid)throw Error('scope changed')}}),/scope changed/);
 assert.equal(writes,0);assert.equal(journal.csdn.state,'queued');
});
test('failed status reads preserve platform errors and recover on next read without any enqueue',async()=>{
 const journal={csdn:{...csdn,jobId:'j',state:'uncertain',error:'平台原始错误'}};let failed=true;const calls=[];
 const args={article,journal,request:async path=>{calls.push(path);if(failed)throw Error('offline');return {jobs:[{id:'j',state:'draft',receipt:{url:'https://example.org/draft',publicVerified:false}}]}},persist:async()=>{},assertScope:()=>{}};
 await reconcileDispatch(args);assert.equal(journal.csdn.state,'uncertain');assert.equal(journal.csdn.error,'平台原始错误');assert.equal(journal.csdn.refreshError,'offline');failed=false;await reconcileDispatch(args);assert.equal(journal.csdn.state,'draft');assert.equal(journal.csdn.refreshError,undefined);assert.equal(journal.csdn.remote.publicVerified,false);assert.ok(calls.every(p=>p.includes('/status?')));
});
test('journal storage failure leaves displayed receipt unchanged',async()=>{
 const journal={csdn:{...csdn,jobId:'j',state:'queued'}};
 await assert.rejects(reconcileDispatch({article,journal,request:async()=>({jobs:[{id:'j',state:'draft'}]}),persist:async()=>{throw Error('storage full')},assertScope:()=>{}}),/storage full/);
 assert.equal(journal.csdn.state,'queued');
});

test('fresh browser recovers an existing current-revision draft without a second enqueue',async()=>{
 const {recoverDispatchJournal}=await import('../src/publish-dispatch-core.js');
 const target={key:'zhihu:s1',platform:'zhihu',accountId:'author',sessionId:'s1',name:'作者',modes:['draft']};
 const job={id:'original',sessionId:'s1',platform:'zhihu',accountId:'author',brandId:article.brandId,contentId:article.id,currentRevision:true,state:'draft',mode:'draft',created:1,receipt:{url:'https://zhuanlan.zhihu.com/p/123/edit'}};
 const journal=await recoverDispatchJournal({article,targets:[target],jobs:[job,{...job,id:'wrong',brandId:'other',created:3},{...job,id:'old',currentRevision:false,created:2}],journal:{}});
 assert.equal(journal[target.key].jobId,'original');assert.equal(journal[target.key].remote.url,job.receipt.url);
 let writes=0;await dispatchArticle({article,targets:[target],mode:'draft',journal,request:async()=>{writes++;throw Error('unexpected write')},persist:async()=>{},assertScope:()=>{}});assert.equal(writes,0);
});

test('receipt recovery refuses a different image revision',async()=>{
 const {recoverDispatchJournal}=await import('../src/publish-dispatch-core.js');
 const jobs=[{id:'j',brandId:article.brandId,contentId:article.id,currentRevision:true,platform:'douyin',sessionId:'s',state:'prepared',mediaHashes:['original']}];
 assert.deepEqual(await recoverDispatchJournal({article:{...article,media:[{sha256:'changed'}]},targets:[],jobs,journal:{}}),{});
});
