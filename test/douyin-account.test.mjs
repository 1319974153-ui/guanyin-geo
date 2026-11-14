import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {douyinAccountPage} from '../browser-extension/douyin-account.js';
function run(labels,url='https://creator.douyin.com/creator-micro/home'){
 const u=new URL(url),context=vm.createContext({location:u,getComputedStyle:()=>({visibility:'visible'}),document:{querySelectorAll:()=>labels.map(v=>({innerText:v.text??v,getClientRects:()=>v.hidden?[]:[{}],closest:()=>v.article?{}:null}))}});
 return vm.runInContext('('+douyinAccountPage.toString()+')()',context);
}
test('homepage visible ID is read without nickname inference or credentials',()=>{
 assert.equal(run(['抖音号：21037695064','抖音号：21037695064']).accountId,'21037695064');
 assert.equal(run(['温舒']).accountId,undefined);
 for(const labels of [[],['抖音号：1','抖音号：2'],[{text:'抖音号：1',article:true}],[{text:'抖音号：1',hidden:true}],['其他人 抖音号：1']])assert.ok(run(labels).connectorError);
 for(const url of ['https://creator.douyin.com/creator-micro/content/upload','https://evil.test/creator-micro/home'])assert.ok(run(['抖音号：1'],url).connectorError);
});
