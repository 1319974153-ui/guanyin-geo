import test from 'node:test';
import assert from 'node:assert/strict';
test('popup restores selected platform and persists changes before requesting only that platform host',async t=>{
 const previous={chrome:globalThis.chrome,document:globalThis.document};
 const actions={},messages=[],grants=[],stored={selectedPlatform:'zhihu'};
 const elements=Object.fromEntries(['connector-version','status','platform','pairing','pair','open','verify','inspect','run','resume','reconcile'].map(id=>[id,{value:id==='platform'?'csdn':'',disabled:false,textContent:'',addEventListener(event,fn){actions[id+':'+event]=fn}}]));
 globalThis.document={querySelector:s=>elements[s.slice(1)],getElementById:id=>elements[id],querySelectorAll:()=>['pair','open','verify','inspect','run','resume','reconcile'].map(id=>elements[id])};
 globalThis.chrome={storage:{local:{async get(k){return {[k]:stored[k]}},async set(v){Object.assign(stored,v)}}},permissions:{async request(v){grants.push(v);return true}},runtime:{getManifest(){return {version:'0.2.8'}},async sendMessage(v){messages.push(v);return {ok:true}}}};
 t.after(()=>Object.assign(globalThis,previous));
 await import('../browser-extension/popup.js?test='+Math.random());await Promise.resolve();assert.equal(elements.platform.value,'zhihu');assert.match(elements['connector-version'].textContent,/^0.2.8/);
 elements.platform.value='douyin';await actions['platform:change']();await actions['open:click']();assert.equal(stored.selectedPlatform,'douyin');assert.deepEqual(grants,[{origins:['https://creator.douyin.com/*']}]);assert.equal(messages[0].platform,'douyin');
 await actions['inspect:click']();assert.equal(messages[1].action,'inspect');assert.equal(grants.length,1);
});

function popupHarness(t,sendMessage){
 const previous={chrome:globalThis.chrome,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const actions={},timers=new Map(),stored={selectedPlatform:'toutiao'};let nextTimer=0;
 const ids=['connector-version','status','platform','pairing','pair','open','verify','inspect','run','resume','reconcile'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:id==='platform'?'csdn':'',disabled:false,textContent:'',addEventListener(event,fn){actions[id+':'+event]=fn}}]));
 globalThis.document={querySelector:s=>elements[s.slice(1)],getElementById:id=>elements[id],querySelectorAll:()=>ids.slice(4).map(id=>elements[id])};
 globalThis.chrome={storage:{local:{async get(k){return {[k]:stored[k]}},async set(v){Object.assign(stored,v)}}},runtime:{getManifest:()=>({version:'0.2.10'}),sendMessage}};
 globalThis.setTimeout=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id};globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>Object.assign(globalThis,previous));
 return {elements,actions,timers,stored,async load(){await import('../browser-extension/popup.js?test='+Math.random());await Promise.resolve()},async flush(){for(let i=0;i<8;i++)await Promise.resolve()}};
}
test('unanswered account verification unlocks popup after timeout without retry or false success',async t=>{
 let resolve,calls=0;const h=popupHarness(t,()=>{calls++;return new Promise(r=>{resolve=r})});await h.load();
 const pending=h.actions['verify:click']();await h.flush();
 assert.equal(h.elements.verify.disabled,true);assert.equal(h.elements.platform.disabled,true);assert.match(h.elements.status.textContent,/头条/);
 assert.equal(h.timers.size,1);const timeout=[...h.timers.values()][0];assert.equal(timeout.ms,30000);timeout.fn();await pending;
 assert.equal(h.elements.verify.disabled,false);assert.equal(h.elements.platform.disabled,false);assert.match(h.elements.status.textContent,/未确认连接成功/);assert.equal(calls,1);assert.equal(h.timers.size,0);
 const message=h.elements.status.textContent;resolve({ok:true});await h.flush();assert.equal(h.elements.status.textContent,message);
});
test('successful verification clears deadline and displays only returned stored evidence',async t=>{
 const h=popupHarness(t,async()=>{h.stored.status='已核验账号：测试账号';return {ok:true}});await h.load();await h.actions['verify:click']();
 assert.equal(h.elements.status.textContent,'已核验账号：测试账号');assert.equal(h.timers.size,0);assert.equal(h.elements.verify.disabled,false);
});
test('missing worker response is an explicit error, not a stale success message',async t=>{
 const h=popupHarness(t,async()=>undefined);await h.load();h.stored.status='旧成功提示';await h.actions['verify:click']();
 assert.match(h.elements.status.textContent,/未返回结果/);assert.equal(h.elements.verify.disabled,false);assert.equal(h.timers.size,0);
});
