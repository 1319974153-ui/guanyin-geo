import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {formatArticle} from '../src/article-format.js';
import {yuquePublicMatches,yuqueRunState} from '../src/yuque.js';
import {dispatchArticle,reconcileDispatch,recoverDispatchJournal} from '../src/publish-dispatch-core.js';

function environment(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')}}
async function call(e,path,method='GET',body,user='owner'){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
const accountId='yq-11111111-1111-4111-8111-111111111111';
const config={brandId:'b1',accountId,site:'https://www.yuque.com/team/book',token:'yuque-private-token'};
const args={brandId:'b1',accountId};
const firstId='gy-'+'a'.repeat(64),secondId='gy-'+'b'.repeat(64);
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'品牌甲'},{id:'b2',name:'品牌乙'}];w.state.contents=[{id:'c1',brandId:'b1',title:'语雀草稿验收',text:'## 非公开草稿\n\n仅用于软件验收。',status:'已审核',ai:true}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
function reply(value){return Response.json({data:value})}
async function fixture(fn,opts={}){
 const original=globalThis.fetch,docs=new Map(),calls=[];
 globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET';
  if(u.hostname.includes('dns')){if(opts.dnsDown)throw Error('dns offline');return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='AAAA'?28:1,data:u.searchParams.get('type')==='AAAA'?'2606:4700:4700::1111':'1.1.1.1'}]})}
  assert.equal(u.hostname,'www.yuque.com');assert.equal(options.redirect,'manual');
  if(!u.pathname.startsWith('/api/v2/')){
   const doc=docs.get(u.pathname.split('/').at(-1));
   const page=doc?.public?'<h1>'+doc.title+'</h1><article>'+formatArticle(doc.body).html+'</article>':'not public';
   return new Response(opts.publicHtml??page,{status:opts.publicUnavailable?403:200,headers:{'content-type':'text/html'}});
  }
  assert.equal(new Headers(options.headers).get('x-auth-token'),config.token);
  calls.push({method,path:u.pathname,body:options.body?JSON.parse(options.body):null});
  if(opts.handler){const value=await opts.handler({method,path:u.pathname,body:options.body?JSON.parse(options.body):null,docs,calls});if(value)return value}
  if(method==='GET'&&u.pathname==='/api/v2/user')return reply({id:'user-7',login:'owner',name:'温舒'});
  if(method==='GET'&&u.pathname==='/api/v2/repos/team/book')return reply({id:'repo-7',name:'测试知识库'});
  if(method==='POST'&&u.pathname==='/api/v2/repos/team/book'){
   const doc={id:'doc-'+(docs.size+1),...JSON.parse(options.body),public:false};docs.set(doc.slug,doc);
   if(opts.lost)throw Error('lost response');
   return reply({id:doc.id,slug:doc.slug});
  }
  if(method==='GET'&&u.pathname.startsWith('/api/v2/repos/team/book/docs/')){const doc=docs.get(decodeURIComponent(u.pathname.split('/').at(-1)));return doc?reply(doc):new Response('{}',{status:404,headers:{'content-type':'application/json'}})}
  if(method==='PUT'&&u.pathname.startsWith('/api/v2/repos/team/book/docs/')){
   const slug=decodeURIComponent(u.pathname.split('/').at(-1)),old=docs.get(slug),body=JSON.parse(options.body);
   if(!old)return new Response('{}',{status:404,headers:{'content-type':'application/json'}});
   Object.assign(old,body,{public:body.public===1});
   if(opts.publishLost)throw Error('lost response');
   return reply({id:old.id,slug:old.slug});
  }
  throw Error('unexpected '+method+' '+u.pathname);
 };
 try{return await fn({calls,docs})}finally{globalThis.fetch=original}
}
const connect=e=>call(e,'/api/yuque/connection','POST',config);
async function create(e,id=firstId){const p=await call(e,'/api/yuque/preview?'+new URLSearchParams({...args,contentId:'c1'}));return call(e,'/api/yuque/draft','POST',{...args,id,contentId:'c1',previewHash:p.data.previewHash})}
const run=(e,action,id)=>call(e,'/api/yuque/'+action,'POST',{...args,id});

