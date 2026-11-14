import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as GEO_METRICS from '../src/analytics-core.js';

function fixture(){
 const state={brands:[{id:'b1',name:'示例品牌',goalQuery:'怎样选择资料整理服务？'}],questions:[],answers:[],facts:[],contents:[],publications:[],competitors:[]};
 const report=GEO_METRICS.makeReport(state,'b1',{period:'all',to:'2026-11-12'},new Date('2026-11-12T00:00:00Z'));
 const storage=new Map(),calls=[],toasts=[];let brandId='b1';
 const g={GEO_METRICS,TextEncoder,Uint8Array,crypto,URLSearchParams,Date,console,report,calls,toasts,accessInfo:{current:{owner:'owner',actor:'owner',role:'owner',brands:[]}},sessionStorage:{getItem:k=>storage.get(k)||'',setItem:(k,v)=>storage.set(k,v)},brand:()=>({id:brandId}),document:{addEventListener(){}},setInterval(){},route:'reports',esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),btn:(text,action,classes,attrs='')=>`<button data-action="${action}" ${attrs}>${text}</button>`,runtimeFlush:async()=>{},canOperateTasks:()=>true,apiRequest:async(path,options)=>{calls.push({path,...options});return {saved:true}},toast:message=>toasts.push(message),render(){}};
 vm.createContext(g);for(const file of ['analytics.js','operations.js'])vm.runInContext(fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),g);
 g.changeBrand=id=>{brandId=id};g.newButton=()=>{const html=g.decisionReportPanel(report,true),key=html.match(/data-report-key="(\d+)"/)?.[1];return {isConnected:true,disabled:false,textContent:'加入改进待办',dataset:{id:'baseline',reportKey:key}}};return g;
}

test('only current reports expose one-click actions; archived and legacy reports remain read-only',()=>{
 const g=fixture();assert.match(g.decisionReportPanel(g.report,true),/operation-from-decision/);assert.doesNotMatch(g.decisionReportPanel(g.report),/operation-from-decision/);
 assert.equal(g.decisionReportPanel({...g.report,decision:null},true),'');for(const role of ['viewer','reviewer']){g.accessInfo.current.role=role;assert.doesNotMatch(g.decisionReportPanel(g.report,true),/operation-from-decision/)}
 g.accessInfo.current.role='owner';const button=g.newButton();g.decisionReportPanel(g.report,true);assert.throws(()=>g.decisionActionReport(button),/报告已变化/);
});

test('one click creates a pending improvement action, double clicks wait for the same request and never start model work',async()=>{
 const g=fixture(),button=g.newButton();let finish,started;const requestStarted=new Promise(resolve=>{started=resolve});
 g.apiRequest=async(path,options)=>{g.calls.push({path,...options});started();return new Promise(resolve=>{finish=resolve})};
 const first=g.operationsAction('operation-from-decision',button),second=g.operationsAction('operation-from-decision',button);await requestStarted;assert.equal(await second,true);assert.equal(g.calls.length,1);assert.equal(button.disabled,true);
 const input=JSON.parse(g.calls[0].body);assert.equal(g.calls[0].path,'/api/operations/actions');assert.equal(input.brandId,'b1');assert.equal(input.decision.id,'baseline');assert.equal(input.decision.token.length,64);assert.ok(!('id'in input));assert.ok(!('title'in input));
 finish({saved:true});assert.equal(await first,true);assert.equal(button.textContent,'已加入待办');assert.equal(g.toasts.length,1);assert.match(g.toasts[0],/未启动模型或发布/);
});

test('a lost save response can retry the same report fingerprint without inventing another action identity',async()=>{
 const g=fixture(),button=g.newButton();g.apiRequest=async(path,options)=>{g.calls.push({path,...options});if(g.calls.length===1)throw Error('连接中断');return {existing:true}};
 await assert.rejects(g.operationsAction('operation-from-decision',button),/连接中断/);assert.equal(button.disabled,false);await g.operationsAction('operation-from-decision',button);assert.equal(g.calls.length,2);assert.equal(g.calls[0].body,g.calls[1].body);assert.match(g.toasts[0],/已在待办中/);
});

