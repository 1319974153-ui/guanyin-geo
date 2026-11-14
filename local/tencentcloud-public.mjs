import {parse} from 'parse5';
import {receiptEvidence} from '../browser-extension/platforms.js';
const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
function text(n){if(['script','style','noscript'].includes(n.tagName))return '';if(n.nodeName==='#text')return n.value;const value=(n.childNodes||[]).map(text).join('');return ['p','div','h1','h2','h3','h4','h5','h6','li','ul','ol','pre','blockquote','br','tr','td'].includes(n.tagName)?' '+value+' ':value}
export function tencentPublicMatches(html,snapshot){
 const titles=[],bodies=[];const walk=n=>{const classes=(n.attrs?.find(a=>a.name==='class')?.value||'').split(/\s+/);if(n.tagName==='h1'&&classes.includes('title-text'))titles.push(n);if(classes.includes('mod-content__markdown'))bodies.push(n);for(const c of n.childNodes||[])walk(c)};walk(parse(html));
 const rendered=[];function findRendered(n){if((n.attrs?.find(a=>a.name==='class')?.value||'').split(/\s+/).includes('cherry-markdown'))rendered.push(n);for(const c of n.childNodes||[])findRendered(c)};if(bodies.length===1)findRendered(bodies[0]);
 const body=rendered.length===1?rendered[0]:bodies[0];
 const expected=text(parse(snapshot.html))+(snapshot.ai?' 本文包含 AI 辅助生成或整理的内容。':'');
 return titles.length===1&&bodies.length===1&&compact(text(titles[0]))===compact(snapshot.title)&&rendered.length<=1&&compact(text(body))===compact(expected);
}
// Fixed platform receipt only; no login, cookies, redirects, model calls or writes.
export async function verifyTencentPublic(job,{fetcher=fetch}={}){
 if(job.platform!=='tencentcloud'||job.mode!=='publish'||!job.attempted||job.state!=='submitted'||!receiptEvidence('tencentcloud',job.receipt?.url,job.receipt?.articleId))return false;
 try{
  const r=await fetcher(job.receipt.url,{redirect:'error',credentials:'omit',headers:{accept:'text/html'},signal:AbortSignal.timeout(12000)});
  if(!r.ok||!/^text\/html\b/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();return false}
  const reader=r.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();return false}chunks.push(value)}
  return tencentPublicMatches(Buffer.concat(chunks).toString('utf8'),job.snapshot);
 }catch{return false}
}
