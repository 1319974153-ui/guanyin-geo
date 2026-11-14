import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as contentOptions from '../src/content-options.js';
import * as questionImport from '../src/question-import-core.js';
import {questionProvenance} from '../src/question-provenance.js';

const source=readFileSync(new URL('../public/writing-conversation.js',import.meta.url),'utf8');
const plan={previewHash:'preview-fixture',model:'fixture-model',facts:[{id:'fact-1'}],maxModelCalls:1};
function proposal(id='plan-existing',brandId='brand-1',questionId='question-1'){
 return {id,brandId,questionId,provider:'fixture',options:{goal:'解释一个真实交付方法',format:'方法清单',tone:'技术复盘'},directions:Array.from({length:4},(_,index)=>({id:`direction-${index+1}`,title:`方向 ${index+1}`,angle:'真实资料范围',outline:['核对资料','明确边界'],evidenceNeed:[]}))};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function harness({store=storage(),request=async()=>({}),owner='owner',actor='actor',workspace='',brandId='brand-1'}={}){
 const listeners={},windowListeners={},requests=[],opened=[],locks=[];
 const drawer={id:'drawer',open:false},body={innerHTML:'',querySelector(){const id=this.innerHTML.match(/data-writing-conversation="([^"]+)"/)?.[1];return id?{dataset:{writingConversation:id}}:null;}};
 let serial=0,flushCount=0,confirmation=true;
 if(workspace)store.setItem('geo.workspace',workspace);
 const g={GEO_CONTENT_OPTIONS:contentOptions,URLSearchParams,structuredClone,console,sessionStorage:store,accessInfo:{current:{owner,actor}},serverConnections:[{provider:'fixture',model:'fixture-model'}],serverRevision:10,pendingSnapshot:null,runtimeBusy:false,
  state:{currentBrand:brandId,viewMode:'standard',brands:[{id:'brand-1'},{id:'brand-2'}],questions:[{id:'question-1',brandId:'brand-1',text:'客户问题一',topic:'资料'},{id:'question-2',brandId:'brand-2',text:'客户问题二',topic:'资料'}],contents:[]},
  uid:()=>`ui-${++serial}`,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  document:{getElementById:id=>id==='drawer'?drawer:id==='drawer-body'?body:null,addEventListener:(name,fn)=>{listeners[name]=fn;}},window:{addEventListener:(name,fn)=>{windowListeners[name]=fn;}},
  openDrawer:(title,html)=>{drawer.open=true;body.innerHTML=html;},closeDrawer:()=>{assert.equal(g.runtimeBusy,false,'unlock before opening the article');drawer.open=false;listeners.close?.({target:drawer});},
  runtimeLock:value=>{g.runtimeBusy=value;locks.push(value);},runtimeFlush:async()=>{flushCount++;},go(){},render(){},editContent:id=>opened.push(id),toast(){},confirm:()=>confirmation,
  apiRequest:async(path,options={})=>{const call={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined};requests.push(call);return request(call,g);}
 };
 g.brand=()=>g.state.brands.find(item=>item.id===g.state.currentBrand)||{id:''};g.own=key=>g.state[key].filter(item=>item.brandId===g.state.currentBrand);
 vm.createContext(g);vm.runInContext(source,g);
 const run=code=>vm.runInContext(code,g);
 const action=(name,dataset={})=>g.writingConversationAction(name,{dataset});
 const change=(selector,value)=>listeners.change({target:{matches:s=>s===selector,value,checked:value}});
 const input=(selector,value)=>listeners.input({target:{matches:s=>s===selector,value}});
 return {g,run,action,change,input,requests,opened,locks,body,drawer,store,listeners,windowListeners,get flushCount(){return flushCount;},set confirmation(value){confirmation=value;},open:()=>g.openWritingConversation(),current:()=>run('writingConversationState')};
}
async function readyDirections(ui){ui.open();await ui.action('writing-preview');ui.change('[data-writing-cost-confirm]',true);}
test('new brand writing uses one universal catalog with optional recommended style and no automatic call',()=>{
 for(const entityType of ['brand','product','person']){
  const ui=harness();ui.g.state.brands[0].entityType=entityType;ui.open();
  assert.equal(ui.current().goal,'提升品牌认知');assert.equal(ui.current().format,'AI 推荐');assert.equal(ui.current().tone,'AI 推荐');
  assert.equal(ui.current().preferencesOpen,false);assert.equal(ui.requests.length,0);
  assert.match(ui.body.innerHTML,/<details[^>]*data-writing-preferences\s*>/);
  assert.match(ui.body.innerHTML,/品牌介绍/);assert.match(ui.body.innerHTML,/知识科普/);
  assert.doesNotMatch(ui.body.innerHTML,/解释一个真实交付方法|技术复盘|资料整理案例/);
 }
});
test('optional style choices stay expanded across edits without starting a model request',async()=>{
 const ui=harness();ui.open();ui.listeners.toggle({target:{matches:s=>s==='[data-writing-preferences]',open:true,isConnected:true}});
 await ui.action('writing-choice',{writingKey:'format',writingValue:'知识科普'});
 assert.equal(ui.current().format,'知识科普');assert.match(ui.body.innerHTML,/<details[^>]*data-writing-preferences open>/);
 ui.listeners.toggle({target:{matches:s=>s==='[data-writing-preferences]',open:false,isConnected:false}});
 assert.equal(ui.current().preferencesOpen,true);assert.equal(ui.requests.length,0);
});
test('a recovered legacy direction retains its exact selections as historical options',async()=>{
 const ui=harness();readyDraft(ui);
 await ui.action('writing-select-direction',{directionId:'direction-1'});
 assert.equal(ui.current().goal,'解释一个真实交付方法');assert.equal(ui.current().tone,'技术复盘');
 assert.match(ui.body.innerHTML,/技术复盘（历史选项）/);assert.equal(ui.requests.length,0);
 await ui.action('writing-choice',{writingKey:'goal',writingValue:'建立信任'});
 assert.equal(ui.current().goal,'建立信任');assert.equal(ui.current().selected,null);assert.equal(ui.current().proposal.id,'plan-existing');
});
function readyDraft(ui){
 ui.open();ui.g.fixtureProposal=proposal();ui.run('writingConversationState.proposal=fixtureProposal;writingConversationState.selected=fixtureProposal.directions[0];writingConversationState.draftPlan='+JSON.stringify(plan)+';writingConversationState.draftCostConfirmed=true;renderWritingConversation()');
}
function pendingRecords(store){return [...store.values.entries()].filter(([key])=>key.startsWith('geo.writing.pending.'));}

test('opening from a configured model keeps that provider without making a model request',async()=>{
 const ui=harness({request:async()=>({plan})});ui.g.serverConnections.push({provider:'second',model:'second-model'});
 ui.g.openWritingConversation({provider:'second'});
 assert.equal(ui.current().provider,'second');assert.equal(ui.requests.length,0);assert.match(ui.body.innerHTML,/<option value="second" selected>/);
 await ui.action('writing-preview');assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].body.provider,'second');assert.ok(ui.requests[0].path.endsWith('/preview'));
});

