// Product acceptance evidence only. Never used to grant an account permission.
export const PUBLISHING_EVIDENCE_DATE='2026-10-28';
export const PUBLISHING_ACTION_LABELS={identity:'账号核验',prepare:'填入编辑器',draft:'平台草稿',publish:'公开提交'};
export const PUBLISHING_ACCEPTANCE_LABELS={passed:'实机已验收',pending:'待实机验收',paused:'验收已暂停',not_implemented:'待开发'};
const receipt='docs/全平台发布接入计划.md';
export function publishingEvidence(id){
 const browser=['csdn','toutiao','zhihu','douyin','xiaohongshu','tencentcloud'].includes(id),wp=['wordpress','typecho','personal-site'].includes(id);
 const tested=['csdn','toutiao','zhihu'].includes(id);
 return Object.fromEntries(Object.keys(PUBLISHING_ACTION_LABELS).map(action=>{
  const implemented=id==='juejin'?action!=='publish':id==='aliyun'?true:id==='51cto'?true:id==='cnblogs'?action!=='prepare':wp?action!=='prepare':browser&&(action!=='draft'||['zhihu','toutiao','csdn','tencentcloud'].includes(id));
  const passed=id==='juejin'&&['identity','prepare','draft'].includes(action)||id==='aliyun'&&['identity','prepare','draft'].includes(action)||id==='51cto'&&['identity','prepare','draft','publish'].includes(action)||id==='tencentcloud'&&['identity','prepare','draft','publish'].includes(action)||id==='personal-site'&&['identity','draft','publish'].includes(action)||id==='cnblogs'&&['identity','draft','publish'].includes(action)||tested&&['identity','prepare'].includes(action)||['zhihu','csdn'].includes(id)&&action==='draft'||id==='zhihu'&&action==='publish';
  const status=!implemented?'not_implemented':passed?'passed':id==='xiaohongshu'?'paused':'pending';
  return [action,{implemented,liveAcceptance:status,label:PUBLISHING_ACCEPTANCE_LABELS[status],
   evidence:passed?{reference:id==='personal-site'?'docs/PERSONAL-SITE.md':receipt,connectorVersion:id==='zhihu'&&action==='draft'?'0.2.7':null,scope:id==='juejin'?'2026-10-28 Mac 桌面：账号1202233484255738自动识别；观引勾选掘金后自动填入纯文本与AI声明，编号草稿7701511332076519424重开核对完整正文及行数，产品显示草稿已保存；隔离实例正常退出重开后登录保留；公开提交和图片稿未开放':id==='aliyun'?'2026-10-26 Mac 桌面 r61：账号 lcl4vykma3p5c 自动识别；唯一非公开稿 1694249 由观引填写并保存，从草稿箱定位编号后重新打开核对全文及 AI 声明，产品显示草稿已保存。会话恢复有人工导航，登录回跳全自动与重启持久性未通过；图片未开放；公开提交代码已接入，实机验收待完成':id==='51cto'?'2026-10-23 Mac 桌面：账号17802063；新建两图草稿2103901自动保存并重开核对标题、全文和图片顺序；纯文本稿15031390审核通过后已由产品自动匿名核对全文并显示发布成功；两图草稿重启恢复通过，图片稿公开提交仍待实测':id==='tencentcloud'?'2026-10-23 Mac 桌面：账号 12809181、新建草稿 334630、完整正文重开核对、同稿自动公开提交与回执 2767527 已验收；后台已发布且匿名完整正文已人工核对；r39 已自动核对匿名完整正文并显示发布成功':id==='personal-site'?'2026-10-23 Mac 桌面实机：非公开草稿、勾选公开发布、匿名 HTTPS 全文哈希已核对；限已配置静态官网':id==='cnblogs'?'r19 真账号发布与匿名公开正文核验通过，原文 23402288':id==='zhihu'&&action==='publish'?'真实公开文章 2096634179358401344 已人工核对；产品公开正文自动核验尚未通过':id==='csdn'&&action==='draft'?'原稿 168768477 已保存并在草稿箱核对；公开提交因平台当日额度未完成':'专用非公开稿件验收'}:null}];
 }));
}
export function publishingEvidenceSummary(id,actions=publishingEvidence(id)){
 if(id==='juejin')return {stage:'纯文本草稿已实测',note:'Mac 桌面已通过自动识别账号、勾选平台、填稿、保存编号草稿及重开全文核对，回执自动回到观引；正常重开后登录保留。图片稿与公开提交未开放。'};
 if(id==='aliyun')return {stage:'纯文本草稿已实测',note:'Mac 桌面已通过账号识别、自动填稿、保存及原稿全文回读；公开提交试用已接入；10月28日账号复核遇登录失效，未新建或提交正常稿，待本人登录后验收；声明和安全验证由本人完成，图片尚未开放。'};
 if(id==='51cto')return {stage:'草稿与提交已实测',note:'Mac 桌面已通过全新两图草稿自动保存与回读；纯文本稿审核后已自动核对匿名全文并显示发布成功。图片稿公开提交仍待实测。'};
 if(id==='tencentcloud')return {stage:'草稿与公开发布已实测',note:'Mac 桌面已自动新建草稿并提交同一篇正式稿；后台已发布，匿名完整正文已核对；r39 已自动核对匿名完整正文并显示发布成功'};
 if(id==='cnblogs')return {stage:'草稿与公开发布已实测',note:'真实账号草稿、公开发布及匿名正文自动核验已通过；每次发送仍须取得自己的回执'};
 if(id==='zhihu')return {stage:'草稿与公开发布已实测',note:'已提交真实文章并人工核对公开正文；10月28日修复正文作者提取，原文匹配通过，匿名自动核验仍待通过，产品保持已提交'};
 if(id==='csdn')return {stage:'平台草稿已实测',note:'账号、填稿和平台草稿已验收；10月28日产品只读找回168768477并核对全文，保留禁止重发；当日额度已用完，公开提交仍待验收'};
 if(id==='toutiao')return {stage:'账号权益待处理',note:'已实测账号与填稿；当前官方后台要求完善账号信息开通发布权益，草稿和公开提交尚未验收通过'};
 if(id==='wechat')return {stage:'可准备公众号稿件',note:'支持本地排版、复制与下载；个人主体由本人发表。官方草稿与发表协议已实现，真实授权和发布尚未验收，未开放自动提交。'};
 if(id==='personal-site')return {stage:'官网草稿与发布已实测',note:'Mac 桌面已通过真实官网草稿、公开发布与匿名正文核验；需管理员先绑定受限发布端，其他网站与操作系统须单独验收。'};
 if(id==='typecho')return {stage:'接口已接入 · 待实测',note:'网站连接、草稿、原稿发布与恢复已实现；真实 Typecho 网站尚待验收，不能以自动测试代替'};
 if(id==='wordpress')return {stage:'可连接网站',note:'草稿与发布接口已实现；真实网站验收待完成，执行前须核对自己的账号权限'};
 if(actions.draft.liveAcceptance==='passed')return {stage:'平台草稿已实测',note:'账号、填稿与平台草稿已验收；公开提交仍待验收'};
 if(actions.prepare.liveAcceptance==='passed')return {stage:'已实测填稿',note:actions.draft.implemented?'账号与填稿已验收；平台草稿已实现待实机验收，公开提交待实机验收':'账号与填稿已验收；平台草稿待接入，公开提交待实机验收'};
 if(actions.prepare.liveAcceptance==='paused')return {stage:'验收已暂停',note:'已有适配代码；按用户要求暂停实机验收，尚不能宣称已可发布'};
 if(actions.prepare.implemented)return {stage:'接入验收中',note:'已有适配代码；账号、图片与填稿仍须实机验收'};
 return {stage:'待开发',note:'已列入完整接入计划，尚不能自动填稿或发布'};
}
