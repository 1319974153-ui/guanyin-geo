import {competitorInput,competitorStale,parseCompetitors} from './competitor-core.js';
import {jsonrepair} from 'jsonrepair';
// Shared validation and local checks. Model suggestions never change human labels.
export const CHECK_VERSION=2;
export const CHECK_PARSE_VERSION=3;
import {factUsable} from './knowledge-core.js';
export {factUsable} from './knowledge-core.js';
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
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
 const facts=state.facts.filter(f=>f.brandId===brandId).map(f=>({id:f.id,key:f.key||'',value:f.value||'',source:f.source||'',sourceDocumentId:f.sourceDocumentId||'',productId:f.productId||'',status:f.status||'',expiresAt:f.expiresAt||'',validFrom:f.validFrom||'',version:f.version||0,usable:factUsable(f,at)})).sort((a,b)=>a.id.localeCompare(b.id));
 return {version:CHECK_VERSION,kind,brand:{id:b.id,name:b.name,aliases:b.aliases||'',industry:b.industry||''},facts,targets:targets.map(t=>({id:t.id,productId:t.productId??null,title:kind==='content'?t.title||'':'',text:t.text||'',question:t.questionText||t.questionSnapshot||t.question||'',...(kind==='content'?{factIds:t.factIds||[],duplicates:duplicates(t,list)}:{})}))};
}
export function checkStale(record,state,at=new Date().toISOString()){
 if(record.kind==='competitor')return competitorStale(record,state);
 const current=checkInput(state,record.brandId,record.kind,record.input.targets.map(t=>t.id),at);
 return !current||JSON.stringify(current)!==JSON.stringify(record.input);
}
const enumValue=(v,choices)=>choices.includes(v)?v:null;
function excerpt(quote,source){return typeof quote==='string'&&quote.trim().length>=4&&quote.length<=1200&&source.includes(quote)?quote:null;}
const reason=v=>String(v||'模型未说明原因').slice(0,600);
function quoteEscapesOnly(before,after){let i=0,j=0,added=0;while(i<before.length&&j<after.length){if(before[i]===after[j]){i++;j++;}else if(before[i]==='"'&&after[j]==='\\'&&after[j+1]==='"'){j++;added++;}else return 0;}return i===before.length&&j===after.length?added:0;}
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
   const f=input.facts.find(f=>f.id===c.factId&&f.usable&&(!f.productId||f.productId===t.productId)),factQuote=f?excerpt(c.factQuote,f.value):null;
   if(relation!=='缺少证据'&&(!f||!factQuote)){problems.push('有事实判断引用无效、过期或其他产品线资料，已改为缺少证据');claims.push({quote,relation:'缺少证据',factId:'',factQuote:'',reason:'模型未提供当前产品线或品牌通用资料中的有效原文证据。'});continue;}
   claims.push({quote,relation,factId:factQuote?f.id:'',factQuote:factQuote||'',reason:reason(c.reason)});
  }
  const negations=[];if(input.kind==='answer'){
   if(!Array.isArray(row.negations))problems.push('缺少否定语境检查结果');
   else for(const n of row.negations.slice(0,20)){const quote=excerpt(n?.quote,t.text);if(quote)negations.push({quote,reason:reason(n.reason)});else problems.push('有否定语境未匹配原句，已排除');}
  }
  if(input.kind==='content'&&!claims.length)problems.push('没有可核对的事实条目，不能据此通过审核');
  return {id:t.id,sentiment:input.kind==='answer'&&sentiment&&(['未提及','无法判断'].includes(sentiment)||sentimentQuote)?sentiment:'无法判断',sentimentQuote:sentimentQuote||'',claims,excludedClaims,negations,problems:[...new Set(problems)]};
 });
 if(data.results.some(x=>!input.targets.some(t=>t.id===x?.id)))return {...meta,results,parseError:'模型包含不属于本批次的记录，已排除；请核对本批结果。'};
 return {...meta,results,parseError:''};
}