test('an unavailable preferred provider falls back only to saved connections',()=>{
 const ui=harness();ui.g.openWritingConversation({provider:'unconfigured'});
 assert.equal(ui.current().provider,'fixture');assert.equal(ui.requests.length,0);assert.doesNotMatch(ui.body.innerHTML,/<option value="unconfigured"/);
 ui.g.serverConnections=[];ui.g.openWritingConversation({provider:'unconfigured'});
 assert.equal(ui.current().provider,'');assert.equal(ui.requests.length,0);assert.match(ui.body.innerHTML,/还没有连接写作模型/);
});

test('a preferred model does not replace an unresolved request or send another call',async()=>{
 const store=storage();let saved;
 const first=harness({store,request:async call=>{if(call.path.endsWith('/preview'))return {plan};saved=proposal(call.body.runId);throw Error('response lost');}});
 await readyDirections(first);await first.action('writing-suggest');
 const reopened=harness({store,request:async call=>{assert.equal(call.method,'GET');return {run:{id:saved.id,kind:'plan',state:'complete',brandId:'brand-1',questionId:'question-1'},proposal:saved};}});
 reopened.g.serverConnections.push({provider:'second',model:'second-model'});reopened.g.openWritingConversation({provider:'second'});
 assert.equal(reopened.current().attempt.runId,saved.id);assert.equal(reopened.current().provider,'fixture');assert.equal(reopened.requests.length,0);
 await reopened.action('writing-recover');assert.equal(reopened.current().proposal.id,saved.id);assert.equal(reopened.current().provider,'fixture');assert.equal(reopened.requests.length,1);
});

