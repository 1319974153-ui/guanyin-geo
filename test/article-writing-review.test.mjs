import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {articleRevision,articleWritingReview,markdownInsertion} from '../src/article-editor-core.js';
import {articleContract} from '../src/article-contract.js';
import {articleMediaRefs} from '../src/article-media-core.js';

const paragraph='这段说明保留必要输入、操作步骤、可检查的输出和适用范围，帮助读者核对自己的实际需求。';
const savedArticle=()=>({id:'article-1',brandId:'brand-1',title:'资料整理方法',text:paragraph,ai:true,status:'已审核',reviewedAt:'before',writingBasis:{policyVersion:4},factSnapshots:[{id:'fact-1',source:'产品说明'}],writingReview:{status:'old-result'}});

test('editor rechecks keep the selected article type and its editorial requirements',()=>{
 const contract=articleContract({goal:'提升品牌认知',format:'品牌介绍',tone:'通俗易懂'});
 const article={...savedArticle(),writingBasis:{articleContract:contract}};
 const review=articleWritingReview(article,{text:paragraph});
 assert.equal(review.editorialContract.selection.format,'品牌介绍');
 assert.deepEqual(review.editorialContract.selection,contract.selection);
 assert.equal(review.automatedFactVerification,false);
});

function editor(article=savedArticle()){
 const nodes=new Map(),listeners=new Map(),timers=new Map();let timerId=0,html='',apiCalls=0;
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:''});return nodes.get(selector);};
 const f={dataset:{id:article.id,brand:article.brandId,new:'false'},elements:{title:{value:article.title},text:{value:article.text},articleAi:{checked:article.ai}},savedTitle:article.title,savedText:article.text,savedAi:!!article.ai,isConnected:true,querySelector:node,querySelectorAll:()=>[]};
 const state={contents:[article]},esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context={document:{querySelector:selector=>selector==='[data-article-editor]'?f:null,addEventListener:(type,listener)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);}},window:{addEventListener(){}},structuredClone,GEO_ARTICLE_EDITOR:{articleRevision,articleWritingReview,markdownInsertion,articleMediaRefs},GEO_ARTICLE_FORMAT:{formatArticle:text=>({html:esc(text),warnings:[]})},state,own:kind=>state[kind],brand:()=>({id:article.brandId}),accessInfo:{current:{role:'owner'}},checkLabel:()=> '已检查，待复核',esc,badge:value=>esc(value),btn:()=>'',distributionPanel:()=>'<aside>发布账号</aside>',writingBasisHtml:()=>'<p>生成依据</p>',openDrawer:(_title,value)=>{html=value;},distributionRenderMedia(){},distributionLoad(){},wordpressFormatFrame:value=>value,runtimeBusy:false,runtimeLock(value){context.runtimeBusy=value;},runtimeFlush:async()=>{},save(){},toast(){},render(){},apiRequest(){apiCalls++;throw Error('No network calls expected');},setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/article-editor.js',import.meta.url),'utf8'),context);
 return {context,article,f,node,get html(){return html;},get apiCalls(){return apiCalls;},run:code=>vm.runInContext(code,context),input(name){for(const listener of listeners.get('input')||[])listener({target:{name,closest:()=>f}});},tick(){for(const callback of timers.values())callback();timers.clear();}};
}

test('editing review uses the separate title and current buffer without forcing manual writers into generated-content rules',()=>{
 const manual={title:'手写方法',text:paragraph,ai:false,writingReview:{checks:[{id:'body_present',ok:false}]}};
 const review=articleWritingReview(manual);
 assert.ok(review.checks.every(check=>check.ok));assert.equal(review.status,'needs_editor_review');assert.equal(review.automatedFactVerification,false);
 assert.ok(!review.checks.some(check=>['markdown_title','ai_disclosure','evidence_snapshot'].includes(check.id)));
 const empty=articleWritingReview(manual,{title:'',text:''});
 assert.equal(empty.checks.find(check=>check.id==='title_present').ok,false);assert.equal(empty.checks.find(check=>check.id==='body_present').ok,false);
 const generated=articleWritingReview({...manual,writingBasis:{policyVersion:4}});
 assert.equal(generated.checks.find(check=>check.id==='evidence_snapshot').ok,false);
});

