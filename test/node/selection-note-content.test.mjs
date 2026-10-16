/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';import assert from 'node:assert/strict';
import {selectionFormulaAsset,selectionNoteHTML} from '../../chrome/content/zotero/research/shared/selection-note-content.mjs';
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;'),render=text=>text.startsWith('$$')&&!text.includes('\\broken')?'<pre class="math">'+escape(text)+'</pre>':'<p>'+escape(text)+'</p>';
test('original excerpt is stored once while a distinct translation remains beside its source',()=>{
	const selection={text:'Selected source.'};const excerpt=selectionNoteHTML({selection,label:'原文摘录',summary:'原文摘录\nSelected source.',render,escape});
	assert.equal(excerpt.html,'<blockquote>Selected source.</blockquote>');
	const translated=selectionNoteHTML({selection,label:'机器翻译',summary:'选中的原文。',render,escape});assert.match(translated.html,/Selected source/);assert.match(translated.html,/选中的原文/);
});
test('only an already renderable explicit LaTeX source replaces formula OCR',()=>{
	const args={selection:{text:'T\nV\nX\nX'},label:'原文摘录',summary:'T\nV\nX\nX',render,escape};
	const valid=selectionNoteHTML({...args,latex:'\\frac{1}{T}\\sum_t A_v[t]'});assert.equal(valid.math,true);assert.match(valid.html,/\\frac/);assert.ok(!valid.html.includes(args.selection.text));
	assert.equal(selectionNoteHTML({...args,latex:'\\broken{x}'}).math,false);
});
test('a scoped formula selection can preserve original geometry without turning adjacent prose into an image note',()=>{
	const asset={attachmentID:9,kind:'formula',pageIndex:2},position=()=>({rects:[[10,10,110,50]]}),selection={attachmentID:9,position:{pageIndex:2,rects:[[15,15,95,40]]}};
	assert.equal(selectionFormulaAsset(selection,[asset],position),asset);
	assert.equal(selectionFormulaAsset({...selection,attachmentID:8},[asset],position),null);
	assert.equal(selectionFormulaAsset({...selection,position:{pageIndex:2,rects:[[0,0,300,180]]}},[asset],position),null);
});
