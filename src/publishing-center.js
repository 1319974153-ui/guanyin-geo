import {canBrand,reject} from './access.js';

// A directory entry is a roadmap item, not evidence of an installed connector.
const groups = {
 self_hosted: [['wordpress','WordPress'],['typecho','Typecho'],['metaweblog','MetaWeblog API']],
 knowledge: [['zhihu','知乎'],['juejin','掘金'],['csdn','CSDN'],['cnblogs','博客园'],['yuque','语雀'],['51cto','51CTO'],['oschina','开源中国'],['segmentfault','思否'],['imooc','慕课手记'],['woshipm','人人都是产品经理']],
 general: [['toutiao','头条'],['sohu','搜狐号'],['netease','网易号'],['dayu','大鱼号'],['baijiahao','百家号'],['yidian','一点号'],['jianshu','简书']],
 social: [['weibo','微博'],['xiaohongshu','小红书'],['douyin','抖音图文'],['x','X（Twitter）'],['douban','豆瓣'],['wechat','微信公众号']],
 video: [['bilibili','哔哩哔哩']],
 vertical: [['xueqiu','雪球'],['eastmoney','东方财富'],['smzdm','什么值得买'],['sohufocus','搜狐焦点']]
};

export function publishingCatalog(){
 return Object.entries(groups).flatMap(([group,entries])=>entries.map(([id,name])=>({
  id,name,group,implementation:id==='wordpress'?'adapter_available':'planned',
  contentTypes:id==='wordpress'?['article']:[],
  connectionMethod:id==='wordpress'?'application_password':null,
  note:id==='wordpress'?'已有网站发布适配器，须验证用户自己的账号及权限':'待接入，当前不能自动发布'
 })));
}

export async function publishingCenterApi(req,env,ctx,h){
 const url=new URL(req.url);
 if(!url.pathname.startsWith('/api/publishing-center'))return null;
 if(url.pathname!=='/api/publishing-center')reject(404,'发布中心接口不存在');
 if(req.method!=='GET')reject(405,'当前发布中心接口仅支持读取');
 if(ctx.key)reject(403,'请通过已登录工作台读取发布账号');
 const brandId=url.searchParams.get('brandId'),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(b=>b.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
 // Select metadata only: this endpoint never reads/decrypts credentials or contacts a platform.
 const row=await env.DB.prepare('SELECT model,updated FROM connections WHERE owner=? AND provider=?').bind(ctx.owner,'wordpress:'+brandId).first();
 const accounts=[];
 if(row){
  let m;try{m=JSON.parse(row.model)}catch{reject(409,'网站连接记录无法读取，请重新配置');}
  if(!m||m.brandId!==brandId)reject(409,'网站连接品牌不匹配，请重新配置');
  const verified=!!m.verifiedAt&&Number.isSafeInteger(m.userId)&&m.userId>0;
  const enabled=m.enabled===true,canOperate=['owner','admin','editor'].includes(ctx.role);
  accounts.push({id:'wordpress:'+brandId,platform:'wordpress',brandId,
   site:m.site,username:m.username,remoteAccountId:verified?String(m.userId):null,
   connectionRevision:m.revision,updatedAt:row.updated,
   status:!enabled?'disabled':!verified?'unverified':m.canPublish!==true?'permission_limited':'verified',
   verifiedAt:verified?m.verifiedAt:null,verification:'last_saved_check',
   capabilities:{createDraft:enabled&&verified&&canOperate,publish:enabled&&verified&&m.canPublish===true&&canOperate},
   note:'展示上次验证结果；提交时仍须核对当前连接、稿件与平台权限'
  });
 }
 return h.json({brandId,platforms:publishingCatalog(),accounts,
  batchPublishingAvailable:false,
  connectionLimit:'目前每个品牌仅复用一个 WordPress 连接，多账号连接待实现',
  exports:[{id:'markdown',name:'Markdown',kind:'local_export'},{id:'pdf',name:'PDF',kind:'local_export'}]});
}
