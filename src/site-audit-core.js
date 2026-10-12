import {parse} from 'parse5';
import robotsParser from 'robots-parser';
import {SaxesParser} from 'saxes';
import {inspectStructuredData} from './schema-core.js';
export const AUDIT_AGENT='GuanyinGEO';
export const AUDIT_REFERENCES={html:'https://parse5.js.org/',robots:'https://www.rfc-editor.org/rfc/rfc9309.html',sitemap:'https://www.sitemaps.org/protocol.html'};
export function crawlUrl(value,base){try{const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048)return '';u.hash='';return u.href;}catch{return '';}}
const uniq=a=>[...new Set(a)];
export function robotsPolicy(text,url,agent=AUDIT_AGENT){const r=robotsParser(new URL('/robots.txt',url).href,text),line=r.getMatchingLineNumber(url,agent);return {agent,allowed:r.isAllowed(url,agent)===true,line:line>0?line:null,rule:line>0?(text.split(/\r?\n/)[line-1]||'').slice(0,2000):'',delay:r.getCrawlDelay(agent)||0};}
export function robotSitemaps(text,url){return robotsParser(new URL('/robots.txt',url).href,text).getSitemaps();}
export function readSitemap(xml){
 if(/<!DOCTYPE/i.test(xml))throw new Error('站点地图含 DOCTYPE，未解析实体或访问外部资源');
 const stack=[],urls=[],errors=[];let root='',namespace='',current='',total=0,valid=0;const p=new SaxesParser({xmlns:true});
 p.on('error',()=>errors.push('XML 格式错误'));
 p.on('opentag',tag=>{stack.push(tag);if(stack.length===1){root=tag.local;namespace=tag.uri;}if(stack.length===3&&tag.local==='loc'&&['url','sitemap'].includes(stack[1].local))current='';});
 p.on('text',v=>{if(stack.length===3&&stack[2].local==='loc')current+=v;});p.on('cdata',v=>{if(stack.length===3&&stack[2].local==='loc')current+=v;});
 p.on('closetag',tag=>{if(stack.length===3&&tag.local==='loc'&&tag.uri===namespace&&stack[1].uri===namespace&&['url','sitemap'].includes(stack[1].local)){total++;const url=crawlUrl(current.trim());if(url){valid++;if(urls.length<200)urls.push(url);}}stack.pop();});
 try{p.write(xml).close();}catch{errors.push('XML 未能完整解析');}
 if(errors.length||!['urlset','sitemapindex'].includes(root)||namespace!=='http://www.sitemaps.org/schemas/sitemap/0.9')throw new Error('不是受支持的完整 Sitemap XML，请检查根元素、命名空间和格式');
 return {kind:root==='sitemapindex'?'index':'urls',urls:uniq(urls),total,invalid:total-valid,truncated:total>200};
}
export function inspectAuditHtml(html,url,headers={}){
 const tree=parse(html),elements=[],text=[];const walk=[{n:tree,skip:false}];
 while(walk.length){const {n,skip}=walk.pop(),ignore=skip||['script','style','head','template','noscript'].includes(n.tagName);if(n.tagName)elements.push(n);if(n.nodeName==='#text'&&!ignore)text.push(n.value);for(const c of [...(n.childNodes||[])].reverse())walk.push({n:c,skip:ignore});}
 const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value||'',contents=n=>{const todo=[n],parts=[];while(todo.length){const x=todo.pop();if(x.nodeName==='#text')parts.push(x.value);for(const c of [...(x.childNodes||[])].reverse())todo.push(c);}return parts.join(' ').replace(/\s+/g,' ').trim();};
 const title=elements.filter(n=>n.tagName==='title').map(contents),h1=elements.filter(n=>n.tagName==='h1').map(contents),descriptions=elements.filter(n=>n.tagName==='meta'&&attr(n,'name').toLowerCase()==='description').map(n=>attr(n,'content'));
 const baseNode=elements.find(n=>n.tagName==='base'&&attr(n,'href')),base=(baseNode&&crawlUrl(attr(baseNode,'href'),url))||url;
 const canonicals=elements.filter(n=>n.tagName==='link'&&attr(n,'rel').toLowerCase().split(/\s+/).includes('canonical')).map(n=>({value:attr(n,'href'),url:crawlUrl(attr(n,'href'),base)}));
 const directives=elements.filter(n=>n.tagName==='meta'&&['robots','googlebot','bingbot',AUDIT_AGENT.toLowerCase()].includes(attr(n,'name').toLowerCase())).map(n=>({source:'meta',agent:attr(n,'name').toLowerCase(),value:attr(n,'content').slice(0,2000)}));
 if(headers.xRobotsTag){let agent='robots';for(const part of headers.xRobotsTag.slice(0,2000).split(',')){const match=part.trim().match(/^([a-z][a-z0-9_-]*):\s*(.*)$/i);let value=part.trim();if(match&&!['unavailable_after','max-snippet','max-image-preview','max-video-preview'].includes(match[1].toLowerCase())){agent=match[1].toLowerCase();value=match[2];}directives.push({source:'http',agent,value});}}
 const anchors=elements.filter(n=>n.tagName==='a'&&attr(n,'href')),links=[];let external=0,omitted=0;
 for(const a of anchors){const link=crawlUrl(attr(a,'href'),base);if(!link){omitted++;continue;}if(new URL(link).origin!==new URL(url).origin){external++;continue;}if(attr(a,'rel').toLowerCase().split(/\s+/).includes('nofollow')||/\/(logout|signout|delete|remove|unsubscribe)([/?]|$)/i.test(link)||/\.(jpg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|woff2?)(\?|$)/i.test(link)){omitted++;continue;}if(!links.includes(link)&&links.length<200)links.push(link);}
 const body=text.join(' ').replace(/\s+/g,' ').trim(),structured=inspectStructuredData(html),issues=[];
 const add=(code,detail,severity='warning')=>issues.push({code,detail,severity});
 if(!title[0])add('missing_title','未发现有效页面标题');if(title.length>1)add('multiple_title','发现多个 title 元素');if(!h1.length)add('missing_h1','未发现 H1 主标题');if(h1.length>1)add('multiple_h1','发现多个 H1，请核对标题层次','note');if(!descriptions[0])add('missing_description','未发现页面描述');if(body.length<80)add('limited_static_text','静态正文不足 80 字，可能需要浏览器渲染或登录，不能据此判断内容缺失');
 if(canonicals.length>1)add('multiple_canonical','发现多个 canonical，请核对规范链接');if(canonicals.some(c=>!c.url))add('invalid_canonical','规范链接不是有效 HTTP/HTTPS URL');if(canonicals.some(c=>c.url&&c.url!==crawlUrl(url)))add('canonical_other','规范链接指向其他地址；需结合重复页面或迁移策略核对','note');
 for(const d of directives)if(/(?:^|[\s,:])(noindex|none)(?:[\s,]|$)/i.test(d.value))add('noindex','存在禁止索引指令（'+d.agent+'）：'+d.value);
 if(!structured.count)add('missing_schema','未发现 JSON-LD；是否需要标记应结合页面用途','note');else if(!structured.valid)add('invalid_schema','已发现 JSON-LD，但基础结构检查未通过');
 const nofollow=directives.some(d=>['robots',AUDIT_AGENT.toLowerCase()].includes(d.agent)&&/(?:^|[\s,])(nofollow|none)(?:[\s,]|$)/i.test(d.value));
 return {title:title[0]?.slice(0,500)||'',h1:h1.slice(0,10).map(x=>x.slice(0,500)),description:descriptions[0]?.slice(0,1000)||'',lang:attr(elements.find(n=>n.tagName==='html')||{},'lang'),bodyChars:body.length,excerpt:body.slice(0,1000),canonicals:canonicals.slice(0,10),directives:directives.slice(0,20),structured:{valid:structured.valid,count:structured.count,types:structured.types,errors:structured.scripts.flatMap(s=>s.errors).slice(0,20)},issues,links:nofollow?[]:links,linkCounts:{internal:links.length,external,omitted,observed:anchors.length,limited:anchors.length>200},nofollow};
}
export function auditSummary(job){
 const pages=job.nodes.filter(n=>n.kind==='page'),done=pages.filter(n=>n.state!=='queued'),successful=done.filter(n=>n.page),map=new Map();for(const n of successful){const key=n.page.title.toLowerCase().trim();if(key){if(!map.has(key))map.set(key,[]);map.get(key).push(n.url);}}
 return {discovered:pages.length,checked:done.length,pages:successful.length,failed:done.filter(n=>n.state==='failed').length,blocked:done.filter(n=>n.state==='blocked').length,issues:successful.reduce((x,n)=>x+n.page.issues.length,0),duplicateTitles:[...map].filter(([,urls])=>urls.length>1).map(([title,urls])=>({title,urls})),remaining:pages.filter(n=>n.state==='queued').length,limited:!!job.discoveryLimited||pages.length>job.limit};
}
