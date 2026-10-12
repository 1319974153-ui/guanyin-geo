import {createDocumentOcr,OCR_VERSION,OCR_LANGUAGES} from './document-ocr.js';
import {documentImageSize} from './document-images.js';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
const MAX_TEXT=200000;
export function checkDocxArchive(bytes){
 const v=new DataView(bytes);let end=-1;for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('DOCX 不是完整的 ZIP 文档');const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);if(count>2000||count===65535||start===0xffffffff)throw new Error('DOCX 文件结构过大，请另存精简版本');let pos=start,total=0;
 for(let i=0;i<count;i++){if(pos+46>bytes.byteLength||v.getUint32(pos,true)!==0x02014b50)throw new Error('DOCX 压缩目录无效');const flags=v.getUint16(pos+8,true),size=v.getUint32(pos+24,true);if(flags&1||size===0xffffffff)throw new Error('不支持加密或 ZIP64 DOCX');total+=size;if(size>16*1024*1024||total>32*1024*1024)throw new Error('DOCX 解压后超过安全处理容量，请移除大图或拆分文档');pos+=46+v.getUint16(pos+28,true)+v.getUint16(pos+30,true)+v.getUint16(pos+32,true);}
}
export async function parseDocument(bytes,filename,{baseUrl='',progress=()=>{},ocrMode='off',language='chi_sim+eng',ocrFactory=createDocumentOcr,canvasFactory}={}){
 if(!['off','auto','all'].includes(ocrMode)||!OCR_LANGUAGES.includes(language))throw new Error('识别模式或语言无效');
 let recognizer,ocrPages=0,currentPage=1,totalPages=1;
 const canvas=canvasFactory||((width,height)=>{if(typeof OffscreenCanvas==='undefined')throw new Error('当前浏览器不支持扫描 PDF 绘制，请使用新版浏览器或上传 PNG / JPEG 图片');return new OffscreenCanvas(width,height)});
 class CanvasFactory{create(width,height){const c=canvas(width,height);return{canvas:c,context:c.getContext('2d')}}reset(target,width,height){target.canvas.width=width;target.canvas.height=height}destroy(target){target.canvas.width=target.canvas.height=0;target.canvas=null;target.context=null}}
 const recognize=async image=>{if(++ocrPages>20)throw new Error('单份最多识别 20 页扫描图像，请拆分后上传');recognizer ||= await ocrFactory({baseUrl,language,progress:p=>progress(currentPage,totalPages,p)});const result=await recognizer.recognize(image);if(typeof result.text!=='string'||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>100)throw new Error('识别器未返回有效文字或置信度');return result;};
 try{

 const ext=filename.split('.').at(-1).toLowerCase(),blocks=[],warnings=[];let pages=0;
 if(bytes.byteLength>8*1024*1024)throw new Error('文件超过 8 MB，请拆分后上传');
 if(ext==='pdf'){
  GlobalWorkerOptions.workerSrc=baseUrl+'/vendor/pdf.worker.min.mjs';
  const task=getDocument({...(ocrMode!=='off'?{CanvasFactory}:{}),data:new Uint8Array(bytes),cMapUrl:baseUrl+'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:baseUrl+'/vendor/standard_fonts/',isEvalSupported:false,useWasm:false,disableFontFace:true,useSystemFonts:false});
  try{const pdf=await task.promise;pages=pdf.numPages;totalPages=pages;if(ocrMode==='all'&&pages>20)throw new Error('全文 OCR 每次最多 20 页，请拆分后上传');if(pages>100)throw new Error('PDF 超过 100 页，请拆分后上传');let count=0;
   for(let i=1;i<=pages;i++){
    currentPage=i;progress(i,pages,{phase:'text'});const page=await pdf.getPage(i);
    try{const content=await page.getTextContent();let text=content.items.filter(x=>typeof x.str==='string').map(x=>x.str+(x.hasEOL?'\n':' ')).join('').replace(/[ \t]+\n/g,'\n').trim(),method='text',confidence;
     if(ocrMode==='all'||ocrMode==='auto'&&!text){const original=page.getViewport({scale:1}),scale=Math.min(2,2400/Math.max(original.width,original.height)),viewport=page.getViewport({scale}),target=canvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      try{await page.render({canvasContext:target.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;const image=target.convertToBlob?await (await target.convertToBlob({type:'image/png'})).arrayBuffer():new Uint8Array(target.toBuffer('image/png'));const result=await recognize(image);text=result.text;confidence=result.confidence;method='ocr';}
      finally{target.width=target.height=0;}
     }
     count+=text.length;if(count>MAX_TEXT)throw new Error('文档超过 20 万字，请拆分后上传');if(text)blocks.push({text,page:i,index:i,...(method==='ocr'?{method,confidence}: {})});else warnings.push('第 '+i+' 页未取得文字'+(method==='ocr'?'，请核对原图清晰度':'，可开启 OCR 后重试'));
    }finally{page.cleanup();}
   }
  }finally{await task.destroy();}
 }else if(['png','jpg','jpeg'].includes(ext)){
  if(ocrMode==='off')throw new Error('图片需要开启 OCR 识别');documentImageSize(bytes,ext);pages=1;const result=await recognize(bytes);if(result.text)blocks.push({text:result.text,page:1,index:1,method:'ocr',confidence:result.confidence});
 }else if(ext==='docx'){checkDocxArchive(bytes);const result=await mammoth.extractRawText({arrayBuffer:bytes},{externalFileAccess:false});if(result.value.length>MAX_TEXT)throw new Error('文档超过 20 万字');for(const text of result.value.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean))blocks.push({text,page:null,index:blocks.length+1});warnings.push(...result.messages.map(x=>x.message));}
 else if(['txt','md'].includes(ext)){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.length>MAX_TEXT)throw new Error('文档超过 20 万字');for(const value of text.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean))blocks.push({text:value,page:null,index:blocks.length+1});}
 else throw new Error('支持 PDF、DOCX、TXT、Markdown、PNG 和 JPEG；旧版 DOC 请另存为 DOCX');
 if(blocks.reduce((n,b)=>n+b.text.length,0)>MAX_TEXT)throw new Error('文档超过 20 万字，请拆分后上传');
 if(!blocks.length)throw new Error('未读取到可用文字。扫描件请开启 OCR；已识别但无结果时请检查原图方向、清晰度或更换识别语言。');
 if(blocks.length>500)throw new Error('超过 500 个正文段落，请拆分文档');if(ocrPages)warnings.unshift('OCR 结果可能存在错字或遗漏，请对照原件核对；识别置信度不是事实可信度。');return{blocks,pages,warnings:warnings.slice(0,20),...(ocrPages?{ocr:{engine:OCR_VERSION,language,pages:ocrPages,mode:ocrMode}}:{})};
 }finally{await recognizer?.terminate();}
}
