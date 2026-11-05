import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {wechatPersonalPage} from '../desktop/wechat-personal-publisher.mjs';

const strip=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

class Input {
 constructor(value=''){this._value=value;this.tagName='INPUT';this.placeholder='文章标题';this.offsetParent={};}
 get value(){return this._value;}
 set value(value){this._value=String(value);}
 getClientRects(){return [{}];}
 getAttribute(){return null;}
 closest(){return null;}
 dispatchEvent(){}
}

class Editor {
 constructor(value=''){this.tagName='DIV';this.offsetParent={};this.innerHTML=value;}
 set innerHTML(value){this._html=String(value);this.innerText=strip(value);this.textContent=this.innerText;}
 get innerHTML(){return this._html;}
 getClientRects(){return [{}];}
 getAttribute(){return null;}
 closest(){return null;}
 dispatchEvent(){}
}

function notice(value){return {innerText:value,textContent:value,offsetParent:{},getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null};}

function fixture({title='',body='',notices=[],verification=[]}={}){
 const input=new Input(title),editor=new Editor(body);
 const document={
  querySelectorAll(selector){
   if(selector.startsWith('[role="alert"]'))return notices;
   if(selector.startsWith('input[placeholder*="验证码"]'))return verification;
   if(selector==='input,textarea')return [input];
   if(selector==='[contenteditable="true"],iframe')return [editor];
   return [];
  }
 };
 const context=vm.createContext({
  document,location:{hostname:'mp.weixin.qq.com'},HTMLInputElement:Input,HTMLTextAreaElement:Input,
  InputEvent:class {constructor(type,options){this.type=type;Object.assign(this,options)}},Event:class {constructor(type,options){this.type=type;Object.assign(this,options)}},
  getComputedStyle:()=>({display:'block',visibility:'visible'})
 });
 const run=command=>vm.runInContext('('+wechatPersonalPage.toString()+')('+JSON.stringify(command)+')',context);
 return {input,editor,run};
}

test('WeChat article text that mentions a successful publication is not mistaken for a platform receipt',async()=>{
 const f=fixture();
 const result=await f.run({title:'测试稿',html:'<p>发布成功前，需要先核对正文。</p>',mode:'publish',dispatch:false});
 assert.equal(result.state,'ready_to_request');
 assert.equal(f.input.value,'测试稿');
 assert.equal(f.editor.innerText,'发布成功前，需要先核对正文。');
});

test('WeChat accepts a visible official status notice as a terminal result',async()=>{
 const f=fixture({notices:[notice('发布成功')]});
 const result=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'publish',dispatch:false});
 assert.equal(result.state,'publish_submitted');
});

test('WeChat never overwrites a different retained title or body',async()=>{
 const title=factory({title:'平台中的旧标题'});
 const titleResult=await title.run({title:'新的标题',html:'<p>新的正文</p>',mode:'draft',dispatch:false});
 assert.equal(titleResult.state,'blocked');
 assert.match(titleResult.message,/不同标题/);
 assert.equal(title.input.value,'平台中的旧标题');

 const body=factory({body:'<p>平台中的旧正文</p>'});
 const bodyResult=await body.run({title:'新的标题',html:'<p>新的正文</p>',mode:'draft',dispatch:false});
 assert.equal(bodyResult.state,'blocked');
 assert.match(bodyResult.message,/不同正文/);
 assert.equal(body.editor.innerText,'平台中的旧正文');
});

test('WeChat requires a real verification control or a visible notice, not article text',async()=>{
 const f=fixture({verification:[notice('验证码输入')]});
 const result=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'draft',dispatch:false});
 assert.equal(result.state,'verification_required');
});

function factory(options){return fixture(options);}
