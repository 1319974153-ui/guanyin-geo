import test from 'node:test';
import assert from 'node:assert/strict';
import {articleRevision, markdownInsertion} from '../src/article-editor-core.js';
import {formatArticle} from '../src/article-format.js';
import {mergeVisibleState} from '../src/access.js';

const input={title:'业务流程验收',text:'## 核验\n\n- 保存资料\n- 检查结果'};
test('self-written article does not need a model or monitoring question; preserves existing evidence',()=>{
 const fresh=articleRevision(null,input,'save','owner');assert.equal(fresh.status,'草稿');assert.equal(fresh.title,input.title);
 const record={...fresh,id:'article',factSnapshots:[{id:'fact',value:'已确认资料'}]};
 const changed=articleRevision(record,{...input,text:input.text+'\n补充'},'save','editor');assert.deepEqual(changed.factSnapshots,record.factSnapshots);
});
test('review is explicit; modified approved content loses obsolete approval and must be resubmitted',()=>{
 const draft=articleRevision(null,input,'save','owner');assert.throws(()=>articleRevision(draft,input,'approve','owner'),/提交审核/);
 const pending=articleRevision(draft,input,'submit','owner');const approved=articleRevision(pending,input,'approve','reviewer');assert.equal(approved.status,'已审核');assert.ok(approved.reviewedAt);
 assert.equal(articleRevision(approved,input,'save','owner').status,'已审核');
 const changed=articleRevision(approved,{...input,text:'新正文'},'save','owner');assert.equal(changed.status,'草稿');assert.equal(changed.reviewedAt,undefined);
 assert.throws(()=>articleRevision(pending,{...input,text:'改稿'},'approve','owner'),/先保存/);
});
test('editor cannot approve, reviewer cannot rewrite, viewer cannot save, content lengths are bounded',()=>{
 const pending={...input,status:'待审核'};
 assert.throws(()=>articleRevision(pending,input,'approve','editor'),/审核人/);
 assert.throws(()=>articleRevision(pending,{...input,text:'改稿'},'approve','reviewer'),/不能修改/);
 assert.throws(()=>articleRevision(pending,input,'save','viewer'),/不能编辑/);
 for(const v of [{...input,title:' '},{...input,title:'字'.repeat(161)},{...input,text:''},{...input,text:'字'.repeat(100001)}])assert.throws(()=>articleRevision(null,v,'save','owner'));
});
test('reviewer transition fits server role boundary without mutating text or evidence',()=>{
 const old={id:'c',brandId:'b',...input,status:'待审核',factSnapshots:[]},next=articleRevision(old,{...input,ai:false},'approve','reviewer');
 assert.equal(Object.hasOwn(next,'ai'),false);
 const state={version:1,brands:[{id:'b',name:'品牌'}],contents:[old]};
 const merged=mergeVisibleState(state,{...state,contents:[next]},{role:'reviewer',brands:['b']});assert.equal(merged.contents[0].status,'已审核');
});
test('format toolbar preserves surrounding text and handles selected and empty insertion',()=>{
 assert.deepEqual(markdownInsertion('前正文后',1,3,'bold'),{text:'前**正文**后',start:3,end:5});
 const heading=markdownInsertion('前文',2,2,'heading');assert.equal(heading.text,'前文\n## 小节标题');
 assert.equal(markdownInsertion('',0,0,'code').text,'```\n代码\n```');
});
test('article preview uses safe shared renderer: scripts and unsafe links do not become executable HTML',()=>{
 const result=formatArticle('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n## 内容\n\n**重点**');
 assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('href="javascript:'));assert.ok(result.html.includes('<h2>内容</h2>'));assert.ok(result.html.includes('<strong>重点</strong>'));
});

test('pasted AI drafts retain explicit disclosure and changing disclosure invalidates approval',()=>{
 const fresh=articleRevision(null,{...input,ai:true},'save','owner');assert.equal(fresh.ai,true);
 const approved={...fresh,status:'已审核',reviewedAt:'before'};
 assert.equal(articleRevision(approved,{...input,ai:true},'save','owner').status,'已审核');
 const changed=articleRevision(approved,{...input,ai:false},'save','owner');assert.equal(changed.status,'草稿');assert.equal(changed.reviewedAt,undefined);assert.equal(changed.ai,false);
 assert.throws(()=>articleRevision(approved,{...input,ai:false},'approve','reviewer'),/不能修改/);
 assert.throws(()=>articleRevision(null,{...input,ai:'true'},'save','owner'),/声明格式/);
 assert.equal(articleRevision(fresh,input,'save','owner').ai,true);
});
