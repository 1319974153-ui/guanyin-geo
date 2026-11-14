import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {articleMediaStore,ARTICLE_MEDIA_LIMITS} from '../local/article-media.mjs';

const origin='http://127.0.0.1:18941',sha=b=>createHash('sha256').update(b).digest('hex');
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function chunk(type,body){const bytes=Buffer.alloc(12+body.length);bytes.writeUInt32BE(body.length);bytes.write(type,4);body.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,8+body.length)),8+body.length);return bytes;}
function png({width=2,height=3,color=21,payload}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const row=Buffer.alloc((width*3+1)*height,color);for(let y=0;y<height;y++)row[y*(width*3+1)]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(payload?[chunk('tEXt',payload)]:[]),chunk('IDAT',deflateSync(row)),chunk('IEND',Buffer.alloc(0))]);}
const jpeg=Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIQARHP/2Q==','base64');
const webp=Buffer.from('UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoCAAMAAUAmJQBOl0AAcwAA/vpXd8WxSG5nhyx7BEAAAA==','base64');
const media=(bytes=png(),type='image/png',name='界面截图.png',extra={})=>({name,type,dataUrl:'data:'+type+';base64,'+bytes.toString('base64'),...extra});
function fixture(t,options={}){const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'guanyin-media-store-')),root=path.join(directory,'article-media'),db=new DatabaseSync(path.join(directory,'workspaces.sqlite'));let state={brands:[{id:'brand-a',name:'A'},{id:'brand-b',name:'B'},{id:'demo',name:'演练',demo:true}]};const create=()=>articleMediaStore({db:options.db?.(db)||db,root,origin,readState:()=>state});const store=create();t.after(()=>{try{db.close()}catch{}fs.rmSync(directory,{force:true,recursive:true});});return {store,db,root,directory,create,setState:value=>state=value};}
async function call(store,action,body,options={}){const r=await store.handle(new Request((options.origin||origin)+'/api/article-media/'+action,{method:options.method||'POST',headers:{origin,'x-geo-request':'1','content-type':'application/json',...options.headers},...((options.method||'POST')!=='GET'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));return {status:r.status,data:await r.json()};}
const upload=(f,items,brandId='brand-a')=>call(f.store,'upload',{brandId,media:items});
const load=(f,ids,brandId='brand-a')=>call(f.store,'load',{brandId,ids});
const storedFile=(f,item,brandId='brand-a')=>path.join(f.root,sha(brandId),item.sha256+'.bin');

test('PNG JPEG WebP retain original bytes, dimensions and rights as local metadata; list contains no data URLs',async t=>{
 const f=fixture(t),input=[media(),media(jpeg,'image/jpeg','截图.jpg',{rightsConfirmed:true}),media(webp,'image/webp','截图.webp')];const uploaded=await upload(f,input);assert.equal(uploaded.status,200,JSON.stringify(uploaded));assert.equal(uploaded.data.media.length,3);
 for(const [i,item] of uploaded.data.media.entries()){assert.match(item.id,/^am-[a-f0-9]{64}$/);assert.equal(item.dataUrl,input[i].dataUrl);assert.equal(item.width,2);assert.equal(item.height,3);assert.equal(item.rightsConfirmed,i===1);assert.equal(fs.statSync(storedFile(f,item)).mode&0o777,0o600);}
 const listed=await call(f.store,'list',{brandId:'brand-a'});assert.equal(listed.status,200);assert.equal(listed.data.media.length,3);assert.ok(listed.data.media.every(m=>!('dataUrl'in m)));assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,3);
 assert.equal(await f.store.handle(new Request(origin+'/api/state')),null);
});

test('same brand upload deduplicates without changing prior rights or name; another brand never shares asset IDs',async t=>{
 const f=fixture(t),a=(await upload(f,[media()])).data.media[0],again=(await upload(f,[media(png(),'image/png','改名.png',{rightsConfirmed:true})])).data.media[0];assert.equal(again.id,a.id);assert.equal(again.name,a.name);assert.equal(again.rightsConfirmed,false);
 const b=(await upload(f,[media()],'brand-b')).data.media[0];assert.notEqual(a.id,b.id);assert.equal(a.sha256,b.sha256);assert.equal((await load(f,[a.id],'brand-b')).status,404);assert.equal((await load(f,[b.id])).status,404);assert.equal((await call(f.store,'list',{brandId:'brand-b'})).data.media.length,1);
});

test('saved assets survive store recreation, preserve requested order and support per-article rights without mutating originals',async t=>{
 const f=fixture(t),saved=(await upload(f,[media(),media(png({color:30}))])).data.media;f.store=f.create();const ordered=await load(f,[saved[1].id,saved[0].id]);assert.equal(ordered.status,200);assert.deepEqual(ordered.data.media.map(m=>m.id),[saved[1].id,saved[0].id]);
 const refs=saved.map(m=>({id:m.id,sha256:m.sha256,rightsConfirmed:true})),resolved=f.store.resolveRefs('brand-a',refs);assert.equal(resolved[0].dataUrl,saved[0].dataUrl);assert.ok(resolved.every(m=>m.rightsConfirmed));const validated=f.store.validateRefs('brand-a',refs);assert.ok(validated.every(m=>!('dataUrl'in m)&&m.rightsConfirmed));assert.equal((await load(f,[saved[0].id])).data.media[0].rightsConfirmed,false);
 assert.throws(()=>f.store.resolveRefs('brand-b',refs),/当前品牌/);assert.throws(()=>f.store.resolveRefs('brand-a',[{...refs[0],sha256:'0'.repeat(64)}]),/指纹/);assert.throws(()=>f.store.resolveRefs('brand-a',[{...refs[0],rightsConfirmed:'true'}]),/许可/);assert.throws(()=>f.store.resolveRefs('brand-a',[refs[0],refs[0]]),/重复/);
 f.setState({brands:[{id:'brand-b'}]});assert.equal((await load(f,[saved[0].id])).status,404);assert.throws(()=>f.store.resolveRefs('brand-a',refs),/品牌不存在/);
});

test('closing and reopening the actual SQLite file preserves immutable media without workspace base64',async t=>{
 const f=fixture(t),saved=(await upload(f,[media()])).data.media[0];f.db.close();const reopened=new DatabaseSync(path.join(f.directory,'workspaces.sqlite'));
 try{const store=articleMediaStore({db:reopened,root:f.root,origin,readState:()=>({brands:[{id:'brand-a'}]})});const restored=await call(store,'load',{brandId:'brand-a',ids:[saved.id]});assert.equal(restored.status,200);assert.equal(restored.data.media[0].dataUrl,saved.dataUrl);const row=reopened.prepare('SELECT * FROM article_media WHERE id=?').get(saved.id);assert.ok(!Object.keys(row).some(k=>/dataurl|base64|buffer/i.test(k)));assert.ok(!JSON.stringify(row).includes(saved.dataUrl));}finally{reopened.close();}
});

test('local media routes reject remote origin, missing same-origin proof, shared workspace and non-POST requests',async t=>{
 const f=fixture(t),body={brandId:'brand-a',media:[media()]};for(const options of [{origin:'https://remote.example'},{headers:{origin:'https://remote.example'}},{headers:{origin:''}},{headers:{'x-geo-request':'0'}},{headers:{'x-geo-workspace':'other-owner'}}])assert.equal((await call(f.store,'upload',body,options)).status,403);
 assert.equal((await call(f.store,'list',{}, {method:'GET'})).status,405);assert.equal((await call(f.store,'upload',body,{headers:{'content-type':'text/plain'}})).status,400);assert.equal((await upload(f,[media()],'demo')).status,404);assert.equal((await upload(f,[media()],'../escape')).status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,0);
});

test('malformed or mismatched image types, names, base64 and rights never create files or metadata',async t=>{
 const f=fixture(t);for(const item of [media(Buffer.from('<svg onload="x"/>')),media(png(),'image/jpeg','bad.jpg'),media(png(),'image/png','bad.svg'),media(png(),'image/png','../bad.png'),media(png(),'image/png','bad\n.png'),media(png(),'image/png','bad.png',{rightsConfirmed:'true'}),{...media(),dataUrl:media().dataUrl+'!'},media(Buffer.from('a'),'image/gif','x.gif')])assert.equal((await upload(f,[item])).status,400);
 assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,0);assert.deepEqual(fs.readdirSync(f.root),[]);
});

