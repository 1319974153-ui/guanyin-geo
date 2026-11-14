import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

test('new and legacy workspace responses retain the simple interface after server operations',async()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const env={DB:d1Adapter(db)};
 const get=async()=>{const response=await worker.fetch(new Request('https://geo.test/api/state',{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(response.status,200);return response.json();};
 try{
  const fresh=await get();assert.equal(fresh.state.viewMode,'simple');assert.equal(fresh.state.simpleExperienceVersion,1);
  const legacy=structuredClone(fresh.state);delete legacy.simpleExperienceVersion;legacy.viewMode='operator';legacy.brands=[{id:'original-brand',name:'原有资料'}];
  db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(legacy),'owner');
  const migrated=await get();assert.equal(migrated.state.viewMode,'simple');assert.equal(migrated.state.simpleExperienceVersion,1);assert.deepEqual(migrated.state.brands,legacy.brands);assert.equal(migrated.revision,fresh.revision);
  for(const chosen of ['operator','client']){
   const state={...migrated.state,viewMode:chosen};db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(state),'owner');
   assert.equal((await get()).state.viewMode,chosen,'an explicit later choice must not be reset');
  }
 }finally{db.close();}
});
