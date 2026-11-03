import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {socialPage} from '../browser-extension/social-page.js';
import {preparationEvidence,draftEvidence} from '../browser-extension/platforms.js';
const editorUrl='https://creator.douyin.com/creator-micro/content/post/image';
function fixture({changed=false,duplicate=false,challenge=false}={}){
 let saves=0,opens=0,prompt=false;
 const elem=(text,extra={})=>({textContent:text,innerText:text,getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,contains:()=>false,...extra});
 const location={origin:'https://creator.douyin.com',pathname:'/creator-micro/content/post/image',href:editorUrl};
 const title=elem('',{tagName:'INPUT',value:'测试原稿'}),body=elem('',{cloneNode:()=>({textContent:changed?'其他正文':'原稿正文',querySelectorAll:()=>[]})});
 const save=elem('暂存离开',{click(){saves++;prompt=true;location.pathname='/creator-micro/content/upload'}}),reopen=elem('继续编辑',{click(){opens++;prompt=false;location.pathname='/creator-micro/content/post/image'}});
 const document={querySelectorAll(s){
  if(s.includes('captcha'))return challenge?[elem('验证')]:[];
  if(s==='div,span')return prompt?[elem('你还有上次未发布的图文，是否继续编辑？')]:[];
  if(s==='button,[role="button"],div,span')return prompt?[reopen]:[];
  if(s==='button,[role="button"]')return duplicate?[save,save]:[save];
  if(s==='input[placeholder*="标题"]')return[title];if(s==='[contenteditable="true"]')return[body];return[];
 }};
 const context=vm.createContext({document,location,getComputedStyle:()=>({visibility:'visible'}),DOMParser:class{parseFromString(){return{body:{textContent:'原稿正文'}}}}});
 const run=action=>vm.runInContext('('+socialPage.toString()+')',context)({platform:'douyin',action,accountId:'21037695064',article:{title:'测试原稿',text:'原稿正文'},profileEvidence:{accountVerified:true,accountId:'21037695064',name:'温舒',evidenceUrl:'https://creator.douyin.com/creator-micro/home'}});
 return{run,get saves(){return saves},get opens(){return opens},location};
}
test('temporary save uses exact existing content, returns through explicit resume and never publishes',async()=>{
 const f=fixture();assert.equal((await f.run('temporary-save')).temporarySaveAttempted,true);assert.equal(f.saves,1);
 assert.match((await f.run('fill')).connectorError,/上次未发布/);
 assert.equal((await f.run('temporary-reopen')).reopenAttempted,true);assert.equal(f.opens,1);
 assert.equal((await f.run('prepared')).contentVerified,true);
 assert.match((await f.run('temporary-save')).connectorError,/重复点击/);assert.equal(f.saves,1);
});
test('changed text, ambiguous save and human challenge never click save',async()=>{
 for(const options of [{changed:true},{duplicate:true},{challenge:true}]){const f=fixture(options);assert.ok((await f.run('temporary-save')).connectorError);assert.equal(f.saves,0)}
});
test('temporary checkpoint is never a cloud draft or public receipt',()=>{
 const value={evidenceUrl:editorUrl,contentVerified:true,accountId:'a',temporaryVerified:true,verification:'temporary_reopened_content',mediaCount:2};
 assert.equal(preparationEvidence('douyin',value).temporaryVerified,true);assert.equal(draftEvidence('douyin',value),null);
 assert.equal(preparationEvidence('douyin',{...value,mediaCount:0}).temporaryVerified,undefined);
 assert.equal(preparationEvidence('zhihu',{...value,evidenceUrl:'https://zhuanlan.zhihu.com/write'}).temporaryVerified,undefined);
});
