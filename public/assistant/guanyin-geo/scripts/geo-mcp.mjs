import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
export async function requestMcp(config,message,{fetcher=fetch,allowLocal=false}={}){
 const url=new URL(config.url),local=allowLocal&&['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:';
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.pathname!=='/api/v1/mcp'||url.search||url.hash)throw new Error('请配置 HTTPS 的 /api/v1/mcp 完整地址');
 if(!/^geo_[a-f0-9]{64}$/.test(config.apiKey||''))throw new Error('请配置独立的 GEO API Key');
 if(!config.siteAccessToken&&!local)throw new Error('私有站点需要 Sites 服务访问凭据');
 let r;try{r=await fetcher(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',authorization:'Bearer '+config.apiKey,...(config.siteAccessToken?{'OAI-Sites-Authorization':'Bearer '+config.siteAccessToken}:{})},body:JSON.stringify(message),signal:AbortSignal.timeout(90000)})}catch{throw new Error('连接中断；结果不明时查询同一任务 ID，不要另建任务')}
 if(!r.ok)throw new Error('助手连接返回 HTTP '+r.status+'；请检查站点访问授权、Key 权限或配额');
 if(r.status===202)return null;
 const mime=r.headers.get('content-type')||'';if(!/application\/json|text\/event-stream/.test(mime))throw new Error('站点未返回 MCP 数据，请核对私有站点授权');
 const raw=await r.text();if(raw.length>1000000)throw new Error('响应过大，请缩小查询范围');
 let reply;if(mime.includes('text/event-stream')){for(const frame of raw.split(/\r?\n\r?\n/)){const text=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!text)continue;const v=JSON.parse(text);if(v.id===message.id)reply=v}}else reply=JSON.parse(raw);
 if(!reply||reply.id!==message.id)throw new Error('未收到匹配的 MCP 回执');if(reply.error)throw new Error('MCP 协议请求失败：'+reply.error.code);return reply.result;
}
export async function loadConfig(file){const s=await fs.stat(file);if(!s.isFile()||s.size>20000)throw new Error('助手配置文件无效');if(process.platform!=='win32'&&(s.mode&0o077))throw new Error('助手配置含凭据，请先将文件权限设为 0600');return JSON.parse(await fs.readFile(file,'utf8'))}
async function main(){
 const [command,tool,input]=process.argv.slice(2);if(!['list','call'].includes(command)||command==='call'&&!/^geo_[a-z_]+$/.test(tool||''))throw new Error('用法：geo-mcp.mjs list 或 call geo_工具名 [参数文件.json]');
 const config=await loadConfig(process.env.GEO_ASSISTANT_CONFIG||path.join(os.homedir(),'.config/guanyin-geo/assistant.json'));
 await requestMcp(config,{jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'guanyin-geo-skill',version:'0.15.0'}}});
 await requestMcp(config,{jsonrpc:'2.0',method:'notifications/initialized'});
 const args=input?JSON.parse(await fs.readFile(input,'utf8')):{};
 const result=await requestMcp(config,{jsonrpc:'2.0',id:'operation',method:command==='list'?'tools/list':'tools/call',params:command==='list'?{}:{name:tool,arguments:args}});process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.isError)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{process.stderr.write(e.code==='ENOENT'?'助手配置或参数文件不存在\n':e instanceof SyntaxError?'助手配置或参数文件不是有效 JSON\n':e.message+'\n');process.exitCode=1});
