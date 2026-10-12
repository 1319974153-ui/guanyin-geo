import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import vm from 'node:vm';
import {d1Adapter} from '../local/d1-adapter.mjs';import worker,{analyzeHtml} from '../src/worker.js';
import {buildSchema,schemaSource} from '../src/schemas.js';import {safeSchemaJson,schemaScript,validateSchema,inspectStructuredData,extractFaq} from '../src/schema-core.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return{DB:d1Adapter(db),db};}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
async function state(e){return (await call(e,'/api/state')).data;}
async function seed(e){const w=await state(e);w.state.brands.push({id:'b1',name:'甲品牌',aliases:'甲,Brand A',site:'https://example.com'},{id:'b2',name:'乙品牌'});w.state.contents.push({id:'c1',brandId:'b1',title:'产品使用指南',text:'## 如何开始？\n先创建项目。\n\n## 如何分享？\n设置成员权限。',status:'草稿'});assert.equal((await call(e,'/api/state','PUT',w)).status,200);return state(e);}
const product={brandId:'b1',id:'p1',name:'资料管理工具',description:'按项目整理资料。',url:'https://example.com/product',image:'https://example.com/product.png',category:'企业服务',sku:'A-1',status:'active'};
async function saveProduct(e,overrides={}){const w=await state(e);return call(e,'/api/brands/product','POST',{...product,revision:w.revision,...overrides});}
async function schema(e,input={}){const w=await state(e);return call(e,'/api/schemas','POST',{id:'schema-fixture-request-001',brandId:'b1',type:'Organization',revision:w.revision,...input});}
test('brand profiles preserve unrelated assets, record server history, reject unsafe URLs and stale changes',async()=>{
 const e=env();const w=await seed(e),b=w.state.brands[0];assert.equal(b.profileVersion,1);
 const input={...b,name:'甲品牌新名',description:'新的介绍',revision:w.revision,brandId:b.id};const r=await call(e,'/api/brands/profile','POST',input);assert.equal(r.status,200);assert.equal(r.data.state.brands[0].profileVersion,2);assert.equal(r.data.state.brands[0].profileHistory[0].values.name,'甲品牌');assert.equal(r.data.state.contents[0].brandId,'b1');assert.equal(r.data.state.brands[1].name,'乙品牌');
 assert.equal((await call(e,'/api/brands/profile','POST',input)).status,409);assert.equal((await call(e,'/api/brands/profile','POST',{...input,revision:r.data.revision,logo:'javascript:alert(1)'})).status,400);
 const raw=await state(e);raw.state.brands[0].profileHistory=[];assert.equal((await call(e,'/api/state','PUT',raw)).status,403);
});
test('product lines retain versions, reject active duplicates, archive and restore without erasing prior schemas',async()=>{
 const e=env();await seed(e);assert.equal((await saveProduct(e)).status,200);assert.equal((await saveProduct(e)).data.item.version,1);
 assert.equal((await saveProduct(e,{id:'p2'})).status,409);const first=await schema(e,{type:'Product',productId:'p1'});assert.equal(first.status,200);assert.equal(first.data.record.value.name,product.name);
 const archived=await saveProduct(e,{status:'archived'});assert.equal(archived.data.item.version,2);assert.equal(archived.data.item.history[0].values.status,'active');assert.equal((await schema(e,{id:'schema-archive-request-002',type:'Product',productId:'p1'})).status,400);
 assert.equal((await saveProduct(e,{name:'新版工具'})).data.item.version,3);const after=await state(e);assert.equal(after.state.schemaRecords[0].source.product.name,product.name);assert.notDeepEqual(schemaSource(after.state,first.data.record.input),first.data.record.source);
 const forged=structuredClone(after);forged.state.brands[0].productLines[0].name='伪造';assert.equal((await call(e,'/api/state','PUT',forged)).status,403);
});
test('catalog administration and schema generation enforce roles and brand isolation',async()=>{
 const e=env();await seed(e);await saveProduct(e);for(const role of ['editor','reviewer','viewer'])await call(e,'/api/manage/members','POST',{email:role+'@example.com',role,brands:['b1']});
 const w=await state(e);for(const role of ['editor','reviewer','viewer']){const h={'x-geo-workspace':'owner','oai-authenticated-user-email':role+'@example.com'};assert.equal((await call(e,'/api/brands/product','POST',{...product,revision:w.revision},role,h)).status,403);const current=await call(e,'/api/state','GET',null,role,h);assert.equal(current.data.state.brands.length,1);assert.equal(current.data.state.brands[0].productLines.length,1);const input={id:'role-schema-request-'+role,brandId:'b1',type:'Organization',revision:current.data.revision};assert.equal((await call(e,'/api/schemas','POST',input,role,h)).status,role==='editor'?200:403);if(role==='editor'){const now=await state(e);assert.equal((await call(e,'/api/schemas','POST',{...input,id:'other-brand-schema-001',brandId:'b2',revision:now.revision},role,h)).status,404);}}
 assert.equal((await call(e,'/api/state','GET',null,'different-owner')).data.state.schemaRecords.length,0);
});
test('four schema types use actual sources without inventing ratings, offers, authors or publication dates',async()=>{
 const e=env();await seed(e);await saveProduct(e);const w=await state(e);
 const p=buildSchema(w.state,{brandId:'b1',type:'Product',productId:'p1'});assert.equal(p.value.brand.name,'甲品牌');assert.equal(p.value.sku,'A-1');assert.ok(!p.value.offers&&!p.value.review&&!p.value.aggregateRating);assert.ok(p.validation.warnings.some(x=>x.includes('报价')));
 const a=buildSchema(w.state,{brandId:'b1',type:'Article',contentId:'c1'});assert.equal(a.value.headline,'产品使用指南');assert.ok(!a.value.datePublished&&!a.value.author);assert.ok(a.validation.warnings.some(x=>x.includes('尚未审核')));
 const explicit=buildSchema(w.state,{brandId:'b1',type:'Article',contentId:'c1',author:'张作者',authorType:'Person',datePublished:'2026-09-01',url:'https://example.com/a'});assert.equal(explicit.value.author.name,'张作者');assert.equal(explicit.value.mainEntityOfPage['@id'],'https://example.com/a');
 const f=buildSchema(w.state,{brandId:'b1',type:'FAQPage',questions:[{question:'如何使用？',answer:'先创建项目。'}]});assert.equal(f.value.mainEntity[0].acceptedAnswer.text,'先创建项目。');assert.throws(()=>buildSchema(w.state,{brandId:'b2',type:'Article',contentId:'c1'}),/不属于/);
});
test('schema snapshots persist, are protected, recover the same request and survive full backup restore',async()=>{
 const e=env();await seed(e);const r=await schema(e);assert.equal(r.status,200);assert.equal(r.data.record.sourceHash.length,64);assert.equal((await schema(e)).data.existing,true);assert.equal((await schema(e,{type:'Article',contentId:'c1'})).status,409);
 let w=await state(e);w.state.schemaRecords[0].value.name='改写快照';assert.equal((await call(e,'/api/state','PUT',w)).status,403);
 const backup=(await call(e,'/api/manage/backups','POST',{})).data;await saveProduct(e);w=await state(e);const restored=await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision});assert.equal(restored.status,200);assert.equal(restored.data.state.schemaRecords[0].value.name,'甲品牌');assert.equal((await state(e)).state.schemaRecords.length,1);
});
test('schema input rejects malformed dates, duplicate FAQ, cross-brand content, dangerous URLs and empty required fields',async()=>{
 const e=env();await seed(e);await saveProduct(e);const w=await state(e),base={brandId:'b1',type:'Article',contentId:'c1'};
 for(const values of [{datePublished:'2026-02-30'},{datePublished:'2026-09-20',dateModified:'2026-09-01'},{url:'javascript:alert(1)'},{author:'作者',authorType:'Unknown'}])assert.throws(()=>buildSchema(w.state,{...base,...values}));
 assert.throws(()=>buildSchema(w.state,{brandId:'b1',type:'FAQPage',questions:[{question:'同题',answer:'甲'},{question:'同题',answer:'乙'}]}),/重复/);
 assert.throws(()=>buildSchema(w.state,{brandId:'b1',type:'FAQPage',questions:[{question:'题',answer:''}]}),/都需要/);
 assert.equal((await schema(e,{id:'bad'})).status,400);
});
test('field validation checks graphs and references, reports every broken script, and cannot mistake arbitrary JSON for complete fields',()=>{
 const graph={'@context':'https://schema.org','@graph':[{'@type':'Article',headline:'标题',author:{'@id':'#writer'}},{'@id':'#writer','@type':'Person',name:'作者'}]};assert.equal(validateSchema(graph).valid,true);
 assert.equal(validateSchema({'@type':'Product'}).valid,false);assert.equal(validateSchema({'@type':'FAQPage',mainEntity:[]}).valid,false);assert.equal(validateSchema({'@type':'Article',headline:'x',image:'data:text/html,x'}).valid,false);
 const html='<script TYPE=application/ld+json>{"@context":"https://schema.org","@type":"Organization","name":"品牌"}</script><script type="application/ld+json">{broken}</script>';
 const r=inspectStructuredData(html);assert.equal(r.count,2);assert.equal(r.valid,false);assert.deepEqual(r.types,['Organization']);assert.equal(r.scripts[1].syntax,false);assert.equal(analyzeHtml(html,'https://example.com',200).structuredData.valid,false);
 assert.equal(inspectStructuredData('<script>{}</script>').count,0);assert.match(validateSchema({hello:'world'}).warnings.join(''),/未找到/);
});
test('exported JSON-LD escapes HTML termination while keeping original JSON values and FAQ extraction does not silently drop overflow',()=>{
 const value={'@type':'Organization',name:'</script><script>alert(1)</script>&测试'};const code=schemaScript(value);assert.equal((code.match(/<\/script>/g)||[]).length,1);assert.deepEqual(JSON.parse(safeSchemaJson(value)),value);
 const rows=extractFaq('## 如何使用？\n先建项目。\n再导入资料。\n\n## 背景说明\n不是答案。\n\n问：支持什么？\n答：资料管理。');assert.equal(rows.length,2);assert.equal(rows[0].answer,'先建项目。\n再导入资料。');assert.equal(rows[1].answer,'资料管理。');
 assert.equal(extractFaq(Array.from({length:31},(_,i)=>'问：问题'+i+'\n答：答案').join('\n')).length,31);
});
test('rapid queued browser saves incorporate server-owned brand history without losing the second edit',async()=>{
 const e=env(),w=await seed(e),posted=[];let unblock,started;const ready=new Promise(r=>started=r),barrier=new Promise(r=>unblock=r);
 const el={classList:{},append(){},replaceChildren(){},addEventListener(){}};const context=vm.createContext({state:w.state,structuredClone,console,sessionStorage:{getItem:()=>null},window:{addEventListener(){}},document:{getElementById:()=>el,querySelector:()=>null,createTextNode:x=>x,addEventListener(){}},toast(){},fetch:async(path,opts)=>{const input=JSON.parse(opts.body);posted.push(input);if(posted.length===1){started();await barrier;}const r=await call(e,path,opts.method,input);return{ok:r.status<400,status:r.status,json:async()=>r.data}}});
 let runtime=fs.readFileSync(new URL('../public/runtime.js',import.meta.url),'utf8');const boot=runtime.indexOf('(async()=>{try{accessInfo=');runtime=runtime.slice(0,boot);vm.runInContext(runtime,context);vm.runInContext('serverRevision='+w.revision,context);
 vm.runInContext("state.brands[0].description='第一次编辑';runtimeSave(state);",context);await ready;
 vm.runInContext("state.brands[0].description='第二次编辑';runtimeSave(state);",context);unblock();await vm.runInContext('runtimeFlush()',context);
 assert.equal(posted.length,2);assert.equal(posted[1].state.brands[0].profileVersion,2);const saved=await state(e);assert.equal(saved.state.brands[0].description,'第二次编辑');assert.equal(saved.state.brands[0].profileVersion,3);assert.equal(vm.runInContext('saveBlocked',context),false);
});
test('personal schemas require explicit identity and never infer a career or account from the product brand',async()=>{
 const e=env();await seed(e);const w=await state(e);
 assert.throws(()=>buildSchema(w.state,{brandId:'b1',type:'Person'}),/姓名/);
 const p=buildSchema(w.state,{brandId:'b1',type:'Person',personName:'温舒'});assert.equal(p.value.name,'温舒');for(const key of ['jobTitle','description','sameAs','url','address','worksFor','award'])assert.ok(!(key in p.value));assert.equal(p.source.brand.name,'甲品牌');
 const profile=buildSchema(w.state,{brandId:'b1',type:'ProfilePage',personName:'温舒',url:'https://example.com/about',personBio:'记录一个自用项目。',city:'杭州',sameAs:['https://example.com/u','https://example.com/u']});assert.equal(profile.value.mainEntity.name,'温舒');assert.equal(profile.value.mainEntity.address.addressLocality,'杭州');assert.equal(profile.value.mainEntity.description,'记录一个自用项目。');assert.deepEqual(profile.value.mainEntity.sameAs,['https://example.com/u']);assert.equal(profile.value.url,'https://example.com/about');assert.ok(!profile.value.dateCreated&&!profile.value.dateModified);assert.ok(profile.validation.warnings.some(x=>x.includes('履历')));
});
test('personal profile field checks resolve a real main entity and reject malformed or credential-bearing identity links',async()=>{
 const e=env();await seed(e);const w=await state(e),base={brandId:'b1',type:'ProfilePage',personName:'温舒',url:'https://example.com/about'};
 for(const x of [{url:''},{url:'javascript:evil'},{sameAs:['https://secret:password@example.com/me']},{sameAs:['not-a-url']},{sameAs:Array(16).fill('https://example.com/u')},{personName:7}])assert.throws(()=>buildSchema(w.state,{...base,...x}));
 assert.equal(validateSchema({'@context':'https://schema.org','@type':'Person'}).valid,false);assert.equal(validateSchema({'@type':'ProfilePage',url:base.url,mainEntity:{'@id':'#missing'}}).valid,false);
 const graph={'@context':'https://schema.org','@graph':[{'@type':'ProfilePage',url:base.url,mainEntity:{'@id':'#subject'}},{'@id':'#subject','@type':'Person',name:'温舒'}]};assert.equal(validateSchema(graph).valid,true);assert.ok(validateSchema(graph).types.includes('Person'));assert.ok(validateSchema(graph).types.includes('ProfilePage'));
});
test('personal identity inputs are immutable in schema retries and retain ordinary brand and member authorization',async()=>{
 const e=env();await seed(e);const args={id:'personal-profile-request-001',type:'ProfilePage',personName:'温舒',url:'https://example.com/about',personBio:'自用实验',jobTitle:'本人填写的职业',sameAs:['https://example.com/u']};
 const r=await schema(e,args);assert.equal(r.status,200);assert.equal(r.data.record.input.jobTitle,args.jobTitle);assert.equal((await schema(e,args)).data.existing,true);assert.equal((await schema(e,{...args,personName:'另一个人'})).status,409);
 await call(e,'/api/manage/members','POST',{email:'personal-editor@example.com',role:'editor',brands:['b1']});const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'personal-editor@example.com'},w=await call(e,'/api/state','GET',null,'personal-editor',headers);
 assert.equal((await call(e,'/api/schemas','POST',{...args,id:'other-person-profile-001',brandId:'b2',revision:w.data.revision},'personal-editor',headers)).status,404);assert.equal((await state(e)).state.schemaRecords.length,1);
});
test('personal schema forms expose explicit facts and six-type checks without silently prefilling a corporate identity',()=>{
 let drawer='';const g={document:{addEventListener(){}},catalogInput:(label,name,value)=>name+':'+value,brand:()=>({name:'企业名称',site:'https://company.example'}),uid:()=> 'id',openDrawer:(title,html)=>{drawer=html}};vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/schemas.js',import.meta.url),'utf8'),g);g.schemaNew('ProfilePage');assert.match(drawer,/personName/);assert.match(drawer,/sameAsText/);assert.match(drawer,/不会从品牌名称/);assert.ok(!drawer.includes('企业名称')&&!drawer.includes('https://company.example'));assert.match(fs.readFileSync(new URL('../public/schemas.js',import.meta.url),'utf8'),/六类基础字段检查/);
});
