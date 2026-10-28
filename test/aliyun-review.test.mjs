import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {aliyunPage} from '../browser-extension/aliyun.js';import {PLATFORMS,receiptEvidence} from '../browser-extension/platforms.js';
const article={title:'技术状态机',html:'<p>正文一</p><p>正文二</p>',ai:false};
async function observe({banner='内容审核中，请耐心等待',body='正文一 正文二',title=article.title,author='a',account='a',url='https://developer.aliyun.com/article/123',alerts=1,bodyAlert=false}={}){
 const el=(innerText,extra={})=>({innerText,getClientRects:()=>[{}],...extra});
 const selectors={'h1.article-title':[el(title)],'.article-content .article-inner.markdown-body':[el(body,{contains:()=>bodyAlert})],'.user-msg a.user-name,a.aigc-fixed-left-name':[el('作者',{href:'https://developer.aliyun.com/profile/'+author})],'.content-wrapper > .sens-word-alert,.content-wrapper .sens-word-alert':banner?Array.from({length:alerts},()=>el(banner)):[]};
 const context=vm.createContext({URL,URLSearchParams,location:new URL(url),document:{querySelectorAll:s=>selectors[s]||[]},getComputedStyle:()=>({visibility:'visible'}),DOMParser:class{parseFromString(s){return {body:{textContent:s.replace(/<[^>]*>/g,'')}}}}});
 return vm.runInContext('('+aliyunPage.toString()+')',context)({action:'receipt',article,accountId:'a',profileEvidence:{accountId:account,name:'作者',profileUrl:'https://developer.aliyun.com/profile/'+account}});
}
test('Aliyun reviewing and owner-visible article are receipts, never public success',async()=>{
 const reviewing=await observe();assert.equal(reviewing.reviewState,'reviewing');assert.equal(reviewing.publicVerified,false);assert.equal(reviewing.articleId,'123');
 const visible=await observe({banner:''});assert.equal(visible.reviewState,'public_unverified');assert.equal(visible.publicVerified,false);
 const rejected=await observe({banner:'抱歉,您所发布的内容未能通过审核'});assert.equal(rejected.blocked,true);assert.equal(rejected.reviewState,'rejected');
 assert.equal(PLATFORMS.aliyun.publishSupported,false);
});
test('Aliyun review observation binds exact account and full original content and fails closed on new banners',async()=>{
 for(const options of [{account:'other'},{author:'other'},{body:'摘要'},{title:'其他稿'},{banner:'账号受限'},{alerts:2}])assert.ok((await observe(options)).connectorError);
 const bodyOnly=await observe({banner:'抱歉,您所发布的内容未能通过审核',bodyAlert:true});assert.equal(bodyOnly.reviewState,'public_unverified');
 for(const url of ['https://developer.aliyun.com/article/new?edit=123','https://developer.aliyun.com/article/123?x=1','https://developer.aliyun.com/article/123#comments'])assert.equal(await observe({url}),null);
});
test('Aliyun article receipt URL accepts only exact numbered HTTPS origin and ID',()=>{
 assert.ok(receiptEvidence('aliyun','https://developer.aliyun.com/article/123','123'));
 for(const url of ['https://developer.aliyun.com/article/new?edit=123','https://developer.aliyun.com/article/124','https://developer.aliyun.com/article/123?x=1','https://developer.aliyun.com.evil.test/article/123','http://developer.aliyun.com/article/123'])assert.equal(!!receiptEvidence('aliyun',url,'123'),false);
});
