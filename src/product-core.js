// A saved answer keeps its collection-time scope; never infer it from today's question.
export const BRAND_SCOPE='@brand',UNKNOWN_SCOPE='@unknown';
export function productFor(brand,id){return (brand?.productLines||[]).find(p=>p.id===id)}
export function productFields(brand,productId=''){const p=productFor(brand,productId);return {productId:productId||'',productSnapshot:p?{id:p.id,name:p.name,version:p.version||1}:null};}
export function productScope(record){return Object.hasOwn(record,'productId')?(record.productId||BRAND_SCOPE):UNKNOWN_SCOPE;}
export function matchesProduct(record,filter){return !filter||productScope(record)===filter;}
export function productLabel(brand,filter){return !filter?'全部产品线':filter===BRAND_SCOPE?'品牌通用':filter===UNKNOWN_SCOPE?'归属未记录':productFor(brand,filter)?.name||'历史产品线';}
export function validateProductFilter(brand,filter){if(filter&&![BRAND_SCOPE,UNKNOWN_SCOPE].includes(filter)&&!productFor(brand,filter))throw new Error('产品线不存在或不属于当前品牌');}
export function factsForProduct(facts,productId){return facts.filter(f=>!f.productId||f.productId===productId);}
export function productLinkMetadata(state){return Object.fromEntries(['answers','contents'].map(kind=>[kind,state[kind].map(record=>Object.fromEntries(['id','productId','productSnapshot','questionVersion',...(kind==='answers'?['questionText']:[])].filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]])))]));}
export function importedProduct(brand,question,version,date){
 if(!question)return {};
 const at=Date.parse(date),currentVersion=question.version||'v1';
 // Missing version time is insufficient for retrospectively assigning a product.
 if(version===currentVersion&&question.updated&&at>=Date.parse(question.updated))return productFields(brand,question.productId||'');
 const historical=question.history?.find(h=>h.version===version&&Object.hasOwn(h,'productId')&&h.at&&at>=Date.parse(h.at));
 if(!historical)return {};return productFields(brand,historical.productId||'');
}
export function protectProductLinks(before,after){
 for(const key of ['answers','contents'])for(const r of after[key]){
  const old=before[key].find(x=>x.id===r.id),brand=after.brands.find(b=>b.id===r.brandId);if(!brand)continue;
  if(old){if(JSON.stringify(['productId','productSnapshot'].map(k=>[Object.hasOwn(old,k),old[k]]))!==JSON.stringify(['productId','productSnapshot'].map(k=>[Object.hasOwn(r,k),r[k]])))throw new Error('已保存的产品归属不能改写；请保留原始记录并新建');continue;}
  delete r.productId;delete r.productSnapshot;
  const q=after.questions.find(q=>q.brandId===r.brandId&&q.id===(key==='answers'?r.promptId:r.questionId));
  if(key==='answers')Object.assign(r,importedProduct(brand,q,r.questionVersion,r.date));
  else if(q){const version=r.questionVersion||q.version||'v1',snapshot=version===(q.version||'v1')?q:q.history?.find(v=>v.version===version);if(!snapshot)throw new Error('关联问题版本不存在');if(snapshot.productId&&productFor(brand,snapshot.productId)?.status!=='active')throw new Error('关联产品线已归档，不能创建新稿件');if(Object.hasOwn(snapshot,'productId'))Object.assign(r,productFields(brand,snapshot.productId||''));r.questionVersion=version;}
 }
}
