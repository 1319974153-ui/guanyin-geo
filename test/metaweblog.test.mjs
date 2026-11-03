import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

import {rpcValue,rpcRequest,parseRpc} from '../src/metaweblog-rpc.js';

function environment(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}}
async function call(e,path,method='GET',body,user='owner'){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
const accountId='mw-11111111-1111-4111-8111-111111111111';
const config={brandId:'b1',accountId,site:'https://blog.example.com/',endpoint:'https://blog.example.com/xmlrpc.php',username:'owner-name',password:'test-private-password'};
const args={brandId:'b1',accountId};
const reply=value=>new Response('<?xml version="1.0"?><methodResponse><params><param>'+rpcValue(value)+'</param></params></methodResponse>',{headers:{'content-type':'text/xml'}});
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'品牌甲'},{id:'b2',name:'品牌乙'}];w.state.contents=[{id:'c1',brandId:'b1',title:'草稿验收',text:'## 非公开草稿\n\n仅用于软件验收。',status:'已审核',ai:true}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
async function fixture(fn,opts={}){
 const original=globalThis.fetch,posts=new Map(),calls=[];
 globalThis.fetch=async(url,o={})=>{
  const u=new URL(url);if(u.hostname.includes('dns')&&opts.dnsDown)throw Error('dns offline');if(u.hostname.includes('dns')&&opts.privateDNS)return Response.json({Status:0,Answer:[{type:1,data:'10.0.0.1'}]});if(u.hostname.includes('dns'))return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='AAAA'?28:1,data:u.searchParams.get('type')==='AAAA'?'2606:4700:4700::1111':'1.1.1.1'}]});
  if(u.hostname==='blog.example.com'&&!u.pathname.endsWith('/xmlrpc.php')){assert.equal(o.headers.cookie,undefined);const post=[...posts.values()].find(p=>u.pathname==='/archives/'+p.postid);return new Response(opts.publicHtml??(post?.public?'<a class="post-title">'+post.title+'</a><div class="post-content">'+post.description+'</div>':'not public'),{status:opts.publicUnavailable?403:200,headers:{'content-type':'text/html'}})}
  assert.equal(u.href,'https://blog.example.com/xmlrpc.php');assert.equal(o.redirect,'manual');
  const method=o.body.match(/<methodName>(.*?)<\/methodName>/)[1];
  const values=[...o.body.matchAll(/<param>([\s\S]*?)<\/param>/g)].map(x=>parseRpc('<methodResponse><params><param>'+x[1]+'</param></params></methodResponse>'));
  calls.push({method,values});if(opts.handler){const r=await opts.handler({method,values,posts,calls});if(r)return r;}
  if(method==='blogger.getUsersBlogs')return reply([{blogid:9,url:'https://blog.example.com/',xmlrpc:'https://blog.example.com/xmlrpc.php',blogName:'测试博客'}]);
  if(method==='blogger.getUserInfo')return reply({userid:7,nickname:'本人'});
  if(method==='metaWeblog.newPost'){assert.equal(values.at(-1),false);const post={...values[3],userid:7,post_status:'draft',permaLink:'https://blog.example.com/archives/'+(100+posts.size),postid:String(100+posts.size)};posts.set(post.postid,post);if(opts.lost)throw Error('lost');return reply(post.postid)}
  if(method==='metaWeblog.editPost'){assert.equal(values[4],true);const old=posts.get(String(values[0]));posts.set(String(values[0]),{...old,...values[3],public:true,post_status:'publish'});if(opts.publishLost)throw Error('lost');return reply(true)}
  if(method==='metaWeblog.getRecentPosts')return reply([...posts.values()]);
  if(method==='metaWeblog.getPost')return reply(posts.get(String(values[0])));
  throw Error('Unexpected method '+method);
 };
 try{return await fn({calls,posts})}finally{globalThis.fetch=original}
}
const connect=e=>call(e,'/api/metaweblog/connection','POST',config);
async function create(e,id=crypto.randomUUID()){
 const p=await call(e,'/api/metaweblog/preview?'+new URLSearchParams({...args,contentId:'c1'}));
 return call(e,'/api/metaweblog/draft','POST',{...args,id,contentId:'c1',previewHash:p.data.previewHash});
}
const run=(e,action,id)=>call(e,'/api/metaweblog/'+action,'POST',{...args,id});