test('directions double-click dispatches once, locks inputs, and lost response recovers through GET only',async()=>{
 const sent=deferred(),release=deferred();let saved;
 const ui=harness({request:async call=>{
  if(call.path.endsWith('/preview'))return {plan};
  if(call.path.endsWith('/suggest')){saved=proposal(call.body.runId);sent.resolve();await release.promise;throw new Error('response lost after save');}
  if(call.path.includes('/result?'))return {run:{id:saved.id,kind:'plan',state:'complete',brandId:saved.brandId,questionId:saved.questionId},proposal:saved};
  throw new Error('unexpected request');
 }});
 await readyDirections(ui);const first=ui.action('writing-suggest');await sent.promise;
 await ui.action('writing-suggest');await ui.action('writing-choice',{writingKey:'tone',writingValue:'客户易读'});ui.change('[data-writing-question]','question-2');
 assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);assert.equal(ui.current().questionId,'question-1');assert.equal(ui.current().tone,'AI 推荐');assert.match(ui.body.innerHTML,/data-writing-question[^>]+disabled/);assert.match(ui.body.innerHTML,/data-action="writing-recover" disabled/);
 const originalId=ui.current().runId,record=JSON.parse(pendingRecords(ui.store)[0][1]);assert.deepEqual(Object.keys(record).sort(),['kind','questionId','runId']);assert.equal(record.runId,originalId);
 release.resolve();await first;
 await ui.action('writing-suggest');await ui.action('writing-preview');await ui.action('writing-new-run');assert.equal(ui.current().attempt.runId,originalId);assert.equal(ui.requests.length,2);
 const beforeFlush=ui.flushCount;await ui.action('writing-recover');assert.equal(ui.flushCount,beforeFlush);assert.equal(ui.requests.at(-1).method,'GET');assert.ok(ui.requests.at(-1).path.includes('runId='+originalId));
 assert.equal(ui.current().proposal.id,originalId);assert.equal(ui.current().tone,'技术复盘');assert.equal(ui.current().attempt,null);assert.equal(pendingRecords(ui.store).length,0);
 await ui.action('writing-suggest');assert.equal(ui.requests.filter(call=>call.method==='POST'&&call.path.endsWith('/suggest')).length,1);
 await ui.action('writing-select-direction',{directionId:'direction-2'});assert.equal(ui.current().selected.id,'direction-2');assert.equal(ui.current().draftCostConfirmed,false);
});

test('a new page discovers minimal pending metadata and restores a proposal without models or automatic requests',async()=>{
 const store=storage();let saved;
 const first=harness({store,request:async call=>{if(call.path.endsWith('/preview'))return {plan};saved=proposal(call.body.runId);throw Error('response lost');}});
 await readyDirections(first);await first.action('writing-suggest');
 const reopened=harness({store,request:async call=>{assert.equal(call.method,'GET');return {run:{id:saved.id,kind:'plan',state:'complete',brandId:'brand-1',questionId:'question-1'},proposal:saved};}});
 reopened.g.serverConnections=[];reopened.open();assert.equal(reopened.requests.length,0);assert.equal(reopened.current().attempt.runId,saved.id);assert.match(reopened.body.innerHTML,/核对已保存结果/);
 await reopened.action('writing-recover');assert.equal(reopened.current().proposal.directions.length,4);assert.equal(reopened.requests.length,1);assert.equal(reopened.flushCount,0);
});

test('draft double-click and lost response reopen the same article without replacing later local edits',async()=>{
 const sent=deferred(),release=deferred(),store=storage();let runId;
 const ui=harness({store,request:async call=>{runId=call.body.runId;sent.resolve();await release.promise;throw Error('draft saved, response lost');}});readyDraft(ui);
 const first=ui.action('writing-generate-draft');await sent.promise;await ui.action('writing-generate-draft');assert.equal(ui.requests.length,1);
 const record=JSON.parse(pendingRecords(store)[0][1]);assert.equal(record.kind,'generate');assert.equal(record.proposalId,'plan-existing');assert.equal(record.directionId,'direction-1');assert.equal(record.runId,runId);
 release.resolve();await first;await ui.action('writing-generate-draft');assert.equal(ui.requests.length,1);
 const reopened=harness({store,request:async call=>{assert.equal(call.method,'GET');return {run:{id:runId,kind:'generate',state:'complete',brandId:'brand-1',questionId:'question-1',proposalId:'plan-existing',directionId:'direction-1'},id:'article-1',state:{contents:[{id:'article-1',brandId:'brand-1',text:'server snapshot'}]},revision:15};}});
 reopened.g.state.contents.push({id:'article-1',brandId:'brand-1',text:'user edited after generation'},{id:'other',brandId:'brand-1',text:'keep this too'});const before=structuredClone(reopened.g.state);
 reopened.open();await reopened.action('writing-recover');assert.deepEqual(reopened.g.state,before);assert.deepEqual(reopened.opened,['article-1']);assert.equal(reopened.g.serverRevision,10);assert.equal(reopened.requests.length,1);assert.equal(reopened.flushCount,0);assert.equal(pendingRecords(store).length,0);
});

