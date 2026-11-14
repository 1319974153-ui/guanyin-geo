import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {articleMediaRefs} from '../src/article-media-core.js';
import * as dispatch from '../src/publish-dispatch-core.js';
import {publishingCatalog} from '../src/publishing-catalog.js';

function fixture(){
 const article={id:'a',brandId:'brand',title:'项目资料整理方法',text:'从交付清单开始整理资料。',status:'已审核'},nodes=new Map(),listeners={},calls=[];
 const node=key=>{if(!nodes.has(key))nodes.set(key,{dataset:{},textContent:'',innerHTML:''});return nodes.get(key)};
 const form={isConnected:true,dataset:{id:'a',brand:'brand'},elements:{title:{value:article.title},text:{value:article.text},distributionMode:{value:'publish'},distributionTags:{value:''},distributionConfirmed:{checked:true}},distributionScope:'scope',distributionCatalog:publishingCatalog(),distributionTargets:[],distributionJournal:{},selected:[],querySelector:node,querySelectorAll:selector=>selector==='[data-distribution-target]:checked'?form.selected.map(value=>({value})):[]};
 const g={GEO_DISPATCH:dispatch,document:{addEventListener:(event,fn)=>(listeners[event]||=[]).push(fn)},window:{addEventListener(){}},own:()=>[article],wordpressBaseScope:()=> 'scope',brand:()=>({id:'brand'}),articleEditorDirty:()=>false,runtimeBusy:false,accessInfo:{current:{role:'owner'}},esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),runtimeLock:()=>{},apiRequest:async()=>{calls.push('request');throw Error('unexpected request')},articleEditorSave:async()=>{calls.push('save');return article}};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 form.distributionScope=g.distributionScope();
 const select=(platform,extra={})=>{const t={key:platform+':one',platform,accountId:'one',name:'作者',modes:['draft','publish','prepare'],...extra};form.distributionTargets.push(t);form.selected.push(t.key);return t};
 return {g,form,node,listeners,calls,select};
}
test('selecting several platforms shows all known missing inputs before a click',()=>{
 const x=fixture();x.select('csdn');x.select('douyin');x.g.distributionUpdate(x.form);
 assert.equal(x.node('[data-distribution-send]').disabled,true);
 const html=x.node('[data-distribution-readiness]').innerHTML;
 assert.match(html,/CSDN/);assert.match(html,/1 至 5 个不同标签/);assert.match(html,/抖音图文/);assert.match(html,/至少 1 张/);
 assert.deepEqual(x.calls,[]);
 x.form.elements.distributionTags.value='软件测试';x.form.distributionMediaFiles=[{sha256:'a'.repeat(64)}];x.g.distributionUpdate(x.form);
 assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-readiness]').innerHTML,/CSDN/);assert.match(x.node('[data-distribution-readiness]').innerHTML,/暂不支持本稿附加图片/);
 x.form.selected=x.form.selected.filter(key=>key!=='csdn:one');x.g.distributionUpdate(x.form);
 assert.equal(x.node('[data-distribution-send]').disabled,false);assert.match(x.node('[data-distribution-readiness]').innerHTML,/已选 1 个账号，内容准备就绪/);
});
test('unselected blocked accounts do not prevent a selected working account',()=>{
 const x=fixture();x.select('wordpress');x.form.distributionTargets.push({key:'douyin:expired',platform:'douyin',loginRequired:true,modes:[]});x.g.distributionUpdate(x.form);
 assert.equal(x.node('[data-distribution-send]').disabled,false);assert.doesNotMatch(x.node('[data-distribution-readiness]').innerHTML,/抖音/);
});
test('viewer and reviewer cannot dispatch an approved article through the WeChat desktop IPC',async()=>{
 for(const role of ['viewer','reviewer']){
  const x=fixture();x.g.accessInfo.current={owner:'local-owner',actor:'local-owner',role};x.form.distributionScope=x.g.distributionScope();
  x.select('wechat',{transport:'desktop_personal',accountId:'personal-browser'});x.g.window.guanyinDesktop={wechatPersonalPublish:async()=>x.calls.push('desktop write')};
  x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
  x.g.distributionUpdate(x.form);assert.equal(x.node('[data-distribution-send]').disabled,true);
  await x.g.distributionSend(x.form,'publish');assert.deepEqual(x.calls,[]);assert.match(x.node('[data-distribution-error]').textContent,/角色不能发送/);
 }
});
test('a changed actor, role or brand grant invalidates a previously opened publishing panel',async()=>{
 for(const change of [a=>a.actor='someone-else',a=>a.role='editor',a=>a.brands=['other']]){
  const x=fixture();x.select('wordpress');x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
  change(x.g.accessInfo.current);await x.g.distributionSend(x.form,'publish');assert.deepEqual(x.calls,[]);assert.match(x.node('[data-distribution-error]').textContent,/已切换/);
 }
});
test('WordPress modes come from current server capabilities even when its connection says verified',async()=>{
 const x=fixture();x.g.URLSearchParams=URLSearchParams;x.g.browserPublisherAvailable=()=>false;x.g.publishingAccountStates={verified:'已连接'};
 x.g.distributionRenderTargets=()=>{};x.g.distributionRestore=async()=>{};x.g.distributionRestoreRegisteredBatch=()=>{};x.g.distributionRecoverWechatTask=async()=>{};
 x.g.apiRequest=async path=>path.startsWith('/api/publishing-center?')?{accounts:[{platform:'wordpress',accountId:'readonly',status:'verified',capabilities:{createDraft:false,publish:false}},{platform:'wordpress',accountId:'draft-only',status:'verified',capabilities:{createDraft:true,publish:false}}],platforms:[]}: {batches:[]};
 await x.g.distributionLoad(x.form);assert.deepEqual([...x.form.distributionTargets.find(t=>t.accountId==='readonly').modes],[]);assert.deepEqual([...x.form.distributionTargets.find(t=>t.accountId==='draft-only').modes],['draft']);
});
test('an owner WeChat send passes only exact server authorization to IPC, after validate, without rendering credentials into the journal',async()=>{
 const x=fixture(),stored=new Map(),order=[],token='e'.repeat(64);x.g.crypto=webcrypto;x.g.TextEncoder=TextEncoder;
 x.g.accessInfo.current={owner:'local-owner',actor:'local-owner',role:'owner'};x.form.distributionScope=x.g.distributionScope();
 x.select('wechat',{transport:'desktop_personal',accountId:'personal-browser'});
 x.g.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};x.g.toast=()=>{};
 x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
 let id,ipc;
 x.g.apiRequest=async(path,options)=>{
  order.push(path);
  if(path==='/api/publish-authorizations'){const body=JSON.parse(options.body);id=body.id;assert.deepEqual(body.targets,[{platform:'wechat',accountId:'personal-browser'}]);assert.equal(body.contentId,'a');return {authorization:{id,desktopToken:token}};}
  if(path==='/api/publish-authorizations/validate')return {authorization:{id}};
  if(path==='/api/state')return {state:{},revision:1};throw Error('unexpected request');
 };
 x.g.window.guanyinDesktop={wechatPersonalPublish:async input=>{order.push('ipc');ipc=input;return {message:'已准备'};}};
 await x.g.distributionSend(x.form,'publish');assert.equal(x.node('[data-distribution-error]').textContent,'');
 assert.deepEqual(order,['/api/publish-authorizations','/api/publish-authorizations/validate','ipc','/api/state']);
 assert.equal(ipc.authorizationId,id);assert.equal(ipc.desktopToken,token);assert.equal(ipc.brandId,'brand');assert.equal(ipc.contentId,'a');assert.equal(ipc.mode,'publish');assert.match(ipc.taskId,/^gy-[a-f0-9]{64}$/);assert.equal('html' in ipc,false);assert.equal('title' in ipc,false);
 assert.ok([...stored.values()].every(v=>!v.includes(token)));
});
test('changing actor while a WeChat authorization is being created never reaches IPC',async()=>{
 const x=fixture();x.g.crypto=webcrypto;x.g.TextEncoder=TextEncoder;x.g.accessInfo.current={owner:'local-owner',actor:'local-owner',role:'owner'};x.form.distributionScope=x.g.distributionScope();
 x.select('wechat',{transport:'desktop_personal',accountId:'personal-browser'});x.g.localStorage={getItem:()=>null,setItem:()=>{}};x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
 x.g.window.guanyinDesktop={wechatPersonalPublish:async()=>x.calls.push('ipc')};x.g.apiRequest=async(path,options)=>{x.calls.push(path);x.g.accessInfo.current.actor='different';return {authorization:{id:JSON.parse(options.body).id,desktopToken:'e'.repeat(64)}}};
 await x.g.distributionSend(x.form,'publish');assert.deepEqual(x.calls,['/api/publish-authorizations']);assert.match(x.node('[data-distribution-error]').textContent,/已变化/);assert.equal(x.node('[data-distribution-send]').disabled,true);
});
test('live editor contents drive preview and title limits are shown before changing saved data',()=>{
 const x=fixture();x.select('toutiao');x.form.elements.title.value='长'.repeat(31);x.g.distributionUpdate(x.form);
 assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-readiness]').innerHTML,/标题需缩短到 30 字以内/);assert.deepEqual(x.calls,[]);
});
test('direct invocation cannot bypass summary checks or approve/send an incomplete batch',async()=>{
 const x=fixture();x.select('csdn');x.select('douyin');x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
 await x.g.distributionSend(x.form,'publish');
 assert.deepEqual(x.calls,[]);assert.equal(x.form.distributionBusy,false);
 assert.match(x.node('[data-distribution-error]').textContent,/CSDN.*标签.*抖音图文.*图片/);
});
test('editing labels immediately refreshes readiness without resetting saved receipts',()=>{
 const x=fixture();x.select('csdn');const journal=x.form.distributionJournal={old:{state:'submitted',jobId:'original'}};
 x.g.distributionUpdate(x.form);assert.equal(x.node('[data-distribution-send]').disabled,true);
 x.form.elements.distributionTags.value='软件测试';
 for(const listener of x.listeners.input)listener({target:{name:'distributionTags',closest:()=>x.form}});
 assert.equal(x.node('[data-distribution-send]').disabled,false);assert.equal(x.form.distributionJournal,journal);assert.deepEqual(x.calls,[]);
});

