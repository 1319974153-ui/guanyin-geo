import test from 'node:test';
import assert from 'node:assert/strict';
import {publishReadiness,dispatchArticle} from '../src/publish-dispatch-core.js';
const article={id:'a',brandId:'b',status:'已审核',title:'项目资料整理方法',text:'用一份明确的交付清单核对资料。',ai:true};
const target=(platform,extra={})=>({key:platform+':one',platform,accountId:'one',name:'自己的账号',modes:['prepare','draft','publish'],...extra});

test('all selected destinations report their own missing material before any network action',()=>{
 const targets=[target('csdn'),target('douyin'),target('toutiao')],copy=JSON.stringify({article,targets});
 const result=publishReadiness({article:{...article,title:'长'.repeat(31),text:'正'.repeat(1001)},targets,mode:'publish'});
 assert.equal(result.canSend,false);assert.deepEqual(result.rows.map(row=>row.status),['needs_input','needs_input','needs_input']);
 assert.match(result.rows[0].issues.join('；'),/标签/);
 assert.match(result.rows[1].issues.join('；'),/20 字/);assert.match(result.rows[1].issues.join('；'),/1000 字/);assert.match(result.rows[1].issues.join('；'),/图片/);
 assert.match(result.rows[2].issues.join('；'),/30 字/);
 assert.equal(JSON.stringify({article,targets}),copy);
});
test('account identity and supported mode remain authoritative; implemented code is not permission',()=>{
 const result=publishReadiness({article,targets:[target('wordpress'),target('aliyun',{loginRequired:true}),target('oschina',{modes:['prepare'],actionEvidence:{publish:{implemented:true,liveAcceptance:'pending'}}}),target('future',{implementation:'planned'})],mode:'publish'});
 assert.deepEqual(result.rows.map(row=>row.status),['ready','needs_login','unavailable','unavailable']);
 assert.match(result.rows[2].issues[0],/未完成真实账号验收/);assert.equal(result.readyCount,1);assert.equal(result.canSend,false);
 assert.equal(publishReadiness({article,targets:[target('wordpress')]}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('wordpress',{accountId:''})]}).canSend,false);
});
test('checks use each adapter limit and Unicode code points without shortening a draft',()=>{
 const input={...article,title:'😀'.repeat(20),text:'a'.repeat(1000)},media=[{sha256:'a'.repeat(64)}];
 assert.equal(publishReadiness({article:input,targets:[target('douyin')],media}).canSend,true);
 const tooLong=publishReadiness({article:{...input,title:input.title+'字'},targets:[target('douyin')],media});
 assert.equal(tooLong.canSend,false);assert.match(tooLong.rows[0].issues[0],/当前 21 字/);assert.equal(input.title,'😀'.repeat(20));
 assert.equal(publishReadiness({article:input,targets:[target('wordpress')]}).canSend,true);
});
test('CSDN labels do not become requirements for other platforms; photo policies differ by action',()=>{
 assert.equal(publishReadiness({article,targets:[target('zhihu')],tags:['x','x']}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('csdn')],tags:['x','x']}).canSend,false);
 assert.equal(publishReadiness({article,targets:[target('csdn')],tags:['软件测试']}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('51cto')],mode:'draft'}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('51cto')],mode:'prepare',media:[{}]}).canSend,false);
 assert.equal(publishReadiness({article,targets:[target('51cto')],mode:'draft',media:[{}]}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('xiaohongshu')],media:Array(10).fill({})}).canSend,false);
});
test('common missing content and unfinished image reads block only a new explicit send',()=>{
 const result=publishReadiness({article:{title:' ',text:''},targets:[target('wordpress')],mediaLoading:true});
 assert.equal(result.generalIssues.length,3);assert.equal(result.canSend,false);
 assert.equal(publishReadiness({article,targets:[]}).canSend,false);
 assert.equal(publishReadiness({article,targets:[target('wordpress')],mode:'unknown'}).canSend,false);
});
test('failed selected images cannot silently become a text-only send',()=>{
 const failed=publishReadiness({article,targets:[target('51cto')],mode:'publish',mediaError:'图片读取失败'});
 assert.equal(failed.canSend,false);assert.match(failed.generalIssues[0],/重新选择图片.*清空图片/);
 assert.equal(publishReadiness({article,targets:[target('51cto')],mode:'publish',mediaError:''}).canSend,true);
 assert.equal(publishReadiness({article,targets:[target('douyin')],mode:'publish',mediaError:''}).canSend,false);
});
test('dispatch sends CSDN tags only to CSDN and preserves other target payloads',async()=>{
 const requests=[],journal={};
 await dispatchArticle({article:{...article,tags:['验收']},targets:[target('csdn'),target('toutiao')],mode:'draft',journal,request:async(path,init)=>{requests.push({path,body:JSON.parse(init.body)});return {job:{id:'job-'+requests.length,state:'queued'}}},persist:async()=>{},assertScope:()=>{}});
 assert.equal(requests.length,2);assert.deepEqual(requests[0].body.tags,['验收']);assert.deepEqual(requests[1].body.tags,[]);
});

test('saved pictures require current rights, exact order and a media-capable destination',()=>{
 const ref=(n,rightsConfirmed=true)=>({id:'am-'+String(n).repeat(64),sha256:String(n).repeat(64),rightsConfirmed});
 const saved={...article,mediaRefs:[ref(1),ref(2)],mediaVersion:1},media=[{sha256:ref(1).sha256},{sha256:ref(2).sha256}];
 assert.equal(publishReadiness({article:saved,targets:[target('51cto')],media}).canSend,true);
 for(const variant of [[],[...media].reverse()])assert.equal(publishReadiness({article:saved,targets:[target('51cto')],media:variant}).canSend,false);
 assert.equal(publishReadiness({article:{...saved,mediaRefs:[ref(1,false),ref(2)]},targets:[target('51cto')],media}).canSend,false);
 const unsupported=publishReadiness({article:saved,targets:[target('wordpress')],media});assert.equal(unsupported.canSend,false);assert.match(unsupported.rows[0].issues.join(''),/不支持.*图片/);
});
