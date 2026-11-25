// Pair only original consumer replies to the same captured question and version.
function observation(answer){
 if(!answer)return null;
 const citations=new Set((answer.citations||[]).map(c=>typeof c==='string'?c:c?.url).filter(Boolean));
 return {
  id:answer.id,date:answer.date,mention:typeof answer.mention==='boolean'?answer.mention:null,
  recommended:answer.recommendationLabeled&&typeof answer.recommended==='boolean'?answer.recommended:null,
  links:citations.size,citationKnown:answer.citationKnown===true
 };
}

function observedChange(before,after){
 const changes=[];
 for(const [key,name] of [['mention','提及品牌'],['recommended','明确推荐']]){
  if(before[key]===null||after[key]===null)continue;
  if(before[key]===after[key])changes.push('两次均'+(after[key]?'':'未')+name);
  else changes.push('复测'+(after[key]?'开始':'未再')+name);
 }
 if(before.citationKnown&&after.citationKnown)changes.push('引用链接 '+before.links+' → '+after.links+' 条');
 return changes.length?changes.join('；'):'两次回答均已保存，可对照原文核对';
}

export function liveComparison(answers,{brandId,questionId,version,text,baseline,run,platforms}){
 if(!baseline||!run||baseline===run)return [];
 const scoped=answers.filter(a=>a.brandId===brandId&&a.promptId===questionId&&a.questionVersion===version&&a.questionText===text&&a.source==='consumer-web'&&a.surface==='import'&&a.entry==='web'&&a.status==='ok'&&a.text?.trim());
 return [...new Set(platforms)].map(platform=>{
  const find=id=>scoped.filter(a=>a.platform===platform&&a.externalId==='live-'+id+'-'+platform);
  const old=find(baseline),recent=find(run);
  const before=old.length===1?old[0]:null,after=recent.length===1?recent[0]:null;
  const paired=!!(before&&after&&before.id!==after.id&&(before.productId||'')===(after.productId||'')&&Date.parse(before.date)<Date.parse(after.date));
  const conditions=[['mode','模式'],['model','模型版本'],['language','语言'],['region','地域']];
  const uncontrolled=paired?conditions.filter(([key])=>!before[key]||/未记录|未知|未指定|unknown/i.test(before[key])||before[key]!==after[key]).map(([,label])=>label):[];
  const first=observation(before),second=observation(after);
  const comparison=paired?observedChange(first,second):old.length>1||recent.length>1?'同一次查询有多条回答，暂不比较':'尚无可配对的基线和复测';
  return {platform,before:first,after:second,paired,uncontrolled,comparison};
 });
}
