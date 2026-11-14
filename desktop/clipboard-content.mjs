// Explicit copy from the trusted local main window only; no clipboard reads.
export function clipboardContent(value){
 if(!value||typeof value.text!=='string'||value.text.length>1_000_000||value.html!==undefined&&(typeof value.html!=='string'||value.html.length>2_000_000))throw Error('复制内容无效或过长');
 return {text:value.text,...(value.html!==undefined?{html:value.html}:{})};
}
