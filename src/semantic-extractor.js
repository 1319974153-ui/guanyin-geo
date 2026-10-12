import {AutoTokenizer,AutoModel,FeatureExtractionPipeline,env} from '@huggingface/transformers';

export function configureSemanticRuntime(origin){
 const base=new URL('/semantic/assets/v1/',origin).href;
 // Local component discovery supports root-relative browser paths; an absolute
 // HTTP URL is skipped when remote model loading is disabled.
 env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='/semantic/assets/v1/';env.useBrowserCache=true;
 env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
 env.backends.onnx.wasm.wasmPaths={mjs:base+'ort-wasm-simd-threaded.mjs',wasm:base+'ort-wasm-simd-threaded.wasm'};
}

export async function loadSemanticExtractor(progress_callback){
 const name='bge-small-zh-v1.5';
 // The fixed text model has exactly these two components.
 const [tokenizer,model]=await Promise.all([
  AutoTokenizer.from_pretrained(name,{progress_callback}),
  AutoModel.from_pretrained(name,{dtype:'q8',device:'wasm',progress_callback})
 ]);
 if(typeof tokenizer!=='function')throw new Error('中文分词组件未能加载，请刷新后重试');
 return new FeatureExtractionPipeline({task:'feature-extraction',tokenizer,model});
}
