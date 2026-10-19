import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {csdnPage} from '../browser-extension/csdn.js';
function fixture(){
 let title='测试文章',html='<p>正文</p>',clicks=0,account='author',captcha=false,dirty=false,selected=['软件测试'];
 class Input{get value(){return title}set value(v){title=v}getClientRects(){return[{}]}dispatchEvent(){}}
 class Textarea extends Input{get value(){return title}set value(v){title=v}}
 const titleEl=new Textarea();const button={getClientRects:()=>[{}],textContent:'发布博客',click:()=>clicks++};
 const editor={status:'ready',getData:()=>html,setData:(v,opts)=>{html=v;opts.callback()}};
 const document={querySelector(selector){if(selector.startsWith('#txtTitle'))return titleEl;if(selector.startsWith('iframe[src'))return captcha?{}:null;if(selector==='.el_mcm-form-item.is-error')return dirty?{}:null;return null},querySelectorAll(selector){
  if(selector.startsWith('#csdn-toolbar'))return [{href:'https://blog.csdn.net/'+account,textContent:'作者'}];
  if(selector==='.btn-outline-danger')return[button];if(selector.includes('.is-closable'))return selected.map(textContent=>({textContent}));return[];
 }};
 class Parser{parseFromString(value){return{body:{textContent:value.replace(/<[^>]*>/g,''),querySelectorAll:()=>[]},querySelectorAll:()=>[]}}}
 const context=vm.createContext({URL,document,location:{origin:'https://mp.csdn.net',pathname:'/mp_blog/creation/editor',search:''},CKEDITOR:{instances:{one:editor}},DOMParser:Parser,HTMLTextAreaElement:Textarea,HTMLInputElement:Input,Event:class{},setTimeout,clearTimeout});
 const run=(action,patch={})=>vm.runInContext('('+csdnPage.toString()+')',context)({action,accountId:'author',article:{title:'测试文章',html:'<p>正文</p>',tags:['软件测试'],ai:false},...patch});
 return {run,context,get clicks(){return clicks},setAccount:v=>account=v,setHtml:v=>html=v,setTitle:v=>title=v,setCaptcha:v=>captcha=v,setTags:v=>selected=v,setDirty:v=>dirty=v};
}
test('CSDN publisher clicks once only after exact identity, body and tags match',async()=>{
 const f=fixture();assert.equal((await f.run('preflight')).ready,true);assert.equal(f.clicks,0);await f.run('submit');assert.equal(f.clicks,1);await assert.rejects(f.run('submit'),/已尝试/);assert.equal(f.clicks,1);
});
test('CSDN refuses wrong accounts, edited content, missing tags, CAPTCHA and form errors before clicking',async()=>{
 for(const [change,message] of [[f=>f.setAccount('other'),/账号已切换/],[f=>f.setHtml('<p>被修改的正文</p>'),/正文已变化/],[f=>f.setTags([]),/标签/],[f=>f.setCaptcha(true),/本人验证/],[f=>f.setDirty(true),/必填/]]){const f=fixture();change(f);await assert.rejects(f.run('submit'),message);assert.equal(f.clicks,0)}
});
test('CSDN never overwrites a restored draft, and filling does not publish',async()=>{
 const f=fixture();await assert.rejects(f.run('fill'),/已有内容/);f.setTitle('');f.setHtml('');assert.equal((await f.run('fill')).prepared,true);assert.equal(f.clicks,0);
});
test('CSDN requires explicit AI disclosure and rejects existing article editor URLs',async()=>{
 const f=fixture();await assert.rejects(f.run('submit',{article:{title:'测试文章',html:'<p>正文</p>',tags:['软件测试'],ai:true}}),/AI/);f.context.location.search='?id=existing';await assert.rejects(f.run('fill'),/全新编辑页/);assert.equal(f.clicks,0);
});
test('CSDN success is parsed from actual page and does not fabricate a public URL',async()=>{
 const f=fixture();assert.equal(await f.run('receipt'),null);f.context.location.pathname='/mp_blog/creation/success/123456';const receipt=await f.run('receipt');assert.equal(receipt.articleId,'123456');assert.equal(receipt.url,'https://mp.csdn.net/mp_blog/creation/success/123456');assert.equal(receipt.state,'submitted');
});
test('extension permissions stay opt-in and do not request cookies, all-sites, or history',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../browser-extension/manifest.json',import.meta.url)));assert.deepEqual(m.optional_host_permissions,['http://127.0.0.1/*','https://mp.csdn.net/*']);assert.deepEqual(m.permissions,['storage','scripting','alarms']);assert.equal(m.content_scripts,undefined);assert.equal(m.externally_connectable,undefined);assert.equal(m.host_permissions,undefined);
});
