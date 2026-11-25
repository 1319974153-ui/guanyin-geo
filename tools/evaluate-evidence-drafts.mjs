import fs from 'node:fs';
import assert from 'node:assert/strict';
import {EVIDENCE_DRAFT_VERSION,evidenceFirstPlan,evidenceDraftFormat,evidenceFirstMessages,composeEvidenceFirstDraft} from '../src/evidence-first-draft.js';

const [model,out,mode='pilot']=process.argv.slice(2);
if(!['pilot','full'].includes(mode))throw Error('评测模式须为 pilot 或 full');
if(!model||!out||!/^[-.\w]+(?::[-.\w]+)?$/u.test(model))throw Error('用法：node tools/evaluate-evidence-drafts.mjs 已安装的模型 评测回执.json');
const base='http://127.0.0.1:11434';
const data=JSON.parse(fs.readFileSync(new URL('../test/fixtures/evidence-draft-pilot.json',import.meta.url),'utf8'));
const tags=await fetch(base+'/api/tags',{redirect:'error',signal:AbortSignal.timeout(5000)}).then(r=>r.json());
if(!tags.models?.some(m=>m.name===model))throw Error('所选模型未安装；验收脚本不会替你下载模型。');
const tasks=data.flatMap(item=>[item,...(mode==='full'?item.additionalQuestions.map((question,index)=>({...item,id:item.id+'-'+(index+2),question})):[])]);
const receipt={protocolVersion:EVIDENCE_DRAFT_VERSION,startedAt:new Date().toISOString(),model,scope:tasks.length+' 个任务，6 类虚构品牌；原文待编辑人工复核。',runs:[]};
const write=()=>fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
write();
for(const item of tasks){
 const at=Date.now(),plan=evidenceFirstPlan({brand:{name:item.name},question:item.question,facts:item.facts,contract:{selection:item.selection}});
 assert.ok(plan);
 try{
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(150000),body:JSON.stringify({model,messages:evidenceFirstMessages(plan),stream:false,think:false,format:evidenceDraftFormat,keep_alive:'5m',options:{temperature:0,num_predict:800,num_ctx:4096}})});
  if(!response.ok)throw Error('HTTP '+response.status);
  const raw=await response.json();
  if(!raw.done||typeof raw.message?.content!=='string')throw Error('本机模型没有返回完整结果');
  const draft=composeEvidenceFirstDraft(plan,raw.message.content);
  receipt.runs.push({id:item.id,industry:item.industry,question:item.question,facts:item.facts,knownGap:item.unconfirmed,durationMs:Date.now()-at,inputTokens:raw.prompt_eval_count,outputTokens:raw.eval_count,modelOutput:raw.message.content,...draft,editorialStatus:'not_reviewed'});
  console.log(item.id,draft.outcome);
 }catch(error){receipt.runs.push({id:item.id,industry:item.industry,error:error.message,editorialStatus:'not_run'});console.error(item.id,error.message);}
 write();
}
receipt.completedAt=new Date().toISOString();write();
