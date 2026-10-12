import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vQAAAABJRU5ErkJggg==','base64');
const config={brandId:'b1',site:'https://wp.customer.cn/blog/',username:'publisher',password:'fixture-application-password',enabled:true};
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),db,GEO_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',...headers},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands=[{id:'b1',name:'品牌甲'},{id:'b2',name:'品牌乙'}];w.state.contents=[{id:'c1',brandId:'b1',title:'产品资料介绍',text:'## 功能\n\n可以导出资料。',status:'已审核',productId:''}];assert.equal((await call(e,'/api/state','PUT',w)).status,200)}
async function connect(e){assert.equal((await call(e,'/api/wordpress/connection','POST',config)).status,200);const r=await call(e,'/api/wordpress/verify','POST',{brandId:'b1'});assert.equal(r.status,200);return r.data.connection;}
function form(id=crypto.randomUUID(),changes={}){const f=new FormData();for(const [k,v] of Object.entries({id,brandId:'b1',title:'产品界面',alt:'项目页面与产品资料',caption:'实际界面截图',...changes}))f.set(k,v);if(!f.has('file'))f.set('file',new Blob([png],{type:'image/png'}),'产品封面.png');return f;}
const upload=(e,id,changes,user,headers)=>call(e,'/api/wordpress/media/upload','POST',form(id,changes),user,headers);
const reconcile=(e,id,brandId='b1')=>call(e,'/api/wordpress/media/reconcile','POST',{id,brandId});
async function draft(e,mediaRunId,id=crypto.randomUUID()) {const p=(await call(e,'/api/wordpress/preview?brandId=b1&contentId=c1')).data;return call(e,'/api/wordpress/draft','POST',{id,brandId:'b1',contentId:'c1',previewHash:p.previewHash,mediaRunId});}
async function fixture(fn,options={}){
 const previous=globalThis.fetch,media=new Map(),posts=new Map(),calls=[];
 globalThis.fetch=async(value,o={})=>{
  const u=new URL(value);if(u.hostname.includes('dns'))return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='AAAA'?28:1,data:u.searchParams.get('type')==='AAAA'?'2606:4700:4700::1111':'1.1.1.1'}]});
  const body=o.body instanceof FormData?o.body:o.body?JSON.parse(o.body):null;calls.push({url:u.href,method:o.method||'GET',body,headers:o.headers,redirect:o.redirect});
  if(options.handler){const response=await options.handler(u,o,{media,posts,calls});if(response)return response}
  if(u.pathname.endsWith('/users/me'))return Response.json({id:7,capabilities:{edit_posts:true,publish_posts:true,upload_files:true,...options.capabilities}});
  if(u.pathname.endsWith('/media')){
   if(o.method==='POST'){assert.ok(body instanceof FormData);const file=body.get('file'),id=media.size+1,item={id,slug:body.get('slug'),title:{raw:body.get('title')},description:{raw:body.get('description')},alt_text:body.get('alt_text'),caption:{raw:body.get('caption')},status:'inherit',media_type:'image',mime_type:file.type,media_details:{width:1,height:1},link:config.site+'?attachment_id='+id,source_url:config.site+'wp-content/uploads/'+file.name};media.set(id,item);if(options.lostUpload)throw new Error('lost upload response');return Response.json(item)}
   return Response.json([...media.values()].filter(m=>m.slug===u.searchParams.get('slug')));
  }
  if(/\/media\/\d+$/.test(u.pathname)){const item=media.get(Number(u.pathname.split('/').at(-1)));return item?Response.json(item):new Response('not found',{status:404})}
  if(u.pathname.endsWith('/posts')){if(o.method==='POST'){const id=posts.size+1,p={id,title:{raw:body.title},content:{raw:body.content},status:body.status,slug:body.slug,featured_media:body.featured_media||0,link:config.site+'article-'+id};posts.set(id,p);return Response.json(p)}return Response.json([...posts.values()].filter(p=>p.slug===u.searchParams.get('slug')))}
  const post=posts.get(Number(u.pathname.split('/').at(-1)));if(post){if(o.method==='POST')Object.assign(post,body);return Response.json(post)}return new Response('not found',{status:404});
 };
 try{return await fn({media,posts,calls})}finally{globalThis.fetch=previous}
}
test('a real PNG uploads once with metadata and its verified image ID follows draft and publication',async()=>{
 const e=env();await seed(e);await fixture(async({media,posts,calls})=>{const c=await connect(e);assert.equal(c.canUpload,true);const id=crypto.randomUUID(),r=await upload(e,id);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.media.state,'uploaded');assert.equal(r.data.media.file.size,png.length);assert.equal(r.data.media.file.width,1);assert.equal(r.data.media.file.sha256.length,64);assert.equal(r.data.media.file.name,'产品封面.png');assert.ok(!JSON.stringify(r).includes(config.password));assert.equal((await upload(e,id)).data.existing,true);const sent=calls.find(c=>c.body instanceof FormData);assert.equal(sent.headers['content-type'],undefined);assert.equal(sent.redirect,'manual');assert.deepEqual(Buffer.from(await sent.body.get('file').arrayBuffer()),png);assert.equal(media.size,1);assert.equal((await call(e,'/api/wordpress/media?brandId=b1')).data.records.length,1);
  const d=await draft(e,id);assert.equal(d.status,200,JSON.stringify(d));assert.equal(d.data.record.featuredMediaId,1);assert.equal(d.data.record.media.alt,'项目页面与产品资料');assert.equal(posts.get(1).featured_media,1);const p=await call(e,'/api/wordpress/publish','POST',{id:d.data.record.id,brandId:'b1'});assert.equal(p.data.record.state,'published');assert.equal(posts.get(1).featured_media,1);assert.equal(calls.filter(c=>c.method==='POST'&&new URL(c.url).pathname.endsWith('/media')).length,1);
 });
});
test('invalid file signatures, type mismatch, huge dimensions and duplicate form fields never reach WordPress',async()=>{
 const e=env();await seed(e);await fixture(async({calls})=>{await connect(e);
  for(const [bytes,type,name] of [[Buffer.from('<svg onload="alert(1)"/>'),'image/png','fake.png'],[png,'image/jpeg','wrong.png'],[png,'image/png','fake.svg']]){const f=form();f.set('file',new Blob([bytes],{type}),name);assert.equal((await call(e,'/api/wordpress/media/upload','POST',f)).status,400)}
  const huge=Buffer.from(png);huge.writeUInt32BE(10001,16);const f=form();f.set('file',new Blob([huge],{type:'image/png'}),'huge.png');assert.equal((await call(e,'/api/wordpress/media/upload','POST',f)).status,400);
  const duplicate=form();duplicate.append('brandId','b2');assert.equal((await call(e,'/api/wordpress/media/upload','POST',duplicate)).status,400);
  assert.equal((await upload(e,undefined,{alt:''})).status,400);const large=form();large.set('file',new Blob([new Uint8Array(8*1024*1024+1)],{type:'image/png'}),'large.png');assert.equal((await call(e,'/api/wordpress/media/upload','POST',large)).status,413);
  assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(e.db.prepare("SELECT count(*) n FROM runs WHERE kind='wordpress_media'").get().n,0);
 });
});
test('lost upload response recovers the unique marked media without another upload; changed input cannot reuse its ID',async()=>{
 const e=env();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();assert.equal((await upload(e,id)).status,502);assert.equal((await upload(e,id)).data.media.state,'uncertain');assert.equal((await upload(e,id,{alt:'不同说明'})).status,409);const r=await reconcile(e,id);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.media.state,'uploaded');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal((await draft(e,id)).status,200);},{lostUpload:true});
});
test('ambiguous or absent media remains unresolved; mismatched metadata is never selected as a cover',async()=>{
 const e=env();await seed(e);await fixture(async({media,calls})=>{await connect(e);const id=crypto.randomUUID();await upload(e,id);const original=media.get(1);media.clear();assert.equal((await reconcile(e,id)).status,409);media.set(1,original);media.set(2,{...original,id:2});assert.equal((await reconcile(e,id)).status,409);media.delete(2);original.alt_text='已改变';assert.equal((await reconcile(e,id)).data.media.state,'changed');assert.equal((await draft(e,id)).status,409);assert.equal(calls.filter(c=>c.method==='POST').length,1);},{lostUpload:true});
});
test('remote featured-image changes or media edits block publication without overwriting the website',async()=>{
 const e=env();await seed(e);await fixture(async({media,posts,calls})=>{await connect(e);const m=(await upload(e)).data.media,d=(await draft(e,m.id)).data.record;posts.get(1).featured_media=50;let r=await call(e,'/api/wordpress/publish','POST',{id:d.id,brandId:'b1'});assert.equal(r.data.record.state,'changed');assert.equal(posts.get(1).status,'draft');posts.get(1).featured_media=1;await call(e,'/api/wordpress/reconcile','POST',{id:d.id,brandId:'b1'});media.get(1).alt_text='后来修改的说明';r=await call(e,'/api/wordpress/publish','POST',{id:d.id,brandId:'b1'});assert.equal(r.status,409);assert.equal(calls.filter(c=>c.method==='POST').length,2);assert.equal(posts.get(1).status,'draft');});
});
test('roles, brand scope and WordPress upload capability are enforced server-side',async()=>{
 const e=env();await seed(e);await fixture(async({calls})=>{await connect(e);const m=(await upload(e)).data.media;
  for(const role of ['viewer','reviewer','editor']){await call(e,'/api/manage/members','POST',{email:role+'@example.com',role,brands:['b2']});const h={'x-geo-workspace':'owner','oai-authenticated-user-email':role+'@example.com'};assert.equal((await call(e,'/api/wordpress/media/detail?brandId=b1&id='+m.id,'GET',null,role,h)).status,404);assert.equal((await upload(e,undefined,{},role,h)).status,role==='editor'?404:403)}
  await call(e,'/api/manage/members','POST',{email:'viewer@example.com',role:'viewer',brands:['b1']});const h={'x-geo-workspace':'owner','oai-authenticated-user-email':'viewer@example.com'};assert.equal((await upload(e,undefined,{},'viewer',h)).status,403);assert.equal((await call(e,'/api/wordpress/media/detail?brandId=b2&id='+m.id)).status,404);assert.equal((await call(e,'/api/wordpress/media?brandId=b2')).data.records.length,0);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 });
 const limited=env();await seed(limited);await fixture(async({calls})=>{await connect(limited);assert.equal((await upload(limited)).status,403);assert.equal(calls.filter(c=>c.method==='POST').length,0);},{capabilities:{upload_files:false}});
});
test('website switch and restore preserve receipts but cannot reuse an image from another site or unverified connection',async()=>{
 const e=env();await seed(e);await fixture(async()=>{const c=await connect(e),m=(await upload(e)).data.media;const backup=(await call(e,'/api/manage/backups','POST',{label:'图片已上传'})).data;let w=(await call(e,'/api/state')).data;assert.equal((await call(e,'/api/manage/backups/restore','POST',{id:backup.id,revision:w.revision})).status,200);assert.equal((await call(e,'/api/wordpress/media/detail?brandId=b1&id='+m.id)).data.media.state,'uploaded');assert.equal((await upload(e)).status,400);const current=(await call(e,'/api/wordpress?brandId=b1')).data.connection;assert.equal((await call(e,'/api/wordpress/connection','POST',{...config,site:'https://new.customer.cn/',revision:current.revision})).status,200);await call(e,'/api/wordpress/verify','POST',{brandId:'b1'});assert.equal((await draft(e,m.id)).status,409);assert.equal((await reconcile(e,m.id)).status,409);});
});
test('a lost database receipt retains the upload marker and reconciles after the in-flight window',async()=>{
 const e=env();await seed(e);await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID();e.db.exec("CREATE TRIGGER fail_media_receipt BEFORE UPDATE ON runs WHEN OLD.kind='wordpress_media' BEGIN SELECT RAISE(ABORT,'fixture'); END;");assert.equal((await upload(e,id)).status,503);e.db.exec('DROP TRIGGER fail_media_receipt');assert.equal((await reconcile(e,id)).status,409);e.db.prepare("UPDATE runs SET created='2026-01-01T00:00:00.000Z' WHERE id=?").run(id);assert.equal((await reconcile(e,id)).data.media.state,'uploaded');assert.equal(calls.filter(c=>c.method==='POST').length,1);});
});
test('concurrent upload and draft requests cannot race the same workspace; media redirects receive no forwarded credential',async()=>{
 const e=env();await seed(e);let blocked=false;await fixture(async({calls})=>{await connect(e);const id=crypto.randomUUID(),results=await Promise.all([upload(e,id),upload(e,id)]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(blocked,true);},{handler:async(u,o)=>{if(o.body instanceof FormData){blocked=(await draft(e,'')).status===409}return null}});
 const other=env();await seed(other);await fixture(async({calls})=>{await connect(other);const id=crypto.randomUUID();assert.equal((await upload(other,id)).status,502);assert.equal((await upload(other,id)).data.media.state,'uncertain');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.ok(calls.every(c=>!c.url.startsWith('https://elsewhere')));},{handler:async(u,o)=>o.body instanceof FormData?new Response(null,{status:302,headers:{location:'https://elsewhere.customer.cn/'}}):null});
});
test('frontend keeps only a scoped recovery ID after a lost upload and supplies a browser-generated multipart boundary',async()=>{
 const store=new Map(),g={accessInfo:{current:{owner:'owner'}},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},brand:()=>({id:'b1'}),document:{addEventListener(){}},runtimeFlush:async()=>{},apiRequest:async()=>{throw new Error('response lost')}};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/wordpress.js',import.meta.url),'utf8'),g);const f=form();await assert.rejects(g.wordpressMediaUpload(f),/response lost/);assert.deepEqual(JSON.parse(JSON.stringify(g.wordpressMediaPending())),{id:f.get('id'),brandId:'b1'});assert.ok([...store.values()].every(v=>!v.includes('base64')));g.accessInfo.current.owner='other';await assert.rejects(g.wordpressMediaUpload(f,'owner||b1'),/已切换/);
 let options;const runtime={FormData,sessionStorage:{getItem:()=>''},fetch:async(p,o)=>{options=o;return Response.json({ok:true})}};vm.createContext(runtime);vm.runInContext(fs.readFileSync(new URL('../public/runtime.js',import.meta.url),'utf8').split('\n').find(s=>s.startsWith('async function apiRequest')),runtime);await runtime.apiRequest('/upload',{method:'POST',body:f});assert.equal(options.headers['content-type'],undefined);assert.equal(options.headers['x-geo-request'],'1');await runtime.apiRequest('/json',{method:'POST',body:'{}'});assert.equal(options.headers['content-type'],'application/json');
});
test('cover selectors exclude other sites and unverified receipts, and escape uploaded titles',()=>{
 const g={document:{addEventListener(){}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/wordpress.js',import.meta.url),'utf8'),g);vm.runInContext(`wordpressData={connection:{site:'https://wp.customer.cn/'},media:[{id:'a',site:'https://wp.customer.cn/',state:'uploaded',title:'<img onerror=evil>',remote:{mediaId:7}},{id:'b',site:'https://other.customer.cn/',state:'uploaded',title:'wrong site',remote:{mediaId:8}},{id:'c',site:'https://wp.customer.cn/',state:'uncertain',title:'uncertain',remote:{mediaId:9}}]}`,g);const html=g.wordpressMediaOptions();assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('wrong site'));assert.ok(!html.includes('uncertain'));assert.ok(html.includes('暂不设置封面'));
});
test('WordPress alt-text whitespace normalization does not strand a successful upload or duplicate retries',async()=>{
 const e=env();await seed(e);await fixture(async({media,calls})=>{await connect(e);const id=crypto.randomUUID(),r=await upload(e,id,{alt:'  项目   页面与  产品资料  '});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.media.alt,'项目 页面与 产品资料');assert.equal(media.get(1).alt_text,'项目 页面与 产品资料');assert.equal((await upload(e,id,{alt:'项目 页面与 产品资料'})).data.existing,true);assert.equal((await draft(e,id)).status,200);assert.equal(calls.filter(c=>c.body instanceof FormData).length,1);});
});
test('alt text that WordPress strips or reinterprets is rejected before creating remote media',async()=>{
 const e=env();await seed(e);await fixture(async({calls})=>{await connect(e);for(const alt of ['产品 <b>页面</b>','产品%20页面','无效\ud800字符'])assert.equal((await upload(e,undefined,{alt})).status,400);assert.equal(calls.filter(c=>c.body instanceof FormData).length,0);assert.equal(e.db.prepare("SELECT count(*) n FROM runs WHERE kind='wordpress_media'").get().n,0);});
});
test('legacy whitespace-only mismatch reconciles without accepting real remote edits',async()=>{
 const e=env();await seed(e);await fixture(async({media,calls})=>{await connect(e);const id=crypto.randomUUID();await upload(e,id,{alt:'项目 页面与 产品资料'});const row=e.db.prepare('SELECT result FROM runs WHERE id=?').get(id),r=JSON.parse(row.result);r.alt='项目   页面与  产品资料';e.db.prepare("UPDATE runs SET result=?,state='uncertain' WHERE id=?").run(JSON.stringify(r),id);assert.equal((await reconcile(e,id)).data.media.state,'uploaded');assert.equal((await draft(e,id)).status,200);media.get(1).alt_text='不同的项目页面';assert.equal((await reconcile(e,id)).data.media.state,'changed');assert.equal((await draft(e,id)).status,409);assert.equal(calls.filter(c=>c.body instanceof FormData).length,1);});
});
