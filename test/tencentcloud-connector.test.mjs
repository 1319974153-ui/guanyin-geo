import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tencentcloudPage} from '../browser-extension/tencentcloud.js';
import {editorEvidence,draftEvidence,receiptEvidence,preparationEditorUrl} from '../browser-extension/platforms.js';
import {navigationAllowed} from '../desktop/security.mjs';
function fixture({body='第一段 第二段',title='技术稿',account='12809181',url='https://cloud.tencent.com/developer/article/write-new?draftId=123',saved=true,duplicates=false,captcha=false,modal=false}={}){
 let clicks=0;
 const el=(innerText,extra={})=>({innerText,textContent:innerText,getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],focus(){},...extra});
 const preview=el(body),editor=el('仅显示第二段');
 const titleEl=el('',{value:title,tagName:'TEXTAREA'});
 const doc={querySelectorAll(s){
 if(s.includes('captcha'))return captcha?[el('验证')]:[];
 if(s==='.cdc-header__account a.cdc-header__account-bubble__item[href]')return [el('个人主页',{href:'https://cloud.tencent.com/developer/user/'+account})];
 if(s==='.cdc-header__account-name')return [el('温舒')];
 if(s==='.cdc-article-editor__title-input')return [titleEl];
 if(s==='.cm-content[contenteditable="true"]')return [editor];
 if(s==='.cherry-markdown')return [preview];
 if(s==='.cdc-article-editor__header-info .header-info')return saved?[el('文章已保存到草稿',{querySelector:()=>({})})]:[];
 if(s==='h3 a[href]')return Array.from({length:duplicates?2:1},()=>el(title,{href:'https://cloud.tencent.com/developer/article/write-new?draftId=123'}));
 if(s==='button')return [el('存草稿',{disabled:false,classList:{contains:()=>false},click(){clicks++}})];
 if(s==='.cdc-publish-modal')return modal?[el('发布成功！审核中',{querySelectorAll:()=>[el('详情',{href:'https://cloud.tencent.com/developer/article/456'})]})]:[];
 return [];
 }};
 const context=vm.createContext({URL,document:doc,location:new URL(url),getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn()},DOMParser:class{parseFromString(s){return{body:{textContent:s.replace(/<[^>]*>/g,'')}}}}});
 const article={title:'技术稿',text:'第一段\n\n第二段',html:'<p>第一段</p><p>第二段</p>',ai:false};
 return {run:(action,patch={})=>vm.runInContext('('+tencentcloudPage.toString()+')',context)({action,article,accountId:'12809181',...patch}),article,get clicks(){return clicks}};
}
test('Tencent verifies full preview rather than virtualized editor fragments',async()=>{
 const f=fixture();assert.equal((await f.run('prepared')).contentVerified,true);assert.equal(f.clicks,0);
 assert.match((await fixture({body:'第二段'}).run('prepared')).connectorError,/完整正文/);
 assert.match((await fixture({account:'999'}).run('save-draft')).connectorError,/账号已变化/);
 assert.match((await fixture({captcha:true}).run('save-draft')).connectorError,/本人验证/);
});
test('Tencent refuses occupied editor and requires durable matching draft-list evidence',async()=>{
 const f=fixture();assert.match((await f.run('fill')).connectorError,/已有内容/);assert.equal(await f.run('draft-receipt'),null);
 const proof={draftListed:true,url:'https://cloud.tencent.com/developer/article/write-new?draftId=123',articleId:'123',accountId:'12809181'};
 assert.equal((await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:proof}})).savedVerified,true);
 assert.equal(await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:{...proof,accountId:'other'}}}),null);assert.equal(f.clicks,0);
});
test('Tencent draft list rejects ambiguous titles without opening or saving anything',async()=>{
 const f=fixture({url:'https://cloud.tencent.com/developer/creator/article?type=draft'});assert.equal((await f.run('draft-list-inspect')).articleId,'123');
 const bad=fixture({url:'https://cloud.tencent.com/developer/creator/article?type=draft',duplicates:true});assert.match((await bad.run('draft-list-inspect')).connectorError,/唯一/);assert.equal(bad.clicks,0);
});
test('Tencent success requires a unique actual platform link and remains submitted',async()=>{
 assert.equal(await fixture().run('receipt'),null);const r=await fixture({modal:true}).run('receipt');assert.equal(r.state,'submitted');assert.equal(r.articleId,'456');
});
test('Tencent URLs reject cross-origin, spoofing, extra query and unrelated draft identifiers',()=>{
 const url='https://cloud.tencent.com/developer/article/write-new?draftId=123';const proof={url,articleId:'123',accountId:'12809181',savedVerified:true,contentVerified:true};
 assert.ok(editorEvidence('tencentcloud',url));assert.equal(preparationEditorUrl('tencentcloud',url),url);assert.ok(draftEvidence('tencentcloud',proof));
 for(const bad of [url+'&draftId=123',url+'&x=1',url.replace('cloud.tencent.com','cloud.tencent.com.evil.test'),url.replace('https:','http:'),url.replace('123','124')])assert.equal(draftEvidence('tencentcloud',{...proof,url:bad}),null);
 assert.ok(receiptEvidence('tencentcloud','https://cloud.tencent.com/developer/article/456','456'));assert.equal(receiptEvidence('tencentcloud','https://cloud.tencent.com/developer/article/456?x=1','456'),false);
 assert.equal(navigationAllowed('tencentcloud','https://evil.test'),false);
});
