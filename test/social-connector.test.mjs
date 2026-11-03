import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {socialPage} from '../browser-extension/social-page.js';
import {PLATFORMS,editorEvidence,receiptEvidence,draftEvidence,preparationEvidence} from '../browser-extension/platforms.js';
function fixture(platform,options={}){
 let clicks=0,draftOpens=0,account='author',captcha=false,title='测试文章',body='测试正文';
 const element=(value,extra={})=>({textContent:value,innerText:value,getClientRects:()=>[{}],getAttribute:()=>null,querySelector:()=>null,closest:()=>null,focus(){},...extra});
 const titleEl=element('',{get value(){return title},tagName:'INPUT'});Object.defineProperty(titleEl,'value',{get:()=>title});
 const bodyEl=element('',{querySelector:s=>options.placeholder&&s.startsWith('span.syl-placeholder')?{}:null,cloneNode(){
  let value=body;return {get textContent(){return value},querySelectorAll:s=>s==='span.syl-placeholder.ProseMirror-widget[ignoreel="true"][contenteditable="false"]'?[element(options.placeholderText||'请输入正文',{remove(){value=value.replace(options.placeholderText||'请输入正文','')}})]:[]};
 }});Object.defineProperty(bodyEl,'innerText',{get:()=>body});
 const button=element(platform==='toutiao'?'预览并发布':'发布',{tagName:'BUTTON',value:'',click:()=>clicks++});
 let declaration='无声明';const combo=element('',{tagName:'BUTTON',value:'',get textContent(){return declaration},get innerText(){return declaration},click(){}});
 Object.defineProperties(combo,{textContent:{get:()=>declaration},innerText:{get:()=>declaration}});
 const doc={querySelectorAll(s){
  if(s==='[role="combobox"]')return options.aiCombo?[combo]:[];
  if(s==='[role="option"],li')return options.aiCombo?Array.from({length:options.duplicateAI?2:1},()=>element(options.aiResponsibility?'包含 AI 辅助创作 作者对内容负责':'包含 AI 辅助创作',{click(){declaration='包含 AI 辅助创作'}})):[];
  if(s==='[role="alert"],[role="status"],[class*="message"],[class*="toast"]')return options.saveFailure?[element('保存失败',{closest:()=>options.failureInBody?bodyEl:null})]:[];
  if(s.includes('captcha')||s.includes('验证码'))return captcha?[element('本人验证')]:[];
  if(s==='.DraftStatusTip'||s==='.footer-draft-save .footer-tip-save')return (options.savedStatus||[]).map(v=>element(v,{closest:()=>options.statusInBody?bodyEl:null}));
  if(s==='main a.title')return (options.listTitles||[]).map(v=>element(v,{click:()=>draftOpens++}));
  if(s==='[aria-label^="点击打开"][aria-label$="的主页"]')return (options.profileLabels||[]).map(label=>element('',{getAttribute:()=>label,closest:()=>null}));
  if(s==='a[href]')return [...(options.draftLink?[element('更多草稿',{href:options.draftLink,closest:()=>options.linkInBody?bodyEl:null})]:[]),element(options.profileName||'本人',{href:platform==='toutiao'?'https://toutiao.com/c/user/'+account+'/':(options.profileUrl||'https://www.zhihu.com/people/'+account),closest:()=>null})];
  if(s.startsWith('header,'))return [element((platform==='douyin'?'抖音号：':'小红书号：')+account)];
  if(s==='button,[role="button"]')return[button];
  if(s==='*'&&platform==='douyin')return [...(options.missingMedia?[]:[element('已添加1张图片')]),...(options.douyinDeclared?[element(options.compactDeclaration?'自主声明内容由AI生成':'自主声明 内容由AI生成')]:[])];
  if(s==='label'&&platform==='douyin')return (options.privateOnly?['仅自己可见','立即发布']:['公开','立即发布']).map(v=>element(v,{querySelector:()=>({})}));
  if(s.startsWith('.image-item img'))return[element('图片')];
  if(s==='div,span'&&options.douyinDeclared)return [element(options.compactDeclaration?'自主声明内容由AI生成':'自主声明 内容由AI生成')];
  if(s==='div,span')return options.restoredDraft?[element('你还有上次未发布的图文，是否继续编辑？')]:[];
  if(s.includes('placeholder')&&s.includes('标题'))return options.wrappedTitle&&s.split(',').some(x=>x.trim()==='.WriteIndex-titleInput')?[element('标题外层'),titleEl]:[titleEl];
  if(s.includes('contenteditable'))return[bodyEl];
  return[];
 }};
 const u=new URL(PLATFORMS[platform].editor);
 const context=vm.createContext({URL,document:doc,location:{href:u.href,origin:u.origin,pathname:u.pathname},getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 1},DOMParser:class{parseFromString(h){return{body:{textContent:h.replace(/<[^>]+>/g,'')}}}}});
 const run=(action,patch={})=>vm.runInContext('('+socialPage.toString()+')',context)({platform,action,media:[{name:'fixture.png'}],article:{title:'测试文章',text:'测试正文',html:'<p>测试正文</p>',ai:false},accountId:platform==='toutiao'?'123':'author',...patch});
 if(platform==='toutiao')account='123';
 return {run,context,setTitle:v=>title=v,get clicks(){return clicks},get draftOpens(){return draftOpens},setAccount:v=>account=v,setCaptcha:v=>captcha=v,setBody:v=>body=v};
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


