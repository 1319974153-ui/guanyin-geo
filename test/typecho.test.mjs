import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {typechoPublicMatches,typechoRunState} from '../src/typecho.js';
import {rpcValue,rpcRequest,parseRpc} from '../src/metaweblog-rpc.js';

function environment(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}}
async function call(e,path,method='GET',body,user='owner'){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
const accountId='tc-11111111-1111-4111-8111-111111111111';
const config={brandId:'b1',accountId,site:'https://blog.example.com/',username:'owner-name',password:'test-private-password'};
const args={brandId:'b1',accountId};
const reply=value=>new Response('<?xml version="1.0"?><methodResponse><params><param>'+rpcValue(value)+'</param></params></methodResponse>',{headers:{'content-type':'text/xml'}});
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'品牌甲'},{id:'b2',name:'品牌乙'}];w.state.contents=[{id:'c1',brandId:'b1',title:'草稿验收',text:'## 非公开草稿\n\n仅用于软件验收。',status:'已审核',ai:true}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
async function fixture(fn,opts={}){
 const original=globalThis.fetch,posts=new Map(),calls=[];
 globalThis.fetch=async(url,o={})=>{
  const u=new URL(url);if(u.hostname.includes('dns')&&opts.dnsDown)throw Error('dns offline');if(u.hostname.includes('dns')&&opts.privateDNS)return Response.json({Status:0,Answer:[{type:1,data:'10.0.0.1'}]});if(u.hostname.includes('dns'))return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='AAAA'?28:1,data:u.searchParams.get('type')==='AAAA'?'2606:4700:4700::1111':'1.1.1.1'}]});
  if(u.hostname==='blog.example.com'&&!u.pathname.endsWith('/action/xmlrpc')){assert.equal(o.headers.cookie,undefined);const post=[...posts.values()].find(p=>u.pathname==='/archives/'+p.postid);return new Response(opts.publicHtml??(post?.public?'<a class="post-title">'+post.title+'</a><div class="post-content">'+post.description+'</div>':'not public'),{status:opts.publicUnavailable?403:200,headers:{'content-type':'text/html'}})}
  assert.equal(u.href,'https://blog.example.com/index.php/action/xmlrpc');assert.equal(o.redirect,'manual');
  const method=o.body.match(/<methodName>(.*?)<\/methodName>/)[1];
  const values=[...o.body.matchAll(/<param>([\s\S]*?)<\/param>/g)].map(x=>parseRpc('<methodResponse><params><param>'+x[1]+'</param></params></methodResponse>'));
  calls.push({method,values});if(opts.handler){const r=await opts.handler({method,values,posts,calls});if(r)return r;}
  if(method==='blogger.getUsersBlogs')return reply([{blogid:1,url:'https://blog.example.com/',xmlrpc:'https://blog.example.com/index.php/action/xmlrpc',blogName:'测试博客'}]);
  if(method==='blogger.getUserInfo')return reply({userid:7,nickname:'本人'});
  if(method==='metaWeblog.newPost'){assert.equal(values.at(-1),false);const post={...values[3],userid:7,post_status:'draft',permaLink:'https://blog.example.com/archives/'+(100+posts.size),postid:String(100+posts.size)};posts.set(post.postid,post);if(opts.lost)throw Error('lost');return reply(post.postid)}
  if(method==='metaWeblog.editPost'){assert.equal(values[4],true);const old=posts.get(String(values[0]));posts.set(String(values[0]),{...old,...values[3],public:true,post_status:'publish'});if(opts.publishLost)throw Error('lost');return reply(Number(values[0]))}
  if(method==='metaWeblog.getRecentPosts')return reply([...posts.values()]);
  if(method==='metaWeblog.getPost')return reply(posts.get(String(values[0])));
  throw Error('Unexpected method '+method);
 };
 try{return await fn({calls,posts})}finally{globalThis.fetch=original}
}
const connect=e=>call(e,'/api/typecho/connection','POST',config);
async function create(e,id=crypto.randomUUID()){
 const p=await call(e,'/api/typecho/preview?'+new URLSearchParams({...args,contentId:'c1'}));
 return call(e,'/api/typecho/draft','POST',{...args,id,contentId:'c1',previewHash:p.data.previewHash});
}
const run=(e,action,id)=>call(e,'/api/typecho/'+action,'POST',{...args,id});

