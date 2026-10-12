export function documentImageSize(bytes,extension){
 const b=new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength);let width,height;
 if(extension==='png'){
  if(b.length<24||[137,80,78,71,13,10,26,10].some((n,i)=>b[i]!==n)||String.fromCharCode(...b.slice(12,16))!=='IHDR')throw new Error('文件不是有效 PNG 图片');width=v.getUint32(16);height=v.getUint32(20);
 }else if(['jpg','jpeg'].includes(extension)){
  if(b[0]!==255||b[1]!==216)throw new Error('文件不是有效 JPEG 图片');let p=2;
  while(p+4<=b.length){if(b[p++]!==255)throw new Error('JPEG 标记结构无效');while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const length=v.getUint16(p);if(length<2||p+length>b.length)throw new Error('JPEG 图片结构不完整');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw new Error('JPEG 尺寸信息不完整');height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=length;}
 }else throw new Error('图片识别支持 PNG / JPEG');
 if(!width||!height)throw new Error('无法读取图片尺寸');if(width>10000||height>10000||width*height>12000000)throw new Error('图片超过 1200 万像素或边长 10000，请缩小后识别');return{width,height};
}
