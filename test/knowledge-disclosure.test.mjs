import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {factDisclosure,factValid,factUsable,contentDisclosureConflict} from '../src/knowledge-core.js';
import {checkInput,checkStale} from '../src/checks-core.js';
import {downloadBackup} from '../src/governance.js';
import {externalStateView,externalCheckSection} from '../src/external-disclosure.js';
import {retrievalSelection,selectionFingerprint,retrievalCorpus} from '../src/semantic-core.js';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

const secret='INTERNAL-ORIGINAL-SENTINEL-仅内部资料';
function env(){const db=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));const files=new Map();return {db,DB:d1Adapter(db),files,FILES:{async put(k,v){files.set(k,Buffer.from(v))},async get(k){const b=files.get(k);return b?{body:b,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null},async delete(k){files.delete(k)}},GEO_RUNNINGHUB_OWNER_ID:'owner',GEO_RUNNINGHUB_KEY:'FIXTURE_ONLY',GEO_RUNNINGHUB_MODEL:'fixture'};}
async function call(e,path,method='GET',body,actor='owner',headers={}){const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':actor,'x-geo-request':'1',...headers},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),e);return {status:response.status,data:await response.json()};}
const state=async e=>(await call(e,'/api/state')).data;
async function seed(e){const w=await state(e);w.state.brands.push({id:'b',name:'测试品牌'},{id:'other',name:'其他品牌'});w.state.questions.push({id:'q',brandId:'b',text:'怎样整理资料？',version:'v1'});w.state.facts.push({id:'public',brandId:'b',key:'公开功能',value:'产品可以整理用户主动导入的资料。',source:'产品说明',status:'已确认'},{id:'internal',brandId:'b',key:'内部资料',value:secret,source:'INTERNAL-SOURCE-SENTINEL',status:'已确认',disclosure:'internal'});w.state.contents.push({id:'article',brandId:'b',title:'资料整理说明',text:'产品可以整理用户主动导入的资料。',status:'草稿',factIds:['public']});assert.equal((await call(e,'/api/state','PUT',w)).status,200);return state(e);}
async function edit(e,id,disclosure){const w=await state(e),f=w.state.facts.find(f=>f.id===id);return call(e,'/api/knowledge/fact','POST',{...f,revision:w.revision,disclosure});}
async function mockModel(fn){const original=globalThis.fetch;let count=0;const requests=[];globalThis.fetch=async(url,options)=>{count++;requests.push(JSON.parse(options.body));return Response.json({id:'fixture-receipt',choices:[{message:{content:'# 资料整理说明\n\n产品可以整理用户主动导入的资料。\n\n本文包含 AI 辅助创作。'}}],usage:{total_tokens:10}})};try{await fn(()=>count,requests)}finally{globalThis.fetch=original}}

test('disclosure keeps legacy public behavior, honors explicit legacy secrecy and is separate from factual validity',()=>{
 const f={status:'已确认',value:'资料内容',source:'说明'};assert.equal(factDisclosure(f),'public');assert.equal(factUsable(f),true);
 for(const change of [{disclosure:'internal'},{private:true},{confidential:true},{allowPublic:false},{disclosure:'unknown'},{disclosure:'public',private:true}]){assert.equal(factDisclosure({...f,...change}),'internal');assert.equal(factValid({...f,...change}),true);assert.equal(factUsable({...f,...change}),false);}
 assert.equal(factValid({...f,source:'',disclosure:'internal'}),false);
});
test('scope changes are versioned; making an internal fact public needs fresh confirmation and never fixes missing evidence',async()=>{
 const e=env();await seed(e);const one=await edit(e,'public','internal');assert.equal(one.status,200);const f=one.data.state.facts.find(f=>f.id==='public');assert.equal(f.status,'已确认');assert.equal(f.history.at(-1).values.disclosure,'internal');assert.equal(f.history.at(-2).values.disclosure,'public');assert.equal(factUsable(f),false);
 const two=await edit(e,'public','public');assert.equal(two.status,200);const reopened=two.data.state.facts.find(f=>f.id==='public');assert.equal(reopened.status,'待确认');assert.equal(factUsable(reopened),false);
 const w=await state(e);w.state.facts.find(f=>f.id==='internal').source='';assert.equal((await call(e,'/api/state','PUT',w)).status,200);const three=await edit(e,'internal','public');assert.equal(three.status,400);assert.equal((await state(e)).state.facts.find(f=>f.id==='internal').disclosure,'internal');
});
test('invalid disclosure is rejected by dedicated and whole-state routes and readers cannot alter it',async()=>{
 const e=env();await seed(e);assert.equal((await edit(e,'public','typo')).status,400);const w=await state(e);w.state.facts[0].disclosure='typo';assert.equal((await call(e,'/api/state','PUT',w)).status,400);
 await call(e,'/api/manage/members','POST',{email:'reader@example.com',role:'viewer',brands:['b']});assert.equal((await call(e,'/api/knowledge/fact','POST',{id:'public',brandId:'b',disclosure:'public',revision:w.revision},'reader',{'x-geo-workspace':'owner','oai-authenticated-user-email':'reader@example.com'})).status,403);
});
test('batch review confirms internal facts without expanding their disclosure and detects scope changes',async()=>{
 const e=env();await seed(e);const w=await state(e);for(const f of w.state.facts)f.status='待确认';assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 const preview=(await call(e,'/api/knowledge/review-preview','POST',{brandId:'b'})).data.plan;assert.equal(preview.rows.find(f=>f.id==='internal').disclosure,'internal');assert.equal(preview.rows.find(f=>f.id==='internal').eligible,true);
 const body={brandId:'b',ids:preview.ids,selectedIds:['internal'],previewHash:preview.previewHash,batchId:'internal-review-fixture-001',reviewed:true};const first=await call(e,'/api/knowledge/review-batch','POST',body);assert.equal(first.status,200);assert.equal(factUsable(first.data.state.facts.find(f=>f.id==='internal')),false);const again=await call(e,'/api/knowledge/review-batch','POST',body);assert.equal(again.data.existing,true);assert.equal(again.data.revision,first.data.revision);
 const p=(await call(e,'/api/knowledge/review-preview','POST',{brandId:'b'})).data.plan;await edit(e,'public','internal');assert.equal((await call(e,'/api/knowledge/review-batch','POST',{...body,ids:p.ids,selectedIds:['public'],previewHash:p.previewHash,batchId:'changed-scope-fixture-001'})).status,409);
});
test('pasted and binary document imports retain internal scope through matching and idempotent retries',async()=>{
 const e=env();await seed(e);const body={brandId:'b',source:'内部手册',material:'另一份仅内部保存的材料原文。',disclosure:'internal'};const pasted=await call(e,'/api/import-facts','POST',body);assert.equal(pasted.status,200);const doc=pasted.data.state.sourceDocuments[0];assert.equal(doc.disclosure,'internal');const review=await call(e,'/api/review-facts','POST',{brandId:'b',ids:pasted.data.ids});assert.ok(review.data.state.facts.filter(f=>f.sourceDocumentId===doc.id).every(f=>f.status==='已确认'&&!factUsable(f)));assert.equal((await call(e,'/api/import-facts','POST',body)).data.added,0);
 const upload=disclosure=>{const form=new FormData();form.set('id','internal-document-fixture-001');form.set('brandId','b');form.set('title','内部文件');form.set('disclosure',disclosure);form.set('file',new File(['文件中的内部资料原文。'],'internal.txt'));form.set('extraction',JSON.stringify({blocks:[{text:'文件中的内部资料原文。',index:1}],selected:[0]}));return form;};
 const first=await call(e,'/api/documents/upload','POST',upload('internal'));assert.equal(first.status,200);assert.equal(first.data.document.disclosure,'internal');assert.ok(first.data.state.facts.filter(f=>f.sourceDocumentId===first.data.document.id).every(f=>f.disclosure==='internal'));assert.equal((await call(e,'/api/documents/upload','POST',upload('internal'))).data.existing,true);assert.equal((await call(e,'/api/documents/upload','POST',upload('public'))).status,409);
});
test('single and queued writing exclude internal values and sources from the actual provider request',async()=>{
 const e=env();await seed(e);await mockModel(async(count,requests)=>{
  const direct=await call(e,'/api/generate','POST',{brandId:'b',questionId:'q',provider:'runninghub',runId:'public-generate-fixture-001',title:'资料整理说明'});assert.equal(direct.status,200,JSON.stringify(direct.data));
  const task=await call(e,'/api/tasks','POST',{id:'public-writing-task-0001',brandId:'b',name:'公开资料写稿',kind:'generate',questionIds:['q'],providers:['runninghub'],repeats:1,intervalMinutes:0});assert.equal(task.status,200);await call(e,'/api/tasks/tick','POST',{planId:'public-writing-task-0001'});assert.equal(count(),2);
  for(const request of requests){const data=JSON.stringify(request);assert.ok(!data.includes(secret));assert.ok(!data.includes('INTERNAL-SOURCE-SENTINEL'));assert.ok(data.includes('产品可以整理'));}
 });
});
test('exact internal content and fact links block new checks and revisions but leave stored receipts readable',async()=>{
 const e=env();await seed(e);await mockModel(async count=>{
  const request={brandId:'b',kind:'content',provider:'runninghub',ids:['article'],confirmCost:true,runId:'public-check-fixture-0001'};const first=await call(e,'/api/checks/run','POST',request);assert.equal(first.status,200);assert.equal(count(),1);
  await edit(e,'public','internal');const recovered=await call(e,'/api/checks/run','POST',request);assert.equal(recovered.status,200);assert.equal(recovered.data.stale,true);assert.equal((await call(e,'/api/checks/run','POST',{...request,runId:'new-check-fixture-0002'})).status,409);assert.equal((await call(e,'/api/article-revision/preview','POST',{brandId:'b',contentId:'article',provider:'runninghub',instruction:'简化文字'})).status,409);assert.equal(count(),1);
  const w=await state(e);w.state.contents[0].factIds=[];w.state.contents[0].text=secret;assert.equal((await call(e,'/api/state','PUT',w)).status,200);assert.equal((await call(e,'/api/checks/run','POST',{...request,runId:'text-check-fixture-0003'})).status,409);assert.equal(count(),1);
 });
});
test('confidentiality guards isolate brands, cannot be bypassed by product relabeling, and preserve historical publishing records',()=>{
 const s={facts:[{id:'secret',brandId:'b',productId:'p',disclosure:'internal',value:secret}]};assert.equal(contentDisclosureConflict(s,{brandId:'other',productId:'p',text:secret,factIds:['secret']}),false);for(const productId of ['p','other','']){assert.equal(contentDisclosureConflict(s,{brandId:'b',productId,text:secret}),true);assert.equal(contentDisclosureConflict(s,{brandId:'b',productId,text:'已改写正文',factIds:['secret']}),true);}assert.equal(contentDisclosureConflict(s,{brandId:'b',productId:'p',text:'无关公开正文'}),false);
 const state={brands:[{id:'b',name:'品牌'}],facts:[{id:'f',brandId:'b',status:'已确认',source:'来源',value:secret}],contents:[{id:'c',brandId:'b',text:'稿件内容',factIds:['f']}],publications:[{id:'p',brandId:'b',status:'已发布'}]};const input=checkInput(state,'b','content',['c']);state.facts[0].disclosure='internal';assert.equal(checkStale({brandId:'b',kind:'content',input},state),true);assert.equal(state.publications[0].status,'已发布');assert.equal(state.contents[0].text,'稿件内容');
});
test('private backup export and restore preserve scope, originals and versions',async()=>{
 const e=env();await seed(e);const copy=(await call(e,'/api/manage/backups','POST',{})).data,bundle=await downloadBackup(e,'owner',copy.id);assert.equal(bundle.state.facts.find(f=>f.id==='internal').disclosure,'internal');assert.equal(bundle.state.facts.find(f=>f.id==='internal').value,secret);
 await call(e,'/api/manage/brands/delete','POST',{brandId:'b',confirmName:'测试品牌'});const w=await state(e),restored=await call(e,'/api/manage/backups/restore','POST',{id:copy.id,revision:w.revision});assert.equal(restored.status,200);assert.equal(restored.data.state.facts.find(f=>f.id==='internal').disclosure,'internal');assert.equal(factUsable(restored.data.state.facts.find(f=>f.id==='internal')),false);
});
test('knowledge form exposes only two simple scope choices and an explicit no-model/no-article explanation',()=>{
 const context=vm.createContext({document:{addEventListener(){}},GEO_KNOWLEDGE:{factDisclosure},esc:x=>String(x??''),uid:()=> 'new',catalogInput:()=>'',brand:()=>({productLines:[]})});vm.runInContext(fs.readFileSync(new URL('../public/knowledge.js',import.meta.url),'utf8'),context);const markup=vm.runInContext("knowledgeFactForm({id:'f',disclosure:'internal'})",context);assert.match(markup,/<option value="internal" selected>仅内部参考/);assert.match(markup,/公开使用/);assert.match(markup,/不发送给外部模型，不写入文章/);assert.equal((markup.match(/name="disclosure"/g)||[]).length,1);
});
test('external state response hides internal originals, linked drafts and raw snapshots while local workspace and backups stay complete',async()=>{
 const e=env();await seed(e);const w=await state(e);w.state.contents.push({id:'hidden-article',brandId:'b',title:'内部草稿标题',text:'关联内部事实的旧稿',status:'草稿',factIds:['internal']});w.state.logs.push({id:'hidden-log',brandId:'b',message:secret});w.state.sourceDocuments.push({id:'hidden-doc',brandId:'b',title:'内部材料',text:secret,disclosure:'internal'});assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 const key=(await call(e,'/api/manage/keys','POST',{name:'公开助手',brands:['b'],scopes:['read'],dailyLimit:50,days:1})).data.key,external=await call(e,'/api/v1/state','GET',null,'owner',{authorization:'Bearer '+key});assert.equal(external.status,200);assert.ok(!JSON.stringify(external).includes(secret));assert.ok(!JSON.stringify(external).includes('INTERNAL-SOURCE-SENTINEL'));assert.ok(!JSON.stringify(external).includes('内部草稿标题'));assert.deepEqual(external.data.state.facts.map(f=>f.id),['public']);assert.equal(external.data.state.contents.length,1);assert.equal(external.data.state.analysisChecks.length,0);assert.ok(external.data.state.disclosureView);
 const local=await state(e);assert.ok(JSON.stringify(local).includes(secret));assert.equal(local.state.contents.length,2);const before=JSON.stringify(local.state);externalStateView(local.state);assert.equal(JSON.stringify(local.state),before);
});
test('MCP check projections remove unrelated internal facts and refuse a formerly public source after scope changes',async()=>{
 const e=env();await seed(e);let recordId;await mockModel(async()=>{const r=await call(e,'/api/checks/run','POST',{brandId:'b',kind:'content',provider:'runninghub',ids:['article'],confirmCost:true,runId:'mcp-public-check-0001'});assert.equal(r.status,200);recordId=r.data.record.id;});
 const key=(await call(e,'/api/manage/keys','POST',{name:'外部审校助手',brands:['b'],scopes:['read'],dailyLimit:50,days:1})).data.key,c=new Client({name:'privacy-fixture',version:'1'},{versionNegotiation:{mode:'auto'}});await c.connect(new StreamableHTTPClientTransport(new URL('https://geo.test/api/v1/mcp'),{requestInit:{headers:{authorization:'Bearer '+key}},fetch:(url,init)=>worker.fetch(new Request(url,init),e)}));
 try{const input=await c.callTool({name:'geo_get_check',arguments:{brandId:'b',checkId:recordId,section:'input'}});assert.equal(input.isError,undefined);const data=input.structuredContent||JSON.parse(input.content[0].text);assert.ok(!JSON.stringify(data).includes(secret));assert.ok(!JSON.stringify(data).includes('INTERNAL-SOURCE-SENTINEL'));assert.equal(JSON.parse(data.text).facts.length,1);assert.equal(data.disclosureView.filtered,true);
  await edit(e,'public','internal');for(const section of ['input','result','raw']){const result=await c.callTool({name:'geo_get_check',arguments:{brandId:'b',checkId:recordId,section}});assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes(secret));}const saved=(await state(e)).state.analysisChecks.find(r=>r.id===recordId);assert.ok(saved.input.facts.some(f=>f.value===secret));
 }finally{await c.close()}
});
test('check result projection detects internal fact IDs and old source quotes independently of unrelated input filtering',()=>{
 const s={facts:[{id:'hidden',brandId:'b',value:secret,source:'内部手册',disclosure:'internal'}],contents:[]},record={brandId:'b',kind:'content',input:{targets:[{id:'c',title:'公开稿',text:'普通内容'}],facts:[{id:'hidden',value:'以前公开的原文现已改为内部',source:'历史来源',status:'已确认',usable:true}]},results:[{id:'c',claims:[{factId:'hidden',factQuote:'以前公开的原文现已改为内部'}]}],rawText:'以前公开的原文现已改为内部'};assert.equal(externalCheckSection(record,s,'result'),null);assert.equal(externalCheckSection(record,s,'raw'),null);assert.deepEqual(JSON.parse(externalCheckSection(record,s,'input').text).facts,[]);
});
test('local history retrieval keeps internal originals visible but never labels them usable for writing and invalidates cached scope',()=>{
 const s={brands:[{id:'b'}],facts:[{id:'f',brandId:'b',value:secret,key:'资料',source:'手册',status:'已确认'}],sourceDocuments:[]},before=selectionFingerprint(retrievalSelection(s,'b',{includeHistory:true}));s.facts[0].disclosure='internal';const selected=retrievalSelection(s,'b',{includeHistory:true});assert.notEqual(selectionFingerprint(selected),before);const rows=retrievalCorpus(selected,{});assert.equal(rows[0].text,secret);assert.equal(rows[0].usable,false);assert.equal(rows[0].disclosure,'internal');assert.deepEqual(retrievalSelection(s,'b',{}).facts,[]);
});
test('scope guard detects historical original after editing and restricting together, across product labels but never another brand',()=>{
 const original='这是之前已经公开后来改成内部参考的完整原句。',s={facts:[{id:'f',brandId:'b',productId:'p',value:'修改后的内部完整资料原文。',disclosure:'internal',history:[{values:{value:original,disclosure:'public'}}]}]};assert.equal(contentDisclosureConflict(s,{brandId:'b',productId:'other',text:original}),true);assert.equal(contentDisclosureConflict(s,{brandId:'b',text:'公开正文',writingBasis:{brief:original}}),true);assert.equal(contentDisclosureConflict(s,{brandId:'other',text:original}),false);
});
test('short common internal values do not block unrelated prose but explicit IDs and internal snapshots always do',()=>{
 const s={facts:[{id:'f',brandId:'b',value:'支持',disclosure:'internal'}]};assert.equal(contentDisclosureConflict(s,{brandId:'b',text:'产品支持公开资料导入。'}),false);assert.equal(contentDisclosureConflict(s,{brandId:'b',productId:'other',factIds:['f'],text:'改写的正文'}),true);assert.equal(contentDisclosureConflict(s,{brandId:'b',factSnapshots:[{id:'f',value:'支持',disclosure:'internal'}],text:'正文'}),true);
});
