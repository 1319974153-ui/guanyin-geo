import test from 'node:test';
import assert from 'node:assert/strict';
import {platformContentAdaptation as adapt,platformAdaptationMarkdown,platformAdaptationOptions,adaptationPlainText} from '../src/platform-content-adaptation.js';
import {PLATFORMS} from '../browser-extension/platforms.js';
import {publishingCatalog} from '../src/publishing-catalog.js';
const article={id:'draft-1',brandId:'brand-1',title:'真实案例：订单发货前的资料检查',text:'该项目只保存草稿，没有完成自动发货，处理了 35 条测试记录。\n\n来源：[项目记录](https://example.com/case)。\n\n本文包含 AI 辅助整理，事实已核对。',ai:true};
const picture={name:'配图.png',type:'image/png',dataUrl:'data:image/png;base64,AQIDBA==',sha256:'a'.repeat(64)};
const issues=(p,field)=>p.checks.filter(c=>c.field===field&&c.status==='needs_input');
test('all catalog platforms plus two common formats are available without inventing capabilities',()=>{
 const options=platformAdaptationOptions();assert.equal(options.length,publishingCatalog().length+2);assert.equal(new Set(options.map(p=>p.id)).size,options.length);
 assert.equal(options.find(p=>p.id==='douyin').category,'image_text');assert.equal(options.find(p=>p.id==='weibo').category,'article');
 for(const p of publishingCatalog())assert.equal(options.find(x=>x.id===p.id).implementation,p.implementation);
});
test('long-form preview retains exact title, body and original while using current connector limits',()=>{
 const input={...article,title:'长'.repeat(101),text:'第一段。\r\n\r\n## 第二段\n正文保留。'},before=JSON.stringify(input),p=adapt({article:input,platformId:'csdn',tags:['测试']});
 assert.equal(JSON.stringify(input),before);assert.equal(p.derived.body,input.text);assert.equal(p.original.text,input.text);assert.equal(p.derived.title,input.title);assert.equal(p.rules.titleMax,PLATFORMS.csdn.titleMax);assert.equal(issues(p,'title').length,1);assert.match(issues(p,'title')[0].message,/未截断/);
 assert.equal(p.modelCalls,0);assert.equal(p.networkRequests,0);assert.equal(p.published,false);assert.equal('canPublish' in p,false);assert.match(p.rules.label,/不是平台最新官方限额/);
});
test('short image-text removes presentation syntax but retains complete claims, qualifiers, links and disclosure',()=>{
 const input={...article,text:'## 订单案例\n\n**未完成**自动发货，35 条只是测试记录。\n\n'+article.text+'\n\n```js\nconst attempts = 2;\n```\n\n'+('完整保留。'.repeat(300))};
 const p=adapt({article:input,platformId:'douyin',media:[picture]});
 assert.equal(p.original.text,input.text);assert.match(p.derived.body,/未完成自动发货，35 条只是测试记录/);assert.match(p.derived.body,/https:\/\/example.com\/case/);assert.match(p.derived.body,/AI 辅助/);assert.match(p.derived.body,/const attempts = 2;/);assert.ok(p.derived.body.endsWith('完整保留。'.repeat(300)));assert.ok(p.derived.body.length>1000);assert.equal(issues(p,'body').length,1);assert.equal(issues(p,'images').length,0);
});
test('summary is a full source paragraph, never a truncated or model-generated claim',()=>{
 const first='这是一个完整段落，'.repeat(30)+'不能删掉末尾的否定：尚未交付。',p=adapt({article:{title:'案例',text:'# 标题\n\n'+first+'\n\n第二段另述。'},platformId:'wechat'});
 assert.equal(p.derived.summary,first);assert.equal(p.derived.summaryMethod,'first_complete_body_paragraph');assert.equal(p.rules.titleMax,null);assert.equal(p.rules.textMax,null);assert.match(p.checks.find(c=>c.field==='summary').message,/未压缩、未补写/);
 const heading=adapt({article:{title:'只有标题',text:'# 第一节\n\n## 第二节'}});assert.equal(heading.derived.summary,'');assert.equal(issues(heading,'summary').length,1);
});
test('required CSDN tags are checked locally, preserved and never guessed',()=>{
 assert.equal(issues(adapt({article,platformId:'csdn'}),'tags').length,1);
 for(const tags of [['一','一'],['太长'.repeat(11)],['1','2','3','4','5','6']])assert.equal(issues(adapt({article,platformId:'csdn',tags}),'tags').length,1);
 const p=adapt({article,platformId:'csdn',tags:[' 开发 ','软件测试']});assert.deepEqual(p.derived.tags,['开发','软件测试']);assert.equal(issues(p,'tags').length,0);
 assert.deepEqual(adapt({article,platformId:'zhihu'}).derived.tags,[]);
});
test('images require actual local metadata; markdown references do not satisfy image-text attachments',()=>{
 const p=adapt({article:{...article,text:'正文。\n\n![案例截图](https://example.com/image.png)'},platformId:'xiaohongshu'});
 assert.equal(issues(p,'images').length,1);assert.match(p.checks.find(c=>c.field==='inline_images').message,/未读取远程图片/);assert.equal(p.derived.images.length,0);assert.match(p.derived.body,/https:\/\/example.com\/image.png/);
 const okay=adapt({article,platformId:'xiaohongshu',media:[picture]});assert.equal(okay.derived.images[0].bytes,4);assert.equal('dataUrl' in okay.derived.images[0],false);
 for(const media of [[{...picture,type:'text/html'}],[{name:'missing.png',type:'image/png'}],[{...picture,size:3*1024*1024}],Array(10).fill(picture)])assert.ok(issues(adapt({article,platformId:'douyin',media}),'images').length);
 assert.ok(issues(adapt({article,platformId:'douyin',media:[picture],mediaLoading:true,mediaError:'文件未完成'}),'images').length>=2);
 assert.match(adapt({article,platformId:'csdn',media:[picture]}).checks.find(c=>c.field==='images').message,/未接入独立附件上传/);
});
test('planned targets and generic previews always retain permission and rules uncertainty',()=>{
 const target=publishingCatalog().find(p=>p.implementation==='planned'),p=adapt({article,platformId:target.id});
 assert.match(p.checks.find(c=>c.field==='platform').message,/仍在接入计划/);assert.match(p.checks.find(c=>c.field==='publication').message,/不检查登录/);
 const generic=adapt({article,platformId:'generic-image-text'});assert.equal(generic.rules.titleMax,null);assert.equal(generic.rules.textMax,null);assert.ok(issues(generic,'images').length);
});
test('snapshot and export omit unrelated customer fields and preserve full original despite markdown fences',()=>{
 const text=article.text+'\n\n````text\n完整尾部\n````',p=adapt({article:{...article,text,apiKey:'PRIVATE-KEY',author:{password:'PRIVATE-PASSWORD'},productId:{secret:'PRIVATE-SECRET'}},platformId:'douyin',media:[picture]});
 const exported=platformAdaptationMarkdown(p);assert.match(exported,/完整尾部/);assert.ok(exported.includes(text));assert.match(exported,/`````text/);assert.match(exported,/未修改原稿、未调用模型/);assert.match(exported,/图片文件未包含/);assert.doesNotMatch(exported,/PRIVATE-|data:image\/png;base64|AQIDBA==/);assert.doesNotMatch(JSON.stringify(p),/PRIVATE-/);
});
test('invalid inputs fail explicitly and formatter does not execute HTML or unsafe images',()=>{
 assert.throws(()=>adapt({article,platformId:'made-up'}),/目录/);assert.throws(()=>adapt({article:{...article,text:'字'.repeat(100001)}}),/原稿未修改/);assert.throws(()=>adapt({article,tags:[123]}),/标签/);
 const p=adapt({article:{title:'HTML',text:'<script>alert(1)</script>\n\n![不安全图片](http://example.com/a.png)'}});assert.doesNotMatch(p.derived.html,/<script|<img/);assert.match(p.derived.html,/&lt;script&gt;/);assert.ok(p.checks.some(c=>c.field==='format'));
 assert.equal(adaptationPlainText('<p>不低于 8%</p><p>第二段</p>').text,'不低于 8%\n\n第二段');
});
