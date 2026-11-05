import {flushSessionStore} from './session-store.mjs';

// A stable, isolated Chromium partition. The app never reads or exports its
// cookies; this helper only asks Chromium to persist the account holder's own
// session before the visible window is closed.
export const WECHAT_PERSONAL_PARTITION='persist:guanyin-wechat-personal';

export async function persistWechatPersonalSession(browserSession){
 await flushSessionStore(browserSession);
}