function mediaFixture(){
 const x=fixture(),reads=[],uploads=[];x.select('51cto');x.g.crypto=webcrypto;x.g.GEO_ARTICLE_EDITOR={articleMediaRefs};
 x.form.distributionMediaFiles=[];x.form.distributionMediaRefs=[];
 x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
 x.g.Image=class{set src(value){if(!value)return;this.naturalWidth=1;this.naturalHeight=1;this.onload()}};
 x.g.FileReader=class{readAsDataURL(file){reads.push({file,success:()=>{this.result='data:'+file.type+';base64,YQ==';this.onload()},fail:()=>this.onerror()})}};
 const upload=async(path,options)=>{assert.equal(path,'/api/article-media/upload');const body=JSON.parse(options.body);assert.equal(body.brandId,'brand');uploads.push(body);return {media:body.media.map(m=>{const sha256=createHash('sha256').update(m.name).digest('hex');return {...m,id:'am-'+sha256,sha256,bytes:1,width:1,height:1}})}};
 x.g.apiRequest=upload;
 const input=x.form.elements.distributionMedia={name:'distributionMedia',files:[],value:'',matches:()=>false,closest:()=>x.form};
 const rights=x.form.elements.distributionMediaRights={name:'distributionMediaRights',checked:false,matches:()=>false,closest:()=>x.form};
 return {...x,reads,uploads,upload,confirmRights:()=>{rights.checked=true;return Promise.all(x.listeners.change.map(listener=>listener({target:rights})))},choose:files=>{input.files=files;input.value=files.length?'chosen':'';return Promise.all(x.listeners.change.map(listener=>listener({target:input})))},file:(name='image.png')=>({name,type:'image/png',size:1,arrayBuffer:async()=>new TextEncoder().encode(name).buffer})};
}
test('selecting an optional picture immediately disables send while the file is being read',async()=>{
 const x=mediaFixture();x.g.distributionUpdate(x.form);assert.equal(x.node('[data-distribution-send]').disabled,false);
 const pending=x.choose([x.file()]);
 assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-readiness]').innerHTML,/图片仍在读取/);
 x.reads[0].success();await pending;
 assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-readiness]').innerHTML,/确认有权/);
 assert.equal(x.form.distributionMediaFiles[0].name,'image.png');assert.equal(x.uploads.length,1);assert.equal(x.form.distributionPersistentMedia,true);assert.equal(x.form.distributionMediaRefs[0].rightsConfirmed,false);assert.equal(x.form.distributionMediaRefs[0].dataUrl,undefined);assert.deepEqual(x.calls,[]);
 await x.confirmRights();assert.equal(x.node('[data-distribution-send]').disabled,false);assert.equal(x.form.distributionMediaRefs[0].rightsConfirmed,true);assert.equal(x.uploads.length,1);
});
test('a slow old image selection cannot overwrite the newest completed selection',async()=>{
 const x=mediaFixture(),old=x.choose([x.file('old.png')]),latest=x.choose([x.file('latest.png')]);
 x.reads[1].success();await latest;const newest=x.form.distributionMediaFiles,status=x.node('[data-distribution-media-status]').textContent;
 x.reads[0].success();await old;
 assert.equal(x.form.distributionMediaFiles,newest);assert.equal(newest[0].name,'latest.png');assert.equal(x.node('[data-distribution-media-status]').textContent,status);assert.equal(x.form.distributionMediaLoading,false);
});
test('an old reader failure cannot clear the newest selection or end its pending state',async()=>{
 const x=mediaFixture(),old=x.choose([x.file('old.png')]),latest=x.choose([x.file('latest.png')]);
 x.reads[0].fail();await old;
 assert.equal(x.form.distributionMediaLoading,true);assert.equal(x.form.distributionMediaError,'');assert.equal(x.form.elements.distributionMedia.value,'chosen');assert.equal(x.node('[data-distribution-send]').disabled,true);
 x.reads[1].success();await latest;assert.equal(x.form.distributionMediaFiles[0].name,'latest.png');
});
test('file failures block dispatch until the customer explicitly clears or replaces pictures',async()=>{
 const x=mediaFixture(),pending=x.choose([x.file()]);x.reads[0].fail();await pending;
 assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-readiness]').innerHTML,/清空图片/);
 x.form.elements.distributionConfirmed.checked=true;await x.g.distributionSend(x.form,'publish');assert.deepEqual(x.calls,[]);
 x.g.distributionClearMedia(x.form);assert.equal(x.form.distributionMediaError,'');assert.equal(x.node('[data-distribution-send]').disabled,false);
 const pending2=x.choose([x.file('replacement.png')]);x.reads[1].success();await pending2;assert.equal(x.form.distributionMediaFiles[0].name,'replacement.png');
});
test('clearing pictures invalidates a still-pending read and keeps required-picture platforms blocked',async()=>{
 const x=mediaFixture(),pending=x.choose([x.file()]);x.select('douyin');x.g.distributionClearMedia(x.form);
 x.reads[0].success();await pending;
 assert.equal(x.form.distributionMediaFiles.length,0);assert.equal(x.form.distributionMediaLoading,false);assert.equal(x.node('[data-distribution-send]').disabled,true);assert.match(x.node('[data-distribution-media-status]').textContent,/已清空/);
});
test('reader completion in a replaced workspace does not mutate the current editor',async()=>{
 const x=mediaFixture(),pending=x.choose([x.file()]);x.form.dataset.brand='other';const status=x.node('[data-distribution-media-status]').textContent;
 x.reads[0].success();await pending;assert.equal(x.form.distributionMediaFiles.length,0);assert.equal(x.node('[data-distribution-media-status]').textContent,status);
});
test('a refresh cannot re-enable send while the current batch is already being prepared',()=>{
 const x=mediaFixture();x.form.distributionBusy=true;x.g.distributionUpdate(x.form);assert.equal(x.node('[data-distribution-send]').disabled,true);assert.deepEqual(x.calls,[]);
});
test('old receipt-image recovery cannot finish or overwrite an explicit new image selection',async()=>{
 const x=mediaFixture();let started,completeRestore;const startedRestore=new Promise(resolve=>started=resolve),restore=new Promise(resolve=>completeRestore=resolve);
 x.g.URLSearchParams=URLSearchParams;x.g.browserPublisherAvailable=()=>true;x.g.browserPlatformNames={'51cto':'51CTO'};
 x.g.distributionRenderTargets=()=>{};x.g.distributionRestore=async()=>{};x.g.distributionRestoreRegisteredBatch=()=>{};x.g.distributionRecoverWechatTask=async()=>{};
 x.g.apiRequest=async(path,options)=>{
  if(path==='/api/article-media/upload')return x.upload(path,options);
  if(path.startsWith('/api/publish-batches?'))return {batches:[]};
  if(path.startsWith('/api/publishing-center?'))return {accounts:[],platforms:publishingCatalog()};
  if(path.startsWith('/api/local-publisher/status?'))return {accounts:[{id:'one',platform:'51cto',transport:'desktop',connectionState:'connected',account:{accountId:'one',name:'作者'},modes:['draft','publish']}],jobs:[{platform:'51cto',contentId:'a',currentRevision:true,mediaHashes:['original'],state:'draft'}]};
  if(path==='/api/local-publisher/media'){started();return restore;}
  throw Error('unexpected request '+path);
 };
 const load=x.g.distributionLoad(x.form);await startedRestore;
 const latest=x.choose([x.file('new.png')]);completeRestore({media:[{name:'original.png',sha256:'old'}]});await load;
 assert.equal(x.form.distributionMediaLoading,true);assert.equal(x.form.distributionMediaFiles.length,0);assert.equal(x.node('[data-distribution-send]').disabled,true);
 x.reads[0].success();await latest;assert.equal(x.form.distributionMediaFiles[0].name,'new.png');assert.equal(x.node('[data-distribution-send]').disabled,true);assert.equal(x.form.distributionMediaRefs[0].rightsConfirmed,false);
 await x.confirmRights();assert.equal(x.node('[data-distribution-send]').disabled,false);
});
test('saved media, explicit empty media and legacy receipt recovery remain separate contracts',async()=>{
 for(const kind of ['saved','cleared','legacy']){
  const x=mediaFixture(),paths=[],hash='a'.repeat(64),media={id:'am-'+hash,sha256:hash,name:'saved.png',type:'image/png',dataUrl:'data:image/png;base64,YQ==',bytes:1,width:1,height:1,rightsConfirmed:false};
  const refs=kind==='saved'?[{id:media.id,sha256:hash,rightsConfirmed:true}]:[];
  if(kind!=='legacy'){Object.assign(x.g.own('contents')[0],{mediaRefs:refs,mediaVersion:1});x.form.distributionPersistentMedia=true;x.form.distributionMediaRefs=refs;}
  x.g.URLSearchParams=URLSearchParams;x.g.browserPublisherAvailable=()=>true;x.g.browserPlatformNames={'51cto':'51CTO'};
  x.g.distributionRenderTargets=()=>{};x.g.distributionRestore=async()=>{};x.g.distributionRestoreRegisteredBatch=()=>{};x.g.distributionRecoverWechatTask=async()=>{};
  x.g.apiRequest=async(path,options)=>{
   paths.push(path);
   if(path==='/api/article-media/load'){assert.equal(kind,'saved');assert.deepEqual(JSON.parse(options.body),{brandId:'brand',ids:[media.id]});return {media:[media]};}
   if(path.startsWith('/api/publish-batches?'))return {batches:[]};
   if(path.startsWith('/api/publishing-center?'))return {accounts:[],platforms:publishingCatalog()};
   if(path.startsWith('/api/local-publisher/status?'))return {accounts:[{id:'one',platform:'51cto',transport:'desktop',connectionState:'connected',account:{accountId:'one',name:'作者'},modes:['draft','publish']}],jobs:[{platform:'51cto',contentId:'a',currentRevision:true,mediaHashes:[hash],state:'draft'}]};
   if(path==='/api/local-publisher/media'){assert.equal(kind,'legacy');return {media:[{...media,name:'original.png'}]};}
   throw Error('unexpected request '+path);
  };
  await x.g.distributionLoad(x.form);
  assert.equal(paths.filter(path=>path==='/api/article-media/load').length,kind==='saved'?1:0);
  assert.equal(paths.filter(path=>path==='/api/local-publisher/media').length,kind==='legacy'?1:0);
  assert.equal(x.form.distributionMediaFiles.length,kind==='cleared'?0:1);
  if(kind==='saved'){assert.equal(x.form.elements.distributionMediaRights.checked,true);assert.equal(x.form.distributionMediaRefs[0].rightsConfirmed,true);assert.equal(x.form.distributionMediaFiles[0].name,'saved.png');}
  if(kind==='legacy'){assert.equal(x.form.distributionPersistentMedia,undefined);assert.equal(x.form.distributionMediaFiles[0].name,'original.png');}
  assert.equal(x.node('[data-distribution-send]').disabled,false);assert.equal(x.uploads.length,0);
 }
});
test('image failures remain reachable after deselecting all image platforms',async()=>{
 const x=mediaFixture();await x.choose([{...x.file(),type:'text/plain'}]);
 x.form.selected=[];x.select('wordpress');x.g.distributionUpdate(x.form);
 assert.equal(x.node('.distribution-media').hidden,false);assert.equal(x.node('[data-distribution-send]').disabled,true);
 const button={dataset:{},hasAttribute:name=>name==='data-distribution-media-clear'},event={target:{closest:selector=>selector==='button'?button:x.form}};
 await Promise.all(x.listeners.click.map(listener=>listener(event)));
 assert.equal(x.form.distributionMediaError,'');assert.equal(x.node('[data-distribution-send]').disabled,false);
});

