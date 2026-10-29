import test from 'node:test';import assert from 'node:assert/strict';
import {desktopDataRoot} from '../desktop/data-root.mjs';
test('packaged update preserves the default profile and ignores development data overrides',()=>{
 const input={appData:'/test/appdata',isPackaged:true,env:{GUANYIN_DESKTOP_DATA:'/developer/data'}};
 assert.equal(desktopDataRoot(input),'/test/appdata/GuanyinGEO-Desktop-Preview');
 assert.equal(desktopDataRoot({...input,args:['--guanyin-profile=clean-acceptance']}),'/test/appdata/GuanyinGEO-Desktop-Profiles/clean-acceptance');
 assert.notEqual(desktopDataRoot({...input,args:['--guanyin-profile=other']}),desktopDataRoot({...input,args:['--guanyin-profile=clean-acceptance']}));
});
test('named profile cannot escape its storage root or accept ambiguous input',()=>{
 for(const name of ['','../default','/tmp/data','a/b','a\\b','a'.repeat(65)])assert.throws(()=>desktopDataRoot({appData:'/test',args:['--guanyin-profile='+name]}));
 assert.throws(()=>desktopDataRoot({appData:'/test',args:['--guanyin-profile=one','--guanyin-profile=two']}));
});
