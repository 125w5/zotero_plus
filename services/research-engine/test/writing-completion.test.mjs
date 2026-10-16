import {sourceQuote} from '../../../chrome/content/zotero/research/shared/source-quote.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {completionProposal} from '../../../chrome/content/zotero/research/shared/writing-completion.mjs';
import {arxivID,assertPDF} from '../../../chrome/content/zotero/research/shared/arxiv.mjs';
import {chineseSummary} from '../../../chrome/content/zotero/research/shared/material-language.mjs';
import {sliceRuns} from '../../../chrome/content/zotero/research/shared/richtext.mjs';
function setup(text=''){const p=M.createProject('研究'),b=M.block('paragraph',p.sections[0].id,{text});p.blocks.push(b);return {p,b};}
test('Chinese material display preserves original source and rejects stale translations',()=>{const m={revision:2,summary:'An attention mechanism combines context.',sourceText:'Original evidence',summaryZh:'注意力机制整合上下文。',summaryZhRevision:2};assert.equal(chineseSummary(m),m.summaryZh);m.revision++;assert.match(chineseSummary(m),/正在整理中文/);assert.equal(m.sourceText,'Original evidence');assert.match(chineseSummary({summary:'CNN 提取特征。'}),/CNN/);});
test('paragraph splits preserve formatting on both sides',()=>{const runs=[{text:'前文',bold:true},{text:'公式说明',italic:true}];assert.deepEqual(sliceRuns(runs,0,3),[{text:'前文',bold:true},{text:'公',italic:true}]);assert.deepEqual(sliceRuns(runs,3,6),[{text:'式说明',italic:true}]);});
test('unbound paragraph completion is disabled before any candidate can be created',()=>{const {p,b}=setup(),before=JSON.stringify(p);assert.throws(()=>completionProposal(p,b,{text:'方法说明',contentKind:'method_explanation',evidence:[]},{start:0,end:0}),/AI 不代写/);assert.equal(JSON.stringify(p),before);});

test('old selection completion cannot replace surrounding prose or formulas',()=>{const {p,b}=setup('前文 $x_i$ 用户输入的选区 后文'),before=JSON.stringify(p);assert.throws(()=>completionProposal(p,b,{text:'替换文字'},{start:3,end:9}),/AI 不代写/);assert.throws(()=>M.applyProposal(p,{status:'pending',blockID:b.id,before:b.text,after:'AI新文字'}),/AI 不代写/);assert.equal(JSON.stringify(p),before);});

test('arxiv identifiers retain versions and PDF magic rejects HTML',()=>{assert.equal(arxivID('https://arxiv.org/pdf/1706.03762v7.pdf'),'1706.03762v7');assert.equal(arxivID('arXiv:hep-th/9901001'),'hep-th/9901001');assert.equal(arxivID('https://evil.test/1706.03762'),null);assert.throws(()=>assertPDF(new TextEncoder().encode('<html>'+'.'.repeat(200))));assertPDF(new TextEncoder().encode('%PDF-1.7\n'+'.'.repeat(200)));});

test('PDF quote matching tolerates line breaks but never paraphrases or combines passages',()=>{assert.equal(sourceQuote('The model\nuses attention.','The model uses attention.'),'The model\nuses attention.');assert.equal(sourceQuote('The model uses attention.','The model improves accuracy.'),null);assert.equal(sourceQuote('alpha middle omega','alpha omega'),null);});
