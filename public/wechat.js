// WeChat belongs to the same article distribution flow as every other
// platform. Keep this compatibility entry point for old buttons/bookmarks,
// but never make a second “WeChat manuscript” workflow or ask for a receipt.
function wechatPrepare(contentId){
 const content=contentId&&own('contents').find(c=>c.id===contentId&&c.status==='已审核'&&!c.demo);
 if(content&&typeof openArticleEditor==='function'){
  openArticleEditor(content);
  toast('已打开原稿；在“发布到哪些平台”勾选“微信公众号”即可。');
  return true;
 }
 location.hash='#inbox';
 toast('请打开一篇已审核稿件，在“发布到哪些平台”勾选“微信公众号”。');
 return false;
}
