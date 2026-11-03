import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
// HTMLFormElement named controls shadow same-name expandos. Reproduce that behavior.
test('file input cannot shadow uploaded image state sent to dispatch',async()=>{
 const changes=[],status={textContent:''},control={name:'distributionMedia',value:'',files:[{name:'one.png',size:8,type:'image/png',arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer}]};
 const f={querySelector:()=>status};Object.defineProperty(f,'distributionMedia',{get:()=>control,set:()=>{},configurable:true});control.closest=()=>f;f.isConnected=true;
 const g={document:{addEventListener:(name,fn)=>{if(name==='change')changes.push(fn)}},window:{addEventListener(){}},crypto:webcrypto,FileReader:class{readAsDataURL(){this.result='data:image/png;base64,iVBORw0KGgo=';this.onload()}},console};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);g.distributionInvalidate=()=>{};g.distributionUpdate=()=>{};
 await changes.at(-1)({target:control});assert.equal(f.distributionMedia,control);assert.equal(f.distributionMediaFiles.length,1);assert.match(f.distributionMediaFiles[0].sha256,/^[a-f0-9]{64}$/);assert.match(status.textContent,/1 张图片/);
});