test('draft recovery inserts only the missing original article and preserves the rest of the workspace',async()=>{
 const ui=harness({request:async call=>{
  if(call.method==='POST')throw Error('response lost');
  const record=ui.current().attempt;return {run:{id:record.runId,kind:'generate',state:'complete',brandId:'brand-1',questionId:'question-1'},id:'article-1',state:{currentBrand:'other',contents:[{id:'article-1',brandId:'brand-1',text:'original saved article'},{id:'foreign',brandId:'brand-2'}]},revision:11};
 }});readyDraft(ui);await ui.action('writing-generate-draft');await ui.action('writing-recover');
 assert.equal(ui.g.state.contents.length,1);assert.equal(ui.g.state.contents[0].id,'article-1');assert.equal(ui.g.state.currentBrand,'brand-1');assert.equal(ui.g.serverRevision,11);assert.deepEqual(ui.opened,['article-1']);
});

test('running and missing results never resend; a new attempt requires lookup, explicit reset and fresh cost confirmation',async()=>{
 let lookupState='running';const ui=harness({request:async call=>{
  if(call.path.endsWith('/preview'))return {plan};
  if(call.path.endsWith('/suggest'))throw Error('unknown result');
  if(lookupState==='missing')throw Object.assign(Error('not found'),{status:404});
  return {run:{id:ui.current().attempt.runId,kind:'plan',state:lookupState,brandId:'brand-1',questionId:'question-1'}};
 }});await readyDirections(ui);await ui.action('writing-suggest');const original=ui.current().runId;
 await ui.action('writing-new-run');assert.equal(ui.current().attempt.runId,original);
 await ui.action('writing-recover');assert.equal(ui.current().attempt.status,'running');await ui.action('writing-new-run');assert.equal(ui.current().attempt.runId,original);assert.doesNotMatch(ui.body.innerHTML,/data-action="writing-new-run"/);
 lookupState='missing';await ui.action('writing-recover');assert.match(ui.body.innerHTML,/未找到不代表没有产生费用/);assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);
 ui.confirmation=false;await ui.action('writing-new-run');assert.equal(ui.current().attempt.runId,original);
 ui.confirmation=true;await ui.action('writing-new-run');assert.equal(ui.current().attempt,null);assert.equal(ui.current().plan,null);assert.equal(ui.current().costConfirmed,false);
 await ui.action('writing-suggest');assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);
 await ui.action('writing-preview');await ui.action('writing-suggest');assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);
 ui.change('[data-writing-cost-confirm]',true);await ui.action('writing-suggest');assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,2);assert.notEqual(ui.current().runId,original);
});

test('failed, deleted and malformed results remain read-only until a separately confirmed attempt',async()=>{
 for(const mode of ['failed','deleted','malformed']){
  const ui=harness({request:async call=>{
   if(call.path.endsWith('/preview'))return {plan};if(call.path.endsWith('/suggest'))throw Error('response lost');
   if(mode==='deleted')throw Object.assign(Error('原稿已删除'),{status:410});
   const id=ui.current().attempt.runId;return {run:{id,kind:'plan',state:mode==='failed'?'failed':'complete',brandId:'brand-1',questionId:'question-1',error:'供应商请求未完成'},proposal:{...proposal(id),directions:[],parseError:'方向格式不完整'}};
  }});await readyDirections(ui);await ui.action('writing-suggest');await ui.action('writing-recover');await ui.action('writing-suggest');
  assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);assert.equal(ui.current().attempt.checked,true);assert.equal(ui.current().proposal,null);assert.match(ui.body.innerHTML,/核对后，重新开始一次/);
 }
});

