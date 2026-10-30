/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFormulaInput,extractTexFormulas,searchFormulaEvidence,recognizeFormulaSource,explainFormulaSource,formulaSourceKey} from '../../chrome/content/zotero/research/shared/formula-research.mjs';

test('pasted display math and TeX document import preserve editable mathematical source',()=>{
	assert.equal(normalizeFormulaInput('$$x_i^2=\\frac{1}{2}$$'),'x_i^2=\\frac{1}{2}');
	assert.equal(normalizeFormulaInput('\\[E_{\\mathrm{F}}\\]'),'E_{\\mathrm{F}}');
	const rows=extractTexFormulas('\\documentclass{article}\n\\begin{document}\n\\begin{equation}x_i^2=1\\end{equation}\n$$y=2$$\n\\end{document}');assert.deepEqual(rows.map(row=>row.latex),['x_i^2=1','y=2']);
	assert.throws(()=>normalizeFormulaInput('\\input{private.tex}'),/不执行/);assert.throws(()=>extractTexFormulas('\\documentclass{article}\n\\section{No math}'),/未找到/);
	assert.throws(()=>normalizeFormulaInput('\\begin{document}x_i\\end{document}'),/不执行/);
});
test('formula search matches paper titles, theorem names, tags, source context and explicit LaTeX',()=>{
	const rows=[{paperTitle:'World Model',label:'Eq. 5',theoremName:'证据下界',tags:['VAE'],references:['Kullback Leibler divergence'],latex:'z_{t-1}'},{paperTitle:'TCOM',label:'Eq. 1'}];
	for(const query of ['world model','证据下界','vae','kullback','z_{t-1}'])assert.equal(searchFormulaEvidence(rows,query)[0],rows[0]);assert.deepEqual(searchFormulaEvidence(rows,'unknown'),[]);
});
const fixture=()=>{
	const state={formulaTranscriptions:{}},calls=[],E={settings:()=>({endpoint:'https://example.invalid/v1',model:'gpt-6-luna'}),previewImage:async()=> 'data:image/png;base64,complete-original',store:{get:(table,key)=>state[table]?.[key],update:async fn=>fn(state)},studio:{request:async(system,input,status,signal,options)=>{calls.push({system,input,options});return {value:{latex:'x_i^2=1',uncertainties:['检查下标 i']},model:'gpt-6-luna'};}}};return {E,state,calls};
};
test('recognition reads actual image pixels through authorized model and creates cached reviewable LaTeX without changing original',async()=>{
	const {E,calls}=fixture(),asset={id:'eq1',attachmentID:3,pageIndex:1,bbox:[1,2,3,4],path:'full.png',sourceText:'BROKEN OCR'},before=structuredClone(asset);
	const result=await recognizeFormulaSource(E,asset);assert.equal(result.latex,'x_i^2=1');assert.equal(result.needsReview,true);assert.deepEqual(result.uncertainties,['检查下标 i']);assert.deepEqual(asset,before);
	assert.equal(calls[0].options.modelConfig.model,'gpt-6-luna');assert.deepEqual(calls[0].options.images,['data:image/png;base64,complete-original']);assert.equal(calls[0].input.sourceText,undefined);
	assert.equal((await recognizeFormulaSource(E,asset)).cacheHit,true);assert.equal(calls.length,1);
	assert.notEqual(formulaSourceKey(asset),formulaSourceKey({...asset,bbox:[1,2,3,5]}));
});
test('no picture, cancelled or empty recognition cannot silently import an image as editable math',async()=>{
	const {E}=fixture();await assert.rejects(recognizeFormulaSource(E,{id:'no-pixels'}),/没有完整/);await assert.rejects(recognizeFormulaSource(E,{path:'full.png'},{signal:{aborted:true}}),/取消/);
	E.settings=()=>({endpoint:'https://openai.goldgom.top/v1',model:'gpt-6.1-sol'});assert.equal((await recognizeFormulaSource(E,{path:'full.png'})).latex,'x_i^2=1');
	E.settings=()=>({endpoint:'https://example.invalid',model:'gpt-6-luna'});E.studio.request=async()=>({value:{latex:''}});await assert.rejects(recognizeFormulaSource(E,{path:'full.png'},{fresh:true}),/没有返回可编辑/);
});
test('formula recognition and explanation preserve explicitly selected model and reasoning',async()=>{
	const {E,calls}=fixture(),modelConfig={endpoint:'https://example.invalid/v1',model:'configured-vision',thinkingLevel:'high',reasoningParameter:'reasoning_effort'};
	await recognizeFormulaSource(E,{path:'full.png'},{modelConfig});
	assert.equal(calls[0].options.modelConfig.model,'configured-vision');assert.equal(calls[0].options.modelConfig.thinkingLevel,'high');
	E.studio.request=async(system,input,status,signal,options)=>{calls.push({system,input,options});return {value:{text:'式中 $x_i$ 为原文的变量。'},model:'configured-vision'};};
	await explainFormulaSource(E,{latex:'x_i^2=1',sourceText:'Measured x_i.'},{modelConfig});
	assert.equal(calls.at(-1).options.modelConfig.model,'configured-vision');assert.equal(calls.at(-1).options.modelConfig.thinkingLevel,'high');assert.equal(calls.at(-1).options.images,undefined,'valid LaTeX needs no incompatible vision payload');
});
test('an invalid rendered transcription is rejected before it can poison the reusable formula cache',async()=>{
	const {E,state}=fixture(),asset={path:'full.png',id:'invalid-equation'};
	E.studio.request=async()=>({value:{latex:'\\notARealMacro{x}'}});
	await assert.rejects(recognizeFormulaSource(E,asset,{validate:()=>{throw Error('Invalid KaTeX');}}),/Invalid KaTeX/);
	assert.deepEqual(state.formulaTranscriptions,{});
});
test('ordinary formula UI settings infer the provider reasoning parameter without changing model or strength',async()=>{
	for (const [endpoint,model,reasoningParameter] of [['https://openai.goldgom.top/v1','gpt6luna','reasoning_effort'],['https://api.openai.com/v1','configured-model','reasoning_effort'],['https://api.deepseek.com/v1','deepseek-chat','thinking']]) {
		const {E,calls}=fixture(),modelConfig={endpoint,model,thinkingLevel:'high'};
		await recognizeFormulaSource(E,{path:'full.png'},{modelConfig});
		assert.equal(calls[0].options.modelConfig.reasoningParameter,reasoningParameter);
		E.studio.request=async(system,input,status,signal,options)=>{calls.push({options});return {value:{text:'式中 $x_i$ 为原文的变量。'},model};};
		await explainFormulaSource(E,{latex:'x_i^2=1',sourceText:'Measured x_i.'},{modelConfig});
		assert.equal(calls.at(-1).options.modelConfig.reasoningParameter,reasoningParameter);
		assert.equal(calls.at(-1).options.modelConfig.model,model);
		assert.equal(calls.at(-1).options.modelConfig.thinkingLevel,'high');
		assert.equal(modelConfig.reasoningParameter,undefined,'不修改调用方设置');
	}
});
test('formula explanation is source-linked and rejects added values without writing a manuscript',async()=>{
	const {E,calls}=fixture();E.studio.request=async(system,input,status,signal,options)=>{calls.push({system,input,options});return {value:{text:'式中 $x_i$ 的具体定义需查看来源，公式的平方项为 $x_i^2$。'},model:'gpt-6-luna'};};
	const value={latex:'x_i^2=1',asset:{id:'eq1',attachmentID:3,pageIndex:1,position:{rects:[[1,2,3,4]]}},sourceText:'Measured x_i.'},before=structuredClone(value),result=await explainFormulaSource(E,value);
	assert.equal(result.sources[0].attachmentID,3);assert.deepEqual(value,before);assert.match(calls[0].system,/不写论文正文/);
	E.studio.request=async()=>({value:{text:'准确率为98%。'}});await assert.rejects(explainFormulaSource(E,value),/原文没有/);
});
