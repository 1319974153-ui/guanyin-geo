import test from 'node:test';import assert from 'node:assert/strict';
import {tencentPublicMatches,verifyTencentPublic} from '../local/tencentcloud-public.mjs';
const snapshot={title:'测试稿',html:'<p>第一段</p><p>完整结论</p>',ai:true};
const page='<h1 class="title-text">测试稿</h1><div class="mod-content__markdown"><p>第一段</p><p>完整结论</p><p>本文包含 AI 辅助生成或整理的内容。</p></div>';
const job={platform:'tencentcloud',mode:'publish',attempted:true,state:'submitted',receipt:{url:'https://cloud.tencent.com/developer/article/123',articleId:'123'},snapshot};
test('Tencent public proof requires exact title and full article body, not summary or login',()=>{
 assert.equal(tencentPublicMatches(page,snapshot),true);
 for(const bad of [page.replace('完整结论','删掉的内容'),page.replace('测试稿','别的标题'),page.replace('mod-content__markdown','summary'),page+page,'<h1>请登录</h1>'])assert.equal(tencentPublicMatches(bad,snapshot),false);
 assert.equal(tencentPublicMatches(page.replace('本文包含 AI 辅助生成或整理的内容。',''),snapshot),false);
});
test('Tencent anonymous check rejects arbitrary destinations, draft, missing commit and non-HTML',async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.cookie,undefined);return new Response(page,{headers:{'content-type':'text/html'}})};
 assert.equal(await verifyTencentPublic(job,{fetcher}),true);assert.equal(calls,1);
 for(const patch of [{state:'draft'},{attempted:false},{receipt:{url:'https://evil.test/123',articleId:'123'}}])assert.equal(await verifyTencentPublic({...job,...patch},{fetcher}),false);
 assert.equal(calls,1);assert.equal(await verifyTencentPublic(job,{fetcher:async()=>new Response(page,{headers:{'content-type':'application/json'}})}),false);
});
import {DatabaseSync} from 'node:sqlite';
import {publisherBridge} from '../local/publisher-bridge.mjs';
test('status verification is single-flight, bounded, read-only and persists only the original receipt',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=1000000,calls=0,resolve;
 const bridge=publisherBridge({db,origin:'http://127.0.0.1:55555',clock:()=>time,readState:()=>({brands:[{id:'b'}],contents:[]}),verifyPublic:async()=>{calls++;return new Promise(r=>resolve=r)}});
 const original={...job,id:'j',brandId:'b',sourceHash:'original',snapshot:{...snapshot,contentId:'c'},created:time,expires:time};
 db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run('j','fingerprint',JSON.stringify(original));
 const status=()=>bridge.handle(new Request('http://127.0.0.1:55555/api/local-publisher/status?brandId=b',{headers:{'x-geo-request':'1'}}));
 await Promise.all([status(),status()]);assert.equal(calls,1);resolve(false);await new Promise(r=>setImmediate(r));await status();assert.equal(calls,1);
 time+=60001;await status();assert.equal(calls,2);resolve(true);await new Promise(r=>setImmediate(r));
 const saved=JSON.parse(db.prepare('SELECT body FROM publisher_jobs').get().body);assert.equal(saved.state,'published');assert.equal(saved.receipt.publicVerified,true);assert.equal(saved.receipt.articleId,'123');assert.equal(saved.attempted,true);
 await status();assert.equal(calls,2);assert.equal(db.prepare('SELECT count(*) n FROM publisher_jobs').get().n,1);
});

test('rendered Tencent body excludes hidden editor and toolbar while still rejecting incomplete visible body',()=>{
 const body='<div class="mod-content__markdown"><div class="cherry-toolbar">H1 H2</div><textarea>old draft</textarea><div class="cherry-markdown"><p>第一段</p><p>完整结论</p><p>本文包含 AI 辅助生成或整理的内容。</p></div></div>';
 assert.equal(tencentPublicMatches('<h1 class="title-text">测试稿</h1>'+body,snapshot),true);
 assert.equal(tencentPublicMatches('<h1 class="title-text">测试稿</h1>'+body.replace('完整结论',''),snapshot),false);
});

test('inline auto-linked URLs do not introduce phantom body spaces',()=>{
 const s={title:'测试稿',html:'<p>参考：https://example.com 。</p>',ai:false};
 assert.equal(tencentPublicMatches('<h1 class="title-text">测试稿</h1><div class="mod-content__markdown"><p>参考：<a href="https://example.com">https://example.com</a> 。</p></div>',s),true);
});
