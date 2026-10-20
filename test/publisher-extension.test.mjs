import test from 'node:test';
import assert from 'node:assert/strict';
const fixtureJob={id:'job',lease:'lease',mode:'publish',accountId:'author',sourceHash:'hash',tags:['技术'],snapshot:{title:'文章',html:'<p>正文</p>'}};
async function fixture(t,options={}){
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;
 let handler,alarm,clicks=0,lostReport=false,committed=false;const actions=[],requests=[],stored={editorTab:options.editorTab,connection:{origin:'http://127.0.0.1:58729',instance:'instance',token:'fixture-token'},...(options.inflight?{inflight:{job:{...fixtureJob,mode:options.mode||'publish'},tabId:1}}:{})};
 if(options.platform){stored.connections={[options.platform]:stored.connection};if(options.inflight)stored.inflightByPlatform={[options.platform]:stored.inflight};}
 globalThis.chrome={storage:{local:{async setAccessLevel(){if(options.storageFailure)throw new Error('failed')},async get(key){return Array.isArray(key)?Object.fromEntries(key.map(k=>[k,stored[k]])):{[key]:stored[key]}},async set(value){Object.assign(stored,value)},async remove(key){delete stored[key]}}},runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:{addListener:h=>handler=h},onStartup:{addListener(){}}},alarms:{async create(){},onAlarm:{addListener:h=>alarm=h}},tabs:{async get(id){actions.push('get-tab');if(options.missingTab)throw new Error('No tab with id: '+id);return{id}},async create(){actions.push('new-tab');return{id:1}}},scripting:{async executeScript({args}){
  const action=args[0].action;actions.push(action);
  if(action==='identity'&&Object.hasOwn(options,'identityResult'))return[{result:options.identityResult}];
  if(action==='identity')return[{result:{accountId:'author',name:'作者',editorReady:true,evidenceUrl:'https://mp.csdn.net/mp_blog/creation/editor'}}];
  if(action==='draft-receipt')return[{result:options.draftError?{connectorError:'正文已变化'}:{url:'https://zhuanlan.zhihu.com/p/123/edit',articleId:'123',accountId:'author',savedVerified:true,contentVerified:true}}];
  if(action==='prepared')return[{result:options.preparedError?{connectorError:'原稿已变化'}:{accountId:'author',contentVerified:true,evidenceUrl:'https://mp.csdn.net/mp_blog/creation/editor'}}];
  if(action==='fill'&&options.partialFillError)return[{result:{connectorError:'填入部分内容后失败'}}];
  if(action==='submit')clicks++;
  if(action==='receipt')return[{result:options.receipt||null}];
  if(action==='preflight'&&options.preflightError)throw new Error('表单不匹配');
  return[{result:{ready:true,prepared:true,attempted:true}}];
 }}};
 globalThis.fetch=async(url,init)=>{
  const action=new URL(url).pathname.split('/').pop();requests.push(action);const body=JSON.parse(init.body);
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(body.instance,'instance');
  if(action==='report'&&['prepared','draft'].includes(body.state)&&options.lostReport&&!lostReport){lostReport=true;throw new Error('填稿回执响应丢失')}
  if(action==='commit')committed=true;
  if(action==='commit'&&options.lostCommit)throw new Error('提交许可响应丢失');
  const result=action==='job-state'?{journalActive:!options.cancelled,canResume:!options.cancelled&&!committed&&options.canResume===true}:action==='pending'?{count:1}:action==='claim'?{job:{...fixtureJob,mode:options.mode||'publish'}}:action==='commit'?{permit:true,validUntil:Date.now()+10000}:action==='report'?{job:{state:options.lostCommit?'uncertain':body.state}}:{};
  return new Response(JSON.stringify(result));
 };
 await import('../browser-extension/background.js?fixture='+Math.random());
 t.after(()=>{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch});
 const send=(action,platform='csdn')=>new Promise(resolve=>handler({action,platform},{id:'extension',url:'chrome-extension://extension/popup.html'},resolve));
 return{send,actions,requests,stored,get clicks(){return clicks},alarm:()=>alarm({name:'publisher'}),handler};
}
test('extension prepares, checks, commits once, then reports only actual success-page evidence',async t=>{
 const f=await fixture(t,{receipt:{state:'submitted',articleId:'123',url:'https://mp.csdn.net/mp_blog/creation/success/123'}});await f.send('run');
 assert.deepEqual(f.actions,['new-tab','identity','fill','preflight','identity','submit','receipt']);assert.deepEqual(f.requests,['pending','account','claim','commit','report']);assert.equal(f.clicks,1);assert.equal(f.stored.inflight,undefined);
});
test('lost commit response is not retried; restart/alarm reconciles without opening a new editor',async t=>{
 const f=await fixture(t,{lostCommit:true});await f.send('run');assert.equal(f.clicks,0);assert.ok(f.stored.inflight);await f.alarm();await f.send('run');assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.requests.filter(a=>a==='commit').length,1);assert.equal(f.clicks,0);
});
test('preparation mode never commits or clicks publish',async t=>{
 const f=await fixture(t,{mode:'prepare'});await f.send('run');assert.equal(f.clicks,0);assert.ok(!f.requests.includes('commit'));assert.ok(!f.actions.includes('preflight'));assert.equal(f.stored.inflight,undefined);
});
test('preflight failure reports need for user action without a write fallback',async t=>{
 const f=await fixture(t,{preflightError:true});await f.send('run');assert.equal(f.clicks,0);assert.ok(!f.requests.includes('commit'));assert.ok(f.stored.inflight);assert.match(f.stored.status,/表单不匹配/);
});
test('runtime commands accept only own popup and cannot replace connection during unresolved work',async t=>{
 const f=await fixture(t,{inflight:true});let called=false;assert.equal(f.handler({action:'run'},{id:'extension',url:'https://evil.test'},()=>called=true),undefined);assert.equal(called,false);
 const r=await new Promise(resolve=>f.handler({action:'pair',pairing:'{}'},{id:'extension',url:'chrome-extension://extension/popup.html'},resolve));assert.match(r.error,/先核对/);assert.equal(f.requests.length,0);
});

