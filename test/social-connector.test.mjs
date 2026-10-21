import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {socialPage} from '../browser-extension/social-page.js';
import {PLATFORMS,editorEvidence,receiptEvidence,draftEvidence,preparationEvidence} from '../browser-extension/platforms.js';
function fixture(platform,options={}){
 let clicks=0,account='author',captcha=false,title='测试文章',body='测试正文';
 const element=(value,extra={})=>({textContent:value,innerText:value,getClientRects:()=>[{}],getAttribute:()=>null,querySelector:()=>null,focus(){},...extra});
 const titleEl=element('',{get value(){return title},tagName:'INPUT'});Object.defineProperty(titleEl,'value',{get:()=>title});
 const bodyEl=element('',{querySelector:s=>options.placeholder&&s.startsWith('span.syl-placeholder')?{}:null,cloneNode(){
  let value=body;return {get textContent(){return value},querySelectorAll:s=>s==='span.syl-placeholder.ProseMirror-widget[ignoreel="true"][contenteditable="false"]'?[element(options.placeholderText||'请输入正文',{remove(){value=value.replace(options.placeholderText||'请输入正文','')}})]:[]};
 }});Object.defineProperty(bodyEl,'innerText',{get:()=>body});
 const button=element(platform==='toutiao'?'预览并发布':'发布',{click:()=>clicks++});
 const doc={querySelectorAll(s){
  if(s.includes('captcha')||s.includes('验证码'))return captcha?[element('本人验证')]:[];
  if(s==='.DraftStatusTip'||s==='.footer-draft-save .footer-tip-save')return (options.savedStatus||[]).map(v=>element(v,{closest:()=>options.statusInBody?bodyEl:null}));
  if(s==='a[href]')return [element('本人',{href:platform==='toutiao'?'https://toutiao.com/c/user/'+account+'/':(options.profileUrl||'https://www.zhihu.com/people/'+account),closest:()=>null})];
  if(s.startsWith('header,'))return [element((platform==='douyin'?'抖音号：':'小红书号：')+account)];
  if(s==='button,[role="button"]')return[button];
  if(s.startsWith('.image-item img'))return[element('图片')];
  if(s==='div,span')return options.restoredDraft?[element('你还有上次未发布的图文，是否继续编辑？')]:[];
  if(s.includes('placeholder')&&s.includes('标题'))return options.wrappedTitle&&s.split(',').some(x=>x.trim()==='.WriteIndex-titleInput')?[element('标题外层'),titleEl]:[titleEl];
  if(s.includes('contenteditable'))return[bodyEl];
  return[];
 }};
 const u=new URL(PLATFORMS[platform].editor);
 const context=vm.createContext({URL,document:doc,location:{href:u.href,origin:u.origin,pathname:u.pathname},getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 1},DOMParser:class{parseFromString(h){return{body:{textContent:h.replace(/<[^>]+>/g,'')}}}}});
 const run=(action,patch={})=>vm.runInContext('('+socialPage.toString()+')',context)({platform,action,media:[{name:'fixture.png'}],article:{title:'测试文章',text:'测试正文',html:'<p>测试正文</p>',ai:false},accountId:platform==='toutiao'?'123':'author',...patch});
 if(platform==='toutiao')account='123';
 return {run,context,setTitle:v=>title=v,get clicks(){return clicks},setAccount:v=>account=v,setCaptcha:v=>captcha=v,setBody:v=>body=v};
}
test('new adapters fail closed on identity changes, edited body, AI disclosure and CAPTCHA before submit',async()=>{
 for(const platform of ['toutiao','zhihu','douyin','xiaohongshu']){
  for(const change of [f=>f.setAccount('other'),f=>f.setCaptcha(true),f=>f.setBody('被改动的正文')]){const f=fixture(platform);change(f);assert.ok((await f.run('submit')).connectorError,platform);assert.equal(f.clicks,0)}
  const ai=fixture(platform);assert.match((await ai.run('submit',{article:{title:'测试文章',text:'测试正文',html:'<p>测试正文</p>',ai:true}})).connectorError,/AI/);assert.equal(ai.clicks,0);
 }
});
test('an existing article or restored draft is never overwritten',async()=>{
 for(const p of ['toutiao','zhihu','douyin','xiaohongshu']){const f=fixture(p);assert.match((await f.run('fill')).connectorError,/已有内容/);assert.equal(f.clicks,0)}
});
test('editor and receipt evidence cannot cross origins, platform types or dashboard URLs',()=>{
 for(const p of Object.keys(PLATFORMS)){assert.ok(editorEvidence(p,PLATFORMS[p].editor));assert.equal(editorEvidence(p,'https://evil.example/'),false);assert.ok(!receiptEvidence(p,PLATFORMS[p].editor,'123'));}
 assert.ok(receiptEvidence('toutiao','https://www.toutiao.com/article/123/','123'));
 assert.ok(!receiptEvidence('toutiao','https://www.toutiao.com.evil.test/article/123/','123'));
 assert.ok(!receiptEvidence('zhihu','https://zhuanlan.zhihu.com/p/123','124'));
 assert.ok(receiptEvidence('douyin','https://www.douyin.com/note/123','123'));
 assert.ok(receiptEvidence('xiaohongshu','https://www.xiaohongshu.com/explore/0123456789abcdef01234567','0123456789abcdef01234567'));
});
test('success text or dashboard navigation alone never produces a fabricated article receipt',async()=>{
 for(const p of ['toutiao','zhihu','douyin','xiaohongshu']){const f=fixture(p);assert.equal(await f.run('receipt'),null);assert.equal(f.clicks,0)}
});

