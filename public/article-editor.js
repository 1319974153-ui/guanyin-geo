function articleEditorFooter(current,saved){const id=current.id,manager=['owner','admin'].includes(accessInfo.current.role);return `<button type="submit" class="button">保存本机草稿</button>${!manager&&current.status==='草稿'?btn('提交审核','submit-content','primary',`type="button" data-id="${esc(id)}"`):!manager&&current.status==='待审核'?btn('审核通过','approve-content','primary',`type="button" data-id="${esc(id)}"`)+btn('退回修改','reject-content','',`type="button" data-id="${esc(id)}"`):''}${saved?btn(current.mediaRefs?.length?'下载正文':'下载稿件','download-content','small',`type="button" data-id="${esc(id)}"`):''}<button type="button" class="button small article-mobile-targets" data-distribution-focus>选择发布平台</button>`}
function articleEditorValues(f) { return {title:f.elements.title.value, text:f.elements.text.value,ai:f.elements.articleAi.checked,...(f.distributionPersistentMedia?{mediaRefs:GEO_ARTICLE_EDITOR.articleMediaRefs(f.distributionMediaRefs||[])}:{})}; }
function articleEditorDirty() {
 const f=document.querySelector('[data-article-editor]');
 if(!f)return false;
 const v=articleEditorValues(f);
 return v.title!==f.savedTitle||v.text!==f.savedText||v.ai!==f.savedAi||JSON.stringify(v.mediaRefs||[])!==JSON.stringify(f.savedMediaRefs||[]);
}
function articleWritingReviewRefresh(f,pending=false) {
 const summary=f.querySelector('[data-article-basic-summary]'),details=f.querySelector('[data-article-basic-details]'),semantic=f.querySelector('[data-article-semantic-status]');
 if(!summary||!details||!semantic)return;
 const current=own('contents').find(c=>c.id===f.dataset.id),dirty=articleEditorDirty();
 semantic.textContent=current&&dirty?'稿件已修改，原语义质检仅适用于保存版；保存后再核对。':'语义质检：'+(current?checkLabel('content',current.id):'尚未检查');
 const guidance=f.querySelector('[data-article-semantic-guidance]');if(guidance&&typeof contentReviewPanelHtml==='function')guidance.innerHTML=current?contentReviewPanelHtml(current.id,dirty):'<p class="helper">保存稿件后可检查文章质量。</p>';
 if(pending){summary.textContent='基础检查：正在检查当前修改…';details.textContent='结果更新中。';return;}
 const review=GEO_ARTICLE_EDITOR.articleWritingReview(current||{},articleEditorValues(f)),issues=review.checks.filter(check=>!check.ok);
 summary.textContent=issues.length?`基础检查：${issues.length} 项待核对`:'基础检查：未发现基础格式问题，事实仍需核对。';
 details.innerHTML=(issues.length?'<ul>'+issues.map(check=>'<li>'+esc(check.detail)+'</li>').join('')+'</ul>':'<p>当前标题、正文和重复段落等基础项目未发现问题。</p>')+'<p class="helper">只检查当前文本和已登记的依据，不判断事实真伪，也不自动审核。请核对是否回答客户问题、场景与边界是否清楚、能力和案例是否有来源。</p>';
}
function articleEditorRefresh(f) {
 const v=articleEditorValues(f),dirty=articleEditorDirty();
 f.querySelector('[data-article-save-status]').textContent=dirty?'有未保存修改':f.dataset.new==='true'?'尚未保存':'已保存到工作区';
 f.querySelector('[data-article-provenance]').innerHTML=badge(v.ai?'AI 辅助内容':'自主撰写');
 f.querySelector('[data-article-count]').textContent=v.text.replace(/\s/g,'').length.toLocaleString('zh-CN')+' 字';
 articleWritingReviewRefresh(f);
 const preview=f.querySelector('[data-article-preview]');
 try { const result=v.text.trim()?GEO_ARTICLE_FORMAT.formatArticle(v.text):{html:'<p>写下正文后，这里会显示排版效果。</p>',warnings:[]};
  preview.innerHTML=wordpressFormatFrame('<h1>'+esc(v.title||'文章标题')+'</h1>'+result.html,v.title||'文章预览')+result.warnings.map(w=>'<p class="helper">'+esc(w)+'</p>').join('');
 } catch(e){ preview.textContent=e.message; }
}
function openArticleEditor(c) {
 const id=c?.id||uid(), saved=!!c, current=c||{id,title:'',text:'',status:'草稿'};
 openDrawer('多平台发布',`<form class="article-preview-hidden" data-form="edit-content" data-article-editor data-id="${esc(id)}" data-brand="${esc(brand().id)}" data-new="${!saved}">
 <p class="article-intro">确认文章，勾选平台，一次发布。需要调整时，直接告诉 AI 怎么改。</p><div class="article-publishing-layout"><div class="article-compose"><div class="article-topline"><div><span data-article-workflow>${badge(current.status)}</span> <span data-article-provenance>${badge(current.ai?'AI 辅助内容':'自主撰写')}</span> <span data-article-save-status role="status"></span></div><span data-article-count></span></div>
 <div data-article-revision-panel></div>
 <label class="field article-title">文章标题<input name="title" value="${esc(current.title)}" maxlength="160" required placeholder="一个清楚的标题，让读者知道能解决什么问题"></label>
 <div class="article-tools"><button type="button" class="button small" data-article-toggle aria-pressed="false">预览排版</button><details class="article-format-tools"><summary>排版与导入</summary><div class="article-toolbar" aria-label="Markdown 排版工具">${[['heading','标题'],['bold','加粗'],['list','列表'],['quote','引用'],['code','代码'],['link','链接']].map(([k,t])=>`<button type="button" class="button small" data-article-format="${k}">${t}</button>`).join('')}<label class="button small article-import">导入文件<input type="file" data-article-import accept=".md,.markdown,.txt,text/plain,text/markdown" aria-label="导入 Markdown 或纯文本文章"></label><span class="helper">⌘ / Ctrl + S 保存</span></div></details></div>
 <div class="article-workspace"><label class="field article-source">正文<textarea name="text" required maxlength="100000" placeholder="直接写作或粘贴已有文章。可以使用标题、列表、引用和代码块。">${esc(current.text)}</textarea></label><section class="article-rendered"><h3>排版预览</h3><div data-article-preview></div><p class="helper">外部图片不自动加载；发布后以目标平台排版为准。</p></section></div>
 <section class="article-evidence" aria-label="文章基础检查"><p data-article-basic-summary role="status" aria-live="polite"></p><details class="advanced"><summary>查看检查项与核对范围</summary><div data-article-basic-details></div></details><p class="helper" data-article-semantic-status></p><div data-article-semantic-guidance></div></section>
 <label class="distribution-confirm"><input type="checkbox" name="articleAi" ${current.ai?'checked':''}>本文包含 AI 辅助生成或整理的内容</label><p class="helper">粘贴或导入外部 AI 文稿也请勾选；声明会随稿件传给支持的平台。</p>
 <div class="article-bottom">${articleEditorFooter(current,saved)}</div></div>${distributionPanel()}</div><p class="form-error" role="alert" data-article-error></p>
 </form><details class="article-evidence"><summary>事实依据与审核说明</summary>${saved?writingBasisHtml(c):'<p>自行撰写的稿件不要求先配置模型或创建监测问题，请在正文保留可核验的来源。</p>'}<p>修改已审核文章会重新进入草稿。保存、审核和平台发布是三个独立步骤。</p></details>`,'内容创作');
 const f=document.querySelector('[data-article-editor]');f.savedTitle=current.title;f.savedText=current.text;f.savedAi=!!current.ai;f.savedMediaRefs=structuredClone(current.mediaRefs||[]);f.distributionMediaRefs=structuredClone(current.mediaRefs||[]);f.distributionPersistentMedia=Object.hasOwn(current,'mediaRefs');
 articleEditorRefresh(f);distributionRenderMedia(f);distributionLoad(f);if(typeof articleRevisionMount==='function')articleRevisionMount(f,current);if(typeof platformContentAdaptationMount==='function')platformContentAdaptationMount(f);
 if(!['owner','admin','editor'].includes(accessInfo.current.role))f.querySelectorAll('[data-article-format]').forEach(b=>b.disabled=true);
}
async function articleEditorSave(intent,{reopen=true}={}) {
 const f=document.querySelector('[data-article-editor]');if(!f||runtimeBusy)return;
 const error=f.querySelector('[data-article-error]');error.textContent='';
 try {
  if(f.dataset.brand!==brand().id)throw new Error('当前品牌已切换，请重新打开稿件');
  if(f.distributionMediaLoading)throw new Error('配图仍在读取或保存，请稍后再保存稿件');
  if(f.distributionMediaError)throw new Error('配图未准备完成：'+f.distributionMediaError+'。请重新选择或清空配图后保存。');
  const old=own('contents').find(c=>c.id===f.dataset.id);
  let next;
  if(intent==='confirm'){if(!['owner','admin'].includes(accessInfo.current.role))throw new Error('需要管理员确认');const submitted=GEO_ARTICLE_EDITOR.articleRevision(old,articleEditorValues(f),'submit',accessInfo.current.role);next=GEO_ARTICLE_EDITOR.articleRevision(submitted,articleEditorValues(f),'approve',accessInfo.current.role)}else next=GEO_ARTICLE_EDITOR.articleRevision(old,articleEditorValues(f),intent,accessInfo.current.role);
  runtimeLock(true);await runtimeFlush();
  if(old)Object.assign(old,next);else state.contents.push({...next,id:f.dataset.id,brandId:brand().id,style:'文章',demo:false,generated:false,ai:!!next.ai,factIds:[],factSnapshots:[]});
  // A changed article must not retain obsolete approval metadata.
  const record=own('contents').find(c=>c.id===f.dataset.id);
  for(const key of ['reviewedAt','reviewNote','writingReview'])if(!Object.hasOwn(next,key))delete record[key];
  save();await runtimeFlush();
  f.savedTitle=record.title;f.savedText=record.text;f.savedAi=!!record.ai;f.savedMediaRefs=structuredClone(record.mediaRefs||[]);runtimeLock(false);if(reopen){render();openArticleEditor(record)}else {f.elements.title.value=record.title;f.elements.text.value=record.text;f.dataset.new='false';f.querySelector('[data-article-workflow]').innerHTML=badge(record.status);f.querySelector('.article-bottom').innerHTML=articleEditorFooter(record,true);articleEditorRefresh(f);}
  toast(intent==='save'?'稿件已保存':intent==='submit'?'稿件已提交审核':intent==='approve'?'审核通过，可以选择发布渠道':intent==='confirm'?'稿件已保存并确认':'已退回草稿');return record;
 } catch(e){error.textContent=e.message;}finally{runtimeLock(false);}
}
async function articleEditorAction(name,el) {
 if(name==='distribute-article'){
  const c=own('contents').find(c=>c.id===el.dataset.id);
  if(!c)throw new Error('找不到稿件，请刷新后重试');
  openArticleEditor(c);return true;
 }
 if(name==='write-article'){
  if(!['owner','admin','editor'].includes(accessInfo.current.role))throw new Error('当前角色不能写文章');
  if(!brand().id){go('setup');toast('先填写品牌名称，再开始写文章');return true;}
  openArticleEditor();return true;
 }
 if(document.querySelector('[data-article-editor]')&&['submit-content','approve-content','reject-content'].includes(name)){
  await articleEditorSave({'submit-content':'submit','approve-content':'approve','reject-content':'reject'}[name]);return true;
 }
 return false;
}
document.addEventListener('submit',e=>{if(!e.target.matches('[data-article-editor]'))return;e.preventDefault();e.stopImmediatePropagation();articleEditorSave('save');},true);
let articlePreviewTimer;
document.addEventListener('input',e=>{const f=e.target.closest('[data-article-editor]');if(!f||!['title','text','articleAi'].includes(e.target.name))return;f.querySelector('[data-article-save-status]').textContent='有未保存修改';articleWritingReviewRefresh(f,true);clearTimeout(articlePreviewTimer);articlePreviewTimer=setTimeout(()=>{if(f.isConnected)articleEditorRefresh(f)},200);});
document.addEventListener('click',e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;
 const b=e.target.closest('[data-article-format]');if(b){const t=f.elements.text;if(t.readOnly)return;const result=GEO_ARTICLE_EDITOR.markdownInsertion(t.value,t.selectionStart,t.selectionEnd,b.dataset.articleFormat);if(result.text.length>100000)return toast('正文不能超过 100000 字');t.value=result.text;t.focus();t.setSelectionRange(result.start,result.end);distributionInvalidate(f);articleEditorRefresh(f);}
 const toggle=e.target.closest('[data-article-toggle]');if(toggle){const hidden=f.classList.toggle('article-preview-hidden');toggle.textContent=hidden?'预览排版':'收起预览';toggle.setAttribute('aria-pressed',String(!hidden));}
});
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-article-check-start],[data-article-semantic-revise]');if(!button)return;
 const f=button.closest('[data-article-editor]');if(!f||runtimeBusy||f.dataset.brand!==brand().id)return;e.preventDefault();
 if(button.hasAttribute('data-article-check-start')){if(articleEditorDirty()||f.dataset.new==='true'){const saved=await articleEditorSave('save',{reopen:false});if(!saved)return;}if(!f.isConnected||document.querySelector('[data-article-editor]')!==f||f.dataset.brand!==brand().id)return;openChecks('content',[f.dataset.id]);return;}
 if(articleEditorDirty()){articleWritingReviewRefresh(f);toast('稿件已修改，保存后重新核对建议。');return;}
 const review=GEO_CHECKS.currentContentReview?.(state,brand().id,f.dataset.id),r=f.revisionState;
 if(!review?.suggestions.length||!r||r.attempt||r.pending){toast('当前没有可用于改稿的有效建议，请先检查文章质量。');return;}
 r.instruction='优先处理当前有效文章审校提出的问题，保留事实、来源、文章类型和必要限制，不补造缺失资料。';r.includeReviewSuggestions=true;r.plan=null;r.confirmed=false;r.open=true;articleRevisionRender(f);
 f.querySelector('[data-article-revision-panel]')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&document.querySelector('[data-article-editor]')){e.preventDefault();articleEditorSave('save');}});
window.addEventListener('beforeunload',e=>{if(articleEditorDirty()){e.preventDefault();e.returnValue='';}});

document.addEventListener('change',async e=>{if(!e.target.matches('[data-article-import]'))return;const f=e.target.closest('[data-article-editor]'),file=e.target.files[0];if(!file)return;const error=f.querySelector('[data-article-error]');try{if(!/\.(md|markdown|txt)$/i.test(file.name)||file.size>400000)throw new Error('请选择 400 KB 以内的 Markdown 或纯文本文件');const text=await file.text();if(text.length>100000||text.includes('\0'))throw new Error('文件不是有效文本或超过 10 万字');if(f.elements.text.value.trim()&&!confirm('用所选文件替换当前正文？未保存的正文将被替换。'))return;f.elements.text.value=text;if(!f.elements.title.value.trim())f.elements.title.value=file.name.replace(/\.[^.]+$/,'').slice(0,160);distributionInvalidate(f);articleEditorRefresh(f);error.textContent=''}catch(e){error.textContent=e.message}finally{e.target.value=''}});
