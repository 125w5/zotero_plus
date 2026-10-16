/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installRapidReading} from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';
import {rapidReadingEditKey} from '../../chrome/content/zotero/research/shared/rapid-reading-data.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture({summary='原文条件为 $x \\leq 2$，准确率为 95%。',source='The original paper gives the condition x ≤ 2 and an accuracy of 95%.'}={}){
 const state={},calls=[],settings={endpoint:'https://configured.invalid/v1/',model:'default-model',thinkingLevel:'off',reasoningParameter:'provider_reasoning'},session={modelID:'selected-reading-model',thinkingLevel:'high'};
 let answer='这是所选速读笔记的解释。';
 const paper={id:7,getField:field=>field==='title'?'Controlled paper':''},attachment={id:13,parentItem:paper,isPDFAttachment:()=>true,dateModified:'controlled'};
 const E={store:{get:(branch,key)=>branch?key===undefined?state[branch]:state[branch]?.[key]:state,update:async fn=>fn(state)},settings:()=>settings,core:{endpoint:value=>value.replace(/\/+$/u,'')},workbenchConversations:{getForScope:scope=>{assert.equal(scope.paperID,7);return session;}},assets:{key:value=>JSON.stringify(value),fileSignature:async()=> 'pdf-controlled',index:async()=>({pdfHash:'pdf-controlled',assets:[]})},library:{describe:()=>({id:13}),sources:async()=>({sources:[{id:'original-page',attachmentID:13,pageIndex:0,label:'Page 1',text:source}],warnings:[]})},studio:{request:async(system,input,status,signal,options)=>{calls.push({system,input,status,signal,options});return {value:input.evidenceExcerpts?{sections:[{role:'method',heading:'条件与结果',points:[{text:summary,quoteIDs:[input.evidenceExcerpts[0].quoteID]}]}]}:{text:answer},model:options.modelConfig.model,at:'controlled'};}},setTimeout,clearTimeout};
 const Zotero={getMainWindow:()=>({AbortController}),Items:{getAsync:async()=>attachment},logError:()=>{}};installRapidReading(E,{Zotero});
 const local=await E.prepareReaderRapidReading(13),section=local.record.sections[0],point=section.points[0],pointKey=E.assets.key(rapidReadingEditKey(section,0,point,0));calls.length=0;
 const request=options=>E.requestReaderRapidReadingSelection({local,pointKey,summaryText:point.text,text:point.text,mode:'explain',...options});
 return {E,state,calls,settings,session,local,point,pointKey,request,setAnswer:value=>{answer=value;}};
}

test('selection requests use the current exact selected model and send only authenticated derived text with canonical evidence',async()=>{
 const f=await fixture(),{E,state,calls,settings,session,local,point,request}=f,before=structuredClone({state,settings,session,local}),signal=new AbortController().signal,status=()=>{};
 assert.equal(await request({text:'准确率为 95%',signal,status}),'这是所选速读笔记的解释。');assert.equal(calls.length,1);
 const call=calls[0];assert.deepEqual(call.options.modelConfig,{...settings,endpoint:'https://configured.invalid/v1',model:'selected-reading-model',thinkingLevel:'high',selectedModel:true});assert.equal(call.options.maxTokens,2000);assert.strictEqual(call.signal,signal);assert.strictEqual(call.status,status);
 assert.equal(call.input.mode,'explain');assert.equal(call.input.summaryText,point.text);assert.equal(call.input.selectedSummaryText,'准确率为 95%');assert.deepEqual(call.input.evidence,point.evidence);assert.equal(call.input.sources,undefined);assert.match(call.system,/派生的速读研究笔记/);assert.match(call.system,/不得改写原始论文或用户稿件/);
 session.modelID='newly-selected-model';session.thinkingLevel='off';settings.endpoint='https://another.invalid/v1/';settings.reasoningParameter='another_parameter';await request();assert.equal(calls[1].options.modelConfig.model,'newly-selected-model');assert.equal(calls[1].options.modelConfig.thinkingLevel,'off');assert.equal(calls[1].options.modelConfig.endpoint,'https://another.invalid/v1');assert.equal(calls[1].options.modelConfig.reasoningParameter,'another_parameter');
 assert.deepEqual(state,before.state);assert.deepEqual(local,before.local);E.stopRapidReadingPreparation();
});

