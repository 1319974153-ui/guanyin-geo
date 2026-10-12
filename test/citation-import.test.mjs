import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as core from '../src/citation-import-core.js';

test('copied rich links preserve actual targets and titles, deduplicate and ignore executable or hidden content',()=>{
 const r=core.extractCitationCandidates({html:'<a href="https://EXAMPLE.com:443/a?x=1&amp;y=2">原文 <b>标题</b></a><a href="https://example.com/a?x=1&amp;y=2">重复</a><a href="javascript:alert(1)">脚本</a><a href="/local">相对</a><a href="https://name:password@example.com/private">私密</a><template><a href="https://hidden.example/">隐藏</a></template><div style="display:none"><a href="https://hidden.example/">隐藏</a></div>',text:'https://display.example/fake'});
 assert.deepEqual(r.candidates,[{url:'https://example.com/a?x=1&y=2',title:'原文 标题',origin:'复制的链接'}]);assert.equal(r.ignored,3);
});
test('Markdown definitions, balanced URLs and bare pasted links are extracted without guessing display domains',()=>{
 const r=core.extractCitationCandidates({text:'[资料][ref]\n\n[ref]: https://example.com/path_(topic) "标题"\n\n可看 https://other.example/a?x=1。\nhttps://other.example/a?x=1\n显示域名：news.example\n`https://example-code.invalid/`\n\n```\nhttps://fenced.invalid\n```'});
 assert.deepEqual(r.candidates.map(c=>[c.url,c.title]),[['https://example.com/path_(topic)','资料'],['https://other.example/a?x=1','']]);
 assert.equal(core.extractCitationCandidates({text:'来源：example.com，页面只给出标题'}).candidates.length,0);
});
test('HTML without usable links falls back to plain URLs but invalid targets never become sources',()=>{
 const r=core.extractCitationCandidates({html:'<p>纯文本</p>',text:'(https://example.com/wiki/A_(B)). https://user:secret@private.example/ https://good.example/path'});
 assert.deepEqual(r.candidates.map(c=>c.url),['https://example.com/wiki/A_(B)','https://good.example/path']);assert.equal(r.ignored,1);
 for(const value of ['javascript:alert(1)','data:text/html,x','//example.com','ftp://example.com','https://u:p@example.com','example.com'])assert.throws(()=>core.citationUrl(value));
});
test('oversized or excessive source lists fail as a whole, without silently using the first hundred',()=>{
 assert.throws(()=>core.extractCitationCandidates({text:'x'.repeat(100001)}),/过长/);
 assert.throws(()=>core.extractCitationCandidates({html:'x'.repeat(500001)}),/过长/);
 const urls=Array.from({length:101},(_,i)=>'https://example.com/'+i).join('\n');assert.throws(()=>core.extractCitationCandidates({text:urls}),/超过 100/);assert.throws(()=>core.citationRows(urls),/最多 100/);
});
test('merging preserves hand-entered order and titles, returns a new list and rejects invalid or over-capacity input atomically',()=>{
 const existing='https://example.com\nhttps://other.example/page',titles={'https://example.com/':'已有标题'},selected=[{url:'https://example.com/',title:'不得覆盖'},{url:'https://third.example/a',title:'新来源'}],before=JSON.stringify({selected,titles});
 const rows=core.mergeCitationCandidates(existing,selected,titles);assert.deepEqual(rows,[{url:'https://example.com/',title:'已有标题'},{url:'https://other.example/page',title:''},{url:'https://third.example/a',title:'新来源'}]);assert.equal(JSON.stringify({selected,titles}),before);
 assert.throws(()=>core.mergeCitationCandidates('不是网址',selected),/完整/);assert.throws(()=>core.mergeCitationCandidates(Array.from({length:100},(_,i)=>'https://example.com/'+i).join('\n'),selected),/超过 100/);
});
function ui(){
 const handlers={},box={innerHTML:'',textContent:''},status={textContent:''},checks=[],f={dataset:{},elements:{text:{value:' 原始回答不改动 '},citations:{value:'https://existing.example/a'},citationKnown:{value:'false'}},querySelector:q=>q==='[data-citation-candidates]'?box:status,querySelectorAll:q=>q.endsWith(':checked')?checks.filter(c=>c.checked):checks};
 const ctx={GEO_CITATION_IMPORT:core,document:{addEventListener:(name,handler)=>handlers[name]=handler},runtimeBusy:false,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../public/answer-imports.js',import.meta.url),'utf8'),ctx);
 return{ctx,handlers,f,box,status,checks,el:{closest:()=>f}};
}
test('paste only prepares inert candidates; adopting selected links keeps raw text and review labels unchanged',()=>{
 const u=ui();let prevented=false;u.handlers.paste({target:{name:'text',closest:()=>u.f},clipboardData:{getData:type=>type==='text/html'?'<a href="https://source.example/a">&lt;img onerror=bad&gt;</a><a href="https://source.example/b">第二条</a>':'原文'},preventDefault(){prevented=true}});
 assert.equal(prevented,false);assert.equal(u.f.elements.text.value,' 原始回答不改动 ');assert.equal(u.f.elements.citations.value,'https://existing.example/a');assert.ok(!u.box.innerHTML.includes('<img'));assert.match(u.box.innerHTML,/&lt;img/);
 u.checks.push({checked:true,dataset:{answerCandidate:'0'}},{checked:false,dataset:{answerCandidate:'1'}});u.ctx.answerImportAction('answer-citations-apply',u.el);
 assert.equal(u.f.elements.citations.value,'https://existing.example/a\nhttps://source.example/a');assert.equal(u.f.elements.citationKnown.value,'false');assert.equal(u.f.citationTitles['https://source.example/a'],'<img onerror=bad>');assert.match(u.status.textContent,/新增 1 条/);
 u.ctx.answerImportAction('answer-citations-apply',u.el);assert.match(u.status.textContent,/新增 0 条/);
});
test('link collection cannot change an unresolved submitted capture or a busy request',()=>{
 const u=ui();u.f.dataset.submitted='fixed payload';u.ctx.answerCitationCandidates(u.f,{text:'https://example.com'});assert.match(u.box.textContent,/先保持原内容重试/);u.ctx.answerImportAction('answer-citations-apply',u.el);assert.equal(u.f.elements.citations.value,'https://existing.example/a');
 delete u.f.dataset.submitted;u.ctx.runtimeBusy=true;u.ctx.answerCitationCandidates(u.f,{text:'https://example.com'});assert.equal(u.f.citationCandidates,undefined);
});
