import {parse} from 'parse5';
import {receiptEvidence} from '../browser-extension/platforms.js';

// Receipts identify the original submission. Never search by title or guess a new article.
export function articlePublicUrl(job){
 if(!['csdn','zhihu','aliyun','juejin'].includes(job.platform)||job.mode!=='publish'||!job.attempted||!['submitted','published'].includes(job.state)||!receiptEvidence(job.platform,job.receipt?.url,job.receipt?.articleId))return null;
 const url=new URL(job.receipt.url);
 if(url.search||url.hash||url.username||url.password)return null;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(job.accountId||''))return null;
 if(['aliyun','juejin'].includes(job.platform))return url.href;
 return job.platform==='csdn'?`https://blog.csdn.net/${job.accountId}/article/details/${job.receipt.articleId}`:`https://zhuanlan.zhihu.com/p/${job.receipt.articleId}`;
}
const attr=(n,key)=>n?.attrs?.find(a=>a.name===key)?.value||'';
const hasClass=(n,c)=>attr(n,'class').split(/\s+/).includes(c);
function nodes(root,predicate){const found=[];function walk(n){if(predicate(n))found.push(n);for(const c of n.childNodes||[])walk(c)}walk(root);return found}
function text(n){
 if(['script','style','noscript'].includes(n?.tagName))return '';
 if(n?.nodeName==='#text')return n.value;
 const value=(n?.childNodes||[]).map(text).join('');
 return ['p','div','h1','h2','h3','h4','h5','h6','li','ul','ol','pre','blockquote','br','tr','td'].includes(n?.tagName)?' '+value+' ':value;
}
const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
function zhihuEntityIcon(n){
 if(n.tagName!=='svg'||!hasClass(n,'ZDI--FourPointedStar16')||n.parentNode?.tagName!=='a'||!hasClass(n.parentNode,'RichContent-EntityWord')||compact(text(n)))return false;
 try{const u=new URL(attr(n.parentNode,'href'));return u.origin==='https://zhida.zhihu.com'&&u.pathname==='/search'}catch{return false}
}
// Text-only acceptance for these adapters. Images require separate upload proof;
// do not silently ignore missing images and declare an image article verified.
export function articlePublicMatches(html,job){
 if(!articlePublicUrl(job)||!job.snapshot?.html||!job.snapshot?.title||job.media?.length)return false;
 const doc=parse(html),source=parse(job.snapshot.html),zhihu=job.platform==='zhihu',aliyun=job.platform==='aliyun',juejin=job.platform==='juejin';
 const titles=nodes(doc,n=>n.tagName==='h1'&&(zhihu?hasClass(n,'Post-Title'):(aliyun||juejin)?hasClass(n,'article-title'):attr(n,'id')==='articleContentId'));
 const bodies=nodes(doc,n=>zhihu?hasClass(n,'Post-RichText'):juejin?hasClass(n,'article-viewer')&&hasClass(n,'markdown-body'):aliyun?hasClass(n,'article-inner')&&hasClass(n,'markdown-body'):attr(n,'id')==='content_views');
 if(titles.length!==1||bodies.length!==1)return false;
 const media=n=>['img','video','audio','iframe','object','embed','svg','canvas'].includes(n.tagName);
 if(nodes(source,media).length||nodes(bodies[0],n=>media(n)&&!(zhihu&&zhihuEntityIcon(n))).length)return false;
 if(aliyun){
  const authors=nodes(doc,n=>n.tagName==='a'&&hasClass(n,'aigc-fixed-left-name'));
  if(authors.length!==1)return false;
  try{const u=new URL(attr(authors[0],'href'),'https://developer.aliyun.com');if(u.origin!=='https://developer.aliyun.com'||u.username||u.password||u.pathname!=='/profile/'+job.accountId||u.search||u.hash)return false}catch{return false}
 }
 if(juejin){
  const authors=nodes(doc,n=>n.tagName==='a'&&hasClass(n,'username'));
  if(authors.length!==1||!/^\d+$/.test(job.accountId))return false;
  try{if(new URL(attr(authors[0],'href'),'https://juejin.cn').href!=='https://juejin.cn/user/'+job.accountId+'/posts')return false}catch{return false}
 }
 if(zhihu){
  const authors=nodes(doc,n=>hasClass(n,'AuthorInfo-name')).flatMap(n=>nodes(n,a=>a.tagName==='a'&&hasClass(a,'UserLink-link')));
  if(authors.length!==1)return false;
  try{const u=new URL(attr(authors[0],'href'),'https://www.zhihu.com');if(u.origin!=='https://www.zhihu.com'||u.pathname!==`/people/${job.accountId}`||u.search||u.hash)return false}catch{return false}
 }
 const expected=compact(text(source)+((juejin||aliyun)&&job.snapshot.ai?' 本文包含 AI 辅助生成或整理的内容。':''));
 return !!expected&&compact(text(titles[0]))===compact(job.snapshot.title)&&compact(text(bodies[0]))===expected;
}

// Runs inside the product's anonymous, sandboxed window, never the signed-in editor.
export function articlePublicExtraction(platform){
 // Scope to the article: the sidebar repeats AuthorInfo-name on the real page.
 if(platform==='aliyun')return `(()=>{
  const root=document.querySelector('#article-detail .left-content');if(!root)return '';
  if(/内容审核中，请耐心等待|抱歉[，,]您所发布的内容未能通过审核/.test(root.innerText))return '';
  const selectors=['.content-wrapper h1.article-title','.article-content .article-inner.markdown-body','.aigc-fixed-left a.aigc-fixed-left-name'];
  const elements=selectors.map(s=>root.querySelectorAll(s));return elements.every(e=>e.length===1)?elements.map(e=>e[0].outerHTML).join(''):'';
 })()`;
 if(platform==='juejin')return `(()=>{
  const roots=document.querySelectorAll('article.article');if(roots.length!==1)return '';
  const fields=['h1.article-title','.article-viewer.markdown-body','.author-info-block .author-name a.username[href]'].map(s=>roots[0].querySelectorAll(s));
  return fields.every(nodes=>nodes.length===1)?fields.map(nodes=>nodes[0].outerHTML).join(''):'';
 })()`;
 const selectors=platform==='zhihu'?['article.Post-Main h1.Post-Title','article.Post-Main .Post-RichText','article.Post-Main .AuthorInfo-head .AuthorInfo-name']:['h1#articleContentId','#content_views',null];
 return `(()=>{const s=${JSON.stringify(selectors)},t=document.querySelectorAll(s[0]),b=document.querySelectorAll(s[1]),a=s[2]?document.querySelectorAll(s[2]):[];return t.length===1&&b.length===1&&(!s[2]||a.length===1)?t[0].outerHTML+b[0].outerHTML+(a[0]?.outerHTML||''):''})()`;
}
