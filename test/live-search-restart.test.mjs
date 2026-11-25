import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {liveSearchStore} from '../local/live-search.mjs';

const input={owner:'o',brand:'b',run:'r',question:{id:'q',text:'Q'},platforms:['Kimi']};
const sourceUrl='https://www.kimi.com/chat/12345678-1234-1234-1234-123456789012';

test('restart during Kimi login allows the first send, while restart after the send checkpoint only permits readback',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'geo-search-restart-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'search.sqlite');
 let db=new DatabaseSync(file);
 const read=()=>store.rows(input.owner,input.brand,input.run)[0];
 let store=liveSearchStore(db,()=>new Promise(()=>{}));
 store.start(input,()=>assert.fail('unfinished answer saved'));
 assert.equal(read().phase,'running');
 db.close();

 db=new DatabaseSync(file);
 let sends=0;
 store=liveSearchStore(db,(job,_progress,checkpoint)=>{
  assert.equal(job.checkpoint,null);
  checkpoint({stage:'sending'});sends++;
  return new Promise(()=>{});
 });
 assert.equal(read().phase,'interrupted');
 store.start({...input,retry:true},()=>assert.fail('unfinished answer saved'));
 assert.equal(sends,1);
 db.close();

 db=new DatabaseSync(file);
 t.after(()=>db.close());
 store=liveSearchStore(db,async(job,_progress,checkpoint)=>{
  assert.deepEqual(job.checkpoint,{});
  assert.throws(()=>checkpoint({stage:'sending'}),/可能已经发出/);
  checkpoint({stage:'confirmed',sourceUrl});
  return {sourceUrl,text:'原回答'};
 });
 assert.equal(read().phase,'unconfirmed');
 store.start({...input,retry:true},async()=> 'saved');
 await nextTurn();
 assert.equal(read().phase,'complete');
 assert.equal(read().sourceUrl,sourceUrl);
});

test('a legacy interrupted Kimi query with unknown send status never becomes a fresh send',async t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec(`CREATE TABLE consumer_searches (
  owner TEXT,brand TEXT,run TEXT,platform TEXT,question TEXT,version TEXT,
  phase TEXT,message TEXT,result TEXT,answer TEXT,PRIMARY KEY(owner,brand,run,platform));
  INSERT INTO consumer_searches VALUES('o','b','r','Kimi','q','v1','interrupted','旧版中断',NULL,NULL);`);
 const store=liveSearchStore(db,async(job,_progress,checkpoint)=>{
  assert.deepEqual(job.checkpoint,{});
  checkpoint({stage:'sending'});
  assert.fail('duplicate send accepted');
 });
 assert.equal(store.rows('o','b','r')[0].phase,'unconfirmed');
 store.start({...input,retry:true},()=>assert.fail('unexpected save'));
 await nextTurn();
 assert.match(store.rows('o','b','r')[0].message,/可能已经发出/);
});