test('local review recalculates duplicate and source issues without mutating article status or stored results',()=>{
 const article=savedArticle(),before=JSON.stringify(article);
 const repeated=articleWritingReview(article,{text:paragraph+'\n\n'+paragraph});
 assert.equal(repeated.checks.find(check=>check.id==='duplicate_paragraphs').ok,false);
 const repaired=articleWritingReview(article,{text:paragraph});assert.ok(repaired.checks.every(check=>check.ok));
 const badSource=articleWritingReview({...article,factSnapshots:[{id:'fact-1'}]},{text:paragraph+' [事实:unknown]'});
 assert.equal(badSource.checks.find(check=>check.id==='source_recorded').ok,false);assert.equal(badSource.checks.find(check=>check.id==='known_fact_ids').ok,false);
 assert.equal(JSON.stringify(article),before);
});

test('editor shows a compact review before save actions and immediately removes stale summaries on unsaved edits',()=>{
 const ui=editor();ui.run('openArticleEditor(state.contents[0])');
 assert.ok(ui.html.indexOf('data-article-basic-summary')<ui.html.indexOf('class="article-bottom"'));
 assert.match(ui.html,/<summary>查看检查项与核对范围<\/summary>/);
 assert.match(ui.node('[data-article-basic-summary]').textContent,/未发现基础格式问题/);
 assert.equal(ui.node('[data-article-semantic-status]').textContent,'语义质检：已检查，待复核');
 ui.f.elements.text.value=paragraph+'\n\n'+paragraph;ui.input('text');
 assert.match(ui.node('[data-article-basic-summary]').textContent,/正在检查当前修改/);
 assert.equal(ui.node('[data-article-basic-details]').textContent,'结果更新中。');
 assert.match(ui.node('[data-article-semantic-status]').textContent,/原语义质检仅适用于保存版/);
 ui.tick();assert.equal(ui.node('[data-article-basic-summary]').textContent,'基础检查：1 项待核对');assert.match(ui.node('[data-article-basic-details]').innerHTML,/完全重复/);
 ui.f.elements.text.value=paragraph;ui.input('text');ui.tick();
 assert.match(ui.node('[data-article-basic-summary]').textContent,/未发现基础格式问题/);assert.equal(ui.node('[data-article-semantic-status]').textContent,'语义质检：已检查，待复核');
 assert.equal(ui.article.status,'已审核');assert.equal(ui.apiCalls,0);
});

test('saving a modified draft clears persisted old writing review as well as approval metadata',async()=>{
 const ui=editor();ui.f.elements.text.value=paragraph+'\n\n补充适用条件。';
 await ui.run("articleEditorSave('save',{reopen:false})");
 assert.equal(ui.article.status,'草稿');assert.equal(ui.article.writingReview,undefined);assert.equal(ui.article.reviewedAt,undefined);
 assert.deepEqual(ui.article.factSnapshots,[{id:'fact-1',source:'产品说明'}]);assert.equal(ui.apiCalls,0);
 const unchanged=savedArticle(),next=articleRevision(unchanged,{title:unchanged.title,text:unchanged.text,ai:true},'save','owner');
 assert.deepEqual(next.writingReview,unchanged.writingReview);
});


test('an image-only edit keeps the source immutable and invalidates the saved review on save',async()=>{
 const hash='a'.repeat(64),article={...savedArticle(),mediaRefs:[{id:'am-'+hash,sha256:hash,rightsConfirmed:true}],mediaVersion:1};
 const ui=editor(article);ui.run('openArticleEditor(state.contents[0])');
 assert.notEqual(ui.f.distributionMediaRefs,article.mediaRefs);assert.notEqual(ui.f.savedMediaRefs,article.mediaRefs);
 ui.f.distributionMediaRefs[0].rightsConfirmed=false;ui.run('articleEditorRefresh(document.querySelector("[data-article-editor]"))');
 assert.equal(article.mediaRefs[0].rightsConfirmed,true);assert.match(ui.node('[data-article-semantic-status]').textContent,/原语义质检仅适用于保存版/);
 await ui.run("articleEditorSave('save',{reopen:false})");
 assert.equal(article.status,'草稿');assert.equal(article.mediaVersion,2);assert.equal(article.mediaRefs[0].rightsConfirmed,false);assert.equal(article.reviewedAt,undefined);assert.equal(article.writingReview,undefined);assert.equal(ui.apiCalls,0);
});