test('storage protection failure fails closed without making platform or bridge requests',async t=>{
 const f=await fixture(t,{storageFailure:true});const r=await f.send('run');assert.match(r.error,/存储保护/);assert.equal(f.requests.length,0);assert.equal(f.actions.length,0);
});
test('extension service-worker import graph must compile without top-level await',async()=>{
 const {build}=await import('esbuild');
 // Node allows TLA in modules; Chromium ServiceWorker explicitly forbids it.
 await assert.rejects(build({stdin:{contents:'await Promise.resolve()',sourcefile:'bad-worker.js'},write:false,logLevel:'silent',format:'esm',supported:{'top-level-await':false}}),/Top-level await/);
 const result=await build({entryPoints:[new URL('../browser-extension/background.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',supported:{'top-level-await':false},logLevel:'silent'});assert.ok(result.outputFiles[0].text.length>0);
});

test('null or failed page responses cannot reach account registration or claim a task',async t=>{
 const f=await fixture(t,{identityResult:null});const r=await f.send('run');assert.equal(f.requests.filter(x=>x==='account').length,0);assert.equal(f.requests.filter(x=>x==='claim').length,0);assert.match(f.stored.status,/编辑器操作结果/);assert.equal(f.clicks,0);
});

test('verification recovers a closed editor tab without claiming or publishing a job',async t=>{
 const f=await fixture(t,{editorTab:9,missingTab:true});assert.equal((await f.send('verify')).ok,true);assert.deepEqual(f.actions,['get-tab','new-tab','identity']);assert.deepEqual(f.requests,['account']);assert.equal(f.stored.editorTab,1);assert.equal(f.clicks,0);
});
test('verification preserves an existing owned tab',async t=>{
 const f=await fixture(t,{editorTab:9});assert.equal((await f.send('verify')).ok,true);assert.deepEqual(f.actions,['get-tab','identity']);assert.equal(f.clicks,0);
});
test('popup command errors remain visible after closing and reopening it',async t=>{
 const f=await fixture(t);const result=await f.send('unknown');assert.match(result.error,/不支持/);assert.equal(f.stored.status,result.error);
});

// A legacy CSDN connection must never authorize a newly selected platform.
test('unpaired platform verification cannot reuse legacy CSDN connection',async t=>{
 const f=await fixture(t);const result=await f.send('verify','toutiao');assert.match(result.error,/先为 今日头条 配对|先为 头条 配对/);assert.deepEqual(f.requests,[]);assert.deepEqual(f.actions,[]);
});

test('prepare response loss reconciles only the original editor without refilling or publishing',async t=>{
 const f=await fixture(t,{mode:'prepare',lostReport:true});await f.send('run');assert.ok(f.stored.inflight);
 await f.send('reconcile');assert.equal(f.stored.inflight,undefined);assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.actions.filter(a=>a==='prepared').length,2);assert.equal(f.clicks,0);assert.ok(!f.requests.includes('commit'));
});
test('changed prepared content remains unresolved without a new write',async t=>{
 const f=await fixture(t,{mode:'prepare',inflight:true,preparedError:true});await f.send('reconcile');assert.ok(f.stored.inflight);assert.deepEqual(f.actions,['prepared']);assert.equal(f.clicks,0);
});
test('explicit cancellation clears a prepare journal without opening or touching an editor',async t=>{
 const f=await fixture(t,{mode:'prepare',inflight:true,cancelled:true});await f.send('reconcile');assert.equal(f.stored.inflight,undefined);assert.deepEqual(f.actions,[]);assert.deepEqual(f.requests,['job-state']);
});

test('preflight wait retains one editor; alarms never submit and explicit resume uses original draft',async t=>{
 const options={preflightError:true,canResume:true,receipt:{state:'submitted',articleId:'123',url:'https://mp.csdn.net/mp_blog/creation/success/123'}};
 const f=await fixture(t,options);await f.send('run');assert.ok(f.stored.inflight);
 await f.alarm();await f.send('run');assert.equal(f.clicks,0);assert.equal(f.actions.filter(a=>a==='fill').length,1);
 options.preflightError=false;await f.send('resume');assert.equal(f.clicks,1);assert.equal(f.stored.inflight,undefined);
 assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.actions.filter(a=>a==='fill').length,1);
 assert.equal(f.requests.filter(a=>a==='resume').length,1);assert.equal(f.requests.filter(a=>a==='commit').length,1);
});
test('resume cannot replay a lost commit, cancelled task or changed original draft',async t=>{
 const options={canResume:true,lostCommit:true};const f=await fixture(t,options);await f.send('run');await f.send('resume');assert.equal(f.clicks,0);assert.equal(f.requests.filter(a=>a==='commit').length,1);assert.ok(f.stored.inflight);
});
test('resume rechecks original editor content before renewing lease',async t=>{
 const f=await fixture(t,{inflight:true,canResume:true,preparedError:true});await f.send('resume');assert.equal(f.clicks,0);assert.ok(!f.requests.includes('resume'));assert.ok(!f.requests.includes('commit'));assert.ok(f.stored.inflight);
});
test('cancelled publish journal clears without reading or refilling any editor',async t=>{
 const f=await fixture(t,{inflight:true,cancelled:true});await f.send('reconcile');assert.equal(f.stored.inflight,undefined);assert.deepEqual(f.actions,[]);
});

