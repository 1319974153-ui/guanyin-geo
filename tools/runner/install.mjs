import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
// Secrets arrive over hidden stdin; they never appear in arguments, source, plist or logs.
if(process.platform!=='darwin')throw new Error('This installer currently supports macOS');
if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:['inherit','ignore','inherit']});
console.log('Ready for private runner configuration on stdin (input hidden).');
let raw='';try{for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break}}finally{if(process.stdin.isTTY)spawnSync('stty',['echo'],{stdio:['inherit','ignore','inherit']})}
const config=JSON.parse(raw);if(!/^gr_[a-f0-9]{64}$/.test(config.runnerToken)||!config.siteServiceToken)throw new Error('Missing private configuration');
const origin=new URL(config.origin);if(origin.protocol!=='https:'||!origin.hostname.endsWith('.chatgpt.site')||origin.username||origin.password)throw new Error('Invalid Site origin');
const folder=path.join(os.homedir(),'Library','Application Support','Guanyin GEO Runner'),launchFolder=path.join(os.homedir(),'Library','LaunchAgents'),plist=path.join(launchFolder,'cn.guanyin.geo.runner.plist');
fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.chmodSync(folder,0o700);fs.mkdirSync(launchFolder,{recursive:true});
fs.copyFileSync(new URL('./run.mjs',import.meta.url),path.join(folder,'run.mjs'));fs.chmodSync(path.join(folder,'run.mjs'),0o600);
fs.writeFileSync(path.join(folder,'credentials.json'),JSON.stringify({...config,origin:origin.origin+'/',maxPerRun:4}),{mode:0o600});fs.chmodSync(path.join(folder,'credentials.json'),0o600);
for(const filename of ['stdout.log','stderr.log']){fs.writeFileSync(path.join(folder,filename),'',{mode:0o600});fs.chmodSync(path.join(folder,filename),0o600)}
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const variables=config.proxy?`<key>EnvironmentVariables</key><dict><key>HTTPS_PROXY</key><string>${xml(config.proxy)}</string><key>HTTP_PROXY</key><string>${xml(config.proxy)}</string><key>NODE_USE_ENV_PROXY</key><string>1</string></dict>`:'';
fs.writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>cn.guanyin.geo.runner</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(folder,'run.mjs'))}</string></array><key>StartInterval</key><integer>120</integer><key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string><key>WorkingDirectory</key><string>${xml(folder)}</string><key>StandardOutPath</key><string>${xml(path.join(folder,'stdout.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(folder,'stderr.log'))}</string>${variables}</dict></plist>`,{mode:0o600});
const uid=process.getuid(),target='gui/'+uid+'/cn.guanyin.geo.runner';
spawnSync('launchctl',['bootout',target],{stdio:'ignore'});
const result=spawnSync('launchctl',['bootstrap','gui/'+uid,plist],{encoding:'utf8'});if(result.status!==0)throw new Error('launchd bootstrap failed: '+result.status);
console.log(JSON.stringify({installed:true,intervalSeconds:120,folder,service:'cn.guanyin.geo.runner',credentials:'Private file, mode 0600; values not displayed'}));