function batchFixture(){
 const x=fixture(),stored=new Map(),notifications=[],checked=[],enqueued=[];let failedAccount='csdn',authorizationId;
 Object.assign(x.g,{crypto:webcrypto,TextEncoder,URLSearchParams,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},toast:value=>notifications.push(value)});
 x.g.distributionStopWatch=()=>{};x.g.distributionResults=()=>{};x.g.distributionWatch=()=>{};
 x.g.window.guanyinDesktop={available:true,prepare:async list=>{assert.equal(list.length,1);checked.push(list[0]);if(list[0].accountId===failedAccount)throw Error('平台登录已失效，请在官方窗口登录');return {ok:true}},wake:async()=>{}};
 x.g.apiRequest=async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):null;x.calls.push({path,body});
  if(path==='/api/publish-authorizations'){authorizationId=body.id;return {authorization:{id:body.id,expiresAt:body.expiresAt}};}
  if(path==='/api/publish-authorizations/validate')return {authorization:{id:authorizationId,expiresAt:new Date(Date.now()+600000).toISOString()}};
  if(path==='/api/publish-batches')return {batch:{id:body.id,createdAt:new Date().toISOString()}};
  if(path==='/api/publish-batches/claim')return {ok:true};
  if(path.includes('/api/wordpress/preview?'))return {previewHash:'isolated-preview'};
  if(path==='/api/wordpress/draft')return {record:{state:'draft',remote:{postId:'wp-original'}}};
  if(path==='/api/wordpress/publish'||path.startsWith('/api/wordpress/detail?'))return {record:{state:'published',remote:{postId:'wp-original'}}};
  if(path==='/api/local-publisher/enqueue'){enqueued.push(body);return {job:{id:body.expectedAccountId+'-job',state:'queued'}};}
  if(path.startsWith('/api/local-publisher/status?'))return {jobs:enqueued.map(body=>({id:body.expectedAccountId+'-job',state:'queued'}))};
  if(path==='/api/local-publisher/lookup')return {notEnqueued:true};
  if(path==='/api/state')return {state:{},revision:1};
  throw Error('unexpected '+path);
 };
 return {...x,notifications,checked,enqueued,setFailure:value=>failedAccount=value};
}
test('the actual send button isolates failed desktop login and preserves exact API authorization for the remaining accounts',async()=>{
 const x=batchFixture();x.form.elements.distributionTags.value='软件测试';
 const a=x.select('csdn',{transport:'desktop',sessionId:'csdn-session',accountId:'csdn'}),b=x.select('zhihu',{transport:'desktop',sessionId:'zhihu-session',accountId:'zhihu'}),site=x.select('wordpress');
 await x.g.distributionSend(x.form,'publish');
 assert.equal(x.node('[data-distribution-error]').textContent,'');assert.equal(x.enqueued.length,1);assert.equal(x.enqueued[0].expectedAccountId,'zhihu');
 assert.equal(x.form.distributionJournal[a.key].state,'not_queued');assert.equal(x.form.distributionJournal[b.key].state,'queued');assert.equal(x.form.distributionJournal[site.key].state,'published');
 assert.match(x.notifications.at(-1),/1 个账号本次未发送.*其余账号已继续处理/);
 const authorized=x.calls.find(call=>call.path==='/api/publish-authorizations');assert.deepEqual(authorized.body.targets,[{platform:'wordpress',accountId:'one'}]);
 const apiWrites=x.calls.filter(call=>['/api/wordpress/draft','/api/wordpress/publish'].includes(call.path));assert.equal(apiWrites.length,2);assert.ok(apiWrites.every(call=>call.body.authorizationId===authorized.body.id));
 assert.deepEqual(x.calls.filter(call=>call.path==='/api/publish-batches/claim').map(call=>call.body.stage),['draft','publish']);
 x.setFailure(null);x.checked.length=0;const oldWrites=apiWrites.length;
 await x.g.distributionSend(x.form,'publish');
 assert.deepEqual(x.checked,[{sessionId:'csdn-session',accountId:'csdn'}]);assert.equal(x.enqueued.length,2);assert.equal(x.enqueued[1].expectedAccountId,'csdn');
 assert.equal(x.calls.filter(call=>['/api/wordpress/draft','/api/wordpress/publish'].includes(call.path)).length,oldWrites);
});
test('all failed desktop checks show not-sent results without creating authorizations, batches or tasks',async()=>{
 const x=batchFixture();x.form.elements.distributionTags.value='软件测试';const target=x.select('csdn',{transport:'desktop',sessionId:'csdn-session',accountId:'csdn'});
 await x.g.distributionSend(x.form,'publish');
 assert.equal(x.calls.length,0);assert.equal(x.form.distributionJournal[target.key].preflightFailed,true);assert.match(x.notifications.at(-1),/1 个账号本次未发送/);assert.equal(x.form.distributionBusy,false);
 assert.equal(x.g.distributionResultLabel(x.form.distributionJournal[target.key]),'本次未发送');
 assert.match(x.g.distributionRecoveryButton(x.form,x.form.distributionJournal[target.key]),/打开平台处理/);
});
test('changing roles during a failed account check prevents every later account and authorization',async()=>{
 const x=batchFixture();x.form.elements.distributionTags.value='软件测试';x.select('csdn',{transport:'desktop',sessionId:'csdn-session',accountId:'csdn'});x.select('wordpress');
 x.g.window.guanyinDesktop.prepare=async()=>{x.g.accessInfo.current.role='viewer';throw Error('连接失败')};
 await x.g.distributionSend(x.form,'publish');
 assert.equal(x.calls.length,0);assert.match(x.node('[data-distribution-error]').textContent,/权限.*变化/);assert.equal(Object.keys(x.form.distributionJournal).length,0);assert.equal(x.node('[data-distribution-send]').disabled,true);
});
