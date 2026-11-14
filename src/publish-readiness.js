import {assertArticleMediaDelivery} from './article-media-core.js';
import {PLATFORMS} from '../browser-extension/platforms.js';

const modeNames={publish:'发布文章',draft:'保存草稿',prepare:'填入编辑器'};
const length=value=>[...String(value||'').trim()].length;

// Read-only checks against the same adapter contracts used by the local queue.
// This is a content preparation check, never a login probe or a publish grant.
export function publishReadiness({article={},targets=[],mode='publish',tags=[],media=[],mediaLoading=false,mediaError=''}={}){
 const generalIssues=[];
 if(!Object.hasOwn(modeNames,mode))generalIssues.push('请选择有效的发布操作');
 if(!length(article.title))generalIssues.push('请填写文章标题');
 if(!length(article.text))generalIssues.push('请填写文章正文');
 if(mediaLoading)generalIssues.push('图片仍在读取，请稍后');
 if(mediaError)generalIssues.push('图片准备失败，请重新选择图片，或点击“清空图片”后再发送');
 try{assertArticleMediaDelivery(article,media);}catch(error){generalIssues.push(error.message);}
 const rows=targets.map(target=>{
  const config=PLATFORMS[target.platform],name=target.platformName||config?.name||target.detail||target.platform;
  const row={key:target.key,platform:target.platform,accountId:target.accountId||'',name,accountName:target.name||'',status:'ready',issues:[]};
  if(target.implementation==='planned'||target.placeholder){row.status='unavailable';row.issues.push('此平台尚未接入可用账号');return row;}
  if(target.loginRequired||!target.accountId){row.status='needs_login';row.issues.push('请先在该平台完成账号登录');return row;}
  if(!Array.isArray(target.modes)||!target.modes.includes(mode)){
   row.status='unavailable';
   const evidence=target.actionEvidence?.[mode];
   row.issues.push(evidence?.implemented&&evidence.liveAcceptance!=='passed'?'此操作尚未完成真实账号验收，暂未开放':`当前账号不支持${modeNames[mode]||'此操作'}`);
   return row;
  }
  if(media.length&&!config?.images)row.issues.push('此渠道暂不支持本稿附加图片，请选择支持配图的平台，或另存无配图的渠道稿');
  if(config){
   if(length(article.title)>config.titleMax)row.issues.push(`标题需缩短到 ${config.titleMax} 字以内（当前 ${length(article.title)} 字）`);
   if(length(article.text)>config.textMax)row.issues.push(`正文需调整到 ${config.textMax} 字以内（当前 ${length(article.text)} 字），请另存渠道适配稿`);
   if(config.tagsRequired&&(!Array.isArray(tags)||!tags.length||tags.length>5||new Set(tags).size!==tags.length||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>20)))row.issues.push('请填写 1 至 5 个不同标签，每个最多 20 字');
   if(config.images&&!config.optionalImages&&!media.length)row.issues.push('请添加至少 1 张图文图片');
   if(config.images&&media.length>config.images)row.issues.push(`图片最多 ${config.images} 张`);
   if(target.platform==='51cto'&&media.length&&mode==='prepare')row.issues.push('图片稿请选择“保存平台草稿”或“发布文章”，以保留图片回执');
  }
  if(row.issues.length)row.status='needs_input';
  return row;
 });
 return {canSend:rows.length>0&&!generalIssues.length&&rows.every(row=>row.status==='ready'),generalIssues,rows,readyCount:rows.filter(row=>row.status==='ready').length};
}
