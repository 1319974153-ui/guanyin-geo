/* Only public presets live here; keys never enter workspace state or browser storage. */
const MODEL_SETUP={
 deepseek:{name:'DeepSeek',model:'deepseek-flash',hint:'常用模型已填好，只需粘贴 DeepSeek 开放平台的密钥。',help:'https://platform.deepseek.com/api_keys',docs:'https://api-docs.deepseek.com/'},
 qwen:{name:'千问 · 阿里云百炼',model:'qwen-plus',hint:'使用百炼中国内地（北京）的 API Key；其他地域的密钥不能用于当前连接。',help:'https://help.aliyun.com/zh/model-studio/get-api-key',docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
 ark:{name:'豆包 · 火山方舟',model:'',hint:'粘贴方舟 API Key，并从方舟控制台复制你已开通的模型 ID 或 ep- 接入点 ID。'},
 runninghub:{name:'RunningHub · 文本模型',model:'',hint:'使用 RunningHub 文本网关密钥及该网关提供的模型名称，不使用其他平台的密钥。'}
};
function canConfigureModels(){return ['owner','admin'].includes(accessInfo.current.role)}
function modelConnectionRow(provider){
 const p=MODEL_SETUP[provider],c=serverConnections.find(c=>c.provider===provider);
 return `<article class="model-service"><div><h3>${esc(p.name)}</h3><p>${c?`${esc(c.model)} · ${c.verifiedAt?'已通过一次连接验证':'已保存，待验证'}`:p.model?'已准备常用模型，只需填写密钥':'需要填写密钥及模型名称'}</p></div><div class="form-actions">${canConfigureModels()?btn(c?'修改连接':'连接 '+p.name,'configure-model',c?'small':'primary small',`data-provider="${provider}"`):''}${c&&canConfigureModels()?btn('验证连接','test-model','small',`data-provider="${provider}"`):''}${c&&!c.managed&&canConfigureModels()?btn('移除','remove-model','ghost small',`data-provider="${provider}"`):''}</div></article>`;
}
function renderSimpleModelConnections(){
 const shown=['deepseek','qwen',...serverConnections.map(c=>c.provider).filter(p=>MODEL_SETUP[p]&&!['deepseek','qwen'].includes(p))];
 const more=Object.keys(MODEL_SETUP).filter(p=>!shown.includes(p));
 return title('连接一个写作模型','选一个你已有账号的服务商即可，不需要把所有平台都配置一遍。')+`<p class="simple-help">这里的模型负责写作和检查；记录豆包、元宝等平台的实际回答，不需要先配置密钥。</p><ol class="model-steps"><li>选服务商</li><li>粘贴密钥并保存</li><li>按需验证一次</li></ol>${!canConfigureModels()?'<p class="callout">请工作区所有者或管理员设置模型连接。</p>':''}<section class="model-services">${shown.map(modelConnectionRow).join('')}</section>${more.length?`<details class="simple-detail"><summary>其他服务商：${more.map(p=>esc(MODEL_SETUP[p].name)).join('、')}</summary><section class="model-services">${more.map(modelConnectionRow).join('')}</section></details>`:''}<p class="simple-help">保存配置免费，调用模型按你的供应商账号计费。${isLocalRuntime()?'密钥加密保存在本机。':'密钥加密保存在当前服务端。'}</p><div class="form-actions"><a class="button" href="#today">暂不配置，返回工作台</a>${isOwner()?btn('费用预算与记录','budget-open','ghost small'):''}</div>`;
}
function openModelSetup(provider){
 const p=MODEL_SETUP[provider];if(!p)return;
 const c=serverConnections.find(c=>c.provider===provider),reuse=!!c&&!c.managed,model=c?.model||p.model;
 const modelField=`<label class="field">${p.model?'模型名称':'模型名称 / 接入点 ID'}<input name="model" required maxlength="200" value="${esc(model)}" placeholder="${provider==='ark'?'例如 ep-…，以方舟控制台为准':'复制服务商提供的模型名称'}"></label>`;
 openDrawer('连接 '+p.name,`<form data-runtime-form="connection" data-provider="${provider}"><p>${esc(p.hint)}</p>${c?.managed?'<p class="simple-help">当前为服务端托管配置。填写新密钥会建立此工作区的独立连接。</p>':''}<label class="field">${reuse?'API 密钥（不更换可留空）':'API 密钥'}<input type="password" name="key" autocomplete="new-password" ${reuse?'':'required'} maxlength="2000" placeholder="${reuse?'留空继续使用已保存的密钥':'从服务商控制台复制后粘贴'}"><small>这是开放平台的 API Key，不是聊天账号的登录密码。</small></label>${p.help?`<a class="model-help" href="${p.help}" target="_blank" rel="noopener noreferrer">去官方页面获取密钥 ↗</a>`:''}${p.model?`<details class="simple-detail model-advanced"><summary>更换模型 · 当前 ${esc(model)}</summary>${modelField}</details>`:modelField}<p class="simple-help">保存只加密存储，不发送模型请求。密钥不会写入业务资料或浏览器本地存储。</p><p class="form-error" role="alert"></p><button type="submit" class="button primary">保存连接</button></form>`);
}
function modelSavedNext(provider){
 const c=serverConnections.find(c=>c.provider===provider);
 openDrawer('连接已保存',`<p>${esc(MODEL_SETUP[provider]?.name||provider)} · ${esc(c?.model||'')}</p><p>还没有验证能否调用。可以先做一次小测试，也可以稍后在使用前验证。</p><div class="form-actions">${btn('验证一次连接','test-model','primary',`data-provider="${esc(provider)}"`)}<a class="button" href="#today" data-close>稍后再说，返回工作台</a></div><p class="simple-help">测试最多输出 32 token，会计入供应商用量；不发送业务资料，不自动重试。</p>`);
}
function modelVerifiedNext(receipt){
 openDrawer('模型连接验证成功',`<p>${esc(MODEL_SETUP[receipt.provider]?.name||receipt.provider)} · ${esc(receipt.model)}</p><p>已收到这次测试的有效回复，可以回到工作台准备内容。</p><a class="button primary" href="#today" data-close>返回工作台</a><details class="simple-detail"><summary>查看本次测试回执</summary><div class="answer-text">${esc(receipt.text.slice(0,200))}</div><div class="kv"><span>请求 ID</span><span>${esc(receipt.requestId)}</span></div><div class="kv"><span>供应商返回用量</span><span>${esc(JSON.stringify(receipt.usage))}</span></div></details><p class="simple-help">只证明本次 API 请求成功，不代表 AI 平台引用或推荐效果。</p>`);
}
function modelVerificationFailed(provider,message){
 openDrawer('连接验证尚未通过',`<p class="form-error" role="alert">${esc(message)}</p><p>先检查已保存的配置和供应商状态；没有自动重新发送请求。</p><div class="form-actions">${btn('检查连接配置','configure-model','primary',`data-provider="${esc(provider)}"`)}${isOwner()?btn('查看费用预算','budget-open','small'):''}<a class="button" href="#integrations" data-close>返回连接页</a></div>`);
}
