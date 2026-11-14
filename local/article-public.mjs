import {parse} from 'parse5';
import {receiptEvidence} from '../browser-extension/platforms.js';

// Receipts identify the original submission. Never search by title or guess a new article.
export function articlePublicUrl(job){
 if(!['csdn','zhihu'].includes(job.platform)||job.mode!=='publish'||!job.attempted||!['submitted','published'].includes(job.state)||!receiptEvidence(job.platform,job.receipt?.url,job.receipt?.articleId))return null;
 const url=new URL(job.receipt.url);
 if(url.search||url.hash||url.username||url.password)return null;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(job.accountId||''))return null;
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
 const doc=parse(html),source=parse(job.snapshot.html),zhihu=job.platform==='zhihu';
 const titles=nodes(doc,n=>n.tagName==='h1'&&(zhihu?hasClass(n,'Post-Title'):attr(n,'id')==='articleContentId'));
 const bodies=nodes(doc,n=>zhihu?hasClass(n,'Post-RichText'):attr(n,'id')==='content_views');
 if(titles.length!==1||bodies.length!==1)return false;
 const media=n=>['img','video','audio','iframe','object','embed','svg','canvas'].includes(n.tagName);
 if(nodes(source,media).length||nodes(bodies[0],n=>media(n)&&!(zhihu&&zhihuEntityIcon(n))).length)return false;
 if(zhihu){
  const authors=nodes(doc,n=>hasClass(n,'AuthorInfo-name')).flatMap(n=>nodes(n,a=>a.tagName==='a'&&hasClass(a,'UserLink-link')));
  if(authors.length!==1)return false;
  try{const u=new URL(attr(authors[0],'href'),'https://www.zhihu.com');if(u.origin!=='https://www.zhihu.com'||u.pathname!==`/people/${job.accountId}`||u.search||u.hash)return false}catch{return false}
 }
 const expected=compact(text(source));
 return !!expected&&compact(text(titles[0]))===compact(job.snapshot.title)&&compact(text(bodies[0]))===expected;
}

// Runs inside the product's anonymous, sandboxed window, never the signed-in editor.
export function articlePublicExtraction(platform){
 // Scope to the article: the sidebar repeats AuthorInfo-name on the real page.
 const selectors=platform==='zhihu'?['article.Post-Main h1.Post-Title','article.Post-Main .Post-RichText','article.Post-Main .AuthorInfo-head .AuthorInfo-name']:['h1#articleContentId','#content_views',null];
 return `(()=>{const s=${JSON.stringify(selectors)},t=document.querySelectorAll(s[0]),b=document.querySelectorAll(s[1]),a=s[2]?document.querySelectorAll(s[2]):[];return t.length===1&&b.length===1&&(!s[2]||a.length===1)?t[0].outerHTML+b[0].outerHTML+(a[0]?.outerHTML||''):''})()`;
}
