import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function context(){
 const storage=new Map(),calls=[],g={currentBrand:'b1',accessInfo:{current:{owner:'owner',role:'owner'}},document:{addEventListener(){}},brand:()=>({id:g.currentBrand}),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},apiRequest:async(...args)=>{calls.push(args);return{}},runtimeFlush:async()=>{},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/wordpress.js',import.meta.url),'utf8'),g);
 return{g,calls,storage};
}
test('selected publishing account accompanies reads, JSON writes and media uploads',async()=>{
 const {g,calls}=context();g.wordpressSelectAccount('wp-account-a');
 await g.wordpressRequest('/api/wordpress?brandId=b1');
 await g.wordpressRequest('/api/wordpress/draft',{method:'POST',body:JSON.stringify({brandId:'b1',accountId:'stale-account'})});
 const media=new FormData();media.set('brandId','b1');await g.wordpressRequest('/api/wordpress/media/upload',{method:'POST',body:media});
 assert.match(calls[0][0],/accountId=wp-account-a/);assert.equal(JSON.parse(calls[1][1].body).accountId,'wp-account-a');assert.equal(media.get('accountId'),'wp-account-a');
});
test('pending submissions and chosen identities remain separate across account, brand and workspace switches',()=>{
 const {g,storage}=context();storage.set(g.wordpressPendingKey(),JSON.stringify({id:'legacy-request'}));
 g.wordpressSelectAccount('wp-account-a');assert.equal(g.wordpressPending(),null);storage.set(g.wordpressPendingKey(),JSON.stringify({id:'account-a-request'}));
 g.currentBrand='b2';assert.equal(g.wordpressSelectedAccount(),'default');assert.equal(g.wordpressPending(),null);
 g.currentBrand='b1';assert.equal(g.wordpressSelectedAccount(),'wp-account-a');assert.equal(g.wordpressPending().id,'account-a-request');
 g.accessInfo.current.owner='other';assert.equal(g.wordpressSelectedAccount(),'default');assert.equal(g.wordpressPending(),null);
 g.accessInfo.current.owner='owner';g.wordpressSelectAccount('default');assert.equal(g.wordpressPending().id,'legacy-request');
});
test('switching accounts while a form is open refuses submission before network calls',async()=>{
 const {g,calls}=context();const oldScope=g.wordpressScope();g.wordpressSelectAccount('wp-account-a');
 await assert.rejects(g.wordpressMutation('connection',{},oldScope),/已切换/);assert.equal(calls.length,0);
});
