// Explicit single-run local adapter. Never reads browser profiles or exports cookies.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function prepare(pkg,account,images,clock=new Date()){
 if(pkg?.format!=='guanyin-publication-package-v1'||pkg.hash!==hash(JSON.stringify(pkg.snapshot)))throw new Error('发布包损坏或正文被修改，请重新从审核稿导出');
 if(!pkg.snapshot?.title||!pkg.snapshot?.text||!pkg.snapshot?.reviewedAt)throw new Error('发布包缺少已审核内容或审核时间');
 if(!Number.isFinite(Date.parse(pkg.createdAt))||+clock-Date.parse(pkg.createdAt)>86400000||Date.parse(pkg.createdAt)>+clock+60000)throw new Error('发布包超过 24 小时或时间无效，请重新导出以核对事实');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(account||''))throw new Error('请指定有效的专用登录账号名称');
 if([...pkg.snapshot.title].length>30||[...pkg.snapshot.text].length>1000)throw new Error('请先在工作台审核适合抖音的短标题与图文正文；不会自动截断长文章');
 if(!Array.isArray(images)||images.length<1||images.length>35||images.some(p=>!path.isAbsolute(p)||! /\.(png|jpe?g|webp)$/i.test(p)))throw new Error('需要 1–35 张 PNG/JPEG/WebP 图片的绝对路径');
 return ['douyin','upload-note','--account',account,'--images',...images,'--title',pkg.snapshot.title,'--note',pkg.snapshot.text,'--headed'];
}
export function dispatch(pkg,account,images,folder,{publish=false,run=spawnSync,clock=new Date()}={}){
 const args=prepare(pkg,account,images,clock);
 const media=images.map(file=>({file,hash:hash(fs.readFileSync(file))}));
 const id=hash(JSON.stringify([pkg.hash,account,media.map(x=>x.hash)]));
 if(!publish)return {id,state:'prepared',account,images:images.length,scope:'参数检查通过，尚未登录验证或发布'};
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const dest=path.join(folder,id+'.json');
 if(fs.existsSync(dest))throw new Error('此稿件与图片已有提交记录。先核对平台结果，禁止自动重发');
 const check=run('sau',['douyin','check','--account',account],{encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 if(check.error||check.status!==0||!/^valid\s*$/im.test(check.stdout||'')||/^invalid\s*$/im.test(check.stdout||''))throw new Error('专用登录不可用，请本人完成 sau douyin login；不会自动发送验证码');
 const record={id,packageHash:pkg.hash,brandId:pkg.snapshot.brandId,contentId:pkg.snapshot.contentId,account,media,startedAt:clock.toISOString(),state:'sending'};
 const fd=fs.openSync(dest,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record,null,2));fs.closeSync(fd);
 const result=run('sau',args,{encoding:'utf8',timeout:600000,maxBuffer:2*1024*1024});
 // Process exit is not a platform receipt. All submissions require remote reconciliation.
 record.state='needs_reconciliation';record.exitCode=result.status??null;record.finishedAt=new Date().toISOString();record.note='命令已结束或中断。请核对平台审核/发布状态和公开链接，未确认前不得重发。';
 fs.writeFileSync(dest,JSON.stringify(record,null,2),{mode:0o600});return record;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{const [file,account,folder,...rest]=process.argv.slice(2);if(!file||!account||!folder)throw new Error('用法：node tools/social/douyin.mjs 发布包.json 账号名 回执目录 /绝对路径/图片.png [--publish-confirmed]');
 console.log(JSON.stringify(dispatch(JSON.parse(fs.readFileSync(file,'utf8')),account,rest.filter(x=>x!=='--publish-confirmed'),folder,{publish:rest.includes('--publish-confirmed')}),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
