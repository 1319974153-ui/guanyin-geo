// Observe critical static-resource failures, never cookies, headers, request
// bodies or token-bearing URLs. No retries, redirects or proxy changes.
const roots = {
 'unpkg.byted-static.com': ['/react/', '/react-dom/', '/systemjs/', '/byted/creator-browser-check/'],
 'lf-c-flwb.bytetos.com': ['/obj/rc-client-security/web/glue/'],
 'lf-security.bytegoofy.com': ['/obj/security-secsdk/'],
};
export function criticalResourceFailure(platform, details) {
 if (platform !== 'douyin' || details?.resourceType !== 'script' || !/^net::ERR_[A-Z_]+$/.test(details.error || '') || details.error === 'net::ERR_ABORTED') return null;
 let u; try { u = new URL(details.url); } catch { return null; }
 if (u.protocol !== 'https:' || u.username || u.password || u.port || !roots[u.hostname]?.some(p => u.pathname.startsWith(p))) return null;
 return `抖音基础组件加载失败（${u.hostname}，${details.error.slice(5)}）。请检查网络或 VPN 分流；账号和原稿保留，网络恢复后点“重试连接”，无需重新发送验证码。`;
}
export function observeResourceHealth(browserSession, platform, findWindow, report) {
 const failures = new Map();
 const handler = details => {
  const error = criticalResourceFailure(platform, details), target = findWindow(details.webContentsId);
  if (!error || !target || target.win.isDestroyed()) return;
  if (failures.has(target.id)) return;
  failures.set(target.id, error);
  if (target.win.isVisible()) report(error);
 };
 // One window driver owns each account's partition, so there is one listener.
 if(platform === 'douyin') browserSession.webRequest?.onErrorOccurred(handler);
 return {get:id=>failures.get(id), reset:id=>failures.delete(id), close(){failures.clear();if(platform === 'douyin')browserSession.webRequest?.onErrorOccurred(null);}};
}
