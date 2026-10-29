import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installQuitFlow} from '../desktop/quit-flow.mjs';
test('cancelled unsaved quit keeps service alive; confirmed close tears down exactly once',async()=>{
 const app=new EventEmitter(),main=new EventEmitter();main.webContents=new EventEmitter();
 let dirty=true,discard=false,dead=false,stops=0,exits=0;
 main.isDestroyed=()=>dead;
 main.close=()=>{if(dirty){let allow=false;main.webContents.emit('will-prevent-unload',{preventDefault(){allow=true}});if(!allow)return;}dead=true;main.emit('closed')};
 app.quit=()=>{let prevent=false;app.emit('before-quit',{preventDefault(){prevent=true}});if(!prevent)exits++};
 installQuitFlow({app,getMain:()=>main,confirmDiscard:()=>discard,shutdown:async()=>{stops++}})(main);
 app.quit();await new Promise(r=>setImmediate(r));assert.equal(dead,false);assert.equal(stops,0);assert.equal(exits,0);
 discard=true;app.quit();app.quit();await new Promise(r=>setImmediate(r));assert.equal(dead,true);assert.equal(stops,1);assert.equal(exits,1);
});
test('clean window close and startup failure both release service without needing renderer confirmation',async()=>{
 for(const hasWindow of [true,false]){
  const app=new EventEmitter(),main=new EventEmitter();main.webContents=new EventEmitter();let dead=false,stops=0,exits=0;
  main.isDestroyed=()=>dead;main.close=()=>{dead=true;main.emit('closed')};
  app.quit=()=>{let prevent=false;app.emit('before-quit',{preventDefault(){prevent=true}});if(!prevent)exits++};
  const bind=installQuitFlow({app,getMain:()=>hasWindow?main:null,confirmDiscard:()=>{throw Error('unexpected')},shutdown:async()=>{stops++}});if(hasWindow)bind(main);
  app.quit();await new Promise(r=>setImmediate(r));assert.equal(stops,1);assert.equal(exits,1);
 }
});