test('an explicitly restarted draft keeps the chosen direction but requires a new draft plan and fee confirmation',async()=>{
 const ui=harness({request:async call=>{
  if(call.path.endsWith('/generate'))throw Error('unknown draft result');
  if(call.path.endsWith('/draft-preview'))return {plan};
  const attempt=ui.current().attempt;return {run:{id:attempt.runId,kind:'generate',state:'failed',brandId:'brand-1',questionId:'question-1',proposalId:'plan-existing',directionId:'direction-1'}};
 }});readyDraft(ui);await ui.action('writing-generate-draft');const first=ui.current().draftRunId;await ui.action('writing-recover');await ui.action('writing-new-run');
 assert.equal(ui.current().selected.id,'direction-1');assert.equal(ui.current().proposal.id,'plan-existing');assert.equal(ui.current().draftPlan,null);assert.equal(ui.current().draftCostConfirmed,false);
 await ui.action('writing-generate-draft');assert.equal(ui.requests.filter(call=>call.path.endsWith('/generate')).length,1);
 await ui.action('writing-draft-preview');ui.change('[data-writing-draft-cost-confirm]',true);await ui.action('writing-generate-draft');assert.notEqual(ui.current().draftRunId,first);assert.equal(ui.requests.filter(call=>call.path.endsWith('/generate')).length,2);assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,0);
});

test('scope changes isolate recovery records and late responses cannot alter another brand, workspace, owner or actor',async()=>{
 for(const switchScope of [ui=>{ui.g.state.currentBrand='brand-2';},ui=>{ui.store.setItem('geo.workspace','workspace-other');},ui=>{ui.g.accessInfo.current.owner='other-owner';},ui=>{ui.g.accessInfo.current.actor='other-actor';}]){
  const sent=deferred(),release=deferred();let saved;
  const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};saved=proposal(call.body.runId);sent.resolve();await release.promise;return {proposal:saved};}});
  await readyDirections(ui);const request=ui.action('writing-suggest');await sent.promise;switchScope(ui);ui.open();const current=ui.current(),html=ui.body.innerHTML;
  assert.equal(current.attempt,null);release.resolve();await request;assert.equal(ui.current(),current);assert.equal(current.proposal,null);assert.equal(ui.body.innerHTML,html);assert.equal(pendingRecords(ui.store).length,1);
 }
});

test('closing the drawer or page leaves late draft responses recoverable without opening or changing other content',async()=>{
 for(const close of [ui=>{ui.drawer.open=false;ui.listeners.close({target:ui.drawer});},ui=>ui.windowListeners.pagehide()]){
  const sent=deferred(),release=deferred();const ui=harness({request:async()=>{sent.resolve();await release.promise;return {id:'late',state:{contents:[{id:'late',brandId:'brand-1',text:'late result'}]},revision:11};}});readyDraft(ui);
  const first=ui.action('writing-generate-draft');await sent.promise;close(ui);ui.body.innerHTML='<p>Other content</p>';release.resolve();await first;
  assert.equal(ui.current(),null);assert.equal(ui.g.state.contents.length,0);assert.equal(ui.opened.length,0);assert.equal(ui.body.innerHTML,'<p>Other content</p>');assert.equal(pendingRecords(ui.store).length,1);
 }
});

test('late GET and a mismatched result cannot restore data across scope boundaries',async()=>{
 const sent=deferred(),release=deferred();const ui=harness({request:async call=>{
  if(call.path.endsWith('/preview'))return {plan};if(call.path.endsWith('/suggest'))throw Error('lost');
  const id=ui.current().attempt.runId;sent.resolve();await release.promise;return {run:{id,kind:'plan',state:'complete',brandId:'brand-1',questionId:'question-1'},proposal:proposal(id)};
 }});await readyDirections(ui);await ui.action('writing-suggest');const lookup=ui.action('writing-recover');await sent.promise;ui.g.state.currentBrand='brand-2';ui.open();const current=ui.current();release.resolve();await lookup;assert.equal(ui.current(),current);assert.equal(current.proposal,null);
 const mismatch=harness({store:ui.store,request:async()=>({run:{id:'wrong-id',kind:'plan',state:'complete',brandId:'brand-2',questionId:'question-2'},proposal:proposal('wrong-id','brand-2','question-2')})});mismatch.open();await mismatch.action('writing-recover');assert.equal(mismatch.current().proposal,null);assert.equal(mismatch.current().attempt.status,'unknown');
});

