import {SaxesParser} from 'saxes';

// Small, bounded XML-RPC codec. No DTDs, external entities or executable HTML.
const escape=s=>{s=String(s);if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s))throw Error('文字包含 XML 不支持的控制字符');return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')};
export function rpcValue(v){
 if(typeof v==='string')return '<value><string>'+escape(v)+'</string></value>';
 if(typeof v==='boolean')return '<value><boolean>'+(v?'1':'0')+'</boolean></value>';
 if(Number.isSafeInteger(v))return '<value><int>'+v+'</int></value>';
 if(v instanceof Date)return '<value><dateTime.iso8601>'+v.toISOString().slice(0,19).replace(/-/g,'')+'</dateTime.iso8601></value>';
 if(Array.isArray(v))return '<value><array><data>'+v.map(rpcValue).join('')+'</data></array></value>';
 if(v&&typeof v==='object')return '<value><struct>'+Object.entries(v).map(([k,x])=>'<member><name>'+escape(k)+'</name>'+rpcValue(x)+'</member>').join('')+'</struct></value>';
 throw Error('不支持的 XML-RPC 参数');
}
export function rpcRequest(method,params){
 if(!['blogger.getUsersBlogs','metaWeblog.newPost','metaWeblog.editPost','metaWeblog.getPost','metaWeblog.getRecentPosts'].includes(method))throw Error('未开放此博客操作');
 return '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>'+method+'</methodName><params>'+params.map(v=>'<param>'+rpcValue(v)+'</param>').join('')+'</params></methodCall>';
}
export function parseRpc(xml){
 if(typeof xml!=='string'||xml.length>1000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('博客接口 XML 无效或过大');
 const parser=new SaxesParser(),stack=[],roots=[];let count=0;
 parser.on('opentag',tag=>{if(++count>25000||stack.length>40||Object.keys(tag.attributes).length)throw Error('博客接口 XML 结构超限');const node={name:tag.name,text:'',children:[]};(stack.at(-1)?.children||roots).push(node);stack.push(node)});
 const text=s=>{if(stack.length)stack.at(-1).text+=s};parser.on('text',text);parser.on('cdata',text);parser.on('closetag',()=>stack.pop());parser.on('error',()=>{throw Error('博客接口 XML 无效')});
 parser.write(xml).close();
 const one=(node,name)=>{if(node?.children.length!==1||node.children[0].name!==name)throw Error('博客接口 XML 结构无效');return node.children[0]};
 function value(node){
  if(node?.name!=='value')throw Error('博客接口缺少值');if(!node.children.length)return node.text;
  if(node.children.length!==1)throw Error('博客接口存在歧义值');const t=node.children[0];
  if(['string','dateTime.iso8601'].includes(t.name)&&!t.children.length)return t.text;
  if(['int','i4','i8'].includes(t.name)&&!t.children.length&&/^-?\d+$/.test(t.text)&&Number.isSafeInteger(Number(t.text)))return Number(t.text);
  if(t.name==='boolean'&&!t.children.length&&/^[01]$/.test(t.text))return t.text==='1';
  if(t.name==='array')return one(t,'data').children.map(value);
  if(t.name==='struct'){const result=Object.create(null);for(const m of t.children){const [n,v]=m.children;if(m.name!=='member'||m.children.length!==2||n.name!=='name'||n.children.length||['__proto__','constructor','prototype'].includes(n.text)||Object.hasOwn(result,n.text))throw Error('博客接口字段无效');result[n.text]=value(v)}return result}
  throw Error('博客接口返回不支持的数据类型');
 }
 if(roots.length!==1||roots[0].name!=='methodResponse')throw Error('博客接口未返回 XML-RPC 回执');
 const root=roots[0];if(root.children.length===1&&root.children[0].name==='fault'){const fault=value(one(root.children[0],'value'));const code=Number.isSafeInteger(fault.faultCode)?fault.faultCode:'未知';throw Error('博客接口拒绝请求（'+code+'）；请检查平台访问权限和令牌')}
 return value(one(one(one(root,'params'),'param'),'value'));
}