test('XML-RPC handles escaped unicode, booleans, dates and arrays; rejects DTD, duplicates and malformed values',()=>{
 const sample={title:'中文 <&> "',list:['a',false,7],date:new Date('2026-10-22T01:02:03Z')};
 const parsed=parseRpc('<methodResponse><params><param>'+rpcValue(sample)+'</param></params></methodResponse>');assert.equal(parsed.title,sample.title);assert.deepEqual(parsed.list,sample.list);assert.equal(parsed.date,'20261022T01:02:03');
 for(const xml of ['<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><methodResponse/>','<methodResponse><params><param><value><boolean>yes</boolean></value></param></params></methodResponse>','<methodResponse><params><param><value><string>x</string><string>y</string></value></param></params></methodResponse>','<methodResponse>'+ '<x>'.repeat(50)])assert.throws(()=>parseRpc(xml));
 assert.throws(()=>rpcRequest('metaWeblog.deletePost',[]));
 const fault='<methodResponse><fault>'+rpcValue({faultCode:401,faultString:config.password})+'</fault></methodResponse>';assert.throws(()=>parseRpc(fault),e=>e.message.includes('401')&&!e.message.includes(config.password));
});
test('connecting verifies ownership immediately; encrypts password and never exposes it or publishes',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{const c=await connect(e);assert.equal(c.status,200,JSON.stringify(c));assert.ok(c.data.connection.verifiedAt);assert.equal(calls.length,2);assert.equal(calls[0].method,'blogger.getUsersBlogs');assert.ok(!e.db.prepare('SELECT secret FROM connections').get().secret.includes(config.password));assert.equal((await call(e,'/api/state')).data.connections.length,0);const center=(await call(e,'/api/publishing-center?brandId=b1')).data;assert.equal(center.accounts[0].capabilities.createDraft,true);assert.equal(center.accounts[0].capabilities.publish,true);assert.ok(!JSON.stringify(center).includes(config.password));});e.db.close();
});
test('wrong blog identity and redirects cannot save credentials or leak them to another host',async()=>{
 for(const response of [()=>reply([{blogid:'7',url:'https://www.typecho.com/someone-else/'}]),()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}})]){
 const e=environment();await seed(e);await fixture(async({calls})=>{assert.notEqual((await connect(e)).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM connections').get().n,0);assert.equal(calls.length,1)},{handler:response});e.db.close();}
});
test('unsafe blog path, missing token, unauthorized brand and empty username fail before network',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{for(const change of [{site:'http://blog.example.com/'},{site:'https://blog.example.com/#fragment'},{endpoint:'https://blog.example.com/action/xmlrpc#fragment'},{endpoint:'https://evil.example/action/xmlrpc'},{password:''},{username:''},{brandId:'other'}])assert.notEqual((await call(e,'/api/typecho/connection','POST',{...config,...change})).status,200);assert.equal(calls.length,0)});e.db.close();
});
test('draft verifies complete remote content and creates only once even with a new request id',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=await create(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal(r.data.record.remote.postId,'100');const same=await create(e);assert.equal(same.data.existing,true);assert.equal(same.data.record.id,r.data.record.id);assert.equal(posts.size,1);assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1);assert.equal((await call(e,'/api/state')).data.state.publications.length,0);assert.equal(calls.filter(x=>x.method==='metaWeblog.editPost').length,0);});e.db.close();
});
test('lost creation response can only recover unique exact original, never repeats write',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);assert.equal((await create(e)).data.record.state,'uncertain');const r=await run(e,'reconcile',id);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1)},{lost:true});e.db.close();
});
test('known post id persists before a failed read and reconciliation does not create another draft',async()=>{
 const e=environment();await seed(e);let fail=true;await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);const r=(await call(e,'/api/typecho/detail?'+new URLSearchParams({...args,id}))).data.record;assert.equal(r.remote.postId,'100');assert.equal(r.state,'uncertain');fail=false;assert.equal((await run(e,'reconcile',id)).data.record.state,'draft');assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1)},{handler:({method})=>method==='metaWeblog.getPost'&&fail?new Response('down',{status:503}):null});e.db.close();
});
test('ambiguous or modified remote drafts never become saved receipts',async()=>{
 const e=environment();await seed(e);await fixture(async({posts})=>{await connect(e);const id=crypto.randomUUID();await create(e,id);posts.set('101',{...posts.get('100'),postid:'101'});assert.equal((await run(e,'reconcile',id)).status,409);posts.delete('101');posts.get('100').description+='changed';assert.equal((await run(e,'reconcile',id)).status,409)},{lost:true});e.db.close();
});
test('stale preview and changed facts do not start a write; foreign owners cannot read receipts',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const p=(await call(e,'/api/typecho/preview?'+new URLSearchParams({...args,contentId:'c1'}))).data;const w=(await call(e,'/api/state')).data;w.state.contents[0].text+='修改';await call(e,'/api/state','PUT',w);assert.equal((await call(e,'/api/typecho/draft','POST',{...args,id:crypto.randomUUID(),contentId:'c1',previewHash:p.previewHash})).status,409);assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,0);const r=(await create(e)).data.record;assert.equal((await call(e,'/api/typecho/detail?'+new URLSearchParams({...args,id:r.id}),'GET',null,'other')).status,404)});e.db.close();
});
test('backup restore pauses blog credentials; deleting brand removes only its connections',async()=>{
 const e=environment();await seed(e);await fixture(async()=>{await connect(e);await call(e,'/api/typecho/connection','POST',{...config,brandId:'b2'});const backup=(await call(e,'/api/manage/backups','POST',{label:'blog'})).data,w=(await call(e,'/api/state')).data;assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision})).status,200);assert.equal((await create(e)).status,400);assert.equal((await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'品牌甲'})).status,200);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'typecho:b1:%'").get().n,0);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'typecho:b2:%'").get().n,1)});e.db.close();
});

