/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {editableMathTokens} from '../../chrome/content/zotero/research/manuscript/editable-math.mjs';
test('reading math retains exact inline and display LaTeX delimiters and offsets',()=>{
 const text='变量 $x_i^2$，函数 \\(\\sin x\\)，公式 $$E_{\\mathrm{F}}=mc^2$$。';
 const tokens=editableMathTokens(text);assert.deepEqual(tokens.map(token=>[token.source,token.latex,token.display]),[['$x_i^2$','x_i^2',false],['\\(\\sin x\\)','\\sin x',false],['$$E_{\\mathrm{F}}=mc^2$$','E_{\\mathrm{F}}=mc^2',true]]);for(const token of tokens)assert.equal(text.slice(token.index,token.index+token.source.length),token.source);
});
test('reading math leaves unmatched and escaped delimiters as the original user text',()=>{
 assert.deepEqual(editableMathTokens('价格 \\$20，未完成的 $x_i 和原句。'),[]);assert.equal(editableMathTokens('\\[a=\\sum_{i=1}^{n}x_i\\]')[0].latex,'a=\\sum_{i=1}^{n}x_i');
});
