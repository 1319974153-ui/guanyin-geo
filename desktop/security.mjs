import {createHash} from 'node:crypto';
export const DESKTOP_PLATFORMS=['csdn','toutiao','zhihu'];
const sites={csdn:['csdn.net'],toutiao:['toutiao.com','toutiaoimg.com','byteacct.com'],zhihu:['zhihu.com']};
export function navigationAllowed(platform,value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(sites[platform]||[]).some(d=>u.hostname===d||u.hostname.endsWith('.'+d))}catch{return false}}
export function trustedFrame(event,contents,origin){try{return event.sender===contents&&event.senderFrame===contents.mainFrame&&new URL(event.senderFrame.url).origin===origin}catch{return false}}
export function connectionPartition(id){if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw new Error('无效连接');return 'persist:guanyin-'+createHash('sha256').update(id).digest('hex')}
export function connectionInput(value){if(!value||typeof value.brandId!=='string'||!/^[-\w]{1,100}$/.test(value.brandId)||!DESKTOP_PLATFORMS.includes(value.platform))throw new Error('请选择当前品牌和已接入平台');return {brandId:value.brandId,platform:value.platform}}
export function targetInput(value){if(!Array.isArray(value)||!value.length||value.length>3)throw new Error('请选择已登录的平台');return value.map(t=>{if(!t||typeof t.sessionId!=='string'||!/^[-\w]{1,100}$/.test(t.sessionId)||typeof t.accountId!=='string'||!/^[-\w]{1,100}$/.test(t.accountId))throw new Error('账号信息无效');return {sessionId:t.sessionId,accountId:t.accountId}})}

export const LOGIN_URLS={csdn:'https://mp.csdn.net/mp_blog/manage/article',toutiao:'https://mp.toutiao.com/',zhihu:'https://www.zhihu.com/signin'};
export function loginReturned(platform,value){try{const u=new URL(value);if(!navigationAllowed(platform,value))return false;
 if(platform==='csdn')return u.hostname==='mp.csdn.net'&&u.pathname.startsWith('/mp_blog/')&&!u.pathname.includes('/creation/editor');
 if(platform==='toutiao')return u.hostname==='mp.toutiao.com'&&u.pathname.startsWith('/profile_v4')&&!u.pathname.includes('/graphic/publish');
 return platform==='zhihu'&&u.hostname==='www.zhihu.com'&&['/','/creator','/creator/'].includes(u.pathname);
}catch{return false}}