test('exact reviewed identity/body permits one submit attempt and never a second click',async()=>{
 for(const p of ['toutiao','zhihu','douyin','xiaohongshu']){const f=fixture(p);assert.equal((await f.run('identity')).editorReady,true);assert.equal((await f.run('preflight')).ready,true);assert.equal(f.clicks,0);assert.equal((await f.run('submit')).attempted,true);assert.equal(f.clicks,1);assert.match((await f.run('submit')).connectorError,/不会再点击/);assert.equal(f.clicks,1)}
});

test('paragraph and list boundaries match visible editor newlines',async()=>{
 const f=fixture('toutiao');f.setBody('第一段\n第二段\n第三段');const r=await f.run('preflight',{article:{title:'测试文章',text:'第一段\n第二段\n第三段',html:'<p>第一段</p><p>第二段<br>第三段</p>',ai:false}});assert.equal(r.ready,true);assert.equal(f.clicks,0);
});

test('Zhihu own-profile URLs tolerate the editor tracking parameter and bare host',async()=>{
 for(const host of ['www.zhihu.com','zhihu.com']){const f=fixture('zhihu',{profileUrl:'https://'+host+'/people/author?utm_source=article-pc-editor'});assert.equal((await f.run('identity')).accountId,'author')}
});
test('read-only editor diagnostics exclude user title and body content',async()=>{
 const f=fixture('toutiao');const r=await f.run('inspect');assert.equal(r.platform,'toutiao');assert.equal(r.bodyMatches,1);assert.equal(r.bodyVisibleChars[0],4);assert.ok(!JSON.stringify(r).includes('测试正文'));assert.ok(!JSON.stringify(r).includes('测试文章'));assert.equal(f.clicks,0);
});

test('Toutiao ignores only the observed non-editable placeholder widget without mutating it',async()=>{
 const f=fixture('toutiao',{placeholder:true});f.setTitle('');f.setBody('请输入正文');
 const r=await f.run('inspect');assert.equal(r.bodyContentChars[0],0);assert.equal(r.bodyVisibleChars[0],5);assert.equal(f.clicks,0);
 const mixed=fixture('toutiao',{placeholder:true});mixed.setTitle('');mixed.setBody('请输入正文 真正的草稿');
 assert.match((await mixed.run('fill')).connectorError,/已有内容/);assert.equal(mixed.clicks,0);
});
test('literal placeholder text and unrecognized widgets are still protected drafts',async()=>{
 for(const options of [{},{placeholder:true,placeholderText:'其他内容'}]){
  const f=fixture('toutiao',options);f.setTitle('');f.setBody(options.placeholderText||'请输入正文');
  assert.match((await f.run('fill')).connectorError,/已有内容/);assert.equal(f.clicks,0);
 }
});
test('Zhihu title wrapper does not make a ready editor ambiguous',async()=>{
 const f=fixture('zhihu',{wrappedTitle:true});assert.equal((await f.run('identity')).editorReady,true);
});
test('Douyin restored draft notice blocks identity, media and fill without discarding it',async()=>{
 for(const action of ['identity','media','fill','submit']){const f=fixture('douyin',{restoredDraft:true});assert.match((await f.run(action)).connectorError,/上次未发布/);assert.equal(f.clicks,0)}
});

test('read-only prepared checkpoints require matching identity and content, never clicks',async()=>{
 for(const p of ['toutiao','zhihu','douyin','xiaohongshu']){const f=fixture(p);const r=await f.run('prepared');assert.equal(r.contentVerified,true);assert.equal(f.clicks,0);f.setBody('变更后的正文');assert.match((await f.run('prepared')).connectorError,/正文已变化/);assert.equal(f.clicks,0)}
});

