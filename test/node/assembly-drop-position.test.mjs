/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionInsertionAnchor,sectionInsertionIndex} from '../../chrome/content/zotero/research/manuscript/section-insertion.mjs';

const sections=[{id:'result',title:'结果'},{id:'method',title:'方法'}];
const fixture=()=>[
 {id:'result-start',sectionID:'result',text:'人工结果开头',materials:[]},
 {id:'result-end',sectionID:'result',text:'人工结果末尾',materials:[]},
 {id:'method-start',sectionID:'method',text:'人工方法开头',materials:[]},
 {id:'method-end',sectionID:'method',text:'人工方法末尾',materials:[]}
];
const anchorFor=(blocks,index=2)=>sectionInsertionAnchor(blocks,sections,'result',index);
const resolve=(blocks,anchor)=>sectionInsertionIndex(blocks,sections,'result',anchor);

test('a result-chapter tail captures only anchors from that chapter before the next method block',()=>{
 const blocks=fixture(),before=JSON.stringify({blocks,sections}),anchor=anchorFor(blocks);
 assert.equal(anchor.sectionID,'result');assert.equal(anchor.afterID,'result-end');assert.ok(!anchor.beforeID,'下一章首块不是原章锚点');assert.equal(resolve(blocks,anchor),2);assert.equal(JSON.stringify({blocks,sections}),before,'位置计算不改写章节或人工内容');
});
test('deleting the captured tail while a note is saving still inserts before the following chapter',()=>{
 const blocks=fixture(),anchor=anchorFor(blocks);blocks.splice(1,1);
 const before=JSON.stringify(blocks),index=resolve(blocks,anchor);assert.equal(index,1);assert.equal(blocks[index].id,'method-start');assert.equal(JSON.stringify(blocks),before);
});
test('moving the captured result tail to methods invalidates it instead of following it across chapters',()=>{
 const blocks=fixture(),anchor=anchorFor(blocks);blocks[1].sectionID='method';
 assert.equal(resolve(blocks,anchor),1,'只接受仍属于原章的锚点');assert.equal(blocks[resolve(blocks,anchor)].id,'result-end');
});
test('valid middle anchors retain the intended local order despite inserts in an earlier chapter',()=>{
 const blocks=fixture(),anchor=anchorFor(blocks,1),allSections=[{id:'intro',title:'引言'},...sections];
 assert.equal(anchor.beforeID,'result-end');assert.equal(anchor.afterID,'result-start');blocks.unshift({id:'intro-start',sectionID:'intro',text:'人工引言',materials:[]});
 assert.equal(sectionInsertionIndex(blocks,allSections,'result',anchor),2);assert.equal(blocks[2].id,'result-end');
});
test('a removed following anchor can fall back to the surviving previous anchor within the same section',()=>{
 const blocks=fixture(),anchor=anchorFor(blocks,1);blocks[1].sectionID='method';
 assert.equal(resolve(blocks,anchor),1);assert.equal(blocks[0].sectionID,'result');assert.equal(blocks[1].sectionID,'method');
});
test('when both result anchors disappear the empty section is inserted before the first later section',()=>{
 const blocks=fixture(),anchor=anchorFor(blocks,1);blocks.splice(0,2);
 assert.equal(resolve(blocks,anchor),0);assert.equal(blocks[0].sectionID,'method');
});
test('an empty result section uses declared chapter order rather than appending after unrelated methods',()=>{
 const blocks=fixture().filter(block=>block.sectionID==='method'),anchor=anchorFor(blocks,blocks.length);
 assert.equal(anchor.sectionID,'result');assert.ok(!anchor.beforeID);assert.ok(!anchor.afterID);assert.equal(resolve(blocks,anchor),0);
});
test('an empty final chapter may append after preceding chapters without inventing another section',()=>{
 const blocks=fixture().filter(block=>block.sectionID==='result'),anchor=sectionInsertionAnchor(blocks,sections,'method',0);
 assert.equal(sectionInsertionIndex(blocks,sections,'method',anchor),blocks.length);
});
