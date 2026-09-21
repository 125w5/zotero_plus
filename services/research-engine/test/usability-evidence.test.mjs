import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {materialExcerpts,bindMaterialEvidence} from '../../../chrome/content/zotero/research/shared/material-evidence.mjs';
test('material evidence binds original PDF text and individual table cells, rejecting invented IDs',()=>{
 const materials=[{id:'pdf',sourceText:'The conﬁguration\nuses CNN.'},{id:'table',data:{rows:[['方法','结果'],['CNN','待验证']]}},{id:'idea',kind:'idea',sourceText:'不能当证据'}];
 const q=materialExcerpts(materials);assert.ok(!q.some(x=>x.materialID==='idea'));
 const cell=q.find(x=>x.quote==='CNN');const value=bindMaterialEvidence({evidence:[{quoteID:q[0].quoteID},{quoteID:cell.quoteID}]},q);
 assert.equal(value.evidence[0].quote,materials[0].sourceText);assert.deepEqual(value.evidence[1].cell,{row:1,col:0});
 assert.throws(()=>bindMaterialEvidence({evidence:[{quoteID:'Q404'}]},q),/不存在/);
});
const source=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/model-service.js',import.meta.url),'utf8');
test('model discovery shares requests and migrates only invalid official model IDs',async()=>{
 const state={settings:{endpoint:'https://api.deepseek.com',model:'deepseek-v4-flash'}};let calls=0;
 const E={core:{endpoint:x=>x},credentials:{get:async()=>''},requestProvider:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return JSON.stringify({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]});},store:{update:async fn=>fn(state)}};
 vm.runInNewContext(source,{Zotero:{Research:E},URL});
 const [a,b]=await Promise.all([E.resolveModel({...state.settings}),E.resolveModel({...state.settings})]);assert.equal(a.model,'deepseek-flash');assert.equal(b.model,a.model);assert.equal(calls,1);assert.equal(state.settings.model,a.model);
 assert.equal((await E.resolveModel({...state.settings,model:'deepseek-v4-pro'})).model,'deepseek-v4-pro');
 assert.equal((await E.resolveModel({endpoint:'https://custom.example',model:'custom-model'})).model,'custom-model');assert.equal(calls,1);
});

const studioSource=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8');
function studioHarness(replies){
 const calls=[],cached=[];
 const E={studio:{model:{}},settings:()=>({}),resolveModel:async()=>({endpoint:'https://provider.example',model:'controlled'}),core:{endpoint:x=>x},credentials:{get:async()=> 'controlled-test-key'},assets:{key:()=> 'test-cache'},aiProgress:(_model,stage)=>stage,setTimeout,clearTimeout,
  runArtifactEngine:async command=>{if(command.operation==='assets-cache-get')return {miss:true};cached.push(command.value);}};
 vm.runInNewContext(studioSource,{URL,Zotero:{Research:E,getMainWindow:()=>({AbortController,fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));const next=replies.shift();return {ok:true,json:async()=>({choices:[{message:{content:next.text},finish_reason:next.finish||'stop'}]})};}})}});
 return {E,calls,cached};
}
test('studio repairs malformed JSON only once and caches only parsed output',async()=>{
 const {E,calls,cached}=studioHarness([{text:'{broken'},{text:'{"text":"中文正文","evidenceIDs":["S1"]}'}]);
 const record=await E.studio.request('Return JSON',{sources:['S1']},()=>{});
 assert.equal(calls.length,2);assert.equal(record.value.text,'中文正文');assert.equal(cached.length,1);
 assert.equal(calls[1].messages[2].role,'assistant');assert.match(calls[1].messages[3].content,/不新增事实/);
 const failed=studioHarness([{text:'invalid'},{text:'still invalid'}]);
 await assert.rejects(failed.E.studio.request('Return JSON',{},()=>{}),/已有内容已保留/);
 assert.equal(failed.calls.length,2);assert.equal(failed.cached.length,0);
});
test('studio rejects length-truncated output without caching or repetitive retries',async()=>{
 const {E,calls,cached}=studioHarness([{text:'{"text":"partial"}',finish:'length'}]);
 await assert.rejects(E.studio.request('Return JSON',{},()=>{}),/长度上限/);
 assert.equal(calls.length,1);assert.equal(cached.length,0);
});
