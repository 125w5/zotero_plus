/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitFormula, normalizeMaterialContents, materialExplanationPatch, formulaEvidenceRows, assertExplanationNumbers} from '../../chrome/content/zotero/research/shared/material-content.mjs';
import {refineMaterialExplanation} from '../../chrome/content/zotero/research/manuscript/material-content-editor.mjs';
import {filterMaterialExclusions,materialAttachmentIDs} from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';

test('explanation whitelist cannot overwrite original source, geometry, original image or revisions', () => {
	const patch = materialExplanationPatch({summary: '中文说明', contents: [{type: 'formula', latex: 'x_i^2'}], sourceText: 'fake', anchor: {pageIndex: 3}, imagePath: 'fake', revision: 99});
	assert.deepEqual(Object.keys(patch), ['summary', 'contents']); assert.equal(patch.contents[0].latex, 'x_i^2');
});
test('formula preview consumes only saved LaTeX and never guesses a PDF transcription', () => {
	assert.equal(explicitFormula({kind: 'formula', sourceText: 'x i 2 = 1'}), '');
	assert.equal(explicitFormula({latex: 'x_i^2=1', sourceText: 'x i 2 = 1'}), 'x_i^2=1');
});
test('content roundtrip preserves formula source and source-free additional figures and tables', () => {
	const value = [{type: 'text', text: '原文说明 $x_i$'}, {type: 'formula', latex: 'E_{\\mathrm{F}}=\\frac{x_i^2}{2}'}, {type: 'image', imagePath: 'E:/my figure.png', caption: '测量结果'}, {type: 'table', rows: [['变量', '值'], ['x_i', 2]]}];
	const normalized = normalizeMaterialContents(value); assert.equal(normalized[1].latex, value[1].latex); assert.equal(normalized[3].rows[1][1], '2'); assert.deepEqual(normalizeMaterialContents(JSON.parse(JSON.stringify(normalized))), normalized);
});
test('bad explanation shapes and oversized tables are rejected before storage', () => {
	for (const value of [[{type: 'html', text: '<script>'}], [{type: 'image', imagePath: ''}], [{type: 'table', rows: [['a'], ['b', 'c']]}], [{type: 'table', rows: Array.from({length: 101}, () => ['a'])}], [{type: 'formula', latex: 1}]]) assert.throws(() => normalizeMaterialContents(value));
});
test('formula evidence is scoped to current papers, deduplicated by original crop and ordered by page', () => {
	const a = {kind: 'formula', attachmentID: 4, pageIndex: 1, bbox: [1, 2, 3, 4]}, b = {...a, pageIndex: 0}, foreign = {...a, attachmentID: 8};
	assert.deepEqual(formulaEvidenceRows([a, {...a}, foreign, {...a, kind: 'figure'}, b], {attachmentIDs: [4]}), [b, a]);
});
test('AI explanation is a draft, uses source, excludes manuscript body and preserves input', async () => {
	const material = {summary: '用户说明', sourceText: 'Original measured evidence.', anchor: {pageIndex: 2}}, before = structuredClone(material);
	const E = {studio: {request: async (system, input) => {assert.match(system, /不写、续写或改写论文正文/); assert.equal(input.sourceText, material.sourceText); assert.equal(input.blocks, undefined); return {value: {summary: '仅解释原文报告的观察。'}};}}};
	assert.equal(await refineMaterialExplanation(E, material, material.summary), '仅解释原文报告的观察。'); assert.deepEqual(material, before);
	await assert.rejects(refineMaterialExplanation(E, {sourceText: ''}, ''), /没有原文/);
});
test('AI explanation obeys native material exclusions and refuses fully excluded or changed evidence', async () => {
	const material={id:'m1',sourceText:'Before OMITTED after.',anchor:{attachmentID:7,pageIndex:0,sourceText:'Before OMITTED after.'}},before=structuredClone(material),inputs=[];
	let quote='OMITTED',revision=0,changeDuringRequest=false;
	const E={manuscripts:{materialAttachmentIDs,prepareMaterialExclusions:async()=>{},materialExclusionSignature:()=>revision,filterAutomaticMaterials:(cards,options)=>filterMaterialExclusions(cards,{...options,exclusionsFor:()=>[{annotationKey:'MARK',attachmentID:7,quote,position:{pageIndex:0}}]})},studio:{request:async(_system,input)=>{inputs.push(input);if(changeDuringRequest)revision++;return {value:{summary:'依据保留的原文整理说明。'}};}}};
	await refineMaterialExplanation(E,material,'');assert.equal(inputs[0].sourceText,'Before \n\n after.');assert.deepEqual(material,before);
	quote=material.sourceText;await assert.rejects(refineMaterialExplanation(E,material,''),/已排除/);assert.equal(inputs.length,1,'a fully excluded excerpt never invokes AI');
	quote='OMITTED';changeDuringRequest=true;await assert.rejects(refineMaterialExplanation(E,material,''),/排除标记已改变/);assert.deepEqual(material,before);
});
test('number fidelity accepts equivalent scientific notation and unicode minus without inventing values', () => {
	assert.equal(assertExplanationNumbers('误差为 0.0012，系数为 −0.5，准确率为95%。', '1.2 × 10^{−3}, -0.500, 95 %'), '误差为 0.0012，系数为 −0.5，准确率为95%。');
	assertExplanationNumbers('误差为1.20e−3', '1.2 \\times 10^{-3}');
	assertExplanationNumbers('概率为0.001', '10^{-3}');
	assertExplanationNumbers('样本数为1000', '1,000 samples');
	assert.throws(() => assertExplanationNumbers('结果提高98%', '95%'), /原文没有/);
	assert.throws(() => assertExplanationNumbers('提高0.95', '95%'), /原文没有/);
	assert.throws(() => assertExplanationNumbers('结果0.5', '\\frac{1}{2}'), /原文没有/);
	assert.throws(() => assertExplanationNumbers('1.000000000000000000009', '1.000000000000000000001'), /原文没有/);
	assertExplanationNumbers('12e−1001', '1.2e−1000');
});
