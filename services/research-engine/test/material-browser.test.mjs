import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSourceSelections,applyBulkSourceContext} from '../../../chrome/content/zotero/research/shared/source-context.mjs';
import {resolveMode,recentResults} from '../../../chrome/content/zotero/research/shared/material-browser.mjs';
test('explicit source exclusions survive later ingestion and bulk actions do not mutate saved state',()=>{
 const existing={paper:'off'},sources=[{id:'paper',insights_count:2},{id:'new',insights_count:0}];
 const next=computeSourceSelections(existing,sources,'include');assert.deepEqual(next,{paper:'off',new:'full'});assert.deepEqual(existing,{paper:'off'});
 assert.deepEqual(applyBulkSourceContext(next,sources,'insights'),{paper:'insights',new:'off'});
});
test('explicit writing mode overrides feasibility words, auto detects evaluation intent',()=>{
 assert.equal(resolveMode('auto','评估这个 Idea 的可行性'),'evaluate');assert.equal(resolveMode('write','写一段关于可行性的内容'),'write');assert.equal(resolveMode('search','CNN'),'search');
});
test('recents never replace Chinese search relevance or lose old material IDs',()=>{
 const rows=[{m:{id:'a'}},{m:{id:'b'}}];assert.deepEqual(recentResults(rows,{recentMaterials:['b']},'方法'),rows);assert.deepEqual(recentResults(rows,{recentMaterials:['b']},'').map(x=>x.m.id),['b','a']);assert.equal(rows[0].m.id,'a');
});
