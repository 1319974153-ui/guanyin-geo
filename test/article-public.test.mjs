import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {articlePublicUrl,articlePublicMatches} from '../local/article-public.mjs';
import {publisherBridge} from '../local/publisher-bridge.mjs';
const snapshot={title:'发布恢复',html:'<p>第一段<strong>证据</strong></p><p>本文包含 AI 辅助整理。</p>',contentId:'c'};
const job=platform=>({platform,accountId:'writer',mode:'publish',attempted:true,state:'submitted',receipt:{url:platform==='csdn'?'https://mp.csdn.net/mp_blog/creation/success/123':'https://zhuanlan.zhihu.com/p/123',articleId:'123'},snapshot});
const page=platform=>platform==='csdn'?`<h1 id="articleContentId">发布恢复</h1><div id="content_views">${snapshot.html}</div>`:`<h1 class="Post-Title">发布恢复</h1><div class="Post-RichText">${snapshot.html}</div><span class="AuthorInfo-name"><a class="UserLink-link" href="//www.zhihu.com/people/writer">作者</a></span>`;
test('Zhihu automatic entity-link icons do not masquerade as article media, while real SVG stays unverified',()=>{
 const icon='<a class="RichContent-EntityWord" href="https://zhida.zhihu.com/search?q=test">第一段<svg class="ZDI ZDI--FourPointedStar16"><path d="M0 0"/></svg></a>';
 const html=page('zhihu').replace('第一段',icon);
 assert.equal(articlePublicMatches(html,job('zhihu')),true);
 for(const invalid of [html.replace('ZDI--FourPointedStar16','actual-diagram'),html.replace('https://zhida.zhihu.com','https://evil.test'),html.replace('<path d="M0 0"/>','<text>未核验图表</text>')])assert.equal(articlePublicMatches(invalid,job('zhihu')),false);
});
for(const platform of ['csdn','zhihu']){
 test(`${platform} exact receipt and full text required; never verify a summary or image omission`,()=>{
  const j=job(platform),html=page(platform);
  assert.equal(articlePublicMatches(html,j),true);
  for(const patch of [{state:'draft'},{mode:'draft'},{attempted:false},{accountId:'x/y'},{receipt:{...j.receipt,articleId:'456'}},{receipt:{...j.receipt,url:j.receipt.url+'?redirect=other'}},{receipt:{...j.receipt,url:'https://evil.test/p/123'}}])assert.equal(articlePublicUrl({...j,...patch}),null);
  for(const invalid of [html.replace('第一段','摘要'),html.replace('发布恢复','其他稿件'),html.replace('本文包含 AI 辅助整理。',''),html+html,'<h1>请登录</h1>',html.replace('</p>','<img src="https://example.com/a.png"></p>')])assert.equal(articlePublicMatches(invalid,j),false);
  assert.equal(articlePublicMatches(html,{...j,media:[{sha256:'hash'}]}),false);
  assert.equal(articlePublicMatches(html,{...j,snapshot:{...snapshot,html:snapshot.html+'<img src="https://example.com/a.png">'}}),false);
  if(platform==='zhihu')assert.equal(articlePublicMatches(html.replace('/people/writer','/people/other'),j),false);
 });
 test(`${platform} review reconciliation backs off, preserves original task and resumes after restart`,async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=1000000,calls=0;
  const options={db,origin:'http://127.0.0.1:55555',clock:()=>time,readState:()=>({brands:[{id:'b'}],contents:[]}),verifyPublic:async()=>{calls++;return calls===4}};
  let bridge=publisherBridge(options);const j={...job(platform),id:'j',brandId:'b',sourceHash:'hash'};
  db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run('j','fingerprint',JSON.stringify(j));
  const tick=async()=>{bridge.reconcileSubmitted();await new Promise(r=>setImmediate(r));};
  await tick();await tick();assert.equal(calls,1);
  bridge=publisherBridge(options);await tick();assert.equal(calls,1);
  for(let i=0;i<3;i++){time+=3600001;await tick()}
  const saved=JSON.parse(db.prepare('SELECT body FROM publisher_jobs').get().body);
  assert.equal(saved.state,'published');assert.equal(saved.receipt.publicUrl,articlePublicUrl(j));assert.equal(saved.receipt.url,j.receipt.url);assert.equal(saved.receipt.publicVerified,true);
  await tick();assert.equal(calls,4);assert.equal(db.prepare('SELECT count(*) n FROM publisher_jobs').get().n,1);
 });
}
test('a late public proof cannot promote a changed account or changed source',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let resolve;
 const bridge=publisherBridge({db,origin:'http://127.0.0.1:55555',readState:()=>({brands:[{id:'b'}],contents:[]}),verifyPublic:()=>new Promise(r=>resolve=r)});
 const j={...job('zhihu'),id:'j',brandId:'b',sourceHash:'hash'};
 db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run('j','fingerprint',JSON.stringify(j));
 bridge.reconcileSubmitted();await new Promise(r=>setImmediate(r));
 db.prepare('UPDATE publisher_jobs SET body=? WHERE id=?').run(JSON.stringify({...j,accountId:'changed'}),'j');
 resolve(true);await new Promise(r=>setImmediate(r));
 assert.equal(JSON.parse(db.prepare('SELECT body FROM publisher_jobs').get().body).state,'submitted');
});
