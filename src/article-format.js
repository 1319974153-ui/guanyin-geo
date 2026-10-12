import MarkdownIt from 'markdown-it';
export const ARTICLE_FORMAT_VERSION='markdown-it-15.0.2-guanyin-2';
function allowedLink(value){if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return false;if(value.startsWith('#'))return true;try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}}
export function formatArticle(value){
 if(typeof value!=='string'||!value.trim()||value.length>100000)throw new Error('正文须为 1 至 100000 字符');
 const warnings=new Set(),md=new MarkdownIt({html:false,breaks:true,linkify:false,typographer:false,maxNesting:20});
 md.validateLink=url=>{const valid=allowedLink(url);if(!valid)warnings.add('不支持的链接地址保留为原文，未转成可点击链接。');return valid};
 const link=md.renderer.rules.link_open||((tokens,i,options,env,self)=>self.renderToken(tokens,i,options));
 md.renderer.rules.link_open=(tokens,i,options,env,self)=>{tokens[i].attrSet('rel','noopener noreferrer');tokens[i].attrSet('target','_blank');return link(tokens,i,options,env,self)};
 const image=md.renderer.rules.image;
 md.renderer.rules.image=(tokens,i,options,env,self)=>{const token=tokens[i],src=token.attrGet('src')||'';if(!src.startsWith('https://')||!allowedLink(src)){warnings.add('非 HTTPS 或无效图片地址以替代文字显示，未嵌入图片。');return md.utils.escapeHtml('[图片：'+(token.content||'未提供替代文字')+']')}
  // Use attributes accepted by WordPress post KSES for accounts without unfiltered_html.
  token.attrSet('loading','lazy');return image(tokens,i,options,env,self);
 };
 const html=md.render(value.replace(/\r\n?/g,'\n'));if(new TextEncoder().encode(html).byteLength>450000)throw new Error('排版后正文超过 450 KB，请缩短稿件');
 return {html,version:ARTICLE_FORMAT_VERSION,warnings:[...warnings]};
}
