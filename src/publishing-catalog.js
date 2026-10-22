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
import {publishingEvidence,publishingEvidenceSummary,PUBLISHING_EVIDENCE_DATE} from './publishing-evidence.js';
const browserAdapters=new Set(['csdn','toutiao','zhihu','douyin','xiaohongshu']);
export function publishingCatalog(){
 return Object.entries(groups).flatMap(([group,entries])=>entries.map(([id,name])=>{
  const wp=id==='wordpress',browser=browserAdapters.has(id),actions=publishingEvidence(id),tested=actions.prepare.liveAcceptance==='passed';
  return {
   id,name,group,referenceIncluded:referencePlatformIds.includes(id),
   implementation:id==='cnblogs'?'api_adapter_acceptance':wp?'adapter_available':browser?'browser_adapter_acceptance':'planned',
   contentTypes:wp||browser||id==='cnblogs'?(['douyin','xiaohongshu'].includes(id)?['image_text']:['article']):[],
   plannedContentTypes:['douyin','xiaohongshu'].includes(id)?['image_text']:['article'],
   connectionMethod:id==='cnblogs'?'metaweblog_token':wp?'application_password':browser?'local_browser_extension':null,
   acceptance:id==='cnblogs'?'live_acceptance_pending':wp?'account_verification_required':tested?'identity_and_prepare_tested':browser?'live_acceptance_pending':'not_implemented',
   ...publishingEvidenceSummary(id,actions),
   actionEvidence:actions,evidenceUpdatedAt:PUBLISHING_EVIDENCE_DATE,
   // Catalog metadata must never grant a publish capability to an account.
   accountRequired:true
  };
 }));
}
