// Shared connector contract; this module has no browser globals or secrets.
export const PLATFORMS = {
 aliyun:{name:'阿里云开发者社区',publishSupported:true,draftProtocol:1,editor:'https://developer.aliyun.com/article/new',hosts:['https://developer.aliyun.com/*'],titleMax:100,textMax:100000,images:0,desktopOnly:true},
 '51cto':{name:'51CTO',draftProtocol:5,editor:'https://blog.51cto.com/blogger/publish?old=1',hosts:['https://blog.51cto.com/*'],titleMax:100,textMax:100000,images:9,optionalImages:true,desktopOnly:true},
 tencentcloud:{name:'腾讯云开发者社区',draftProtocol:4,editor:'https://cloud.tencent.com/developer/article/write-new',hosts:['https://cloud.tencent.com/*'],titleMax:80,textMax:100000,images:0,desktopOnly:true},
 csdn:{name:'CSDN',draftProtocol:3,editor:'https://mp.csdn.net/mp_blog/creation/editor',hosts:['https://mp.csdn.net/*'],titleMax:100,textMax:100000,images:0,tagsRequired:true},
 toutiao:{name:'头条',draftProtocol:2,editor:'https://mp.toutiao.com/profile_v4/graphic/publish',hosts:['https://mp.toutiao.com/*'],titleMax:30,textMax:100000,images:0},
 zhihu:{name:'知乎',draftProtocol:1,editor:'https://zhuanlan.zhihu.com/write',hosts:['https://zhuanlan.zhihu.com/*','https://www.zhihu.com/*'],titleMax:100,textMax:100000,images:0},
 douyin:{name:'抖音图文',editor:'https://creator.douyin.com/creator-micro/content/upload',hosts:['https://creator.douyin.com/*'],titleMax:30,textMax:1000,images:9},
 xiaohongshu:{name:'小红书图文',editor:'https://creator.xiaohongshu.com/publish/publish?source=official',hosts:['https://creator.xiaohongshu.com/*'],titleMax:20,textMax:1000,images:9}
};
export function platformConfig(id='csdn'){const value=PLATFORMS[id];if(!value)throw new Error('不支持的发布平台');return value;}
export function editorEvidence(platform,url){
 try{const u=new URL(url),p=platformConfig(platform);if(u.origin!==new URL(p.editor).origin||u.username||u.password||u.hash&&!(platform==='aliyun'&&u.hash==='#/'))return false;
 if(platform==='aliyun')return u.pathname==='/article/new'&&(!u.search||u.searchParams.size===1&&/^[1-9]\d{0,19}$/.test(u.searchParams.get('edit')));
 if(platform==='51cto')return u.pathname==='/blogger/publish'&&u.search==='?old=1'||/^\/blogger\/draft\/[1-9]\d{0,19}$/.test(u.pathname)&&!u.search;
 if(platform==='tencentcloud')return u.pathname==='/developer/article/write-new'&&(!u.search||u.searchParams.size===1&&/^[1-9]\d{0,19}$/.test(u.searchParams.get('draftId')));
 if(platform==='csdn')return /^\/mp_blog\/creation\/editor(?:\/[1-9]\d{0,29})?$/.test(u.pathname)&&!u.search;
 if(platform==='toutiao')return u.pathname==='/profile_v4/graphic/publish';
 if(platform==='zhihu')return u.pathname==='/write'||/^\/p\/\d+\/edit$/.test(u.pathname);
 if(platform==='douyin')return ['/creator-micro/content/upload','/creator-micro/content/post/image'].includes(u.pathname);
 return u.pathname==='/publish/publish';
 }catch{return false}
}
// Accept only observed platform-owned article URLs, never a generic dashboard/success toast.
export function receiptEvidence(platform,url,articleId){
 try{const u=new URL(url);if(u.username||u.password||u.hash)return false;let m;
 if(platform==='aliyun')return u.origin==='https://developer.aliyun.com'&&!u.search&&(m=u.pathname.match(/^\/article\/([1-9]\d{0,19})$/))&&m[1]===String(articleId);
 if(platform==='51cto')return u.origin==='https://blog.51cto.com'&&!u.search&&(m=u.pathname.match(/^\/blogger\/success\/([1-9]\d{0,19})$/))&&m[1]===String(articleId);
 if(platform==='tencentcloud')return u.origin==='https://cloud.tencent.com'&&!u.search&&(m=u.pathname.match(/^\/developer\/article\/([1-9]\d{0,19})$/))&&m[1]===String(articleId);
 if(platform==='csdn')return u.origin==='https://mp.csdn.net'&&!u.search&&(m=u.pathname.match(/^\/mp_blog\/creation\/success\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='toutiao')return ['https://www.toutiao.com','https://toutiao.com'].includes(u.origin)&&(m=u.pathname.match(/^\/article\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='zhihu')return u.origin==='https://zhuanlan.zhihu.com'&&(m=u.pathname.match(/^\/p\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='douyin')return u.origin==='https://www.douyin.com'&&(m=u.pathname.match(/^\/(?:video|note)\/(\d+)\/?$/))&&m[1]===String(articleId);
 return platform==='xiaohongshu'&&u.origin==='https://www.xiaohongshu.com'&&(m=u.pathname.match(/^\/explore\/([a-fA-F0-9]{24})\/?$/))&&m[1]===String(articleId);
 }catch{return false}
}

// A preparation checkpoint is an editor location, never proof of platform storage/publication.
export function preparationEditorUrl(platform,url){
 try{
  const u=new URL(url);if(u.username||u.password||!editorEvidence(platform,u.href))return null;
  const base=u.origin+u.pathname;
  if(platform==='aliyun')return base+u.search;
  if(['tencentcloud','51cto'].includes(platform))return u.href;
  if(platform!=='toutiao'||!u.searchParams.has('pgc_id'))return base;
  const ids=u.searchParams.getAll('pgc_id');
  if(ids.length!==1||!/^[1-9]\d{0,29}$/.test(ids[0]))return null;
  return base+'?pgc_id='+ids[0];
 }catch{return null}
}
export function preparationEvidence(platform,value){
 try{if(!value||value.contentVerified!==true)return null;
 const editorUrl=preparationEditorUrl(platform,value.evidenceUrl);if(!editorUrl)return null;
 return {editorUrl,accountId:value.accountId};
 }catch{return null}
}

export function supportsDraftProtocol(platform,version){return Number.isInteger(version)&&version>0&&PLATFORMS[platform]?.draftProtocol===version;}

// Draft destinations are editor URLs, never public article receipts.
export function draftEvidence(platform,value){
 try{
  if(!value||value.savedVerified!==true||value.contentVerified!==true)return null;
  if(platform==='aliyun'){const u=new URL(value.url),id=u.searchParams.get('edit');if(!editorEvidence(platform,u.href)||!id||id!==String(value.articleId))return null;return {url:u.origin+u.pathname+u.search,articleId:id,accountId:value.accountId,savedVerified:true,contentVerified:true,verification:'draft_list_and_reopened_content'};}
  if(platform==='51cto'){const u=new URL(value.url),m=u.pathname.match(/^\/blogger\/draft\/([1-9]\d{0,19})$/);if(!editorEvidence(platform,u.href)||u.username||u.password||!m||m[1]!==String(value.articleId))return null;return {url:u.href,articleId:m[1],accountId:value.accountId,savedVerified:true,contentVerified:true,verification:'draft_list_and_reopened_content',...(value.mediaProof?{mediaProof:value.mediaProof}:{})};}
  if(platform==='tencentcloud'){const u=new URL(value.url),id=u.searchParams.get('draftId');if(!editorEvidence(platform,u.href)||u.username||u.password||!id||id!==String(value.articleId))return null;return {url:u.href,articleId:id,accountId:value.accountId,savedVerified:true,contentVerified:true,...(value.verification==='draft_list_and_reopened_content'?{verification:value.verification}:{})};}
  if(platform==='toutiao'){
   const url=preparationEditorUrl(platform,value.url);if(!url||url!==value.url)return null;
   const id=new URL(url).searchParams.get('pgc_id');if(!id||id!==String(value.articleId))return null;
   return {url,articleId:id,accountId:value.accountId,savedVerified:true,contentVerified:true};
  }
  if(platform==='csdn'){
   const u=new URL(value.url),m=u.pathname.match(/^\/mp_blog\/creation\/editor\/([1-9]\d{0,29})$/);
   if(u.origin!=='https://mp.csdn.net'||u.username||u.password||u.search||u.hash||!m||m[1]!==String(value.articleId))return null;
   return {url:u.href,articleId:m[1],accountId:value.accountId,savedVerified:true,contentVerified:true,...(value.verification==='draft_list_and_reopened_content'?{verification:value.verification}:{})};
  }
  if(platform!=='zhihu')return null;
  const u=new URL(value.url),m=u.pathname.match(/^\/p\/(\d+)\/edit$/);
  if(u.origin!=='https://zhuanlan.zhihu.com'||u.username||u.password||u.search||u.hash||!m||m[1]!==String(value.articleId))return null;
  return {url:u.href,articleId:m[1],accountId:value.accountId,savedVerified:true,contentVerified:true};
 }catch{return null}
}

// Immutable upload lineage: bind ordered source hashes to the platform's uploaded assets.
export function fiftyoneMediaProof(value,media=[]){
 if(!Array.isArray(value)||value.length!==media.length||value.length>9)return null;
 try{return value.map((p,i)=>{const u=new URL(p.url);if(u.protocol!=='https:'||!/^s[12]\.51cto\.com$/.test(u.hostname)||u.port||u.username||u.password||!u.pathname.startsWith('/images/')||p.sha256!==media[i].sha256||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error();return {sha256:p.sha256,url:u.origin+u.pathname}})}catch{return null}
}
export function fiftyonePublicUrl(job){
 if(job.platform!=='51cto'||job.mode!=='publish'||!job.attempted||!['submitted','published'].includes(job.state)||!/^[1-9]\d{0,19}$/.test(job.accountId)||!receiptEvidence('51cto',job.receipt?.url,job.receipt?.articleId))return null;
 return 'https://blog.51cto.com/u_'+job.accountId+'/'+job.receipt.articleId;
}
