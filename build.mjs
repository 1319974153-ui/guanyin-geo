import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
fs.rmSync('public/assistant/guanyin-geo.zip',{force:true});
execFileSync('zip',['-q','-r','-X','guanyin-geo.zip','guanyin-geo'],{cwd:'public/assistant'});
import {build} from 'esbuild';
await build({entryPoints:['src/publication-core.js'],outfile:'public/publication-core.js',bundle:true,format:'iife',globalName:'GEO_PUBLICATION',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/citation-import-core.js'],outfile:'public/citation-import-core.js',bundle:true,format:'iife',globalName:'GEO_CITATION_IMPORT',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/semantic-core.js'],outfile:'public/semantic-core.js',bundle:true,format:'iife',globalName:'GEO_SEMANTIC',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/semantic-worker.js'],outfile:'public/semantic-worker.js',bundle:true,format:'esm',target:'es2022',platform:'browser',minify:true});
for(const [pkg,name] of [['@huggingface/transformers','Transformers-js'],['onnxruntime-web','ONNX-Runtime'],['@huggingface/tokenizers','HF-Tokenizers'],['@huggingface/jinja','HF-Jinja']]){const dir='node_modules/'+pkg,license=['LICENSE','LICENSE.txt','LICENSE.md'].find(f=>fs.existsSync(dir+'/'+f));if(license)fs.copyFileSync(dir+'/'+license,'public/vendor/'+name+'-LICENSE.txt');}
await build({entryPoints:['src/question-xlsx.js'],outfile:'public/question-xlsx.js',bundle:true,format:'iife',globalName:'GEO_QUESTION_XLSX',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/question-import-core.js'],outfile:'public/question-import-core.js',bundle:true,format:'iife',globalName:'GEO_QUESTION_IMPORT',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/offline-archive.js'],outfile:'public/offline-archive.js',bundle:true,format:'iife',globalName:'GEO_OFFLINE',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/studio-core.js'],outfile:'public/studio-core.js',bundle:true,format:'iife',globalName:'GEO_STUDIO',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/analytics-core.js'],outfile:'public/metrics-core.js',bundle:true,format:'iife',globalName:'GEO_METRICS',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/attribution-core.js'],outfile:'public/attribution-core.js',bundle:true,format:'iife',globalName:'GEO_ATTRIBUTION',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/attribution-import.js'],outfile:'public/attribution-import.js',bundle:true,format:'iife',globalName:'GEO_ATTR_IMPORT',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/competitor-core.js'],outfile:'public/competitor-core.js',bundle:true,format:'iife',globalName:'GEO_COMPETITORS',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/demand-core.js'],outfile:'public/demand-core.js',bundle:true,format:'iife',globalName:'GEO_DEMAND',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/checks-core.js'],outfile:'public/checks-core.js',bundle:true,format:'iife',globalName:'GEO_CHECKS',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/schema-core.js'],outfile:'public/schema-core.js',bundle:true,format:'iife',globalName:'GEO_SCHEMA',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/knowledge-core.js'],outfile:'public/knowledge-core.js',bundle:true,format:'iife',globalName:'GEO_KNOWLEDGE',target:'es2022',platform:'browser',minify:true});
await build({entryPoints:['src/document-parser-worker.js'],outfile:'public/document-parser-worker.js',bundle:true,format:'esm',target:'es2022',platform:'browser',minify:true});
fs.mkdirSync('public/vendor',{recursive:true});
const ocrAssets={};
for(const file of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js']){
 const bytes=fs.readFileSync('node_modules/tesseract.js-core/'+file);ocrAssets[file]={url:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/'+file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),type:'text/javascript;charset=utf-8'};
}
for(const lang of ['eng','chi_sim']){
 const file=lang+'.traineddata.gz',bytes=fs.readFileSync('node_modules/@tesseract.js-data/'+lang+'/4.0.0_best_int/'+file);ocrAssets[file]={url:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/'+lang+'@1.0.0/4.0.0_best_int/'+file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),type:'application/gzip'};
 fs.copyFileSync('node_modules/@tesseract.js-data/'+lang+'/package.json','public/vendor/OCR-'+lang+'-package.json');
 fs.copyFileSync('node_modules/@tesseract.js-data/'+lang+'/README.md','public/vendor/OCR-'+lang+'-README.md');
}
fs.writeFileSync('src/ocr-assets-manifest.js','// Exact installed OCR runtime and model bytes. No document data.\nexport default '+JSON.stringify(ocrAssets,null,2)+';\n');
fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js','public/vendor/tesseract-worker.min.js');
fs.copyFileSync('node_modules/tesseract.js/LICENSE.md','public/vendor/Tesseract-js-LICENSE.md');
fs.copyFileSync('node_modules/tesseract.js-core/LICENSE','public/vendor/Tesseract-core-LICENSE.txt');

fs.copyFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','public/vendor/pdf.worker.min.mjs');
fs.cpSync('node_modules/pdfjs-dist/cmaps','public/vendor/cmaps',{recursive:true});
fs.cpSync('node_modules/pdfjs-dist/standard_fonts','public/vendor/standard_fonts',{recursive:true});
fs.copyFileSync('node_modules/pdfjs-dist/LICENSE','public/vendor/PDFjs-LICENSE.txt');
fs.copyFileSync('node_modules/jszip/LICENSE.markdown','public/vendor/JSZip-LICENSE.txt');
fs.copyFileSync('node_modules/mammoth/LICENSE','public/vendor/Mammoth-LICENSE.txt');
fs.copyFileSync('node_modules/@modelcontextprotocol/server/LICENSE','public/vendor/MCP-SDK-LICENSE.txt');
fs.copyFileSync('node_modules/zod/LICENSE','public/vendor/Zod-LICENSE.txt');
fs.copyFileSync('node_modules/markdown-it/LICENSE','public/vendor/Markdown-it-LICENSE.txt');
fs.copyFileSync('node_modules/jsonrepair/LICENSE.md','public/vendor/JSONRepair-LICENSE.txt');
for(const [pkg,file] of [['argparse','LICENSE'],['linkify-it','LICENSE'],['mdurl','LICENSE'],['punycode.js','LICENSE-MIT.txt'],['uc.micro','LICENSE.txt']])fs.copyFileSync('node_modules/'+pkg+'/'+file,'public/vendor/'+pkg+'-LICENSE.txt');
fs.copyFileSync('node_modules/parse5/LICENSE','public/vendor/parse5-LICENSE.txt');
fs.copyFileSync('node_modules/robots-parser/LICENSE.md','public/vendor/robots-parser-LICENSE.txt');
fs.copyFileSync('node_modules/entities/LICENSE','public/vendor/entities-LICENSE.txt');
fs.copyFileSync('node_modules/xmlchars/LICENSE','public/vendor/xmlchars-LICENSE.txt');
const matrix=fs.readFileSync('public/docs/功能验收矩阵.md','utf8'),version=matrix.match(/当前版本 ([\d.]+)/)?.[1];
const rows=matrix.split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| 模块 |')).map(line=>line.split('|').slice(1,-1).map(x=>x.trim()));
if(rows.length!==36||rows.some(row=>row.length!==5)||!version)throw new Error('功能验收矩阵必须有 36 行、5 列和版本号');
fs.writeFileSync('public/delivery-data.js','window.GEO_DELIVERY_VERSION='+JSON.stringify(version)+';window.GEO_DELIVERY='+JSON.stringify(rows)+';\n');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.md':'text/markdown;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.txt':'text/plain;charset=utf-8'};
const files={};function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else files['/'+path.relative('public',p).split(path.sep).join('/')]=[types[path.extname(p)]||'application/octet-stream',fs.readFileSync(p,types[path.extname(p)]?'utf8':'base64'),...(types[path.extname(p)]?[]:['base64'])];}}
walk('public');fs.writeFileSync('src/assets.generated.js','export default '+JSON.stringify(files)+';\n');
fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
await build({entryPoints:['src/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',target:'es2022',platform:'browser',minify:true});
fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
fs.cpSync('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built Worker, bundled assets and database migrations.');
