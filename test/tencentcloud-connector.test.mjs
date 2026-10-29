import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {tencentcloudPage} from '../browser-extension/tencentcloud.js';
import {editorEvidence,draftEvidence,receiptEvidence,preparationEditorUrl} from '../browser-extension/platforms.js';
import {navigationAllowed} from '../desktop/security.mjs';
function fixture({body='第一段 第二段',title='技术稿',account='12809181',url='https://cloud.tencent.com/developer/article/write-new?draftId=123',saved=true,duplicates=false,captcha=false,modal=false,saveReadyAfter=0,publishSettings=false,source="",candidate="自动化测试"}={}){
 let clicks=0,buttonReads=0,tag="",tagReads=0;
 const el=(innerText,extra={})=>({innerText,textContent:innerText,getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],focus(){},select(){},click(){},...extra});
 const preview=el(body),editor=el('仅显示第二段');
 const titleEl=el('',{value:title,tagName:'TEXTAREA'});
 const original=el('',{checked:source==='原创'}),repost=el('',{checked:source==='转载'});
 const sourceLabel=el('原创',{click(){original.checked=true}});original.closest=()=>sourceLabel;repost.closest=()=>el('转载');
 const tagRoot={querySelectorAll:()=>tag?[el(tag)]:[]};
 tagRoot.parentElement={querySelectorAll:()=>++tagReads>2?[el(candidate,{click(){tag=candidate}})]:[]};
 const tagInput=el('',{value:'',tagName:'INPUT',parentElement:tagRoot,dispatchEvent(){}});
 const summary=el('',{value:'',tagName:'TEXTAREA',dispatchEvent(){},closest:()=>({})});
 class Input{};class Area{};for(const C of [Input,Area])Object.defineProperty(C.prototype,'value',{set(v){this.value=v}});

 const doc={querySelectorAll(s){
 if(s.includes('captcha'))return captcha?[el('验证')]:[];
 if(s==='.cdc-header__account a.cdc-header__account-bubble__item[href]')return [el('个人主页',{href:'https://cloud.tencent.com/developer/user/'+account})];
 if(s==='.cdc-header__account-name')return [el('温舒')];
 if(s==='.cdc-article-editor__title-input')return [titleEl];
 if(s==='.cm-content[contenteditable="true"]')return [editor];
 if(s==='.cherry-markdown')return [preview];
 if(s==='.cdc-article-editor__header-info .header-info')return saved?[el('文章已保存到草稿',{querySelector:()=>({})})]:[];
 if(s==='h3 a[href]')return Array.from({length:duplicates?2:1},()=>el(title,{href:'https://cloud.tencent.com/developer/article/write-new?draftId=123'}));
 if(publishSettings&&s==='.editor-publish-drawer__textarea-main')return [summary];
 if(publishSettings&&s==='input[type="radio"]')return [original,repost];
 if(publishSettings&&s==='.cdc-tags-input__input')return [tagInput];
 if(publishSettings&&s==='.cdc-tags-input__dropdown-item-text')return tagRoot.parentElement.querySelectorAll(s);
 if(publishSettings&&s==='button')return [el('确认发布',{tagName:'BUTTON',value:'',classList:{contains:()=>false},click(){clicks++}})];
 if(s==='button')return [el('存草稿',{tagName:'BUTTON',value:'',disabled:buttonReads++<saveReadyAfter,classList:{contains:()=>false},click(){clicks++}})];
 if(s==='.cdc-publish-modal')return modal?[el('发布成功！审核中',{querySelectorAll:()=>[el('详情',{href:'https://cloud.tencent.com/developer/article/456'})]})]:[];
 return [];
 }};
 const context=vm.createContext({URL,HTMLInputElement:Input,HTMLTextAreaElement:Area,Event:class{},document:doc,location:new URL(url),getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn()},DOMParser:class{parseFromString(s){return{body:{textContent:s.replace(/<[^>]*>/g,'')}}}}});
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
test('Tencent recovers a persisted draft without a transient save banner, but rejects wrong ID or body',async()=>{
 const proof={draftListed:true,url:'https://cloud.tencent.com/developer/article/write-new?draftId=123',articleId:'123',accountId:'12809181'};
 const f=fixture({saved:false});
 const receipt=await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:proof}});
 assert.equal(receipt.savedVerified,true);assert.equal(receipt.verification,'draft_list_and_reopened_content');assert.equal(f.clicks,0);
 assert.equal(await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:{...proof,articleId:'999'}}}),null);
 const bad=fixture({saved:false,body:'其他稿件'});
 assert.match((await bad.run('draft-receipt',{article:{...bad.article,verifiedDraftList:proof}})).connectorError,/完整正文/);assert.equal(bad.clicks,0);
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

test('Tencent waits for delayed save readiness then clicks once; permanent disabled state never clicks',async()=>{
 const f=fixture({saveReadyAfter:4});assert.equal((await f.run('save-draft')).saveAttempted,true);assert.equal(f.clicks,1);
 const disabled=fixture({saveReadyAfter:100});assert.match((await disabled.run('save-draft')).connectorError,/未点击保存/);assert.equal(disabled.clicks,0);
});

test('Tencent preflight selects an exact suggested tag and never submits; existing repost selection is preserved',async()=>{
 const f=fixture({publishSettings:true});const article={...f.article,tags:['自动化测试']};
 assert.equal((await f.run('preflight',{article,tagInputReady:true})).ready,true);assert.equal(f.clicks,0);
 const bad=fixture({publishSettings:true,candidate:'自动化测试服务'});
 assert.match((await bad.run('preflight',{article,tagInputReady:true})).connectorError,/准确标签/);assert.equal(bad.clicks,0);
 const repost=fixture({publishSettings:true,source:'转载'});
 assert.match((await repost.run('preflight',{article})).connectorError,/不自动改为原创/);assert.equal(repost.clicks,0);
});

test('Tencent asks desktop native insertion before querying tag suggestions',async()=>{const f=fixture({publishSettings:true});assert.deepEqual(JSON.parse(JSON.stringify(await f.run('preflight',{article:{...f.article,tags:['自动化测试']}}))),{nativeInsertTag:'自动化测试'});assert.equal(f.clicks,0)});