test('unavailable storage blocks a new paid request without throwing and keeps the same unsent identifier',async()=>{
 const store=storage(),set=store.setItem;store.setItem=()=>{throw Error('storage denied');};
 const ui=harness({store,request:async call=>{if(call.path.endsWith('/preview'))return {plan};return {proposal:proposal(call.body.runId)};}});
 await readyDirections(ui);await ui.action('writing-suggest');const id=ui.current().runId;assert.ok(id);assert.equal(ui.requests.length,1);assert.match(ui.current().error,/尚未调用模型/);assert.equal(ui.current().pending,false);
 await ui.action('writing-suggest');assert.equal(ui.current().runId,id);assert.equal(ui.requests.length,1);
 store.setItem=set;await ui.action('writing-suggest');assert.equal(ui.requests.at(-1).body.runId,id);assert.equal(ui.current().proposal.id,id);
 const inaccessible=harness({store:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){}}});assert.doesNotThrow(()=>inaccessible.open());await inaccessible.action('writing-preview');assert.equal(inaccessible.requests.length,0);
});

test('no owner means no recovery lookup or model request even if storage contains another session record',async()=>{
 const store=storage();const owner=harness({store,request:async call=>{if(call.path.endsWith('/preview'))return {plan};throw Error('lost');}});await readyDirections(owner);await owner.action('writing-suggest');
 const anonymous=harness({store,owner:''});anonymous.open();await anonymous.action('writing-recover');await anonymous.action('writing-preview');await anonymous.action('writing-suggest');assert.equal(anonymous.requests.length,0);assert.equal(anonymous.current().attempt,null);assert.match(anonymous.body.innerHTML,/无法确认当前登录或工作区/);
});

test('editing requirements preserves prior cards, invalidates spending and replaces them only after a confirmed result',async()=>{
 const sent=deferred(),release=deferred();let round=0;
 const ui=harness({request:async call=>{
  if(call.path.endsWith('/preview'))return {plan:{...plan,refinement:{instruction:call.body.instruction}}};
  round++;if(round===2){sent.resolve();await release.promise;}
  return {proposal:{...proposal(call.body.runId),refinement:{instruction:call.body.instruction,previousProposalId:call.body.previousProposalId}}};
 }});
 await readyDirections(ui);await ui.action('writing-suggest');const original=ui.current().proposal;
 await ui.action('writing-select-direction',{directionId:'direction-1'});ui.run('writingConversationState.draftPlan='+JSON.stringify(plan)+';writingConversationState.draftCostConfirmed=true');
 ui.input('[data-writing-instruction]','更偏客户，少用技术术语');assert.equal(ui.current().proposal,original);assert.equal(ui.current().selected,null);assert.equal(ui.current().draftCostConfirmed,false);assert.equal(ui.requests.length,2);
 await ui.action('writing-preview');assert.equal(ui.current().proposal,original);assert.equal(ui.requests.at(-1).body.previousProposalId,original.id);assert.equal(ui.requests.at(-1).body.instruction,'更偏客户，少用技术术语');
 ui.change('[data-writing-cost-confirm]',true);ui.input('[data-writing-instruction]','更偏客户，并增加资料核对步骤');assert.equal(ui.current().plan,null);assert.equal(ui.current().costConfirmed,false);
 await ui.action('writing-suggest');assert.equal(round,1);
 await ui.action('writing-preview');ui.change('[data-writing-cost-confirm]',true);const send=ui.action('writing-suggest');await sent.promise;assert.equal(ui.current().proposal,original);await ui.action('writing-suggest');assert.equal(round,2);
 release.resolve();await send;assert.notEqual(ui.current().proposal.id,original.id);assert.equal(ui.current().proposal.refinement.previousProposalId,original.id);assert.equal(ui.current().instruction,'');assert.equal(ui.current().plan,null);assert.equal(ui.current().attempt,null);
});

