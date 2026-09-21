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
test('unbound paragraph can receive actual Chinese method prose, never invented results',()=>{const {p,b}=setup();const d=completionProposal(p,b,{text:'注意力机制通过输入之间的关联整合上下文，这里仅作一般性方法说明，具体实现仍需核对来源。',contentKind:'method_explanation',evidence:[]},{start:0,end:0});M.applyProposal(p,d);assert.match(b.text,/注意力/);assert.equal(b.claim,false);assert.throws(()=>completionProposal(p,b,{text:'实验结果表明准确率达到了99%，说明该方法具有显著优势。',contentKind:'background',evidence:[]},{start:0,end:0}));});
test('selection replacement preserves surrounding prose and formulas',()=>{const {p,b}=setup('前文 $x$ 需要修改的选区 后文');const start=b.text.indexOf('需要'),end=start+7;const d=completionProposal(p,b,{text:'输入特征在不同位置之间进行信息交互，从而形成对当前上下文的联合表征。',contentKind:'method_explanation',evidence:[]},{start,end});assert.ok(d.after.startsWith('前文 $x$ '));assert.ok(d.after.endsWith('后文'));b.text+='用户新输入';assert.throws(()=>M.applyProposal(p,d));});
test('arxiv identifiers retain versions and PDF magic rejects HTML',()=>{assert.equal(arxivID('https://arxiv.org/pdf/1706.03762v7.pdf'),'1706.03762v7');assert.equal(arxivID('arXiv:hep-th/9901001'),'hep-th/9901001');assert.equal(arxivID('https://evil.test/1706.03762'),null);assert.throws(()=>assertPDF(new TextEncoder().encode('<html>'+'.'.repeat(200))));assertPDF(new TextEncoder().encode('%PDF-1.7\n'+'.'.repeat(200)));});

test('PDF quote matching tolerates line breaks but never paraphrases or combines passages',()=>{assert.equal(sourceQuote('The model\nuses attention.','The model uses attention.'),'The model\nuses attention.');assert.equal(sourceQuote('The model uses attention.','The model improves accuracy.'),null);assert.equal(sourceQuote('alpha middle omega','alpha omega'),null);});