test('connection verifies the own token and target book without exposing the token',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{
  const r=await connect(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.connection.username,'温舒');assert.equal(r.data.connection.site,'https://www.yuque.com/team/book/');assert.ok(r.data.connection.verifiedAt);
  assert.deepEqual(calls.slice(0,2).map(x=>x.path),['/api/v2/user','/api/v2/repos/team/book']);
  assert.ok(!e.db.prepare('SELECT secret FROM connections').get().secret.includes(config.token));
  assert.equal((await call(e,'/api/state')).data.connections.length,0);
  const center=(await call(e,'/api/publishing-center?brandId=b1')).data;const account=center.accounts.find(a=>a.platform==='yuque');assert.equal(account.status,'api_verified');assert.equal(account.verification,'api_access_and_repo_read');assert.equal(account.capabilities.createDraft,true);assert.equal(account.capabilities.publish,true);assert.ok(!JSON.stringify(center).includes(config.token));
 });e.db.close();
});
test('invalid target, missing token, unauthorized brands and redirects never save or send a token',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{
  for(const change of [{site:'http://www.yuque.com/team/book'},{site:'https://www.yuque.com/team/book/doc'},{site:'https://evil.example/team/book'},{site:'https://www.yuque.com/team/book?x=1'},{site:'https://www.yuque.com/团队/知识库'},{token:'short'},{brandId:'other'}])assert.notEqual((await call(e,'/api/yuque/connection','POST',{...config,...change})).status,200);
  assert.equal(calls.length,0);
 },{handler:({path})=>path==='/api/v2/user'?new Response(null,{status:302,headers:{location:'https://evil.example/'}}):null});e.db.close();
});
test('one-click draft creates and re-reads exactly one original document',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,docs})=>{
  await connect(e);const created=await create(e);assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.data.record.state,'draft');assert.equal(created.data.record.remote.docId,'doc-1');
  assert.equal((await create(e,secondId)).data.existing,true);assert.equal(docs.size,1);assert.equal(calls.filter(x=>x.method==='POST').length,1);
  const body=calls.find(x=>x.method==='POST').body;assert.equal(body.public,0);assert.equal(body.format,'markdown');assert.match(body.body,/AI 辅助生成/);
 });e.db.close();
});
test('lost create response is reconciled by deterministic document slug without another write',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{
  await connect(e);assert.equal((await create(e)).status,502);
  assert.equal((await create(e,secondId)).data.record.state,'uncertain');
  const reconciled=await run(e,'reconcile',firstId);assert.equal(reconciled.status,200,JSON.stringify(reconciled));assert.equal(reconciled.data.record.state,'draft');
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
 },{lost:true});e.db.close();
});
test('backup restoration pauses API access and brand deletion removes only that brand token',async()=>{
 const e=environment();await seed(e);await fixture(async()=>{
  await connect(e);await call(e,'/api/yuque/connection','POST',{...config,brandId:'b2',accountId:'yq-22222222-2222-4222-8222-222222222222'});
  const backup=(await call(e,'/api/manage/backups','POST',{label:'yuque'})).data,w=(await call(e,'/api/state')).data;
  assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision})).status,200);
  assert.equal((await create(e)).status,400);
  assert.equal((await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'品牌甲'})).status,200);
  assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'yuque:b1:%'").get().n,0);
  assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'yuque:b2:%'").get().n,1);
 });e.db.close();
});
test('publish only promotes the saved original and requires anonymous full-body evidence',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,docs})=>{
  await connect(e);const draft=(await create(e)).data.record;const published=await run(e,'publish',draft.id);
  assert.equal(published.status,200,JSON.stringify(published));assert.equal(published.data.record.state,'published');assert.equal(published.data.record.remote.publicVerified,true);
  assert.equal((await run(e,'publish',draft.id)).data.existing,true);assert.equal(docs.size,1);assert.equal(calls.filter(x=>x.method==='PUT').length,1);
 });e.db.close();
});
test('inaccessible or lost public outcomes remain submitted or uncertain and are never resent',async()=>{
 for(const opts of [{publicUnavailable:true},{publishLost:true,publicUnavailable:true}]){
  const e=environment();await seed(e);await fixture(async({calls})=>{
   await connect(e);const draft=(await create(e)).data.record;const result=await run(e,'publish',draft.id);
   if(opts.publishLost){assert.equal(result.status,502);assert.equal((await run(e,'reconcile',draft.id)).data.record.state,'submitted');}
   else assert.equal(result.data.record.state,'submitted');
   assert.equal(calls.filter(x=>x.method==='PUT').length,1);
  },opts);e.db.close();
 }
});
test('public evidence rejects a snippet, altered body and login page',()=>{
 const r={snapshot:{title:'中文 & 回执'},html:'<p>完整正文</p><p>AI 声明</p>'};
 assert.equal(yuquePublicMatches('<h1>中文 &amp; 回执</h1><article><p>完整正文</p><p>AI 声明</p></article>',r),true);
 for(const html of ['<h1>中文 &amp; 回执</h1><p>完整正文</p>','<h1>中文 &amp; 回执</h1><p>部分正文</p><p>AI 声明</p>','<title>登录</title>'])assert.equal(yuquePublicMatches(html,r),false);
 assert.equal(yuqueRunState({publishAcceptedAt:'2026-11-06T00:00:00Z'},'uncertain'),'submitted');
});
test('distribution uses the same durable Yuque original for draft, publish and journal recovery',async()=>{
 const article={id:'c1',brandId:'b1',title:'语雀稿件',text:'正文',status:'已审核',ai:false},target={key:'yuque:yq',platform:'yuque',accountId:'yq',name:'温舒',modes:['draft','publish']},journal={},calls=[];
 const request=async(path,init)=>{calls.push({path,init});if(path.includes('/preview?'))return {previewHash:'preview'};return {record:{id:'durable-yuque',state:path.endsWith('/publish')?'submitted':'draft',remote:{docId:'doc-7'}}}};
 const input={article,targets:[target],mode:'publish',journal,request,persist:async()=>{},assertScope:()=>{}};
 await dispatchArticle(input);await dispatchArticle(input);
 assert.equal(calls.filter(x=>x.path==='/api/yuque/draft').length,1);assert.equal(calls.filter(x=>x.path==='/api/yuque/publish').length,1);assert.equal(journal[target.key].state,'submitted');
 await reconcileDispatch({article,journal,request:async path=>{assert.match(path,/\/api\/yuque\/detail\?/);return {record:{state:'submitted',remote:{docId:'doc-7'}}}},persist:async()=>{},assertScope:()=>{}});
 const recovered=await recoverDispatchJournal({article,targets:[target],jobs:[{id:'durable-yuque',platform:'yuque',accountId:'yq',brandId:'b1',contentId:'c1',state:'draft',currentRevision:true,receipt:{docId:'doc-7'}}],journal:{}});
 assert.equal(recovered[target.key].id,'durable-yuque');
});
test('browser dispatch bundle carries the guarded Yuque draft and publish path',async()=>{
 const context={crypto:globalThis.crypto,TextEncoder,URLSearchParams,structuredClone,setTimeout,clearTimeout};vm.createContext(context);
 vm.runInContext(fs.readFileSync(new URL('../public/publish-dispatch-core.js',import.meta.url),'utf8'),context);
 const article={id:'c1',brandId:'b1',title:'语雀稿件',text:'正文',status:'已审核',ai:false},target={key:'yuque:yq',platform:'yuque',accountId:'yq',name:'温舒',modes:['draft','publish']},journal={},calls=[];
 await context.GEO_DISPATCH.dispatchArticle({article,targets:[target],mode:'publish',journal,assertScope(){},persist:async()=>{},request:async(path,init)=>{calls.push({path,init});return path.includes('/preview?')?{previewHash:'preview'}:{record:{id:'durable-yuque',state:path.endsWith('/publish')?'submitted':'draft',remote:{docId:'doc-7'}}}}});
 assert.equal(calls.filter(c=>c.path==='/api/yuque/draft').length,1);assert.equal(calls.filter(c=>c.path==='/api/yuque/publish').length,1);assert.equal(journal[target.key].state,'submitted');
});