test('CSDN draft contract accepts only exact saved editor IDs and excludes public or credential URLs',()=>{
 const r={...savedDraft,url:'https://mp.csdn.net/mp_blog/creation/editor/123'};assert.ok(draftEvidence('csdn',r));assert.ok(editorEvidence('csdn',r.url));
 for(const patch of [{url:PLATFORMS.csdn.editor},{url:r.url+'?id=1'},{url:r.url+'#x'},{url:r.url.replace('123','0')},{url:'https://blog.csdn.net/author/article/details/123'},{url:'https://u:p@mp.csdn.net/mp_blog/creation/editor/123'},{articleId:'124'},{savedVerified:false},{contentVerified:false}])assert.equal(draftEvidence('csdn',{...r,...patch}),null);
 assert.equal(draftEvidence('toutiao',r),null);
});


test('Toutiao draft list navigation requires saved editor text and observed same-origin list link',async()=>{
 const f=fixture('toutiao',{savedStatus:['草稿已保存'],draftLink:'https://mp.toutiao.com/profile_v4/manage/draft?from=creation'});
 const r=await f.run('draft-location');assert.equal(r.url,'https://mp.toutiao.com/profile_v4/manage/draft');assert.equal(r.accountId,'123');assert.equal(f.clicks,0);
 f.setBody('changed');assert.ok((await f.run('draft-location')).connectorError);
 for(const options of [{draftLink:'https://evil.test/profile_v4/manage/draft'},{draftLink:'https://mp.toutiao.com/profile_v4/manage/draft',linkInBody:true},{draftLink:'https://mp.toutiao.com/profile_v4/manage/draft',savedStatus:['草稿保存中']}]){
  const f=fixture('toutiao',{savedStatus:['草稿已保存'],...options});assert.equal(await f.run('draft-location'),null);
 }
});
test('Toutiao list opens only one exact title after current account check; never publishes or repeats',async()=>{
 const f=fixture('toutiao',{listTitles:['测试文章']});f.context.location.pathname='/profile_v4/manage/draft';
 assert.equal((await f.run('draft-list-inspect')).matched,true);assert.equal(f.draftOpens,0);assert.equal((await f.run('draft-list-open')).attempted,true);assert.equal(f.draftOpens,1);assert.ok((await f.run('draft-list-open')).connectorError);assert.equal(f.draftOpens,1);assert.equal(f.clicks,0);
 for(const titles of [[],['其他标题'],['测试文章','测试文章']]){const f=fixture('toutiao',{listTitles:titles});f.context.location.pathname='/profile_v4/manage/draft';assert.ok((await f.run('draft-list-open')).connectorError);assert.equal(f.draftOpens,0)}
 const wrong=fixture('toutiao',{listTitles:['测试文章']});wrong.context.location.pathname='/profile_v4/manage/draft';wrong.setAccount('other');assert.ok((await wrong.run('draft-list-open')).connectorError);assert.equal(wrong.draftOpens,0);
});

