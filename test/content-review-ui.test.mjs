import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as checks from '../src/checks-core.js';
import {checkRecord} from '../src/check-execution.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(state={analysisChecks:[]}){
 const handlers={},sent=[],error={textContent:''};let scope='scope';
 const form={dataset:{kind:'content',scope,ids:'c',queueId:'semantic-ui-queue-0001'},elements:{background:{checked:true},provider:{value:'fixture'},onlyPending:{checked:true},confirmCost:{checked:false}},querySelector:s=>s==='.form-error'?error:{disabled:false}};
 const context={document:{addEventListener:(type,fn)=>handlers[type]=fn},GEO_CHECKS:checks,state,own:key=>state[key],brand:()=>({id:'b',name:'品牌'}),esc,crypto,sessionStorage:{getItem:()=>'',setItem(){},removeItem(){}},runtimeBusy:false,runtimeLock:v=>context.runtimeBusy=v,runtimeFlush:async()=>{},apiRequest:async(path,options)=>{sent.push({path,body:JSON.parse(options.body)});return {id:'semantic-ui-queue-0001'};},closeDrawer(){},go(){},refreshTasks:async()=>{},toast(){}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/checks.js',import.meta.url),'utf8'),context);context.checksScope=()=>scope;
 return {context,handlers,sent,form,error,scope:value=>scope=value,submit:()=>handlers.submit({preventDefault(){},target:{closest:()=>form}})};
}
async function withReview(){
 const text='仅按预约说明提供服务，未提供效果统计。';
 const state={brands:[{id:'b',name:'品牌'}],facts:[{id:'f',brandId:'b',value:text,source:'服务说明',status:'已确认'}],contents:[{id:'c',brandId:'b',title:'如何预约服务',question:'怎样预约',style:'常见问答',text}],analysisChecks:[]};
 const input=checks.checkInput(state,'b','content',['c']),dimensions=checks.CONTENT_REVIEW_DIMENSIONS.map((d,i)=>({id:d.id,status:'needs_revision',location:'body',quote:text,factId:'f',factQuote:text,issue:'问题'+i,suggestion:'建议'+i+' <script>不可执行</script>',priority:i===4?'high':'medium'}));
 const raw=JSON.stringify({results:[{id:'c',claims:[],editorialReview:{dimensions}}]});state.analysisChecks.push(await checkRecord('r','b','fixture',input,{text:raw,model:'fixture'}));return state;
}
test('editor advice prioritizes three suggestions and keeps all five anchored assessments in collapsed details',async()=>{
 const ui=harness(await withReview()),html=ui.context.contentReviewPanelHtml('c',false),top=html.split('<details')[0];
 assert.equal((top.match(/<li>/g)||[]).length,3);assert.ok(top.indexOf('问题4')<top.indexOf('问题0'));assert.match(html,/<details class="advanced"><summary>查看五项审校依据与全部建议/);assert.match(html,/问题3/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-article-semantic-revise/);assert.equal(ui.sent.length,0);
 const dirty=ui.context.contentReviewPanelHtml('c',true);assert.doesNotMatch(dirty,/问题[0-4]|data-article-semantic-revise/);assert.match(dirty,/旧建议不会用于当前编辑内容/);
 ui.context.state.facts[0].value+='已更新';assert.doesNotMatch(ui.context.contentReviewPanelHtml('c',false),/问题[0-4]|data-article-semantic-revise/);
});
test('the cost checkbox blocks both queued and immediate checks until the user confirms',async()=>{
 const ui=harness();await ui.submit();assert.equal(ui.sent.length,0);assert.match(ui.error.textContent,/确认本批模型调用/);
 ui.form.elements.background.checked=false;await ui.submit();assert.equal(ui.sent.length,0);
 ui.form.elements.background.checked=true;ui.form.elements.confirmCost.checked=true;await ui.submit();assert.equal(ui.sent.length,1);assert.equal(ui.sent[0].body.confirmCost,true);assert.equal(ui.sent[0].body.semanticReviewVersion,1);
});
test('a workspace change while flushing cancels the newly confirmed check before sending',async()=>{
 const ui=harness();ui.form.elements.confirmCost.checked=true;ui.context.runtimeFlush=async()=>ui.scope('other-scope');await ui.submit();assert.equal(ui.sent.length,0);assert.match(ui.error.textContent,/工作区或品牌已切换/);
});
test('an included review uses the fixed article allowance in the foreground without repeated fee consent or automatic dispatch',async()=>{
 const state={contents:[{id:'c',brandId:'b',writingBudgetId:'article-budget'}],analysisChecks:[]},ui=harness(state),g=ui.context;let html='';
 Object.assign(g,{accessInfo:{current:{owner:'owner'}},serverConnections:[{provider:'fixture',model:'fixture'}],URLSearchParams,canOperateTasks:()=>true,openDrawer:(_title,value)=>html=value,btn:()=>'',render(){},$:()=>({textContent:'',insertAdjacentHTML(){}}),apiRequest:async(path,options={})=>{ui.sent.push({path,body:options.body?JSON.parse(options.body):null});if(options.method==='GET')return {budget:{id:'article-budget',articleId:'c',provider:'fixture',eligible:true,availableStages:['review']}};return {state,revision:2,record:{id:'review-receipt'}};}});g.showCheckDetail=()=>{};
 await g.openChecks('content',['c']);assert.equal(ui.sent.length,1);assert.match(html,/已包含在本篇计划内/);assert.doesNotMatch(html,/name="confirmCost"|name="background"/);assert.match(html,/name="provider" disabled/);
 ui.form.dataset.writingBudget='article-budget';await ui.submit();assert.equal(ui.sent.length,2);assert.equal(ui.sent[1].path,'/api/checks/run');assert.equal(ui.sent[1].body.writingBudgetId,'article-budget');assert.equal(ui.sent[1].body.confirmCost,undefined);
});
