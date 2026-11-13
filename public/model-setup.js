/* Only public presets live here; keys never enter workspace state or browser storage. */
const MODEL_SETUP={
 deepseek:{name:'DeepSeek',model:'deepseek-flash',hint:'常用模型已填好，只需粘贴 DeepSeek 开放平台的密钥。',help:'https://platform.deepseek.com/api_keys',docs:'https://api-docs.deepseek.com/'},
 qwen:{name:'千问 · 阿里云百炼',model:'qwen-plus',hint:'使用百炼中国内地（北京）的 API Key；其他地域的密钥不能用于当前连接。',help:'https://help.aliyun.com/zh/model-studio/get-api-key',docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
 ark:{name:'豆包 · 火山方舟',model:'',hint:'粘贴方舟 API Key，并从方舟控制台复制你已开通的模型 ID 或 ep- 接入点 ID。'},
 runninghub:{name:'RunningHub · 文本模型',model:'',hint:'使用 RunningHub 文本网关密钥及该网关提供的模型名称，不使用其他平台的密钥。'}
};
const MODEL_SETUP_ENDPOINTS={deepseek:'https://api.deepseek.com/chat/completions',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',ark:'https://ark.cn-beijing.volces.com/api/v3/chat/completions',runninghub:'https://llm.runninghub.cn/v1/chat/completions'};
function canConfigureModels(){return ['owner','admin'].includes(accessInfo.current.role)}
function modelSetupConnections(){return serverConnections.filter((c,index,all)=>Object.hasOwn(MODEL_SETUP,c.provider)&&all.findIndex(item=>item.provider===c.provider)===index)}
function modelConnectionRow(provider){
 const p=MODEL_SETUP[provider],c=serverConnections.find(c=>c.provider===provider);
 return `<article class="model-service"><div><h3>${esc(p.name)}</h3><p>${c?`${esc(c.model)} · ${c.verifiedAt?'已通过一次连接验证':'已保存，可在写作时使用'}`:p.model?'已准备常用模型，只需填写密钥':'需要填写密钥及模型名称'}</p></div><div class="form-actions">${canConfigureModels()?btn(c?'修改连接':'连接 '+p.name,'configure-model',c?'small':'primary small',`data-provider="${provider}"`):''}${c&&canConfigureModels()?`<details class="simple-detail"><summary>测试与管理</summary>${btn('验证连接（可能计费）','test-model','small',`data-provider="${provider}"`)}${!c.managed?btn('移除','remove-model','ghost small',`data-provider="${provider}"`):''}</details>`:''}</div></article>`;
}
function renderSimpleModelConnections(){
 const saved=modelSetupConnections(),more=Object.keys(MODEL_SETUP).filter(p=>!saved.some(c=>c.provider===p));
 return title(saved.length?'写作模型已保存':'连接一个写作模型',saved.length?'继续使用已保存的连接，不必每篇文章重新配置。':'选一个你已有账号的服务商，填一次密钥即可。')+`<p class="simple-help">这里的模型负责写作和检查；记录豆包、元宝等平台的实际回答，不需要先配置密钥。</p>${!canConfigureModels()?'<p class="callout">请工作区所有者或管理员设置模型连接。</p>':''}${saved.length?`<section class="model-services">${saved.map(c=>modelConnectionRow(c.provider)).join('')}</section><p class="simple-help">保存不等于真实调用已验证。可以直接准备写稿计划，调用前仍会显示本次范围与费用，无需先做额外付费测试。</p>`:`<ol class="model-steps"><li>选择服务商</li><li>填写并保存</li><li>开始选题</li></ol>${canConfigureModels()?btn('设置写作模型','configure-model','primary','data-provider="deepseek"'):''}`}${saved.length&&more.length?`<details class="simple-detail"><summary>需要时再连接其他服务商</summary><section class="model-services">${more.map(modelConnectionRow).join('')}</section></details>`:''}<p class="simple-help">检查填写和保存配置免费，不发送模型请求。真实验证和写作按你的供应商账号计费。${isLocalRuntime()?'密钥加密保存在本机。':'密钥加密保存在当前服务端。'}</p><div class="form-actions"><a class="button" href="#today">返回工作台</a>${isOwner()?btn('费用预算与记录','budget-open','ghost small'):''}</div>`;
}
function openModelSetup(provider,switched=false){
 if(!canConfigureModels()){openDrawer('需要管理员设置',`<p>请工作区所有者或管理员设置模型连接。已保存的品牌资料不会改变。</p>`);return;}
 if(provider==null)provider=modelSetupConnections()[0]?.provider||'deepseek';
 if(!Object.hasOwn(MODEL_SETUP,provider))return;const p=MODEL_SETUP[provider];
 const c=serverConnections.find(c=>c.provider===provider),reuse=!!c&&!c.managed,model=c?.model||p.model;
 const modelField=`<label class="field">${p.model?'模型名称':'模型名称 / 接入点 ID'}<input name="model" required maxlength="200" value="${esc(model)}" placeholder="${provider==='ark'?'例如 ep-…，以方舟控制台为准':'复制服务商提供的模型名称'}"></label>`;
 openDrawer('设置写作模型',`<form data-model-setup data-runtime-form="connection" data-provider="${provider}" novalidate><label class="field">你使用的服务商<select data-model-setup-provider aria-label="选择模型服务商">${Object.entries(MODEL_SETUP).map(([id,item])=>`<option value="${id}" ${id===provider?'selected':''}>${esc(item.name)}${serverConnections.some(connection=>connection.provider===id)?' · 已保存':''}</option>`).join('')}</select></label><p>${esc(p.hint)}</p>${switched?'<p role="status">已切换服务商，未保存的密钥已清空，避免发送到其他服务商。</p>':''}${c?.managed?'<p class="simple-help">当前为服务端托管配置，可直接用于写作。只有建立此工作区的独立连接时才需填写新密钥。</p>':''}${reuse?'<p class="simple-help">已保存的密钥会继续使用，不需要再次粘贴；只有更换时才填下方内容。</p>':''}<label class="field">${reuse?'API 密钥（不更换可留空）':'API 密钥'}<input type="password" name="key" autocomplete="new-password" ${reuse?'':'required'} maxlength="2000" placeholder="${reuse?'留空继续使用已保存的密钥':'从服务商控制台复制后粘贴'}"><small>这是开放平台的 API Key，不是聊天账号的登录密码。</small></label>${p.help?`<a class="model-help" href="${p.help}" target="_blank" rel="noopener noreferrer">去官方页面获取密钥 ↗</a>`:''}${p.model?'':modelField}<details class="simple-detail model-advanced"><summary>高级连接信息${p.model?' · 模型 '+esc(model):''}</summary>${p.model?modelField:''}<p class="helper">连接地址和协议已自动设置，无需填写。当前版本仅支持列表中的官方模型网关。</p><div class="kv"><span>协议</span><span>OpenAI 兼容 Chat Completions</span></div><div class="kv"><span>连接地址</span><span class="code">${esc(MODEL_SETUP_ENDPOINTS[provider])}</span></div></details><p class="simple-help">检查填写和保存都不调用模型。密钥不会写入业务资料或浏览器本地存储；真实验证和写作前会另行说明费用。</p><p data-model-setup-status role="status"></p><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="button primary">${reuse?'保存修改':'保存连接'}</button><button type="button" class="button small" data-model-setup-check>免费检查填写</button></div></form>`);
}
function modelSavedNext(provider){
 const c=serverConnections.find(c=>c.provider===provider);
 openDrawer('连接已保存',`<p>${esc(MODEL_SETUP[provider]?.name||provider)} · ${esc(c?.model||'')}</p><p>${c?.verifiedAt?'这个配置已通过一次连接验证，无需重复测试。':'还没有验证能否调用，但可以先准备写稿计划，无需先做额外付费测试。'}</p><p>模型和密钥已保存，后续文章可以复用；准备计划不收费，实际生成前再确认本次调用。</p><div class="form-actions">${btn('准备 AI 写稿计划','simple-write','primary',`data-provider="${esc(provider)}"`)}<a class="button" href="#today" data-close>稍后再说，返回工作台</a></div>${canConfigureModels()?`<details class="simple-detail"><summary>需要时测试一次连接（可能计费）</summary><p class="simple-help">测试最多输出 32 token，会计入供应商用量；不发送业务资料，不自动重试。</p>${btn('验证一次连接','test-model','small',`data-provider="${esc(provider)}"`)}</details>`:''}`);
}
function modelVerifiedNext(receipt){
 openDrawer('模型连接验证成功',`<p>${esc(MODEL_SETUP[receipt.provider]?.name||receipt.provider)} · ${esc(receipt.model)}</p><p>已收到这次测试的有效回复，可以准备本次写稿计划。</p>${btn('准备 AI 写稿计划','simple-write','primary',`data-provider="${esc(receipt.provider)}"`)}<a class="button primary" href="#today" data-close>返回工作台</a><details class="simple-detail"><summary>查看本次测试回执</summary><div class="answer-text">${esc(receipt.text.slice(0,200))}</div><div class="kv"><span>请求 ID</span><span>${esc(receipt.requestId)}</span></div><div class="kv"><span>供应商返回用量</span><span>${esc(JSON.stringify(receipt.usage))}</span></div></details><p class="simple-help">只证明本次 API 请求成功，不代表 AI 平台引用或推荐效果。</p>`);
}
function modelVerificationFailed(provider,message){
 const hint=/中断|超时|timeout|结果.*确认|已提交/i.test(message)?'先查看供应商用量和原请求状态；这次结果不明确，不要立即重复测试。':/额度|余额|配额|429|budget|quota/i.test(message)?'检查供应商余额或工作区费用预算；已保存的密钥和模型仍然保留。':/密钥|401|403|权限|key/i.test(message)?'确认密钥属于所选服务商和地域，且有该模型权限；需要更换时再粘贴新密钥。':/模型|model|404|接入点/i.test(message)?'确认这个账号已开通所填模型，模型名称或接入点 ID 与控制台一致。':'检查服务商、模型名称和当前网络；已保存的连接仍保留，无需从头配置。';
 openDrawer('连接验证尚未通过',`<p class="form-error" role="alert">${esc(message)}</p><p>${hint}</p><p>没有自动重新发送请求。修改连接时无需重新填写未更换的密钥。</p><div class="form-actions">${canConfigureModels()?btn('检查连接配置','configure-model','primary',`data-provider="${esc(provider)}"`):''}${isOwner()?btn('查看费用预算','budget-open','small'):''}<a class="button" href="#integrations" data-close>返回连接页</a></div>`);
}
function modelSetupCheck(form){
 if(!canConfigureModels())return {ok:false,field:'',message:'请工作区所有者或管理员设置模型连接。'};
 const provider=form.dataset.provider;if(!Object.hasOwn(MODEL_SETUP,provider))return {ok:false,field:'',message:'请选择列表中的服务商。'};
 const model=String(form.elements.model?.value||'').trim(),key=String(form.elements.key?.value||'').trim(),saved=serverConnections.find(c=>c.provider===provider),reuse=!!saved&&!saved.managed;
 if(!model||model.length>200)return {ok:false,field:'model',message:'请填写服务商控制台中的模型名称或接入点 ID。'};
 if(/^https?:\/\//i.test(model)||/[\r\n]/.test(model))return {ok:false,field:'model',message:'这里填写模型名称，不是网页或接口地址；连接地址已自动设置。'};
 if(!key&&!reuse)return {ok:false,field:'key',message:'首次连接需要填写这个服务商的 API 密钥。'};
 if(key.length>2000||/\s/.test(key))return {ok:false,field:'key',message:'密钥中包含空格、换行或过长内容，请只粘贴完整 API Key。'};
 return {ok:true,model,key,unchanged:reuse&&!key&&saved.model===model,message:'填写格式已检查，无需填写地址。没有发送模型请求，也没有验证密钥是否可用。'};
}
function modelSetupShowCheck(form,result){
 const error=form.querySelector('.form-error'),status=form.querySelector('[data-model-setup-status]');error.textContent=result.ok?'':result.message;status.textContent=result.ok?result.message:'';
 if(!result.ok&&result.field){const field=form.elements[result.field];const details=field.closest?.('details');if(details)details.open=true;field.focus?.();}
 return result;
}
function modelSetupScope(){try{const current=accessInfo.current;return JSON.stringify([current.owner||'',current.actor||current.owner||'',typeof sessionStorage==='undefined'?'':sessionStorage.getItem('geo.workspace')||'']);}catch{return '';}}
async function modelSetupSave(form){
 if(typeof runtimeBusy!=='undefined'&&runtimeBusy||form.modelSetupPending)return;
 const result=modelSetupShowCheck(form,modelSetupCheck(form));if(!result.ok)return;
 if(result.unchanged){modelSavedNext(form.dataset.provider);return;}
 const provider=form.dataset.provider,scope=modelSetupScope(),button=form.querySelector('button[type="submit"]'),original=button.textContent;
 if(!scope){form.querySelector('.form-error').textContent='无法读取当前工作区，请恢复浏览器存储权限后重试。填写内容仍保留，尚未保存或调用模型。';return;}
 const controls=[...form.querySelectorAll('input,select,button')].map(control=>[control,control.disabled]);
 const current=()=>form.isConnected!==false&&document.querySelector('form[data-model-setup]')===form&&modelSetupScope()===scope;
 form.modelSetupPending=true;controls.forEach(([control])=>control.disabled=true);button.textContent='正在保存…';runtimeLock(true);
 try{
  await runtimeFlush();if(!current())return;
  const data=await apiRequest('/api/connections',{method:'POST',body:JSON.stringify({provider,model:result.model,key:result.key})});
  if(!current())return;
  serverConnections=data.connections;form.elements.key.value='';runtimeLock(false);closeDrawer();render();modelSavedNext(provider);
 }catch(error){if(current()){form.querySelector('[data-model-setup-status]').textContent='';form.querySelector('.form-error').textContent=error.message+' 本次只保存配置，没有调用模型；填写内容仍保留，可修改后再保存。';}}
 finally{form.modelSetupPending=false;controls.forEach(([control,disabled])=>control.disabled=disabled);button.textContent=original;if(current())runtimeLock(false);}
}
document.addEventListener('change',event=>{
 if(!event.target.matches?.('[data-model-setup-provider]'))return;const form=event.target.closest('form[data-model-setup]');if(!form)return;
 if(typeof runtimeBusy!=='undefined'&&runtimeBusy){event.target.value=form.dataset.provider;return;}
 openModelSetup(event.target.value,true);
});
document.addEventListener('input',event=>{
 const form=event.target.closest?.('form[data-model-setup]');if(!form)return;form.querySelector('.form-error').textContent='';form.querySelector('[data-model-setup-status]').textContent='';
});
document.addEventListener('click',event=>{
 const button=event.target.closest?.('[data-model-setup-check]');if(!button)return;const form=button.closest('form[data-model-setup]');if(form)modelSetupShowCheck(form,modelSetupCheck(form));
});
// Capture before the shared runtime submit handler. A local check never calls an API.
document.addEventListener('submit',event=>{
 const form=event.target.closest?.('form[data-model-setup]');if(!form)return;
 event.preventDefault();event.stopImmediatePropagation();void modelSetupSave(form);
},true);