test('truncated PNG JPEG WebP and PNG checksum or compressed stream corruption are rejected',async t=>{
 const f=fixture(t);for(const [bytes,type,name]of [[png(),'image/png','p.png'],[jpeg,'image/jpeg','j.jpg'],[webp,'image/webp','w.webp']])assert.equal((await upload(f,[media(bytes.subarray(0,bytes.length-2),type,name)])).status,400);
 const corrupt=Buffer.from(png());corrupt[30]^=1;assert.equal((await upload(f,[media(corrupt)])).status,400);
 const data=png(),invalid=Buffer.concat([data.subarray(0,33),chunk('IDAT',Buffer.from([1,2,3])),chunk('IEND',Buffer.alloc(0))]);assert.equal((await upload(f,[media(invalid)])).status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,0);
});

test('dimension, per-file, batch-size and count limits validate whole batch before saving',async t=>{
 const f=fixture(t);assert.equal((await upload(f,Array.from({length:10},()=>media()))).status,400);
 const tooWide=png({width:10001,height:1});assert.equal((await upload(f,[media(tooWide)])).status,400);
 const huge=Buffer.alloc(ARTICLE_MEDIA_LIMITS.fileBytes+1);assert.equal((await upload(f,[media(huge)])).status,413);
 const large=png({payload:Buffer.alloc(1700000)});assert.equal((await upload(f,Array.from({length:5},()=>media(large)))).status,413);
 assert.equal((await upload(f,[media(),media(Buffer.from('bad'))])).status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,0);assert.deepEqual(fs.readdirSync(f.root),[]);
});

