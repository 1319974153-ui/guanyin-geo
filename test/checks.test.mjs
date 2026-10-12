import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {checkInput,checkStale,parseChecks,duplicates,factUsable} from '../src/checks-core.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),GEO_RUNNINGHUB_OWNER_ID:'owner',GEO_RUNNINGHUB_KEY:'TEST_FIXTURE',GEO_RUNNINGHUB_MODEL:'fixture-model'}}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands.push({id:'b1',name:'甲产品',aliases:'甲软件'},{id:'b2',name:'乙产品'});w.state.facts.push({id:'f1',brandId:'b1',key:'适用范围',value:'甲产品仅支持企业账号导入资料。',source:'产品原始说明',status:'已确认'},{id:'f2',brandId:'b1',value:'甲产品支持普通账号导入资料。',source:'过期说明',status:'已确认',expiresAt:'2000-01-01'});w.state.contents.push({id:'c1',brandId:'b1',title:'使用指南',text:'甲产品支持所有账号导入资料。每一个账号都能直接迁移和使用全部功能，不需要企业认证即可开始。',status:'草稿',factIds:['f1']},{id:'c2',brandId:'b1',title:'另一份稿件',text:'甲产品支持所有账号导入资料。每一个账号都能直接迁移和使用全部功能，不需要企业认证即可开始。',status:'草稿'},{id:'c3',brandId:'b2',title:'未授权品牌稿件',text:'甲产品支持所有账号导入资料。每一个账号都能直接迁移和使用全部功能，不需要企业认证即可开始。',status:'草稿'});w.state.answers.push({id:'a1',brandId:'b1',surface:'import',status:'ok',text:'甲产品并不适合个人用户。可以考虑其他工具。',citations:[],sentiment:'待复核',recommended:false,recommendationLabeled:false});assert.equal((await call(e,'/api/state','PUT',w)).status,200);return (await call(e,'/api/state')).data;}
const request={brandId:'b1',provider:'runninghub',kind:'content',ids:['c1'],runId:'check-fixture-request-001'};
const result={results:[{id:'c1',claims:[{quote:'甲产品支持所有账号导入资料。',relation:'条件遗漏',factId:'f1',factQuote:'甲产品仅支持企业账号导入资料。',reason:'遗漏企业账号限制'}]}]};
async function mock(response,fn){const previous=globalThis.fetch;let count=0;globalThis.fetch=async(u,o)=>{count++;return typeof response==='function'?response(u,o):Response.json({id:'fixture-check-receipt',choices:[{message:{content:JSON.stringify(response)}}],usage:{total_tokens:99}})};try{await fn(()=>count)}finally{globalThis.fetch=previous}}
const run=e=>call(e,'/api/checks/run','POST',request);
test('content checks preserve exact quotes, source snapshots, local duplicates and never approve a draft',async()=>{
 const e=env();await seed(e);await mock(result,async count=>{const r=await run(e);assert.equal(r.status,200);const c=r.data.record;assert.equal(c.results[0].claims[0].relation,'条件遗漏');assert.equal(c.input.targets[0].duplicates.length,1);assert.equal(c.input.targets[0].duplicates[0].id,'c2');assert.equal(c.input.targets[0].duplicates[0].score,1);assert.equal(c.inputHash.length,64);assert.equal(r.data.state.contents[0].status,'草稿');assert.equal(r.data.stale,false);assert.equal((await run(e)).status,200);assert.equal(count(),1);assert.equal((await call(e,'/api/checks/run','POST',{...request,ids:['c2']})).status,409)});
});
test('long checks allow a supplier response beyond the ordinary deadline and reuse its persisted receipt',async()=>{
 const e=env();await seed(e);const timeout=AbortSignal.timeout;let deadline;
 AbortSignal.timeout=ms=>{deadline=ms;return new AbortController().signal};
 try{await mock(async()=>{if(deadline<120000)throw new DOMException('slow supplier','TimeoutError');return Response.json({id:'slow-check-receipt',choices:[{message:{content:JSON.stringify(result)}}]})},async count=>{const response=await run(e);assert.equal(response.status,200);assert.equal(response.data.record.requestId,'slow-check-receipt');assert.equal(deadline,180000);assert.equal((await run(e)).status,200);assert.equal(count(),1)});}finally{AbortSignal.timeout=timeout;}
});
test('a failed browser check exposes recovery immediately and keeps the same paid request identity on resume',async()=>{
 const nodes=new Map(),storage=new Map(),sent=[];let renders=0;
 const context=vm.createContext({console,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener(){}},accessInfo:{current:{owner:'owner'}},brand:()=>({id:'b1'}),runtimeBusy:false,runtimeLock:v=>context.runtimeBusy=v,runtimeFlush:async()=>{},openDrawer(){},btn:()=>'<button>恢复</button>',toast(){},render:()=>renders++,$:selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',insertAdjacentHTML(){}});return nodes.get(selector)},apiRequest:async(path,options)=>{sent.push(JSON.parse(options.body));throw new Error('模型连接中断');}});
 vm.runInContext(readFileSync(new URL('../public/checks.js',import.meta.url),'utf8'),context);
 vm.runInContext(`activeChecksBatch={scope:checksScope(),brandId:'b1',kind:'content',provider:'runninghub',next:0,groups:[{ids:['c1'],runId:'stable-browser-check-001'}]};rememberChecks();`,context);
 await vm.runInContext('runChecksBatch()',context);assert.equal(renders,1);assert.equal(nodes.get('#drawer-title').textContent,'检查未完成');assert.match(nodes.get('#checks-progress').textContent,/0 \/ 1/);assert.match(vm.runInContext('pendingChecksButton()',context),/恢复/);assert.equal(context.runtimeBusy,false);
 await vm.runInContext(`checksAction('checks-resume',{})`,context);assert.equal(sent.length,2);assert.equal(sent[0].runId,sent[1].runId);assert.equal(JSON.parse(storage.get('geo.checks.pending')).next,0);
});
test('fabricated excerpts, unavailable facts, stale facts, and unknown target IDs cannot appear as supported evidence',async()=>{
 const e=env(),w=await seed(e),input=checkInput(w.state,'b1','content',['c1']);
 const r=parseChecks(JSON.stringify({results:[{id:'c1',claims:[{quote:'杜撰不存在原句',relation:'支持',factId:'f1',factQuote:'甲产品仅支持企业账号导入资料。'},{quote:'甲产品支持所有账号导入资料。',relation:'支持',factId:'f2',factQuote:'甲产品支持普通账号导入资料。'},{quote:'甲产品支持所有账号导入资料。',relation:'疑似冲突',factId:'foreign',factQuote:'资料句子'}]},{id:'c3',claims:[]}]}),input);
 assert.equal(r.results[0].claims.length,2);assert.ok(r.results[0].claims.every(c=>c.relation==='缺少证据'&&!c.factId));assert.ok(r.parseError);assert.ok(r.results[0].problems.length);
 assert.equal(factUsable({status:'已确认',source:'来源',expiresAt:'nonsense'}),false);assert.equal(factUsable({status:'已确认',source:''}),false);
});
test('quote escaping repairs retain exact evidence, while altered quotes and truncated JSON remain untrusted',async()=>{
 const e=env(),w=await seed(e),input=checkInput(w.state,'b1','content',['c1']);
 const raw='{"results":[{"id":"c1","claims":[{"quote":"甲产品支持所有账号导入资料。","relation":"条件遗漏","factId":"f1","factQuote":"甲产品仅支持企业账号导入资料。","reason":"需注明"企业"限制"}]}]}';
 const p=parseChecks(raw,input);assert.equal(p.parseError,'');assert.equal(p.parseRepair.addedEscapes,2);assert.equal(p.results[0].claims[0].relation,'条件遗漏');assert.equal(p.results[0].claims[0].reason,'需注明"企业"限制');
 const altered=parseChecks(raw.replace('甲产品支持所有账号导入资料。','甲产品支持"所有"账号导入资料。'),input);assert.equal(altered.parseError,'');assert.equal(altered.results[0].claims.length,0);assert.equal(altered.results[0].excludedClaims.length,1);assert.match(altered.results[0].problems.join(''),/原句/);
 for(const invalid of [raw.slice(0,-1),"{results:[]}",'{"results":[],}',raw.replace('"c1"','"c1",')])assert.ok(parseChecks(invalid,input).parseError);
});
test('legacy result reparsing uses saved evidence without a supplier call, preserves history, isolates brands and is idempotent',async()=>{
 const e=env();await seed(e);await mock(result,async count=>{const one=await run(e);const w=(await call(e,'/api/state')).data,legacy=w.state.analysisChecks[0];legacy.rawText=JSON.stringify(result).replace('遗漏企业账号限制','遗漏"企业"账号限制');legacy.results=[];legacy.parseError='旧版无法解析';delete legacy.parserVersion;
 await e.DB.prepare('UPDATE workspaces SET body=?,revision=revision+1 WHERE owner=?').bind(JSON.stringify(w.state),'owner').run();
 const input={brandId:'b1',runId:one.data.record.id,rawText:'malicious replacement'};assert.equal((await call(e,'/api/checks/reparse','POST',{...input,brandId:'b2'})).status,404);
 const fixed=await call(e,'/api/checks/reparse','POST',input);assert.equal(fixed.status,200);assert.equal(fixed.data.record.rawText,legacy.rawText);assert.equal(fixed.data.record.parseError,'');assert.equal(fixed.data.record.results[0].claims.length,1);assert.equal(fixed.data.record.parsingHistory[0].parseError,'旧版无法解析');assert.equal(fixed.data.state.contents[0].status,'草稿');
 const again=await call(e,'/api/checks/reparse','POST',input);assert.equal(again.data.existing,true);assert.equal(again.data.revision,fixed.data.revision);assert.equal(again.data.record.parsingHistory.length,1);assert.equal(count(),1);
 await call(e,'/api/manage/members','POST',{email:'reader@test.example',role:'viewer',brands:['b1']});const h={'x-geo-workspace':'owner','oai-authenticated-user-email':'reader@test.example'};assert.equal((await call(e,'/api/checks/reparse','POST',input,'reader',h)).status,403);
 await call(e,'/api/manage/members','POST',{email:'reviewer@test.example',role:'reviewer',brands:['b1']});assert.equal((await call(e,'/api/checks/reparse','POST',input,'reviewer',{'x-geo-workspace':'owner','oai-authenticated-user-email':'reviewer@test.example'})).status,200);
 });
});
test('answer sentiment and negation require real original quotes and do not overwrite manually maintained labels',async()=>{
 const e=env();await seed(e);await mock({results:[{id:'a1',sentiment:'负面',sentimentQuote:'甲产品并不适合个人用户。',negations:[{quote:'甲产品并不适合个人用户。',reason:'对个人用户的限制'}],claims:[]}]},async()=>{const r=await call(e,'/api/checks/run','POST',{...request,kind:'answer',ids:['a1']});assert.equal(r.status,200);assert.equal(r.data.record.results[0].sentiment,'负面');assert.equal(r.data.record.results[0].negations.length,1);assert.equal(r.data.state.answers[0].sentiment,'待复核');assert.equal(r.data.state.answers[0].recommendationLabeled,false)});
 const input=checkInput((await call(e,'/api/state')).data.state,'b1','answer',['a1']),parsed=parseChecks(JSON.stringify({results:[{id:'a1',sentiment:'正面',sentimentQuote:'不存在的好评句子',negations:[{quote:'伪造的否定',reason:'错误'}],claims:[]}]}),input);assert.equal(parsed.results[0].sentiment,'无法判断');assert.equal(parsed.results[0].negations.length,0);
});
test('changed content, brand aliases, fact values, expiry and duplicate corpus invalidate old checks',async()=>{
 const e=env(),w=await seed(e),input=checkInput(w.state,'b1','content',['c1'],'2026-01-01T00:00:00Z'),r={brandId:'b1',kind:'content',input};assert.equal(checkStale(r,w.state,'2026-01-01'),false);
 for(const mutate of [s=>s.contents[0].text+='改稿',s=>s.brands[0].aliases='其他别名',s=>s.facts[0].value='新条件',s=>s.contents[1].text='不同内容'] ){const copy=structuredClone(w.state);mutate(copy);assert.equal(checkStale(r,copy,'2026-01-01'),true);}
 w.state.facts[0].expiresAt='2026-01-02T00:00:00Z';const exp={...r,input:checkInput(w.state,'b1','content',['c1'],'2026-01-01')};assert.equal(checkStale(exp,w.state,'2026-01-03'),true);
});
test('malformed and missing checks retain raw model receipts and cannot be treated as complete evidence',async()=>{
 const e=env();await seed(e);await mock(()=>Response.json({choices:[{message:{content:'null'}}]}),async count=>{const r=await run(e);assert.equal(r.status,200);assert.ok(r.data.record.parseError);assert.equal(r.data.record.rawText,'null');assert.equal((await run(e)).status,200);assert.equal(count(),1)});
 const w=(await call(e,'/api/state')).data,p=parseChecks('{"results":[]}',checkInput(w.state,'b1','content',['c1']));assert.ok(p.results[0].problems.length);
});
test('paid checks survive workspace write failure and retry the receipt without another model call',async()=>{
 const e=env();await seed(e);const prepare=e.DB.prepare;let broken=true;e.DB.prepare=function(sql){if(broken&&sql.startsWith('UPDATE workspaces'))return {bind(){return {async run(){throw new Error('storage fixture')}}}};return prepare.call(this,sql)};
 await mock(result,async count=>{assert.equal((await run(e)).status,503);broken=false;assert.equal((await run(e)).status,200);assert.equal(count(),1)});
});
test('concurrent and uncertain requests cannot double-charge; budget rejects subsequent paid checks',async()=>{
 const e=env();await seed(e);await mock(result,async count=>{const r=await Promise.all([run(e),run(e)]);assert.ok(r.some(x=>x.status===200));assert.ok(r.every(x=>[200,409].includes(x.status)));assert.equal(count(),1)});
 const e2=env();await seed(e2);await mock(()=>{throw new Error('network fixture')},async count=>{assert.equal((await run(e2)).status,502);assert.equal((await run(e2)).status,409);assert.equal(count(),1)});
 await call(e,'/api/manage/policy','PUT',{brands:50,questions:2000,jobs:100,platformsPerJob:4,repeatsPerJob:5,dailyModelCalls:1});assert.equal((await call(e,'/api/checks/run','POST',{...request,runId:'check-another-fixture-001'})).status,429);
});
test('brand and role isolation apply to checks and whole-workspace saves cannot forge evidence',async()=>{
 const e=env();await seed(e);await call(e,'/api/manage/members','POST',{email:'member@test.example',role:'editor',brands:['b2']});const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'member@test.example'};
 assert.equal((await call(e,'/api/checks/run','POST',request,'member',headers)).status,404);
 await call(e,'/api/manage/members','POST',{email:'member@test.example',role:'viewer',brands:['b1']});assert.equal((await call(e,'/api/checks/run','POST',request,'member',headers)).status,403);
 await call(e,'/api/manage/members','POST',{email:'member@test.example',role:'reviewer',brands:['b1']});await mock(result,async()=>assert.equal((await call(e,'/api/checks/run','POST',request,'member',headers)).status,200));
 const w=(await call(e,'/api/state')).data;w.state.analysisChecks[0].results[0].claims[0].relation='支持';assert.equal((await call(e,'/api/state','PUT',w)).status,403);
 assert.equal((await call(e,'/api/checks/run','POST',{...request,ids:['c3'],runId:'check-cross-brand-test-001'})).status,404);
 assert.equal((await call(e,'/api/state','GET',null,'other')).data.state.analysisChecks.length,0);
});
test('concurrent source edits mark results stale and deleting the brand cannot recreate it',async()=>{
 const e=env();await seed(e);await mock(async()=>{const w=(await call(e,'/api/state')).data;w.state.contents[0].text='检查过程中改了正文';await call(e,'/api/state','PUT',w);return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})},async()=>assert.equal((await run(e)).data.stale,true));
 const e2=env();await seed(e2);await mock(async()=>{const w=(await call(e2,'/api/state')).data;for(const [k,v]of Object.entries(w.state))if(Array.isArray(v))w.state[k]=v.filter(x=>k==='brands'?x.id!=='b1':x.brandId!=='b1');await call(e2,'/api/state','PUT',w);return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})},async()=>assert.equal((await run(e2)).status,409));
});
test('local similarity ignores short texts and identifies shared long paragraphs without external fetching',()=>{
 assert.deepEqual(duplicates({id:'a',text:'你好'},[{id:'b',text:'你好'}]),[]);const p='这是一个用于检查相同长段落的本地内容片段，不能误称为互联网原创性检测。';const r=duplicates({id:'a',text:p+'\n独有内容'},[{id:'b',title:'另文',text:p+'\n另一段内容'},{id:'c',text:'完全不同'}]);assert.equal(r.length,1);assert.equal(r[0].quote,p);
});
test('product evidence is accepted only for its own target or as brand-general evidence',async()=>{
 const e=env(),w=await seed(e),input=checkInput(w.state,'b1','content',['c1']);input.facts[0].productId='p1';input.targets[0].productId='p2';
 const parse=()=>parseChecks(JSON.stringify(result),input).results[0];assert.equal(parse().claims[0].relation,'缺少证据');assert.equal(parse().claims[0].factId,'');
 input.targets[0].productId=null;assert.equal(parse().claims[0].relation,'缺少证据');
 input.targets[0].productId='p1';assert.equal(parse().claims[0].relation,'条件遗漏');
 input.facts[0].productId='';input.targets[0].productId='p2';assert.equal(parse().claims[0].relation,'条件遗漏');
 const old={brandId:'b1',kind:'content',input:checkInput(w.state,'b1','content',['c1'])};old.input.version=1;assert.equal(checkStale(old,w.state),true);
});
