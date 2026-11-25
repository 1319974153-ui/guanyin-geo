import {kimiConversationUrl} from '../src/kimi-conversation.js';

// Legacy rows may have no checkpoint even after the browser sent a question.
const kimiNotSent=JSON.stringify({stage:'not_sent'});

// Each platform owns one durable receipt. Reading a receipt never sends a question.
export function liveSearchStore(db,collect){
 db.exec(`CREATE TABLE IF NOT EXISTS consumer_searches (
  owner TEXT,brand TEXT,run TEXT,platform TEXT,question TEXT,version TEXT,
  phase TEXT,message TEXT,result TEXT,answer TEXT,checkpoint TEXT,PRIMARY KEY(owner,brand,run,platform))`);
 if(!db.prepare('PRAGMA table_info(consumer_searches)').all().some(column=>column.name==='checkpoint')){
  db.exec('ALTER TABLE consumer_searches ADD COLUMN checkpoint TEXT');
 }
 db.prepare("UPDATE consumer_searches SET phase='unconfirmed',message='旧版未记录 Kimi 发送结果，请先核对原对话',checkpoint='{}' WHERE platform='Kimi' AND phase IN ('running','failed','interrupted') AND checkpoint IS NULL AND result IS NULL").run();
 db.prepare("UPDATE consumer_searches SET phase='interrupted',message='上次尚未发送问题，可以继续查询' WHERE phase='running' AND platform='Kimi' AND checkpoint=?").run(kimiNotSent);
 db.prepare("UPDATE consumer_searches SET phase='readback',message='服务已重启，可继续读取 Kimi 原对话' WHERE phase='running' AND platform='Kimi' AND json_extract(checkpoint,'$.sourceUrl') IS NOT NULL").run();
 db.prepare("UPDATE consumer_searches SET phase='unconfirmed',message='服务已中断，Kimi 发送结果待核对' WHERE phase='running' AND platform='Kimi'").run();
 db.prepare("UPDATE consumer_searches SET phase='interrupted',message='服务已重启，可单独重新查询此平台' WHERE phase='running'").run();
 db.prepare("UPDATE consumer_searches SET phase='saving_failed',message='原文已保留，可恢复保存' WHERE phase='saving'").run();
 const select=db.prepare('SELECT * FROM consumer_searches WHERE owner=? AND brand=? AND run=? AND platform=?');
 const update=db.prepare('UPDATE consumer_searches SET phase=?,message=?,result=?,answer=? WHERE owner=? AND brand=? AND run=? AND platform=?');
 const updateCheckpoint=db.prepare('UPDATE consumer_searches SET checkpoint=? WHERE owner=? AND brand=? AND run=? AND platform=?');
 const pending=new Set();
 function rows(owner,brand,run){
  return db.prepare("SELECT platform,phase,message,answer,COALESCE(json_extract(checkpoint,'$.sourceUrl'),CASE WHEN phase='declined' THEN json_extract(result,'$.sourceUrl') END) AS sourceUrl FROM consumer_searches WHERE owner=? AND brand=? AND run=? ORDER BY rowid").all(owner,brand,run);
 }
 async function runOne(key,input,save){
  const token=JSON.stringify(key);
  if(pending.has(token))return;
  pending.add(token);
  const prior=select.get(...key);
  let result=prior?.result,checkpoint=prior?.checkpoint===kimiNotSent?null:prior?.checkpoint&&JSON.parse(prior.checkpoint);
  try{
   if(!result){
    const captured=await collect({...input,checkpoint},message=>update.run('running',message,null,null,...key),event=>{
     if(key[3]!=='Kimi'||!['sending','confirmed'].includes(event?.stage))throw Error('无效的查询状态');
     if(event.stage==='sending'&&checkpoint)throw Error('Kimi 题目可能已经发出，请先核对原对话');
     const sourceUrl=event.stage==='confirmed'&&kimiConversationUrl(event.sourceUrl);
     if(event.stage==='confirmed'&&(!checkpoint||!sourceUrl||checkpoint.sourceUrl&&checkpoint.sourceUrl!==sourceUrl))throw Error('Kimi 原对话链接不匹配');
     const next=sourceUrl?{sourceUrl}:{};
     updateCheckpoint.run(JSON.stringify(next),...key);
     checkpoint=next;
    });
    if(checkpoint&&(!checkpoint.sourceUrl||captured.sourceUrl!==checkpoint.sourceUrl))throw Error('Kimi 回答尚未和本次原对话核对成功');
    result=JSON.stringify(captured);
    update.run('saving','正在保存原文与引用',result,null,...key);
   }
   const captured=JSON.parse(result);
   if(captured.outcome==='declined'){
    update.run('declined','平台回复：'+captured.text,result,null,...key);
    return;
   }
   const id=await save(captured,key[3]);
   update.run('complete','已保存原回答',null,id,...key);
  }catch(error){
   const failedPhase=checkpoint?(checkpoint.sourceUrl?'readback':'unconfirmed'):'failed';
   update.run(result?'saving_failed':failedPhase,String(error.message||'查询失败').slice(0,300),result||null,null,...key);
  }finally{pending.delete(token)}
 }
 function start({owner,brand,run,question,platforms,retry},save){
  const existing=rows(owner,brand,run);
  const original=existing.length&&select.get(owner,brand,run,existing[0].platform);
  if(original&&(original.question!==question.id||original.version!==(question.version||'v1')||
   (!retry&&JSON.stringify(existing.map(row=>row.platform).sort())!==JSON.stringify([...platforms].sort()))))throw Error('查询编号已关联其他问题、版本或平台');
  if(retry&&(!existing.length||platforms.some(p=>!existing.some(row=>row.platform===p))))throw Error('未找到需要重试的平台');
  const work=[];
  for(const platform of platforms){
   const key=[owner,brand,run,platform],row=select.get(...key);
   if(platform==='Kimi'&&row?.phase==='declined')continue;
   if(row&&(!retry||!['failed','declined','interrupted','saving_failed','saving','readback','unconfirmed'].includes(row.phase)))continue;
   work.push({key,platform,row});
  }
  if(pending.size+work.length>6)throw Error('已有多项查询正在执行，请稍后再试');
  for(const {key,platform,row} of work){
   if(!row)db.prepare("INSERT INTO consumer_searches (owner,brand,run,platform,question,version,phase,message,checkpoint) VALUES(?,?,?,?,?,?,'running','正在打开平台',?)").run(...key,question.id,question.version||'v1',platform==='Kimi'?kimiNotSent:null);
   else {
    const stored=row.phase==='declined'?null:row.result;
    if(row.phase==='declined')updateCheckpoint.run(null,...key);
    const readback=row.phase==='readback'||row.phase==='unconfirmed';
    update.run(stored?'saving':'running',stored?'正在恢复原回答':readback?'正在核对原对话':'正在打开平台',stored,null,...key);
   }
   void runOne(key,{owner,brand,run,platform,text:question.text},save);
  }
  return rows(owner,brand,run);
 }
 return {rows,start};
}
