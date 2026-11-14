import {digest,reject} from './access.js';
import {factValid,factDisclosure} from './knowledge-core.js';

const reviewers=['owner','admin','reviewer'];
const pageSize=50;
const uniqueIds=(ids,label)=>{
 if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))||new Set(ids).size!==ids.length)reject(400,`${label}需要 1 至 50 条不同的资料`);
 return ids.slice().sort();
};
export function materialReviewRows(state,brandId,ids){
 const brand=state.brands.find(b=>b.id===brandId);if(!brand)reject(404,'品牌不存在');
 return ids.map(id=>{
  const f=state.facts.find(x=>x.id===id&&x.brandId===brandId);if(!f)reject(404,'所选资料不属于当前品牌或已被移除');
  const source=state.sourceDocuments.find(x=>x.id===f.sourceDocumentId&&x.brandId===brandId),product=brand.productLines?.find(x=>x.id===f.productId),reasons=[];
  if(f.status!=='待确认')reasons.push('这条资料已不在待确认列表');
  if(!f.value?.trim()||!f.source?.trim())reasons.push('请先补齐内容与出处');
  if(!factValid({...f,status:'已确认'}))reasons.push('内容、出处或有效期尚未满足确认条件');
  if(f.productId&&(!product||product.status==='archived'))reasons.push('关联产品线已移除或归档');
  if(f.sourceDocumentId&&!source)reasons.push('原始资料不存在，请先更新出处');
  if(source?.supersededBy)reasons.push('原始资料已有新版，请先核对新版内容');
  return {id:f.id,key:f.key||'品牌资料',value:f.value||'',source:f.source||'',version:f.version||0,status:f.status,disclosure:factDisclosure(f),
   sourceDocumentId:f.sourceDocumentId||'',sourceVersion:source?.version||0,sourceHash:source?.hash||'',supersededBy:source?.supersededBy||'',
   productId:f.productId||'',productName:product?.name||'品牌通用',productStatus:product?.status||'',validFrom:f.validFrom||'',expiresAt:f.expiresAt||'',
   sourceMethod:f.sourceLocation?.method||'',reviewNote:f.reviewNote||'',eligible:!reasons.length,reasons};
 });
}
export async function knowledgeReviewApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(!['/api/knowledge/review-preview','/api/knowledge/review-batch'].includes(path))return null;
 if(req.method!=='POST')reject(405,'请使用资料核对表单');
 if(!reviewers.includes(ctx.role))reject(403,'需要审核人或管理员确认品牌资料');
 const input=await h.body(req),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(b=>b.id===input.brandId))reject(404,'品牌不存在');
 const pending=w.state.facts.filter(f=>f.brandId===input.brandId&&f.status==='待确认').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const isPreview=path.endsWith('preview'),paged=isPreview&&input.ids===undefined,requestedOffset=input.offset===undefined?0:input.offset;
 if(isPreview&&(!Number.isSafeInteger(requestedOffset)||requestedOffset<0))reject(400,'资料页起点需要非负整数');
 // Pending rows can disappear after confirmation; keep a stale page on the last available page.
 const offset=paged?(requestedOffset<pending.length?requestedOffset:Math.max(0,Math.floor((pending.length-1)/pageSize)*pageSize)):0;
 const ids=paged?pending.slice(offset,offset+pageSize).map(f=>f.id):uniqueIds(input.ids,'核对范围');
 if(path.endsWith('preview')){
  const rows=materialReviewRows(w.state,input.brandId,ids),previewHash=await digest(JSON.stringify({brandId:input.brandId,rows}));
  const hasMore=paged&&offset+rows.length<pending.length;
  return h.json({plan:{brandId:input.brandId,brandName:w.state.brands.find(b=>b.id===input.brandId).name,ids,rows,previewHash,totalPending:pending.length,remaining:Math.max(0,pending.length-rows.length),offset,hasMore,nextOffset:hasMore?offset+pageSize:null,previousOffset:paged&&offset>0?Math.max(0,offset-pageSize):null,maxSelected:pageSize,modelCalls:0}});
 }
 if(input.reviewed!==true)reject(400,'请先核对所选内容、出处与使用范围');
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(input.batchId||'')||!/^[a-f0-9]{64}$/.test(input.previewHash||''))reject(400,'核对记录无效，请重新打开资料核对');
 const selected=uniqueIds(input.selectedIds,'确认范围');if(selected.some(id=>!ids.includes(id)))reject(400,'确认范围超出本次核对资料');
 const selectionHash=await digest(JSON.stringify({previewHash:input.previewHash,selected}));
 const existing=s=>{
  const prior=s.facts.filter(f=>f.reviewBatch?.id===input.batchId);
  if(!prior.length)return false;
  if(prior.length!==selected.length||prior.some(f=>f.brandId!==input.brandId||!selected.includes(f.id)||f.reviewBatch.selectionHash!==selectionHash||f.status!=='已确认'||f.version!==f.reviewBatch.sourceVersion+1||!factValid(f)))reject(409,'这批资料的核对结果已经改变，请重新查看当前资料');
  return true;
 };
 if(existing(w.state))return h.json({confirmedIds:selected,existing:true,...w});
 const rows=materialReviewRows(w.state,input.brandId,ids),snapshot=JSON.stringify({brandId:input.brandId,rows});
 if(await digest(snapshot)!==input.previewHash)reject(409,'资料或出处已更新，请重新查看后确认');
 if(rows.some(r=>selected.includes(r.id)&&!r.eligible))reject(400,'所选资料仍有缺项，请先处理提示，或取消选择该项');
 const at=new Date().toISOString();
 await h.appendResult(env,ctx.owner,s=>{
  if(existing(s))return;
  const currentRows=materialReviewRows(s,input.brandId,ids);
  if(JSON.stringify({brandId:input.brandId,rows:currentRows})!==snapshot)reject(409,'保存期间资料已变化，请重新核对');
  for(const id of selected){const f=s.facts.find(f=>f.id===id&&f.brandId===input.brandId);f.reviewBatch={id:input.batchId,selectionHash,sourceVersion:f.version||0,actor:ctx.actor,at};f.status='已确认';f.confirmationMethod='manual';}
 });
 return h.json({confirmedIds:selected,...await h.workspace(env,ctx.owner)});
}