test('switching brand or permissions before send cancels the write; a late response cannot alter another scope',async()=>{
 for(const change of [g=>g.changeBrand('b2'),g=>{g.accessInfo.current.role='viewer'},g=>{g.accessInfo.current.owner='different-owner'}]){
  const g=fixture(),button=g.newButton();let finish;g.runtimeFlush=()=>new Promise(resolve=>{finish=resolve});const pending=g.operationsAction('operation-from-decision',button);change(g);finish();await pending;assert.equal(g.calls.length,0);assert.equal(g.toasts.length,0);
 }
 const g=fixture(),button=g.newButton();let finish,started;const requestStarted=new Promise(resolve=>{started=resolve});g.apiRequest=async()=>{started();return new Promise(resolve=>{finish=resolve})};const pending=g.operationsAction('operation-from-decision',button);await requestStarted;g.changeBrand('b2');finish({saved:true});await pending;assert.equal(g.toasts.length,0);assert.equal(button.textContent,'加入改进待办');
});

test('saved decision origin displays its goal and original evidence range with escaped values',()=>{
 const g=fixture(),html=g.decisionOperationOrigin({kind:'decision',goalQuery:'<客户问题>',conclusion:'尚无样本',options:{from:'2026-11-01',to:'2026-11-12',surface:'import'},evidence:{currentIds:['a1','a2']}});
 assert.match(html,/&lt;客户问题>/);assert.match(html,/2026-11-01 — 2026-11-12/);assert.match(html,/a1、a2/);assert.equal(g.decisionOperationOrigin({kind:'manual'}),'');
});

test('diagnostic review shows exact blockers, original conditions and candidate counts without implying improvement',()=>{
 const g=fixture(),review={kind:'retest',ready:false,goalQuery:'<客户问题>',reasons:['引用标签尚未核对'],linkedAnswerIds:[],candidateAnswerIds:['new'],baselineGroups:1,coveredGroups:0,conditions:[{platform:'<平台>',entry:'web',mode:'联网搜索',model:'记录模型',region:'杭州',language:'zh-CN',questionVersion:'v1'}],method:'是否改善以同条件报告为准，不会启动采样'};
 const html=g.decisionReviewPanel({reviewReadiness:review});assert.match(html,/&lt;客户问题>/);assert.match(html,/&lt;平台>/);assert.match(html,/引用标签尚未核对/);assert.match(html,/覆盖 0 \/ 1 组/);assert.match(html,/查看与导入真实回答/);assert.doesNotMatch(html,/指标提升|已完成复核/);assert.equal(g.decisionReviewPanel({}), '');
 const completed=g.decisionReviewPanel({reviewReadiness:{...review,ready:true,reasons:[],linkedAnswerIds:['new'],coveredGroups:1},reviewReceipt:{checkedAt:'2026-11-12T08:00:00Z',linkedAnswerIds:['new']}});assert.match(completed,/复核回执：2026-11-12T08:00:00Z/);assert.match(completed,/以下检查反映当前记录/);
});

test('material review names the actual completion artifact without requiring publication for writing',()=>{
 const g=fixture(),review={kind:'content',ready:false,reasons:['需要审核 <原问题> 对应的稿件'],method:'只核对已审核稿件与原问题，不代表推荐提升'};
 const html=g.materialReviewPanel({evidenceReadiness:review});assert.match(html,/本项需要：已审核稿件/);assert.match(html,/&lt;原问题>/);assert.match(html,/href="#content"/);assert.doesNotMatch(html,/href="#publish"|必须公开/);
 const external=g.materialReviewPanel({evidenceReadiness:{...review,kind:'external',method:'来源身份与公开范围由人工登记，系统不判定第三方背书'}});assert.match(external,/人工登记/);assert.match(external,/不判定第三方背书/);assert.equal(g.materialReviewPanel({}), '');
});

test('typed actions only offer matching material and retain stale selections with a clear mismatch marker',()=>{
 const g=fixture(),match={kind:'content',id:'c1',title:'已审核相关稿件',at:'2026-11-12T09:00:00Z'},stale={kind:'site',id:'s1',title:'无关页面',at:'2026-11-12T09:00:00Z'};
 const refs=g.eligibleEvidence({evidenceReadiness:{candidateRefs:[match]},evidence:[match,stale]});assert.equal(refs.length,2);assert.equal(refs[0].id,'c1');assert.notEqual(refs[0].ineligible,true);assert.equal(refs[1].id,'s1');assert.equal(refs[1].ineligible,true);
 assert.equal(g.eligibleEvidence({evidenceReadiness:{candidateRefs:[]},evidence:[]}).length,0);
});