test('Zhihu generic profile link uses visible accessible name without changing account identity',async()=>{
 const f=fixture('zhihu',{profileName:'我的主页',profileLabels:['点击打开温舒的主页','点击打开温舒的主页']});const me=await f.run('identity');assert.equal(me.name,'温舒');assert.equal(me.accountId,'author');
 const ambiguous=fixture('zhihu',{profileName:'我的主页',profileLabels:['点击打开甲的主页','点击打开乙的主页']});assert.equal((await ambiguous.run('identity')).name,'author');
});


test('Toutiao visible save failure is reported without inventing a draft receipt',async()=>{
 const f=fixture('toutiao',{saveFailure:true});assert.match((await f.run('draft-receipt')).connectorError,/头条提示保存失败/);assert.equal(f.clicks,0);
 const spoof=fixture('toutiao',{saveFailure:true,failureInBody:true});assert.equal(await spoof.run('draft-receipt'),null);
});

test('Zhihu selects and verifies native AI declaration before original draft submission',async()=>{
 const patch={article:{title:'测试文章',text:'测试正文',html:'<p>测试正文</p>',ai:true}};
 const f=fixture('zhihu',{aiCombo:true,aiResponsibility:true});assert.equal((await f.run('preflight',patch)).ready,true);assert.equal(f.clicks,0);assert.equal((await f.run('submit',patch)).attempted,true);assert.equal(f.clicks,1);
 const a=fixture('zhihu',{aiCombo:true,duplicateAI:true});assert.match((await a.run('preflight',patch)).connectorError,/不唯一/);assert.equal(a.clicks,0);
});

test('Toutiao account setup is reported before any editor write or submission',async()=>{
 const f=fixture('toutiao');f.context.location.pathname='/profile_v4/personal/landing-type';
 for(const action of ['identity','fill','submit','draft-list-open'])assert.match((await f.run(action)).connectorError,/完善账号信息.*发布权益/);
 assert.equal(f.clicks,0);assert.equal(f.draftOpens,0);
});

test('Douyin homepage evidence cannot override a conflicting editor identity',async()=>{
 const f=fixture('douyin');
 const profileEvidence={accountId:'another',name:'another',accountVerified:true,evidenceUrl:'https://creator.douyin.com/creator-micro/home'};
 assert.match((await f.run('identity',{profileEvidence})).connectorError,/唯一/);
 assert.match((await f.run('identity',{profileEvidence:{...profileEvidence,accountId:'author',evidenceUrl:'https://evil.test/'}})).connectorError,/依据/);
 assert.equal((await f.run('identity',{profileEvidence:{...profileEvidence,accountId:'author'}})).accountId,'author');
});

test('Douyin ignores empty editor zero-width decoration but preserves actual text before native input',async()=>{
 const f=fixture('douyin');f.setTitle('');f.setBody('\u200b');assert.equal((await f.run('fill',{nativeInput:true})).nativeInsertTitle,'测试文章');
 f.setBody('添加作品描述...');assert.match((await f.run('fill')).connectorError,/已有内容/);
 f.setBody('用户原稿');assert.match((await f.run('fill')).connectorError,/已有内容/);
 f.setTitle('测试文章');f.setBody('\u200b');assert.equal((await f.run('fill-body')).nativeInsertText,'测试正文');
 f.setTitle('不同标题');assert.match((await f.run('fill-body')).connectorError,/标题/);
});

