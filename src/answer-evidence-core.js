export function answerSnapshot(a){return Object.fromEntries(['id','brandId','promptId','questionText','questionVersion','productId','productSnapshot','platform','surface','entry','mode','region','language','date','text','citations','publicSearchProcess','model','requestId'].map(k=>[k,a[k]??null]));}
export function snapshotText(a){return JSON.stringify(answerSnapshot(a));}
