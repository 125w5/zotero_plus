import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as language from '../../../chrome/content/zotero/research/shared/material-language.mjs';
const code=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8');
function setup(request){const data={},E={manuscripts:{model:{}},assets:{key:values=>values.join('|')},store:{get:(...path)=>path.reduce((v,k)=>v?.[k],data),update:async fn=>fn(data)},studio:{request}};vm.runInNewContext(code,{Zotero:{Research:E,logError:()=>{}},ChromeUtils:{importESModule:()=>language}});return {A:E.manuscripts,data};}
const card=id=>({id,revision:1,title:'English material',sourceText:'A baseline is tested on held-out data.'});
test('waiting for a visible translation does not wait for unrelated background requests',async()=>{
 let release;const held=new Promise(r=>release=r);const {A}=setup(async(_,input)=>{if(input.materials[0].id.startsWith('b|'))await held;return {model:'controlled',value:{summaries:input.materials.map(m=>({id:m.id,title:'基线评估',text:'独立数据用于评估基线。'}))}};});
 const a=card('a'),b=card('b');A.ensureChineseSummaries([a]);const background=A.ensureChineseSummaries([b]);const visible=A.ensureChineseSummaries([a]);
 let timer;try{await Promise.race([visible,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('visible card waited for unrelated work')),200))]);assert.equal(A.summaryFor(a),'独立数据用于评估基线。');}finally{clearTimeout(timer);release();await background;}
});
test('a failed numeric summary does not discard valid cards from the same batch',async()=>{
 const {A}=setup(async(_,input)=>{if(!input.materials)throw Error('controlled retry unavailable');return {model:'controlled',value:{summaries:input.materials.map((m,i)=>({id:m.id,title:'方法',text:i?'准确率为99%。':'独立数据用于评估基线。'}))}};});
 const a=card('a'),b=card('b'),before=JSON.stringify([a,b]);await A.ensureChineseSummaries([a,b]);assert.equal(A.summaryFor(a),'独立数据用于评估基线。');assert.match(A.summaryFor(b),/暂未完成/);assert.equal(JSON.stringify([a,b]),before);
});
