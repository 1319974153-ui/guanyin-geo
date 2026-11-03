// HTTP headers must be ASCII. Keep the actual Chromium/Electron versions and
// an explicit application identity; only replace the Chinese product token.
export function asciiProductUserAgent(value){
 return String(value).replace(/[^\x20-\x7e]+/g,'GuanyinGEO');
}
