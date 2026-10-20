// Shared connector contract; this module has no browser globals or secrets.
export const PLATFORMS = {
 csdn:{name:'CSDN',editor:'https://mp.csdn.net/mp_blog/creation/editor',hosts:['https://mp.csdn.net/*'],titleMax:100,textMax:100000,images:0,tagsRequired:true},
 toutiao:{name:'头条',editor:'https://mp.toutiao.com/profile_v4/graphic/publish',hosts:['https://mp.toutiao.com/*'],titleMax:30,textMax:100000,images:0},
 zhihu:{name:'知乎',editor:'https://zhuanlan.zhihu.com/write',hosts:['https://zhuanlan.zhihu.com/*','https://www.zhihu.com/*'],titleMax:100,textMax:100000,images:0},
 douyin:{name:'抖音图文',editor:'https://creator.douyin.com/creator-micro/content/upload',hosts:['https://creator.douyin.com/*'],titleMax:30,textMax:1000,images:9},
 xiaohongshu:{name:'小红书图文',editor:'https://creator.xiaohongshu.com/publish/publish?source=official',hosts:['https://creator.xiaohongshu.com/*'],titleMax:20,textMax:1000,images:9}
};
export function platformConfig(id='csdn'){const value=PLATFORMS[id];if(!value)throw new Error('不支持的发布平台');return value;}
export function editorEvidence(platform,url){
 try{const u=new URL(url),p=platformConfig(platform);if(u.origin!==new URL(p.editor).origin||u.hash)return false;
 if(platform==='csdn')return u.pathname==='/mp_blog/creation/editor'&&!u.search;
 if(platform==='toutiao')return u.pathname==='/profile_v4/graphic/publish';
 if(platform==='zhihu')return u.pathname==='/write'||/^\/p\/\d+\/edit$/.test(u.pathname);
 if(platform==='douyin')return ['/creator-micro/content/upload','/creator-micro/content/post/image'].includes(u.pathname);
 return u.pathname==='/publish/publish';
 }catch{return false}
}
// Accept only observed platform-owned article URLs, never a generic dashboard/success toast.
export function receiptEvidence(platform,url,articleId){
 try{const u=new URL(url);if(u.username||u.password||u.hash)return false;let m;
 if(platform==='csdn')return u.origin==='https://mp.csdn.net'&&!u.search&&(m=u.pathname.match(/^\/mp_blog\/creation\/success\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='toutiao')return ['https://www.toutiao.com','https://toutiao.com'].includes(u.origin)&&(m=u.pathname.match(/^\/article\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='zhihu')return u.origin==='https://zhuanlan.zhihu.com'&&(m=u.pathname.match(/^\/p\/(\d+)\/?$/))&&m[1]===String(articleId);
 if(platform==='douyin')return u.origin==='https://www.douyin.com'&&(m=u.pathname.match(/^\/(?:video|note)\/(\d+)\/?$/))&&m[1]===String(articleId);
 return platform==='xiaohongshu'&&u.origin==='https://www.xiaohongshu.com'&&(m=u.pathname.match(/^\/explore\/([a-fA-F0-9]{24})\/?$/))&&m[1]===String(articleId);
 }catch{return false}
}

// A preparation checkpoint is an editor location, never proof of platform storage/publication.
export function preparationEvidence(platform,value){
 try{if(!value||value.contentVerified!==true||!editorEvidence(platform,value.evidenceUrl))return null;
 const u=new URL(value.evidenceUrl);if(u.username||u.password)return null;
 return {editorUrl:u.origin+u.pathname,accountId:value.accountId};
 }catch{return null}
}
