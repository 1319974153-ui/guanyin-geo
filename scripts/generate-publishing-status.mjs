import fs from 'node:fs';
import {publishingCatalog} from '../src/publishing-catalog.js';
import {PUBLISHING_ACTION_LABELS,PUBLISHING_EVIDENCE_DATE} from '../src/publishing-evidence.js';
const columns=Object.keys(PUBLISHING_ACTION_LABELS);
const markdown='# 发布平台能力与验收状态\n\n'+
 '记录日期：'+PUBLISHING_EVIDENCE_DATE+'。由 src/publishing-evidence.js 和平台目录生成，请勿手工修改。\n\n'+
 '本表描述产品的实现和验收进度，不代表当前账号已经登录或具备发布权限。实机已验收仅限对应动作；草稿不代表公开提交。浏览器账号是否可执行仍由连接器协议、身份核验与服务端开放动作决定。\n\n'+
 '| 平台 | '+Object.values(PUBLISHING_ACTION_LABELS).join(' | ')+' | 当前说明 |\n|---|---|---|---|---|---|\n'+
 publishingCatalog().map(p=>'| '+p.name+' | '+columns.map(k=>{const a=p.actionEvidence[k];return a.label+(a.implemented&&a.liveAcceptance!=='passed'?'（代码已实现）':'')+(a.evidence?.connectorVersion?' · '+a.evidence.connectorVersion:'')}).join(' | ')+' | '+p.note+' |').join('\n')+
 '\n\n人工核验记录见 [全平台发布接入计划](全平台发布接入计划.md)。自动测试、实机草稿、公开发布、正式发行分别留证。WordPress 的“填入编辑器”不在接口路径内，用户使用草稿/发布操作。\n';
fs.writeFileSync(new URL('../docs/平台能力与验收状态.md',import.meta.url),markdown);
