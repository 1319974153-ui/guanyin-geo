// Product acceptance evidence only. Never used to grant an account permission.
export const PUBLISHING_EVIDENCE_DATE='2026-10-22';
export const PUBLISHING_ACTION_LABELS={identity:'账号核验',prepare:'填入编辑器',draft:'平台草稿',publish:'公开提交'};
export const PUBLISHING_ACCEPTANCE_LABELS={passed:'实机已验收',pending:'待实机验收',paused:'验收已暂停',not_implemented:'待开发'};
const receipt='docs/全平台发布接入计划.md';
export function publishingEvidence(id){
 const browser=['csdn','toutiao','zhihu','douyin','xiaohongshu'].includes(id),wp=id==='wordpress';
 const tested=['csdn','toutiao','zhihu'].includes(id);
 return Object.fromEntries(Object.keys(PUBLISHING_ACTION_LABELS).map(action=>{
  const implemented=id==='cnblogs'?action!=='prepare':wp?action!=='prepare':browser&&(action!=='draft'||['zhihu','toutiao','csdn'].includes(id));
  const passed=id==='cnblogs'&&['identity','draft'].includes(action)||tested&&['identity','prepare'].includes(action)||id==='zhihu'&&action==='draft';
  const status=!implemented?'not_implemented':passed?'passed':id==='xiaohongshu'?'paused':'pending';
  return [action,{implemented,liveAcceptance:status,label:PUBLISHING_ACCEPTANCE_LABELS[status],
   evidence:passed?{reference:receipt,connectorVersion:id==='zhihu'&&action==='draft'?'0.2.7':null,scope:id==='cnblogs'?'r11 真账号草稿、重复点击与重启读回通过；公开发布待验收':'专用非公开稿件；公开提交未验收'}:null}];
 }));
}
export function publishingEvidenceSummary(id,actions=publishingEvidence(id)){
 if(id==='cnblogs')return {stage:'草稿已实测 · 发布待实测',note:'真实账号草稿、重复点击与重启读回已验收；公开提交接口已实现，公开正文核验后才显示发布成功'};
 if(id==='wordpress')return {stage:'可连接网站',note:'草稿与发布接口已实现；真实网站验收待完成，执行前须核对自己的账号权限'};
 if(actions.draft.liveAcceptance==='passed')return {stage:'平台草稿已实测',note:'账号、填稿与平台草稿已验收；公开提交仍待验收'};
 if(actions.prepare.liveAcceptance==='passed')return {stage:'已实测填稿',note:actions.draft.implemented?'账号与填稿已验收；平台草稿已实现待实机验收，公开提交待实机验收':'账号与填稿已验收；平台草稿待接入，公开提交待实机验收'};
 if(actions.prepare.liveAcceptance==='paused')return {stage:'验收已暂停',note:'已有适配代码；按用户要求暂停实机验收，尚不能宣称已可发布'};
 if(actions.prepare.implemented)return {stage:'接入验收中',note:'已有适配代码；账号、图片与填稿仍须实机验收'};
 return {stage:'待开发',note:'已列入完整接入计划，尚不能自动填稿或发布'};
}
