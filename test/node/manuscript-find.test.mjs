/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {findTextMatches,replaceTextMatches} from '../../chrome/content/zotero/research/manuscript/manuscript-find.mjs';
test('find treats formula punctuation literally, skips overlaps and supports Chinese',()=>{
 assert.deepEqual(findTextMatches('x_i + x_i; 实验实验','x_i'),[{start:0,end:3},{start:6,end:9}]);
 assert.deepEqual(findTextMatches('aaa','aa'),[{start:0,end:2}]);assert.equal(findTextMatches('Method method','METHOD').length,2);assert.equal(findTextMatches('Method method','method',{caseSensitive:true}).length,1);assert.deepEqual(findTextMatches('实验',''),[]);
});
test('replacement preserves adjacent mathematical styles, original material and source links',()=>{
 const block={type:'paragraph',text:'条件 xi 条件',runs:[{text:'条件 ',bold:true},{text:'x',italic:true},{text:'i',sub:true},{text:' 条件',color:'#444444'}],materials:[{id:'stored-source',revision:2}],revision:4},before=structuredClone(block);
 const patch=replaceTextMatches(block,findTextMatches(block.text,'条件'),'边界');assert.equal(patch.text,'边界 xi 边界');assert.ok(patch.runs.some(run=>run.text==='i'&&run.sub));assert.ok(patch.runs.some(run=>run.text==='x'&&run.italic));assert.deepEqual(block,before);assert.equal(patch.runs.at(-1).color,'#444444');
});
test('invalid or locked replacements cannot partly mutate user text',()=>{
 const block={type:'paragraph',text:'保留文本',runs:[{text:'保留文本'}],materials:[{id:'original'}]},before=structuredClone(block);
 assert.throws(()=>replaceTextMatches(block,[{start:0,end:2},{start:1,end:3}],'变化'));assert.deepEqual(block,before);assert.throws(()=>replaceTextMatches({...block,locked:true},[{start:0,end:2}],'变化'));assert.throws(()=>replaceTextMatches({...block,type:'formula'},[{start:0,end:2}],'变化'));
});
