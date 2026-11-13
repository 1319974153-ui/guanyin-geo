import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const calls=[];
 const storage=new Map(),articleStore=[{id:'content-1',brandId:'brand-1',title:'已审核稿',text:'经过确认的正文',status:'已审核',ai:true,factSnapshots:[]}];
 const g={crypto:globalThis.crypto,TextEncoder,Uint8Array,document:{addEventListener(){}},window:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},own:()=>articleStore,articleEditorDirty:()=>false,esc:value=>String(value),GEO_DISPATCH:{dispatchNeedsRefresh:()=>false},apiRequest:async(path,init)=>{
  const body=JSON.parse(init.body);calls.push({path,body});
  if(path==='/api/publish-authorizations')return {authorization:{id:body.id,expiresAt:body.expiresAt}};
  if(path==='/api/publish-authorizations/validate')return {authorization:{id:body.id,expiresAt:calls[0].body.expiresAt},valid:true};
  if(path==='/api/publish-batches')return {batch:{id:body.id,createdAt:'2026-11-10T00:00:00.000Z',targets:body.targets}};
  if(path==='/api/publish-batches/claim')return {lease:{id:body.leaseId,stage:body.stage,expiresAt:'2026-11-10T00:03:00.000Z'},batch:{id:body.id,targets:[]}};
  throw new Error('unexpected request '+path);
 }};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 return {g,calls,storage};
}

const article={id:'content-1',brandId:'brand-1',title:'已审核稿',text:'经过确认的正文',ai:true,factSnapshots:[]};
const wordpress={key:'wordpress:default',platform:'wordpress',accountId:'default',modes:['draft','publish']};
const browser={key:'csdn:session',platform:'csdn',accountId:'author',sessionId:'session',transport:'desktop',modes:['draft','publish']};

test('dispatch performs one short-lived approval check for server-owned accounts before any platform request',async()=>{
 const {g,calls}=fixture(),form={};
 const receipt=await g.distributionAuthorizeServerTargets(form,article,[wordpress,browser],'publish','owner/brand-1');
 assert.equal(receipt.id,calls[0].body.id);assert.match(receipt.id,/^pa-[a-f0-9]{64}$/);
 assert.deepEqual(calls.map(call=>call.path),['/api/publish-authorizations','/api/publish-authorizations/validate']);
 assert.deepEqual(calls[0].body.targets,[{platform:'wordpress',accountId:'default'}]);
 assert.equal(calls[0].body.confirmed,true);assert.equal(calls[0].body.contentId,'content-1');
});

test('the same in-progress click reuses its authorization id, while an edited article creates a new one',async()=>{
 const {g,calls}=fixture(),form={};
 await g.distributionAuthorizeServerTargets(form,article,[wordpress],'draft','owner/brand-1');
 const first=calls[0].body.id;
 await g.distributionAuthorizeServerTargets(form,article,[wordpress],'draft','owner/brand-1');
 assert.equal(calls[2].body.id,first);
 await g.distributionAuthorizeServerTargets(form,{...article,text:'审核后修改的正文'},[wordpress],'draft','owner/brand-1');
 assert.notEqual(calls[4].body.id,first);
});

test('a browser-only target keeps its existing desktop receipt flow and does not request a server authorization',async()=>{
 const {g,calls}=fixture();
 assert.equal(await g.distributionAuthorizeServerTargets({},article,[browser],'publish','owner/brand-1'),null);
 assert.equal(calls.length,0);
});

test('the same click registers its server-owned batch after authorization, while browser targets stay outside it',async()=>{
 const {g,calls}=fixture(),form={};
 await g.distributionAuthorizeServerTargets(form,article,[wordpress,browser],'publish','owner/brand-1');
 const batch=await g.distributionCreateServerBatch(form,article,[wordpress,browser],'publish','owner/brand-1');
 assert.match(batch.id,/^pb-[a-f0-9]{64}$/);assert.deepEqual(calls.map(call=>call.path),['/api/publish-authorizations','/api/publish-authorizations/validate','/api/publish-batches']);
 assert.deepEqual(calls[2].body.targets,[{platform:'wordpress',accountId:'default'}]);assert.equal(calls[2].body.authorizationId,calls[1].body.id);assert.deepEqual(calls[0].body.media,[]);assert.deepEqual(calls[2].body.executionPolicy,{frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0});
});

test('an adapter claim is scoped to its immutable batch, account and one execution stage',async()=>{
 const {g,calls}=fixture(),form={},batch={id:'pb-'+'a'.repeat(64)};
 const first=await g.distributionClaimServerTarget(form,batch,article,wordpress,'draft');
 const request=calls[0];assert.equal(request.path,'/api/publish-batches/claim');assert.equal(request.body.id,batch.id);assert.equal(request.body.brandId,'brand-1');assert.equal(request.body.platform,'wordpress');assert.equal(request.body.accountId,'default');assert.equal(request.body.stage,'draft');assert.match(request.body.leaseId,/^pl-[a-f0-9]{64}$/);assert.equal(first.lease.id,request.body.leaseId);
 await g.distributionClaimServerTarget(form,batch,article,wordpress,'draft');
 assert.equal(calls[1].body.leaseId,request.body.leaseId);
});

