import {PLATFORMS} from '../browser-extension/platforms.js';
import {publishingCatalog} from '../src/publishing-catalog.js';
import {publishingEvidence} from '../src/publishing-evidence.js';

// These are the desktop routes with an implementation for public submission.
// A route only becomes an enabled product capability after its own public
// action has passed real-account acceptance. Keeping the candidate list
// separate lets us ship a draft/prepare adapter without accidentally exposing
// an unverified public-submit button in the desktop app.
export const DESKTOP_PUBLIC_CANDIDATES=Object.freeze(['csdn','zhihu','tencentcloud','51cto','aliyun','douyin','weibo','sohu','netease','oschina','jianshu','bilibili','juejin']);
export const DESKTOP_PUBLIC_PLATFORMS=Object.freeze(DESKTOP_PUBLIC_CANDIDATES.filter(id=>{
 const action=publishingEvidence(id).publish;
 return action.implemented&&action.liveAcceptance==='passed'&&PLATFORMS[id]?.publishSupported!==false;
}));
export function desktopBuildCapabilities(){
 const catalog=publishingCatalog();
 const publicPublishingPlatforms=catalog.filter(p=>p.actionEvidence.publish.implemented&&(
  ['wordpress','cnblogs','typecho','metaweblog','personal-site'].includes(p.id)||DESKTOP_PUBLIC_PLATFORMS.includes(p.id)&&PLATFORMS[p.id]&&PLATFORMS[p.id].publishSupported!==false
 )).map(p=>p.id);
 return {preview:true,publicPublishingEnabled:true,publicPublishingPlatforms,
  draftOnlyPlatforms:Object.entries(PLATFORMS).filter(([id,p])=>p.draftProtocol&&!publicPublishingPlatforms.includes(id)).map(([id])=>id),
  publicPublishingLiveAcceptance:'per-platform-see-delivery-record',
  platformEvidence:catalog.map(p=>({id:p.id,stage:p.stage,actions:Object.fromEntries(Object.entries(p.actionEvidence).map(([a,v])=>[a,{implemented:v.implemented,liveAcceptance:v.liveAcceptance}]))}))};
}
