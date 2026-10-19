import test from 'node:test';
import assert from 'node:assert/strict';
test('popup restores selected platform and persists changes before requesting only that platform host',async t=>{
 const previous={chrome:globalThis.chrome,document:globalThis.document};
 const actions={},messages=[],grants=[],stored={selectedPlatform:'zhihu'};
 const elements=Object.fromEntries(['status','platform','pairing','pair','open','verify','inspect','run','reconcile'].map(id=>[id,{value:id==='platform'?'csdn':'',disabled:false,textContent:'',addEventListener(event,fn){actions[id+':'+event]=fn}}]));
 globalThis.document={querySelector:s=>elements[s.slice(1)],getElementById:id=>elements[id],querySelectorAll:()=>['pair','open','verify','inspect','run','reconcile'].map(id=>elements[id])};
 globalThis.chrome={storage:{local:{async get(k){return {[k]:stored[k]}},async set(v){Object.assign(stored,v)}}},permissions:{async request(v){grants.push(v);return true}},runtime:{async sendMessage(v){messages.push(v);return {ok:true}}}};
 t.after(()=>Object.assign(globalThis,previous));
 await import('../browser-extension/popup.js?test='+Math.random());await Promise.resolve();assert.equal(elements.platform.value,'zhihu');
 elements.platform.value='douyin';await actions['platform:change']();await actions['open:click']();assert.equal(stored.selectedPlatform,'douyin');assert.deepEqual(grants,[{origins:['https://creator.douyin.com/*']}]);assert.equal(messages[0].platform,'douyin');
 await actions['inspect:click']();assert.equal(messages[1].action,'inspect');assert.equal(grants.length,1);
});
