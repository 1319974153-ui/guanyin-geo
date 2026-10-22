import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {csdnPage} from '../browser-extension/csdn.js';
function fixture(options={}){
 let title='测试文章',html='<p>正文</p>',clicks=0,draftClicks=0,account='author',captcha=false,dirty=false,selected=['软件测试'];
 class Input{get value(){return this.tagInput?this.tagValue:title}set value(v){if(this.tagInput)this.tagValue=v;else title=v}getClientRects(){return[{}]}getBoundingClientRect(){return{top:options.scrolled?-500:100,bottom:options.scrolled?-460:140}}dispatchEvent(){}}
 class Textarea extends Input{get value(){return title}set value(v){title=v}}
 let tagsOpen=false,dropdownOpen=false,declaration=options.declaration||'无声明',tagWrites=0;
 const shown={getClientRects:()=>[{}]};
 const tagInput=new Input();tagInput.tagInput=true;tagInput.placeholder='请输入文字搜索，Enter键入可添加自定义标签';tagInput.dispatchEvent=e=>{if(e.type==='keydown'&&e.key==='Enter'){tagWrites++;if(!options.rejectTag)selected.push(tagInput.value)}};
 const selection={...shown,get textContent(){return declaration},click(){dropdownOpen=true}};
 const combo={closest:()=>selection};
 const declarationLabel={...shown,textContent:'创作声明',parentElement:{querySelectorAll:()=>[combo],parentElement:null}};
 const multiRadio={checked:true,closest:()=>({textContent:'是'})};
 const multiLabel={...shown,textContent:'多平台发布',parentElement:{querySelectorAll:selector=>selector.includes('type="radio"')?[multiRadio]:[],parentElement:null}};
 const titleEl=new Textarea();const button={getClientRects:()=>[{}],textContent:'发布博客',click:()=>clicks++};
 const editor={status:'ready',getData:()=>html,setData:(v,opts)=>{html=v;opts.callback()}};
 const document={querySelector(selector){if(selector.startsWith('#txtTitle'))return titleEl;if(selector.startsWith('iframe[src'))return captcha?{}:null;if(selector==='.el_mcm-form-item.is-error')return dirty?{}:null;return null},querySelectorAll(selector){
  if(selector.includes('passport.csdn.net/login'))return options.visibleLogin?[{getClientRects:()=>[{}]}]:[{getClientRects:()=>[]}];
  if(selector.startsWith('#csdn-toolbar'))return options.modernHeader?[]:[{href:'https://blog.csdn.net/'+account,textContent:options.identityText??'作者',title:options.identityTitle??'',getClientRects:()=>[{}]}];
  if(selector.startsWith('a[href^='))return options.modernHeader?(options.avatars||[{}]).map(a=>({href:'https://blog.csdn.net/'+(a.account||account),textContent:'',getClientRects:()=>a.hidden?[]:[{}],closest:()=>a.insideContent?{}:null,querySelector:()=>a.noAvatar?null:{},compareDocumentPosition:()=>a.afterTitle?2:4,getBoundingClientRect:()=>({top:20,bottom:a.belowTitle?250:50})})):[];
  if(selector==='label,span,div')return [...(options.modernDeclaration?[declarationLabel,...(options.ambiguousDeclaration?[{...declarationLabel,parentElement:{querySelectorAll:()=>[{closest:()=>selection}]}}]:[])]:[]),...(options.multiPlatform?[multiLabel]:[])];
  if(selector==='input:checked')return options.gitCode?[{closest:()=>({textContent:'备份到 GitCode'})}]:[];
  if(selector==='input')return tagsOpen?[tagInput]:[];
  if(selector==='.tag__btn-tag')return [{...shown,textContent:'添加文章标签',click(){tagsOpen=true}}];
  if(selector==='[role="option"],li')return dropdownOpen?[{...shown,textContent:'部分内容由AI辅助生成',click(){declaration='部分内容由AI辅助生成';dropdownOpen=false}}]:[];
  if(selector==='.edit-tip-box .autosave-tip')return(options.savedStatus||[]).map(textContent=>({...shown,textContent,closest:()=>options.statusInBody?{}:null}));
  if(selector==='.btn-outline-secondary')return Array.from({length:options.draftButtons??1},()=>({...shown,textContent:'保存草稿',disabled:options.disabledDraft,click:()=>draftClicks++}));
  if(selector==='.btn-outline-danger')return[button];if(selector.includes('.is-closable'))return selected.map(textContent=>({...shown,textContent}));return[];
 }};
 class Parser{parseFromString(value){return{body:{textContent:value.replace(/<[^>]*>/g,''),querySelectorAll:()=>[]},querySelectorAll:()=>[]}}}
 const context=vm.createContext({URL,Node:{DOCUMENT_POSITION_FOLLOWING:4},document,location:{origin:'https://mp.csdn.net',pathname:'/mp_blog/creation/editor',search:''},CKEDITOR:{instances:{one:editor}},DOMParser:Parser,HTMLTextAreaElement:Textarea,HTMLInputElement:Input,Event:class{constructor(type,values){this.type=type;Object.assign(this,values)}},KeyboardEvent:class{constructor(type,values){this.type=type;Object.assign(this,values)}},setTimeout,clearTimeout});
 const raw=(action,patch={})=>vm.runInContext('('+csdnPage.toString()+')',context)({action,accountId:'author',article:{title:'测试文章',html:'<p>正文</p>',tags:['软件测试'],ai:false},...patch});
 const run=async(action,patch={})=>{const result=await raw(action,patch);if(result?.connectorError)throw new Error(result.connectorError);return result};
 return {raw,run,context,get tagWrites(){return tagWrites},get declaration(){return declaration},get clicks(){return clicks},get draftClicks(){return draftClicks},setAccount:v=>account=v,setHtml:v=>html=v,setTitle:v=>title=v,setCaptcha:v=>captcha=v,setTags:v=>selected=v,setDirty:v=>dirty=v};
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
 const m=JSON.parse(fs.readFileSync(new URL('../browser-extension/manifest.json',import.meta.url)));assert.deepEqual(m.optional_host_permissions,['http://127.0.0.1/*','https://mp.csdn.net/*','https://mp.toutiao.com/*','https://zhuanlan.zhihu.com/*','https://www.zhihu.com/*','https://creator.douyin.com/*','https://creator.xiaohongshu.com/*']);assert.deepEqual(m.permissions,['storage','scripting','alarms']);assert.equal(m.content_scripts,undefined);assert.equal(m.externally_connectable,undefined);assert.equal(m.host_permissions,undefined);
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

const aiArticle={title:'测试文章',html:'<p>正文</p>',tags:['软件测试'],ai:true};
test('CSDN current tag popup and declaration select configure only requested metadata without submitting',async()=>{
 const f=fixture({modernDeclaration:true});f.setTitle('');f.setHtml('');f.setTags([]);
 assert.equal((await f.run('fill',{article:aiArticle})).prepared,true);assert.equal(f.tagWrites,1);assert.equal(f.declaration,'部分内容由AI辅助生成');assert.equal(f.clicks,0);
 assert.equal((await f.run('preflight',{article:aiArticle})).ready,true);assert.equal(f.clicks,0);
});
test('CSDN declaration checks selected text, not an unselected dropdown option or an ambiguous field',async()=>{
 for(const options of [{modernDeclaration:true},{modernDeclaration:true,ambiguousDeclaration:true,declaration:'部分内容由AI辅助生成'}]){
  const f=fixture(options);await assert.rejects(f.run('submit',{article:aiArticle}),/AI/);assert.equal(f.clicks,0);
 }
 const selected=fixture({modernDeclaration:true,declaration:'部分内容由AI辅助生成'});assert.equal((await selected.run('preflight',{article:aiArticle})).ready,true);
});
test('CSDN does not report metadata ready when the platform rejects a tag, and preserves the body',async()=>{
 const f=fixture({rejectTag:true});f.setTitle('');f.setHtml('');f.setTags([]);await assert.rejects(f.run('fill'),/平台未确认标签/);assert.equal(f.tagWrites,1);assert.equal(f.clicks,0);assert.equal((await f.run('prepared')).contentVerified,true);
});
test('CSDN publish cannot enable GitCode signup or its separate multi-platform service',async()=>{
 for(const [options,error] of [[{gitCode:true},/GitCode/],[{multiPlatform:true},/CSDN 多平台发布/]]){const f=fixture(options);await assert.rejects(f.run('submit'),error);assert.equal(f.clicks,0)}
});

test('CSDN fixed header identity survives metadata scrolling without accepting article or lower-page avatars',async()=>{
 const f=fixture({modernHeader:true,scrolled:true});assert.equal((await f.run('prepared')).accountId,'author');assert.equal(f.clicks,0);
 for(const avatars of [[{insideContent:true}],[{afterTitle:true}],[{belowTitle:true}]]){const invalid=fixture({modernHeader:true,scrolled:true,avatars});await assert.rejects(invalid.run('identity'),/唯一/)}
});


test('CSDN draft save clicks only the unique draft control once and never publishes',async()=>{
 const f=fixture();assert.equal((await f.run('save-draft')).attempted,true);assert.equal(f.draftClicks,1);assert.equal(f.clicks,0);
 await assert.rejects(f.run('save-draft'),/已尝试保存/);assert.equal(f.draftClicks,1);
});
test('CSDN draft save stops on changed identity/content, captcha, AI declaration or side effects',async()=>{
 for(const [change,message] of [[f=>f.setAccount('other'),/账号已切换/],[f=>f.setHtml('<p>changed</p>'),/正文已变化/],[f=>f.setCaptcha(true),/本人验证/]]){
  const f=fixture();change(f);await assert.rejects(f.run('save-draft'),message);assert.equal(f.draftClicks,0);assert.equal(f.clicks,0);
 }
 for(const options of [{gitCode:true},{multiPlatform:true},{draftButtons:0},{draftButtons:2},{disabledDraft:true}]){const f=fixture(options);await assert.rejects(f.run('save-draft'));assert.equal(f.draftClicks,0);assert.equal(f.clicks,0)}
 const f=fixture();await assert.rejects(f.run('save-draft',{article:aiArticle}),/AI/);assert.equal(f.draftClicks,0);
});
test('CSDN saved editor receipt requires platform timestamp plus exact account, content and ID',async()=>{
 const f=fixture({savedStatus:['草稿已保存 10:07:27']});f.context.location.pathname='/mp_blog/creation/editor/168559842';
 const r=await f.run('draft-receipt');assert.equal(r.articleId,'168559842');assert.equal(r.savedVerified,true);assert.equal(r.url,'https://mp.csdn.net/mp_blog/creation/editor/168559842');
 assert.equal((await f.run('prepared')).contentVerified,true);assert.equal((await f.run('identity')).accountId,'author');
 for(const action of ['fill','submit','save-draft'])await assert.rejects(f.run(action),/全新编辑页/);
 f.setHtml('<p>changed</p>');await assert.rejects(f.run('draft-receipt'),/正文已变化/);f.setHtml('<p>正文</p>');f.setAccount('other');await assert.rejects(f.run('draft-receipt'),/账号已切换/);
 assert.equal(f.clicks,0);assert.equal(f.draftClicks,0);
});
test('CSDN draft receipt rejects bare URL, saving, failed, spoofed or ambiguous status',async()=>{
 for(const options of [{},{savedStatus:['保存中']},{savedStatus:['草稿已保存 99:99:99']},{savedStatus:['保存失败']},{savedStatus:['草稿已保存 10:07:27','草稿已保存 10:07:28']},{savedStatus:['草稿已保存 10:07:27'],statusInBody:true}]){
  const f=fixture(options);f.context.location.pathname='/mp_blog/creation/editor/123';assert.equal(await f.run('draft-receipt'),null);
 }
 const f=fixture({savedStatus:['草稿已保存 10:07:27']});assert.equal(await f.run('draft-receipt'),null);
});


test('CSDN may save its just-filled draft after platform autosave assigns an editor ID',async()=>{
 const f=fixture();f.setTitle('');f.setHtml('');await f.run('fill');f.context.location.pathname='/mp_blog/creation/editor/123';
 assert.equal((await f.run('save-draft')).attempted,true);assert.equal(f.draftClicks,1);assert.equal(f.clicks,0);
});

test('CSDN reopened draft requires a matching draft-list receipt and complete content',async()=>{
 const f=fixture();f.context.location.pathname='/mp_blog/creation/editor/123';
 const evidence={url:'https://mp.csdn.net/mp_blog/creation/editor/123',articleId:'123',accountId:'author',draftListed:true};
 const article={title:'测试文章',html:'<p>正文</p>',verifiedDraftList:evidence};
 const r=await f.run('draft-receipt',{article});assert.equal(r.verification,'draft_list_and_reopened_content');assert.equal(f.draftClicks,0);
 for(const patch of [{articleId:'124'},{accountId:'other'},{draftListed:false},{url:evidence.url+'?fake=1'}])assert.equal(await f.run('draft-receipt',{article:{...article,verifiedDraftList:{...evidence,...patch}}}),null);
 f.setHtml('<p>changed</p>');await assert.rejects(f.run('draft-receipt',{article}),/正文/);
});

function listFixture({owner='author',ids=['123'],draft=true}={}){
 let clicks=0;const shown={getClientRects:()=>[{}]};
 const tab={...shown,textContent:'草稿箱(10)',getAttribute:()=> 'false',click(){clicks++}};
 const avatar={...shown,href:'https://blog.csdn.net/'+owner,querySelector:()=>({}),closest:()=>null,getBoundingClientRect:()=>({bottom:80})};
 const links=ids.map(id=>{const a={...shown,href:'https://mp.csdn.net/mp_blog/creation/editor/'+id,textContent:'验收稿'};a.parentElement={textContent:draft?'验收稿 草稿2026-10-22 12:01:15':'验收稿 已发布',querySelectorAll:()=>[a],parentElement:null};return a});
 const document={querySelectorAll:s=>s==='[role="tab"]'?[tab]:s==='a[href]'?links:s.startsWith('a[href^=')?[avatar]:[]};
 const context=vm.createContext({URL,document,location:{origin:'https://mp.csdn.net',pathname:'/mp_blog/manage/article'}});
 return {get clicks(){return clicks},run:action=>vm.runInContext('('+csdnPage.toString()+')',context)({action,accountId:'author',article:{title:'验收稿'}})};
}
test('CSDN list recovery accepts only one matching draft ID in the correct account',async()=>{
 const f=listFixture();assert.equal((await f.run('draft-list-select')).selected,true);assert.equal(f.clicks,1);assert.equal((await f.run('draft-list-inspect')).articleId,'123');assert.equal(f.clicks,1);
 for(const opts of [{owner:'other'},{ids:['123','124']},{draft:false},{ids:[]}]){const bad=listFixture(opts);assert.ok((await bad.run('draft-list-inspect')).connectorError);assert.equal(bad.clicks,0);}
});
