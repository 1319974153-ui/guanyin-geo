import {digest} from './access.js';
import {wechatArticle,wechatPublishReceipt,wechatReadiness} from './wechat-core.js';

// A repository must enforce unique (owner, brand, account, contentHash), and
// atomic claim(id, expectedState, nextState). Client is injected by the server.
// This engine is deliberately not wired to live product dispatch before acceptance.
export async function wechatWorkflow({store,client,scope,action,pack,cover,taskId,permissions={},type='unknown'}){
 if(!['draft','publish','reconcile'].includes(action))throw Error('不支持此公众号操作');
 if(!scope?.owner||!scope.brandId||!scope.accountId)throw Error('需要工作区、品牌和账号');
 const key=JSON.stringify([scope.owner,scope.brandId,scope.accountId]);
 let r;
 if(action==='draft'){
  if(!wechatReadiness(type,permissions).createDraft)throw Error('账号尚未确认草稿权限');
  if(!cover?.bytes||!cover?.mime)throw Error('请先选择封面');
  const contentHash=await digest(JSON.stringify([pack,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',cover.bytes))),cover.mime]));
  r=await store.findOrCreate(key,contentHash,{scope,key,contentHash,pack,state:'ready',id:crypto.randomUUID()});
 }else{r=await store.get(taskId);if(!r||r.key!==key)throw Error('找不到此账号的原任务');}
 const save=async patch=>{r={...r,...patch};await store.save(r);return r};
 const claim=async(from,to)=>{const ok=await store.claim(r.id,from,to);if(ok)r={...r,state:to};return ok};
 const checkedDraft=async()=>{const d=await client.getDraft(r.mediaId),a=d.news_item;
  if(!Array.isArray(a)||a.length!==1)throw Error('远端不是唯一图文草稿');
  const expected=wechatArticle(r.pack,r.coverId),actual=a[0];
  for(const field of ['title','content','author','digest','content_source_url','thumb_media_id'])if((actual[field]||'')!==(expected[field]||''))throw Error('远端稿件已变化，未覆盖或发布');
 };
 if(action==='reconcile'){
  if(['uploading','creating','checking','publishing','reconciling'].includes(r.state))return r;
  const previous=r.state;
  if(!await claim(previous,'reconciling'))return store.get(r.id);
  try{
   if(r.publishId){const d=await client.status(r.publishId);if(d.publish_id!==undefined&&String(d.publish_id)!==r.publishId)throw Error('微信回执任务不匹配');return await save({...wechatPublishReceipt(d),error:''});}
   if(r.publishAttempted)throw Error('发表请求结果未知；缺少publish_id，需本人核对，禁止重发');
   if(r.mediaId){await checkedDraft();return await save({state:'draft',error:''});}
   return await save({state:previous}); // Never retry a write after a lost response.
  }catch(e){await save({state:previous});throw e;}
 }
 if(action==='publish'){
  if(!wechatReadiness(type,permissions).publish)throw Error('此账号尚未确认官方发表权限；可保留草稿由本人发布');
  if(r.state!=='draft'||r.publishAttempted)return r;
  await checkedDraft();
  if(!await claim('draft','publishing'))return store.get(r.id);
  await save({publishAttempted:true});
  try{const d=await client.submit(r.mediaId);if(!d.publish_id||typeof d.publish_id==='number'&&!Number.isSafeInteger(d.publish_id))throw Error('发表回执缺少有效任务编号');return save({state:'submitted',publishId:String(d.publish_id),publicVerified:false,broadcast:false,error:''});}
  catch{return save({state:'uncertain',error:'发表结果未知，请核对原任务；不会重复提交'});}
 }
 if(r.state!=='ready')return r;
 if(!await claim('ready','uploading'))return store.get(r.id);
 try{
  const uploaded=await client.uploadCover(cover.bytes,cover.mime);if(typeof uploaded.media_id!=='string'||!uploaded.media_id)throw Error('封面回执缺少编号');
  await save({coverId:uploaded.media_id,state:'creating'});
  const d=await client.addDraft(wechatArticle(r.pack,r.coverId));if(typeof d.media_id!=='string'||!d.media_id)throw Error('草稿回执缺少编号');
  await save({mediaId:d.media_id,state:'checking'});await checkedDraft();return save({state:'draft',error:''});
 }catch{return save({state:'uncertain',error:'草稿创建或核对未完成，请核对原任务；不会重复创建'});}
}
