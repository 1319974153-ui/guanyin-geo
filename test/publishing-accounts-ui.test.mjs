import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publishingCatalog} from '../src/publishing-catalog.js';

function context(){
 const storage=new Map(),calls=[],g={currentBrand:'b1',accessInfo:{current:{owner:'owner',role:'owner'}},document:{addEventListener(){}},brand:()=>({id:g.currentBrand}),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},apiRequest:async(...args)=>{calls.push(args);return{}},runtimeFlush:async()=>{},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/wordpress.js',import.meta.url),'utf8'),g);
 return{g,calls,storage};
}
function publishingContext(){
 const fixture=context(),{g}=fixture;
 Object.assign(g,{window:{addEventListener(){}},URLSearchParams,route:'integrations',render(){},isManager:()=>['owner','admin'].includes(g.accessInfo.current.role),btn:label=>'<button>'+g.esc(label)+'</button>',badge:label=>'<span>'+g.esc(label)+'</span>',table:(headers,rows,empty)=>'<table>'+headers.join(' ')+rows.map(row=>'<tr>'+row.join(' ')+'</tr>').join('')+(rows.length?'':empty)+'</table>'});
 vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 vm.runInContext(fs.readFileSync(new URL('../public/publishing-center.js',import.meta.url),'utf8'),g);
 return fixture;
}
function directory(connected,draft,publish){
 return {brandId:'b1',accounts:[],platforms:[],batchPublishingAvailable:connected>0,batchPublishingSummary:{connected,draft,publish,scope:'self_hosted_and_api_accounts_only'}};
}
test('selected publishing account accompanies reads, JSON writes and media uploads',async()=>{
 const {g,calls}=context();g.wordpressSelectAccount('wp-account-a');
 await g.wordpressRequest('/api/wordpress?brandId=b1');
 await g.wordpressRequest('/api/wordpress/draft',{method:'POST',body:JSON.stringify({brandId:'b1',accountId:'stale-account'})});
 const media=new FormData();media.set('brandId','b1');await g.wordpressRequest('/api/wordpress/media/upload',{method:'POST',body:media});
 assert.match(calls[0][0],/accountId=wp-account-a/);assert.equal(JSON.parse(calls[1][1].body).accountId,'wp-account-a');assert.equal(media.get('accountId'),'wp-account-a');
});
test('pending submissions and chosen identities remain separate across account, brand and workspace switches',()=>{
 const {g,storage}=context();storage.set(g.wordpressPendingKey(),JSON.stringify({id:'legacy-request'}));
 g.wordpressSelectAccount('wp-account-a');assert.equal(g.wordpressPending(),null);storage.set(g.wordpressPendingKey(),JSON.stringify({id:'account-a-request'}));
 g.currentBrand='b2';assert.equal(g.wordpressSelectedAccount(),'default');assert.equal(g.wordpressPending(),null);
 g.currentBrand='b1';assert.equal(g.wordpressSelectedAccount(),'wp-account-a');assert.equal(g.wordpressPending().id,'account-a-request');
 g.accessInfo.current.owner='other';assert.equal(g.wordpressSelectedAccount(),'default');assert.equal(g.wordpressPending(),null);
 g.accessInfo.current.owner='owner';g.wordpressSelectAccount('default');assert.equal(g.wordpressPending().id,'legacy-request');
});
test('switching accounts while a form is open refuses submission before network calls',async()=>{
 const {g,calls}=context();const oldScope=g.wordpressScope();g.wordpressSelectAccount('wp-account-a');
 await assert.rejects(g.wordpressMutation('connection',{},oldScope),/已切换/);assert.equal(calls.length,0);
});
test('publishing account view shows separate draft and submission counts with their scope',async()=>{
 const {g}=publishingContext();g.apiRequest=async()=>directory(3,3,2);await g.refreshPublishingCenter();
 const html=g.renderPublishingCenter();assert.match(html,/可保存草稿 3 个账号，可提交 2 个账号/);assert.match(html,/仅统计已接入的自建网站、博客和知识库/);assert.match(html,/当前权限和上次核验结果筛选；提交前仍会检查/);
 assert.doesNotMatch(g.publishingBatchAvailability(directory(3,3,2)),/self_hosted|batchPublishing|API|全部平台已接通/);
});
test('draft-only account availability does not imply permission to submit',async()=>{
 const {g}=publishingContext();g.apiRequest=async()=>directory(1,1,0);await g.refreshPublishingCenter();
 assert.match(g.renderPublishingCenter(),/可保存草稿 1 个账号，可提交 0 个账号/);
});
test('read-only and unavailable account views use server eligibility instead of counting visible accounts',async()=>{
 const {g}=publishingContext();g.accessInfo.current.role='viewer';
 const d=directory(0,0,0);d.accounts=[{platform:'wordpress',accountId:'default',username:'author',site:'https://example.org/',status:'verified',verifiedAt:'2026-10-16T00:00:00.000Z',capabilities:{createDraft:false,publish:false}}];
 g.apiRequest=async()=>d;await g.refreshPublishingCenter();const html=g.renderPublishingCenter();
 assert.match(html,/当前品牌暂无你可保存草稿或提交的账号/);assert.doesNotMatch(html,/可提交 1 个账号/);assert.doesNotMatch(html,/添加 WordPress 账号/);
});
test('switching brand, workspace, member or permissions hides previous account availability',async()=>{
 const {g}=publishingContext();g.apiRequest=async()=>directory(3,3,2);await g.refreshPublishingCenter();assert.match(g.renderPublishingCenter(),/可提交 2 个账号/);
 g.currentBrand='b2';assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);assert.match(g.renderPublishingCenter(),/正在读取发布账号/);
 g.currentBrand='b1';g.accessInfo.current.owner='other';assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);
 g.accessInfo.current.owner='owner';g.accessInfo.current.role='viewer';assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);
 g.accessInfo.current.role='owner';g.accessInfo.current.actor='another-member';assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);
 g.accessInfo.current.actor='';g.accessInfo.current.brands=['b2'];assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);
});
test('a response arriving after a role change cannot restore the old availability',async()=>{
 const {g}=publishingContext();let resolve;g.apiRequest=()=>new Promise(done=>{resolve=done});
 const pending=g.refreshPublishingCenter();g.accessInfo.current.role='viewer';resolve(directory(3,3,2));await pending;
 assert.equal(g.publishingCenterCurrent(),null);assert.doesNotMatch(g.renderPublishingCenter(),/可提交 2 个账号/);
});
test('missing or invalid availability summaries cannot advertise available accounts',()=>{
 const {g}=publishingContext();assert.equal(g.publishingBatchAvailability({batchPublishingAvailable:true,accounts:[{capabilities:{publish:true}}]}),'');
 for(const patch of [{scope:'all_platforms'},{connected:-1},{draft:'1'},{publish:2},{draft:'<img src=x>'}]){
  const d=directory(1,1,1);Object.assign(d.batchPublishingSummary,patch);assert.equal(g.publishingBatchAvailability(d),'');
 }
});
test('platform directory separates historical product acceptance from current accounts and draft checks',()=>{
 const {g,calls}=publishingContext(),html=g.publishingCatalogPanel(publishingCatalog());
 assert.match(html,/当前账号状态请看账号列表/);assert.match(html,/当前稿件能否发送，以文章发布页的准备检查为准/);
 assert.match(html,/有历史公开记录/);assert.match(html,/记录更新于 2026-11-06/);assert.match(html,/连接器 0.2.7/);
 assert.match(html,/验收版本：未记录/);assert.match(html,/产品公开正文自动核验尚未通过/);
 assert.doesNotMatch(html,/公开发布已验收|实机已验收|各项能力验收/);
 assert.equal((html.match(/<article class="integration">/g)||[]).length,36);assert.equal(calls.length,0);
});
