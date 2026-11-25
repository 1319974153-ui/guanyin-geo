import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveComparison} from '../src/live-comparison.js';
test('pairing requires both saved consumer replies to the identical scoped question in forward order',()=>{
 const q={brandId:'b',questionId:'q',version:'v1',text:'Q',run:'new',baseline:'old',platforms:['豆包','DeepSeek']};
 const a={source:'consumer-web',surface:'import',entry:'web',platform:'豆包',status:'ok',text:'answer',brandId:'b',promptId:'q',questionVersion:'v1',questionText:'Q',id:'a',externalId:'live-old-豆包',date:'2026-11-23'};
 const b={...a,id:'b',externalId:'live-new-豆包',date:'2026-11-24'};
 const compare=x=>liveComparison([a,x],q)[0];
 assert.equal(compare(b).paired,true);assert.equal(compare(b).after.recommended,null);
 assert.equal(compare(b).uncontrolled.length,4);
 for(const patch of [{brandId:'foreign'},{questionVersion:'v2'},{questionText:'Q2'},{productId:'p'},{date:a.date},{source:'manual'},{status:'failed'}])assert.equal(compare({...b,...patch}).paired,false);
 assert.equal(liveComparison([a,b],q)[1].after,null);
});

test('a repeated capture cannot fabricate a pair, unlabeled data stays unknown',()=>{
 const q={brandId:'b',questionId:'q',version:'v1',text:'Q',run:'new',baseline:'old',platforms:['DeepSeek']};
 const a={source:'consumer-web',surface:'import',entry:'web',platform:'DeepSeek',status:'ok',text:'answer',brandId:'b',promptId:'q',questionVersion:'v1',questionText:'Q',id:'a',externalId:'live-old-DeepSeek',date:'2026-11-23',mention:false};
 const b={...a,id:'b',externalId:'live-new-DeepSeek',date:'2026-11-24',mention:true,citationKnown:false};
 assert.equal(liveComparison([a,b],q)[0].comparison,'复测开始提及品牌');
 assert.equal(liveComparison([{...a,mention:undefined},b],q)[0].before.mention,null);
 const duplicate=liveComparison([a,b,{...b,id:'b2'}],q)[0];
 assert.equal(duplicate.paired,false);assert.match(duplicate.comparison,/多条回答/);
});
