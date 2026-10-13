import {canonicalUrl,entryOf} from './analytics-core.js';
import {factUsable} from './knowledge-core.js';
export function protectHandoffSnapshots(current,next){
 for(const p of next.publications){
  const prior=current.publications.find(x=>x.id===p.id);
  if(prior?.handoffSnapshot&&(p.contentId!==prior.contentId||p.brandId!==prior.brandId||JSON.stringify(prior.handoffSnapshot)!==JSON.stringify(p.handoffSnapshot)))throw Object.assign(new Error('交付副本不可覆盖，请保留历史版本'),{status:409});
  if(!p.handoffSnapshot||prior?.handoffSnapshot)continue;
  const c=current.contents.find(c=>c.id===p.contentId&&c.brandId===p.brandId),s=p.handoffSnapshot;
  if(c?.status!=='已审核'||s.title!==c.title||s.text!==c.text||s.contentId!==c.id||s.brandId!==c.brandId||JSON.stringify(s.factSnapshots||[])!==JSON.stringify(c.factSnapshots||[]))throw Object.assign(new Error('交付副本必须对应已保存的审核稿'),{status:409});
  if(c.productId&&current.brands.find(b=>b.id===c.brandId)?.productLines?.find(x=>x.id===c.productId)?.status!=='active')throw Object.assign(new Error('稿件产品已归档，请重新审核'),{status:409});
  for(const f of c.factSnapshots||[]){const live=current.facts.find(x=>x.id===f.id&&x.brandId===c.brandId);if(!live||!factUsable(live)||live.value!==f.value||live.source!==f.source||(live.version||1)!==(f.version||1))throw Object.assign(new Error('稿件依据已变化，请重新审核'),{status:409});}
 }
}
export const PUBLICATION_STAGES={planned:'待发布',draft:'平台草稿',in_review:'平台审核中',rejected:'平台审核未通过',registered:'已登记链接 · 上线待核对',published:'平台已发布 · 人工登记',offline:'已下线 · 人工登记'};
export function publicationStage(p){return p.publicationStage||(p.url?'registered':'planned');}
export function isPlatformReceiptUrl(value){
 let u;try{u=new URL(value)}catch{return false}
 const host=u.hostname.toLowerCase(),path=u.pathname;
 return ['creator.douyin.com','creator.xiaohongshu.com','mp.toutiao.com','mp.sohu.com','member.bilibili.com'].includes(host)||
  (host==='baijiahao.baidu.com'&&/^\/builder(?:\/|$)/.test(path))||
  (host==='mp.weixin.qq.com'&&/^\/cgi-bin(?:\/|$)/.test(path))||
  (host==='zhuanlan.zhihu.com'&&(/^\/write\/?$/.test(path)||/^\/p\/[^/]+\/edit\/?$/.test(path)));
}
export function canCheckPublication(p){return !!p.url&&!isPlatformReceiptUrl(p.url)&&(!p.publicationStage||['registered','published'].includes(p.publicationStage));}
export function publicationStatus(p){return p.wordpressRunId?p.status:PUBLICATION_STAGES[publicationStage(p)]||p.status;}
export function publicationConfig(p){return{url:canonicalUrl(p.url),enabled:p.autoRetest===true&&canCheckPublication(p),stage:p.publicationStage||null,intervalHours:[6,24,168].includes(p.retestEveryHours)?p.retestEveryHours:24,windowDays:[7,30,90].includes(p.retestWindowDays)?p.retestWindowDays:30};}
export function validatePublicationRecord(p){
 if(p.publicationStage!==undefined&&!Object.hasOwn(PUBLICATION_STAGES,p.publicationStage))throw new Error('请选择有效的发布阶段');
 for(const [key,max] of [['platformAccount',160],['platformReceiptUrl',2000],['platformNote',3000]])if(p[key]!==undefined&&(typeof p[key]!=='string'||p[key].length>max))throw new Error('发布账号、平台回执地址或说明格式不正确');
 if(p.platformReceiptUrl){let u;try{u=new URL(p.platformReceiptUrl)}catch{throw new Error('请输入有效的平台草稿或审核回执地址')}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('平台回执地址仅支持不含登录凭据的 HTTP/HTTPS 链接');}
 if(p.publicationStage==='registered'&&!p.url)throw new Error('登记链接需要填写文章 URL');
 if(p.publicationStage&&p.url){let u;try{u=new URL(p.url)}catch{throw new Error('请输入有效的文章 URL')}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('文章地址仅支持不含登录凭据的 HTTP/HTTPS 链接');}
 if(p.publicationStage&&isPlatformReceiptUrl(p.url))throw new Error('编辑器或创作后台地址请填入平台回执栏，公开文章 URL 可暂留空');
 if(p.publicationStage&&['draft','in_review','rejected','published','offline'].includes(p.publicationStage)&&!p.platformNote?.trim()&&!p.platformReceiptUrl)throw new Error('请保存平台回执地址或实际观察到的状态说明');
}
export function validatePublicationConfigs(state){for(const p of state.publications){validatePublicationRecord(p);if(p.autoRetest!==undefined&&typeof p.autoRetest!=='boolean')throw new Error('文章自动复测开关格式不正确');if(p.retestEveryHours!==undefined&&![6,24,168].includes(p.retestEveryHours))throw new Error('文章复测频率支持 6、24、168 小时');if(p.retestWindowDays!==undefined&&![7,30,90].includes(p.retestWindowDays))throw new Error('文章引用窗口支持 7、30、90 天');}}
export function observePublication(state,p,clock=new Date()){
 const config=publicationConfig(p),to=clock.toISOString(),from=new Date(Date.parse(to.slice(0,10)+'T00:00:00Z')-(config.windowDays-1)*86400000).toISOString();
 const rows=state.answers.filter(a=>!a.demo&&a.brandId===p.brandId&&a.status==='ok'&&typeof a.text==='string'&&a.text.trim()&&Date.parse(a.date)>=Date.parse(from)&&Date.parse(a.date)<=clock.getTime());
 return {url:config.url,window:{from,to,days:config.windowDays},surfaces:['import','api'].map(surface=>{
  const answers=rows.filter(a=>a.surface===surface),linked=answers.filter(a=>a.citations?.some(c=>canonicalUrl(c.url)===config.url&&config.url)),verified=linked.filter(a=>a.citationKnown===true),recommendations=verified.filter(a=>a.recommendationLabeled===true),dates=a=>a.map(x=>x.date).sort((a,b)=>Date.parse(a)-Date.parse(b));
  const firstVerifiedAnswer=verified.slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0],evidenceRows=[...(firstVerifiedAnswer?[firstVerifiedAnswer]:[]),...linked.slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).filter(a=>a.id!==firstVerifiedAnswer?.id)].slice(0,50);
  const evidence=evidenceRows.map(a=>({id:a.id,date:a.date,questionId:a.promptId,questionVersion:a.questionVersion||'',questionText:a.questionText||a.questionSnapshot||'原问题未记录',platform:a.platform,entry:entryOf(a),mode:a.mode||'',citationKnown:a.citationKnown===true,recommendationLabeled:a.recommendationLabeled===true,recommended:a.recommendationLabeled===true?a.recommended===true:null,quote:a.text.slice(0,1500),citations:a.citations.filter(c=>canonicalUrl(c.url)===config.url).slice(0,3).map(c=>({url:c.url,title:String(c.title||'').slice(0,300)}))}));
  return {surface,n:answers.length,citationN:answers.filter(a=>a.citationKnown===true).length,linkedN:linked.length,verifiedLinkedN:verified.length,recommendationN:recommendations.length,recommendedN:recommendations.filter(a=>a.recommended===true).length,first:dates(linked)[0]||null,last:dates(linked).at(-1)||null,firstVerified:dates(verified)[0]||null,platforms:[...new Set(linked.map(a=>a.platform))].map(platform=>({platform,linked:linked.filter(a=>a.platform===platform).length,verified:verified.filter(a=>a.platform===platform).length})),evidence,omittedEvidence:Math.max(0,linked.length-evidence.length)};
 })};
}
export function publicationAlertCandidates(state,records,brandId,rules){
 if(!rules.enabled||!rules.citations)return [];const result=[];
 for(const row of records.filter(r=>r.kind==='publication_watch'&&r.brand_id===brandId)){const w=JSON.parse(row.body),p=state.publications.find(p=>p.brandId===brandId&&p.id===w.publicationId);if(!p||publicationConfig(p).url!==w.url)continue;
  for(const [surface,f]of Object.entries(w.firstVerified||{}))result.push({key:'article-first:'+p.id+':'+w.url+':'+surface,type:'article_citation',title:'首次记录到文章的已核对引用',detail:(surface==='api'?'API':'导入实测')+' 回答包含已登记文章链接；记录时间与回答采集时间分别保留，不推断平台全网首次引用。',evidence:{publicationId:p.id,title:p.title,url:w.url,surface,checkId:f.checkId,answerIds:f.answerIds,capturedAt:f.capturedAt,detectedAt:f.detectedAt}});
 }return result;
}
