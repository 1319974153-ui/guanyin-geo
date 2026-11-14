import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseFragment} from 'parse5';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const app=read('app.js');
const answerCode=app.slice(app.indexOf('function answerReviewLabelText'),app.indexOf('async function action(name,el)'));
const formCode=app.slice(app.indexOf('function form('),app.indexOf('function showAnswers('));
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

// Parse the production-generated HTML rather than returning canned selector results.
// This small DOM supports the properties/selectors used by these two review surfaces;
// it checks control behavior, not a real-browser rendering or platform acceptance.
class Element {
 constructor(node,parent=null){this.node=node;this.parentElement=parent;this.children=(node.childNodes||[]).map(n=>new Element(n,this));this.listeners=new Map();this.dataset=new Proxy({},{get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()))??undefined,set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}});}
 get tagName(){return (this.node.tagName||'').toUpperCase();}
 getAttribute(name){return this.node.attrs?.find(a=>a.name===name)?.value??null;}
 setAttribute(name,value){this.node.attrs||=[];const old=this.node.attrs.find(a=>a.name===name);if(old)old.value=String(value);else this.node.attrs.push({name,value:String(value)});}
 removeAttribute(name){this.node.attrs=(this.node.attrs||[]).filter(a=>a.name!==name);}
 get id(){return this.getAttribute('id')||'';} get name(){return this.getAttribute('name')||'';}
 get type(){return this.getAttribute('type')||(this.tagName==='BUTTON'?'submit':'text');}
 get disabled(){return this.getAttribute('disabled')!==null;} set disabled(v){v?this.setAttribute('disabled',''):this.removeAttribute('disabled');}
 get checked(){return this.getAttribute('checked')!==null;} set checked(v){v?this.setAttribute('checked',''):this.removeAttribute('checked');}
 get readOnly(){return this.getAttribute('readonly')!==null;} set readOnly(v){v?this.setAttribute('readonly',''):this.removeAttribute('readonly');}
 get value(){if(this.tagName==='SELECT'){const options=this.querySelectorAll('option');return (options.find(o=>o.getAttribute('selected')!==null)||options[0])?.value||'';}return this.getAttribute('value')??this.textContent;}
 set value(value){if(this.tagName==='SELECT'){for(const o of this.querySelectorAll('option'))o.value===value?o.setAttribute('selected',''):o.removeAttribute('selected');}else this.setAttribute('value',value);}
 get options(){return this.querySelectorAll('option');}
 get textContent(){return this.node.nodeName==='#text'?this.node.value:this.children.map(x=>x.textContent).join('');}
 set textContent(value){this.children=[new Element({nodeName:'#text',value:String(value)},this)];}
 set innerHTML(html){for(const child of this.children)child.parentElement=null;this.children=parseFragment(html).childNodes.map(n=>new Element(n,this));}
 get isConnected(){return this.node.nodeName==='#document-fragment'&&!this.parentElement||!!this.parentElement?.isConnected;}
 matches(selector){return selector.split(',').some(part=>{const chain=part.trim().split(/\s+(?=(?:[^"']|"[^"]*"|'[^']*')*$)/);let el=this;if(!el.simpleMatch(chain.pop()))return false;while(chain.length){const item=chain.pop();el=el.parentElement;while(el&&!el.simpleMatch(item))el=el.parentElement;if(!el)return false;}return true;});}
 simpleMatch(part){if(!this.node.tagName)return false;const attrs=[...part.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];for(const [,name,value]of attrs)if(this.getAttribute(name)===null||(value!==undefined&&this.getAttribute(name)!==value))return false;let base=part.replace(/\[[^\]]*\]/g,'');for(const [,id]of base.matchAll(/#([\w-]+)/g))if(this.id!==id)return false;for(const [,cls]of base.matchAll(/\.([\w-]+)/g))if(!(this.getAttribute('class')||'').split(/\s+/).includes(cls))return false;base=base.replace(/[#.][\w-]+/g,'');return !base||base==='*'||base.toUpperCase()===this.tagName;}
 querySelectorAll(selector){const out=[];const visit=node=>{for(const child of node.children){if(child.matches(selector))out.push(child);visit(child);}};visit(this);return out;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){for(let el=this;el;el=el.parentElement)if(el.matches(selector))return el;return null;}
 addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
}
function documentFixture(){const d=new Element(parseFragment('<main id="main"></main><dialog id="drawer"><div id="drawer-body"></div></dialog>'));d.getElementById=id=>d.querySelector('#'+id);return d;}
const plan={brandId:'b1',brandName:'品牌甲',ids:['f1','f2'],rows:[{id:'f1',key:'可确认资料',value:'有出处的真实材料',source:'原始文件',version:1,productName:'品牌通用',eligible:true,reasons:[]},{id:'f2',key:'不可确认资料',value:'来源已变更',source:'历史文件',version:1,productName:'品牌通用',eligible:false,reasons:['原文已有新版']}],previewHash:'preview-hash',remaining:0};
const answer={id:'a1',brandId:'b1',text:'品牌甲的原始回答 <script>不得执行</script>',date:'2026-11-12T00:00:00Z',citations:[]};
function fixture(role='reviewer',request){
 const document=documentFixture(),calls=[],notices=[];let serial=0;
 const g={console,document,route:'knowledge',structuredClone,Date,JSON,Set,Map,Number,encodeURIComponent,state:{currentBrand:'b1',facts:[],answers:[structuredClone(answer)]},serverRevision:1,runtimeBusy:false,sessionStorage:{getItem:()=>null},brand:()=>({id:g.state.currentBrand}),own:key=>g.state[key],runtimeLock:v=>g.runtimeBusy=v,runtimeFlush:async()=>{},uid:()=>`review-fixture-${++serial}`,esc:escape,btn:(label,action,cls='',attrs='')=>`<button type="button" data-action="${action}" class="${cls}" ${attrs}>${escape(label)}</button>`,selectField:(label,name,options,current)=>`<label>${label}<select name="${name}">${options.map(value=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(value)}</option>`).join('')}</select></label>`,toast:text=>notices.push(text),render(){},closeDrawer(){document.getElementById('drawer-body').innerHTML='';},answerDetail(){},apiRequest:async(path,options)=>{const c={path,body:options?.body?JSON.parse(options.body):null};calls.push(c);if(request)return request(c,g);if(path.endsWith('review-preview'))return {plan};if(path.startsWith('/api/answer-reviews?'))return {answer,brandId:'b1',answerId:'a1',answerHash:'a'.repeat(64),reviewRevision:1,labels:{recommendation:'unknown',citationKnown:false},records:[{id:'audit-1',actor:'reviewer <script>',at:answer.date,before:{recommendation:'unknown',citationKnown:false},after:{recommendation:'no',citationKnown:true},sample:{date:answer.date,questionVersion:'v1'},currentAnswerMatches:true}],notice:'历史由服务器保存'};return {confirmedIds:['f1'],state:{...g.state,answerReviewAudits:[{id:'server-audit'}]},revision:2};}};
 vm.createContext(g);vm.runInContext(read('management.js'),g);vm.runInContext('accessInfo={current:{role:'+JSON.stringify(role)+',owner:"owner"},workspaces:[]};',g);vm.runInContext("function knowledgeWrite(){return ['owner','admin','editor'].includes(accessInfo.current.role)}",g);
 g.openDrawer=(_,html)=>{document.getElementById('drawer-body').innerHTML=html;g.enforceDrawerPermissions();};
 vm.runInContext(read('knowledge-review.js'),g);vm.runInContext(formCode+answerCode,g);
 const dispatch=async(type,target)=>{if(!target)throw Error('Missing element');if(target.disabled)return false;const event={target,preventDefault(){}};for(const listener of document.listeners.get(type)||[])await listener(event);return true;};
 return {g,document,calls,notices,setRole:role=>vm.runInContext('accessInfo.current.role='+JSON.stringify(role),g),query:s=>document.querySelector(s),decorate:()=>g.enforceDrawerPermissions(),dispatch,click:target=>dispatch('click',target),change:async(target,checked)=>{if(target.disabled)return false;target.checked=checked;return dispatch('change',target);},session:()=>vm.runInContext('materialReviewSession',g)};
}

test('main permissions expose reviewer review entries but do not unlock edits, and viewers cannot open write entries',()=>{
 for(const role of ['reviewer','viewer']){const f=fixture(role);f.document.getElementById('main').innerHTML=['knowledge-review-open','review-answer','edit-fact','new-brand','knowledge-history'].map(action=>`<button data-action="${action}">操作</button>`).join('');f.g.managementDecorate();assert.equal(f.query('[data-action="knowledge-review-open"]').disabled,role==='viewer');assert.equal(f.query('[data-action="review-answer"]').disabled,role==='viewer');assert.equal(f.query('[data-action="edit-fact"]').disabled,true);assert.equal(f.query('[data-action="new-brand"]').disabled,true);assert.equal(f.query('[data-action="knowledge-history"]').disabled,false);}
});
test('reviewer material form requires eligible selections and acknowledgement after real permission decoration',async()=>{
 const f=fixture();await f.g.openMaterialReview();const form=f.query('[data-material-review-form]'),submit=form.querySelector('button[type="submit"]'),ack=form.querySelector('[data-material-reviewed]');assert.equal(submit.disabled,true);assert.equal(form.querySelector('[name="materialId"]').readOnly,false);assert.equal(form.querySelector('[value="f2"]').disabled,true);
 await f.click(form.querySelector('[data-material-review-action="select-all"]'));assert.equal(form.querySelector('[value="f1"]').checked,true);assert.equal(form.querySelector('[value="f2"]').checked,false);assert.equal(submit.disabled,true);await f.g.submitMaterialReview(form);assert.equal(f.calls.length,1,'selection alone does not confirm');
 await f.change(ack,true);assert.equal(submit.disabled,false);f.decorate();assert.equal(submit.disabled,false,'rerender decoration must preserve an eligible explicit confirmation');await f.change(form.querySelector('[value="f1"]'),false);assert.equal(ack.checked,false);assert.equal(submit.disabled,true,'changing selected content invalidates acknowledgement');
 await f.click(form.querySelector('[data-material-review-action="select-all"]'));await f.change(ack,true);await f.g.submitMaterialReview(form);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].body.selectedIds,['f1']);assert.equal(f.calls[1].body.reviewed,true);assert.match(f.document.textContent,/已保存 1 条资料/);
});
test('reviewer material exception does not unlock source edits or unrelated controls',async()=>{
 const f=fixture();await f.g.openMaterialReview();const extra=new Element(parseFragment('<textarea name="source">保留原资料</textarea><form><input name="other"><button type="submit">其他保存</button></form>'),f.document.getElementById('drawer-body'));f.document.getElementById('drawer-body').children.push(extra);f.decorate();assert.equal(f.query('[name="source"]').readOnly,true);assert.equal(f.query('[name="other"]').readOnly,true);assert.equal(extra.querySelector('button').disabled,true);assert.equal(f.query('[data-material-review-form] [type="submit"]').disabled,true);
});
test('viewers cannot change material checkboxes or issue a confirmation after role change',async()=>{
 const f=fixture();await f.g.openMaterialReview();const form=f.query('[data-material-review-form]');await f.click(form.querySelector('[data-material-review-action="select-all"]'));await f.change(form.querySelector('[data-material-reviewed]'),true);f.setRole('viewer');f.decorate();for(const el of form.querySelectorAll('input,button[type="submit"],[data-material-review-action]'))assert.equal(el.disabled,true);assert.equal(await f.click(form.querySelector('[data-material-review-action="clear"]')),false);await f.g.submitMaterialReview(form);assert.equal(f.calls.length,1,'role check blocks a programmatic submit as well');
 const viewer=fixture('viewer');await viewer.g.openMaterialReview();assert.equal(viewer.calls.length,0);const editor=fixture('editor');await editor.g.openMaterialReview();assert.equal(editor.calls.length,0);
});
test('reviewer answer form only opens two label controls; original, history and unrelated fields remain read-only',async()=>{
 const f=fixture();await f.g.openAnswerReview('a1');const form=f.query('form[data-form="review-answer"]');assert.ok(form);const controls=form.querySelectorAll('select');assert.equal(controls.length,2);assert.ok(controls.every(el=>!el.disabled));assert.equal(form.querySelector('button[type="submit"]').disabled,false);assert.equal(form.querySelectorAll('input,textarea').length,0);assert.equal(form.querySelector('details').querySelectorAll('input,textarea,select,button').length,0);assert.equal(f.query('script'),null,'answer and actor HTML must stay escaped');
 const extra=new Element(parseFragment('<textarea name="original">原回答</textarea><input name="actor" value="forged"><select name="foreign"><option>其他</option></select><button type="submit">无关保存</button>'),f.document.getElementById('drawer-body'));f.document.getElementById('drawer-body').children.push(extra);f.decorate();assert.equal(f.query('[name="original"]').readOnly,true);assert.equal(f.query('[name="actor"]').readOnly,true);assert.equal(f.query('[name="foreign"]').disabled,true);assert.equal(extra.querySelector('button').disabled,true);assert.ok(controls.every(el=>!el.disabled));
 controls[0].value='适用推荐';controls[1].value='已核对（含无引用）';await f.g.saveAnswerReview(form,{recommended:controls[0].value,citationLabel:controls[1].value,actor:'forged',at:'2099-01-01',answerReviewAudits:[{id:'forged'}],text:'改写原文'});const payload=f.calls.at(-1).body;assert.deepEqual(Object.keys(payload).sort(),['brandId','answerId','requestId','answerHash','reviewRevision','recommended','citationKnown'].sort());assert.equal(payload.recommended,'yes');assert.equal(payload.citationKnown,true);assert.equal(payload.reviewRevision,1);assert.equal(f.g.state.answerReviewAudits[0].id,'server-audit');
});
test('answer retry locks are preserved by repeated permission decoration and viewers only receive history',async()=>{
 const f=fixture();await f.g.openAnswerReview('a1');const form=f.query('form[data-form="review-answer"]');f.g.apiRequest=async()=>{throw Error('暂时断线');};await f.g.saveAnswerReview(form,{recommended:'未推荐',citationLabel:'已核对（含无引用）'});assert.equal(form.querySelector('button[type="submit"]').disabled,false);assert.ok(form.querySelectorAll('select').every(x=>x.disabled));f.decorate();assert.ok(form.querySelectorAll('select').every(x=>x.disabled));assert.equal(form.querySelector('button[type="submit"]').disabled,false,'retry preserves original intent');
 const viewer=fixture('viewer');await viewer.g.openAnswerReview('a1');assert.equal(viewer.query('form'),null);assert.equal(viewer.query('select'),null);assert.ok(viewer.query('details'));assert.match(viewer.document.textContent,/原始回答/);assert.equal(viewer.calls.length,1);
});
test('permission decoration cannot release a material batch in flight',async()=>{
 let finish;const wait=new Promise(resolve=>finish=resolve);const f=fixture('reviewer',c=>c.path.endsWith('preview')?{plan}:wait);await f.g.openMaterialReview();const form=f.query('[data-material-review-form]');await f.click(form.querySelector('[data-material-review-action="select-all"]'));await f.change(form.querySelector('[data-material-reviewed]'),true);const save=f.g.submitMaterialReview(form);await new Promise(resolve=>setTimeout(resolve,0));f.decorate();assert.ok(form.querySelectorAll('input,button').every(x=>x.disabled));await f.g.submitMaterialReview(form);assert.equal(f.calls.length,2);finish({confirmedIds:['f1'],state:{currentBrand:'b1',facts:[],answers:[]},revision:2});await save;
});
