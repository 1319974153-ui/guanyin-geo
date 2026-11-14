// A scope review is a human statement tied to one version of the source.
// It is not an automated certification of a ranking, institution or award.
const fields={issuer:160,publishedDate:10,scope:500,methodology:800,conclusion:800,factId:100,factHash:64};
export function normalizeRankingReview(value){
 if(value==null)return null;
 const fail=message=>{throw Object.assign(Error(message),{status:400})};
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(fields,key)&&key!=='attested'))fail('排名材料核对格式不正确');
 const result={};for(const[key,max]of Object.entries(fields)){const text=value[key]??'';if(typeof text!=='string'||text.length>max)fail('排名材料核对字段超出范围');result[key]=text.trim();}
 if(value.attested!==undefined&&typeof value.attested!=='boolean')fail('请明确确认是否已人工核对排名材料');
 result.attested=value.attested===true;return result;
}
export function rankingReviewReasons(value,linked=[],clock=new Date()){
 let review;try{review=normalizeRankingReview(value)}catch(error){return[error.message]}
 const reasons=[];
 if(!review||!review.issuer||!review.scope||review.methodology.length<10||review.conclusion.length<10)reasons.push('请人工登记发布机构、适用范围、评价方法和材料实际支持的具体结论（方法、结论各至少 10 字）。');
 const date=review?.publishedDate||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||Date.parse(date)>clock.getTime())reasons.push('请登记原始材料真实的发布日期，不能使用未来日期。');
 if(review?.attested!==true)reasons.push('需本人阅读原始材料并确认上述口径；关键词匹配不证明机构权威或排名真实。');
 if(linked.length!==1||!review||review.factId!==linked[0]?.id||review.factHash!==linked[0]?.sha256)reasons.push('请选择一条当前版本的原始材料，并重新确认口径；旧材料版本不能沿用核对结论。');
 return reasons;
}
export function legacyCredibilityContract(action){
 const id=action.origin?.kind==='credibility'?action.origin.credibility?.id:'';
 const expected={ranking:'ranking',submission:'submission_preparation'}[id];
 return !!expected&&(action.origin.evidenceContract?.schema!==1||action.origin.evidenceContract?.kind!==expected);
}
