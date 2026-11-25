import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {wechatPersonalLoginPage,wechatPersonalPage} from '../desktop/wechat-personal-publisher.mjs';

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
function control(value){let clicks=0;return {innerText:value,textContent:value,offsetParent:{},getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,click:()=>clicks++,get clicks(){return clicks}};}

function fixture({title='',body='',notices=[],verification=[],controls=[],extraInputs=0,extraEditors=0,frames=[],includeEditor=true}={}){
 const input=new Input(title),editor=new Editor(body);
 const document={
  querySelectorAll(selector){
   if(selector.startsWith('[role="alert"]'))return notices;
   if(selector.startsWith('input[placeholder*="验证码"]'))return verification;
   if(selector==='button,a,[role="button"]')return controls;
   if(selector==='input,textarea')return [input,...Array.from({length:extraInputs},()=>new Input())];
   if(selector==='[contenteditable="true"],[contenteditable="plaintext-only"],iframe')return [...(includeEditor?[editor]:[]),...frames,...Array.from({length:extraEditors},()=>new Editor())];
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

function loginFixture({controls=[],verification=[]}={}){
 const document={querySelectorAll(selector){
  if(selector.startsWith('input[placeholder*="验证码"]'))return verification;
  if(selector==='button,a,[role="button"]')return controls;
  return [];
 }};
 const context=vm.createContext({document,location:{hostname:'mp.weixin.qq.com',origin:'https://mp.weixin.qq.com'},getComputedStyle:()=>({display:'block',visibility:'visible'})});
 return ()=>vm.runInContext('('+wechatPersonalLoginPage.toString()+')()',context);
}

test('WeChat article text that mentions a successful publication is not mistaken for a platform receipt',async()=>{
 const f=fixture();
 const result=await f.run({title:'测试稿',html:'<p>发布成功前，需要先核对正文。</p>',mode:'publish',dispatch:false});
 assert.equal(result.state,'ready_to_request');
 assert.equal(f.input.value,'测试稿');
 assert.equal(f.editor.innerText,'发布成功前，需要先核对正文。');
});

test('WeChat accepts a visible official status notice only after its original action was recorded',async()=>{
 const f=fixture({title:'测试稿',body:'正文',notices:[notice('发布成功')]});
 const initial=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'publish',dispatch:false,requested:false});
 assert.equal(initial.state,'waiting_editor');
 const result=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'publish',dispatch:false,requested:true});
 assert.equal(result.state,'publish_submitted');
});

test('WeChat ignores ambiguous success notices and never clicks an ambiguous final action',async()=>{
 const notices=fixture({notices:[notice('发布成功'),notice('发布成功')]});
 const observed=await notices.run({title:'测试稿',html:'<p>正文</p>',mode:'publish',dispatch:false,requested:true});
 assert.equal(observed.state,'waiting_receipt');
 const first=control('保存草稿'),second=control('保存草稿');
 const f=fixture({controls:[first,second]});
 const result=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'draft',dispatch:true,requested:false});
 assert.equal(result.state,'filled');
 assert.match(result.message,/唯一/);assert.equal(first.clicks,0);assert.equal(second.clicks,0);
});

test('WeChat does not guess which of multiple visible editor fields should receive an original task',async()=>{
 const f=fixture({extraInputs:1});
 const result=await f.run({title:'测试稿',html:'<p>正文</p>',mode:'draft',dispatch:false});
 assert.equal(result.state,'waiting_editor');assert.match(result.message,/字段不唯一/);assert.equal(f.input.value,'');assert.equal(f.editor.innerText,'');
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
test('requested and observation-only recovery never creates or refills a platform editor',()=>{
 for(const flags of [{requested:true},{observeOnly:true}]){
  const create=control('新建图文'),publish=control('发布'),f=fixture({controls:[create,publish]});
  const result=f.run({title:'恢复稿',html:'<p>恢复正文</p>',mode:'publish',dispatch:true,...flags});
  assert.ok(['waiting_receipt','blocked'].includes(result.state));assert.equal(f.input.value,'');assert.equal(f.editor.innerText,'');assert.equal(create.clicks,0);assert.equal(publish.clicks,0);
 }
});

test('WeChat login becomes available only after a visible official dashboard control, and verification keeps it pending',()=>{
 const pending=loginFixture();assert.equal(pending().state,'waiting_login');
 const connected=loginFixture({controls:[notice('新建图文')]});assert.deepEqual({...connected()},{state:'connected',message:'已进入公众号官方管理页；登录状态仅保存在本机'});
 const verification=loginFixture({controls:[notice('新建图文')],verification:[notice('验证码')]});assert.equal(verification().state,'waiting_login');
});

function factory(options){return fixture(options);}

test('a different retained body blocks before an empty title changes; the exact visible receipt is retained',()=>{
 const f=fixture({body:'原有内容'});assert.equal(f.run({title:'稿件',html:'<p>新稿</p>',mode:'draft'}).state,'blocked');assert.equal(f.input.value,'');
 const received=fixture({title:'稿件',body:'新稿',notices:[notice('已群发')]}).run({title:'稿件',html:'<p>新稿</p>',mode:'publish',requested:true});
 assert.equal(received.receipt.notice,'已群发');assert.equal(received.receipt.url,undefined);
});

test('a saved marker and an unrelated dashboard toast do not prove this article was published',()=>{assert.equal(fixture({notices:[notice('发布成功')]}).run({title:'指定稿',html:'<p>本篇正文</p>',mode:'publish',requested:true}).state,'waiting_receipt')});

test('media and inaccessible frames are ignored and an explicitly editable iframe can save the draft',()=>{
 const frame=doc=>Object.assign(new Editor(),{tagName:'IFRAME',contentDocument:doc});
 const media=frame({body:new Editor('媒体预览')});
 const foreign=frame(null);Object.defineProperty(foreign,'contentDocument',{get(){throw Error('cross-origin')}});
 const editable=frame({body:new Editor(),designMode:'on'});
 const f=fixture({frames:[media,foreign,editable],includeEditor:false});
 const result=f.run({title:'草稿',html:'<p>需要保存的正文</p>',mode:'draft'});
 assert.equal(result.state,'ready_to_request');
 assert.equal(media.contentDocument.body.innerText,'媒体预览');
 assert.equal(editable.contentDocument.body.innerText,'需要保存的正文');
});

test('a visible verification iframe pauses the original operation before any editing or click',()=>{
 const verify={...notice(''),tagName:'IFRAME',closest:selector=>selector.split(',').includes('iframe')?verify:null};
 const save=control('保存草稿'),f=fixture({verification:[verify],controls:[save]});
 assert.equal(f.run({title:'草稿',html:'<p>正文</p>',mode:'draft',dispatch:true}).state,'verification_required');
 assert.equal(save.clicks,0);assert.equal(f.input.value,'');
});