test('partial fill failures preserve the original journal and never silently create a duplicate draft',async t=>{
 const f=await fixture(t,{partialFillError:true,canResume:true});await f.send('run');assert.ok(f.stored.inflight);await f.alarm();await f.send('run');assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.clicks,0);
});

test('read-only inspection supports a legacy CSDN editor binding without opening another tab',async t=>{
 const f=await fixture(t,{editorTab:9});assert.equal((await f.send('inspect')).ok,true);assert.deepEqual(f.actions,['inspect']);assert.equal(f.clicks,0);assert.deepEqual(f.requests,[]);
});

const zhihuIdentity={accountId:'author',name:'作者',editorReady:true,evidenceUrl:'https://zhuanlan.zhihu.com/write'};
test('Zhihu draft mode observes saved evidence without preflight, commit or publish',async t=>{
 const f=await fixture(t,{platform:'zhihu',mode:'draft',identityResult:zhihuIdentity});await f.send('run','zhihu');
 assert.equal(f.clicks,0);assert.ok(!f.actions.includes('preflight'));assert.ok(!f.requests.includes('commit'));assert.equal(f.actions.filter(a=>a==='draft-receipt').length,2);assert.equal(f.stored.inflightByPlatform.zhihu,undefined);assert.match(f.stored.status,/草稿已保存/);
});
test('lost draft report reconciles the same editor without creating or filling again',async t=>{
 const f=await fixture(t,{platform:'zhihu',mode:'draft',identityResult:zhihuIdentity,lostReport:true});await f.send('run','zhihu');assert.ok(f.stored.inflightByPlatform.zhihu);
 await f.send('reconcile','zhihu');assert.equal(f.stored.inflightByPlatform.zhihu,undefined);assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.clicks,0);
});
test('changed draft remains unresolved and never triggers publish or another editor',async t=>{
 const f=await fixture(t,{platform:'zhihu',mode:'draft',identityResult:zhihuIdentity,inflight:true,draftError:true});await f.send('reconcile','zhihu');assert.ok(f.stored.inflightByPlatform.zhihu);assert.deepEqual(f.actions,['draft-receipt']);assert.equal(f.clicks,0);
});
