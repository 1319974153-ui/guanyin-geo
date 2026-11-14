import {factDisclosure} from './knowledge-core.js';

const OMIT=Symbol('private report record'),MASK='【内部资料已隐藏】';
const RAW_COLLECTIONS=new Set(['sourceDocuments','analysisChecks','factSnapshots']);
const FREE_TEXT=new Set(['text','body','title','summary','notes','note','description','detail','quote','value','source','sourceUrl','url','question','questionText','questionSnapshot','brief','rawText','reason','reviewNote','excerpt','extractedText']);
const SECRET_QUERY=/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|sig|code)$/i;
const rows=x=>Array.isArray(x)?x:[];
const sameBrand=(r,id)=>!r?.brandId||r.brandId===id;
// Only exact long source passages are masked. Short common words and numbers
// are not treated as global secrets; records explicitly linked to them are hidden.
function literalsFrom(record,set){
 for(const k of ['value','text','body','quote','excerpt','extractedText']){
  const v=String(record?.[k]||'').trim();if(v.length>=8)set.add(v);
  if(v.length>=24)for(const p of v.split(/\n\s*\n/))if(p.trim().length>=12)set.add(p.trim());
 }
 for(const h of rows(record?.history)){literalsFrom(h,set);if(h.before)literalsFrom(h.before,set);if(h.after)literalsFrom(h.after,set)}
 for(const b of rows(record?.blocks))literalsFrom(b,set);
}
function safeUrlSecrets(value){
 return value.replace(/https?:\/\/[^\s<>"'）)\]]+/gi,raw=>{
  try{const u=new URL(raw);let changed=false;if(u.username||u.password){u.username='';u.password='';changed=true}for(const k of [...u.searchParams.keys()])if(SECRET_QUERY.test(k)){u.searchParams.delete(k);changed=true}if(u.hash&&/(?:token|secret|password|authorization|api[_-]?key)=/i.test(u.hash)){u.hash='';changed=true}return changed?u.href:raw}catch{return raw}
 });
}
function context(state,brandId,report){
 const facts=rows(state?.facts).filter(f=>f.brandId===brandId&&factDisclosure(f)==='internal');
 const collect=(v)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const a of v)collect(a);return}if(sameBrand(v,brandId)&&factDisclosure(v)==='internal')facts.push(v);for(const x of Object.values(v))collect(x);};collect(report);
 const factIds=new Set(facts.map(f=>f.id).filter(Boolean)),docIds=new Set(facts.map(f=>f.sourceDocumentId).filter(Boolean)),literals=new Set(),privateUrls=new Set();
 for(const f of facts){literalsFrom(f,literals);if(/^https?:\/\//i.test(f.source||''))privateUrls.add(f.source)}
 const docs=rows(state?.sourceDocuments).filter(d=>d.brandId===brandId&&(factDisclosure(d)==='internal'||docIds.has(d.id)));
 for(const d of docs){docIds.add(d.id);literalsFrom(d,literals);for(const k of ['source','url','sourceUrl'])if(/^https?:\/\//i.test(d[k]||''))privateUrls.add(d[k])}
 const linked=r=>rows(r?.factIds).some(id=>factIds.has(id))||rows(r?.factSnapshots).some(f=>factIds.has(f.id)||factDisclosure(f)==='internal')||docIds.has(r?.sourceDocumentId);
 const contentIds=new Set(rows(state?.contents).filter(c=>c.brandId===brandId&&(factDisclosure(c)==='internal'||linked(c))).map(c=>c.id));
 return {factIds,docIds,contentIds,linked,literals:[...literals].sort((a,b)=>b.length-a.length),privateUrls};
}
export function reportDisclosureView(report,state={}){
 const brandId=report?.brand?.id;if(!brandId)return structuredClone(report);
 const policy=context(state,brandId,report);let changed=false,maskedFields=0,omittedRecords=0;
 const mask=text=>{let out=text;for(const secret of policy.literals)out=out.split(secret).join(MASK);for(const url of policy.privateUrls)out=out.split(url).join(MASK);out=safeUrlSecrets(out);if(out!==text){changed=true;maskedFields++}return out};
 const visit=(value,key='',linkedParent=false)=>{
  if(value===null||value===undefined)return value;
  if(typeof value==='string'){if(linkedParent&&FREE_TEXT.has(key)&&value){changed=true;maskedFields++;return MASK}return mask(value)}
  if(Array.isArray(value))return value.map(v=>visit(v,key,linkedParent)).filter(v=>v!==OMIT);
  if(typeof value!=='object')return value;
  const scoped=sameBrand(value,brandId);
  if(scoped&&(factDisclosure(value)==='internal'||policy.factIds.has(value.id)&&key==='facts'||policy.docIds.has(value.id)&&key==='sourceDocuments')){changed=true;omittedRecords++;return OMIT}
  const linked=linkedParent||scoped&&(policy.linked(value)||policy.contentIds.has(value.contentId)||policy.contentIds.has(value.id)&&key==='contents');
  const out={};for(const [k,v]of Object.entries(value)){
   if(RAW_COLLECTIONS.has(k)){if(rows(v).length||v&&!Array.isArray(v)){changed=true;omittedRecords+=Array.isArray(v)?v.length:1}continue}
   if(k==='factIds'){const next=rows(v).filter(id=>!policy.factIds.has(id));if(next.length!==rows(v).length)changed=true;out[k]=next;continue}
   if(k==='facts'&&value===report?.credibilityPlan?.basis){const next=rows(v).filter(f=>!policy.factIds.has(f.id));if(next.length!==rows(v).length)changed=true;out[k]=next.map(f=>visit(f,k,linked));continue}
   const next=visit(v,k,linked);if(next!==OMIT)out[k]=next;
  }
  return out;
 };
 const result=visit(report);
 if(changed)result.reportPrivacy={schema:1,scope:'customer_report',filteredAt:new Date().toISOString(),maskedFields,omittedRecords,originalCreated:report.created,notice:'此显示及导出副本按当前资料公开范围过滤；内部原文与敏感链接已隐藏。原始归档未改写，原快照版本与指标未重新计算。此副本不是完整业务备份。'};
 return result;
}
export function reportDisclosureTitle(title,brandId,state={}){
 return reportDisclosureView({brand:{id:brandId},title},state).title;
}
