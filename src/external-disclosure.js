import {factDisclosure,contentDisclosureConflict} from './knowledge-core.js';
import {reportDisclosureView} from './report-disclosure.js';

const list=v=>Array.isArray(v)?v:[];
const copyFields=(row,keys)=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
const publicRow=(row,state)=>factDisclosure(row)==='public'&&!contentDisclosureConflict(state,{...row,text:JSON.stringify(row)});
// This is a response projection only. Never use it as an input to workspace
// writes or private backups: originals and their history remain server-owned.
export function externalStateView(state){
 const out=copyFields(state,['version','experienceVersion','simpleExperienceVersion','viewMode','scope','currentBrand']);
 for(const [key,value]of Object.entries(state))if(Array.isArray(value))out[key]=[];
 for(const brand of list(state.brands)){
  const scoped={brand};
  for(const [key,value]of Object.entries(state))if(Array.isArray(value)&&key!=='brands')scoped[key]=value.filter(r=>r.brandId===brand.id&&publicRow(r,state));
  // Raw files and full check inputs have dedicated, authenticated readers. The
  // generic external state endpoint is not a complete business backup.
  const safe=reportDisclosureView(scoped,state);out.brands.push(safe.brand);
  for(const key of Object.keys(out))if(Array.isArray(out[key])&&key!=='brands')out[key].push(...list(safe[key]));
 }
 out.sourceDocuments=[];out.analysisChecks=[];
 out.disclosureView={schema:1,scope:'external_read',notice:'仅返回允许公开使用的资料；内部原文、关联内容和完整检查快照不通过此接口提供。完整资料仍保留在本机工作区与私有备份中。'};
 return out;
}

function privateCheckFacts(record,state){
 const current=list(state.facts).filter(f=>f.brandId===record.brandId&&factDisclosure(f)==='internal'),ids=new Set(current.map(f=>f.id));
 return [...current,...list(record.input?.facts).filter(f=>factDisclosure(f)==='internal'||ids.has(f.id))];
}
function containsPrivate(value,facts){
 const ids=new Set(facts.map(f=>f.id)),literals=[];
 for(const f of facts){for(const v of [f.value,f.source,...list(f.history).flatMap(h=>[h.values?.value,h.values?.source,h.before?.value,h.after?.value])])if(typeof v==='string'&&v.trim().length>=8)literals.push(v.trim());}
 const scan=(v,key='')=>{
  if(typeof v==='string')return key==='factId'&&ids.has(v)||literals.some(text=>v.includes(text));
  if(Array.isArray(v))return v.some(x=>scan(x,key));
  return !!v&&typeof v==='object'&&Object.entries(v).some(([k,x])=>scan(x,k));
 };
 return scan(value);
}
export function externalCheckSection(record,state,section='result'){
 const facts=privateCheckFacts(record,state),current=new Map(list(state.facts).filter(f=>f.brandId===record.brandId).map(f=>[f.id,f]));
 for(const target of list(record.input?.targets)){
  const stored=list(record.kind==='content'?state.contents:state.answers).find(r=>r.brandId===record.brandId&&r.id===target.id);
  if(target.blockedForDisclosure||stored&&!publicRow(stored,state)||!publicRow({...target,brandId:record.brandId},state)||containsPrivate(target,facts))return null;
 }
 let value=section==='raw'?String(record.rawText||''):section==='input'?structuredClone(record.input):copyFields(record,['results','parseError','parserVersion','parseRepair','parsingHistory','reviews','reviewVersion']);
 let filtered=false;
 if(section==='input'&&value){
  const before=JSON.stringify(value);
  value.facts=list(value.facts).filter(f=>f.usable===true&&f.status==='已确认'&&factDisclosure(f)==='public'&&factDisclosure(current.get(f.id)||{})==='public');
  const allowed=new Set(value.facts.map(f=>f.id));
  value.targets=list(value.targets).map(t=>({...t,...(Array.isArray(t.factIds)?{factIds:t.factIds.filter(id=>allowed.has(id))}:{})}));
  filtered=before!==JSON.stringify(value);
 }
 if(containsPrivate(value,facts))return null;
 return {text:typeof value==='string'?value:JSON.stringify(value),filtered};
}
