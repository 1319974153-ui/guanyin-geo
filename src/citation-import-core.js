import {parseFragment} from 'parse5';
import MarkdownIt from 'markdown-it';

const markdown=new MarkdownIt({html:false,linkify:false,maxNesting:30});
export const MAX_CITATION_CANDIDATES=100;
export function citationUrl(value){
 if(typeof value!=='string'||value.length>2000||!/^[Hh][Tt][Tt][Pp][Ss]?:\/\//.test(value.trim()))throw new Error('引用需为完整 HTTP 或 HTTPS 链接，每条最多 2000 字');
 let u;try{u=new URL(value.trim())}catch{throw new Error('引用需为有效的完整 HTTP 或 HTTPS 链接')};if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('引用链接不能包含账号或密码');return u.href;
}
export function citationRows(value,titles={}){
 const rows=[],seen=new Set();for(const line of String(value||'').split('\n').map(s=>s.trim()).filter(Boolean)){const url=citationUrl(line);if(seen.has(url))continue;seen.add(url);rows.push({url,title:String(titles[url]||'').slice(0,300)});}
 if(rows.length>MAX_CITATION_CANDIDATES)throw new Error('引用清单最多 100 条，请减少后再保存');return rows;
}
function plainUrl(value){
 let s=value.replace(/[.,;:!?，。；：！？、]+$/u,'');
 for(const [left,right] of [['(',')'],['[',']'],['{','}']])while(s.endsWith(right)&&s.split(right).length>s.split(left).length)s=s.slice(0,-1);
 return s;
}
// Parse copied content as inert text. Never resolve relative paths or fetch a destination.
export function extractCitationCandidates({text='',html=''}={}){
 if(typeof text!=='string'||typeof html!=='string'||text.length>100000||html.length>500000)throw new Error('粘贴内容过长，请只复制回答或来源列表（文字最多 10 万字）');
 const candidates=[],seen=new Set();let ignored=0;
 const add=(href,title,origin)=>{let url;try{url=citationUrl(href)}catch{ignored++;return}if(seen.has(url))return;if(candidates.length>=MAX_CITATION_CANDIDATES)throw new Error('检测到超过 100 条链接，请缩小复制范围；本次未采用部分清单');seen.add(url);candidates.push({url,title:String(title||'').replace(/\s+/g,' ').trim().slice(0,300),origin});};
 if(html){
  const root=parseFragment(html),stack=[root];let nodes=0;
  while(stack.length){const node=stack.pop();if(++nodes>20000)throw new Error('粘贴内容结构过大，请只复制回答或来源列表');
   const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value]));
   if(['script','style','template','noscript'].includes(node.tagName)||'hidden' in attrs||attrs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style||''))continue;
   if(node.tagName==='a'&&attrs.href){const parts=[],children=[...(node.childNodes||[])].reverse();while(children.length){const c=children.pop();if(c.nodeName==='#text')parts.push(c.value);else if(!['script','style','template'].includes(c.tagName))children.push(...(c.childNodes||[]).slice().reverse());}add(attrs.href,parts.join(' ')||attrs.title,'复制的链接');}
   stack.push(...(node.childNodes||[]).slice().reverse());
  }
 }
 if(!candidates.length&&text){
  for(const block of markdown.parse(text,{})){if(block.type!=='inline')continue;const tokens=block.children||[];let linked=false;
   for(let i=0;i<tokens.length;i++){const token=tokens[i];if(token.type==='link_open'){linked=true;const title=[];for(let j=i+1;j<tokens.length&&tokens[j].type!=='link_close';j++)if(['text','code_inline'].includes(tokens[j].type))title.push(tokens[j].content);add(token.attrGet('href'),title.join(''),'Markdown 链接');}
    else if(token.type==='link_close')linked=false;
    else if(token.type==='text'&&!linked)for(const match of token.content.matchAll(/https?:\/\/[^\s<>"'`，。；！？、]+/gi))add(plainUrl(match[0]),'','正文 URL');
   }
  }
 }
 return {candidates,ignored};
}
export function mergeCitationCandidates(value,selected,titles={}){
 const rows=citationRows(value,titles),seen=new Set(rows.map(r=>r.url));
 for(const c of selected){const url=citationUrl(c.url);if(seen.has(url))continue;seen.add(url);rows.push({url,title:String(c.title||'').slice(0,300)});}
 if(rows.length>MAX_CITATION_CANDIDATES)throw new Error('合并后超过 100 条引用，请减少选择；原清单未改变');return rows;
}
