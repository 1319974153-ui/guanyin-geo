import {PLATFORMS} from '../browser-extension/platforms.js';
import {publishingCatalog} from '../src/publishing-catalog.js';
// One desktop gate used both by the actual queue and package metadata.
export const DESKTOP_PUBLIC_PLATFORMS=Object.freeze(['csdn','zhihu','tencentcloud','51cto','aliyun']);
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
