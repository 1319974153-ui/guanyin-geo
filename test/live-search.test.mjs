import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {liveSearchStore} from '../local/live-search.mjs';
import {makeReport} from '../src/analytics-core.js';
import {queryResults} from '../src/studio-core.js';
import {collectConsumer} from '../desktop/consumer-search.mjs';

const kimiHome='https://www.kimi.com/';
const kimiThread=kimiHome+'chat/12345678-1234-1234-1234-123456789012';
const otherKimiThread=kimiHome+'chat/12345678-1234-1234-1234-123456789013';
const frameKimiThread=kimiHome+'chat/12345678-1234-1234-1234-123456789014';
const kimiCitations=[{url:'https://example.org/source',title:'来源'}];
const kimiJob={owner:'test',brand:'test',platform:'Kimi',text:'新的验收问题',run:'run-for-kimi'};
function kimiBrowser({read,submit}){
 const windows=[],loads=[],nativeEvents=[];
 class TestWindow extends EventEmitter{
  url='';
  inputText='';
  destroyed=false;
  webContents=Object.assign(new EventEmitter(),{
   setWindowOpenHandler(){},focus(){},getURL:()=>this.url,
   mainFrame:{executeJavaScript:async()=>read(this)},
   insertText:async text=>{this.inputText=text},
   sendInputEvent:event=>{
    nativeEvents.push(event);
    if(event.type==='mouseUp')submit(this);
   }
  });
  constructor(){super();windows.push(this)}
  async loadURL(url){loads.push(url);this.navigate(url);this.webContents.emit('dom-ready')}
  navigate(url){this.url=url;this.webContents.emit('did-navigate-in-page',{},url,true,100,200)}
  show(){}
  focus(){}
  isDestroyed(){return this.destroyed}
  destroy(){this.destroyed=true;this.emit('closed')}
 }
 const session={fromPartition:()=>({setPermissionRequestHandler(){},flushStorageData(){},cookies:{async flushStore(){}}})};
 return {BrowserWindow:TestWindow,session,windows,loads,nativeEvents};
}
const kimiEditor=window=>({ready:!window.inputText,focused:true,inputText:window.inputText,kimiThreads:[otherKimiThread],...(window.inputText?{kimiSend:{x:85,y:32}}:{})});
const kimiAnswer=(url,text='完整回答')=>({observedUrl:url,matched:true,history:true,finished:true,text,citations:kimiCitations});

test('Kimi waits for durable acknowledgement, clicks once and then saves the finished exact conversation',async()=>{
 const checkpoints=[],notices=[];
 let fetched=0;
 const browser=kimiBrowser({
  read:window=>window.url===kimiHome?kimiEditor(window):{...kimiAnswer(window.url),finished:++fetched>1},
  submit:window=>{assert.deepEqual(checkpoints,[{stage:'sending'}]);window.navigate(kimiThread)}
 });
 const result=await collectConsumer(browser,kimiJob,message=>notices.push(message),async value=>checkpoints.push(value));
 assert.deepEqual(browser.nativeEvents.map(event=>event.type),['mouseDown','mouseUp']);
 assert.deepEqual(checkpoints,[{stage:'sending'},{stage:'confirmed',sourceUrl:kimiThread}]);
 assert.match(notices.at(-1),/已收到本题/);
 assert.equal(result.sourceUrl,kimiThread);
 assert.equal(result.text,'完整回答');
 assert.deepEqual(result.citations,kimiCitations);
 assert.ok(browser.windows.every(window=>window.destroyed));
});

test('Kimi reads the observed new conversation even when the first window instantly returns home',async()=>{
 const checkpoints=[];
 const browser=kimiBrowser({
  read:window=>window.url===kimiHome?kimiEditor(window):kimiAnswer(window.url),
  submit:window=>{
   window.webContents.emit('did-navigate-in-page',{},frameKimiThread,false,100,201);
   window.navigate(kimiThread);window.navigate(kimiHome);
  }
 });
 const result=await collectConsumer(browser,kimiJob,()=>{},async value=>checkpoints.push(value));
 assert.deepEqual(browser.loads,[kimiHome,kimiThread]);
 assert.deepEqual(browser.nativeEvents.map(event=>event.type),['mouseDown','mouseUp']);
 assert.deepEqual(checkpoints,[{stage:'sending'},{stage:'confirmed',sourceUrl:kimiThread}]);
 assert.equal(result.sourceUrl,kimiThread);
});

test('Kimi does not click when the initial checkpoint is rejected',async()=>{
 const browser=kimiBrowser({read:kimiEditor,submit:()=>assert.fail('unexpected submission')});
 await assert.rejects(collectConsumer(browser,kimiJob,()=>{},async()=>{throw Error('查询状态未保存')}),/查询状态未保存/);
 assert.deepEqual(browser.nativeEvents,[]);
});

test('Kimi stops on a membership prompt and does not send again when re-reading a known conversation',async()=>{
 const browser=kimiBrowser({
  read:()=>({membershipRequired:true,blocked:true}),
  submit:()=>assert.fail('unexpected submission')
 });
 await assert.rejects(collectConsumer({...browser,retainLoginWindow:false},{...kimiJob,checkpoint:{sourceUrl:kimiThread}},()=>{},async()=>assert.fail('unexpected checkpoint')),/会员权限/);
 assert.deepEqual(browser.loads,[kimiThread]);
 assert.deepEqual(browser.nativeEvents,[]);
});

