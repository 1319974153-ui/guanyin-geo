// Read only the creator's own visible homepage in the account's isolated
// session. No cookie export, hidden application state, or article-author IDs.
export function douyinAccountPage(){
 try{
  if(location.origin!=='https://creator.douyin.com'||location.pathname!=='/creator-micro/home')throw Error('抖音本人主页尚未就绪');
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const labels=[...document.querySelectorAll('div,span,p')].filter(e=>visible(e)&&!e.closest('article,[contenteditable],aside,[role="dialog"]'));
  const ids=[...new Set(labels.map(e=>(e.innerText||'').trim().match(/^抖音号\s*[:：]\s*([-\w]{1,64})$/)?.[1]).filter(Boolean))];
  if(ids.length!==1)throw Error('尚未从抖音本人主页读到唯一抖音号；登录状态保留，未填写或提交');
  return {accountId:ids[0],name:ids[0],accountVerified:true,evidenceUrl:location.origin+location.pathname};
 }catch(e){return {connectorError:String(e.message).slice(0,200)}}
}
