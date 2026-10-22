import {canBrand,reject} from './access.js';
import {wordpressAccount,wordpressProvider} from './publishing-accounts.js';
import {cnblogsProvider,cnblogsRunState} from './cnblogs.js';
import {typechoProvider,typechoRunState} from './typecho.js';

export {publishingCatalog} from './publishing-catalog.js';
import {publishingCatalog} from './publishing-catalog.js';

export async function publishingCenterApi(req,env,ctx,h){
 const url=new URL(req.url);
 if(!url.pathname.startsWith('/api/publishing-center'))return null;
 if(url.pathname!=='/api/publishing-center')reject(404,'发布中心接口不存在');
 if(req.method!=='GET')reject(405,'当前发布中心接口仅支持读取');
 if(ctx.key)reject(403,'请通过已登录工作台读取发布账号');
 const brandId=url.searchParams.get('brandId'),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(b=>b.id===brandId)||!canBrand(ctx,brandId))reject(404,'找不到授权品牌');
 // Select metadata only: this endpoint never reads/decrypts credentials or contacts a platform.
 const prefix='wordpress:'+brandId;
 const rows=(await env.DB.prepare('SELECT provider,model,updated FROM connections WHERE owner=? AND (provider=? OR substr(provider,1,length(?))=?) ORDER BY provider').bind(ctx.owner,prefix,prefix+':',prefix+':').all()).results;
 const accounts=[];
 for(const row of rows){
  let m;try{m=JSON.parse(row.model)}catch{reject(409,'网站连接记录无法读取，请重新配置');}
  const accountId=row.provider===prefix?'default':wordpressAccount(row.provider.slice(prefix.length+1));
  if(!m||m.brandId!==brandId||(m.accountId||'default')!==accountId||wordpressProvider(brandId,accountId)!==row.provider)reject(409,'网站连接品牌或账号不匹配，请重新配置');
  const verified=!!m.verifiedAt&&Number.isSafeInteger(m.userId)&&m.userId>0;
  const enabled=m.enabled===true,canOperate=['owner','admin','editor'].includes(ctx.role);
  accounts.push({id:row.provider,accountId,platform:'wordpress',brandId,
   site:m.site,username:m.username,remoteAccountId:verified?String(m.userId):null,
   connectionRevision:m.revision,updatedAt:row.updated,
   status:!enabled?'disabled':!verified?'unverified':m.canPublish!==true?'permission_limited':'verified',
   verifiedAt:verified?m.verifiedAt:null,verification:'last_saved_check',
   capabilities:{createDraft:enabled&&verified&&canOperate,publish:enabled&&verified&&m.canPublish===true&&canOperate},
   note:'展示上次验证结果；提交时仍须核对当前连接、稿件与平台权限'
  });
 }
 const receipts=[];
 for(const [platform,provider,runState] of [['cnblogs',cnblogsProvider,cnblogsRunState],['typecho',typechoProvider,typechoRunState]]){
 const cbPrefix=platform+':'+brandId+':';
 const cbRows=(await env.DB.prepare('SELECT provider,model,updated FROM connections WHERE owner=? AND substr(provider,1,length(?))=? ORDER BY provider').bind(ctx.owner,cbPrefix,cbPrefix).all()).results;
 for(const row of cbRows){let m;try{m=JSON.parse(row.model)}catch{reject(409,'网站连接记录无法读取')}
  if(m.brandId!==brandId||provider(brandId,m.accountId)!==row.provider)reject(409,'网站连接品牌或账号不匹配');
  const usable=m.enabled&&m.verifiedAt&&m.blogId&&(platform!=='typecho'||(m.userId&&m.site&&m.endpoint));
  accounts.push({id:row.provider,platform,brandId,accountId:m.accountId,username:m.username,site:m.site,blog:m.blog,endpoint:m.endpoint,connectionRevision:m.revision,status:!m.enabled?'disabled':usable?'verified':'unverified',verifiedAt:m.verifiedAt,capabilities:{createDraft:!!usable&&['owner','admin','editor'].includes(ctx.role),publish:!!usable&&['owner','admin','editor'].includes(ctx.role)}});
 }
 const receiptRows=(await env.DB.prepare("SELECT id,state,created,result FROM runs WHERE owner=? AND kind=? AND json_extract(result,'$.brandId')=? ORDER BY created DESC LIMIT 1000").bind(ctx.owner,platform,brandId).all()).results;
 receipts.push(...receiptRows.map(row=>{const r=JSON.parse(row.result),c=w.state.contents.find(c=>c.brandId===brandId&&c.id===r.snapshot.contentId);return {id:row.id,brandId,platform,accountId:r.accountId,contentId:r.snapshot.contentId,title:r.snapshot.title,state:runState(r,row.state),mode:r.publishAttemptedAt?'publish':'draft',created:Date.parse(row.created),error:r.error||'',receipt:r.remote,currentRevision:!!c&&!c.demo&&c.status==='已审核'&&c.title===r.snapshot.title&&c.text===r.snapshot.text&&!!c.ai===r.snapshot.ai&&JSON.stringify(c.factSnapshots||[])===JSON.stringify(r.snapshot.facts||[])}}));
 }
 return h.json({brandId,platforms:publishingCatalog(),accounts,receipts,
  batchPublishingAvailable:false,
  connectionLimit:'支持同一品牌多个 WordPress 账号；旧连接保留为默认账号',
  exports:[{id:'markdown',name:'Markdown',kind:'local_export'},{id:'pdf',name:'PDF',kind:'local_export'}]});
}
