import {aggregate,hasName,canonicalUrl,domain,entryOf,matchesProduct} from './analytics-core.js';
const DAY=86400000;
export const METRICS={mention:{label:'品牌提及率',num:'mention',den:'n'},recommendation:{label:'适用推荐率',num:'rec',den:'recommendationN'},official:{label:'官网引用率',num:'official',den:'citationN'}};
export function metricOf(input){return Object.hasOwn(METRICS,input)?input:'mention'}
export function metricValue(metrics,key){const m=METRICS[metricOf(key)],n=metrics[m.num]||0,d=metrics[m.den]||0;return {n,d,value:d?n/d*100:null}}
export function heatmap(report,key='mention'){
 const end=Date.parse(report.options.to+'T00:00:00Z'),from=Math.max(end-13*DAY,report.options.from?Date.parse(report.options.from+'T00:00:00Z'):-Infinity);
 const days=[];for(let d=from;d<=end;d+=DAY)days.push(new Date(d).toISOString().slice(0,10));
 const platforms=[...new Set(report.answers.map(a=>a.platform))].sort((a,b)=>a.localeCompare(b));
 if(report.options.platform&&!platforms.includes(report.options.platform))platforms.push(report.options.platform);
 return {days,rows:platforms.map(platform=>({platform,cells:days.map(date=>{const answers=report.answers.filter(a=>a.platform===platform&&new Date(a.date).toISOString().slice(0,10)===date);return {date,answerIds:answers.map(a=>a.id),...metricValue(aggregate(answers,report.brand),key)}})}))};
}
export function answerSelection(report,options={}){
 const query=String(options.query||'').trim().toLocaleLowerCase();
 const list=report.answers.filter(a=>(!query||[a.text,a.questionText,a.platform].some(v=>String(v||'').toLocaleLowerCase().includes(query)))&&(!['yes','no'].includes(options.mention)||hasName(a.text,report.brand)===(options.mention==='yes'))).slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||String(a.id).localeCompare(String(b.id)));
 const pages=Math.max(1,Math.ceil(list.length/25));let page=Math.min(pages,Math.max(1,Math.floor(Number(options.page)||1)));
 const selected=list.find(a=>a.id===options.answerId);if(selected)page=Math.floor(list.indexOf(selected)/25)+1;
 const rows=list.slice((page-1)*25,page*25);return {total:list.length,pages,page,rows,selected:selected||rows[0]||null};
}
function queryKey(questionId,version,text){
 return JSON.stringify([questionId,version,text]);
}

function queryCitations(answer){
 const citations=new Map();
 for(const source of answer.citations||[]){
  const url=canonicalUrl(source.url);
  if(!url||citations.has(url))continue;
  const host=domain(url);
  citations.set(url,{url:source.url,domain:host,title:source.title||host});
 }
 return [...citations.values()];
}

function summarizeQuery(rows,brand){
 const answers=rows.map(row=>row.answer),ranks=rows.map(row=>row.rank).filter(rank=>rank!==null);
 const links=new Map(),sites=new Map();
 for(const row of rows){
  for(const source of row.citations){
   const url=canonicalUrl(source.url);
   links.set(url,source);
   if(!sites.has(source.domain))sites.set(source.domain,{domain:source.domain,links:new Set()});
   sites.get(source.domain).links.add(url);
  }
 }
 return {
  ...aggregate(answers,brand),
  articleCount:links.size,
  sites:[...sites.values()].map(site=>({domain:site.domain,count:site.links.size})).sort((a,b)=>b.count-a.count||a.domain.localeCompare(b.domain)),
  averageRank:ranks.length?ranks.reduce((total,rank)=>total+rank,0)/ranks.length:null,
  rankCount:ranks.length,
 };
}

export function queryResults(report,questions,options={}){
 const groups=new Map(),brand=report.brand;
 const reviewed=(report.competitorSemantics||[]).find(entity=>entity.id==='brand:'+brand.id);
 const ranks=new Map((reviewed?.evidence||[]).filter(item=>item.review?.recommendation==='yes'&&Number.isInteger(item.review.rank)&&item.review.rank>0&&!item.stale).map(item=>[item.answerId,item.review.rank]));
 const ordered=report.answers.slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||String(a.id).localeCompare(String(b.id)));
 let selectedGroup,selected;
 for(const answer of ordered){
  const key=queryKey(answer.promptId||answer.id,answer.questionVersion||'',answer.questionText);
  if(!groups.has(key))groups.set(key,{key,text:answer.questionText,version:answer.questionVersion||'',rows:[]});
  const group=groups.get(key);
  const row={answer,entry:entryOf(answer),rank:ranks.get(answer.id)??null,citations:queryCitations(answer)};
  group.rows.push(row);
  if(options.answerId===answer.id){selectedGroup=group;selected=row}
 }
 for(const question of questions){
  const version=question.version||'v1',key=queryKey(question.id,version,question.text);
  if(!groups.has(key))groups.set(key,{key,text:question.text,version,rows:[]});
  const group=groups.get(key);
  group.intent=question.intent;
 }
 const choices=[...groups.values()];
 const group=selectedGroup||groups.get(options.question)||choices[0];
 if(!group)return {choices,group:null,selected:null,platforms:[],summary:summarizeQuery([],brand)};
 const platforms=new Map();
 for(const row of group.rows){
  const platform=row.answer.platform||'平台未记录',key=JSON.stringify([platform,row.entry]);
  if(!platforms.has(key))platforms.set(key,{platform,entry:row.entry,rows:[]});
  platforms.get(key).rows.push(row);
 }
 return {
  choices,group,selected:selected||null,summary:summarizeQuery(group.rows,brand),
  platforms:[...platforms.values()].map(platform=>({...platform,summary:summarizeQuery(platform.rows,brand)})),
 };
}
export function sourceDomains(report){const map=new Map();for(const s of report.sources){let row=map.get(s.domain);if(!row){row={domain:s.domain,answers:new Set(),verified:new Set(),pages:new Set()};map.set(s.domain,row)}for(const id of s.answerIds)row.answers.add(id);for(const id of s.verifiedAnswerIds)row.verified.add(id);row.pages.add(s.url)}return [...map.values()].map(r=>({domain:r.domain,count:r.answers.size,verified:r.verified.size,pages:r.pages.size})).sort((a,b)=>b.verified-a.verified||b.count-a.count||a.domain.localeCompare(b.domain))}
export function contentSelection(contents,publications,answers,brandId,options={}){
 const query=String(options.query||'').trim().toLocaleLowerCase();
 return contents.filter(c=>c.brandId===brandId&&(!options.status||c.status===options.status)&&matchesProduct(c,options.productId||'')&&(!query||[c.title,c.question].some(v=>String(v||'').toLocaleLowerCase().includes(query)))).map(c=>{const pubs=publications.filter(p=>p.brandId===brandId&&p.contentId===c.id),urls=new Set(pubs.map(p=>canonicalUrl(p.url)).filter(Boolean));const hits=answers.filter(a=>!a.demo&&a.brandId===brandId&&a.citationKnown===true&&(a.citations||[]).some(s=>urls.has(canonicalUrl(s.url))));return {content:c,publicationCount:pubs.length,citedAnswerCount:hits.length}});
}

export {liveComparison} from './live-comparison.js';