test('lost refinement response keeps the prior proposal and recovers the new proposal through read-only lookup',async()=>{
 let round=0,saved;
 const ui=harness({request:async call=>{
  if(call.path.endsWith('/preview'))return {plan};
  if(call.path.includes('/result?'))return {run:{id:saved.id,kind:'plan',state:'complete',brandId:'brand-1',questionId:'question-1'},proposal:saved};
  saved={...proposal(call.body.runId),refinement:{instruction:call.body.instruction,previousProposalId:call.body.previousProposalId}};if(++round===2)throw Error('lost refined result');return {proposal:saved};
 }});
 await readyDirections(ui);await ui.action('writing-suggest');const original=ui.current().proposal;
 ui.input('[data-writing-instruction]','突出真实资料整理案例');await ui.action('writing-preview');ui.change('[data-writing-cost-confirm]',true);await ui.action('writing-suggest');
 assert.equal(ui.current().proposal,original);assert.ok(ui.current().attempt);await ui.action('writing-preview');await ui.action('writing-suggest');assert.equal(round,2);
 await ui.action('writing-recover');assert.equal(ui.current().proposal.id,saved.id);assert.equal(ui.current().proposal.refinement.instruction,'突出真实资料整理案例');assert.equal(round,2);assert.equal(ui.requests.at(-1).method,'GET');
});

test('changing writing combinations keeps previous directions while changing the customer question clears them',async()=>{
 const ui=harness({request:async call=>call.path.endsWith('/preview')?{plan}:{proposal:proposal(call.body.runId)}});await readyDirections(ui);await ui.action('writing-suggest');const original=ui.current().proposal;
 await ui.action('writing-choice',{writingKey:'tone',writingValue:'客户易读'});assert.equal(ui.current().proposal,original);assert.equal(ui.current().plan,null);assert.equal(ui.requests.length,2);
 ui.change('[data-writing-question]','question-2');assert.equal(ui.current().proposal,null);assert.equal(ui.current().instruction,'');assert.equal(ui.requests.length,2);
});

test('first-round requirements survive preview and a later edit invalidates the previous fee confirmation',async()=>{
 const ui=harness({request:async call=>call.path.endsWith('/preview')?{plan}:{proposal:proposal(call.body.runId)}});ui.open();
 ui.input('[data-writing-instruction]','给采购负责人看，强调交付物');assert.equal(ui.requests.length,0);await ui.action('writing-preview');assert.equal(ui.requests.at(-1).body.instruction,'给采购负责人看，强调交付物');assert.equal(ui.requests.at(-1).body.previousProposalId,'');
 ui.change('[data-writing-cost-confirm]',true);ui.input('[data-writing-instruction]','给采购负责人看，强调交付物与适用范围');assert.equal(ui.current().plan,null);assert.equal(ui.current().planInput,null);assert.equal(ui.current().costConfirmed,false);
 await ui.action('writing-suggest');assert.equal(ui.requests.length,1);await ui.action('writing-preview');ui.change('[data-writing-cost-confirm]',true);await ui.action('writing-suggest');assert.equal(ui.requests.at(-1).body.instruction,'给采购负责人看，强调交付物与适用范围');assert.equal(ui.requests.filter(call=>call.path.endsWith('/suggest')).length,1);
});


test('question origin is shown only from matching evidence and never implies query popularity',()=>{
 const ui=harness();ui.open();assert.match(ui.body.innerHTML,/原始来源未标注/);assert.match(ui.body.innerHTML,/不代表高频搜索问题/);assert.equal(ui.requests.length,0);
 const q=ui.g.state.questions[0];q.discoveryId='discovery-1';q.candidateId='candidate-1';
 ui.g.state.questionDiscoveries=[{id:'discovery-1',brandId:'brand-2',candidates:[{id:'candidate-1',text:q.text}]}];
 ui.run('renderWritingConversation()');assert.match(ui.body.innerHTML,/原始来源未标注/);
 ui.g.state.questionDiscoveries[0].brandId='brand-1';ui.run('renderWritingConversation()');assert.match(ui.body.innerHTML,/AI 生成的候选问题/);
 q.text='客户修改后的问题';ui.run('renderWritingConversation()');assert.match(ui.body.innerHTML,/AI 候选修改后的问题/);
 q.demo=true;ui.run('renderWritingConversation()');assert.match(ui.body.innerHTML,/来源：演示问题/);assert.equal(ui.requests.length,0);
});
test('topic selection shows the selected imported question source and folded record without opening another drawer or calling a model',()=>{
 const ui=harness();ui.g.GEO_QUESTION_IMPORT=questionImport;ui.g.btn=()=>{throw Error('Writing source details must not replace its drawer')};
 vm.runInContext(readFileSync(new URL('../public/questions.js',import.meta.url),'utf8'),ui.g);
 const q=ui.g.state.questions[0];q.provenance=questionProvenance({questionId:q.id,brandId:q.brandId,text:q.text,kind:'file_import',actor:'owner',recordedAt:'2026-11-13T00:00:00Z',details:{sourceName:'客户咨询.csv',format:'csv',row:12,importId:'receipt-123'}});
 ui.open();assert.match(ui.body.innerHTML,/来源：文件导入的问题/);assert.match(ui.body.innerHTML,/客户咨询.csv/);assert.match(ui.body.innerHTML,/原始行号/);assert.match(ui.body.innerHTML,/>12</);assert.match(ui.body.innerHTML,/<details class="writing-question-help">/);assert.doesNotMatch(ui.body.innerHTML,/data-action="question-file-receipt"/);assert.equal(ui.requests.length,0);
});

