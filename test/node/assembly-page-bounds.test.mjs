/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {installAssemblyPages} from '../../chrome/content/zotero/research/manuscript/assembly-pages.mjs';

const page=(sectionID,ids=[])=>{const value={dataset:{section:sectionID},querySelectorAll:()=>value.blocks};value.blocks=ids.map(id=>({dataset:{id},closest:()=>value}));return value;};
function fixture(pages=[],canvasPresent=true){
 const p=M.createProject('未命名论文');p.sections=[{id:'results',title:'结果'},{id:'methods',title:'方法'}];p.blocks=[];p.ui.sectionID='results';p.ui.blockID='';
 const canvas={querySelectorAll:()=>pages,querySelector:selector=>pages.flatMap(row=>row.blocks||[]).find(row=>selector==='[data-id="'+row.dataset.id+'"]')||null},controls=[];
 const U={p,M,$:id=>id==='canvas'?(canvasPresent?canvas:null):{querySelector:()=>({append:control=>controls.push(control)})},el:()=>({dataset:{}}),selectBlock:()=>{}};
 installAssemblyPages(U,{snapshot(){},changed(){},persist(){},status(){}});return U;
}

test('an untitled empty project captures its empty chapter without a selected block or manuscript edits',()=>{
 const U=fixture([page('results')]),before=JSON.stringify(U.p);
 assert.deepEqual(U.captureAssemblyPageBounds({sectionID:'results',blockID:''}),{current:{sectionID:'results',firstID:'',lastID:''},sections:[{sectionID:'results',firstID:'',lastID:''},{sectionID:'methods',firstID:'',lastID:''}]});
 assert.deepEqual(U.captureAssemblyPageBounds(),{current:null,sections:[{sectionID:'results',firstID:'',lastID:''},{sectionID:'methods',firstID:'',lastID:''}]});
 assert.equal(JSON.stringify(U.p),before);
});

test('a project without rendered paper pages or a canvas returns empty bounds rather than inventing a block',()=>{
 for(const U of [fixture([]),fixture([],false),fixture([{querySelectorAll:()=>[]}])])assert.deepEqual(U.captureAssemblyPageBounds({sectionID:'results',blockID:'missing'}),{current:null,sections:[{sectionID:'results',firstID:'',lastID:''},{sectionID:'methods',firstID:'',lastID:''}]});
});

test('a selected block resolves its actual page while each chapter keeps its own first and last anchors',()=>{
 const U=fixture([page('results',['result-first','result-second']),page('results',['result-third','result-last']),page('methods',['method-first'])]),before=JSON.stringify(U.p);
 const value=U.captureAssemblyPageBounds({sectionID:'results',blockID:'result-third'});
 assert.deepEqual(value,{current:{sectionID:'results',firstID:'result-third',lastID:'result-last'},sections:[{sectionID:'results',firstID:'result-first',lastID:'result-last'},{sectionID:'methods',firstID:'method-first',lastID:'method-first'}]});
 assert.equal(JSON.stringify(U.p),before);
 assert.equal(U.captureAssemblyPageBounds({sectionID:'results',blockID:'method-first'}).current.lastID,'result-second','a stale block in another chapter cannot replace the current chapter bounds');
});

test('new-page insertion with no selected block stays in the empty target chapter before the next theme',()=>{
 const U=fixture([page('results'),page('methods',['method-first'])]);U.p.blocks=[M.block('paragraph','methods',{id:'method-first',text:'人工方法',runs:[{text:'人工方法',italic:true}]})];const original=structuredClone(U.p.blocks[0]);
 const result=U.insertAssemblyPage();
 assert.equal(result.sectionID,'results');assert.equal(U.p.blocks.length,3);assert.ok(U.p.blocks.slice(0,2).every(block=>block.sectionID==='results'&&block.explicitPage&&block.text===''));assert.deepEqual(U.p.blocks.at(-1),original);M.assertProject(U.p);
});

test('an empty page anchor after a rendered chapter uses that chapter tail instead of the following chapter',()=>{
 const U=fixture([page('results',['result-first']),page('results',['result-last']),page('methods',['method-first'])]);U.p.blocks=[M.block('paragraph','results',{id:'result-first',text:'人工结果'}),M.block('paragraph','results',{id:'result-last',text:'人工末尾'}),M.block('paragraph','methods',{id:'method-first',text:'人工方法'})];
 const result=U.insertAssemblyPage({anchorID:''});assert.equal(U.p.blocks[2].id,result.pageID);assert.equal(U.p.blocks[2].sectionID,'results');assert.equal(U.p.blocks.at(-1).id,'method-first');
});
