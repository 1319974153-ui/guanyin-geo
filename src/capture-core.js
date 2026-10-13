const contextFields=['brandId','promptId','questionVersion','questionText','platform','entry','mode','region','language','model','productId'];
export function attachCaptureBaseline(record,input,state){
 if(!input.baselineAnswerId)return record;
 const baseline=state.answers.find(a=>a.id===input.baselineAnswerId&&a.brandId===record.brandId);
 const fail=message=>{throw Object.assign(new Error(message),{status:400})};
 if(!baseline||baseline.surface!=='import'||baseline.status!=='ok'||baseline.demo)fail('复测基线不存在或不是正式消费端记录');
 if(record.surface!=='import'||record.demo)fail('同条件复测只能关联正式消费端记录');
 if(contextFields.some(k=>(baseline[k]||'')!==(record[k]||'')))fail('复测条件与原记录不同，请按原问题版本、平台、入口、模式、地区、语言及模型采集，或作为新基线保存');
 if(Date.parse(record.date)<=Date.parse(baseline.date))fail('复测采样时间必须晚于基线');
 return {...record,baselineAnswerId:baseline.id,baselineContext:Object.fromEntries(contextFields.map(k=>[k,baseline[k]||''])),baselineDate:baseline.date};
}

export function protectTrialAnswers(current,next){
 for(const old of current.answers)if(old.demo&&!next.answers.find(a=>a.id===old.id)?.demo&&next.answers.some(a=>a.id===old.id))throw Object.assign(new Error('试用回答不能转为正式证据，请重新采集真实回答'),{status:400});
 let changed=true;while(changed){changed=false;for(const a of next.answers)if(!a.demo&&a.baselineAnswerId&&next.answers.some(b=>b.id===a.baselineAnswerId&&b.demo)){a.demo=true;changed=true}}
}