test('Kimi resumes a confirmed conversation directly and never sends a second question',async()=>{
 const browser=kimiBrowser({read:window=>kimiAnswer(window.url),submit:()=>assert.fail('unexpected submission')});
 const result=await collectConsumer(browser,{...kimiJob,checkpoint:{sourceUrl:kimiThread}},()=>{},async()=>assert.fail('unexpected checkpoint'));
 assert.deepEqual(browser.loads,[kimiThread]);
 assert.deepEqual(browser.nativeEvents,[]);
 assert.equal(result.sourceUrl,kimiThread);
});

test('new question, independent consumer results, source evidence and retry persist through normal API routes',async()=>{
 const db=new DatabaseSync(':memory:'),calls=[];
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 let fail=true;
 const env={DB:d1Adapter(db),LOCAL_CONSUMER_SEARCH:liveSearchStore(db,async(job,progress)=>{
  calls.push(job.platform);progress('等待平台回答');
  if(job.platform==='腾讯元宝'&&fail)throw Error('测试登录未完成');
  return {text:'引用原文',sourceUrl:'https://example.org/chat/123',citations:[{url:'https://example.org/p',title:'证据'}],collectedAt:new Date().toISOString()};
 })};
 const call=async(path,body)=>{
  const response=await worker.fetch(new Request('https://geo.test'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1'},body:body?JSON.stringify(body):undefined}),env);
  return {code:response.status,...await response.json()};
 };
 const initial=await call('/api/state');
 initial.state.brands=[{id:'b1',name:'查询测试',site:'https://example.org',productLines:[]}];
 const put=await worker.fetch(new Request('https://geo.test/api/state',{method:'PUT',headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1'},body:JSON.stringify(initial)}),env);
 assert.equal(put.status,200);
 const text='如何挑选合适的资料整理服务？';
 const questions=await call('/api/questions/import',{brandId:'b1',questions:[text]});
 const runId=crypto.randomUUID(),questionId=questions.added[0];
 const input={brandId:'b1',questionId,runId,text,version:'v1',platforms:['豆包','腾讯元宝','Kimi']};
 assert.equal((await call('/api/live-search',input)).code,200);
 async function finished(){
  for(let i=0;i<100;i++){
   const {rows}=await call('/api/live-search?brandId=b1&runId='+runId);
   if(rows.length===3&&rows.every(r=>!['running','saving'].includes(r.phase)))return rows;
   await wait(5);
  }
  assert.fail('结果未就绪');
 }
 assert.deepEqual((await finished()).map(r=>r.phase),['complete','failed','complete']);
 await call('/api/live-search',input);
 assert.equal(calls.length,3);
 assert.deepEqual(new Set(calls),new Set(input.platforms));
 fail=false;await call('/api/live-search',{...input,platforms:['腾讯元宝'],retry:true});
 assert.deepEqual((await finished()).map(r=>r.phase),['complete','complete','complete']);
 assert.equal(calls.length,4);
 assert.equal(calls.at(-1),'腾讯元宝');
 const {state}=await call('/api/state'),report=makeReport(state,'b1',{surface:'import',period:'all'});
 const view=queryResults(report,state.questions,{answerId:state.answers[0].id});
 assert.equal(view.platforms.length,3);
 assert.equal(state.answers.find(answer=>answer.platform==='Kimi').citations[0].title,'证据');assert.equal(view.selected.answer.text,'引用原文');
 assert.equal(view.selected.answer.recommendationLabeled,false);assert.equal(view.selected.citations[0].title,'证据');
 assert.equal((await call('/api/live-search',{...input,brandId:'other'})).code,409);
 assert.equal((await call('/api/live-search',{...input,text:'旧版本'})).code,409);
 assert.equal((await call('/api/live-search',{...input,platforms:['任意网站']})).code,400);
 db.close();
});

test('restoring a captured response after a save failure does not ask the platform twice',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;
 const store=liveSearchStore(db,async()=>{calls++;return {text:'已取得的原文'}});
 const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['豆包']};
 store.start(input,async()=>{throw Error('保存失败')});await wait(0);
 assert.equal(store.rows('o','b','r')[0].phase,'saving_failed');
 store.start({...input,retry:true},async answer=>{assert.equal(answer.text,'已取得的原文');return 'saved'});await wait(0);
 assert.equal(store.rows('o','b','r')[0].answer,'saved');assert.equal(calls,1);
 db.close();
});

test('Kimi checkpoints survive a service restart, recover the original URL and save once',async()=>{
 const db=new DatabaseSync(':memory:');
 const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['Kimi']};
 let store=liveSearchStore(db,async(_job,_progress,checkpoint)=>{
  checkpoint({stage:'sending'});
  checkpoint({stage:'confirmed',sourceUrl:kimiThread+'?from=test'});
  throw Error('查询窗口短暂回到首页');
 });
 store.start(input,async()=>assert.fail('unfinished text saved'));await wait(0);
 assert.equal(store.rows('o','b','r')[0].phase,'readback');
 db.exec("UPDATE consumer_searches SET phase='running'");
 let saved=0,read=0;
 store=liveSearchStore(db,async(job,progress)=>{
  assert.deepEqual(job.checkpoint,{sourceUrl:kimiThread});
  assert.equal(job.run,input.run);
  read++;progress('正在读取原对话');
  return {text:'回读的原文',sourceUrl:kimiThread,citations:kimiCitations};
 });
 assert.equal(store.rows('o','b','r')[0].phase,'readback');
 assert.equal(store.rows('o','b','r')[0].sourceUrl,kimiThread);
 const save=async answer=>{saved++;assert.deepEqual(answer.citations,kimiCitations);return 'saved'};
 store.start({...input,retry:true},save);
 store.start({...input,retry:true},save);
 await wait(0);
 assert.equal(store.rows('o','b','r')[0].phase,'complete');
 assert.equal(read,1);assert.equal(saved,1);
 db.close();
});

test('an uncertain Kimi send cannot be retried as a fresh send under the same run',async()=>{
 const db=new DatabaseSync(':memory:');
 let first=true;
 const store=liveSearchStore(db,async(job,_progress,checkpoint)=>{
  if(first){first=false;checkpoint({stage:'sending'});throw Error('发送后窗口关闭')}
  assert.deepEqual(job.checkpoint,{});
  checkpoint({stage:'sending'});
  assert.fail('duplicate send was accepted');
 });
 const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['Kimi']};
 const save=async()=>assert.fail('unknown response was saved');
 store.start(input,save);await wait(0);
 assert.equal(store.rows('o','b','r')[0].phase,'unconfirmed');
 store.start({...input,retry:true},save);await wait(0);
 assert.match(store.rows('o','b','r')[0].message,/可能已经发出/);
 db.close();
});

test('the Kimi store rejects foreign conversation links and refuses to save an answer from another thread',async()=>{
 const db=new DatabaseSync(':memory:');
 const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['Kimi']};
 const store=liveSearchStore(db,async(_job,_progress,checkpoint)=>{
  checkpoint({stage:'sending'});
  assert.throws(()=>checkpoint({stage:'confirmed',sourceUrl:kimiThread.replace('www.kimi.com','else.example')}),/不匹配/);
  checkpoint({stage:'confirmed',sourceUrl:kimiThread});
  return {text:'另一条回答',sourceUrl:otherKimiThread};
 });
 store.start(input,async()=>assert.fail('foreign response saved'));await wait(0);
 const row=store.rows('o','b','r')[0];
 assert.equal(row.phase,'readback');
 assert.equal(row.answer,null);
 assert.equal(row.sourceUrl,kimiThread);
 db.close();
});