test('public publish promotes exactly the existing draft; anonymous whole-body evidence is required and repeat is read only',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=(await create(e)).data.record;const p=await run(e,'publish',r.id);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.record.state,'published');assert.equal(p.data.record.remote.publicVerified,true);assert.equal(p.data.record.remote.postId,r.remote.postId);assert.equal((await run(e,'publish',r.id)).data.existing,true);assert.equal(posts.size,1);assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1)});e.db.close();
});
test('accepted but inaccessible public page is submitted, not published; reconcile never resends',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const r=(await create(e)).data.record;assert.equal((await run(e,'publish',r.id)).data.record.state,'submitted');assert.equal((await run(e,'publish',r.id)).data.existing,true);assert.equal((await run(e,'reconcile',r.id)).data.record.state,'submitted');assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1)},{publicUnavailable:true});e.db.close();
});
test('lost public response never writes twice; only a matching public page resolves uncertainty',async()=>{
 for(const inaccessible of [true,false]){const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const r=(await create(e)).data.record;assert.equal((await run(e,'publish',r.id)).status,502);assert.equal((await run(e,'publish',r.id)).data.record.state,'uncertain');assert.equal((await run(e,'reconcile',r.id)).data.record.state,inaccessible?'uncertain':'published');assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1)},{publishLost:true,publicUnavailable:inaccessible});e.db.close();}
});
test('edited remote or revised local article prevents public write before touching original',async()=>{
 for(const remoteChange of [true,false]){const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=(await create(e)).data.record;if(remoteChange)posts.get('100').description+='external';else{const w=(await call(e,'/api/state')).data;w.state.contents[0].text+='modified';await call(e,'/api/state','PUT',w)}assert.equal((await run(e,'publish',r.id)).status,409);assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,0)});e.db.close();}
});
test('public evidence rejects a search snippet, title-only page, login page and altered content',()=>{
 const r={snapshot:{title:'中文 & 回执'},html:'<p>完整正文</p><p>AI 声明</p>'};
 const valid='<a class="post-title">中文 &amp; 回执</a><div class="post-content">'+r.html+'</div>';
 assert.equal(typechoPublicMatches(valid,r),true);
 for(const page of ['<h1>中文 &amp; 回执</h1>'+r.html,valid.replace('完整正文','部分正文'),valid.replace('<p>AI 声明</p>',''),'<title>登录</title>'])assert.equal(typechoPublicMatches(page,r),false);
});

