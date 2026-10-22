import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {rpcValue,rpcRequest,parseRpc} from '../src/metaweblog-rpc.js';

function environment(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}}
async function call(e,path,method='GET',body,user='owner'){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
const accountId='cb-11111111-1111-4111-8111-111111111111';
const config={brandId:'b1',accountId,blog:'test-blog',username:'owner-name',token:'test-private-token'};
const args={brandId:'b1',accountId};
const reply=value=>new Response('<?xml version="1.0"?><methodResponse><params><param>'+rpcValue(value)+'</param></params></methodResponse>',{headers:{'content-type':'text/xml'}});
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'品牌甲'},{id:'b2',name:'品牌乙'}];w.state.contents=[{id:'c1',brandId:'b1',title:'草稿验收',text:'## 非公开草稿\n\n仅用于软件验收。',status:'已审核',ai:true}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
async function fixture(fn,opts={}){
 const original=globalThis.fetch,posts=new Map(),calls=[];
 globalThis.fetch=async(url,o={})=>{
  const u=new URL(url);if(u.hostname.includes('dns'))return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='AAAA'?28:1,data:u.searchParams.get('type')==='AAAA'?'2606:4700:4700::1111':'1.1.1.1'}]});
  assert.equal(u.href,'https://rpc.cnblogs.com/metaweblog/test-blog');assert.equal(o.redirect,'manual');
  const method=o.body.match(/<methodName>(.*?)<\/methodName>/)[1];
  const values=[...o.body.matchAll(/<param>([\s\S]*?)<\/param>/g)].map(x=>parseRpc('<methodResponse><params><param>'+x[1]+'</param></params></methodResponse>'));
  calls.push({method,values});if(opts.handler){const r=await opts.handler({method,values,posts,calls});if(r)return r;}
  if(method==='blogger.getUsersBlogs')return reply([{blogid:'blog-7',url:'https://www.cnblogs.com/test-blog/',blogName:'测试博客'}]);
  if(method==='metaWeblog.newPost'){assert.equal(values.at(-1),false);const post={...values[3],postid:String(100+posts.size)};posts.set(post.postid,post);if(opts.lost)throw Error('lost');return reply(post.postid)}
  if(method==='metaWeblog.getRecentPosts')return reply([...posts.values()]);
  if(method==='metaWeblog.getPost')return reply(posts.get(values[0]));
  throw Error('Unexpected method '+method);
 };
 try{return await fn({calls,posts})}finally{globalThis.fetch=original}
}
const connect=e=>call(e,'/api/cnblogs/connection','POST',config);
async function create(e,id=crypto.randomUUID()){
 const p=await call(e,'/api/cnblogs/preview?'+new URLSearchParams({...args,contentId:'c1'}));
 return call(e,'/api/cnblogs/draft','POST',{...args,id,contentId:'c1',previewHash:p.data.previewHash});
}
const run=(e,action,id)=>call(e,'/api/cnblogs/'+action,'POST',{...args,id});

