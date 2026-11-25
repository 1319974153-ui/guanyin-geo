export function kimiConversationUrl(value){
 try{
  const url=new URL(value);
  if(url.origin==='https://www.kimi.com'&&!url.username&&!url.password&&/^\/chat\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/i.test(url.pathname)){
   return url.origin+url.pathname.replace(/\/$/,'');
  }
 }catch{}
 return '';
}
