import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDispatchTargets,dispatchArticle,reconcileDispatch,dispatchId} from '../src/publish-dispatch-core.js';

const article={id:'a',brandId:'b',title:'发布结果与重复提交',text:'发布后先核对原稿回执。',status:'已审核',tags:['软件测试']};
const desktop=(platform,accountId=platform)=>({key:platform+':session',platform,sessionId:platform+'-session',accountId,name:platform,transport:'desktop',modes:['prepare','draft','publish']});
const wp={key:'wp:one',platform:'wordpress',accountId:'one',name:'官网',modes:['draft','publish']};
const fixtures=()=>({article,mode:'publish',journal:{},persist:async()=>{},assertScope:()=>{}});

test('one expired desktop account does not prevent another desktop account or an API account from sending',async()=>{
 const params=fixtures(),a=desktop('csdn'),b=desktop('zhihu'),checks=[],writes=[];
 const prepared=await prepareDispatchTargets({...params,targets:[a,b,wp],prepareDesktop:async targets=>{checks.push(targets);if(targets[0].accountId==='csdn')throw Error('平台登录已失效');}});
 assert.deepEqual(checks,[[{sessionId:a.sessionId,accountId:a.accountId}],[{sessionId:b.sessionId,accountId:b.accountId}]]);
 assert.deepEqual(prepared.targets,[b,wp]);assert.deepEqual(prepared.failed,[a]);assert.equal(params.journal[a.key].state,'not_queued');assert.equal(params.journal[a.key].preflightFailed,true);
 await dispatchArticle({...params,targets:prepared.targets,request:async(path,init)=>{
  if(init)writes.push({path,body:JSON.parse(init.body)});
  if(path.endsWith('/enqueue'))return {job:{id:'zhihu-job',state:'queued'}};
  if(path.includes('/preview?'))return {previewHash:'preview'};
  if(path.endsWith('/draft'))return {record:{state:'draft',remote:{postId:1}}};
  if(path.endsWith('/publish'))return {record:{state:'published',remote:{postId:1}}};
  throw Error('unexpected '+path);
 }});
 assert.equal(writes.length,3);assert.equal(writes.filter(x=>x.path.endsWith('/enqueue')).length,1);assert.equal(writes[0].body.expectedAccountId,b.accountId);
 assert.ok(writes.every(x=>x.body.sessionId!==a.sessionId));assert.equal(params.journal[wp.key].state,'published');assert.equal(params.journal[a.key].state,'not_queued');
});
test('a later explicit click checks only the failed account and preserves successful or uncertain targets',async()=>{
 const params=fixtures(),a=desktop('csdn'),b=desktop('zhihu');
 await prepareDispatchTargets({...params,targets:[a],prepareDesktop:async()=>{throw Error('连接失败')}});
 params.journal[b.key]={...b,id:await dispatchId(article,b),state:'published',remote:{url:'https://example.invalid/original'}};
 const unknown=desktop('tencentcloud');params.journal[unknown.key]={...unknown,id:await dispatchId(article,unknown),state:'uncertain',jobId:'original-unknown'};
 const prior=structuredClone(params.journal),checked=[];
 const result=await prepareDispatchTargets({...params,targets:[a,b,unknown],prepareDesktop:async list=>checked.push(list[0].accountId)});
 assert.deepEqual(checked,[a.accountId]);assert.equal(result.failed.length,0);assert.equal(params.journal[a.key].preflightFailed,undefined);assert.equal(params.journal[a.key].error,undefined);
 assert.deepEqual(params.journal[b.key],prior[b.key]);assert.deepEqual(params.journal[unknown.key],prior[unknown.key]);
 const writes=[];await dispatchArticle({...params,targets:result.targets,request:async(path,init)=>{writes.push(JSON.parse(init.body));return {job:{id:'only-new-job',state:'queued'}};}});
 assert.equal(writes.length,1);assert.equal(writes[0].expectedAccountId,a.accountId);
});
test('failed draft promotion retains the saved draft and later reuses its exact queue job',async()=>{
 const params=fixtures(),target=desktop('zhihu'),remote={savedVerified:true,url:'https://zhuanlan.zhihu.com/p/123'};
 params.journal[target.key]={...target,id:await dispatchId(article,target),jobId:'saved-original',state:'draft',remote,stage:'draft'};
 const blocked=await prepareDispatchTargets({...params,targets:[target],prepareDesktop:async()=>{throw Error('当前登录账号已变化')}});
 assert.equal(blocked.targets.length,0);assert.equal(params.journal[target.key].state,'draft');assert.equal(params.journal[target.key].jobId,'saved-original');assert.deepEqual(params.journal[target.key].remote,remote);
 assert.match(params.journal[target.key].preflightError,/账号已变化/);
 const ready=await prepareDispatchTargets({...params,targets:[target],prepareDesktop:async()=>({ok:true})});let calls=0;
 await dispatchArticle({...params,targets:ready.targets,request:async(path,init)=>{calls++;assert.equal(path,'/api/local-publisher/enqueue');assert.equal(JSON.parse(init.body).mode,'publish');return {job:{id:'saved-original',state:'queued'}};}});
 assert.equal(calls,1);assert.equal(params.journal[target.key].jobId,'saved-original');assert.equal(params.journal[target.key].preflightFailed,undefined);
});
test('preflight-only failures are not polled as though a platform write occurred',async()=>{
 const params=fixtures(),target=desktop('csdn');await prepareDispatchTargets({...params,targets:[target],prepareDesktop:async()=>{throw Error('网络连接失败')}});
 await reconcileDispatch({...params,request:async()=>assert.fail('No platform task was created')});
 assert.equal(params.journal[target.key].state,'not_queued');assert.equal(params.journal[target.key].refreshError,undefined);assert.match(params.journal[target.key].error,/网络连接失败/);
});
test('known receipts and unknown claims never reopen login or resend during batch preflight',async()=>{
 for(const state of ['claim_pending','result_unknown','uncertain','published','submitted','queued','needs_attention']){
  const params=fixtures(),target=desktop('zhihu');params.journal[target.key]={...target,id:await dispatchId(article,target),state};
  const before=structuredClone(params.journal),result=await prepareDispatchTargets({...params,targets:[target],prepareDesktop:async()=>assert.fail('must not reopen account')});
  await dispatchArticle({...params,targets:result.targets,request:async()=>assert.fail('must not write')});
  assert.deepEqual(params.journal,before);
 }
});
test('workspace or actor changes during a failed check stop the whole batch without recording a misleading per-account failure',async()=>{
 const params=fixtures(),targets=[desktop('csdn'),desktop('zhihu')];let valid=true,checked=0,saves=0;
 await assert.rejects(prepareDispatchTargets({...params,targets,assertScope:()=>{if(!valid)throw Error('工作区已变化')},persist:async()=>saves++,prepareDesktop:async()=>{checked++;valid=false;throw Error('account error')}}),/工作区已变化/);
 assert.equal(checked,1);assert.equal(saves,0);assert.deepEqual(params.journal,{});
});
test('failed durable recording stops before checking or sending any further account',async()=>{
 const params=fixtures();let checked=0;
 await assert.rejects(prepareDispatchTargets({...params,targets:[desktop('csdn'),desktop('zhihu')],persist:async()=>{throw Error('存储已满')},prepareDesktop:async()=>{checked++;throw Error('网络异常')}}),/存储已满/);
 assert.equal(checked,1);
});
test('unapproved articles and unavailable operations fail before checking identities',async()=>{
 for(const patch of [{article:{...article,status:'草稿'}},{article:{...article,demo:true}},{targets:[{...desktop('csdn'),modes:['prepare']}]}]){
  await assert.rejects(prepareDispatchTargets({...fixtures(),targets:[desktop('csdn')],...patch,prepareDesktop:async()=>assert.fail('must not check')}),/确认稿件|不都支持/);
 }
});
test('switching the account behind a saved session blocks that target without losing its original receipt',async()=>{
 const params=fixtures(),original=desktop('zhihu','old-author'),current={...original,accountId:'new-author'},other=desktop('csdn');
 params.journal[current.key]={...original,id:await dispatchId(article,original),state:'draft',jobId:'old-job',remote:{postId:'old-post'}};
 const checked=[],result=await prepareDispatchTargets({...params,targets:[current,other],prepareDesktop:async list=>checked.push(list[0].accountId)});
 assert.deepEqual(result.targets,[other]);assert.deepEqual(checked,[other.accountId]);assert.equal(params.journal[current.key].accountId,'old-author');assert.equal(params.journal[current.key].jobId,'old-job');assert.equal(params.journal[current.key].remote.postId,'old-post');
 assert.match(params.journal[current.key].preflightError,/账号.*不一致/);
 await dispatchArticle({...params,targets:[current],request:async()=>assert.fail('a direct call cannot bypass the identity match')});
 assert.equal(params.journal[current.key].state,'draft');
});
