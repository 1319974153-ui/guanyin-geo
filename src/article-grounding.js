// A small negative check for high-risk, concrete capabilities. Absence of a
// finding does not prove that an article is factual or that every claim is supported.
const CAPABILITIES=[
 {id:'isolated_project_library',label:'为项目创建独立资料库',pattern:/(?:独立(?:的)?(?:项目)?资料库|(?:创建|建立|新建)(?:一个|单独的|新的)?项目资料库|(?:按项目|每个项目)(?:创建|建立|新建)[^，。]{0,9}资料库)/gu},
 {id:'automatic_provenance',label:'自动保存资料来源',pattern:/(?:自动(?:提取|保存|记录|补齐|识别|留存)[^，。]{0,14}(?:来源|出处)|(?:来源|出处)[^，。]{0,8}(?:自动记录|自动保存|自动识别))/gu},
 {id:'document_upload',label:'系统提供资料上传或导入',pattern:/(?:上传功能|(?:通过系统|在平台上|在软件中)[^，。]{0,12}(?:上传|导入)|导入(?:到|至)?(?:项目)?资料库)/gu},
 {id:'document_export',label:'可从系统导出资料',pattern:/(?:导出功能|导出(?:所需的|指定的|全部|完整)?(?:资料|文件|数据|报告)|(?:从|在)(?:该)?系统(?:中|里)?导出)/gu},
 {id:'new_project_menu',label:'有「新建项目」入口',pattern:/(?:点击|选择|点开|进入)[ 「『“「"']{0,4}新建项目|新建项目[」』”"']?\s*(?:选项|菜单|按钮|入口)/gu},
 {id:'revision_history',label:'系统提供版本历史入口',pattern:/(?:查找|查看|打开|提供|支持|寻找|点击)(?:[^，。！？；？\n]{0,8})(?:版本历史|修订记录)|(?:版本历史|修订记录)(?:选项|菜单|入口|功能)/gu},
 {id:'registration_required',label:'使用前必须注册账号',pattern:/(?:需要|需先|须先|必须|务必|要求|要先)\s*(?:先)?(?:注册|开通)(?:个人|团队|企业|使用|本平台|此平台|一个)?(?:账号|账户)?/gu},
 {id:'verified_material_guarantee',label:'资料均经过审查或验证',pattern:/(?:确保|保证)(?:每份|所有|全部)?(?:资料|材料)(?:都|均|已经|是|已经过|都是)?(?:经过|完成)(?:人工)?(?:审查|验证|审核)/gu}
];
const UNPROVEN=/(?:尚未|尚无|未见|未能|待核实|待确认|不确定|无法确认|无法证明|无法判断|不能推断|不能认定|不代表|并非|非必然|不能保证|不能确保|未提供|未记录|没有资料|没有依据|不支持|不提供|不具备|不可|是否(?:支持|提供|能|可以|具备)|如果(?:支持|提供|能|可以|具备)|假设|例如可以考虑|需要确认|建议核实|应先核实|请先核对)/u;
const DENIAL=/^(?:需要(?:进一步)?(?:确认|核实|验证)|待(?:确认|核实)|(?:(?:功能|按钮|入口|选项)?(?:还|目前|尚)?(?:未|不)(?:上线|开放|实现|支持|提供|可用|存在|包含))|\s*(?:只是示例|为假设))/u;
function lines(text){
 return String(text||'').match(/[^\r\n。！？；，!?;]+/gu)||[];
}
function hits(parts,rule,{fact=false}={}){
 const out=[];
 for(const part of parts){
  for(const m of part.matchAll(rule.pattern)){
   const before=part.slice(Math.max(0,m.index-36),m.index);
   if(rule.id==='revision_history'&&/(?:是否|如果|有无)[^，。]{0,12}$/u.test(before))continue;
   if(UNPROVEN.test(before)||DENIAL.test(part.slice(m.index+m[0].length).trim()))continue;
   if(fact&&/(?:计划|准备|预计|拟|希望|考虑|可能|建议|可考虑|以后|未来|调研|选型时)(?:[^，。]{0,9})$/u.test(before))continue;
   // Return a verbatim excerpt and keep it bounded for display and model input.
   out.push(part.trim().length<=180?part.trim():m[0]);break;
  }
 }
 return out;
}
export function articleGroundingFindings(text,facts=[]){
 const parts=lines(text);
 const sources=facts.filter(f=>!!String(f.source||'').trim()||!!String(f.sourceDocumentId||'').trim())
  .flatMap(f=>lines(f.value));
 return CAPABILITIES.flatMap(rule=>{
  const found=hits(parts,rule);
  if(!found.length||hits(sources,rule,{fact:true}).length)return [];
  return [{id:rule.id,label:rule.label,quote:found[0],suggestion:'删去这一具体能力或改成不指向品牌的通用建议；已有事实时，先登记并核对出处，再用含该依据的稿件送审。'}];
 });
}
export function hasGeneratedWritingBasis(article){
 return !!(article?.writingBasis||article?.provider||article?.aiRevision);
}
export function articleApprovalGrounding(previous,next,facts=next?.factSnapshots||[]){
 if(!hasGeneratedWritingBasis(previous)&&!hasGeneratedWritingBasis(next))return [];
 return articleGroundingFindings([next.title,next.text].filter(Boolean).join('\n'),facts);
}
export function articleGroundingMessage(findings){
 return '稿件有资料未支持的具体能力：'+findings.map(f=>f.label).join('、')+'。原稿仍在；请改正原句，或补齐出处并更新稿件依据后再确认。';
}
