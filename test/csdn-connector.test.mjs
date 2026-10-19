import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {csdnPage} from '../browser-extension/csdn.js';
function fixture(options={}){
 let title='测试文章',html='<p>正文</p>',clicks=0,account='author',captcha=false,dirty=false,selected=['软件测试'];
 class Input{get value(){return title}set value(v){title=v}getClientRects(){return[{}]}getBoundingClientRect(){return{top:100,bottom:140}}dispatchEvent(){}}
 class Textarea extends Input{get value(){return title}set value(v){title=v}}
 const titleEl=new Textarea();const button={getClientRects:()=>[{}],textContent:'发布博客',click:()=>clicks++};
 const editor={status:'ready',getData:()=>html,setData:(v,opts)=>{html=v;opts.callback()}};
 const document={querySelector(selector){if(selector.startsWith('#txtTitle'))return titleEl;if(selector.startsWith('iframe[src'))return captcha?{}:null;if(selector==='.el_mcm-form-item.is-error')return dirty?{}:null;return null},querySelectorAll(selector){
  if(selector.includes('passport.csdn.net/login'))return options.visibleLogin?[{getClientRects:()=>[{}]}]:[{getClientRects:()=>[]}];
  if(selector.startsWith('#csdn-toolbar'))return options.modernHeader?[]:[{href:'https://blog.csdn.net/'+account,textContent:options.identityText??'作者',title:options.identityTitle??'',getClientRects:()=>[{}]}];
  if(selector.startsWith('a[href^='))return options.modernHeader?(options.avatars||[{}]).map(a=>({href:'https://blog.csdn.net/'+(a.account||account),textContent:'',getClientRects:()=>a.hidden?[]:[{}],closest:()=>a.insideContent?{}:null,querySelector:()=>a.noAvatar?null:{},compareDocumentPosition:()=>a.afterTitle?2:4,getBoundingClientRect:()=>({bottom:a.belowTitle?200:50})})):[];
  if(selector==='.btn-outline-danger')return[button];if(selector.includes('.is-closable'))return selected.map(textContent=>({textContent}));return[];
 }};
 class Parser{parseFromString(value){return{body:{textContent:value.replace(/<[^>]*>/g,''),querySelectorAll:()=>[]},querySelectorAll:()=>[]}}}
 const context=vm.createContext({URL,Node:{DOCUMENT_POSITION_FOLLOWING:4},document,location:{origin:'https://mp.csdn.net',pathname:'/mp_blog/creation/editor',search:''},CKEDITOR:{instances:{one:editor}},DOMParser:Parser,HTMLTextAreaElement:Textarea,HTMLInputElement:Input,Event:class{},setTimeout,clearTimeout});
 const raw=(action,patch={})=>vm.runInContext('('+csdnPage.toString()+')',context)({action,accountId:'author',article:{title:'测试文章',html:'<p>正文</p>',tags:['软件测试'],ai:false},...patch});
 const run=async(action,patch={})=>{const result=await raw(action,patch);if(result?.connectorError)throw new Error(result.connectorError);return result};
 return {raw,run,context,get clicks(){return clicks},setAccount:v=>account=v,setHtml:v=>html=v,setTitle:v=>title=v,setCaptcha:v=>captcha=v,setTags:v=>selected=v,setDirty:v=>dirty=v};
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

test('avatar-only toolbar identity falls back to title or verified account ID after trimming',async()=>{
 for(const [options,expected] of [[{identityText:' \n ',identityTitle:' 温舒 '},'温舒'],[{identityText:' \n ',identityTitle:' '},'author'],[{identityText:'',identityTitle:''},'author']]){
  const f=fixture(options);const me=await f.run('identity');assert.equal(me.accountId,'author');assert.equal(me.name,expected);assert.equal(me.editorReady,true);assert.equal(f.clicks,0);
 }
});

test('page exceptions cross the Chrome injection boundary as explicit errors',async()=>{
 const f=fixture();f.setAccount('other');const result=await f.raw('identity');assert.match(result.connectorError,/账号已切换/);assert.equal(result.accountId,undefined);assert.equal(f.clicks,0);
});

test('current creator header can identify a visible avatar outside the legacy toolbar',async()=>{
 const f=fixture({modernHeader:true});const result=await f.run('identity');assert.equal(result.accountId,'author');assert.equal(result.name,'author');assert.equal(f.clicks,0);
});
test('identity rejects content links, hidden avatars, ambiguous accounts and visible login prompts',async()=>{
 for(const options of [{avatars:[{insideContent:true}]},{avatars:[{hidden:true}]},{avatars:[{noAvatar:true}]},{avatars:[{afterTitle:true}]},{avatars:[{belowTitle:true}]},{avatars:[{}, {account:'other'}]},{visibleLogin:true}]){
  const f=fixture({modernHeader:true,...options});await assert.rejects(f.run('identity'),/唯一的已登录账号/);assert.equal(f.clicks,0);
 }
});
