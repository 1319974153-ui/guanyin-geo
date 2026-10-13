import {aggregate,hasName,canonicalUrl,matchesProduct} from './analytics-core.js';
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
export function sourceDomains(report){const map=new Map();for(const s of report.sources){let row=map.get(s.domain);if(!row){row={domain:s.domain,answers:new Set(),verified:new Set(),pages:new Set()};map.set(s.domain,row)}for(const id of s.answerIds)row.answers.add(id);for(const id of s.verifiedAnswerIds)row.verified.add(id);row.pages.add(s.url)}return [...map.values()].map(r=>({domain:r.domain,count:r.answers.size,verified:r.verified.size,pages:r.pages.size})).sort((a,b)=>b.verified-a.verified||b.count-a.count||a.domain.localeCompare(b.domain))}
export function contentSelection(contents,publications,answers,brandId,options={}){
 const query=String(options.query||'').trim().toLocaleLowerCase();
 return contents.filter(c=>c.brandId===brandId&&(!options.status||c.status===options.status)&&matchesProduct(c,options.productId||'')&&(!query||[c.title,c.question].some(v=>String(v||'').toLocaleLowerCase().includes(query)))).map(c=>{const pubs=publications.filter(p=>p.brandId===brandId&&p.contentId===c.id),urls=new Set(pubs.map(p=>canonicalUrl(p.url)).filter(Boolean));const hits=answers.filter(a=>!a.demo&&a.brandId===brandId&&a.citationKnown===true&&(a.citations||[]).some(s=>urls.has(canonicalUrl(s.url))));return {content:c,publicationCount:pubs.length,citedAnswerCount:hits.length}});
}
