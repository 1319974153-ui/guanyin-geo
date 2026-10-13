import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate as next} from 'node:timers/promises';import {localControl} from '../local/control.mjs';
test('local shutdown requires this instance secret and rejects browser origins without disclosing its token',async()=>{let stops=0;const invoke=(url,method,headers={})=>{const r={status:200,setHeader(){},writeHead(n){this.status=n},end(s){this.body=s}};const used=localControl({url,method,headers},r,{token:'test-only-instance-secret',instance:'g_test',shutdown:()=>stops++});return {...r,used}};
 assert.equal(invoke('/api/state','GET').used,false);const h=invoke('/__local/health','GET');assert.equal(JSON.parse(h.body).instance,'g_test');assert.ok(!h.body.includes('test-only-instance-secret'));
 for(const headers of [{},{authorization:'Bearer wrong'},{authorization:'Bearer test-only-instance-secret',origin:'https://evil.example'}])assert.equal(invoke('/__local/stop','POST',headers).status,403);
 assert.equal(stops,0);assert.equal(invoke('/__local/stop','POST',{authorization:'Bearer test-only-instance-secret'}).status,200);await next();assert.equal(stops,1);
});
