/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {boundedMapSet} from '../../chrome/content/zotero/research/shared/paper-overview-data.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-results.js',import.meta.url),'utf8');
function fixture({machine=false,machineFails=false}={}){
 const state={},calls={model:0,resolve:0,machine:0};
 const E={
  assets:{key:parts=>JSON.stringify(parts)},core:{endpoint:value=>value},
  store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async mutator=>mutator(state)},
  settings:()=>({endpoint:'https://controlled.invalid',youdaoAppID:machine?'controlled':''}),
  credentials:{get:async()=> 'controlled-test-key'},
  resolveModel:async()=>{calls.resolve++;return {model:'gpt-6-luna'};},
  requestProvider:async()=>{calls.model++;return {text:'受控学术译文',finishReason:'stop'};},
  translateYoudao:async()=>{calls.machine++;if(machineFails)throw Error('受控机翻失败');return {text:'受控机器译文',provider:'受控机翻'};}
 };
 vm.runInNewContext(source,{Zotero:{Research:E},ChromeUtils:{importESModule:path=>path.endsWith('paper-overview-data.mjs')?{boundedMapSet}:{chatRequiresStreaming:()=>false}}});
 return {E,state,calls};
}
test('overview machine-only translation never invokes a model when machine translation is unconfigured',async()=>{
 const {E,calls}=fixture();await assert.rejects(E.quickTranslate('Abstract content',undefined,{allowModelFallback:false}),/机器翻译暂不可用/);
 assert.equal(calls.model,0);assert.equal(calls.resolve,0);assert.equal(calls.machine,0);
});
test('a machine translation failure preserves the original abstract without a model fallback',async()=>{
 const {E,calls}=fixture({machine:true,machineFails:true});await assert.rejects(E.quickTranslate('Abstract content',undefined,{allowModelFallback:false}),/受控机翻失败/);
 assert.equal(calls.model,0);assert.equal(calls.resolve,0);assert.equal(calls.machine,1);
});
test('machine-only translation still uses available machine translation and persists its result',async()=>{
 const {E,calls,state}=fixture({machine:true});const first=await E.quickTranslate('Abstract content',undefined,{allowModelFallback:false}),again=await E.quickTranslate('Abstract content',undefined,{allowModelFallback:false});
 assert.equal(first.text,'受控机器译文');assert.equal(again.cacheHit,true);assert.equal(calls.machine,1);assert.equal(calls.model,0);assert.equal(Object.keys(state.translationCache).length,1);
});
test('existing callers retain the controlled academic model fallback by default',async()=>{
 const {E,calls}=fixture();assert.equal((await E.quickTranslate('Abstract content')).text,'受控学术译文');assert.equal(calls.model,1);assert.equal(calls.resolve,1);
});
