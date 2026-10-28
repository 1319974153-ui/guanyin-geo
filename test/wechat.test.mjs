import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatReadiness,wechatPackage,wechatPublishReceipt,wechatArticle} from '../src/wechat-core.js';
import {createWechatClient} from '../src/wechat-client.js';
import {wechatWorkflow} from '../src/wechat-workflow.js';
const pack=()=>wechatPackage({title:'订单交接测试',text:'## 业务流程\n\n整理订单并保留原始记录。',ai:true});
const scope={owner:'a',brandId:'b',accountId:'c'},cover={bytes:new Uint8Array([137,80,78,71,13,10,26,10]),mime:'image/png'};
function fixture(overrides={}){
 const rows=new Map(),calls=[];let article;
 const clone=x=>x&&structuredClone(x);
 const store={async findOrCreate(key,hash,r){const old=[...rows.values()].find(x=>x.key===key&&x.contentHash===hash);if(old)return clone(old);rows.set(r.id,clone(r));return clone(r)},async get(id){return clone(rows.get(id))},async save(r){rows.set(r.id,clone(r))},async claim(id,from,to){const r=rows.get(id);if(r.state!==from)return false;r.state=to;return true}};
 const base={uploadCover:async()=>({media_id:'cover1'}),addDraft:async a=>{article=a;return {media_id:'draft1'}},getDraft:async()=>({news_item:[article]}),submit:async()=>({publish_id:'pub1'}),status:async()=>({publish_status:0,article_id:'a1',article_detail:{item:[{article_url:'https://mp.weixin.qq.com/s/test'}]}})};
 const client=Object.fromEntries(Object.entries({...base,...overrides}).map(([k,f])=>[k,async(...args)=>{calls.push(k);return f(...args)}]));
 const run=(action,extra={})=>wechatWorkflow({store,client,scope,action,pack:pack(),cover,permissions:{draft:true,publish:true},type:'verified_business',...extra});
 return {rows,store,calls,run};
}
test('personal account never gains publish rights from login or permission flag',()=>{
 assert.equal(wechatReadiness('personal',{draft:true,publish:true}).publish,false);
 assert.equal(wechatReadiness('personal',{draft:true}).createDraft,true);
 assert.equal(wechatReadiness('verified_business').publish,false);
 assert.equal(wechatReadiness('verified_business',{publish:true}).publish,true);
});
test('package enforces safe HTML, disclosure, image and length limits',()=>{
 assert.match(pack().content,/AI 辅助/);assert.equal(pack().status,'prepared');
 assert.throws(()=>wechatPackage({title:'a'.repeat(33),text:'正文'}));
 assert.throws(()=>wechatPackage({title:'正文',text:'![x](https://example.com/a.png)'}),/图片/);
 assert.throws(()=>wechatPackage({title:'正文',text:'正文',sourceUrl:'https://u:p@example.com'}));
 assert.doesNotMatch(wechatPackage({title:'正文',text:'<script>alert(1)</script>'}).content,/<script>/);
 assert.throws(()=>wechatArticle(pack(),''));
});
test('platform success is not public-body verification or mass send',()=>{
 const r=wechatPublishReceipt({publish_status:0,article_id:'1',article_detail:{item:[{article_url:'https://mp.weixin.qq.com/s/ok'}]}});
 assert.equal(r.state,'platform_published');assert.equal(r.publicVerified,false);assert.equal(r.broadcast,false);
 assert.equal(wechatPublishReceipt({publish_status:1}).state,'submitted');
 assert.throws(()=>wechatPublishReceipt({publish_status:0}));
 assert.throws(()=>wechatPublishReceipt({publish_status:0,article_id:'1',article_detail:{item:[{article_url:'https://evil.example/'}]}}));
});
test('protocol disabled by default; no network or tokens requested',async()=>{
 const c=createWechatClient({fetchImpl:()=>assert.fail('network'),tokenProvider:()=>assert.fail('token')});
 await assert.rejects(c.submit('1'),/NOT_ENABLED/);
});
test('protocol token refresh and upload keep credentials at fixed host; no redirects',async()=>{
 const calls=[],c=createWechatClient({enabled:true,tokenProvider:async()=>'SECRET',fetchImpl:async(u,o)=>{calls.push({u,o});return Response.json({media_id:'m'})}});
 await c.stableToken({appid:'wx1234567890abcdef',secret:'1234567890abcdef'});await c.uploadCover(cover.bytes,cover.mime);
 assert.equal(JSON.parse(calls[0].o.body).force_refresh,false);assert.equal(calls[0].u.search,'');
 assert.equal(calls[1].u.hostname,'api.weixin.qq.com');assert.equal(calls[1].o.redirect,'manual');assert.equal(calls[1].o.body.get('media').type,'image/png');
});
test('lost mutation response is uncertain, redacted and never retried',async()=>{
 let calls=0;const c=createWechatClient({enabled:true,tokenProvider:async()=>'SECRET',fetchImpl:async()=>{calls++;throw Error('SECRET raw url')}});
 await assert.rejects(c.submit('d'),e=>e.uncertain&&!e.message.includes('SECRET'));assert.equal(calls,1);
 const redirect=createWechatClient({enabled:true,tokenProvider:async()=>'SECRET',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example'}})});
 await assert.rejects(redirect.addDraft({}),/HTTP_302/);
});
test('draft claim prevents parallel duplicates and repeats',async()=>{
 const f=fixture();await Promise.all([f.run('draft'),f.run('draft')]);const r=[...f.rows.values()][0];
 assert.equal(r.state,'draft');await f.run('draft');assert.equal(f.calls.filter(x=>x==='addDraft').length,1);
 await assert.rejects(f.run('publish',{taskId:r.id,scope:{...scope,owner:'other'}}),/找不到/);
});
test('lost creation response never reuploads or recreates',async()=>{
 const f=fixture({addDraft:async()=>{throw Error('lost')}});const r=await f.run('draft');assert.equal(r.state,'uncertain');
 await f.run('draft');await f.run('reconcile',{taskId:r.id});assert.deepEqual(f.calls,['uploadCover','addDraft']);
});
test('changed remote content blocks publication',async()=>{
 const f=fixture({getDraft:async()=>({news_item:[{title:'changed'}]})});const r=await f.run('draft');assert.equal(r.state,'uncertain');
 await f.run('publish',{taskId:r.id});assert.ok(!f.calls.includes('submit'));
});
test('publication uses original draft, submits once and reconciles by ID',async()=>{
 const f=fixture(),r=await f.run('draft');await Promise.all([f.run('publish',{taskId:r.id}),f.run('publish',{taskId:r.id})]);
 assert.equal(f.calls.filter(x=>x==='submit').length,1);const p=await f.run('reconcile',{taskId:r.id});assert.equal(p.state,'platform_published');assert.equal(p.publicVerified,false);
 await f.run('publish',{taskId:r.id});assert.equal(f.calls.filter(x=>x==='submit').length,1);
});
test('uncertain publication cannot be resubmitted; personal publishing blocked',async()=>{
 const f=fixture({submit:async()=>{throw Error('lost')}}),r=await f.run('draft');
 await assert.rejects(f.run('publish',{taskId:r.id,type:'personal'}),/权限/);
 assert.equal((await f.run('publish',{taskId:r.id})).state,'uncertain');await f.run('publish',{taskId:r.id});
 await assert.rejects(f.run('reconcile',{taskId:r.id}),/禁止重发/);assert.equal(f.calls.filter(x=>x==='submit').length,1);
});
test('reconcile cannot undo an in-flight claim',async()=>{
 const f=fixture(),r=await f.run('draft');await f.store.claim(r.id,'draft','publishing');
 assert.equal((await f.run('reconcile',{taskId:r.id})).state,'publishing');assert.equal(f.calls.filter(x=>x==='status').length,0);
});
test('readback reconciliation holds a claim while awaiting network',async()=>{
 const f=fixture(),r=await f.run('draft');let release,entered;
 const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const client={getDraft:async()=>{entered();await gate;return {news_item:[wechatArticle(r.pack,r.coverId)]}}};
 const pending=wechatWorkflow({store:f.store,client,scope,action:'reconcile',taskId:r.id});await started;
 const during=await f.run('publish',{taskId:r.id});assert.equal(during.state,'reconciling');assert.ok(!f.calls.includes('submit'));
 release();assert.equal((await pending).state,'draft');
 await f.run('publish',{taskId:r.id});assert.equal(f.calls.filter(x=>x==='submit').length,1);
});
test('token acquisition failures never expose token-provider details',async()=>{
 const c=createWechatClient({enabled:true,tokenProvider:async()=>{throw Error('PRIVATE_KEY')},fetchImpl:()=>assert.fail('network')});
 await assert.rejects(c.draftCount(),e=>e.code==='TOKEN_UNAVAILABLE'&&!e.message.includes('PRIVATE_KEY'));
});
