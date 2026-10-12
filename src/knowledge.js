import {reject} from './access.js';
import {schemaDate} from './schema-core.js';
import {factUsable} from './knowledge-core.js';
const fields=['key','value','source','sourceDocumentId','productId','status','validFrom','expiresAt','reviewNote','confirmationMethod','sourceReview'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const snap=f=>Object.fromEntries(fields.map(k=>[k,f[k]??'']));
export function protectKnowledge(before,after){
 for(const f of after.facts){const old=before.facts.find(x=>x.id===f.id);if(!equal(old?.history||[],f.history||[])||(old?.version||0)!==(f.version||0))reject(403,'事实版本历史由服务器记录');
  if(!equal(old?.sourceReview,f.sourceReview)&&!(old&&(old.value!==f.value||old.source!==f.source)&&!f.sourceReview))reject(403,'自动核对回执不能手工改写');
 }
 for(const d of after.sourceDocuments){const old=before.sourceDocuments.find(x=>x.id===d.id);if((old||d.storage==='r2')&&!equal(old,d))reject(403,'已保存的原文与文件信息不能直接修改，请上传新版本');}
 for(const d of before.sourceDocuments)if(!after.sourceDocuments.some(x=>x.id===d.id)&&after.brands.some(x=>x.id===d.brandId))reject(403,'原文版本需要保留，以便追溯旧事实');
}
export function recordFactVersions(before,after,actor='system'){
 const at=new Date().toISOString();for(const f of after.facts){const old=before.facts.find(x=>x.id===f.id);if(old&&equal(snap(old),snap(f)))continue;
  for(const k of ['validFrom','expiresAt'])if(f[k]&&(!schemaDate(f[k])))reject(400,'事实有效期需要有效的 ISO 日期时间');
  if(f.validFrom&&f.expiresAt&&Date.parse(f.validFrom)>Date.parse(f.expiresAt))reject(400,'失效时间不能早于生效时间');
  if(f.productId&&!after.brands.find(b=>b.id===f.brandId)?.productLines?.some(p=>p.id===f.productId))reject(400,'事实关联的产品线不存在');
  if(old&&(old.value!==f.value||old.source!==f.source||old.sourceDocumentId!==f.sourceDocumentId||old.validFrom!==f.validFrom||old.expiresAt!==f.expiresAt||old.productId!==f.productId)){if(f.status!=='已归档')f.status='待确认';delete f.sourceReview;delete f.confirmationMethod;}
  f.version=(old?.version||0)+1;f.updated=at;f.history=[...(old?.history||[]),{version:f.version,at,actor,values:snap(f)}].slice(-20);
 }
}
export async function knowledgeApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(path!=='/api/knowledge/fact')return null;if(req.method!=='POST')reject(405,'请使用 POST 保存事实');
 const input=await h.body(req),w=await h.workspace(env,ctx.owner);if(input.revision!==w.revision)reject(409,'资料已更新，请刷新后再保存');
 if(!w.state.brands.some(b=>b.id===input.brandId))reject(404,'品牌不存在');const current=w.state.facts.find(f=>f.id===input.id&&f.brandId===input.brandId),previous=current?structuredClone(current):null;
 if(input.action==='review'){
  if(!['owner','admin','reviewer'].includes(ctx.role))reject(403,'需要审核人或管理员确认事实');if(!current)reject(404,'事实不存在');if(!current.value?.trim()||!current.source?.trim())reject(400,'请补齐事实内容和出处后再确认');
  current.status=input.confirmed===false?'待确认':'已确认';current.confirmationMethod='manual';current.reviewNote=String(input.reviewNote||'').slice(0,2000);
  if(current.status==='已确认'&&!factUsable(current))reject(400,'事实未生效或已过期，请先更新有效期再确认');
 }else{
  if(!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能编辑事实');
  const f=current||{id:input.id,brandId:input.brandId,status:'待确认'};if(!/^[a-zA-Z0-9_-]{1,80}$/.test(f.id||''))reject(400,'事实标识不正确');
  for(const[k,max]of [['key',300],['value',10000],['source',1000],['validFrom',40],['expiresAt',40],['productId',80]]){const value=input[k]??'';if(typeof value!=='string'||value.length>max)reject(400,'事实字段格式不正确：'+k);f[k]=value.trim();}
  if(!f.key||!f.value||!f.source)reject(400,'请填写事实名称、内容和出处');
  if(previous&&(previous.value!==input.value||previous.source!==input.source)){delete f.sourceDocumentId;delete f.sourceLocation;}
  if(input.archived===true)f.status='已归档';else if(f.status==='已归档')f.status='待确认';
  if(!current)w.state.facts.push(f);
 }
 await h.appendResult(env,ctx.owner,s=>{const visible=s.facts.find(f=>f.id===input.id&&f.brandId===input.brandId),candidate=w.state.facts.find(f=>f.id===input.id);if(visible){if(visible.version!==(current?.version))reject(409,'事实已被其他操作修改');s.facts[s.facts.indexOf(visible)]=structuredClone(candidate);}else{if(current)reject(409,'事实已被移除');s.facts.push(candidate);}});
 return h.json({...await h.workspace(env,ctx.owner)});
}
