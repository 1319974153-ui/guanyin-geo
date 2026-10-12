// Competitor semantic judgments are distinct from text matches and human answer labels.
export const COMPETITOR_VERSION=1;
export const IDENTITY_LABELS={present:'本品牌',absent:'未提及',homonym:'同名其他对象',uncertain:'无法判断'};
export const RECOMMEND_LABELS={yes:'明确推荐',no:'未明确推荐',uncertain:'无法判断'};
const names=e=>[...new Set([e.name,...String(e.aliases||'').split(/[,，]/)].map(s=>String(s||'').trim()).filter(Boolean))];
function match(text,e){return names(e).some(n=>/^[\w .-]+$/.test(n)?new RegExp('(^|[^a-z0-9])'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9])','i').test(text):String(text).toLowerCase().includes(n.toLowerCase()))}
export function competitorInput(state,brandId,ids){
 const b=state.brands.find(b=>b.id===brandId);if(!b)return null;const targets=ids.map(id=>state.answers.find(a=>a.id===id&&a.brandId===brandId&&a.status==='ok'));if(targets.some(t=>!t))return null;
 return{version:COMPETITOR_VERSION,kind:'competitor',brand:{id:b.id,name:b.name},entities:[{...b,entityId:'brand:'+b.id},...state.competitors.filter(c=>c.brandId===brandId&&c.status!=='已归档').map(c=>({...c,entityId:'competitor:'+c.id}))].map(e=>({id:e.entityId,name:e.name,aliases:String(e.aliases||''),site:e.site||'',description:e.description||'',industry:e.industry||b.industry||''})).sort((a,b)=>a.id.localeCompare(b.id)),targets:targets.map(t=>({id:t.id,text:t.text||'',question:t.questionText||t.questionSnapshot||'',questionVersion:t.questionVersion||'',productId:t.productId??null,platform:t.platform||'',mode:t.mode||'',entry:t.entry||'',surface:t.surface||'',date:t.date||''}))};
}
export function competitorStale(record,state){return JSON.stringify(competitorInput(state,record.brandId,record.input.targets.map(t=>t.id)))!==JSON.stringify(record.input)}
const excerpt=(q,text)=>typeof q==='string'&&q.trim().length>=2&&q.length<=2000&&text.includes(q)?q:'';
export function competitorDecision(row,target,entity){
 const problems=[],text=target.text;let identity=Object.hasOwn(IDENTITY_LABELS,row?.identity)?row.identity:'uncertain',recommendation=Object.hasOwn(RECOMMEND_LABELS,row?.recommendation)?row.recommendation:'uncertain',identityQuote=excerpt(row?.identityQuote,text),recommendationQuote=excerpt(row?.recommendationQuote,text),rank=null,rankQuote='',rankContext='';
 if(!row||!Object.hasOwn(IDENTITY_LABELS,row.identity)||!Object.hasOwn(RECOMMEND_LABELS,row.recommendation))problems.push('身份或推荐判断缺失');
 if(['present','homonym'].includes(identity)&&(!identityQuote||!match(identityQuote,entity))){identity='uncertain';problems.push('身份原句缺失或不含登记名称/别名');}
 if(identity==='absent'&&match(text,entity)){identity='uncertain';problems.push('回答仍有名称匹配，请区分同名对象或无法判断');}
 if(identity!=='present'){recommendation=identity==='uncertain'?'uncertain':'no';recommendationQuote='';}
 else if(recommendation!=='uncertain'&&(!recommendationQuote||!match(recommendationQuote,entity))){recommendation='uncertain';problems.push('推荐判断缺少含品牌名称的完整原句');}
 if(row?.rank!==null&&row?.rank!==undefined&&row?.rank!==''){
  rankQuote=excerpt(row.rankQuote,text);rankContext=excerpt(row.rankContext,text);const numbered=rankQuote.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(\d{1,3})[.、)）][^\n]*/);
  if(identity==='present'&&recommendation==='yes'&&Number.isInteger(row.rank)&&row.rank>=1&&row.rank<=100&&numbered&&Number(numbered[1])===row.rank&&match(numbered[0],entity)&&rankContext)rank=row.rank;
  else{rankQuote='';rankContext='';problems.push('顺序缺少对应编号、品牌或有序推荐上下文，仅保留待核对提示');}
 }
 return {entityId:entity.id,identity,identityQuote,recommendation,recommendationQuote,rank,rankQuote,rankContext,reason:String(row?.reason||'未提供判断依据').slice(0,600),problems};
}
export function parseCompetitors(raw,input){
 let data;try{data=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{return{results:[],parseError:'模型未返回有效 JSON，原始回执已保留。'}}
 if(!Array.isArray(data?.results)||data.results.length>5)return{results:[],parseError:'模型结果缺少有效回答列表。'};
 const results=input.targets.map(t=>{const rows=data.results.filter(r=>r?.id===t.id),r=rows.length===1?rows[0]:null,problems=[];if(!r||!Array.isArray(r.entities))problems.push('回答结果缺失或重复');const entities=input.entities.map(e=>{const found=Array.isArray(r?.entities)?r.entities.filter(x=>x?.entityId===e.id):[],d=competitorDecision(found.length===1?found[0]:null,t,e);if(found.length!==1)d.problems.push('品牌结果缺失或重复');return d});if(Array.isArray(r?.entities)&&r.entities.some(e=>!input.entities.some(x=>x.id===e?.entityId)))problems.push('不属于本次分析的品牌已排除');return{id:t.id,entities,problems:[...new Set([...problems,...entities.flatMap(e=>e.problems)])]}});
 return{results,parseError:data.results.some(r=>!input.targets.some(t=>t.id===r?.id))?'已排除本批次以外的回答，请核对结果。':''};
}
export function competitorSummary(state,brandId,answers){
 const entities=competitorInput(state,brandId,[])?.entities||[],latest=new Map(),staleness=new Map();for(const r of state.analysisChecks||[])if(r.brandId===brandId&&r.kind==='competitor')for(const t of r.input.targets)latest.set(t.id,r);
 return entities.map(e=>{const evidence=answers.map(a=>{const r=latest.get(a.id),stale=r?(staleness.has(r.id)?staleness.get(r.id):staleness.set(r.id,competitorStale(r,state)).get(r.id)):false,review=r&&!stale?(r.reviews||[]).slice().reverse().flatMap(x=>x.decisions.map(d=>({...d,reviewedAt:x.at,reviewer:x.actor,reviewId:x.id}))).find(d=>d.answerId===a.id&&d.entityId===e.id):null,suggestion=r?.results.find(x=>x.id===a.id)?.entities.find(x=>x.entityId===e.id);return{answerId:a.id,checkId:r?.id||'',stale,review:review||null,suggestion:suggestion||null}}),reviewed=evidence.filter(x=>x.review),known=reviewed.filter(x=>x.review.identity!=='uncertain'),rec=reviewed.filter(x=>x.review.identity!=='uncertain'&&x.review.recommendation!=='uncertain'),rank=rec.filter(x=>x.review.rank!==null&&x.review.recommendation==='yes');return{id:e.id,name:e.name,n:answers.length,reviewed:reviewed.length,identityN:known.length,mention:known.filter(x=>x.review.identity==='present').length,homonyms:known.filter(x=>x.review.identity==='homonym').length,recommendationN:rec.length,recommended:rec.filter(x=>x.review.recommendation==='yes').length,rankN:rank.length,averageRank:rank.length?rank.reduce((n,x)=>n+x.review.rank,0)/rank.length:null,evidence}});
}
export function competitorMarkdown(rows){if(!rows?.length)return'';return '\n## 竞品语义复核\n\n只使用当前原文与品牌资料下的已复核判断；未核对与无法判断不计入分母。位置仅统计明确有序推荐，不能解释为行业排名。\n\n|品牌|提及 / 身份已知|推荐 / 推荐已知|平均有序推荐位置 / 样本数|\n|---|---|---|---|\n'+rows.map(r=>'|'+r.name.replace(/\|/g,'／')+'|'+r.mention+'/'+r.identityN+'|'+r.recommended+'/'+r.recommendationN+'|'+(r.averageRank===null?'—':r.averageRank.toFixed(2))+' / '+r.rankN+'|').join('\n')+'\n\n'+rows.flatMap(r=>r.evidence.filter(e=>e.review).map(e=>'- '+r.name+'；回答 '+e.answerId+'；复核 '+e.review.reviewedAt+'；'+IDENTITY_LABELS[e.review.identity]+'；'+RECOMMEND_LABELS[e.review.recommendation]+'；依据：'+(e.review.identityQuote||'全回答未出现登记名称')+'；推荐依据：'+(e.review.recommendationQuote||'无')+'；顺序依据：'+(e.review.rankQuote||'无')+'；有序上下文：'+(e.review.rankContext||'无'))).join('\n')+'\n';}