test('pre-write DNS failure is safely retryable on the original ID while concurrent retries write once',async()=>{
 const e=environment();await seed(e);const opts={};await fixture(async({calls})=>{
 await connect(e);const id=crypto.randomUUID();opts.dnsDown=true;assert.equal((await create(e,id)).status,502);
 const detail=()=>call(e,'/api/typecho/detail?'+new URLSearchParams({...args,id}));assert.equal((await detail()).data.record.state,'not_queued');assert.equal((await run(e,'reconcile',id)).data.record.state,'not_queued');opts.dnsDown=false;
 const replies=await Promise.all([create(e,id),create(e,id)]);assert.ok(replies.some(r=>r.status===200));assert.equal(calls.filter(c=>c.method==='metaWeblog.newPost').length,1);assert.equal((await detail()).data.record.state,'draft');
 },opts);e.db.close();
});

test('accepted publication remains submitted when later DNS lookup fails, and recovery requires current RPC plus public evidence',async()=>{
 const e=environment();await seed(e);const opts={publicUnavailable:true};await fixture(async({calls})=>{
 await connect(e);const r=(await create(e)).data.record;assert.equal((await run(e,'publish',r.id)).data.record.state,'submitted');
 opts.dnsDown=true;assert.equal((await run(e,'reconcile',r.id)).status,502);
 const d=await call(e,'/api/typecho/detail?'+new URLSearchParams({...args,id:r.id}));assert.equal(d.data.record.state,'submitted');
 opts.dnsDown=false;opts.publicUnavailable=false;opts.handler=null;
 assert.equal((await run(e,'reconcile',r.id)).data.record.state,'published');assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1);
 },opts);e.db.close();
});

test('legacy accepted receipt remains submitted; ambiguous attempts remain uncertain',()=>{
 assert.equal(typechoRunState({publishAcceptedAt:'2026-10-22T08:37:20Z'},'uncertain'),'submitted');
 assert.equal(typechoRunState({publishAttemptedAt:'2026-10-22T08:37:20Z'},'uncertain'),'uncertain');
});

test('Typecho draft ownership and explicit status are required, and integer edit IDs must match',async()=>{
 for(const change of [{userid:8},{post_status:'publish'},{post_status:'pending'}]){const e=environment();await seed(e);await fixture(async()=>{await connect(e);assert.equal((await create(e)).status,409)},{handler:({method,posts})=>method==='metaWeblog.getRecentPosts'?reply([...posts.values()].map(p=>({...p,...change}))):null});e.db.close()}
 const e=environment();await seed(e);await fixture(async()=>{await connect(e);const r=(await create(e)).data.record;assert.equal((await run(e,'publish',r.id)).status,502)},{handler:({method})=>method==='metaWeblog.editPost'?reply(true):null});e.db.close();
});

test('Typecho site/endpoint change cannot reuse old credentials and model settings exclude publishing credentials',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{const c=(await connect(e)).data.connection;const before=calls.length;const result=await call(e,'/api/typecho/connection','POST',{...config,password:'',site:'https://another.example.com/',revision:c.revision});assert.equal(result.status,400);assert.equal(calls.length,before);const state=(await call(e,'/api/state')).data;assert.equal(state.connections.some(c=>c.provider.startsWith('typecho:')),false)});e.db.close();
});


test('private DNS and unsafe integer identities never persist or forward credentials',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{assert.notEqual((await connect(e)).status,200);assert.equal(calls.length,0);assert.equal(e.db.prepare('SELECT count(*) n FROM connections').get().n,0)},{privateDNS:true});
 await fixture(async()=>{assert.notEqual((await connect(e)).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM connections').get().n,0)},{handler:({method})=>method==='blogger.getUserInfo'?reply({userid:'9007199254740993'}):null});e.db.close();
});


test('Typecho storage publish status on a draft requires an exact explicit draft-list receipt',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const r=await create(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal((await run(e,'publish',r.data.record.id)).data.record.state,'published');assert.equal(calls.filter(c=>c.method==='metaWeblog.newPost').length,1)},{handler:({method,posts,values})=>method==='metaWeblog.getPost'?reply({...posts.get(String(values[0])),post_status:'publish'}):null});e.db.close();
});
