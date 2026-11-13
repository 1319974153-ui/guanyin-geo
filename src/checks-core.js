import {competitorInput,competitorStale,parseCompetitors} from './competitor-core.js';
import {jsonrepair} from 'jsonrepair';
// Shared validation and local checks. Model suggestions never change human labels.
export const CHECK_VERSION=3;
export const CHECK_PARSE_VERSION=4;
export const CONTENT_REVIEW_VERSION=1;
export const CONTENT_REVIEW_DIMENSIONS=[
 {id:'answer_completeness',label:'答题完整度'},
 {id:'title_fulfillment',label:'标题兑现'},
 {id:'format_fit',label:'文体契合'},
 {id:'promotional_repetition',label:'重复宣传'},
 {id:'evidence_grounding',label:'事实依据定位'}
];
import {factUsable,factDisclosure,contentDisclosureConflict} from './knowledge-core.js';
export {factUsable} from './knowledge-core.js';
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
// Persisted disclosure and legacy confidentiality flags share the same deny rule.
export const checkFactDisclosable=f=>factDisclosure(f)==='public';
function shingles(s){const t=normalize(s),out=new Set();for(let i=0;i+3<=t.length;i++)out.add(t.slice(i,i+3));return out;}
export function duplicates(target,contents){
 const a=shingles(target.text);if(normalize(target.text).length<30)return [];
 return contents.filter(c=>c.id!==target.id&&normalize(c.text).length>=30).map(c=>{
  const b=shingles(c.text);let shared=0;for(const v of a)if(b.has(v))shared++;
  const score=shared/(a.size+b.size-shared||1),paragraph=String(target.text).split(/\n+/).filter(t=>normalize(t).length>=20&&String(c.text).includes(t)).sort((x,y)=>y.length-x.length)[0]||'';
  return {id:c.id,title:c.title||'',score:Math.round(score*1000)/1000,quote:paragraph.slice(0,500)};
 }).filter(c=>c.score>=.45||c.quote).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,5);
}
export function checkInput(state,brandId,kind,ids,at=new Date().toISOString()){
 if(kind==='competitor')return competitorInput(state,brandId,ids);
 const b=state.brands.find(b=>b.id===brandId);if(!b)return null;
 const list=(kind==='answer'?state.answers:state.contents).filter(x=>x.brandId===brandId);
 const targets=ids.map(id=>list.find(x=>x.id===id));if(targets.some(x=>!x))return null;
 const facts=state.facts.filter(f=>f.brandId===brandId).map(f=>({id:f.id,key:f.key||'',value:f.value||'',source:f.source||'',sourceDocumentId:f.sourceDocumentId||'',productId:f.productId||'',status:f.status||'',expiresAt:f.expiresAt||'',validFrom:f.validFrom||'',version:f.version||0,...(f.disclosure!==undefined?{disclosure:f.disclosure}:{}),usable:factUsable(f,at)&&checkFactDisclosable(f)})).sort((a,b)=>a.id.localeCompare(b.id));
 return {version:kind==='content'?CHECK_VERSION:2,kind,brand:{id:b.id,name:b.name,aliases:b.aliases||'',industry:b.industry||''},facts,targets:targets.map(t=>({id:t.id,...(contentDisclosureConflict(state,t)?{blockedForDisclosure:true}:{}),productId:t.productId??null,title:kind==='content'?t.title||'':'',text:t.text||'',question:t.questionText||t.questionSnapshot||t.question||(kind==='content'?t.writingBasis?.qualityPlan?.readerQuestion:'')||'',...(kind==='content'?{factIds:[...(t.factIds||[])],duplicates:duplicates(t,list.filter(c=>!contentDisclosureConflict(state,c))),articleContract:t.writingBasis?.articleContract?structuredClone(t.writingBasis.articleContract):null,style:t.style||t.writingBasis?.style||'',brief:t.brief||t.writingBasis?.brief||''}:{})}))};
}
export function checkStale(record,state,at=new Date().toISOString()){
 if(record.kind==='competitor')return competitorStale(record,state);
 const current=checkInput(state,record.brandId,record.kind,record.input.targets.map(t=>t.id),at);
 if(current&&record.kind==='content'&&record.input.version===2){current.version=2;for(const target of current.targets){delete target.articleContract;delete target.style;delete target.brief;const original=state.contents.find(c=>c.id===target.id);target.question=original.questionText||original.questionSnapshot||original.question||'';}}
 return !current||JSON.stringify(current)!==JSON.stringify(record.input);
}
const enumValue=(v,choices)=>choices.includes(v)?v:null;
function excerpt(quote,source){return typeof quote==='string'&&quote.trim().length>=4&&quote.length<=1200&&source.includes(quote)?quote:null;}
const reason=v=>String(v||'模型未说明原因').slice(0,600);
function quoteEscapesOnly(before,after){let i=0,j=0,added=0;while(i<before.length&&j<after.length){if(before[i]===after[j]){i++;j++;}else if(before[i]==='"'&&after[j]==='\\'&&after[j+1]==='"'){j++;added++;}else return 0;}return i===before.length&&j===after.length?added:0;}
const boundedText=(v,max=600)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():null;
function editorialReview(raw,input,target){
 const empty={version:CONTENT_REVIEW_VERSION,status:'not_available',dimensions:[],suggestions:[],excluded:[]};
 // Re-parsing an old receipt cannot invent an assessment the model never made.
 if(input.version<3)return empty;
 const dimensions=[],excluded=[],rows=raw?.dimensions;
 if(!Array.isArray(rows)||rows.length>15)return {...empty,status:'incomplete',excluded:[{id:'',reason:'未返回有效的五项文章审校列表。'}]};
 for(const dimension of CONTENT_REVIEW_DIMENSIONS){
  const matches=rows.filter(row=>row?.id===dimension.id),row=matches[0];let problem='';
  if(matches.length!==1){excluded.push({id:dimension.id,reason:'此项审校缺失或重复，未采纳。'});continue;}
  const status=enumValue(row.status,['needs_revision','satisfactory','not_assessable']),location=enumValue(row.location,['title','body']),issue=boundedText(row.issue),suggestion=typeof row.suggestion==='string'&&row.suggestion.length<=600?row.suggestion.trim():null,priority=enumValue(row.priority,['high','medium','low']);
  const source=location==='title'?target.title:location==='body'?target.text:'',quote=typeof row.quote==='string'&&row.quote.length<=1200&&row.quote.trim().length>=2&&source.includes(row.quote)?row.quote:'';
  if(!status||!issue||suggestion===null||!priority||status!=='satisfactory'&&!suggestion)problem='判断、问题说明、修改建议或优先级无效。';
  if(!quote&&!(status==='not_assessable'&&row.quote===''&&row.location===''))problem='原句无法在指定的标题或正文中逐字定位。';
  if(status==='satisfactory'&&dimension.id==='answer_completeness'&&!target.question)problem='未记录目标问题，不能判断回答已完整。';
  if(status==='satisfactory'&&dimension.id==='format_fit'&&!target.articleContract&&!target.style)problem='未记录文章类型，不能判断文体已符合要求。';
  const factId=typeof row.factId==='string'?row.factId:null,factQuote=typeof row.factQuote==='string'?row.factQuote:null;
  const fact=input.facts.find(f=>f.id===factId&&f.usable&&checkFactDisclosable(f)&&(!f.productId||f.productId===target.productId));
  if(factId===null||factQuote===null||(factId||factQuote)&&(!fact||!factQuote||factQuote.trim().length<2||factQuote.length>1200||!fact.value.includes(factQuote)))problem='引用资料不存在、已失效、属于其他产品，或事实原句无法定位。';
  if(status==='satisfactory'&&dimension.id==='evidence_grounding'&&!factId)problem='事实依据定位未提供有效资料，不能判断依据充分。';
  if(problem){excluded.push({id:dimension.id,reason:problem});continue;}
  dimensions.push({id:dimension.id,label:dimension.label,status,location:quote?location:'',quote,issue,suggestion,priority,factId,factQuote});
 }
 if(rows.some(row=>!CONTENT_REVIEW_DIMENSIONS.some(d=>d.id===row?.id)))excluded.push({id:'',reason:'含未知审校项目，已排除。'});
 const suggestions=dimensions.filter(d=>d.status==='needs_revision').slice().sort((a,b)=>['high','medium','low'].indexOf(a.priority)-['high','medium','low'].indexOf(b.priority));
 return {version:CONTENT_REVIEW_VERSION,status:excluded.length||dimensions.some(d=>d.status==='not_assessable')?'incomplete':'needs_editor_review',dimensions,suggestions,excluded};
}
export function currentContentReview(state,brandId,contentId){
 const record=(state.analysisChecks||[]).filter(r=>r.kind==='content'&&r.brandId===brandId&&r.input?.targets?.some(t=>t.id===contentId)).at(-1);
 if(!record||record.input.version<3||record.parserVersion!==CHECK_PARSE_VERSION||record.parseError||checkStale(record,state))return null;
 // Use validated raw receipt data, never a client-supplied list of suggestions.
 const parsed=parseChecks(record.rawText||'',record.input);if(parsed.parseError)return null;
 const review=parsed.results.find(r=>r.id===contentId)?.editorialReview;if(!review||review.status==='not_available')return null;
 return {runId:record.id,inputHash:record.inputHash,created:record.created,...review};
}
export function parseChecks(raw,input){
 if(input.kind==='competitor')return parseCompetitors(raw,input);
 const text=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''),meta={parserVersion:CHECK_PARSE_VERSION};let data;
 try{data=JSON.parse(text)}catch{try{const repaired=jsonrepair(text),addedEscapes=quoteEscapesOnly(text,repaired);if(!addedEscapes)throw new Error('unsupported repair');data=JSON.parse(repaired);meta.parseRepair={library:'jsonrepair',version:'3.15.0',kind:'quote-escapes',addedEscapes};}catch{return {...meta,results:[],parseError:'模型未返回有效 JSON；原始回执已保留，未采纳为有效证据。'}}}
 if(!Array.isArray(data?.results)||data.results.length>10)return {...meta,results:[],parseError:'模型结果缺少有效检查列表；原始回执已保留。'};
 const results=input.targets.map(t=>{
  const rows=data.results.filter(x=>x&&x.id===t.id),row=rows.length===1?rows[0]:{},problems=[];
  if(rows.length!==1)problems.push('此条结果缺失或重复，未完成检查');
  const sentiment=input.kind==='answer'?enumValue(row.sentiment,['正面','中性','负面','混合','未提及','无法判断']):null;
  let sentimentQuote=input.kind==='answer'?excerpt(row.sentimentQuote,t.text):null;
  if(input.kind==='answer'&&(!sentiment||!['未提及','无法判断'].includes(sentiment)&&!sentimentQuote))problems.push('情感判断缺少有效原句，暂不采纳');
  const claims=[],excludedClaims=[];if(row.claims?.length>30||row.negations?.length>20)problems.push('模型返回条目超过单条上限，结果已截断，需补充检查');if(!Array.isArray(row.claims))problems.push('缺少逐项事实检查结果');
  else for(const c of row.claims.slice(0,30)){
   const quote=excerpt(c?.quote,[t.title,t.text].filter(Boolean).join('\n')),relation=enumValue(c?.relation,['支持','疑似冲突','缺少证据','条件遗漏']);
   if(!quote||!relation){problems.push('有事实判断缺少可定位原句，已排除');excludedClaims.push({quote:String(c?.quote||'').slice(0,1200),reason:!quote?'模型引句与正文不完全一致或超出长度限制，未采纳为证据。':'模型判断类型无法识别，未采纳为证据。'});continue;}
   const f=input.facts.find(f=>f.id===c.factId&&f.usable&&checkFactDisclosable(f)&&(!f.productId||f.productId===t.productId)),factQuote=f?excerpt(c.factQuote,f.value):null;
   if(relation!=='缺少证据'&&(!f||!factQuote)){problems.push('有事实判断引用无效、过期或其他产品线资料，已改为缺少证据');claims.push({quote,relation:'缺少证据',factId:'',factQuote:'',reason:'模型未提供当前产品线或品牌通用资料中的有效原文证据。'});continue;}
   claims.push({quote,relation,factId:factQuote?f.id:'',factQuote:factQuote||'',reason:reason(c.reason)});
  }
  const negations=[];if(input.kind==='answer'){
   if(!Array.isArray(row.negations))problems.push('缺少否定语境检查结果');
   else for(const n of row.negations.slice(0,20)){const quote=excerpt(n?.quote,t.text);if(quote)negations.push({quote,reason:reason(n.reason)});else problems.push('有否定语境未匹配原句，已排除');}
  }
  if(input.kind==='content'&&!claims.length)problems.push('没有可核对的事实条目，不能据此通过审核');
  const review=input.kind==='content'?editorialReview(row.editorialReview,input,t):null;
  if(review?.status==='incomplete')problems.push('文章语义审校未完整完成，请查看各项依据与缺项');
  return {id:t.id,sentiment:input.kind==='answer'&&sentiment&&(['未提及','无法判断'].includes(sentiment)||sentimentQuote)?sentiment:'无法判断',sentimentQuote:sentimentQuote||'',claims,excludedClaims,negations,...(review?{editorialReview:review}:{}),problems:[...new Set(problems)]};
 });
 if(data.results.some(x=>!input.targets.some(t=>t.id===x?.id)))return {...meta,results,parseError:'模型包含不属于本批次的记录，已排除；请核对本批结果。'};
 return {...meta,results,parseError:''};
}
