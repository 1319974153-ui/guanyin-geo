import {formatArticle} from './article-format.js';
import {parseFragment,serialize} from 'parse5';

export const WECHAT_DOCS={
 draft:'https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html',
 publish:'https://developers.weixin.qq.com/doc/subscription/guide/product/publish.html',
 status:'https://developers.weixin.qq.com/doc/subscription/api/public/api_freepublish_get',
};
// Account type is a local planning hint, never proof of remote authorization.
export function wechatReadiness(type='unknown',permissions={}){
 const eligible=['verified_business','service_account'].includes(type);
 return {type,eligible,createDraft:permissions.draft===true,publish:eligible&&permissions.publish===true,
  broadcast:false,loginOnly:false,
  note:type==='personal'?'个人主体不支持官方发表接口；可准备稿件，由本人发布。':eligible?'需核对该账号实际接口权限；保存草稿、发表和群发是不同动作。':'先确认账号类型及认证，再核对接口权限。',
  docs:WECHAT_DOCS};
}
function length(s){return Array.from(s).length}
function text(value,name,max){if(typeof value!=='string'||!value.trim()||length(value)>max)throw Error(name+'长度无效');return value.trim()}
export function wechatPackage({title,text:body,author='',digest='',sourceUrl='',ai=false}){
 title=text(title,'标题',32);
 if(typeof author!=='string'||length(author)>16)throw Error('作者不能超过16字');
 if(typeof digest!=='string'||length(digest)>120)throw Error('摘要不能超过120字');
 if(sourceUrl){let u;try{u=new URL(sourceUrl)}catch{throw Error('阅读原文地址无效')}
  if(u.protocol!=='https:'||u.username||u.password||new TextEncoder().encode(sourceUrl).length>1024)throw Error('阅读原文须为不含凭据的HTTPS地址');}
 const formatted=formatArticle(body),doc=parseFragment(formatted.html),warnings=[...formatted.warnings];
 // Never let arbitrary remote images silently disappear after draft upload.
 let hasImages=false;const walk=n=>{if(n.tagName==='img')hasImages=true;for(const c of n.childNodes||[])walk(c)};walk(doc);
 if(hasImages)throw Error('正文图片需要先上传到微信图文素材；当前首版仅支持文字正文与独立封面');
 let html=serialize(doc);if(ai)html+='\n<p>本文包含 AI 辅助生成或整理的内容。</p>';
 if(length(html)>=20000||new TextEncoder().encode(html).length>=1000000)throw Error('公众号正文超过接口限制');
 return {title,author,digest,content:html,content_source_url:sourceUrl,article_type:'news',
  plainText:body+(ai?'\n\n本文包含 AI 辅助生成或整理的内容。':''),warnings,
  status:'prepared',note:'仅完成本地排版，不代表已保存到公众号或已发表'};
}
export function wechatArticle(pack,mediaId){
 if(typeof mediaId!=='string'||!mediaId||mediaId.length>256)throw Error('需要该公众号的永久封面素材');
 const {title,author,digest,content,content_source_url,article_type}=pack;
 return {title,author,digest,content,content_source_url,article_type,thumb_media_id:mediaId,need_open_comment:0,only_fans_can_comment:0};
}
export function wechatPublishReceipt(data){
 const status=data?.publish_status;
 if(!Number.isInteger(status)||status<0||status>6)throw Error('微信返回未知发布状态，需核对原任务');
 const labels=['平台报告发表成功','发表处理中','原创声明失败','发表失败','审核未通过','文章已删除','文章已封禁'];
 const urls=(data.article_detail?.item||[]).map(x=>x.article_url);
 for(const value of urls){let u;try{u=new URL(value)}catch{throw Error('微信回执链接无效')}
  if(u.protocol!=='https:'||u.hostname!=='mp.weixin.qq.com'||u.username||u.password)throw Error('微信回执链接不属于官方文章域名');}
 if(status===0&&(!data.article_id||!urls.length))throw Error('发表成功回执缺少文章编号或链接');
 return {state:status===0?'platform_published':status===1?'submitted':status>=5?'unavailable':'rejected',
  platformStatus:status,label:labels[status],articleId:data.article_id||null,urls,publicVerified:false,broadcast:false};
}
