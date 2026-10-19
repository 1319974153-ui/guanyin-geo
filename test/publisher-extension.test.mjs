import test from 'node:test';
import assert from 'node:assert/strict';
const fixtureJob={id:'job',lease:'lease',mode:'publish',accountId:'author',sourceHash:'hash',tags:['技术'],snapshot:{title:'文章',html:'<p>正文</p>'}};
async function fixture(t,options={}){
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;
 let handler,alarm,clicks=0;const actions=[],requests=[],stored={editorTab:options.editorTab,connection:{origin:'http://127.0.0.1:58729',instance:'instance',token:'fixture-token'},...(options.inflight?{inflight:{job:fixtureJob,tabId:1}}:{})};
 globalThis.chrome={storage:{local:{async setAccessLevel(){if(options.storageFailure)throw new Error('failed')},async get(key){return{[key]:stored[key]}},async set(value){Object.assign(stored,value)},async remove(key){delete stored[key]}}},runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:{addListener:h=>handler=h},onStartup:{addListener(){}}},alarms:{async create(){},onAlarm:{addListener:h=>alarm=h}},tabs:{async get(id){actions.push('get-tab');if(options.missingTab)throw new Error('No tab with id: '+id);return{id}},async create(){actions.push('new-tab');return{id:1}}},scripting:{async executeScript({args}){
  const action=args[0].action;actions.push(action);
  if(action==='identity'&&Object.hasOwn(options,'identityResult'))return[{result:options.identityResult}];
  if(action==='identity')return[{result:{accountId:'author',name:'作者',editorReady:true,evidenceUrl:'https://mp.csdn.net/mp_blog/creation/editor'}}];
  if(action==='submit')clicks++;
  if(action==='receipt')return[{result:options.receipt||null}];
  if(action==='preflight'&&options.preflightError)throw new Error('表单不匹配');
  return[{result:{ready:true,prepared:true,attempted:true}}];
 }}};
 globalThis.fetch=async(url,init)=>{
  const action=new URL(url).pathname.split('/').pop();requests.push(action);const body=JSON.parse(init.body);
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(body.instance,'instance');
  if(action==='commit'&&options.lostCommit)throw new Error('提交许可响应丢失');
  const result=action==='pending'?{count:1}:action==='claim'?{job:{...fixtureJob,mode:options.mode||'publish'}}:action==='commit'?{permit:true,validUntil:Date.now()+10000}:action==='report'?{job:{state:options.lostCommit?'uncertain':body.state}}:{};
  return new Response(JSON.stringify(result));
 };
 await import('../browser-extension/background.js?fixture='+Math.random());
 t.after(()=>{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch});
 const send=action=>new Promise(resolve=>handler({action},{id:'extension',url:'chrome-extension://extension/popup.html'},resolve));
 return{send,actions,requests,stored,get clicks(){return clicks},alarm:()=>alarm({name:'publisher'}),handler};
}
test('extension prepares, checks, commits once, then reports only actual success-page evidence',async t=>{
 const f=await fixture(t,{receipt:{state:'submitted',articleId:'123',url:'https://mp.csdn.net/mp_blog/creation/success/123'}});await f.send('run');
 assert.deepEqual(f.actions,['new-tab','identity','fill','preflight','submit','receipt']);assert.deepEqual(f.requests,['pending','account','claim','commit','report']);assert.equal(f.clicks,1);assert.equal(f.stored.inflight,undefined);
});
test('lost commit response is not retried; restart/alarm reconciles without opening a new editor',async t=>{
 const f=await fixture(t,{lostCommit:true});await f.send('run');assert.equal(f.clicks,0);assert.ok(f.stored.inflight);await f.alarm();await f.send('run');assert.equal(f.actions.filter(a=>a==='new-tab').length,1);assert.equal(f.requests.filter(a=>a==='commit').length,1);assert.equal(f.clicks,0);
});
test('preparation mode never commits or clicks publish',async t=>{
 const f=await fixture(t,{mode:'prepare'});await f.send('run');assert.equal(f.clicks,0);assert.ok(!f.requests.includes('commit'));assert.ok(!f.actions.includes('preflight'));assert.equal(f.stored.inflight,undefined);
});
test('preflight failure reports need for user action without a write fallback',async t=>{
 const f=await fixture(t,{preflightError:true});await f.send('run');assert.equal(f.clicks,0);assert.ok(!f.requests.includes('commit'));assert.equal(f.stored.inflight,undefined);assert.match(f.stored.status,/表单不匹配/);
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
