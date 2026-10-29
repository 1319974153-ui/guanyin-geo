import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {juejinPage} from '../browser-extension/juejin.js';
import {PLATFORMS,editorEvidence,preparationEditorUrl,draftEvidence,receiptEvidence} from '../browser-extension/platforms.js';
import {loginPageRequired} from '../desktop/login-state.mjs';
import {navigationAllowed} from '../desktop/security.mjs';
import {publishingEvidence} from '../src/publishing-evidence.js';
function fixture({url='https://juejin.cn/editor/drafts/123',title='技术稿',body='第一段\n\n第二段',count,account='123',captcha=false,duplicate=false}={}){
 let focused=0;const el=(textContent,extra={})=>({textContent,getClientRects:()=>[{}],focus(){focused++},...extra});
 const titleEl=el('',{value:title}),textarea=el(''),lines=body.split('\n').map(v=>el(v||'\u200b'));
 const doc={querySelectorAll(s){
  if(s==='a.username[href]')return [el('',{href:'https://juejin.cn/user/'+account,querySelectorAll:()=>[el('本人')]} )];
  if(s==='input.title-input')return duplicate?[titleEl,titleEl]:[titleEl];
  if(s==='.CodeMirror textarea')return [textarea];
  if(s==='.CodeMirror-code')return [el('',{querySelectorAll:()=>lines})];
  if(s==='strong'){const n=count??lines.length;return [el(String(n),{parentElement:el('行数: '+n)})]}
  if(s.startsWith('iframe['))return captcha?[el('验证')]:[];return [];
 }};
 const context=vm.createContext({document:doc,location:new URL(url),URL,getComputedStyle:()=>({visibility:'visible'})});
 const article={title:'技术稿',text:'第一段\n\n第二段',html:'<p>第一段</p><p>第二段</p>'};
 return {article,run:(action,patch={})=>vm.runInContext('('+juejinPage.toString()+')',context)({action,article,accountId:'123',profileEvidence:{accountId:account,name:'本人',profileUrl:'https://juejin.cn/user/'+account},...patch}),get focused(){return focused}};
}
test('Juejin uses own creator profile, stops on switched identity and human verification',()=>{
 assert.equal(fixture({url:'https://juejin.cn/creator/home'}).run('account').accountId,'123');
 assert.ok(fixture().run('account').connectorError);
 assert.match(fixture({account:'124'}).run('fill').connectorError,/账号已变化/);
 assert.match(fixture({captcha:true}).run('identity').connectorError,/本人验证/);
 assert.match(fixture().run('identity',{profileEvidence:null}).connectorError,/账号证据/);
});
test('Juejin native insertion never overwrites original and includes AI disclosure',()=>{
 assert.match(fixture().run('fill').connectorError,/已有内容/);
 assert.equal(fixture({title:'',body:''}).run('fill').nativeInsertTitle,'技术稿');
 const f=fixture({body:''});assert.equal(f.run('fill-body',{article:{...f.article,ai:true}}).nativeInsertText,'第一段\n\n第二段\n\n本文包含 AI 辅助生成或整理的内容。');
 assert.match(fixture({title:'other',body:''}).run('fill-body').connectorError,/不匹配/);
});
test('Juejin receipt requires numbered re-opened full text with full line count',()=>{
 const f=fixture();assert.equal(f.run('draft-receipt'),null);
 const good=f.run('draft-receipt',{article:{...f.article,reopenedUrl:'https://juejin.cn/editor/drafts/123'}});assert.ok(draftEvidence('juejin',good));
 assert.equal(f.run('draft-receipt',{article:{...f.article,reopenedUrl:'https://juejin.cn/editor/drafts/124'}}),null);
 for(const opts of [{body:'第一段'},{count:10},{duplicate:true},{title:'different'}])assert.ok(fixture(opts).run('prepared').connectorError);
 assert.equal(fixture({url:PLATFORMS.juejin.editor}).run('draft-location'),null);
});
test('Juejin rejects unverified media, public actions, malformed destination and protocol upgrades',()=>{
 const f=fixture();for(const action of ['media','submit','preflight','receipt'])assert.match(f.run(action).connectorError,/尚未验收/);
 assert.ok(f.run('fill',{article:{...f.article,text:'![a](https://e.test/a.png)'}}).connectorError);
 assert.equal(PLATFORMS.juejin.publishSupported,false);assert.equal(publishingEvidence('juejin').publish.implemented,false);assert.equal(publishingEvidence('juejin').draft.liveAcceptance,'passed');
 const url='https://juejin.cn/editor/drafts/123',proof={url,articleId:'123',accountId:'123',savedVerified:true,contentVerified:true,verification:'reopened_content'};
 assert.equal(preparationEditorUrl('juejin',PLATFORMS.juejin.editor),PLATFORMS.juejin.editor);assert.equal(receiptEvidence('juejin',url,'123'),false);
 for(const bad of ['http://juejin.cn/editor/drafts/123',url+'?v=2',url+'#x',url.replace('juejin.cn','juejin.cn.evil.test'),url.replace('123','124'),PLATFORMS.juejin.editor])assert.equal(draftEvidence('juejin',{...proof,url:bad}),null);
 assert.equal(draftEvidence('juejin',{...proof,verification:'toast'}),null);
 assert.equal(editorEvidence('juejin',PLATFORMS.juejin.editor),true);assert.equal(navigationAllowed('juejin','https://evil.test'),false);
});

test('Juejin exact login route is detected without interpreting article text or another host',()=>{assert.equal(loginPageRequired('juejin','https://juejin.cn/login?to=https%3A%2F%2Fjuejin.cn%2Feditor%2Fdrafts%2Fnew'),true);for(const u of ['https://juejin.cn/editor/drafts/123','https://juejin.cn.evil.test/login','http://juejin.cn/login'])assert.equal(loginPageRequired('juejin',u),false);});