const savedDraft={url:'https://zhuanlan.zhihu.com/p/123/edit',articleId:'123',accountId:'author',contentVerified:true,savedVerified:true};
test('draft receipt requires saved status, exact draft ID, current account and content without publishing',async()=>{
 const f=fixture('zhihu',{savedStatus:['刚刚 · 草稿']});Object.assign(f.context.location,{pathname:'/p/123/edit',href:savedDraft.url});
 const r=await f.run('draft-receipt');assert.equal(r.savedVerified,true);assert.equal(r.articleId,'123');assert.equal(f.clicks,0);
 f.setBody('其他正文');assert.match((await f.run('draft-receipt')).connectorError,/不同/);f.setBody('测试正文');f.setAccount('other');assert.ok((await f.run('draft-receipt')).connectorError);assert.equal(f.clicks,0);
});
test('draft receipt rejects pending saves, ambiguous indicators and body spoofing',async()=>{
 for(const o of [{savedStatus:['草稿保存中']},{savedStatus:['保存失败']},{savedStatus:['刚刚 · 草稿','1 分钟前 · 草稿']},{savedStatus:['刚刚 · 草稿'],statusInBody:true},{}]){
  const f=fixture('zhihu',o);f.context.location.pathname='/p/123/edit';assert.equal(await f.run('draft-receipt'),null);assert.equal(f.clicks,0);
 }
 const blank=fixture('zhihu',{savedStatus:['刚刚 · 草稿']});assert.equal(await blank.run('draft-receipt'),null);
});
test('draft URL validation rejects public pages, mismatched IDs and cross-origin URLs',()=>{
 assert.ok(draftEvidence('zhihu',savedDraft));
 for(const patch of [{url:'https://zhuanlan.zhihu.com/p/123'},{url:savedDraft.url+'?a=1'},{url:'https://evil.test/p/123/edit'},{articleId:'124'},{savedVerified:false},{contentVerified:false}])assert.equal(draftEvidence('zhihu',{...savedDraft,...patch}),null);
 assert.equal(draftEvidence('csdn',savedDraft),null);
});


test('Toutiao preparation retains the observed draft ID without claiming platform storage',async()=>{
 const f=fixture('toutiao'),base=PLATFORMS.toutiao.editor;
 f.context.location.href=base+'?pgc_id=7698291175233323555&source=editor';
 const raw=await f.run('prepared'),result=preparationEvidence('toutiao',raw);
 assert.equal(result.editorUrl,base+'?pgc_id=7698291175233323555');
 assert.equal(result.savedVerified,undefined);assert.equal(f.clicks,0);
 for(const suffix of ['?pgc_id=1&pgc_id=2','?pgc_id=invalid','?pgc_id=0','?pgc_id=-12','#draft']){
  assert.equal(preparationEvidence('toutiao',{...raw,evidenceUrl:base+suffix}),null);
 }
 assert.equal(preparationEvidence('toutiao',{...raw,evidenceUrl:base}).editorUrl,base);
 f.setBody('changed');assert.match((await f.run('prepared')).connectorError,/正文已变化/);
});


test('Toutiao saved draft requires the observed footer status, ID, identity and exact content',async()=>{
 const f=fixture('toutiao',{savedStatus:['草稿已保存']});f.context.location.href=PLATFORMS.toutiao.editor+'?pgc_id=7698291175233323555';
 const r=await f.run('draft-receipt');assert.equal(r.savedVerified,true);assert.equal(r.articleId,'7698291175233323555');assert.equal(f.clicks,0);assert.ok(draftEvidence('toutiao',r));
 f.setBody('正文被改');assert.match((await f.run('draft-receipt')).connectorError,/不同/);f.setBody('测试正文');f.setAccount('999');assert.ok((await f.run('draft-receipt')).connectorError);assert.equal(f.clicks,0);
});
test('Toutiao draft status cannot come from body, saving-in-progress, duplicate labels or ambiguous ID',async()=>{
 for(const options of [{},{savedStatus:['草稿保存中...']},{savedStatus:['保存失败']},{savedStatus:['草稿已保存','草稿已保存']},{savedStatus:['草稿已保存'],statusInBody:true}]){
  const f=fixture('toutiao',options);f.context.location.href=PLATFORMS.toutiao.editor+'?pgc_id=123';assert.equal(await f.run('draft-receipt'),null);assert.equal(f.clicks,0);
 }
 for(const suffix of ['', '?pgc_id=1&pgc_id=2','?pgc_id=0','?pgc_id=abc','?pgc_id=1#other']){
  const f=fixture('toutiao',{savedStatus:['草稿已保存']});f.context.location.href=PLATFORMS.toutiao.editor+suffix;assert.equal(await f.run('draft-receipt'),null);
 }
});
test('Toutiao bridge receipt accepts only canonical editor URLs with the same durable ID',()=>{
 const r={...savedDraft,url:PLATFORMS.toutiao.editor+'?pgc_id=123'};assert.ok(draftEvidence('toutiao',r));
 for(const patch of [{url:PLATFORMS.toutiao.editor},{url:r.url+'&token=secret'},{url:r.url+'&pgc_id=123'},{url:r.url+'#x'},{url:'https://www.toutiao.com/article/123/'},{url:'https://evil.test/?pgc_id=123'},{articleId:'124'},{savedVerified:false},{contentVerified:false}])assert.equal(draftEvidence('toutiao',{...r,...patch}),null);
 assert.equal(draftEvidence('zhihu',r),null);
});
