import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';import {articleMediaRefs} from '../src/article-media-core.js';
const asset=(n)=>({id:'am-'+String(n).repeat(64),name:'图'+n+'.png',type:'image/png',sha256:String(n).repeat(64),bytes:10,width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgo='});
function fixture({saved=[],request}={}){
 const changes=[],clicks=[],status={textContent:''},list={innerHTML:''},library={innerHTML:''},rights={checked:false},control={name:'distributionMedia',value:'',files:[]},calls=[];let currentBrand='brand';
 const f={dataset:{brand:'brand',id:'article'},elements:{distributionMedia:control,distributionMediaRights:rights},distributionMediaRefs:saved.map(x=>({id:x.id,sha256:x.sha256,rightsConfirmed:true})),distributionPersistentMedia:saved.length>0,isConnected:true,querySelector:s=>s==='[data-distribution-media-list]'?list:s==='[data-distribution-media-library-list]'?library:status};
 Object.defineProperty(f,'distributionMedia',{get:()=>control,set:()=>{},configurable:true});control.closest=()=>f;rights.closest=()=>f;rights.name='distributionMediaRights';
 const g={GEO_ARTICLE_EDITOR:{articleMediaRefs},accessInfo:{current:{owner:'local-owner',actor:'local-owner',role:'owner',brands:null}},document:{addEventListener:(name,fn)=>{if(name==='change')changes.push(fn);if(name==='click')clicks.push(fn)}},window:{addEventListener(){}},wordpressBaseScope:()=> 'scope',brand:()=>({id:currentBrand}),crypto:webcrypto,esc:s=>String(s),Image:class{set src(v){if(!v)return;this.naturalWidth=1;this.naturalHeight=1;this.onload()}},FileReader:class{readAsDataURL(){this.result=asset(1).dataUrl;this.onload()}},apiRequest:async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,body});return request?request(path,body):{media:body.ids?body.ids.map(id=>saved.find(x=>x.id===id)): [asset(1)]}},console};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);g.distributionInvalidate=()=>{};g.distributionUpdate=()=>{};g.articleEditorRefresh=()=>{};
 const change=()=>changes.at(-1)({target:control});return{g,f,status,list,library,control,rights,changes,calls,change,setBrand:v=>{currentBrand=v}};
}
test('file input cannot shadow durable asset references; uploaded bytes never become workspace refs',async()=>{
 const e=fixture();e.control.files=[{name:'one.png',size:8,type:'image/png'}];await e.change();assert.equal(e.f.distributionMedia,e.control);assert.equal(e.f.distributionMediaFiles.length,1);assert.match(e.status.textContent,/1 张图片/);
 assert.equal(e.calls[0].path,'/api/article-media/upload');assert.equal(e.calls[0].body.brandId,'brand');assert.equal(e.f.distributionMediaRefs[0].rightsConfirmed,false);assert.equal(e.f.distributionMediaRefs[0].dataUrl,undefined);assert.equal(e.f.distributionPersistentMedia,true);
});
test('cancelling image chooser preserves saved files, rights and pending state',async()=>{
 const e=fixture({saved:[asset(1)]});e.f.distributionMediaFiles=[asset(1)];await e.change();assert.equal(e.calls.length,0);assert.equal(e.f.distributionMediaFiles.length,1);assert.equal(e.f.distributionMediaRefs[0].rightsConfirmed,true);assert.equal(e.f.distributionMediaChosen,undefined);
});
test('reopening draft loads original order and preserves per-article rights, once only',async()=>{
 const e=fixture({saved:[asset(2),asset(1)]});await e.g.distributionLoadSavedMedia(e.f);assert.deepEqual(e.calls[0].body.ids,[asset(2).id,asset(1).id]);assert.deepEqual(e.f.distributionMediaFiles.map(x=>x.id),[asset(2).id,asset(1).id]);assert.equal(e.rights.checked,true);await e.g.distributionLoadSavedMedia(e.f);assert.equal(e.calls.length,1);
});
test('changed or unavailable asset blocks save/send instead of dropping a missing image',async()=>{
 const e=fixture({saved:[asset(1)],request:async()=>({media:[asset(2)]})});await e.g.distributionLoadSavedMedia(e.f);assert.match(e.f.distributionMediaError,/不一致/);assert.equal(e.f.distributionMediaRefs.length,1);assert.equal(e.f.distributionMediaLoaded,undefined);
});
test('an upload completing after brand switch cannot bind files to another editor',async()=>{
 let finish;const e=fixture({request:()=>new Promise(resolve=>{finish=resolve})});e.control.files=[{name:'one.png',size:8,type:'image/png'}];const pending=e.change();while(!finish)await new Promise(r=>setImmediate(r));e.setBrand('other');finish({media:[asset(1)]});await pending;assert.equal(e.f.distributionMediaFiles,undefined);assert.equal(e.f.distributionMediaRefs.length,0);
});
test('bad selection retains previous files and visibly blocks a silent text-only fallback',async()=>{
 const e=fixture({saved:[asset(1)]});e.f.distributionMediaFiles=[asset(1)];e.control.files=[{name:'bad.svg',size:2,type:'image/svg+xml'}];await e.change();assert.match(e.f.distributionMediaError,/仅支持/);assert.equal(e.f.distributionMediaFiles[0].id,asset(1).id);assert.equal(e.calls.length,0);e.g.distributionClearMedia(e.f);assert.equal(e.f.distributionMediaRefs.length,0);assert.equal(e.f.distributionMediaError,'');assert.equal(e.f.distributionPersistentMedia,true);
});
test('same-brand reuse does not duplicate pictures or inherit another draft usage confirmation',async()=>{
 const e=fixture({saved:[asset(1)],request:async()=>({media:[asset(2)]})});e.f.distributionMediaFiles=[asset(1)];await e.g.distributionReuseMedia(e.f,asset(2).id);assert.equal(e.calls[0].body.brandId,'brand');assert.equal(e.f.distributionMediaRefs.length,2);assert.equal(e.f.distributionMediaRefs[1].rightsConfirmed,false);await e.g.distributionReuseMedia(e.f,asset(2).id);assert.equal(e.f.distributionMediaRefs.length,2);assert.match(e.status.textContent,/重复/);
});

test('reselecting the identical image keeps its current-article usage confirmation',async()=>{
 const e=fixture({saved:[asset(1)]});e.f.distributionMediaFiles=[asset(1)];e.control.files=[{name:'one.png',size:8,type:'image/png'}];await e.change();assert.equal(e.f.distributionMediaRefs[0].rightsConfirmed,true);assert.equal(e.f.distributionMediaRefs.length,1);
});
