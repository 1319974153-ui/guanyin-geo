import test from 'node:test';
import assert from 'node:assert/strict';
import {createDispatchWatcher,dispatchNeedsRefresh} from '../src/dispatch-watch.js';
function fixture(patch={}){
 let clock=0,id=0;const timers=new Map(),events=[];
 const watcher=createDispatchWatcher({refresh:async()=>true,valid:()=>true,pending:()=>true,notify:e=>events.push(e),schedule:(fn,delay)=>{timers.set(++id,{fn,delay});return id},cancel:id=>timers.delete(id),now:()=>clock,...patch});
 return {watcher,timers,events,setTime:value=>clock=value,async next(){const [key,timer]=timers.entries().next().value;timers.delete(key);clock+=timer.delay;await timer.fn();return timer.delay}};
}
test('pending receipts refresh automatically and stop once platform draft is saved',async()=>{
 const journal={one:{state:'queued'}};let reads=0;
 const f=fixture({pending:()=>dispatchNeedsRefresh(journal),refresh:async()=>{if(++reads===2)journal.one.state='draft';return true}});
 f.watcher.start();f.watcher.start();assert.equal(f.timers.size,1);await f.next();assert.equal(reads,1);await f.next();assert.equal(reads,2);assert.equal(f.timers.size,0);assert.equal(f.events.at(-1).state,'complete');
 for(const state of ['draft','prepared','submitted','published','needs_attention','cancelled','not_queued'])assert.equal(dispatchNeedsRefresh({a:{state}}),false);
});
test('hidden/offline pause does not issue reads, wake resumes and scope loss stops',async()=>{
 let paused=true,valid=true,reads=0;const f=fixture({paused:()=>paused,valid:()=>valid,refresh:async()=>{reads++;return true}});
 f.watcher.start();await f.next();assert.equal(reads,0);assert.equal(f.events.at(-1).state,'paused');paused=false;f.watcher.wake();await f.next();assert.equal(reads,1);
 valid=false;await f.next();assert.equal(reads,1);assert.equal(f.watcher.active,false);
});
test('network failure backs off, and success resets delay without executing a write',async()=>{
 let reads=0;const f=fixture({refresh:async()=>++reads>=3});f.watcher.start();await f.next();assert.equal([...f.timers.values()][0].delay,4000);await f.next();assert.equal([...f.timers.values()][0].delay,8000);await f.next();assert.equal([...f.timers.values()][0].delay,2000);f.watcher.stop();assert.equal(f.timers.size,0);
});
test('monitor is bounded and can be deliberately restarted',async()=>{
 const f=fixture({maxDuration:100});f.watcher.start();f.setTime(101);await f.next();assert.equal(f.watcher.active,false);assert.equal(f.events.at(-1).state,'timeout');f.watcher.start();await f.next();assert.equal(f.watcher.active,true);f.watcher.stop();
});
test('wake during an in-flight read never overlaps or revives a stopped watcher',async()=>{
 let release,reads=0;const f=fixture({refresh:()=>{reads++;return new Promise(r=>release=r)}});f.watcher.start();const tick=f.next();f.watcher.wake();assert.equal(reads,1);assert.equal(f.timers.size,0);f.watcher.stop();release(true);await tick;assert.equal(f.timers.size,0);assert.equal(f.watcher.active,false);
});

test('restart during an old read ignores its result and schedules a fresh generation',async()=>{
 let release,reads=0;const f=fixture({refresh:()=>++reads===1?new Promise(r=>release=r):Promise.resolve(true)});
 f.watcher.start();const oldTick=f.next();f.watcher.stop();f.watcher.start();await f.next();
 assert.equal(reads,1);release(false);await oldTick;assert.equal(f.timers.size,1);
 await f.next();assert.equal(reads,2);assert.equal(f.events.at(-1).failures,0);assert.equal(f.events.at(-1).state,'watching');f.watcher.stop();
});

test('an existing attention job can recover automatically without sending again',async()=>{
 const journal={one:{state:'needs_attention',jobId:'original'}};let reads=0;
 const f=fixture({pending:()=>dispatchNeedsRefresh(journal),refresh:async()=>{reads++;journal.one.state='draft';return true}});
 f.watcher.start();await f.next();assert.equal(reads,1);assert.equal(f.watcher.active,false);assert.equal(f.events.at(-1).state,'complete');
 assert.equal(dispatchNeedsRefresh({one:{state:'needs_attention'}}),false);
});