test('a visible platform refusal keeps its original link and is excluded from answer metrics',async()=>{
 const db=new DatabaseSync(':memory:');let asks=0,saves=0;
 const store=liveSearchStore(db,async()=>++asks===1
  ?{outcome:'declined',text:'无法回答这个问题',sourceUrl:'https://www.qianwen.com/chat/example'}
  :{outcome:'answer',text:'第二次完整回答'});
 const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['通义千问']};
 const save=async()=>{saves++;return 'saved'};
 store.start(input,save);await wait(0);
 const first=store.rows('o','b','r')[0];
 assert.equal(first.phase,'declined');assert.equal(first.sourceUrl,'https://www.qianwen.com/chat/example');assert.equal(first.answer,null);assert.equal(saves,0);
 store.start({...input,retry:true},save);await wait(0);
 assert.equal(asks,2);assert.equal(store.rows('o','b','r')[0].answer,'saved');
 db.close();
});

import {answerReferenceLinks} from '../src/citation-import-core.js';
test('explicit reference list preserves links in old consumer transcripts without labeling body URLs as citations',()=>{
 const text='示例 https://example.org/\n参考来源\n∙\n中国国家图书馆首页：https://www.nlc.cn/\n∙\n同一网站：https://www.nlc.cn\n总结\nhttps://else.example/';
 assert.deepEqual(answerReferenceLinks(text),[{url:'https://www.nlc.cn/',title:'中国国家图书馆首页'}]);
 assert.deepEqual(answerReferenceLinks('在正文里举例 https://example.org/'),[]);
});

test('元宝重开原工作区复用已有账号目录，不混用其他品牌和用户',async()=>{
 const {consumerPartition}=await import('../desktop/consumer-search.mjs');
 const {createHash}=await import('node:crypto');
 const job={owner:'customer',brand:'brand',platform:'腾讯元宝'};
 const existing='persist:geo-search-'+createHash('sha256').update(JSON.stringify(['customer','brand','腾讯元宝'])).digest('hex');
 assert.equal(consumerPartition(job),existing);
 assert.equal(consumerPartition({...job,text:'另一道问题',run:'new'}),existing);
 for(const change of [{owner:'other'},{brand:'other'},{platform:'DeepSeek'}])assert.notEqual(consumerPartition({...job,...change}),existing);
});
