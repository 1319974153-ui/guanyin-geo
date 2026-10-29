// Read-navigation only. A success toast never identifies a published article.
export function douyinReceiptPage({action,article,accountId,media=[],profileEvidence}){
 try{
 const fail=m=>{throw Error(m)},norm=s=>String(s||'').replace(/[\s\u200B\uFEFF]/g,''),visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',txt=e=>e?.innerText??e?.textContent??'';
 const full=norm(article?.title)+'。'+norm(article?.text);if(!article?.title||!article?.text)fail('缺少原稿版本，未核对');
 const u=new URL(location.href);if(u.username||u.password||u.hash)fail('作品网址不明确');
 if(action==='receipt-public'){
  const id=u.origin==='https://www.douyin.com'&&(u.pathname.match(/^\/note\/([1-9]\d{0,29})$/)?.[1]||(u.pathname==='/user/self'&&u.searchParams.getAll('modal_id').length===1&&u.searchParams.get('modal_id')));
  if(!/^[1-9]\d{0,29}$/.test(id||''))return null;
  const roots=[...document.querySelectorAll('main[data-e2e="note-detail"],[data-e2e="feed-active-video"]')].filter(visible);
  if(!roots.some(root=>[...root.querySelectorAll('span,div')].filter(visible).some(e=>norm(txt(e))===full)))return null;
  if(article.ai&&!roots.some(root=>/作者声明[：:]内容由AI生成/.test(norm(txt(root)))))return null;
  return {state:'submitted',articleId:id,url:'https://www.douyin.com/note/'+id,contentVerified:true};
 }
 if(u.origin!=='https://creator.douyin.com'||u.pathname!=='/creator-micro/content/manage')return null;
 if(profileEvidence?.accountId!==accountId||profileEvidence?.accountVerified!==true||profileEvidence?.evidenceUrl!=='https://creator.douyin.com/creator-micro/home')fail('作品列表账号与原任务不同');
 const expected=norm(media.length+'张')+full;
 const all=[...document.querySelectorAll('*')].filter(visible).filter(e=>[expected,full].includes(norm(txt(e))));
 const leaf=all.filter(e=>!all.some(c=>c!==e&&e.contains(c)));if(leaf.length!==1)fail('作品列表尚无唯一原稿，未重新发布');
 let card=leaf[0],status=null;
 for(let i=0;card&&i<6;i++,card=card.parentElement){
  const states=[...card.querySelectorAll('div,span,p')].filter(visible).map(e=>txt(e).trim()).filter(t=>['已发布','审核中','审核未通过'].includes(t));
  if(states.length===1){status=states[0];break}if(states.length>1)break;
 }
 if(!status)fail('原稿列表状态不明确');if(status==='审核未通过')fail('平台审核未通过，请查看原稿原因');
 if(action==='receipt-list-open')leaf[0].click();
 return {accountId,contentVerified:true,mediaCount:media.length,reviewState:status==='已发布'?'published':'reviewing'};
 }catch(e){return {connectorError:String(e.message||'原稿回执待核对').slice(0,240)}}
}
