// Immutable local asset references only. Image bytes and paths never enter workspace JSON.
export function articleMediaRefs(value = []) {
 if (!Array.isArray(value) || value.length > 9) throw new Error('每份稿件最多保存 9 张配图');
 const seen=new Set();
 return value.map((item,index)=>{
  if(!item || !/^am-[a-f0-9]{64}$/.test(item.id||'') || !/^[a-f0-9]{64}$/.test(item.sha256||'') || typeof item.rightsConfirmed!=='boolean')throw new Error(`第 ${index+1} 张配图信息无效，请重新选择`);
  if(seen.has(item.sha256))throw new Error('同一张配图不能重复添加');seen.add(item.sha256);
  return {id:item.id,sha256:item.sha256,rightsConfirmed:item.rightsConfirmed};
 });
}
export function articleMediaSnapshot(article={}) {
 if(!Object.hasOwn(article||{},'mediaRefs'))return {};
 return {mediaRefs:articleMediaRefs(article.mediaRefs),mediaVersion:Number.isSafeInteger(article.mediaVersion)&&article.mediaVersion>0?article.mediaVersion:1};
}
export function assertArticleMediaDelivery(article,media=[]) {
 if(!Object.hasOwn(article||{},'mediaRefs'))return; // Historical jobs retain their original raw-media contract.
 const refs=articleMediaRefs(article.mediaRefs);
 if(refs.some(ref=>!ref.rightsConfirmed))throw Object.assign(new Error('请先确认有权将所选配图用于本稿发布，再保存并确认稿件'),{status:409});
 if(!Array.isArray(media)||JSON.stringify(refs.map(ref=>ref.sha256))!==JSON.stringify(media.map(item=>item.sha256)))throw Object.assign(new Error('本稿配图尚未完整传给此渠道，请使用支持配图的平台或另存无配图的渠道稿'),{status:409});
}
