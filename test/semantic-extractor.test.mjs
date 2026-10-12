import test from 'node:test';import assert from 'node:assert/strict';
import {env,AutoModel,Tensor} from '@huggingface/transformers';
import {configureSemanticRuntime,loadSemanticExtractor} from '../src/semantic-extractor.js';

test('cold same-origin extraction loads a callable tokenizer with remote models disabled',async()=>{
 const keys=['allowRemoteModels','allowLocalModels','useFS','useFSCache','useBrowserCache','useCustomCache','localModelPath','fetch'],saved=Object.fromEntries(keys.map(k=>[k,env[k]])),originalModel=AutoModel.from_pretrained,wasm={...env.backends.onnx.wasm},requests=[];
 const tokenizer={version:'1.0',truncation:null,padding:null,added_tokens:[],normalizer:null,pre_tokenizer:{type:'Whitespace'},post_processor:null,decoder:null,model:{type:'WordLevel',vocab:{'[UNK]':0,'[PAD]':1,hello:2,world:3},unk_token:'[UNK]'}};
 configureSemanticRuntime('https://geo.test');assert.equal(env.allowRemoteModels,false);
 Object.assign(env,{useFS:false,useFSCache:false,useBrowserCache:false,useCustomCache:false,fetch:async input=>{const url=new URL(String(input),'https://geo.test');assert.equal(url.origin,'https://geo.test');requests.push(url.pathname);if(url.pathname.endsWith('/tokenizer.json'))return Response.json(tokenizer);if(url.pathname.endsWith('/tokenizer_config.json'))return Response.json({tokenizer_class:'PreTrainedTokenizer',model_max_length:512,unk_token:'[UNK]',pad_token:'[PAD]'});return new Response(null,{status:404});}});
 let called=0;AutoModel.from_pretrained=async(name,options)=>{assert.equal(name,'bge-small-zh-v1.5');assert.equal(options.dtype,'q8');assert.equal(options.device,'wasm');return async inputs=>{called++;assert.equal(inputs.input_ids.dims[0],2);assert.deepEqual(Array.from(inputs.input_ids.data),[2n,3n,3n,1n]);return {last_hidden_state:new Tensor('float32',Float32Array.from([3,4,0,5,5,12,0,13]),[2,2,2])};}};
 try{const extractor=await loadSemanticExtractor();assert.equal(typeof extractor.tokenizer,'function');const result=await extractor(['hello world','world'],{pooling:'cls',normalize:true});assert.equal(called,1);assert.deepEqual(result.dims,[2,2]);assert.ok(Math.abs(result.tolist()[0][0]-.6)<1e-6);assert.ok(Math.abs(result.tolist()[1][1]-12/13)<1e-6);assert.deepEqual([...new Set(requests)].sort(),['/semantic/assets/v1/bge-small-zh-v1.5/tokenizer.json','/semantic/assets/v1/bge-small-zh-v1.5/tokenizer_config.json']);}
 finally{Object.assign(env,saved);Object.assign(env.backends.onnx.wasm,wasm);AutoModel.from_pretrained=originalModel;}
});
