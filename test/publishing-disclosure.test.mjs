import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker,{emptyState} from '../src/worker.js';
import {publishingContentSnapshot} from '../src/publish-authorization-core.js';
import {protectHandoffSnapshots} from '../src/publication-core.js';
import {assertPlatformAdaptationExport} from '../src/platform-content-adaptation.js';
import * as knowledge from '../src/knowledge-core.js';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const state=emptyState();state.brands=[{id:'b',name:'测试品牌'},{id:'other',name:'其他品牌'}];state.contents=[{id:'c',brandId:'b',title:'审核稿',text:'客户合同内部报价为每月 37 万元。',status:'已审核',factSnapshots:[]}];
 state.facts=[{id:'secret',brandId:'b',key:'内部报价',value:state.contents[0].text,source:'客户内部合同',disclosure:'internal',status:'已确认',version:1}];
 const env={db,DB:d1Adapter(db),GEO_LOCAL_MODE:'true',STATIC_SITE:{request(){throw Error('unexpected remote call')},list(){return []}}};
 const call=async(path,method='GET',body)=>{const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,data:await response.json()}};
 const save=()=>db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(state),'owner');
 return {db,env,state,call,save,async init(){await call('/api/state');save()}};
}

test('all server publishing previews and delivery packages reject internal original text without fact snapshots',async t=>{
 const f=fixture(t);await f.init();const uuid='11111111-1111-1111-1111-111111111111';
 const routes=[['wordpress','default'],['cnblogs','cb-'+uuid],['typecho','tc-'+uuid],['metaweblog','mw-'+uuid],['yuque','yq-'+uuid],['personal-site','site-test']];
 for(const [platform,accountId] of routes){const result=await f.call(`/api/${platform}/preview?brandId=b&contentId=c&accountId=${accountId}`);assert.equal(result.status,409,platform+JSON.stringify(result.data));assert.match(result.data.error,/内部/)}
 const packet=await f.call('/api/delivery-hub/publication-package','POST',{brandId:'b',contentId:'c'});assert.equal(packet.status,409);assert.match(packet.data.error,/内部/);
 const wechat=await f.call('/api/wechat/package?brandId=b&contentId=c');assert.equal(wechat.status,409);assert.match(wechat.data.error,/内部/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n,0);
});

test('exact authorization and platform exports reject linked internal facts, aliases and original text but keep other brands isolated',()=>{
 const content={id:'c',brandId:'b',title:'稿件',text:'公开介绍',status:'已审核',factIds:['f']};const state={brands:[{id:'b'}],contents:[content],facts:[{id:'f',brandId:'b',value:'内部单价',disclosure:'internal'}]};
 assert.throws(()=>publishingContentSnapshot(state,'b','c'),/内部/);assert.throws(()=>assertPlatformAdaptationExport(state,content),/内部/);
 // Short values are protected by explicit links; complete source sentences
 // additionally protect older drafts that did not retain those links.
 state.facts[0].value='客户合同内部单价为每月三十七万元。';content.factIds=[];content.text='报价依据：'+state.facts[0].value;assert.throws(()=>publishingContentSnapshot(state,'b','c'),/内部/);
 state.facts[0].brandId='other';assert.doesNotThrow(()=>publishingContentSnapshot(state,'b','c'));assert.equal(assertPlatformAdaptationExport(state,content),true);
 state.facts[0].brandId='b';state.facts[0].disclosure='public';state.facts[0].allowPublic=false;assert.throws(()=>publishingContentSnapshot(state,'b','c'),/内部/);
});

test('new handoff snapshots are denied while historical saved snapshots remain readable and immutable',()=>{
 const content={id:'c',brandId:'b',title:'标题',text:'内部定价方案约定每季度调整服务费。',status:'已审核',factSnapshots:[]};const state={contents:[content],brands:[{id:'b'}],facts:[{id:'f',brandId:'b',value:content.text,disclosure:'internal'}],publications:[]};
 const publication={id:'p',brandId:'b',contentId:'c',handoffSnapshot:{contentId:'c',brandId:'b',title:content.title,text:content.text,factSnapshots:[]}};
 assert.throws(()=>protectHandoffSnapshots(state,{...state,publications:[publication]}),/内部/);
 state.publications=[publication];assert.doesNotThrow(()=>protectHandoffSnapshots(state,structuredClone(state)));assert.equal(state.publications[0].handoffSnapshot.text,content.text);
});

test('handoff download and simple copy recheck internal sources before placing text outside the editor',async()=>{
 const content={id:'c',brandId:'b',title:'历史稿',text:'内部项目报价包含客户专属折扣金额。',status:'已审核'},publication={id:'p',brandId:'b',contentId:'c',handoffSnapshot:{contentId:'c',brandId:'b',title:content.title,text:content.text,factSnapshots:[]}};
 let downloads=0;const state={contents:[content],publications:[publication],facts:[{id:'f',brandId:'b',value:content.text,disclosure:'internal'}]};
 const context={state,GEO_KNOWLEDGE:knowledge,own:key=>state[key],download:()=>downloads++,document:{addEventListener(){}},toast(){}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../public/publish-guide.js',import.meta.url),'utf8'),context);
 await assert.rejects(context.publishGuideAction('handoff-download',{dataset:{id:'p'}}),/内部/);assert.equal(downloads,0);assert.equal(publication.handoffSnapshot.text,content.text);
 const simple=fs.readFileSync(new URL('../public/simple.js',import.meta.url),'utf8');assert.match(simple,/if\(p\?\.handoffSnapshot\)\{assertPublicationHandoffDisclosure\(p\);await navigator\.clipboard\.writeText/);
});

test('text-only API previews and handoff packages explicitly reject persistent image drafts instead of omitting attachments',async t=>{
 const f=fixture(t);await f.init();f.state.facts=[];Object.assign(f.state.contents[0],{mediaRefs:[{id:'am-'+'a'.repeat(64),sha256:'a'.repeat(64),rightsConfirmed:true}],mediaVersion:1});f.save();const uuid='11111111-1111-1111-1111-111111111111';
 for(const [platform,accountId] of [['wordpress','default'],['cnblogs','cb-'+uuid],['typecho','tc-'+uuid],['metaweblog','mw-'+uuid],['yuque','yq-'+uuid],['personal-site','site-test']]){const response=await f.call(`/api/${platform}/preview?brandId=b&contentId=c&accountId=${accountId}`);assert.equal(response.status,409,platform+JSON.stringify(response.data));assert.match(response.data.error,/配图/);}
 assert.equal((await f.call('/api/wechat/package?brandId=b&contentId=c')).status,409);assert.equal((await f.call('/api/delivery-hub/publication-package','POST',{brandId:'b',contentId:'c'})).status,409);
 const current=f.state,next=structuredClone(current),content=current.contents[0];next.publications.push({id:'p',brandId:'b',contentId:'c',handoffSnapshot:{contentId:'c',brandId:'b',title:content.title,text:content.text,factSnapshots:[]}});assert.throws(()=>protectHandoffSnapshots(current,next),/配图/);
});
