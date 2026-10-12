import {createWorker} from 'tesseract.js';
export const OCR_VERSION='Tesseract.js 7.0.0';
export const OCR_LANGUAGES=['chi_sim+eng','chi_sim','eng'];
export async function createDocumentOcr({baseUrl,language='chi_sim+eng',progress=()=>{}}){
 if(!OCR_LANGUAGES.includes(language))throw new Error('请选择简体中文、英文或中英混合识别');
 const worker=await createWorker(language,1,{workerPath:baseUrl+'/vendor/tesseract-worker.min.js',workerBlobURL:false,corePath:baseUrl+'/api/ocr/assets/v1',langPath:baseUrl+'/api/ocr/assets/v1',cacheMethod:'none',gzip:true,logger:p=>progress({phase:'ocr',status:p.status,progress:p.progress}),errorHandler:()=>{}});
 return{async recognize(bytes){const {data}=await worker.recognize(bytes,{}, {text:true});return{text:data.text.trim(),confidence:Math.max(0,Math.min(100,Number(data.confidence)||0))};},terminate:()=>worker.terminate()};
}
