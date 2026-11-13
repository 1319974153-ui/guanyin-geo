import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/platform-content-adaptation.js';
const source=fs.readFileSync(new URL('../public/platform-content-adaptation.js',import.meta.url),'utf8');
function fixture(){
 const children=new Map(),events=new Map(),downloads=[],created=[];
 const make=()=>({dataset:{},value:'',innerHTML:'',textContent:'',disabled:false,open:false,events:new Map(),addEventListener(type,fn){this.events.set(type,fn)},querySelector(selector){if(!children.has(selector))children.set(selector,make());return children.get(selector)},append(node){created.push(node)},scrollIntoView(){}});
 const compose=make(),f={dataset:{id:'draft1',brand:'brand1'},isConnected:true,elements:{title:{value:'当前未保存标题'},text:{value:'当前完整正文，不保证效果。'},articleAi:{checked:true},distributionTags:{value:'测试,开发'}},distributionMediaFiles:[],querySelector:()=>compose,addEventListener(type,fn){events.set(type,fn)}};
 let scope='workspace1',brandId='brand1';
 const context={GEO_PLATFORM_ADAPTATION:core,document:{createElement:()=>make()},distributionArticle:()=>({id:'draft1',title:'旧标题',text:'旧正文',brandId:'brand1'}),distributionSelected:()=>[{platform:'douyin'}],wordpressBaseScope:()=>scope,brand:()=>({id:brandId}),download:(...args)=>downloads.push(args)};
 vm.createContext(context);vm.runInContext(source,context);
 const controller=context.platformContentAdaptationMount(f);
 return {context,f,controller,downloads,children,created,events,setScope:value=>scope=value,setBrand:value=>brandId=value};
}
test('mount is local, collapsed, idempotent and leaves current editing buffer unchanged',()=>{
 const x=fixture(),before=JSON.stringify(x.f.elements);
 assert.equal(x.controller.panel.open,false);assert.equal(x.controller.preview,null);assert.equal(x.created.length,1);assert.equal(x.controller.select.value,'douyin');
 assert.equal(x.context.platformContentAdaptationMount(x.f),x.controller);assert.equal(x.created.length,1);
 x.context.platformContentAdaptationOpen(x.f);assert.equal(x.controller.panel.open,true);assert.equal(x.controller.preview.original.title,'当前未保存标题');assert.equal(x.controller.preview.original.text,'当前完整正文，不保证效果。');assert.equal(JSON.stringify(x.f.elements),before);
 assert.doesNotMatch(source,/openDrawer\(|apiRequest\(|fetch\(|setInterval\(|setTimeout\(/);
});
test('platform selection displays missing content first and keeps full text and rules collapsed',()=>{
 const x=fixture();x.context.platformContentAdaptationOpen(x.f);
 const html=x.controller.result.innerHTML;assert.match(html,/先补齐/);assert.match(html,/至少 1 张/);assert.match(html,/<details class="simple-detail"><summary>查看完整纯文本/);assert.match(html,/<details class="simple-detail"><summary>其他检查与规则依据/);assert.doesNotMatch(html,/<details[^>]* open/);
 const original=JSON.stringify(x.f.elements);x.controller.select.value='zhihu';x.controller.select.events.get('change')();assert.equal(x.controller.preview.platform.id,'zhihu');assert.equal(JSON.stringify(x.f.elements),original);
});
test('export contains the exact current source and does not write a platform or article',()=>{
 const x=fixture();x.context.platformContentAdaptationOpen(x.f);assert.equal(x.context.platformContentAdaptationExport(x.controller),true);assert.equal(x.downloads.length,1);assert.match(x.downloads[0][0],/适配材料.md$/);assert.match(x.downloads[0][1],/当前完整正文，不保证效果/);assert.match(x.downloads[0][1],/未保存到平台、未发布/);assert.equal(x.f.elements.title.value,'当前未保存标题');
});
test('input changes immediately invalidate the old preview and require refresh before download',()=>{
 const x=fixture();x.context.platformContentAdaptationOpen(x.f);x.f.elements.text.value='修改后的正文。';x.events.get('input')({target:{name:'text'}});assert.equal(x.controller.preview,null);assert.equal(x.controller.exportButton.disabled,true);assert.equal(x.context.platformContentAdaptationExport(x.controller),false);assert.equal(x.downloads.length,0);
 x.context.platformContentAdaptationRefresh(x.controller);assert.equal(x.context.platformContentAdaptationExport(x.controller),true);assert.match(x.downloads[0][1],/修改后的正文/);
});
test('export catches silent edits and media byte changes even if no form event was dispatched',()=>{
 for(const mutate of [x=>x.f.elements.title.value='另一个标题',x=>x.f.elements.distributionTags.value='新标签',x=>x.f.distributionMediaFiles=[{name:'图.png',type:'image/png',dataUrl:'data:image/png;base64,AQID'}]]){
  const x=fixture();x.context.platformContentAdaptationOpen(x.f);mutate(x);assert.equal(x.context.platformContentAdaptationExport(x.controller),false);assert.equal(x.downloads.length,0);assert.match(x.controller.notice.textContent,/已变化/);
 }
 const x=fixture();x.f.distributionMediaFiles=[{name:'图.png',type:'image/png',dataUrl:'data:image/png;base64,AQID',sha256:'a'.repeat(64)}];x.context.platformContentAdaptationOpen(x.f);x.f.distributionMediaFiles[0].dataUrl='data:image/png;base64,BAUG';assert.equal(x.context.platformContentAdaptationExport(x.controller),false);
});
test('workspace, brand, article or disconnected editor changes clear private preview and block export',()=>{
 for(const mutate of [x=>x.setScope('workspace2'),x=>x.setBrand('brand2'),x=>x.f.dataset.id='draft2',x=>x.f.isConnected=false]){
  const x=fixture();x.context.platformContentAdaptationOpen(x.f);mutate(x);assert.equal(x.context.platformContentAdaptationExport(x.controller),false);assert.equal(x.controller.preview,null);assert.equal(x.controller.result.textContent,'');assert.equal(x.downloads.length,0);assert.equal(x.context.platformContentAdaptationRefresh(x.controller),false);
 }
});
test('untrusted title, summary, tags and filenames are escaped in read-only preview',()=>{
 const x=fixture();x.f.elements.title.value='<img src=x onerror=alert(1)>';x.f.elements.text.value='</textarea><script>bad()</script>';x.f.elements.distributionTags.value='<script>';x.context.platformContentAdaptationOpen(x.f);
 assert.doesNotMatch(x.controller.result.innerHTML,/<img|<script>/);assert.match(x.controller.result.innerHTML,/&lt;script&gt;/);assert.equal(x.f.elements.text.value,'</textarea><script>bad()</script>');
});
test('AI adaptation only prepares the existing revision flow and resets prior cost approval',()=>{
 const x=fixture(),renders=[];x.f.revisionState={plan:{old:true},confirmed:true,instruction:'旧计划',provider:'customer-model',pending:false,attempt:null};x.context.articleRevisionCurrent=()=>true;x.context.articleRevisionRender=f=>renders.push(f.revisionState.instruction);
 const before=JSON.stringify(x.f.elements);x.context.platformContentAdaptationOpen(x.f);assert.equal(x.controller.reviseButton.disabled,false);assert.equal(x.context.platformContentAdaptationRevise(x.controller),true);
 const r=x.f.revisionState;assert.equal(r.plan,null);assert.equal(r.confirmed,false);assert.equal(r.open,true);assert.equal(r.provider,'customer-model');assert.equal(renders.length,1);assert.match(r.instruction,/抖音图文/);assert.match(r.instruction,/不超过 20 字/);assert.match(r.instruction,/不超过 1000 字/);assert.match(r.instruction,/不按字数硬截断/);assert.match(r.instruction,/出处链接和 AI 辅助声明/);assert.ok(r.instruction.length<=1000);assert.equal(JSON.stringify(x.f.elements),before);assert.equal(x.downloads.length,0);
});
test('missing model uses the same revision connection flow without a new API or forced navigation',()=>{
 const x=fixture();let rendered=false;x.f.revisionState={provider:'',pending:false,attempt:null};x.context.articleRevisionCurrent=()=>true;x.context.articleRevisionRender=()=>rendered=true;x.context.platformContentAdaptationOpen(x.f);assert.equal(x.context.platformContentAdaptationRevise(x.controller),true);assert.equal(rendered,true);assert.equal(x.f.revisionState.provider,'');assert.match(x.f.revisionState.message,/查看计划、确认费用/);assert.doesNotMatch(source,/articleRevisionRequest\(|go\(|closeDrawer\(/);
});
test('revision refuses stale preview, pending calls, unresolved attempts, publishing or wrong scope',()=>{
 const cases=[x=>x.f.elements.text.value='changed',x=>x.f.revisionState.pending=true,x=>x.f.revisionState.attempt={runId:'original'},x=>x.f.distributionBusy=true,x=>x.context.runtimeBusy=true,x=>x.setScope('another'),x=>x.context.articleRevisionCurrent=()=>false];
 for(const mutate of cases){const x=fixture();let renders=0;x.f.revisionState={instruction:'保持原要求',plan:{old:true},confirmed:true,pending:false,attempt:null};x.context.articleRevisionCurrent=()=>true;x.context.articleRevisionRender=()=>renders++;x.context.platformContentAdaptationOpen(x.f);mutate(x);assert.equal(x.context.platformContentAdaptationRevise(x.controller),false);assert.equal(x.f.revisionState.instruction,'保持原要求');assert.equal(renders,0);}
});
test('unknown limits stay unknown in AI instructions; preview does not invent platform approval',()=>{
 const p=core.platformContentAdaptation({article:{title:'标题',text:'正文。'},platformId:'wechat'}),x=fixture(),instruction=x.context.platformAdaptationRevisionInstruction(p);
 assert.match(instruction,/标题长度要求尚未核对/);assert.match(instruction,/正文长度要求尚未核对/);assert.doesNotMatch(instruction,/32 字|120 字|保证发布/);assert.match(instruction,/新版本需重新确认/);
});
test('read-only roles keep local preview but cannot seed an AI revision',()=>{
 const x=fixture();let rendered=false;x.context.accessInfo={current:{role:'viewer'}};x.f.revisionState={instruction:'原要求'};x.context.articleRevisionCurrent=()=>true;x.context.articleRevisionRender=()=>rendered=true;
 x.context.platformContentAdaptationOpen(x.f);assert.ok(x.controller.preview);assert.equal(x.controller.reviseButton.disabled,true);assert.equal(x.context.platformContentAdaptationRevise(x.controller),false);assert.equal(rendered,false);assert.equal(x.f.revisionState.instruction,'原要求');
});
test('new internal source classification blocks exporting an existing adaptation preview while preserving the editing buffer',()=>{
 const x=fixture();x.context.state={facts:[]};x.context.platformContentAdaptationOpen(x.f);
 x.context.state.facts.push({id:'secret',brandId:'brand1',value:x.f.elements.text.value,disclosure:'internal'});
 const before=JSON.stringify(x.f.elements);assert.equal(x.context.platformContentAdaptationExport(x.controller),false);assert.equal(x.downloads.length,0);assert.match(x.controller.notice.textContent,/内部/);assert.equal(JSON.stringify(x.f.elements),before);
});
