import path from 'node:path';
// An explicit named profile permits clean-package checks without copying customer sessions.
// Default installs retain the original data location across application updates.
export function desktopDataRoot({args=[],env={},isPackaged=true,appData}){
 const profiles=args.filter(a=>a.startsWith('--guanyin-profile='));
 if(profiles.length>1)throw Error('观引资料目录参数重复');
 if(profiles.length){
  const name=profiles[0].slice('--guanyin-profile='.length);
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw Error('观引资料目录名称仅支持小写英文、数字和连字符');
  return path.join(appData,'GuanyinGEO-Desktop-Profiles',name);
 }
 return !isPackaged&&env.GUANYIN_DESKTOP_DATA?path.resolve(env.GUANYIN_DESKTOP_DATA):path.join(appData,'GuanyinGEO-Desktop-Preview');
}
