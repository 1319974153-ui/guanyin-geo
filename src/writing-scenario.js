// A brand can serve several settings. The question determines which of those
// settings the reader is asking about; product facts can only fill in a gap.
const cleaningSettings=[
 {name:'住宿经营场所',words:/酒店|宾馆|客房部|民宿|退房|入住/u},
 {name:'家庭住宅',words:/家庭|住宅|家政|居家|自家/u},
 {name:'办公场所',words:/办公楼|写字楼|办公室|工位/u}
];
function venues(text){return cleaningSettings.filter(v=>v.words.test(text)).map(v=>v.name)}
export function cleaningScope(question,facts=[]){
 if(!/清洁|保洁/u.test(question))return null;
 const explicit=venues(question);
 return explicit.length?explicit:venues(facts.map(f=>f.value).join(' '));
}
export function outsideCleaningScope(scope,text){
 return !!scope&&venues(text).some(name=>!scope.includes(name));
}
export function writingFactsInScope(question,facts){
 const scope=cleaningScope(question);
 if(!scope?.length)return facts;
 return facts.filter(f=>{const named=venues(f.value);return !named.length||named.some(name=>scope.includes(name))});
}

export function changesSelectionDecision(question,passage){
 const selection=/适合|合适|如何选|怎么选|怎样选|比较/u;
 const demand=/是否需要|要不要|是否有必要|有没有必要/u;
 if(!selection.test(question)||demand.test(question))return false;
 return /(?:是否需要|要不要|是否有必要|有没有必要)(?:购买|选购|聘请|雇用|外部顾问|这类服务|引入|采购|请顾问)/u.test(passage);
}

export function isRecordsDecision(question){
 return /(?:整理|梳理|归集|归档).{0,8}(?:资料|文档|记录)|(?:资料|文档|记录).{0,5}(?:整理|梳理|归集|归档)/u.test(question);
}
export function outsideRecordsDecision(question,passage){
 return isRecordsDecision(question)&&!/舆情|法(?:律|务)|合规|客诉处理|应急预案/u.test(question)&&/舆情|法律风险|风险条款|安抚话术|应急预案|客诉处理方案/u.test(passage);
}
