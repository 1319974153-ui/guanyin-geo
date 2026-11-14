import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {articleMediaRefs} from '../src/article-media-core.js';

// Local owner-only, immutable image storage. Nothing here publishes, contacts a
// platform, or copies images into the distributable application.
export const ARTICLE_MEDIA_LIMITS=Object.freeze({images:9,fileBytes:2*1024*1024,batchBytes:8*1024*1024,brandImages:200,storeBytes:200*1024*1024,pixels:12000000,edge:10000});
const LIMIT=ARTICLE_MEDIA_LIMITS,REQUEST_BYTES=Math.ceil(LIMIT.batchBytes*4/3)+20000;
const TYPES=new Map([['image/png',['png']],['image/jpeg',['jpg','jpeg']],['image/webp',['webp']]]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const validId=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
const response=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function dimensions(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMIT.edge||height>LIMIT.edge||width*height>LIMIT.pixels)fail(400,'图片超过 1200 万像素或边长 10000，请缩小后选择');return {width,height};}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function pngSize(b){
 if(b.length<45||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail(400,'PNG 图片签名或文件长度无效');
 let p=8,size,depth,color,interlace,ended=false,seenData=false,dataEnded=false,palette=false;const compressed=[];
 while(p<b.length){if(p+12>b.length)fail(400,'PNG 图片数据不完整');const n=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8),end=p+12+n;if(end>b.length||!/^[A-Za-z]{4}$/.test(type)||crc(b.subarray(p+4,p+8+n))!==b.readUInt32BE(p+8+n))fail(400,'PNG 图片内容校验失败，请重新导出');const data=b.subarray(p+8,p+8+n);
  if(p===8&&type!=='IHDR')fail(400,'PNG 缺少尺寸信息');
  if(type==='IHDR'){if(size||n!==13)fail(400,'PNG 尺寸信息无效');size=dimensions(data.readUInt32BE(0),data.readUInt32BE(4));depth=data[8];color=data[9];interlace=data[12];if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]||[]).includes(depth)||data[10]||data[11]||interlace>1)fail(400,'PNG 编码不受支持');}
  else if(['acTL','fcTL','fdAT'].includes(type))fail(400,'暂不支持动态图，请选择静态 PNG、JPEG 或 WebP');
  else if(type==='PLTE'){if(seenData||palette||!n||n%3||n>768)fail(400,'PNG 调色板无效');palette=true;}
  else if(type==='IDAT'){if(dataEnded||color===3&&!palette)fail(400,'PNG 图像数据顺序无效');seenData=true;compressed.push(data);}
  else if(type==='IEND'){if(n||!seenData||end!==b.length)fail(400,'PNG 图片结尾无效');ended=true;}
  else if(type[0]===type[0].toUpperCase())fail(400,'PNG 含不支持的必需数据块');
  if(seenData&&type!=='IDAT')dataEnded=true;p=end;
 }
 if(!ended||!size)fail(400,'PNG 图片数据不完整');
 const channels=({0:1,2:3,3:1,4:2,6:4})[color],passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]],rows=[];let expected=0;
 for(const [x,y,dx,dy] of passes){const w=Math.max(0,Math.ceil((size.width-x)/dx)),h=Math.max(0,Math.ceil((size.height-y)/dy));if(!w||!h)continue;const length=1+Math.ceil(w*channels*depth/8);rows.push({length,count:h});expected+=length*h;}
 if(expected>64*1024*1024)fail(400,'图片解码尺寸过大，请缩小后选择');let decoded;
 try{decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{fail(400,'PNG 压缩数据损坏或不完整');}
 if(decoded.length!==expected)fail(400,'PNG 像素数据与尺寸不符');let offset=0;for(const row of rows)for(let i=0;i<row.count;i++){if(decoded[offset]>4)fail(400,'PNG 像素过滤数据无效');offset+=row.length;}return size;
}
function jpegSize(b){
 if(b.length<20||b[0]!==255||b[1]!==216)fail(400,'JPEG 图片签名无效');let p=2,size,frame=false,scan=false,ended=false,quant=false,huffman=false,components=0;
 while(p<b.length){if(b[p++]!==255)fail(400,'JPEG 标记结构无效');while(p<b.length&&b[p]===255)p++;if(p>=b.length)fail(400,'JPEG 图片不完整');const marker=b[p++];
  if(marker===217){if(!frame||!scan||p!==b.length)fail(400,'JPEG 图片结尾无效');ended=true;break;}
  if(p+2>b.length||[0,1,216].includes(marker)||marker>=208&&marker<=215)fail(400,'JPEG 标记无效');const length=b.readUInt16BE(p),end=p+length;if(length<2||end>b.length)fail(400,'JPEG 图片数据不完整');
  if([192,193,194].includes(marker)){if(frame||length<11||b[p+2]!==8)fail(400,'JPEG 尺寸信息无效');components=b[p+7];if(![1,3,4].includes(components)||length!==8+3*components)fail(400,'JPEG 通道信息无效');size=dimensions(b.readUInt16BE(p+5),b.readUInt16BE(p+3));frame=true;}
  else if(marker===219){if(length<67)fail(400,'JPEG 量化数据不完整');quant=true;}
  else if(marker===196){if(length<19)fail(400,'JPEG 编码表不完整');huffman=true;}
  else if(marker===218){if(!frame||!quant||!huffman||length<8||b[p+2]<1||b[p+2]>components||length!==6+2*b[p+2])fail(400,'JPEG 缺少有效图像数据');scan=true;p=end;const start=p;while(p<b.length){if(b[p]!==255){p++;continue;}if(p+1>=b.length)fail(400,'JPEG 扫描数据不完整');const next=b[p+1];if(next===0||next>=208&&next<=215){p+=2;continue;}if(next===255){p++;continue;}break;}if(p===start)fail(400,'JPEG 图像数据为空');continue;}
  else if(!(marker>=224&&marker<=239)&&![254,221].includes(marker))fail(400,'此 JPEG 编码不受支持，请重新导出为普通 JPEG');
  p=end;
 }
 if(!ended||!size)fail(400,'JPEG 图片数据不完整');return size;
}
function webpSize(b){
 if(b.length<26||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length)fail(400,'WebP 图片签名或长度无效');let p=12,size,canvas,image=false;
 while(p<b.length){if(p+8>b.length)fail(400,'WebP 图片数据不完整');const type=b.toString('ascii',p,p+4),length=b.readUInt32LE(p+4),end=p+8+length+(length%2),data=b.subarray(p+8,p+8+length);if(end>b.length)fail(400,'WebP 图片数据不完整');
  if(type==='VP8X'){if(p!==12||length!==10||data[0]&0xc3||data[1]||data[2]||data[3])fail(400,'WebP 扩展头无效或含动画');canvas=dimensions(data.readUIntLE(4,3)+1,data.readUIntLE(7,3)+1);}
  else if(type==='ANIM'||type==='ANMF')fail(400,'暂不支持动态图，请选择静态 PNG、JPEG 或 WebP');
  else if(type==='VP8 '){if(image||length<11||data[0]&1||!data.subarray(3,6).equals(Buffer.from([157,1,42])))fail(400,'WebP 图像头无效');const partition=(data[0]|data[1]<<8|data[2]<<16)>>>5;if(partition+10>length)fail(400,'WebP 图像数据不完整');size=dimensions(data.readUInt16LE(6)&16383,data.readUInt16LE(8)&16383);image=true;}
  else if(type==='VP8L'){if(image||length<6||data[0]!==47||data[4]>>5)fail(400,'WebP 无损图像头无效');size=dimensions(1+(data[1]|(data[2]&63)<<8),1+((data[2]>>6)|(data[3]<<2)|((data[4]&15)<<10)));image=true;}
  else if(!['ALPH','ICCP','EXIF','XMP '].includes(type))fail(400,'WebP 含不支持的数据块');p=end;
 }
 if(!image||canvas&&(canvas.width!==size.width||canvas.height!==size.height))fail(400,'WebP 图像数据与尺寸不符');return size;
}
function imageSize(bytes,type){return type==='image/png'?pngSize(bytes):type==='image/jpeg'?jpegSize(bytes):webpSize(bytes);}
function filename(name,type){if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\p{Cc}\p{Cs}]/u.test(name)||!TYPES.get(type)?.includes(name.split('.').at(-1).toLowerCase()))fail(400,'图片名称或扩展名与格式不符');return name.trim();}
function directoryChain(target,create=false){const absolute=path.resolve(target),parsed=path.parse(absolute);let current=parsed.root;for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);let stat;try{stat=fs.lstatSync(current)}catch(error){if(error.code!=='ENOENT'||!create)throw error;fs.mkdirSync(current,{mode:0o700});stat=fs.lstatSync(current);}if(stat.isSymbolicLink()||!stat.isDirectory())fail(409,'图片目录包含不支持的链接或文件，请保留原资料并检查存储位置');}return fs.lstatSync(absolute);}
function syncDirectory(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','EISDIR','EBADF','ENOTSUP'].includes(error.code))throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function readFile(file,expected){let fd;try{const before=fs.lstatSync(file);if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1||before.size!==expected.bytes)fail(409,'已保存图片文件缺失、损坏或变成链接，请重新检查原图');fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const after=fs.fstatSync(fd);if(!after.isFile()||after.nlink!==1||after.ino!==before.ino||after.dev!==before.dev||after.size!==expected.bytes)fail(409,'已保存图片在读取时发生变化');const bytes=fs.readFileSync(fd);if(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256)fail(409,'已保存图片校验不一致，未继续加载');const size=imageSize(bytes,expected.type);if(size.width!==expected.width||size.height!==expected.height)fail(409,'已保存图片尺寸与记录不一致');return bytes;}catch(error){if(error.status)throw error;fail(409,'已保存图片无法读取，请保留原稿并检查原图');}finally{if(fd!==undefined)fs.closeSync(fd);}}

export function articleMediaStore({db,root,origin,readState}){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||!path.isAbsolute(root)||typeof readState!=='function')throw Error('Article media requires a local profile and exact loopback origin');
 const rootPath=path.resolve(root),identity=directoryChain(rootPath,true);
 db.exec('CREATE TABLE IF NOT EXISTS article_media(id TEXT PRIMARY KEY,brand_id TEXT NOT NULL,sha256 TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,bytes INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL,rights_confirmed INTEGER NOT NULL CHECK(rights_confirmed IN(0,1)),UNIQUE(brand_id,sha256))');
 const assertRoot=()=>{const stat=directoryChain(rootPath);if(stat.ino!==identity.ino||stat.dev!==identity.dev)fail(409,'图片存储目录已变化，请重新打开观引后核对资料');};
 const ensureBrand=brandId=>{if(!validId(brandId))fail(400,'请选择有效品牌');const state=readState();if(!state?.brands?.some(b=>b.id===brandId&&!b.demo))fail(404,'当前品牌不存在或属于演练资料');};
 const directory=brandId=>path.join(rootPath,sha(brandId));
 const mediaId=(brandId,digest)=>'am-'+sha(JSON.stringify([brandId,digest]));
 const fileFor=row=>path.join(directory(row.brand_id),row.sha256+'.bin');
 const metadata=row=>{
  if(!row||!validId(row.brand_id)||!/^am-[a-f0-9]{64}$/.test(row.id)||!/^[a-f0-9]{64}$/.test(row.sha256)||row.id!==mediaId(row.brand_id,row.sha256)||!TYPES.has(row.type)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>LIMIT.fileBytes||![0,1].includes(row.rights_confirmed))fail(409,'图片记录不完整，请检查原图');filename(row.name,row.type);dimensions(row.width,row.height);
  return {id:row.id,name:row.name,type:row.type,sha256:row.sha256,bytes:row.bytes,width:row.width,height:row.height,createdAt:row.created_at,rightsConfirmed:!!row.rights_confirmed};
 };
 const complete=(row,includeData=true)=>{const info=metadata(row);assertRoot();directoryChain(directory(row.brand_id));const bytes=readFile(fileFor(row),info);return {...info,...(includeData?{dataUrl:'data:'+info.type+';base64,'+bytes.toString('base64')}:{})};};
 const resolveRefs=(brandId,refs,includeData=true)=>{
  ensureBrand(brandId);assertRoot();if(!Array.isArray(refs)||refs.length>LIMIT.images||new Set(refs.map(r=>r?.id)).size!==refs.length)fail(400,'稿件图片引用无效或重复');
  const media=refs.map(ref=>{if(!ref||typeof ref!=='object'||!/^am-[a-f0-9]{64}$/.test(ref.id||'')||!/^[a-f0-9]{64}$/.test(ref.sha256||'')||typeof ref.rightsConfirmed!=='boolean')fail(400,'稿件图片引用或使用许可确认无效');const row=db.prepare('SELECT * FROM article_media WHERE brand_id=? AND id=?').get(brandId,ref.id);if(!row)fail(404,'找不到当前品牌的图片；未加载其他品牌素材');if(row.sha256!==ref.sha256)fail(409,'稿件引用的图片指纹已变化，请重新选择并确认');return {...complete(row,includeData),rightsConfirmed:ref.rightsConfirmed};});
  if(media.reduce((n,r)=>n+r.bytes,0)>LIMIT.batchBytes)fail(413,'所选图片合计超过 8 MB');return media;
 };
 const ownerOnly=owner=>{if(owner!=='local-owner')fail(403,'本机图片备份不属于此工作区');};
 const rowFrom=item=>({id:item.id,brand_id:item.brandId,sha256:item.sha256,name:item.name,type:item.type,bytes:item.bytes,width:item.width,height:item.height,created_at:item.createdAt,rights_confirmed:item.rightsConfirmed===true?1:0});
 const canonicalKey=item=>'article-media/'+sha(item.brandId)+'/'+item.sha256+'.bin';
 const validateSnapshot=(owner,snapshot,state)=>{
  ownerOnly(owner);if(snapshot?.version!==1||!Array.isArray(snapshot.items)||snapshot.items.length>20000)fail(400,'图片备份清单格式无效');const brands=new Set((state.brands||[]).filter(b=>!b.demo).map(b=>b.id)),seen=new Set(),counts=new Map();let total=0;
  for(const item of snapshot.items){if(!item||!brands.has(item.brandId)||typeof item.rightsConfirmed!=='boolean')fail(400,'图片备份包含其他品牌或无效资料');metadata(rowFrom(item));if(seen.has(item.id))fail(400,'图片备份编号重复');seen.add(item.id);counts.set(item.brandId,(counts.get(item.brandId)||0)+1);total+=item.bytes;
   if(item.fileKey!==canonicalKey(item)&&!new RegExp('^article-media-restored/'+sha(owner)+'/[a-zA-Z0-9-]{16,80}/'+item.id+'\\.bin$').test(item.fileKey||''))fail(400,'图片备份路径不属于当前工作区');
  }
  if(total>LIMIT.storeBytes||[...counts.values()].some(n=>n>LIMIT.brandImages))fail(413,'图片备份超过本机或单品牌存储上限');
  for(const content of state.contents||[]){let refs;try{refs=articleMediaRefs(content.mediaRefs||[])}catch(error){fail(400,error.message)}for(const ref of refs){const item=snapshot.items.find(m=>m.id===ref.id&&m.brandId===content.brandId);if(!item||item.sha256!==ref.sha256)fail(409,'备份稿件的配图缺失或属于其他品牌，未生成不完整的恢复副本');}}
  return snapshot.items;
 };
 const backupSnapshot=(owner,{verifyFiles=true}={})=>{
  ownerOnly(owner);assertRoot();const state=readState()||{brands:[],contents:[]},brands=new Set((state.brands||[]).filter(b=>!b.demo).map(b=>b.id));
  const items=db.prepare('SELECT * FROM article_media ORDER BY brand_id,id').all().filter(row=>brands.has(row.brand_id)).map(row=>{const info=verifyFiles?complete(row,false):metadata(row);const item={...info,brandId:row.brand_id};return {...item,fileKey:canonicalKey(item)};});
  const snapshot={version:1,items};if(verifyFiles)validateSnapshot(owner,snapshot,state);return snapshot;
 };
 const backupObject=(owner,item,{allowInactive=false}={})=>{ownerOnly(owner);if(!allowInactive)ensureBrand(item.brandId);if(item.fileKey!==canonicalKey(item))fail(400,'图片不是本机原始存储路径');const info=metadata(rowFrom(item));assertRoot();directoryChain(directory(item.brandId));return readFile(fileFor(rowFrom(item)),info);};
 const prepareRestore=(owner,snapshot,state,objects)=>{
  const items=validateSnapshot(owner,snapshot,state);assertRoot();if(!Array.isArray(objects)||objects.length!==items.length)fail(409,'图片恢复附件不完整');const rows=items.map((item,i)=>{const object=objects[i],bytes=Buffer.from(object.bytes||[]);if(object.id!==item.id||bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail(409,'图片恢复附件摘要不一致');const size=imageSize(bytes,item.type);if(size.width!==item.width||size.height!==item.height)fail(409,'图片恢复附件尺寸不一致');return {...rowFrom(item),buffer:bytes};});
  const added=rows.filter(row=>{const existing=db.prepare('SELECT * FROM article_media WHERE id=?').get(row.id);if(!existing)return true;metadata(existing);if(['brand_id','sha256','type','bytes','width','height'].some(k=>existing[k]!==row[k]))fail(409,'已有图片记录与恢复副本不一致，未覆盖');return false;});const stored=db.prepare('SELECT coalesce(sum(bytes),0) n FROM article_media').get().n;if(stored+added.reduce((n,r)=>n+r.bytes,0)>LIMIT.storeBytes)fail(413,'恢复后的本机图片总量超过 200 MB');
  for(const brandId of new Set(added.map(r=>r.brand_id))){const current=db.prepare('SELECT count(*) n FROM article_media WHERE brand_id=?').get(brandId).n;if(current+added.filter(r=>r.brand_id===brandId).length>LIMIT.brandImages)fail(413,'恢复后的单品牌图片超过 200 张');}
  for(const row of rows){assertRoot();directoryChain(directory(row.brand_id),true);const file=fileFor(row);if(fs.existsSync(file)){readFile(file,metadata(row));continue;}const temporary=path.join(directory(row.brand_id),'.upload-'+randomUUID()+'.tmp');let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,row.buffer);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temporary,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error;}}syncDirectory(directory(row.brand_id));}syncDirectory(rootPath);
  return rows.map(({buffer,...row})=>row); // Metadata is committed atomically with the workspace by governance.
 };
 function upload(body){
  if(!Array.isArray(body.media)||!body.media.length||body.media.length>LIMIT.images)fail(400,'请选择 1–9 张图片');let total=0;
  const entries=body.media.map(item=>{if(!item||typeof item!=='object'||!TYPES.has(item.type)||typeof item.dataUrl!=='string'||item.rightsConfirmed!==undefined&&typeof item.rightsConfirmed!=='boolean')fail(400,'图片资料或使用许可确认格式无效');const name=filename(item.name,item.type),match=item.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);if(!match||match[1]!==item.type)fail(400,'仅支持类型一致的 PNG、JPEG 或 WebP 图片');if(match[2].length>Math.ceil(LIMIT.fileBytes/3)*4)fail(413,'单张图片最多 2 MB');const bytes=Buffer.from(match[2],'base64');total+=bytes.length;if(!bytes.length||bytes.toString('base64')!==match[2])fail(400,'图片编码无效');if(bytes.length>LIMIT.fileBytes||total>LIMIT.batchBytes)fail(413,'单张图片最多 2 MB，合计最多 8 MB');const size=imageSize(bytes,item.type),digest=sha(bytes);return {id:mediaId(body.brandId,digest),brand_id:body.brandId,sha256:digest,name,type:item.type,bytes:bytes.length,...size,created_at:new Date().toISOString(),rights_confirmed:item.rightsConfirmed===true?1:0,buffer:bytes};});
  const unique=[...new Map(entries.map(row=>[row.id,row])).values()],created=[];db.exec('BEGIN IMMEDIATE');
  try{
   ensureBrand(body.brandId);assertRoot();const newRows=[];
   for(const row of unique){const existing=db.prepare('SELECT * FROM article_media WHERE id=? AND brand_id=?').get(row.id,body.brandId);if(existing)complete(existing);else newRows.push(row);}
   const count=db.prepare('SELECT count(*) AS n FROM article_media WHERE brand_id=?').get(body.brandId).n,stored=db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM article_media').get().n;
   if(count+newRows.length>LIMIT.brandImages||stored+newRows.reduce((n,r)=>n+r.bytes,0)>LIMIT.storeBytes)fail(413,'每个品牌最多保存 200 张图片，本机图片总量最多 200 MB');
   if(newRows.length)directoryChain(directory(body.brandId),true);
   for(const row of newRows){assertRoot();directoryChain(directory(body.brandId));const file=fileFor(row);if(fs.existsSync(file)){readFile(file,metadata(row));}else{const temporary=path.join(directory(body.brandId),'.upload-'+randomUUID()+'.tmp');let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,row.buffer);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temporary,file);created.push(file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error;}}}
    syncDirectory(directory(body.brandId));db.prepare('INSERT INTO article_media(id,brand_id,sha256,name,type,bytes,width,height,created_at,rights_confirmed) VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.id,row.brand_id,row.sha256,row.name,row.type,row.bytes,row.width,row.height,row.created_at,row.rights_confirmed);
   }
   syncDirectory(rootPath);const result=entries.map(row=>complete(db.prepare('SELECT * FROM article_media WHERE id=? AND brand_id=?').get(row.id,body.brandId)));db.exec('COMMIT');return {media:result};
  }catch(error){try{db.exec('ROLLBACK')}catch{}for(const file of created){try{assertRoot();directoryChain(path.dirname(file));fs.unlinkSync(file);}catch{}}throw error;}
 }
 return {backupSnapshot,validateSnapshot,backupObject,prepareRestore,resolveRefs:(brandId,refs)=>resolveRefs(brandId,refs),validateRefs:(brandId,refs)=>resolveRefs(brandId,refs,false),handle:async req=>{
  const url=new URL(req.url);if(!url.pathname.startsWith('/api/article-media/'))return null;
  try{
   if(url.origin!==origin||req.headers.get('origin')!==origin||req.headers.get('x-geo-request')!=='1'||req.headers.has('x-geo-workspace'))fail(403,'请从当前本机观引操作图片资料');
   if(req.method!=='POST')fail(405,'图片资料仅支持本机表单操作');const action=url.pathname.slice('/api/article-media/'.length);if(!['upload','list','load'].includes(action)||url.search)fail(404,'图片资料接口不存在');
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))fail(400,'图片请求必须使用 JSON');
   if(Number(req.headers.get('content-length'))>REQUEST_BYTES)fail(413,'图片请求过大');const reader=req.body?.getReader();if(!reader)fail(400,'图片请求为空');let size=0;const chunks=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>REQUEST_BYTES){await reader.cancel();fail(413,'图片请求过大');}chunks.push(Buffer.from(part.value));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail(400,'图片请求格式错误');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'图片请求格式错误');ensureBrand(body.brandId);assertRoot();
   if(action==='upload')return response(upload(body));
   if(action==='list')return response({media:db.prepare('SELECT * FROM article_media WHERE brand_id=? ORDER BY created_at DESC,id DESC LIMIT 201').all(body.brandId).map(metadata)});
   if(!Array.isArray(body.ids)||body.ids.length>LIMIT.images||new Set(body.ids).size!==body.ids.length||body.ids.some(id=>typeof id!=='string'||!/^am-[a-f0-9]{64}$/.test(id)))fail(400,'请选择最多 9 张不重复的品牌图片');
   const media=body.ids.map(id=>{const row=db.prepare('SELECT * FROM article_media WHERE brand_id=? AND id=?').get(body.brandId,id);if(!row)fail(404,'找不到当前品牌的图片；未加载其他品牌素材');return complete(row);});if(media.reduce((n,r)=>n+r.bytes,0)>LIMIT.batchBytes)fail(413,'所选图片合计超过 8 MB');return response({media});
  }catch(error){return response({error:error.status?error.message:'图片保存或加载失败，请保留原稿并检查本机存储'},error.status||500);}
 }};
}
