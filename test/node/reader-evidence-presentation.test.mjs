/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderReaderEvidenceExplanation,readerEvidenceSummary} from '../../chrome/content/zotero/research/shared/reader-evidence-detail.mjs';

function fixture(){
	let doc={createElementNS:(_ns,tag)=>new Element(tag)};
	class Element{
		constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.textContent='';this.open=false;}
		append(value){this.children.push(value);}
		replaceChildren(){this.children=[];this.textContent='';}
		get childElementCount(){return this.children.length;}
		querySelector(tag){for(let child of this.children){if(child.tag===tag)return child;let found=child.querySelector(tag);if(found)return found;}return null;}
	}
	return new Element('section');
}

test('the complete explanation renders once, without truncation or a second disclosure, preserving rich text and sources',()=>{
	let target=fixture(),sources=[{id:'paper-1',anchor:{pageIndex:3}}],material={revision:1,summary:'比较不同实验条件。'.repeat(40)+'完整说明最后一句。',imageExplanation:{sources,result:{sections:[{heading:'实验含义',body:'**完整段落**，包含原文证据 [1]。'}]}}},before=structuredClone(material),rendered=[];
	renderReaderEvidenceExplanation(target,material,{classPrefix:'asset-inline',renderText:(host,text,refs)=>{host.textContent=text;rendered.push({host,text,refs});}});
	assert.deepEqual(target.children.map(value=>value.tag),['div','section']);assert.equal(target.querySelector('details'),null);assert.equal(target.querySelector('summary'),null);
	assert.equal(target.children[0].textContent,material.summary);assert.equal(target.children[1].children[0].textContent,'实验含义');
	assert.deepEqual(rendered.map(value=>value.text),[material.summary,material.imageExplanation.result.sections[0].body]);
	for(let value of rendered)assert.strictEqual(value.refs,sources,'rich text retains the original evidence source objects');
	assert.deepEqual(material,before,'presentation does not rewrite saved summaries, section markdown or anchors');
});

test('short saved explanations are directly visible and pending placeholders stay out of saved explanation',()=>{
	let target=fixture();renderReaderEvidenceExplanation(target,{summary:'人工确认的短说明。',verification:'verified'});
	assert.deepEqual(target.children.map(value=>value.tag),['div']);assert.equal(target.children[0].textContent,'人工确认的短说明。');
	assert.equal(renderReaderEvidenceExplanation(target,{summary:'正在生成的临时说明',generationStatus:'pending'}),false);assert.equal(target.children.length,0);
	assert.equal(renderReaderEvidenceExplanation(target,{imageExplanation:{result:{sections:[{heading:'原文核对',body:'完整保留的结果。'}]}}}),true);assert.equal(target.children[0].tag,'section');assert.equal(target.children[0].children[1].textContent,'完整保留的结果。');
});

test('collapsed evidence previews are brief while complete saved explanation and sources remain unchanged',()=>{
 const material={summary:'这张图比较了同一数据集上的两种方法。'+ '完整方法与实验条件、数值和限制必须在展开后保留。'.repeat(18),imageExplanation:{sources:[{id:'origin',pageIndex:4}],result:{sections:[{heading:'实际观察',body:'完整的实验说明。'}]}}},saved=structuredClone(material);
 const brief=readerEvidenceSummary(material);
 assert.equal(brief,'这张图比较了同一数据集上的两种方法。'+ '完整方法与实验条件、数值和限制必须在展开后保留。'.repeat(5));
 assert.ok(brief.length<=160);assert.notEqual(brief,material.summary);assert.deepEqual(material,saved);
 const target=fixture();renderReaderEvidenceExplanation(target,material);assert.equal(target.children[0].textContent,material.summary);assert.equal(target.children[1].children[1].textContent,'完整的实验说明。');
 assert.equal(readerEvidenceSummary({summary:'**简要说明**与[原文](https://example.test)。'}),'简要说明与原文。');
 assert.equal(readerEvidenceSummary({summary:'临时说明',generationStatus:'pending'}),'');
 assert.equal(readerEvidenceSummary({imageExplanation:{result:{sections:[{body:'仅有详细说明时仍提供可点击的摘要。'}]}}}),'仅有详细说明时仍提供可点击的摘要。');
});

test('an existing summary paragraph inside the complete section is rendered only in that section',()=>{
 const target=fixture(),material={summary:'**图例与坐标轴**明确区分真实与仿真评测。',imageExplanation:{sources:[{id:'paper-figure'}],result:{sections:[{heading:'实验含义',body:'> 图例与坐标轴明确区分真实与仿真评测。\n\n真实评测使用 20 次试验，仿真评测使用 80 次试验。'},{heading:'误差定义',body:'误差条表示原图报告的置信区间。'}]}}},saved=structuredClone(material),rendered=[];
 renderReaderEvidenceExplanation(target,material,{renderText:(host,text,refs)=>{host.textContent=text;rendered.push({text,refs});}});
 assert.deepEqual(target.children.map(value=>value.tag),['section','section']);
 assert.deepEqual(rendered.map(value=>value.text),material.imageExplanation.result.sections.map(section=>section.body),'the full section body and its extra information are preserved');
 for(const row of rendered)assert.strictEqual(row.refs,material.imageExplanation.sources);
 assert.deepEqual(material,saved,'deduplication never changes the saved explanation or source references');
 assert.equal(readerEvidenceSummary(material),'图例与坐标轴明确区分真实与仿真评测。','the collapsed summary is still available');
});

test('normalization catches wrapped Markdown prefixes but keeps a summary with independent information',()=>{
 const target=fixture(),section={heading:'原图观察',body:'- **结果显示**两种方法的差异。\n\n其余完整实验条件。'},material={summary:'结果显示 两种方法的差异。',imageExplanation:{result:{sections:[section]}}};
 renderReaderEvidenceExplanation(target,material);assert.deepEqual(target.children.map(value=>value.tag),['section']);assert.equal(target.children[0].children[1].textContent,section.body);
 material.summary='结果显示两种方法的差异。独立摘要还说明了适用范围。';renderReaderEvidenceExplanation(target,material);
 assert.deepEqual(target.children.map(value=>value.tag),['div','section']);assert.equal(target.children[0].textContent,material.summary,'a partly overlapping summary retains all independent information');
 material.summary='a*b*c';material.imageExplanation.result.sections=[{heading:'符号核对',body:'abc'}];renderReaderEvidenceExplanation(target,material);assert.deepEqual(target.children.map(value=>value.tag),['div','section'],'multiplication symbols are not treated as Markdown emphasis');
});