test('MetaWeblog connects exact own blog and author, exposes checkbox capabilities without leaking credentials',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{const r=await connect(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.connection.blogId,'9');assert.equal(calls.length,2);assert.ok(!e.db.prepare('SELECT secret FROM connections').get().secret.includes(config.password));const center=(await call(e,'/api/publishing-center?brandId=b1')).data;assert.equal(center.accounts[0].platform,'metaweblog');assert.equal(center.accounts[0].capabilities.createDraft,true);assert.equal(center.accounts[0].capabilities.publish,true);assert.ok(!JSON.stringify(center).includes(config.password));assert.equal((await call(e,'/api/state')).data.connections.length,0)});e.db.close();
});
test('MetaWeblog creates draft once and promotes exactly that original using boolean edit receipt',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=await create(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal((await create(e)).data.existing,true);const p=await run(e,'publish',r.data.record.id);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.record.state,'published');assert.equal(p.data.record.remote.publicVerified,true);assert.equal((await run(e,'publish',r.data.record.id)).data.existing,true);assert.equal(posts.size,1);assert.equal(calls.filter(c=>c.method==='metaWeblog.newPost').length,1);assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1);assert.equal(calls.find(c=>c.method==='metaWeblog.newPost').values[0],'9')});e.db.close();
});
test('lost draft response is reconciled read-only with complete content and unique marker',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);assert.equal((await create(e)).data.record.state,'uncertain');assert.equal((await run(e,'reconcile',id)).data.record.state,'draft');assert.equal(calls.filter(c=>c.method==='metaWeblog.newPost').length,1)},{lost:true});e.db.close();
});
test('accepted public write without anonymous whole content remains submitted; lost publish never repeats',async()=>{
 for(const lost of [false,true]){const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const r=(await create(e)).data.record;const p=await run(e,'publish',r.id);assert.equal(p.status,lost?502:200);const expected=lost?'uncertain':'submitted';assert.equal((await run(e,'publish',r.id)).data.record.state,expected);assert.equal((await run(e,'reconcile',r.id)).data.record.state,expected);assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,1)},{publicUnavailable:true,publishLost:lost});e.db.close()}
});
test('missing or non-draft status, wrong owner and truncated content never count as saved',async()=>{
 for(const change of [{post_status:''},{post_status:'publish'},{userid:8},{description:'partial'}]){const e=environment();await seed(e);await fixture(async()=>{await connect(e);assert.equal((await create(e)).status,409)},{handler:({method,posts})=>method==='metaWeblog.getPost'?reply({...posts.get('100'),...change}):null});e.db.close()}
});
test('cross-site endpoint, missing endpoint, private DNS, redirect and duplicate owned blogs are rejected',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{for(const x of [{endpoint:''},{endpoint:'https://evil.test/xmlrpc.php'},{site:'http://blog.example.com/'},{endpoint:'https://blog.example.com/xmlrpc.php#x'}])assert.notEqual((await call(e,'/api/metaweblog/connection','POST',{...config,...x})).status,200);assert.equal(calls.length,0)});
 await fixture(async({calls})=>{assert.notEqual((await connect(e)).status,200);assert.equal(calls.length,0)},{privateDNS:true});
 for(const response of [()=>new Response(null,{status:302,headers:{location:'https://evil.test/'}}),()=>reply([{blogid:9,url:config.site},{blogid:10,url:config.site}])])await fixture(async()=>{assert.notEqual((await connect(e)).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM connections').get().n,0)},{handler:response});e.db.close();
});
test('restore suspends MetaWeblog credentials and deleting one brand does not affect another',async()=>{
 const e=environment();await seed(e);await fixture(async()=>{await connect(e);await call(e,'/api/metaweblog/connection','POST',{...config,brandId:'b2'});const backup=(await call(e,'/api/manage/backups','POST',{label:'xmlrpc'})).data,w=(await call(e,'/api/state')).data;assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision})).status,200);assert.equal((await create(e)).status,400);assert.equal((await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'品牌甲'})).status,200);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'metaweblog:b1:%'").get().n,0);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'metaweblog:b2:%'").get().n,1)});e.db.close();
});
test('another owner cannot inspect original receipt and external edits cannot be overwritten',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=(await create(e)).data.record;assert.equal((await call(e,'/api/metaweblog/detail?'+new URLSearchParams({...args,id:r.id}),'GET',null,'other')).status,404);posts.get('100').description+='changed';assert.equal((await run(e,'publish',r.id)).status,409);assert.equal(calls.filter(c=>c.method==='metaWeblog.editPost').length,0)});e.db.close();
});

test('unsafe numeric article IDs stop recovery without another write',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);assert.equal((await create(e)).data.record.state,'uncertain');assert.equal(calls.filter(c=>c.method==='metaWeblog.newPost').length,1)},{handler:({method})=>method==='metaWeblog.newPost'?reply(9007199254740992):null});e.db.close();
});
