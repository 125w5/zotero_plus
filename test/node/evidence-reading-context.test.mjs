/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceCaption,evidenceReadingContext,evidenceConversationSelection} from '../../chrome/content/zotero/research/shared/evidence-reading-context.mjs';
const asset={id:'f2',kind:'figure',label:'Fig. 2',attachmentID:12,pageIndex:3,paperTitle:'Current paper',caption:'World-model learning.'};
test('uses complete adjacent definitions and current figure mentions without taking another paper or Fig. 20',()=>{
	const rows=[{pageIndex:0,text:'Fig. 20 discusses unrelated control groups.'},{pageIndex:2,text:'We define h_t as the deterministic hidden state.'},{pageIndex:3,text:'Fig. 2 shows the encoder, recurrent state update and decoder.'},{pageIndex:3,text:'The decoder predicts observations o_t from h_t and z_t.'},{attachmentID:99,pageIndex:3,text:'Fig. 2 demonstrates a different paper.'},{pageIndex:6,text:'Only results and a final discussion.'}];
	const context=evidenceReadingContext(asset,rows);
	assert.deepEqual(context.map(row=>row.text),rows.slice(1,4).map(row=>row.text));
	assert.ok(context.every(row=>row.attachmentID===12));
	assert.equal(context[1].pageIndex,3);
});
test('context budget drops whole paragraphs and never truncates variable definitions',()=>{
	const rows=[{pageIndex:3,text:'First complete paragraph.'},{pageIndex:3,text:'A'.repeat(100)},{pageIndex:3,text:'Last complete paragraph.'}];
	assert.deepEqual(evidenceReadingContext(asset,rows,{maxChars:50}).map(row=>row.text),[rows[0].text,rows[2].text]);
});
test('equation OCR never becomes a caption or chat equation; explicit LaTeX is retained',()=>{
	const equation={...asset,kind:'formula',label:'Eq. 8a',caption:'T\nV\n1\nX\nX\nAv[t]'};
	assert.equal(evidenceCaption(equation),'');
	const source=evidenceConversationSelection(equation,[{text:'A_v[t] denotes the age of vehicle v in slot t.'}],'\\frac{1}{T}\\sum_{t=1}^{T}A_v[t]');
	assert.match(source.text,/\\frac\{1\}\{T\}/);
	assert.ok(!source.text.includes(equation.caption));
	assert.equal(source.attachmentID,12);
});
