function articleEditorValues(f) { return {title:f.elements.title.value, text:f.elements.text.value}; }
function articleEditorDirty() {
 const f=document.querySelector('[data-article-editor]');
 if(!f)return false;
 const v=articleEditorValues(f);
 return v.title!==f.savedTitle||v.text!==f.savedText;
}
function articleEditorRefresh(f) {
 const v=articleEditorValues(f),dirty=articleEditorDirty();
 f.querySelector('[data-article-save-status]').textContent=dirty?'有未保存修改':f.dataset.new==='true'?'尚未保存':'已保存到工作区';
 f.querySelector('[data-article-count]').textContent=v.text.replace(/\s/g,'').length.toLocaleString('zh-CN')+' 字';
 const preview=f.querySelector('[data-article-preview]');
 try { const result=v.text.trim()?GEO_ARTICLE_FORMAT.formatArticle(v.text):{html:'<p>写下正文后，这里会显示排版效果。</p>',warnings:[]};
  preview.innerHTML=wordpressFormatFrame('<h1>'+esc(v.title||'文章标题')+'</h1>'+result.html,v.title||'文章预览')+result.warnings.map(w=>'<p class="helper">'+esc(w)+'</p>').join('');
 } catch(e){ preview.textContent=e.message; }
}
function openArticleEditor(c) {
 const id=c?.id||uid(), saved=!!c, current=c||{id,title:'',text:'',status:'草稿'};
 openDrawer(saved?'编辑文章':'写文章',`<form data-form="edit-content" data-article-editor data-id="${esc(id)}" data-brand="${esc(brand().id)}" data-new="${!saved}">
 <div class="article-topline"><div>${badge(current.status)} ${badge(current.ai?'AI 辅助内容':'自主撰写')} <span data-article-save-status role="status"></span></div><span data-article-count></span></div>
 <label class="field article-title">文章标题<input name="title" value="${esc(current.title)}" maxlength="160" required placeholder="一个清楚的标题，让读者知道能解决什么问题"></label>
 <div class="article-toolbar" aria-label="Markdown 排版工具">${[['heading','标题'],['bold','加粗'],['list','列表'],['quote','引用'],['code','代码'],['link','链接']].map(([k,t])=>`<button type="button" class="button small" data-article-format="${k}">${t}</button>`).join('')}<span class="helper">Markdown · ⌘ / Ctrl + S 保存</span><button type="button" class="button small" data-article-toggle aria-pressed="true">收起预览</button></div>
 <div class="article-workspace"><label class="field article-source">正文<textarea name="text" required maxlength="100000" placeholder="直接写作或粘贴已有文章。可以使用标题、列表、引用和代码块。">${esc(current.text)}</textarea></label><section class="article-rendered"><h3>排版预览</h3><div data-article-preview></div><p class="helper">外部图片不自动加载；发布后以目标平台排版为准。</p></section></div>
 <p class="form-error" role="alert"></p><div class="article-bottom"><button type="submit" class="button">保存草稿 / 修改</button>${current.status==='草稿'?btn('保存并提交审核','submit-content','primary',`type="button" data-id="${esc(id)}"`):current.status==='待审核'?btn('审核通过','approve-content','primary',`type="button" data-id="${esc(id)}"`)+btn('退回修改','reject-content','',`type="button" data-id="${esc(id)}"`):btn('选择发布渠道','publish-content','primary',`type="button" data-id="${esc(id)}"`)}${saved?btn('下载已保存稿件','download-content','small',`type="button" data-id="${esc(id)}"`):''}</div>
 </form><details class="article-evidence"><summary>事实依据与审核说明</summary>${saved?contentCheckSummary(c)+writingBasisHtml(c):'<p>自行撰写的稿件不要求先配置模型或创建监测问题，请在正文保留可核验的来源。</p>'}<p>修改已审核文章会重新进入草稿。保存、审核和平台发布是三个独立步骤。</p></details>`,'内容创作');
 const f=document.querySelector('[data-article-editor]');f.savedTitle=current.title;f.savedText=current.text;
 articleEditorRefresh(f);
 if(!['owner','admin','editor'].includes(accessInfo.current.role))f.querySelectorAll('[data-article-format]').forEach(b=>b.disabled=true);
}
async function articleEditorSave(intent) {
 const f=document.querySelector('[data-article-editor]');if(!f||runtimeBusy)return;
 const error=f.querySelector('.form-error');error.textContent='';
 try {
  if(f.dataset.brand!==brand().id)throw new Error('当前品牌已切换，请重新打开稿件');
  const old=own('contents').find(c=>c.id===f.dataset.id);
  const next=GEO_ARTICLE_EDITOR.articleRevision(old,articleEditorValues(f),intent,accessInfo.current.role);
  runtimeLock(true);await runtimeFlush();
  if(old)Object.assign(old,next);else state.contents.push({...next,id:f.dataset.id,brandId:brand().id,style:'文章',demo:false,generated:false,ai:false,factIds:[],factSnapshots:[]});
  // A changed article must not retain obsolete approval metadata.
  const record=own('contents').find(c=>c.id===f.dataset.id);
  for(const key of ['reviewedAt','reviewNote'])if(!Object.hasOwn(next,key))delete record[key];
  save();await runtimeFlush();
  f.savedTitle=record.title;f.savedText=record.text;runtimeLock(false);render();openArticleEditor(record);
  toast(intent==='save'?'稿件已保存':intent==='submit'?'稿件已提交审核':intent==='approve'?'审核通过，可以选择发布渠道':'已退回草稿');
 } catch(e){error.textContent=e.message;}finally{runtimeLock(false);}
}
async function articleEditorAction(name,el) {
 if(name==='write-article'){
  if(!['owner','admin','editor'].includes(accessInfo.current.role))throw new Error('当前角色不能写文章');
  if(!brand().id){go('setup');toast('先填写品牌或个人 IP 名称，再开始写文章');return true;}
  openArticleEditor();return true;
 }
 if(document.querySelector('[data-article-editor]')&&['submit-content','approve-content','reject-content'].includes(name)){
  await articleEditorSave({'submit-content':'submit','approve-content':'approve','reject-content':'reject'}[name]);return true;
 }
 return false;
}
document.addEventListener('submit',e=>{if(!e.target.matches('[data-article-editor]'))return;e.preventDefault();e.stopImmediatePropagation();articleEditorSave('save');},true);
let articlePreviewTimer;
document.addEventListener('input',e=>{const f=e.target.closest('[data-article-editor]');if(!f)return;f.querySelector('[data-article-save-status]').textContent='有未保存修改';clearTimeout(articlePreviewTimer);articlePreviewTimer=setTimeout(()=>{if(f.isConnected)articleEditorRefresh(f)},200);});
document.addEventListener('click',e=>{
 const f=e.target.closest('[data-article-editor]');if(!f)return;
 const b=e.target.closest('[data-article-format]');if(b){const t=f.elements.text;if(t.readOnly)return;const result=GEO_ARTICLE_EDITOR.markdownInsertion(t.value,t.selectionStart,t.selectionEnd,b.dataset.articleFormat);if(result.text.length>100000)return toast('正文不能超过 100000 字');t.value=result.text;t.focus();t.setSelectionRange(result.start,result.end);articleEditorRefresh(f);}
 const toggle=e.target.closest('[data-article-toggle]');if(toggle){const hidden=f.classList.toggle('article-preview-hidden');toggle.textContent=hidden?'显示预览':'收起预览';toggle.setAttribute('aria-pressed',String(!hidden));}
});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&document.querySelector('[data-article-editor]')){e.preventDefault();articleEditorSave('save');}});
window.addEventListener('beforeunload',e=>{if(articleEditorDirty()){e.preventDefault();e.returnValue='';}});
