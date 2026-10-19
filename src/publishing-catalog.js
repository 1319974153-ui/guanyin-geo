// Product scope is separate from adapter availability and per-account permissions.
// Reference: CSDN Sync Assistant's visible platform directory, checked 2026-10-19.
// Seeing a platform in that directory proves neither its final publish mode nor ours.
export const referencePlatformIds = Object.freeze([
 'wechat','weibo','zhihu','juejin','baijiahao','cnblogs','douyin_article','douyin',
 'xiaohongshu_article','xiaohongshu','toutiao','51cto','jianshu','segmentfault',
 'oschina','bilibili','tencentcloud','aliyun'
]);
const groups = {
 self_hosted: [['wordpress','WordPress'],['typecho','Typecho'],['metaweblog','MetaWeblog API']],
 knowledge: [['csdn','CSDN'],['zhihu','知乎'],['juejin','掘金'],['cnblogs','博客园'],['tencentcloud','腾讯云开发者社区'],['aliyun','阿里云开发者社区'],['51cto','51CTO'],['segmentfault','思否'],['oschina','开源中国'],['yuque','语雀'],['imooc','慕课手记'],['woshipm','人人都是产品经理']],
 general: [['toutiao','头条'],['baijiahao','百家号'],['jianshu','简书'],['sohu','搜狐号'],['netease','网易号'],['dayu','大鱼号'],['yidian','一点号']],
 social: [['wechat','微信公众号'],['weibo','微博'],['douyin_article','抖音长文'],['douyin','抖音图文'],['xiaohongshu_article','小红书长文笔记'],['xiaohongshu','小红书图文笔记'],['x','X（Twitter）'],['douban','豆瓣']],
 video: [['bilibili','哔哩哔哩']],
 vertical: [['xueqiu','雪球'],['eastmoney','东方财富'],['smzdm','什么值得买'],['sohufocus','搜狐焦点']]
};
const browserAdapters=new Set(['csdn','toutiao','zhihu','douyin','xiaohongshu']);
const prepareTested=new Set(['csdn','toutiao','zhihu']);
export function publishingCatalog(){
 return Object.entries(groups).flatMap(([group,entries])=>entries.map(([id,name])=>{
  const wp=id==='wordpress',browser=browserAdapters.has(id),tested=prepareTested.has(id);
  return {
   id,name,group,referenceIncluded:referencePlatformIds.includes(id),
   implementation:wp?'adapter_available':browser?'browser_adapter_acceptance':'planned',
   contentTypes:wp||browser?(['douyin','xiaohongshu'].includes(id)?['image_text']:['article']):[],
   plannedContentTypes:['douyin','xiaohongshu'].includes(id)?['image_text']:['article'],
   connectionMethod:wp?'application_password':browser?'local_browser_extension':null,
   acceptance:wp?'account_verification_required':tested?'identity_and_prepare_tested':browser?'live_acceptance_pending':'not_implemented',
   stage:wp?'可连接网站':tested?'已实测填稿':browser?'接入验收中':'待开发',
   note:wp?'支持草稿与发布；须验证自己的账号和权限':tested?'已实测账号与填稿；公开提交仍待验收':browser?'已有适配代码；账号、图片与填稿仍须实机验收':'已列入完整接入计划，尚不能自动填稿或发布',
   // Catalog metadata must never grant a publish capability to an account.
   accountRequired:true
  };
 }));
}
