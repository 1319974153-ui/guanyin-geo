import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as core from '../src/publication-core.js';import {protectWordpress} from '../src/wordpress.js';
test('WordPress API receipts cannot be given fabricated manual platform stages or notes',()=>{
 const current={publications:[{id:'p',wordpressRunId:'wp-run',url:'https://brand.example/post',status:'远端发布'}]};
 for(const patch of [{publicationStage:'published'},{platformReceiptUrl:'https://another.example/post'},{platformNote:'人工声称已发布'},{platformAccount:'伪造发布账号'}])assert.throws(()=>protectWordpress(current,{publications:[{...current.publications[0],...patch}]}),/回执字段/);
 assert.doesNotThrow(()=>protectWordpress(current,{publications:[{...current.publications[0],autoRetest:false}]}));
 assert.equal(core.publicationStatus(current.publications[0]),'远端发布');assert.match(core.publicationStatus({publicationStage:'published'}),/平台已发布/);
});
function form(stage='planned') {const nodes={'.url-feedback':{textContent:''},'.entry-link':{innerHTML:''},'button[type="submit"]':{disabled:false}};return{isConnected:true,dataset:{},elements:{url:{value:'https://zhuanlan.zhihu.com/p/123'},title:{value:'原始标题',dataset:{}},publicationStage:{value:stage},channel:{value:'官网'},entryUrl:{value:''}},querySelector:s=>nodes[s]};}
function context(apiRequest){const c=vm.createContext({document:{addEventListener(){}},GEO_PUBLICATION:core,URL,brand:()=>({id:'b1',site:'https://brand.example/'}),safeUrl:x=>x,links:(u,l)=>l+' '+u,apiRequest});vm.runInContext(fs.readFileSync(new URL('../public/automation.js',import.meta.url),'utf8'),c);return c;}
test('pasting a URL registers the link and fills channel/title without claiming a platform publication',async()=>{
 let calls=0;const c=context(async()=>{calls++;return{url:'https://zhuanlan.zhihu.com/p/123',title:'读取的标题'}});c.f=form();await vm.runInContext('resolvePublication(f)',c);assert.equal(c.f.elements.publicationStage.value,'registered');assert.equal(c.f.elements.channel.value,'知乎');assert.equal(c.f.elements.title.value,'读取的标题');assert.equal(calls,1);
 c.f=form('draft');await vm.runInContext('resolvePublication(f)',c);assert.equal(c.f.elements.publicationStage.value,'draft');assert.equal(calls,1);
});
test('changing phase while title lookup is running discards the response and preserves user text',async()=>{
 let finish;const c=context(()=>new Promise(r=>finish=r));c.f=form('registered');const run=vm.runInContext('resolvePublication(f)',c);c.f.elements.publicationStage.value='draft';finish({title:'迟到的标题',url:'https://example.org/redirect'});await run;assert.equal(c.f.elements.title.value,'原始标题');assert.equal(c.f.elements.url.value,'https://zhuanlan.zhihu.com/p/123');assert.equal(c.f.querySelector('button[type="submit"]').disabled,false);
});

test('known creator URLs stay out of title fetching while real social article URLs retain their platform',async()=>{
 let calls=0;const c=context(async()=>{calls++;return{title:'公开文章',url:c.f.elements.url.value}});
 for(const receipt of ['https://creator.douyin.com/creator-micro/work-management/work-detail/123','https://creator.xiaohongshu.com/publish/publish','https://mp.toutiao.com/profile_v4/graphic/publish','https://baijiahao.baidu.com/builder/rc/edit','https://zhuanlan.zhihu.com/p/123/edit','https://mp.weixin.qq.com/cgi-bin/home']){
  c.f=form();c.f.elements.url.value=receipt;await vm.runInContext('resolvePublication(f)',c);assert.equal(calls,0);assert.equal(c.f.elements.publicationStage.value,'planned');assert.match(c.f.querySelector('.url-feedback').textContent,/平台回执栏/);
 }
 for(const [url,channel] of [['https://www.douyin.com/note/123','抖音'],['https://www.xiaohongshu.com/explore/abc','小红书'],['https://baijiahao.baidu.com/s?id=123','百家号'],['https://www.sohu.com/a/123_456','搜狐号'],['https://mp.weixin.qq.com/s/abc','微信公众号']]){
  c.f=form();c.f.elements.url.value=url;await vm.runInContext('resolvePublication(f)',c);assert.equal(c.f.elements.channel.value,channel);assert.equal(c.f.elements.publicationStage.value,'registered');assert.equal(c.f.elements.title.value,'公开文章');assert.ok(c.f.elements.entryUrl.value);
 }
 assert.equal(calls,5);assert.equal(core.isPlatformReceiptUrl('https://creator.douyin.com.evil.example/post'),false);
});

test('manual published receipts require evidence even when no public article URL is available',()=>{
 assert.throws(()=>core.validatePublicationRecord({publicationStage:'published',url:''}),/平台回执/);
 assert.doesNotThrow(()=>core.validatePublicationRecord({publicationStage:'published',url:'',platformNote:'平台后台显示：已发布'}));
 assert.equal(core.canCheckPublication({publicationStage:'published',url:'',platformReceiptUrl:'https://creator.douyin.com/creator-micro/home'}),false);
});
test('handoff snapshots must match the saved approved version and stay immutable',()=>{
 const c={id:'c',brandId:'b',status:'已审核',title:'审核标题',text:'审核正文',factSnapshots:[]};
 const current={publications:[],contents:[c],facts:[]};const p={id:'p',brandId:'b',contentId:'c',handoffSnapshot:{contentId:'c',brandId:'b',title:c.title,text:c.text,factSnapshots:[]}};
 assert.doesNotThrow(()=>core.protectHandoffSnapshots(current,{publications:[p]}));
 assert.throws(()=>core.protectHandoffSnapshots(current,{publications:[{...p,handoffSnapshot:{...p.handoffSnapshot,text:'伪造正文'}}]}),/审核稿/);
 assert.throws(()=>core.protectHandoffSnapshots({...current,publications:[p]},{publications:[{...p,handoffSnapshot:{...p.handoffSnapshot,text:'覆盖'}}]}),/不可覆盖/);
 assert.throws(()=>core.protectHandoffSnapshots({...current,contents:[{...c,status:'草稿'}]},{publications:[p]}),/审核稿/);
});
