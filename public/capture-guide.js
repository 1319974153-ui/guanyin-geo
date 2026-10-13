function captureQuestion(f){const q=own('questions').find(q=>q.id===f.elements.questionId.value);return answerImportVersions(q).find(v=>(v.version||'v1')===f.elements.questionVersion.value)?.text||'';}
function captureGuideStep(f,step){
 const error=f.querySelector('.form-error');error.textContent='';
 if(step>Number(f.dataset.captureStep||1))for(const input of f.querySelectorAll(`[data-capture-page="${f.dataset.captureStep}"] input,[data-capture-page="${f.dataset.captureStep}"] select,[data-capture-page="${f.dataset.captureStep}"] textarea`)){if(!input.reportValidity())return;}
 f.dataset.captureStep=String(step);f.querySelectorAll('[data-capture-page]').forEach(x=>x.hidden=x.dataset.capturePage!==String(step));
 f.querySelector('[data-capture-progress]').textContent=`第 ${step} / 3 步 · ${['固定问题与采集条件','保存平台原文与引用','核对并保存证据'][step-1]}`;
 f.querySelector('[data-capture-question]').textContent=captureQuestion(f);
 f.querySelector('[data-capture-summary]').textContent=`${captureQuestion(f)} · ${f.elements.questionVersion.value} · ${f.elements.platform.value} / ${f.elements.entry.value} / ${f.elements.mode.value} · ${f.elements.collectedAt.value}（设备时区）`;
 f.querySelector('[data-action="capture-back"]').hidden=step===1;f.querySelector('[data-action="capture-next"]').hidden=step===3;f.querySelector('button[type="submit"]').hidden=step!==3;
 f.querySelector('[data-capture-progress]').focus();
}
function enhanceCaptureForm(baseline){
 const f=document.querySelector('[data-answer-import]');if(!f)return;
 const children=[...f.children],pages=[1,2,3].map(i=>{const p=document.createElement('section');p.dataset.capturePage=i;return p});let n=0;
 for(const child of children){if(child.querySelector('[name="text"]'))n=1;if(child.querySelector('[name="recommendation"]'))n=2;if(child.matches('.form-error,button[type="submit"]'))continue;pages[n].append(child)}
 const intro=document.createElement('div');intro.innerHTML='<h3 data-capture-progress tabindex="-1"></h3><p>在元宝等平台实际提问，再回到这里保存证据。此向导不会代登录或把模型 API 当成消费端回答。</p>';
 f.prepend(intro,...pages);pages[0].insertAdjacentHTML('beforeend','<div class="callout"><b>本次固定问题</b><p data-capture-question></p><button type="button" class="button" data-action="capture-copy">复制当前问题</button> <a class="button" href="https://yuanbao.tencent.com/" target="_blank" rel="noopener noreferrer">打开腾讯元宝</a><p>使用新会话并核对联网模式；地区或模型未展示时如实留未知。返回后填写实际采样时间。</p></div>');
 pages[2].insertAdjacentHTML('afterbegin','<div class="callout"><b>即将保存</b><p data-capture-summary></p><p>原文与引用照录；未知状态不计作成功。保存后可添加截图或文件证据。</p></div>');
 f.querySelector('button[type="submit"]').insertAdjacentHTML('beforebegin','<button type="button" class="button" data-action="capture-back">上一步</button> <button type="button" class="button primary" data-action="capture-next">下一步</button> ');
 f.elements.platform.value='腾讯元宝';f.elements.region.value='未记录';f.elements.mode.value='未记录';
 if(baseline){
  f.elements.questionId.value=baseline.promptId;const q=own('questions').find(q=>q.id===baseline.promptId);f.elements.questionVersion.innerHTML=answerImportVersionOptions(q);
  for(const [k,value] of Object.entries({questionVersion:baseline.questionVersion,platform:baseline.platform,entry:baseline.entry,mode:baseline.mode,region:baseline.region,language:baseline.language,model:baseline.model||''}))f.elements[k].value=value;
  const hidden=document.createElement('input');hidden.type='hidden';hidden.name='baselineAnswerId';hidden.value=baseline.id;f.append(hidden);
  intro.insertAdjacentHTML('beforeend',`<p class="callout">同条件复测：基线 ${esc(new Date(baseline.date).toLocaleString('zh-CN'))}。条件由服务端核对；需要改变条件时关闭向导，另建新基线。</p>`);
 }
 captureGuideStep(f,1);
}
async function captureGuideAction(name,el){
 if(name==='trial-answers'){showAnswers(own('answers').filter(a=>a.demo),'试用回答 · 不计入正式指标');return true;}
 if(name==='answer-to-trial'){const a=own('answers').find(a=>a.id===el.dataset.id);if(a){a.demo=true;save();await runtimeFlush();closeDrawer();render();toast('已移入试用记录；已有报告快照不会自动改写，请重新生成报告')}return true;}
 if(name==='capture-start'||name==='capture-retest'){
  const baseline=name==='capture-retest'?own('answers').find(a=>a.id===el.dataset.id):null;
  if(name==='capture-retest'&&(!baseline||baseline.demo||baseline.surface!=='import'))throw new Error('请选择正式消费端记录');
  if(!own('questions').length){toast('请先添加监测问题');go('monitor');return true}
  answerImportAction('import-answer',{dataset:{id:baseline?.promptId||el.dataset.id}});enhanceCaptureForm(baseline);return true;
 }
 if(!name.startsWith('capture-'))return false;
 const f=el.closest('[data-answer-import]');if(!f||runtimeBusy)return true;
 if(name==='capture-next')captureGuideStep(f,Math.min(3,Number(f.dataset.captureStep)+1));
 if(name==='capture-back')captureGuideStep(f,Math.max(1,Number(f.dataset.captureStep)-1));
 if(name==='capture-copy'){try{await navigator.clipboard.writeText(captureQuestion(f));toast('问题已复制，请在平台新会话中提问')}catch{f.querySelector('.form-error').textContent='浏览器未允许剪贴板写入，请选中上方完整问题手动复制。'}}
 return true;
}
function captureRetestPanel(a){
 if(a.demo)return '<div class="callout"><b>试用演练记录</b><p>已排除正式指标、报告与发布效果复测，不能转为正式证据。</p></div>';
 if(a.surface!=='import')return ''; 
 const prior=own('answers').find(x=>x.id===a.baselineAnswerId);
 return `<section class="callout"><b>${a.baselineAnswerId?'同条件复测记录':'消费端采样基线'}</b>${prior?`<p>基线 ${esc(prior.date)} → 本次 ${esc(a.date)}。名称匹配：${GEO_METRICS.hasName(prior.text,brand())?'有':'无'} → ${GEO_METRICS.hasName(a.text,brand())?'有':'无'}；引用：${prior.citationKnown?prior.citations.length:'未核对'} → ${a.citationKnown?a.citations.length:'未核对'}。单次差异不代表改善或因果关系；未知环境可能并不相同。</p>${btn('查看基线原文','answer-detail','small',`data-id="${esc(prior.id)}"`)}`:a.baselineAnswerId?'<p>基线当前不可见，保留原始关联，不推断比较结论。</p>':'<p>保留问题版本与采样条件，下次按相同条件重新采集。</p>'}${btn('移入试用记录','answer-to-trial','ghost small',`data-id="${esc(a.id)}"`)}${btn('按此条件再次采集','capture-retest','small',`data-id="${esc(a.id)}"`)}</section>`;
}

document.addEventListener("change",e=>{const f=e.target.closest("[data-capture-step]")?.closest("form");if(f&&["questionId","questionVersion"].includes(e.target.name)){const label=f.querySelector("[data-capture-question]");if(label)label.textContent=captureQuestion(f);}});