test('load and duplicate upload fail explicitly when saved bytes are missing or changed',async t=>{
 const f=fixture(t),saved=(await upload(f,[media()])).data.media[0],file=storedFile(f,saved);const bytes=fs.readFileSync(file);fs.writeFileSync(file,Buffer.alloc(bytes.length));assert.equal((await load(f,[saved.id])).status,409);assert.equal((await upload(f,[media()])).status,409);assert.throws(()=>f.store.validateRefs('brand-a',[{id:saved.id,sha256:saved.sha256,rightsConfirmed:true}]),/校验/);
 fs.unlinkSync(file);assert.equal((await load(f,[saved.id])).status,409);assert.equal((await upload(f,[media()])).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,1);
});

test('symbolic file and brand-directory links never load outside files, even with matching original bytes',async t=>{
 const f=fixture(t),saved=(await upload(f,[media()])).data.media[0],file=storedFile(f,saved),outside=path.join(f.directory,'outside.png');fs.writeFileSync(outside,png());fs.unlinkSync(file);fs.symlinkSync(outside,file);assert.equal((await load(f,[saved.id])).status,409);assert.equal((await upload(f,[media()])).status,409);fs.unlinkSync(file);
 const brandDir=path.dirname(file),moved=brandDir+'-moved';fs.renameSync(brandDir,moved);fs.symlinkSync(moved,brandDir,'dir');assert.equal((await load(f,[saved.id])).status,409);assert.equal((await upload(f,[media()])).status,409);assert.deepEqual(fs.readFileSync(outside),png());
});

test('root replacement, linked parent roots and hardlinked image files are denied',async t=>{
 const f=fixture(t),saved=(await upload(f,[media()])).data.media[0],file=storedFile(f,saved),outside=path.join(f.directory,'hardlink.png');fs.linkSync(file,outside);assert.equal((await load(f,[saved.id])).status,409);fs.unlinkSync(outside);
 const moved=f.root+'-saved';fs.renameSync(f.root,moved);fs.mkdirSync(f.root);assert.equal((await load(f,[saved.id])).status,409);
 const alias=path.join(f.directory,'alias');fs.symlinkSync(moved,alias,'dir');assert.throws(()=>articleMediaStore({db:f.db,root:path.join(alias,'nested'),origin,readState:()=>({brands:[]})}),/链接/);
});

test('brand image quota and total byte quota fail without writing a new image',async t=>{
 const f=fixture(t),base=(await upload(f,[media()])).data.media[0];for(let i=1;i<200;i++)f.db.prepare('INSERT INTO article_media VALUES(?,?,?,?,?,?,?,?,?,?)').run('quota-'+i,'brand-a',String(i),base.name,base.type,base.bytes,base.width,base.height,new Date().toISOString(),0);
 assert.equal((await upload(f,[media(png({color:22}))])).status,413);assert.equal((await upload(f,[media()])).status,200);
 f.db.prepare('UPDATE article_media SET bytes=? WHERE id=?').run(ARTICLE_MEDIA_LIMITS.storeBytes,'quota-1');assert.equal((await upload(f,[media()],'brand-b')).status,413);assert.equal(fs.existsSync(path.join(f.root,sha('brand-b'))),false);
});

test('database write failure rolls back the entire batch and only removes files created by that attempt',async t=>{
 let inserts=0,failWrites=false;const f=fixture(t,{db:db=>({exec:sql=>db.exec(sql),prepare:sql=>{const statement=db.prepare(sql);if(!sql.startsWith('INSERT INTO article_media'))return statement;return {run:(...args)=>{if(failWrites&&++inserts===2)throw Error('isolated write failure');return statement.run(...args)}};}})});
 const kept=(await upload(f,[media()])).data.media[0];failWrites=true;const result=await upload(f,[media(png({color:23})),media(png({color:24}))]);assert.equal(result.status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM article_media').get().n,1);assert.deepEqual(fs.readFileSync(storedFile(f,kept)),png());assert.deepEqual(fs.readdirSync(path.dirname(storedFile(f,kept))),[kept.sha256+'.bin']);
});

test('malformed and cross-brand ref requests never silently omit missing media',async t=>{
 const f=fixture(t),saved=(await upload(f,[media()])).data.media[0];for(const ids of [[saved.id,saved.id],['../escape'],Array(10).fill(saved.id)])assert.equal((await load(f,ids)).status,400);assert.equal((await load(f,[saved.id,'am-'+'0'.repeat(64)])).status,404);assert.deepEqual((await load(f,[])).data.media,[]);
 f.db.prepare('UPDATE article_media SET width=4 WHERE id=?').run(saved.id);assert.equal((await load(f,[saved.id])).status,409);
});
