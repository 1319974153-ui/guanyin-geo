import {contentDisclosureConflict} from './knowledge-core.js';
import {parseFragment} from 'parse5';
import {formatArticle,ARTICLE_FORMAT_VERSION} from './article-format.js';
import {PLATFORMS} from '../browser-extension/platforms.js';
import {publishingCatalog} from './publishing-catalog.js';

export const PLATFORM_ADAPTATION_VERSION='local-preview-v1';
const charCount=value=>Array.from(String(value||'').trim()).length;
const catalog=publishingCatalog();
const imageTypes=new Set(['image/png','image/jpeg','image/webp']);
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','blockquote','pre','ul','ol','table','tr']);

// Convert the existing safe formatter output, retaining links, image references,
// code and cell text. This changes presentation, not the source article.
export function adaptationPlainText(html){
 const root=parseFragment(html),paragraphs=[],images=[];
 const render=n=>{
  if(n.nodeName==='#text')return n.value;
  if(n.tagName==='br')return '\n';
  const a=attrs(n);
  if(n.tagName==='img'){images.push({alt:a.alt||'',url:a.src||''});return '[图片：'+(a.alt||'未提供说明')+']'+(a.src?'（'+a.src+'）':'')}
  const content=(n.childNodes||[]).map(render).join('');
  if(n.tagName==='a')return content+(a.href&&a.href!==content?'（'+a.href+'）':'');
  if(n.tagName==='p'&&content.trim())paragraphs.push(content.trim());
  if(n.tagName==='li')return '\n- '+content.trim()+'\n';
  if(n.tagName==='td'||n.tagName==='th')return content.trim()+'\t';
  return blocks.has(n.tagName)?'\n\n'+content.trim()+'\n\n':content;
 };
 const text=render(root).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {text,paragraphs,images};
}
export function platformAdaptationOptions(){
 return [{id:'generic-article',name:'通用长文',category:'article'},{id:'generic-image-text',name:'通用短图文',category:'image_text'},...catalog.map(p=>({id:p.id,name:p.name,category:(p.contentTypes?.length?p.contentTypes:p.plannedContentTypes)?.includes('image_text')?'image_text':'article',implementation:p.implementation}))];
}
function mediaMetadata(media){
 if(!Array.isArray(media)||media.length>100)throw Error('图片清单无效');
 return media.map((m,i)=>{
  if(!m||typeof m!=='object')throw Error('图片记录无效');
  const type=String(m.type||''),data=typeof m.dataUrl==='string'?m.dataUrl:'';
  let bytes=Number.isSafeInteger(m.size)&&m.size>=0?m.size:null;
  // Existing editor stores data URLs but exports must not contain image bytes.
  if(bytes===null&&data.startsWith('data:'+type+';base64,')){
   const payload=data.slice(data.indexOf(',')+1);if(payload.length<=16*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(payload)&&payload.length%4===0)bytes=payload.length/4*3-(payload.endsWith('==')?2:payload.endsWith('=')?1:0);
  }
  return {name:typeof m.name==='string'?m.name:'图片 '+(i+1),type,bytes,sha256:/^[a-f0-9]{64}$/i.test(m.sha256||'')?m.sha256:null};
 });
}
function sourceSnapshot(article){
 const title=typeof article.title==='string'?article.title:'',text=typeof article.text==='string'?article.text:'';
 if(title.length>1000||text.length>100000)throw Error('本地预览最多接收 1000 字符标题与 100000 字符正文；原稿未修改');
 return {id:String(article.id||''),brandId:String(article.brandId||''),productId:typeof article.productId==='string'?article.productId:null,title,text,ai:article.ai===true};
}
export function platformContentAdaptation({article={},platformId='generic-article',tags=[],media=[],mediaLoading=false,mediaError=''}={}){
 const option=platformAdaptationOptions().find(p=>p.id===platformId);if(!option)throw Error('请选择目录中已有的平台或通用文章形式');
 const original=sourceSnapshot(article),platform=catalog.find(p=>p.id===platformId),config=PLATFORMS[platformId],images=mediaMetadata(media),checks=[];
 if(!Array.isArray(tags)||tags.some(t=>typeof t!=='string')||tags.length>100)throw Error('标签清单无效');
 const suppliedTags=tags.map(t=>t.trim()).filter(Boolean),formatted=original.text.trim()?formatArticle(original.text):{html:'',version:ARTICLE_FORMAT_VERSION,warnings:[]},plain=adaptationPlainText(formatted.html);
 const category=option.category,body=category==='image_text'?plain.text:original.text;
 const check=(field,status,message,basis='本地材料检查')=>checks.push({field,status,message,basis});
 const ruleSource=config?'当前连接器配置（不是平台最新官方限额）':'平台要求尚未核对';
 for(const [field,label,value,limit] of [['title','标题',original.title,config?.titleMax],['body','正文',body,config?.textMax]]){
  const count=charCount(value);
  if(!count)check(field,'needs_input','请补充'+label);
  else if(Number.isSafeInteger(limit))check(field,count>limit?'needs_input':'ok',count>limit?label+' '+count+' 字，超过当前连接器的 '+limit+' 字限制；请另存适配稿修改，未截断原文':label+' '+count+' 字，符合当前连接器的 '+limit+' 字限制',ruleSource);
  else check(field,'needs_confirmation',label+'完整保留 '+count+' 字；长度要求待平台确认',ruleSource);
 }
 const summary=plain.paragraphs.find(p=>!/^本文包含\s*AI\s*辅助/.test(p))||'';
 check('summary',summary?'needs_confirmation':'needs_input',summary?'已摘取第一个完整正文段落作为摘要候选；未压缩、未补写，需核对是否概括全文及平台摘要长度':'没有可直接摘取的正文段落；请补充文章正文后再准备摘要','原稿完整段落摘录，不是 AI 总结');
 if(config?.tagsRequired){
  const valid=suppliedTags.length>0&&suppliedTags.length<=5&&new Set(suppliedTags).size===suppliedTags.length&&suppliedTags.every(t=>t.length<=20);
  check('tags',valid?'ok':'needs_input',valid?'保留已填写的 '+suppliedTags.length+' 个标签':'请补充 1 至 5 个不同标签，每个最多 20 字；不会自动猜测热门标签',ruleSource);
 }else check('tags','needs_confirmation',suppliedTags.length?'保留已填写标签；平台是否支持及数量限制待确认':'未自动添加标签；是否需要标签待平台确认',ruleSource);
 if(mediaLoading)check('images','needs_input','图片仍在读取，请等待完成后刷新预览');
 if(mediaError)check('images','needs_input','图片准备失败：'+String(mediaError));
 if(config?.images&&!config.optionalImages&&!images.length)check('images','needs_input','请添加至少 1 张图文图片；正文里的图片链接不能代替已选图片',ruleSource);
 else if(config?.images&&images.length>config.images)check('images','needs_input','已选 '+images.length+' 张图片，当前连接器最多 '+config.images+' 张',ruleSource);
 else if(config?.images)check('images','ok',images.length?'已选 '+images.length+' 张图片；内容、顺序和使用权限仍需确认':'此连接器支持无配图文章',ruleSource);
 else if(images.length)check('images','needs_confirmation',config?'此连接器未接入独立附件上传；已选图片不能视为会随此渠道发送':'附件上传方式待平台确认；本次只导出图片清单',ruleSource);
 else if(category==='image_text')check('images','needs_input','短图文还没有配图；添加图片后再核对目标平台要求','所选内容形式');
 else check('images','needs_confirmation','未选择附件；封面及图片要求待平台确认',ruleSource);
 for(const image of images)if(!imageTypes.has(image.type)||image.bytes===null||image.bytes===0)check('images','needs_input',image.name+'：缺少可核对的图片类型或文件大小，需重新选择原文件');
 const known=images.filter(m=>m.bytes!==null);if(known.some(m=>m.bytes>2*1024*1024)||known.reduce((n,m)=>n+m.bytes,0)>8*1024*1024)check('images','needs_input','图片超出当前发布界面的单张 2 MB、合计 8 MB 范围；请处理原图片后重选','当前发布界面的本地上传范围');
 if(plain.images.length)check('inline_images','needs_confirmation','正文包含 '+plain.images.length+' 个 HTTPS 图片引用；预览未读取远程图片，也未上传素材','既有安全排版结果');
 if(original.ai)check('disclosure','needs_confirmation',/AI\s*辅助|人工智能.*(?:生成|整理)|内容.*由.*AI/.test(body)?'原稿包含 AI 相关声明，请确认满足目标平台要求':'原稿标记为 AI 辅助，但正文未找到明确披露；请补充对应声明','原稿声明检查');
 if(platform?.implementation==='planned')check('platform','needs_confirmation','该平台仍在接入计划中；适配材料导出不代表能够自动发布','当前平台目录');
 check('publication','needs_confirmation','本地预览不检查登录、作者权限或审核结果；发布时仍由原有账号和稿件检查决定','不授予发布权限');
 for(const warning of formatted.warnings)check('format','needs_confirmation',warning,'既有安全排版器');
 return {schema:PLATFORM_ADAPTATION_VERSION,platform:{id:platformId,name:option.name,category,implementation:platform?.implementation||'generic_preview'},original,derived:{title:original.title,body,plainText:plain.text,html:formatted.html,summary,summaryMethod:'first_complete_body_paragraph',tags:suppliedTags,images},changes:category==='image_text'&&body!==original.text?['正文仅转换为完整纯文本，保留链接和图片引用；未缩写或截断']:['标题及正文完整保留，未自动改写'],rules:{source:config?'browser-extension/platforms.js':'no_confirmed_channel_limits',label:ruleSource,evidenceUpdatedAt:platform?.evidenceUpdatedAt||null,titleMax:config?.titleMax??null,textMax:config?.textMax??null,imagesMax:config?.images||null,formatVersion:formatted.version},checks,summary:{needsInput:checks.filter(c=>c.status==='needs_input').length,needsConfirmation:checks.filter(c=>c.status==='needs_confirmation').length},requiresContentReview:true,modelCalls:0,networkRequests:0,published:false};
}
function fenced(text){const longest=(String(text).match(/`+/g)||[]).reduce((max,s)=>Math.max(max,s.length),2),fence='`'.repeat(longest+1);return fence+'text\n'+text+'\n'+fence}
export function platformAdaptationMarkdown(preview){
 if(preview?.schema!==PLATFORM_ADAPTATION_VERSION)throw Error('适配预览无效，请重新生成');
 const p=preview;
 return '# '+p.platform.name+' · 适配材料\n\n仅本地检查与整理；未修改原稿、未调用模型、未保存到平台、未发布。\n\n## 检查清单\n\n'+p.checks.map(c=>'- '+({ok:'通过',needs_input:'需补充',needs_confirmation:'待确认'})[c.status]+'：'+c.message).join('\n')+'\n\n## 标题（完整保留）\n\n'+fenced(p.derived.title)+'\n\n## 正文（'+(p.platform.category==='image_text'?'完整纯文本':'完整原稿')+'）\n\n'+fenced(p.derived.body)+'\n\n## 摘要候选（摘取完整段落，需确认）\n\n'+fenced(p.derived.summary)+'\n\n## 标签\n\n'+(p.derived.tags.join('、')||'未添加')+'\n\n## 图片清单（图片文件未包含）\n\n'+(p.derived.images.map((m,i)=>`${i+1}. ${m.name}；${m.type||'类型待确认'}；${m.bytes??'大小待确认'} 字节`).join('\n')||'未选择')+'\n\n## 原稿备份\n\n标题：'+p.original.title+'\n\n'+fenced(p.original.text)+'\n\n## 规则说明\n\n'+p.rules.label+'；来源 '+p.rules.source+'。'+(p.rules.evidenceUpdatedAt?'平台能力记录更新于 '+p.rules.evidenceUpdatedAt+'，不等于最新平台规则。':'未取得平台实时规则。')+'\n';
}

export function assertPlatformAdaptationExport(state,article){
 if(contentDisclosureConflict(state,article))throw new Error('稿件含仅内部使用资料，不能生成对外适配材料；请移除或取得公开授权后重新审核。');
 return true;
}
