import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {publicProof} from '../desktop/public-proof.mjs';
const job={platform:'tencentcloud',mode:'publish',state:'submitted',attempted:true,receipt:{url:'https://cloud.tencent.com/developer/article/123',articleId:'123'},snapshot:{title:'标题',html:'<p>正文</p>',ai:false}};
function harness({fail=false,html}={}){const record={};const isolated={setPermissionRequestHandler(fn){record.permission=fn},setPermissionCheckHandler(fn){record.check=fn},async clearStorageData(){record.cleared=true}};class Window{constructor(options){record.options=options;this.dead=false;const wc=this.webContents=new EventEmitter();wc.setWindowOpenHandler=fn=>record.popup=fn;wc.loadURL=async url=>{record.url=url;if(fail)throw Error('offline')};wc.getURL=()=>record.url;wc.executeJavaScript=async()=>html||'<h1 class="title-text">标题</h1><div class="mod-content__markdown"><p>正文</p></div>';record.wc=wc}isDestroyed(){return this.dead}destroy(){this.dead=true;record.destroyed=true}};return {record,api:{BrowserWindow:Window,session:{fromPartition(name,options){record.partition=name;record.cache=options.cache;return isolated}}}}}
test('desktop public verification uses isolated ephemeral session and disposes it',async()=>{const {record:r,api}=harness();assert.equal(await publicProof(api,job),true);assert.ok(!r.partition.startsWith('persist:'));assert.equal(r.options.webPreferences.nodeIntegration,false);assert.equal(r.options.webPreferences.sandbox,true);assert.equal(r.check(),false);assert.deepEqual(r.popup(),{action:'deny'});let prevented=false;r.wc.emit('will-redirect',{preventDefault(){prevented=true}},'https://evil.test');assert.equal(prevented,true);assert.equal(r.destroyed,true);assert.equal(r.cleared,true)});
test('network failure cannot promote receipt; invalid receipt opens no window',async()=>{const {record:r,api}=harness({fail:true});assert.equal(await publicProof(api,job),false);assert.equal(r.destroyed,true);assert.equal(r.cleared,true);const h=harness();assert.equal(await publicProof(h.api,{...job,receipt:{url:'https://evil.test',articleId:'123'}}),false);assert.equal(h.record.url,undefined)});

for(const platform of ['csdn','zhihu'])test(`${platform} proof opens the exact public URL in an anonymous session`,async()=>{
 const article={...job,platform,accountId:'writer',receipt:{url:platform==='csdn'?'https://mp.csdn.net/mp_blog/creation/success/123':'https://zhuanlan.zhihu.com/p/123',articleId:'123'}};
 const html=platform==='csdn'?'<h1 id="articleContentId">标题</h1><div id="content_views"><p>正文</p></div>':'<h1 class="Post-Title">标题</h1><div class="Post-RichText"><p>正文</p></div><span class="AuthorInfo-name"><a class="UserLink-link" href="//www.zhihu.com/people/writer">作者</a></span>';
 const {api,record:r}=harness({html});assert.equal(await publicProof(api,article),true);
 assert.equal(r.url,platform==='csdn'?'https://blog.csdn.net/writer/article/details/123':'https://zhuanlan.zhihu.com/p/123');assert.equal(r.cache,false);assert.equal(r.cleared,true);
 const h=harness();assert.equal(await publicProof(h.api,{...article,accountId:'other/../writer'}),false);assert.equal(h.record.url,undefined);
});

test('Aliyun requires the original public article, the account profile and its full body',async()=>{
 const original={...job,platform:'aliyun',accountId:'writer1',receipt:{url:'https://developer.aliyun.com/article/123',articleId:'123'}};
 const html='<h1 class="article-title">标题</h1><div class="article-inner markdown-body"><p>正文</p></div><a class="aigc-fixed-left-name" href="/profile/writer1">作者</a>';
 const h=harness({html});assert.equal(await publicProof(h.api,original),true);
 const {articlePublicMatches}=await import('../local/article-public.mjs');
 assert.equal(articlePublicMatches(html,{...original,accountId:'other'}),false);
 assert.equal(articlePublicMatches(html,{...original,snapshot:{...original.snapshot,html:'<p>正文增加一段</p>'}}),false);
});

test('掘金公开回执绑定平台编号、作者、完整正文和原稿的 AI 声明',async()=>{
 const {articlePublicMatches,articlePublicUrl}=await import('../local/article-public.mjs');
 const original={...job,platform:'juejin',accountId:'123',receipt:{url:'https://juejin.cn/post/456',articleId:'456'},snapshot:{...job.snapshot,ai:true}};
 const html='<h1 class="article-title">标题</h1><a class="jj-link username" href="/user/123/posts">作者</a><div class="article-viewer markdown-body"><p>正文</p><p>本文包含 AI 辅助生成或整理的内容。</p></div>';
 assert.ok(await publicProof(harness({html}).api,original));
 for(const item of [html.replace('/123/','/124/'),html.replace('正文','别的正文'),html.replace('本文包含 AI 辅助生成或整理的内容。',''),html.replace('</div>','<img src="image.png"></div>')])assert.equal(articlePublicMatches(item,original),false);
 for(const url of ['https://juejin.cn/editor/drafts/456','https://juejin.cn/post/457','https://juejin.cn/post/456?from=editor'])assert.equal(articlePublicUrl({...original,receipt:{...original.receipt,url}}),null);
});

test('SegmentFault only checks the linked article for a submitted job and uses a separate anonymous session',async()=>{
 const url='https://segmentfault.com/a/1190000020142376',articleId='1190000020142376';
 const original={...job,platform:'segmentfault',accountId:'author',receipt:{url,articleId}};
 const {api,record}=harness({html:{url,articleId,accountId:'author',contentVerified:true}});
 assert.equal(await publicProof(api,original),true);assert.equal(record.url,url);assert.equal(record.cache,false);assert.equal(record.cleared,true);
 const wrong=harness();assert.equal(await publicProof(wrong.api,{...original,receipt:{url,articleId:'123'}}),false);assert.equal(wrong.record.url,undefined);
});