test('original paper text, manuscript text, unknown points, stale edits and unselected text cannot reach the model',async()=>{
 const {E,state,calls,local,point,pointKey,request}=await fixture();
 for(const options of [{summaryText:local.sources[0].text,text:local.sources[0].text},{summaryText:'用户稿件：新的论断。',text:'新的论断。'},{pointKey:'nonexistent-point'},{text:'没有选中的句子'},{text:''},{text:'x'.repeat(5001)},{mode:'draft'},{local:{...local,cacheKey:'missing-cache'}}])await assert.rejects(request(options));
 state.rapidReadEdits={[local.cacheKey]:{points:{[pointKey]:{originalText:'old generated summary',text:'过期本地改写。'}}}};await assert.rejects(request({summaryText:'过期本地改写。',text:'过期本地改写。'}));
 assert.equal(calls.length,0);assert.equal(await request({text:point.text}),'这是所选速读笔记的解释。');assert.equal(calls.length,1);E.stopRapidReadingPreparation();
});

test('a saved matching local summary edit is selectable while regenerated original points reject the stale selection key',async()=>{
 const {E,state,calls,local,point,pointKey,request}=await fixture(),edited='我的速读笔记：条件仍为 $x \\leq 2$，准确率仍为 95%。';
 state.rapidReadEdits={[local.cacheKey]:{points:{[pointKey]:{originalText:point.text,text:edited,origin:'manual'}}}};const before=structuredClone({state,local});
 await request({summaryText:edited,text:'条件仍为 $x \\leq 2$'});assert.equal(calls[0].input.summaryText,edited);assert.deepEqual(calls[0].input.evidence,point.evidence);assert.deepEqual({state,local},before);
 state.rapidReads[local.cacheKey].sections[0].points[0].text='新的模型解析。';await assert.rejects(request({summaryText:edited,text:'条件仍为 $x \\leq 2$'}),/当前已核对/);assert.equal(calls.length,1);E.stopRapidReadingPreparation();
});

test('faithful rewrite accepts preserved formulas, ordered numbers and newlines without changing any stored reading or evidence',async()=>{
 const f=await fixture({summary:'在 $x \\leq 2$ 条件下，准确率为 95%，样本数为 120。\n另有 y = x²。'}),{E,state,local,calls,request}=f,before=structuredClone({state,local});
 const rewrite='当 $x \\leq 2$ 成立时，准确率达到 95%，包含 120 个样本。\n此外，y = x²。';f.setAnswer(rewrite);
 assert.equal(await request({mode:'rewrite'}),rewrite);assert.equal(calls[0].input.mode,'rewrite');assert.deepEqual({state,local},before);E.stopRapidReadingPreparation();
});

test('faithful rewrite rejects changed LaTex, numeric associations, plain math and Unicode powers',async()=>{
 for(const [summary,changed]of [['条件为 $x \\leq 2$。','条件为 $x \\geq 2$。'],['条件为 \\(x \\leq 2\\)。','条件为 \\(x \\geq 2\\)。'],['公式为 \\[y=x^2\\]。','公式为 \\[y=z^2\\]。'],['组 A 为 95%，组 B 为 80%。','组 A 为 80%，组 B 为 95%。'],['条件为 x ≤ 2。','条件为 x ≥ 2。'],['公式为 y = x²。','公式为 y = x³。'],['采用变量 x_i。','采用变量 x_j。'],['准确率为 95%。','准确率为 96%。']]){
  const f=await fixture({summary});f.setAnswer(changed);const before=structuredClone({state:f.state,local:f.local});await assert.rejects(f.request({mode:'rewrite'}),/保留选段数值或公式/,summary+' → '+changed);assert.deepEqual({state:f.state,local:f.local},before);f.E.stopRapidReadingPreparation();
 }
});

test('selection cancellation before or during provider work prevents a late answer and all stored mutations',async()=>{
 const {E,state,local,calls,request}=await fixture(),before=structuredClone({state,local}),preCancelled=new AbortController();preCancelled.abort();await assert.rejects(request({signal:preCancelled.signal}),/已停止/);assert.equal(calls.length,0);
 const gate=deferred(),started=deferred(),original=E.studio.request;E.studio.request=async(...args)=>{started.resolve();await gate.promise;return original(...args);};const cancelled=new AbortController(),pending=request({signal:cancelled.signal});await started.promise;cancelled.abort();gate.resolve();await assert.rejects(pending,/已停止/);assert.deepEqual({state,local},before);
 const stopGate=deferred(),stopStarted=deferred();E.studio.request=async(...args)=>{stopStarted.resolve();await stopGate.promise;return original(...args);};const stopped=request();await stopStarted.promise;E.stopRapidReadingPreparation();stopGate.resolve();await assert.rejects(stopped,/已停止/);assert.deepEqual({state,local},before);
});

test('selection rejects malformed or oversized model answers without altering the verified record',async()=>{
 const f=await fixture(),before=structuredClone({state:f.state,local:f.local});
 for(const answer of [null,'', '   ','x'.repeat(5001)]){f.setAnswer(answer);await assert.rejects(f.request(),/未返回可用/);assert.deepEqual({state:f.state,local:f.local},before);}f.E.stopRapidReadingPreparation();
});