test('XML-RPC handles escaped unicode, booleans, dates and arrays; rejects DTD, duplicates and malformed values',()=>{
 const sample={title:'中文 <&> "',list:['a',false,7],date:new Date('2026-10-22T01:02:03Z')};
 const parsed=parseRpc('<methodResponse><params><param>'+rpcValue(sample)+'</param></params></methodResponse>');assert.equal(parsed.title,sample.title);assert.deepEqual(parsed.list,sample.list);assert.equal(parsed.date,'20261022T01:02:03');
 for(const xml of ['<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><methodResponse/>','<methodResponse><params><param><value><boolean>yes</boolean></value></param></params></methodResponse>','<methodResponse><params><param><value><string>x</string><string>y</string></value></param></params></methodResponse>','<methodResponse>'+ '<x>'.repeat(50)])assert.throws(()=>parseRpc(xml));
 assert.throws(()=>rpcRequest('metaWeblog.deletePost',[]));
 const fault='<methodResponse><fault>'+rpcValue({faultCode:401,faultString:config.token})+'</fault></methodResponse>';assert.throws(()=>parseRpc(fault),e=>e.message.includes('401')&&!e.message.includes(config.token));
});
test('connecting verifies ownership immediately; encrypts token and never exposes it or publishes',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{const c=await connect(e);assert.equal(c.status,200,JSON.stringify(c));assert.ok(c.data.connection.verifiedAt);assert.equal(calls.length,1);assert.equal(calls[0].method,'blogger.getUsersBlogs');assert.ok(!e.db.prepare('SELECT secret FROM connections').get().secret.includes(config.token));assert.equal((await call(e,'/api/state')).data.connections.length,0);const center=(await call(e,'/api/publishing-center?brandId=b1')).data;assert.equal(center.accounts[0].capabilities.createDraft,true);assert.equal(center.accounts[0].capabilities.publish,false);assert.ok(!JSON.stringify(center).includes(config.token));});e.db.close();
});
test('wrong blog identity and redirects cannot save credentials or leak them to another host',async()=>{
 for(const response of [()=>reply([{blogid:'7',url:'https://www.cnblogs.com/someone-else/'}]),()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}})]){
 const e=environment();await seed(e);await fixture(async({calls})=>{assert.notEqual((await connect(e)).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM connections').get().n,0);assert.equal(calls.length,1)},{handler:response});e.db.close();}
});
test('unsafe blog path, missing token, unauthorized brand and empty username fail before network',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{for(const change of [{blog:'../../evil'},{blog:'https://evil'},{token:'123'},{username:''},{brandId:'other'}])assert.notEqual((await call(e,'/api/cnblogs/connection','POST',{...config,...change})).status,200);assert.equal(calls.length,0)});e.db.close();
});
test('draft verifies complete remote content and creates only once even with a new request id',async()=>{
 const e=environment();await seed(e);await fixture(async({calls,posts})=>{await connect(e);const r=await create(e);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal(r.data.record.remote.postId,'100');const same=await create(e);assert.equal(same.data.existing,true);assert.equal(same.data.record.id,r.data.record.id);assert.equal(posts.size,1);assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1);assert.equal((await call(e,'/api/state')).data.state.publications.length,0);assert.equal((await run(e,'publish',r.data.record.id)).status,404);});e.db.close();
});
test('lost creation response can only recover unique exact original, never repeats write',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);assert.equal((await create(e)).data.record.state,'uncertain');const r=await run(e,'reconcile',id);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.record.state,'draft');assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1)},{lost:true});e.db.close();
});
test('known post id persists before a failed read and reconciliation does not create another draft',async()=>{
 const e=environment();await seed(e);let fail=true;await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await create(e,id)).status,502);const r=(await call(e,'/api/cnblogs/detail?'+new URLSearchParams({...args,id}))).data.record;assert.equal(r.remote.postId,'100');assert.equal(r.state,'uncertain');fail=false;assert.equal((await run(e,'reconcile',id)).data.record.state,'draft');assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,1)},{handler:({method})=>method==='metaWeblog.getPost'&&fail?new Response('down',{status:503}):null});e.db.close();
});
test('ambiguous or modified remote drafts never become saved receipts',async()=>{
 const e=environment();await seed(e);await fixture(async({posts})=>{await connect(e);const id=crypto.randomUUID();await create(e,id);posts.set('101',{...posts.get('100'),postid:'101'});assert.equal((await run(e,'reconcile',id)).status,409);posts.delete('101');posts.get('100').description+='changed';assert.equal((await run(e,'reconcile',id)).status,409)},{lost:true});e.db.close();
});
test('stale preview and changed facts do not start a write; foreign owners cannot read receipts',async()=>{
 const e=environment();await seed(e);await fixture(async({calls})=>{await connect(e);const p=(await call(e,'/api/cnblogs/preview?'+new URLSearchParams({...args,contentId:'c1'}))).data;const w=(await call(e,'/api/state')).data;w.state.contents[0].text+='修改';await call(e,'/api/state','PUT',w);assert.equal((await call(e,'/api/cnblogs/draft','POST',{...args,id:crypto.randomUUID(),contentId:'c1',previewHash:p.previewHash})).status,409);assert.equal(calls.filter(x=>x.method==='metaWeblog.newPost').length,0);const r=(await create(e)).data.record;assert.equal((await call(e,'/api/cnblogs/detail?'+new URLSearchParams({...args,id:r.id}),'GET',null,'other')).status,404)});e.db.close();
});
test('backup restore pauses blog credentials; deleting brand removes only its connections',async()=>{
 const e=environment();await seed(e);await fixture(async()=>{await connect(e);await call(e,'/api/cnblogs/connection','POST',{...config,brandId:'b2'});const backup=(await call(e,'/api/manage/backups','POST',{label:'blog'})).data,w=(await call(e,'/api/state')).data;assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision})).status,200);assert.equal((await create(e)).status,400);assert.equal((await call(e,'/api/manage/brands/delete','POST',{brandId:'b1',confirmName:'品牌甲'})).status,200);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'cnblogs:b1:%'").get().n,0);assert.equal(e.db.prepare("SELECT count(*) n FROM connections WHERE provider LIKE 'cnblogs:b2:%'").get().n,1)});e.db.close();
});