function credibilityButton(g,r=g.report){const html=g.credibilityReportPanel(r,true),key=html.match(/data-report-key="(\d+)"/)?.[1];return {isConnected:true,disabled:false,dataset:{id:'ranking',reportKey:key}};}
test('credibility actions are absent in archived/print sheets and only the exact live report key can open an action',async()=>{
 const g=fixture();g.badge=()=>'';g.percent=()=>'';g.table=()=>'';g.productCoveragePanel=()=>'';g.opportunitySummary=()=>'';g.sourceReportPanel=()=>'';
 const archived=g.evidenceReportSheet(g.report);assert.match(archived,/可信背书建设建议/);assert.doesNotMatch(archived,/operation-from-credibility|operation-from-decision/);assert.doesNotMatch(g.credibilityReportPanel(g.report),/operation-from-credibility/);
 for(const role of ['viewer','reviewer']){g.accessInfo.current.role=role;assert.doesNotMatch(g.credibilityReportPanel(g.report,true),/operation-from-credibility/)}g.accessInfo.current.role='owner';
 const old=credibilityButton(g);credibilityButton(g);await assert.rejects(g.operationsAction('operation-from-credibility',old),/报告.*已变化/);
 const detached=credibilityButton(g);detached.isConnected=false;await assert.rejects(g.operationsAction('operation-from-credibility',detached),/报告.*已变化/);
 assert.match(fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8'),/@media print\{[^}]*#main button\{display:none!important/);
});
test('credibility handoff uses the viewed report fingerprint, not a newly calculated report with the same item ID',async()=>{
 const g=fixture(),button=credibilityButton(g),opened=[];g.currentEvidenceReport=()=>{throw Error('must not recalculate the viewed report')};g.openOperation=async(a,origin)=>opened.push(origin);
 await g.operationsAction('operation-from-credibility',button);assert.equal(opened.length,1);assert.equal(opened[0].options,g.report.options);const item=g.report.credibilityPlan.items.find(x=>x.id==='ranking');assert.equal(opened[0].credibility.token,await g.credibilityDigest(item,g.report));assert.equal(g.calls.length,0,'opening a local action never invokes models or platforms');assert.equal(button.disabled,false);
});
test('credibility repeated clicks share preparation and report or brand changes cancel the old handoff',async()=>{
 const g=fixture(),button=credibilityButton(g),opened=[];let resume;g.runtimeFlush=()=>new Promise(r=>resume=r);g.openOperation=async()=>opened.push(true);
 const first=g.operationsAction('operation-from-credibility',button);assert.equal(await g.operationsAction('operation-from-credibility',button),true);resume();await first;assert.equal(opened.length,1);
 for(const change of [x=>credibilityButton(x),x=>x.changeBrand('b2'),x=>x.accessInfo.current.role='viewer']){
  const f=fixture(),el=credibilityButton(f);let finish;f.runtimeFlush=()=>new Promise(r=>finish=r);f.openOperation=async()=>{throw Error('stale handoff must not open')};const pending=f.operationsAction('operation-from-credibility',el);change(f);finish();try{await pending;}catch(e){assert.match(e.message,/报告.*已变化/)}assert.equal(f.calls.length,0);
 }
 const changed=fixture(),el=credibilityButton(changed);changed.changeBrand('b2');await assert.rejects(changed.operationsAction('operation-from-credibility',el),/报告或工作区已变化/);
});
test('report re-render while loading an action cannot open a stale credibility form',async()=>{
 const g=fixture(),button=credibilityButton(g);let finish,started;const loading=new Promise(r=>started=r);g.apiRequest=async()=>{started();return new Promise(r=>finish=r)};g.openDrawer=()=>{throw Error('stale form must not open')};
 const pending=g.operationsAction('operation-from-credibility',button);await loading;credibilityButton(g);finish({actions:[],assignees:[]});await assert.rejects(pending,/报告.*已变化/);assert.equal(button.disabled,false);
});
