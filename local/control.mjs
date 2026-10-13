import {createHash,timingSafeEqual} from 'node:crypto';
export function localControl(req,res,{token,instance,shutdown}){
 const pathname=new URL(req.url,'http://localhost').pathname;if(!pathname.startsWith('/__local/'))return false;
 res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
 if(!token){res.writeHead(404);res.end('{}');return true}
 if(pathname==='/__local/health'&&req.method==='GET'){res.end(JSON.stringify({app:'guanyin-geo',instance,controlId:createHash('sha256').update(token).digest('hex')}));return true}
 const expected=Buffer.from('Bearer '+token),provided=Buffer.from(String(req.headers.authorization||''));
 if(pathname==='/__local/stop'&&req.method==='POST'&&provided.length===expected.length&&timingSafeEqual(expected,provided)&&!req.headers.origin){res.end('{"stopping":true}');setImmediate(shutdown);return true}
 res.writeHead(403);res.end('{"error":"本机控制凭据无效"}');return true;
}
