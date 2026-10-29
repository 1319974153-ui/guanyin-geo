import {parse} from 'parse5';
import {fiftyonePublicUrl,fiftyoneMediaProof} from '../browser-extension/platforms.js';
const norm=s=>String(s||'').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value||'';
function text(n){if(['script','style','noscript','button'].includes(n.tagName))return '';if(n.nodeName==='#text')return n.value;const s=(n.childNodes||[]).map(text).join('');return ['p','div','h1','li','br','pre'].includes(n.tagName)?' '+s+' ':s}
export function fiftyonePublicMatches(html,job){
 if(!fiftyonePublicUrl(job)||/您所浏览的文章还在审核中|文章审核未通过/.test(html))return false;
 const titles=[],bodies=[];function walk(n){if(n.tagName==='h1')titles.push(n);if(attr(n,'id')==='container'&&attr(n,'class').split(/\s+/).includes('editor-container'))bodies.push(n);for(const c of n.childNodes||[])walk(c)}walk(parse(html));
 if(titles.length!==1||bodies.length!==1)return false;
 if(norm(text(titles[0]))!==norm(job.snapshot.title)||norm(text(bodies[0]))!==norm(job.snapshot.text+(job.snapshot.ai?' 本文包含 AI 辅助生成或整理的内容。':'')))return false;
 const imgs=[];function images(n){if(n.tagName==='img')imgs.push(attr(n,'src'));for(const c of n.childNodes||[])images(c)}images(bodies[0]);
 const proof=fiftyoneMediaProof(job.mediaProof||[],job.media||[]);if(!proof||imgs.length!==proof.length)return false;
 return imgs.every((src,i)=>{try{const u=new URL(src);return u.protocol==='https:'&&u.origin+u.pathname===proof[i].url}catch{return false}});
}
