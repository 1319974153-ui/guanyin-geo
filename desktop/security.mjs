import {aliyunLoginRelay} from './platform-preview.mjs';
import {createHash} from 'node:crypto';
export const DESKTOP_PLATFORMS=['csdn','toutiao','zhihu','douyin','xiaohongshu','tencentcloud','51cto','aliyun'];
const sites={aliyun:['developer.aliyun.com','account.aliyun.com','signin.aliyun.com','passport.aliyun.com'],'51cto':['blog.51cto.com','home.51cto.com'],tencentcloud:['cloud.tencent.com'],csdn:['csdn.net'],toutiao:['toutiao.com','toutiaoimg.com','byteacct.com'],zhihu:['zhihu.com'],douyin:['douyin.com'],xiaohongshu:['xiaohongshu.com']};
export function navigationAllowed(platform,value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&((platform==='aliyun'?sites.aliyun.includes(u.hostname)||aliyunLoginRelay(value):(sites[platform]||[]).some(d=>u.hostname===d||u.hostname.endsWith('.'+d))))}catch{return false}}
export function trustedFrame(event,contents,origin){try{return event.sender===contents&&event.senderFrame===contents.mainFrame&&new URL(event.senderFrame.url).origin===origin}catch{return false}}
export function connectionPartition(id){if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw new Error('无效连接');return 'persist:guanyin-'+createHash('sha256').update(id).digest('hex')}
export function connectionInput(value){if(!value||typeof value.brandId!=='string'||!/^[-\w]{1,100}$/.test(value.brandId)||!DESKTOP_PLATFORMS.includes(value.platform))throw new Error('请选择当前品牌和已接入平台');return {brandId:value.brandId,platform:value.platform}}
export function targetInput(value){if(!Array.isArray(value)||!value.length||value.length>DESKTOP_PLATFORMS.length)throw new Error('请选择已登录的平台');return value.map(t=>{if(!t||typeof t.sessionId!=='string'||!/^[-\w]{1,100}$/.test(t.sessionId)||typeof t.accountId!=='string'||!/^[-\w]{1,100}$/.test(t.accountId))throw new Error('账号信息无效');return {sessionId:t.sessionId,accountId:t.accountId}})}

export const LOGIN_URLS={aliyun:'https://developer.aliyun.com/article/new','51cto':'https://blog.51cto.com/blogger/publish?old=1',tencentcloud:'https://cloud.tencent.com/developer/article/write-new',csdn:'https://mp.csdn.net/mp_blog/manage/article',toutiao:'https://mp.toutiao.com/',zhihu:'https://www.zhihu.com/signin',douyin:'https://creator.douyin.com/',xiaohongshu:'https://creator.xiaohongshu.com/'};
export function loginReturned(platform,value){try{const u=new URL(value);if(!navigationAllowed(platform,value))return false;
 if(platform==='aliyun')return u.hostname==='developer.aliyun.com'&&['/','/my'].includes(u.pathname);
 if(platform==='51cto')return u.hostname==='home.51cto.com'&&['/info','/index'].includes(u.pathname)||u.hostname==='blog.51cto.com'&&u.pathname==='/creative-center/index';
 if(platform==='csdn')return u.hostname==='mp.csdn.net'&&u.pathname.startsWith('/mp_blog/')&&!u.pathname.includes('/creation/editor');
 if(platform==='toutiao')return u.hostname==='mp.toutiao.com'&&u.pathname.startsWith('/profile_v4')&&!u.pathname.includes('/graphic/publish');
 if(platform==='xiaohongshu')return u.hostname==='creator.xiaohongshu.com'&&['/','/new/home'].includes(u.pathname);
 if(platform==='douyin')return u.hostname==='creator.douyin.com'&&u.pathname==='/creator-micro/home';
 return platform==='zhihu'&&u.hostname==='www.zhihu.com'&&['/','/creator','/creator/'].includes(u.pathname);
}catch{return false}}