test('one whole-article consent approves a finite plan, sends directions only after a click, and drafts without another checkbox',async()=>{
 const articleBudget={previewHash:'article-preview',maxModelCalls:4,maxInputBytes:240000,maxOutputTokens:16800,estimatedMaxCny:null,validHours:168};
 const budget={id:'budget-fixture',provider:'fixture',eligible:true,availableStages:['draft']};
 const ui=harness({request:async(call,g)=>{
  if(call.path==='/api/content-conversation/preview')return {plan,articleBudget};
  if(call.path==='/api/writing-budget/approve')return {budget};
  if(call.path.endsWith('/suggest'))return {proposal:{...proposal(call.body.runId),writingBudgetId:budget.id}};
  if(call.path.endsWith('/draft-preview'))return {plan,budget};
  if(call.path.endsWith('/generate'))return {id:'article-budget',state:{contents:[{id:'article-budget',brandId:'brand-1',text:'已生成草稿',writingBudgetId:budget.id}]},revision:g.serverRevision+1};
  throw Error('unexpected '+call.path);
 }});
 ui.open();await ui.action('writing-preview');assert.equal(ui.requests.length,1);assert.match(ui.body.innerHTML,/金额无法估计/);assert.match(ui.body.innerHTML,/<details><summary>查看额度/);assert.doesNotMatch(ui.body.innerHTML,/输入预算上限.*token/);
 await ui.action('writing-suggest');assert.equal(ui.requests.length,1);
 ui.change('[data-writing-cost-confirm]',true);await ui.action('writing-suggest');assert.deepEqual(ui.requests.slice(1).map(x=>x.path),['/api/writing-budget/approve','/api/content-conversation/suggest']);assert.equal(ui.requests[1].body.confirmCost,true);assert.equal(ui.requests[2].body.writingBudgetId,budget.id);assert.equal(ui.requests[2].body.confirmCost,undefined);
 await ui.action('writing-select-direction',{directionId:'direction-1'});await ui.action('writing-draft-preview');assert.equal(ui.current().draftCostConfirmed,true);assert.match(ui.body.innerHTML,/完整草稿已包含/);assert.doesNotMatch(ui.body.innerHTML,/data-writing-draft-cost-confirm/);assert.equal(ui.requests.filter(x=>x.path.endsWith('/generate')).length,0);
 await ui.action('writing-generate-draft');assert.equal(ui.requests.at(-1).body.writingBudgetId,budget.id);assert.equal(ui.requests.at(-1).body.confirmCost,undefined);assert.deepEqual(ui.opened,['article-budget']);
});
test('customers may choose the existing single-step path instead of authorizing the whole article',async()=>{
 const ui=harness({request:async call=>call.path.endsWith('/preview')?{plan,articleBudget:{maxModelCalls:4,maxInputBytes:240000,maxOutputTokens:16800,estimatedMaxCny:null,validHours:168}}:{proposal:proposal(call.body.runId)}});
 await readyDirections(ui);await ui.action('writing-single-step');assert.equal(ui.current().costConfirmed,false);await ui.action('writing-suggest');assert.equal(ui.requests.length,1);ui.change('[data-writing-cost-confirm]',true);await ui.action('writing-suggest');assert.equal(ui.requests.length,2);assert.equal(ui.requests[1].body.confirmCost,true);assert.equal(ui.requests[1].body.writingBudgetId,undefined);
});
