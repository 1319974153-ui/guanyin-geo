import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {douyinReceiptPage} from '../browser-extension/douyin-receipt.js';
function setup(){let clicked=0,body='2 张 标题。完整正文',status='已发布',origin='https://creator.douyin.com/creator-micro/content/manage',duplicates=false;
 const el=text=>({innerText:text,getClientRects:()=>[{}],contains:()=>false,querySelectorAll:()=>[]});
 const leaf={...el(''),get innerText(){return body},click(){clicked++},parentElement:{...el(''),querySelectorAll:()=>[el(status)]}};
 const root={...el('作者声明：内容由 AI 生成'),querySelectorAll:()=>[el('标题。完整正文')]};
 const context=vm.createContext({URL,location:{get href(){return origin}},document:{querySelectorAll:s=>s.startsWith('main')?[root]:duplicates?[leaf,{...leaf}]:[leaf]},getComputedStyle:()=>({visibility:'visible'})});
 const args={action:'receipt-list-inspect',article:{title:'标题',text:'完整正文',ai:true},accountId:'123',media:[{},{}],profileEvidence:{accountId:'123',accountVerified:true,evidenceUrl:'https://creator.douyin.com/creator-micro/home'}};
 return {run:patch=>vm.runInContext('('+douyinReceiptPage.toString()+')',context)({...args,...patch}),body:v=>body=v,status:v=>status=v,url:v=>origin=v,duplicates:()=>duplicates=true,get clicks(){return clicked}};
}
test('Douyin receipt finds exact account, text and media count before read-navigation only',()=>{const f=setup();assert.equal(f.run().reviewState,'published');assert.equal(f.clicks,0);assert.equal(f.run({action:'receipt-list-open'}).contentVerified,true);assert.equal(f.clicks,1);assert.ok(f.run({accountId:'other'}).connectorError);f.body('标题。完整正文');assert.equal(f.run().contentVerified,true);f.body('2张标题。部分正文');assert.ok(f.run().connectorError);assert.equal(f.clicks,1)});
test('Douyin duplicate title/body, rejection and missing status never become success',()=>{const f=setup();f.duplicates();assert.ok(f.run().connectorError);assert.equal(f.clicks,0);const r=setup();r.status('审核未通过');assert.ok(r.run().connectorError);r.status('审核中');assert.equal(r.run().reviewState,'reviewing');r.status('加载中');assert.ok(r.run().connectorError)});
test('Douyin public proof binds visible exact content to an observed note ID and AI declaration',()=>{const f=setup();f.url('https://www.douyin.com/note/7701977994482437414');const r=f.run({action:'receipt-public'});assert.equal(r.contentVerified,true);assert.equal(r.articleId,'7701977994482437414');assert.equal(f.run({action:'receipt-public',article:{title:'标题',text:'另一篇',ai:true}}),null);f.url('https://www.douyin.com/user/self?modal_id=7701977994482437414');assert.equal(f.run({action:'receipt-public'}).url,r.url);f.url('https://evil.test/note/7701977994482437414');assert.equal(f.run({action:'receipt-public'}),null);assert.equal(f.clicks,0)});
