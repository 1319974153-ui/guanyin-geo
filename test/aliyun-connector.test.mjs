import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {aliyunPage} from '../browser-extension/aliyun.js';
import {editorEvidence,draftEvidence,receiptEvidence,preparationEditorUrl} from '../browser-extension/platforms.js';
import {navigationAllowed} from '../desktop/security.mjs';
function fixture({body='第一段 第二段',title='技术稿',account='author-123',url='https://developer.aliyun.com/article/new?edit=123#/',duplicates=false,checked=true}={}){
 let clicks=0,opened=0;const el=(innerText,extra={})=>({innerText,textContent:innerText,getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],focus(){},click(){},...extra});
 const editor=el('',{tagName:'TEXTAREA',value:body}),titleEl=el('',{tagName:'INPUT',value:title}),preview=el(body);
 const checkbox={checked,click(){this.checked=false}},label=el('已同意用户免责声明',{querySelector:()=>checkbox});
 const row=()=>el('',{querySelector:()=>el(title,{click(){opened++}})});
 const doc={querySelectorAll(s){
  if(s==='span.nickname')return [el('测试作者')];
  if(s==='a.tab-item[href]')return [el('动态',{href:'https://developer.aliyun.com/profile/'+account}),el('高分内容',{href:'https://developer.aliyun.com/profile/'+account+'/highScore_1'})];
  if(s==='input#title[placeholder="请填写标题"]')return [titleEl];
  if(s==='.left-content textarea.textarea')return [editor];
  if(s==='.markdown-body')return [preview];
  if(s==='.draft-list-dialog')return [el('草稿箱',{querySelectorAll:()=>Array.from({length:duplicates?2:1},row)})];
  if(s==='button')return [el('存为草稿',{click(){clicks++}}),el('发布文章',{click(){throw Error('不应点击公开发布')}})];
  if(s==='label')return [label];return [];
 }};
 const context=vm.createContext({URL,URLSearchParams,document:doc,location:new URL(url),getComputedStyle:()=>({visibility:'visible'}),setTimeout:f=>f(),DOMParser:class{parseFromString(s){return {body:{textContent:s.replace(/<[^>]*>/g,'')}}}}});
 const article={title:'技术稿',text:'第一段\n\n第二段',html:'<p>第一段</p><p>第二段</p>',ai:false};
 const profileEvidence={accountId:account,name:'测试作者',profileUrl:'https://developer.aliyun.com/profile/'+account};
 return {article,run:(action,patch={})=>vm.runInContext('('+aliyunPage.toString()+')',context)({action,article,accountId:'author-123',profileEvidence,...patch}),get clicks(){return clicks},get opened(){return opened},checkbox};
}
test('Alibaba identity is read only from own profile and stable rendered profile links',async()=>{
 const f=fixture({url:'https://developer.aliyun.com/myProfile'});assert.equal((await f.run('account')).accountId,'author-123');
 assert.match((await fixture().run('account')).connectorError,/不是本人/);
 assert.match((await fixture({account:'other'}).run('save-draft')).connectorError,/账号已变化/);
 assert.match((await fixture().run('identity',{profileEvidence:null})).connectorError,/缺少本次/);
});
test('Alibaba draft save checks full text and unchecks, never accepts, public disclaimer',async()=>{
 const f=fixture();assert.equal((await f.run('save-draft')).saveAttempted,true);assert.equal(f.clicks,1);assert.equal(f.checkbox.checked,false);
 const bad=fixture({body:'第二段'});assert.match((await bad.run('save-draft')).connectorError,/完整正文/);assert.equal(bad.clicks,0);
 assert.match((await f.run('submit')).connectorError,/尚未开放/);assert.equal(f.clicks,1);
});
test('Alibaba refuses overwrite and duplicate list matches',async()=>{
 assert.match((await fixture().run('fill')).connectorError,/已有内容/);
 const bad=fixture({duplicates:true});assert.match((await bad.run('draft-list-open')).connectorError,/唯一/);assert.equal(bad.opened,0);
 const good=fixture();assert.equal((await good.run('draft-list-inspect')).matched,true);assert.equal(good.opened,0);await good.run('draft-list-open');assert.equal(good.opened,1);
});
test('Alibaba requires same-account list evidence plus numbered reopened full body',async()=>{
 const f=fixture();assert.equal(await f.run('draft-receipt'),null);
 const proof={draftListed:true,url:'https://developer.aliyun.com/article/new?edit=123',articleId:'123',accountId:'author-123'};
 assert.equal((await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:proof}})).savedVerified,true);
 for(const patch of [{accountId:'other'},{articleId:'999'},{draftListed:false}])assert.equal(await f.run('draft-receipt',{article:{...f.article,verifiedDraftList:{...proof,...patch}}}),null);
 assert.equal(f.clicks,0);
});
test('Alibaba accepts only observed editor URLs; draft URL is never a public receipt',()=>{
 const url='https://developer.aliyun.com/article/new?edit=123#/',proof={url,articleId:'123',accountId:'a',savedVerified:true,contentVerified:true};
 assert.ok(editorEvidence('aliyun',url));assert.equal(preparationEditorUrl('aliyun',url),url.replace('#/',''));assert.ok(draftEvidence('aliyun',proof));assert.equal(receiptEvidence('aliyun',url,'123'),false);
 for(const bad of [url.replace('123','124'),url.replace('#/','#other'),url.replace('https:','http:'),url.replace('aliyun.com','aliyun.com.evil.test'),url.replace('edit=123','edit=123&edit=124'),url.replace('edit=123','edit=123&foo=1')])assert.equal(draftEvidence('aliyun',{...proof,url:bad}),null);
 for(const bad of ['https://evil.developer.aliyun.com','https://account-s.aliyun.com/other','http://account-s.aliyun.com/pass/adding','https://user:pass@developer.aliyun.com/'])assert.equal(navigationAllowed('aliyun',bad),false);
 assert.equal(navigationAllowed('aliyun','https://account-s.aliyun.com/pass/adding'),true);
});

test('Alibaba rejects unverified embedded media instead of calling it a text-only success',async()=>{const f=fixture();assert.match((await f.run('save-draft',{article:{...f.article,text:'![image](https://example.com/image.png)'}})).connectorError,/纯文本/);assert.equal(f.clicks,0)});
