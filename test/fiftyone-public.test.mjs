import test from 'node:test';import assert from 'node:assert/strict';
import {fiftyonePublicUrl,fiftyoneMediaProof} from '../browser-extension/platforms.js';
import {fiftyonePublicMatches} from '../local/fiftyone-public.mjs';
const hash='a'.repeat(64),url='https://s2.51cto.com/images/blog/one.png';
const job={platform:'51cto',mode:'publish',attempted:true,state:'submitted',accountId:'123',receipt:{url:'https://blog.51cto.com/blogger/success/456',articleId:'456'},snapshot:{title:'开发图文',text:'完整正文',ai:true},media:[{sha256:hash}],mediaProof:[{sha256:hash,url}]};
const page='<h1>开发图文</h1><div id="container" class="editor-container"><p>完整正文</p><img src="'+url+'?x-oss-process=format,webp"><p>本文包含 AI 辅助生成或整理的内容。</p></div>';
test('51CTO public verification binds original account, article, full text and ordered uploaded images',()=>{
 assert.equal(fiftyonePublicUrl(job),'https://blog.51cto.com/u_123/456');assert.equal(fiftyonePublicMatches(page,job),true);
 for(const patch of [{accountId:'evil/123'},{attempted:false},{receipt:{url:'https://evil.test/456',articleId:'456'}},{state:'draft'}])assert.equal(fiftyonePublicUrl({...job,...patch}),null);
 for(const html of [page.replace('完整正文','摘要'),page.replace('one.png','other.png'),page.replace(/<img[^>]*>/,''),page+page,'您所浏览的文章还在审核中'+page,page.replace('AI 辅助生成或整理','AI')])assert.equal(fiftyonePublicMatches(html,job),false);
 assert.equal(fiftyonePublicMatches(page,{...job,mediaProof:[]}),false);
 assert.equal(fiftyoneMediaProof([{url:'https://evil.test/images/one.png',sha256:hash}],job.media),null);
 assert.equal(fiftyoneMediaProof([{url,sha256:'b'.repeat(64)}],job.media),null);
});
test('51CTO text-only legacy receipts still verify without requiring images',()=>{assert.equal(fiftyonePublicMatches(page.replace(/<img[^>]*>/,''),{...job,media:[],mediaProof:[]}),true)});
import {DatabaseSync} from 'node:sqlite';import {publisherBridge} from '../local/publisher-bridge.mjs';
test('review polling backs off, survives early pending results, and never repeats submission',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=1000000,calls=0;
 const bridge=publisherBridge({db,origin:'http://127.0.0.1:55555',clock:()=>time,readState:()=>({brands:[{id:'b'}],contents:[]}),verifyPublic:async()=>{calls++;return calls===5}});
 const original={...job,id:'j',brandId:'b',sourceHash:'hash',snapshot:{...job.snapshot,contentId:'c'}};
 db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run('j','fp',JSON.stringify(original));
 const status=async()=>{await bridge.handle(new Request('http://127.0.0.1:55555/api/local-publisher/status?brandId=b',{headers:{'x-geo-request':'1'}}));await new Promise(r=>setImmediate(r));};
 bridge.reconcileSubmitted();await new Promise(r=>setImmediate(r));assert.equal(calls,1);await status();assert.equal(calls,1);
 for(let i=0;i<4;i++){time+=3600001;await status();}
 assert.equal(calls,5);const saved=JSON.parse(db.prepare('SELECT body FROM publisher_jobs').get().body);assert.equal(saved.state,'published');assert.equal(saved.receipt.url,job.receipt.url);assert.equal(saved.receipt.publicUrl,'https://blog.51cto.com/u_123/456');assert.equal(db.prepare('SELECT count(*) n FROM publisher_jobs').get().n,1);
});
