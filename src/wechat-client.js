// Server-only protocol client. No cookies, browser sessions, CAPTCHA, redirects,
// mass-message endpoint, or automatic retries. Never include provider error text
// in logs: it can echo credentials or an access-token URL.
export class WechatError extends Error {
 constructor(code,operation,uncertain=false){super(`微信公众号${operation}未完成（${code}）${uncertain?'，结果未知，请核对原任务，勿重复提交':''}`);this.code=code;this.uncertain=uncertain;}
}
export function createWechatClient({fetchImpl=fetch,tokenProvider,enabled=false}){
 const allowed=new Set(['draft/count','draft/add','draft/get','freepublish/batchget','freepublish/submit','freepublish/get','material/add_material']);
 async function send(path,payload,{write=false,form=false,token=true}={}){
  if(!enabled)throw new WechatError('NOT_ENABLED',path);
  if(path!=='stable_token'&&!allowed.has(path))throw new WechatError('NOT_SUPPORTED','操作');
  const url=new URL('https://api.weixin.qq.com/cgi-bin/'+path);
  if(token){let value;try{value=await tokenProvider()}catch{throw new WechatError('TOKEN_UNAVAILABLE','授权')}if(typeof value!=='string'||!value||value.length>2048)throw new WechatError('INVALID_TOKEN','授权');url.searchParams.set('access_token',value);}
  if(form)url.searchParams.set('type','image');
  const get=path==='draft/count';let r;
  try{r=await fetchImpl(url,{method:get?'GET':'POST',redirect:'manual',headers:form?{accept:'application/json'}:{accept:'application/json','content-type':'application/json'},...(get?{}:{body:form?payload:JSON.stringify(payload)}),signal:AbortSignal.timeout(20000)});}catch{throw new WechatError('NETWORK',path,write)}
  if(!r.ok){await r.body?.cancel();throw new WechatError('HTTP_'+r.status,path,write)}
  let data;try{const reader=r.body.getReader(),parts=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('large')}parts.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new WechatError('INVALID_RESPONSE',path,write)}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new WechatError('INVALID_RESPONSE',path,write);
  if(data.errcode!==undefined&&data.errcode!==0)throw new WechatError(Number.isInteger(data.errcode)?data.errcode:'INVALID_RESPONSE',path);
  return data;
 }
 return {
  stableToken:({appid,secret})=>{if(!/^wx[a-f\d]{16}$/i.test(appid)||typeof secret!=='string'||secret.length<16)throw new WechatError('INVALID_CONFIG','授权');return send('stable_token',{grant_type:'client_credential',appid,secret,force_refresh:false},{token:false});},
  draftCount:()=>send('draft/count'),publishedSample:()=>send('freepublish/batchget',{offset:0,count:1,no_content:1}),
  uploadCover:async(bytes,mime)=>{if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>10*1024*1024||!['image/png','image/jpeg'].includes(mime))throw new WechatError('INVALID_IMAGE','上传封面');const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(mime==='image/png'?!png:!jpg)throw new WechatError('INVALID_IMAGE','上传封面');const f=new FormData();f.set('media',new Blob([bytes],{type:mime}),mime==='image/png'?'cover.png':'cover.jpg');return send('material/add_material',f,{write:true,form:true});},
  addDraft:article=>send('draft/add',{articles:[article]},{write:true}),
  getDraft:media_id=>send('draft/get',{media_id}),
  submit:media_id=>send('freepublish/submit',{media_id},{write:true}),
  status:publish_id=>send('freepublish/get',{publish_id}),
 };
}
