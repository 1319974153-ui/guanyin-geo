import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/wechat.js',import.meta.url),'utf8');
function fixture(){let scope='one',drawers=[],requests=[],copies=[],browserWrites=0;const handlers={};const ctx=vm.createContext({URLSearchParams,Blob,location:{hostname:'127.0.0.1'},document:{addEventListener:(name,fn)=>handlers[name]=fn},window:{guanyinDesktop:{async copyContent(v){copies.push(v)}}},navigator:{clipboard:{async writeText(){browserWrites++},async write(){browserWrites++}}},esc:v=>String(v??''),toast:()=>{},own:()=>[{id:'c',status:'已审核',title:'正式稿'},{id:'bad',status:'草稿'},{id:'demo',demo:true,status:'已审核'}],brand:()=>({id:'b'}),wordpressBaseScope:()=>scope,openDrawer:(...v)=>drawers.push(v),apiRequest:async (url)=>{requests.push(url);if(String(url).startsWith('/api/local-wechat-handoff/prepare'))return{task:{id:'task',state:'prepared'}};return{package:{title:'正式稿',digest:'摘要',plainText:'完整正文',content:'<p>完整正文</p>'}}}});vm.runInContext(source,ctx);return{ctx,handlers,drawers,requests,copies,get browserWrites(){return browserWrites},scope:v=>scope=v};}
test('current reviewed article opens package directly without a second selection or remote publishing',async()=>{
 const f=fixture();await vm.runInContext("wechatPrepare('c')",f.ctx);assert.equal(f.requests.length,2);assert.match(f.requests[0],/^\/api\/wechat\/package\?/);assert.match(f.requests[0],/contentId=c/);assert.match(f.requests[1],/^\/api\/local-wechat-handoff\/prepare/);assert.match(f.drawers.at(-1)[1],/本人发表后/);
 for(const id of ['bad','demo']){const x=fixture();await vm.runInContext(`wechatPrepare('${id}')`,x.ctx);assert.equal(x.requests.length,0)}
});
test('desktop rich copy is an explicit write with text fallback and workspace changes block it',async()=>{
 const f=fixture();await vm.runInContext("wechatPrepare('c')",f.ctx);const result={textContent:''},button={disabled:false,dataset:{wechatExport:'rich'},parentElement:{parentElement:{querySelector:()=>result}}};
 await f.handlers.click({target:{closest:()=>button}});assert.equal(f.copies.length,1);assert.equal(f.copies[0].text,'完整正文');assert.equal(f.copies[0].html,'<p>完整正文</p>');assert.equal(f.browserWrites,0);assert.match(result.textContent,/已复制/);
 f.scope('other');await f.handlers.click({target:{closest:()=>button}});assert.equal(f.copies.length,1);assert.match(result.textContent,/切换/);
});
