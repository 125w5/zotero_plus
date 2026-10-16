/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblySelectedSource} from '../../chrome/content/zotero/research/manuscript/assembly-conversation.mjs';
const project=()=>({materials:[{id:'a',title:'方法',sourceText:'原文',anchor:{pageIndex:2}},{id:'b',title:'结果'}]});
test('bound module sources take priority over stale outside previews and retain immutable source data',()=>{
 const p=project(),source=assemblySelectedSource(p,{materialIDs:['a']},'b');assert.equal(source.id,'a');assert.equal(source.stableID,'material:a');assert.equal(source.kind,'material');
 p.materials[0].sourceText='later revision';p.materials[0].anchor.pageIndex=7;assert.equal(source.sourceText,'原文');assert.equal(source.anchor.pageIndex,2);
});
test('multiple module bindings use group reading without silently picking an unrelated or arbitrary source',()=>{
 const p=project();assert.equal(assemblySelectedSource(p,{materialIDs:['a','b']},'outside',{outside:{id:'outside'}}),null);
 assert.equal(assemblySelectedSource(p,{materialIDs:['a','b']},'b').id,'b');assert.equal(assemblySelectedSource(p,{materialIDs:['missing']},'b'),null);
});
test('explicit previews remain available for a module without bindings and resolve saved asset references',()=>{
 const p=project();assert.equal(assemblySelectedSource(p,{materialIDs:[]},'b').id,'b');assert.equal(assemblySelectedSource(p,{materialIDs:[]},'external',{external:{id:'external',sourceText:'saved source'}}).sourceText,'saved source');assert.equal(assemblySelectedSource(p,{materialIDs:[]}),null);
});