test('Douyin retained media count tolerates split label text and rejects mismatched or uploading media',async()=>{
 const f=fixture('douyin');const query=f.context.document.querySelectorAll.bind(f.context.document);let label='已添加 2 张 图片 继续添加',busy=false;
 const element={textContent:label,getClientRects:()=>[{}],closest:()=>null};
 f.context.document.querySelectorAll=s=>s==='*'?[{...element,textContent:label}]:s==='.uploading,[class*="upload-progress"],[class*="upload-error"]'?(busy?[element]:[]):query(s);
 const media=[{name:'a.png'},{name:'b.png'}];
 assert.equal((await f.run('check-retained-media',{media})).mediaCount,2);
 label='已添加 1 张图片';assert.match((await f.run('check-retained-media',{media})).connectorError,/数量未匹配/);
 label='已添加2张图片';busy=true;assert.match((await f.run('check-retained-media',{media})).connectorError,/上传状态/);assert.equal(f.clicks,0);
});

test('Douyin receipt preserves rendered paragraph boundaries and ignores only zero-width decorations',async()=>{
 const f=fixture('douyin');f.setBody('第一段\n第二段');const body=f.context.document.querySelectorAll('[contenteditable="true"]')[0];
 f.context.document.createTextNode=value=>({textContent:value});
 body.cloneNode=()=>{const lines=['第一段\u200B','第二段\u200B'];return{get textContent(){return lines.join('')},querySelectorAll:s=>s==='div,p,li,br'?lines.map((_,i)=>({appendChild:n=>lines[i]+=n.textContent})):[]}};
 const article={title:'测试文章',text:'第一段\n\n第二段',html:''};assert.equal((await f.run('prepared',{article})).contentVerified,true);
 assert.match((await f.run('prepared',{article:{...article,text:'第一段\n不同正文'}})).connectorError,/正文已变化/);assert.equal(f.clicks,0);
});

test('Douyin native description input preserves words in one plain paragraph without platform newline markers',async()=>{
 const f=fixture('douyin');f.setBody('');const r=await f.run('fill-body',{article:{title:'测试文章',text:'第一段\n\n第二段\n署名',html:''}});
 assert.equal(r.nativeInsertText,'第一段 第二段 署名');assert.equal(f.clicks,0);
});

test('Douyin preflight needs explicit AI declaration, image count, public and immediate settings',async()=>{
 const article={title:'测试文章',text:'测试正文',ai:true};
 const ready=fixture('douyin',{douyinDeclared:true});assert.equal((await ready.run('preflight',{article})).ready,true);assert.equal(ready.clicks,0);
 for(const options of [{douyinDeclared:true,missingMedia:true},{douyinDeclared:true,privateOnly:true}]){const f=fixture('douyin',options);assert.ok((await f.run('preflight',{article})).connectorError);assert.equal(f.clicks,0)}
});

test("Douyin declaration accepts adjacent label nodes without weakening required AI declaration",async()=>{const f=fixture("douyin",{douyinDeclared:true,compactDeclaration:true});assert.equal((await f.run("preflight",{article:{title:"测试文章",text:"测试正文",ai:true}})).ready,true);assert.equal(f.clicks,0)});

test('Douyin finds unique visible declaration placeholder and verifies selection without submitting',async()=>{
 const f=fixture('douyin');const query=f.context.document.querySelectorAll.bind(f.context.document);let open=false,chosen=false,declared=false;
 const el=(value,click=()=>{})=>({textContent:value,getClientRects:()=>[{}],closest:()=>null,contains:()=>false,click,getAttribute:()=>null});
 f.context.document.querySelectorAll=s=>s==='*'?[...query(s),el(declared?'自主声明 内容由AI生成':'请选择自主声明',()=>open=true)]:s==='label,[role="radio"]'&&open?[el('内容由AI生成',()=>chosen=true)]:s==='button,[role="button"]'&&open?[...query(s),el('确定',()=>{declared=chosen;open=false})]:query(s);
 assert.equal((await f.run('preflight',{article:{title:'测试文章',text:'测试正文',ai:true}})).ready,true);assert.equal(declared,true);assert.equal(f.clicks,0);
});
