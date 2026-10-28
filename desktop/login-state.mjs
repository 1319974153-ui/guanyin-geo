// Read visible login warnings only. No cookies, network calls or form actions.
// Kept self-contained because the desktop driver runs this bundled function.
export function readLoginWarning() {
 const selectors='[role="alert"],[role="dialog"],.ant-message,.ant-notification,[class*="toast"],[class*="Toast"],[class*="error"],[class*="Error"]';
 const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
 const texts=[...document.querySelectorAll(selectors)].filter(visible).map(el=>el.innerText||'');
 // A full-page rejection can have no alert wrapper. Never inspect editor text.
 if(!document.querySelector('[contenteditable="true"],textarea:not([placeholder*="验证码"])'))texts.push(document.body?.innerText||'');
 return texts.some(t=>/(?:访问|操作|请求|登录|扫码|尝试)(?:过于|太|过)?频繁|请求次数过多|尝试次数过多|too many (?:requests|attempts)|rate limit(?:ed| exceeded)/i.test(t))?'rate_limited':null;
}

export const LOGIN_RATE_LIMIT_MESSAGE='平台提示访问过于频繁，已暂停自动检查。请等待平台恢复后再点击去登录；不会自动刷新或重试。';

// Exact observed sign-in routes, never article text or a broad subdomain match.
export function loginPageRequired(platform,value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
  if(platform==='aliyun')return u.hostname==='account.aliyun.com'&&['/login/login.htm','/login/login_aliyun.htm'].includes(u.pathname)||u.hostname==='passport.aliyun.com'&&u.pathname==='/havanaone/login/login.htm';
  if(platform==='zhihu')return u.hostname==='www.zhihu.com'&&u.pathname==='/signin';
  if(platform==='csdn')return u.hostname==='passport.csdn.net'&&u.pathname==='/login';
  return false;
 }catch{return false}
}
export const LOGIN_EXPIRED_MESSAGE='平台登录已失效，请在已打开的官方窗口登录；完成后观引自动继续核对，不需要重新添加账号。';