test('a current registered batch is restored as visible pending intent without sending it',()=>{
 const {g,storage}=fixture(),box={querySelector:()=>null};
 const form={dataset:{id:'content-1'},distributionKey:'test-key',distributionJournal:{},distributionTargets:[{...wordpress,name:'作者'}],distributionCatalog:[],querySelector:()=>box,querySelectorAll:()=>[]};
 const restored=g.distributionRestoreRegisteredBatch(form,[{id:'pb-'+('a'.repeat(64)),contentId:'content-1',currentRevision:true,createdAt:'2026-11-10T00:00:00.000Z',mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'gy-'+('b'.repeat(64)),state:'not_started'}]}]);
 assert.equal(restored,true);assert.equal(form.distributionJournal[wordpress.key].state,'registered');assert.match(form.distributionJournal[wordpress.key].notice,/尚未向平台发送/);assert.match(storage.get('test-key'),/registered/);
 assert.equal(g.distributionRestoreRegisteredBatch(form,[{contentId:'content-1',currentRevision:false,targets:[{platform:'wordpress',accountId:'other',state:'not_started'}]}]),false);
});

test('an expired batch claim restores as result-to-check, never as a new send',()=>{
 const {g,storage}=fixture(),box={querySelector:()=>null};
 const form={dataset:{id:'content-1'},distributionKey:'test-unknown',distributionJournal:{},distributionTargets:[{...wordpress,name:'作者'}],distributionCatalog:[],querySelector:()=>box,querySelectorAll:()=>[]};
 const restored=g.distributionRestoreRegisteredBatch(form,[{id:'pb-'+('a'.repeat(64)),contentId:'content-1',currentRevision:true,createdAt:'2026-11-10T00:00:00.000Z',mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'gy-'+('b'.repeat(64)),state:'result_unknown',stage:'draft',notice:'保存草稿在取得平台回执前中断，结果待核对；不会自动重发。'}]}]);
 assert.equal(restored,true);assert.equal(form.distributionJournal[wordpress.key].state,'uncertain');assert.equal(form.distributionJournal[wordpress.key].resultUnknown,true);assert.match(form.distributionJournal[wordpress.key].notice,/不会自动重发/);assert.match(storage.get('test-unknown'),/uncertain/);
});

test('refreshing a matching durable batch upgrades a pending local row to result-to-check',()=>{
 const {g,storage}=fixture(),box={querySelector:()=>null},batchId='pb-'+('a'.repeat(64));
 const form={dataset:{id:'content-1'},distributionKey:'test-server-refresh',distributionJournal:{[wordpress.key]:{id:'gy-'+('b'.repeat(64)),key:wordpress.key,platform:'wordpress',accountId:'default',name:'作者',state:'registered',batchId,notice:'已登记'}},distributionTargets:[{...wordpress,name:'作者'}],distributionCatalog:[],querySelector:()=>box,querySelectorAll:()=>[]};
 const restored=g.distributionRestoreRegisteredBatch(form,[{id:batchId,contentId:'content-1',currentRevision:true,createdAt:'2026-11-10T00:00:00.000Z',mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'gy-'+('b'.repeat(64)),state:'result_unknown',stage:'publish'}]}]);
 assert.equal(restored,true);assert.equal(form.distributionJournal[wordpress.key].state,'uncertain');assert.equal(form.distributionJournal[wordpress.key].resultUnknown,true);assert.match(form.distributionJournal[wordpress.key].notice,/不会自动重发/);assert.match(storage.get('test-server-refresh'),/resultUnknown/);
});

test('the newest batch wins over an older unknown batch for the same account',()=>{
 const {g}=fixture(),box={querySelector:()=>null};
 const form={dataset:{id:'content-1'},distributionKey:'test-newest-batch',distributionJournal:{},distributionTargets:[{...wordpress,name:'作者'}],distributionCatalog:[],querySelector:()=>box,querySelectorAll:()=>[]};
 const restored=g.distributionRestoreRegisteredBatch(form,[
  {id:'pb-'+('c'.repeat(64)),contentId:'content-1',currentRevision:true,createdAt:'2026-11-11T00:00:00.000Z',mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'gy-'+('d'.repeat(64)),state:'not_started'}]},
  {id:'pb-'+('a'.repeat(64)),contentId:'content-1',currentRevision:true,createdAt:'2026-11-10T00:00:00.000Z',mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'gy-'+('b'.repeat(64)),state:'result_unknown'}]}
 ]);
 assert.equal(restored,true);assert.equal(form.distributionJournal[wordpress.key].batchId,'pb-'+('c'.repeat(64)));assert.equal(form.distributionJournal[wordpress.key].state,'registered');assert.notEqual(form.distributionJournal[wordpress.key].resultUnknown,true);
});

test('a new explicit confirmation clears only the local blocker for an expired prior batch',async()=>{
 const {g}=fixture(),journal={[wordpress.key]:{state:'uncertain',batchId:'pb-'+'a'.repeat(64),resultUnknown:true},other:{state:'uncertain',batchId:'pb-'+'b'.repeat(64)}};let saved=0;
 const changed=await g.distributionStartNewConfirmedBatch(journal,{id:'pb-'+'c'.repeat(64)},[wordpress],async()=>{saved++});
 assert.equal(changed,true);assert.equal(journal[wordpress.key],undefined);assert.equal(journal.other.state,'uncertain');assert.equal(saved,1);
});
