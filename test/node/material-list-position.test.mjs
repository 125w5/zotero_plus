/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {recentResults,stableMaterialResults,materialResultKey,captureMaterialViewport,restoreMaterialViewport} from '../../chrome/content/zotero/research/shared/material-browser.mjs';
import {catalogFor,catalogResults,materialRecordType,materialCatalogState} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';

const rows=ids=>ids.map(id=>({m:{id,summary:'用户说明 '+id,sourceText:'Original '+id}}));
test('partially saved catalog state receives safe selection defaults without replacing explicit scope or filters',()=>{
 const project={id:'p',ui:{catalog:{topic:'',sourceScope:'project',facets:{year:'2024'}}}},saved=project.ui.catalog,state=materialCatalogState(project);
 assert.equal(state,saved);assert.deepEqual(state.selection,[]);assert.equal(state.selection.includes('source'),false);assert.equal(state.topic,'');assert.equal(state.sourceScope,'project');assert.deepEqual(state.facets,{year:'2024'});assert.equal(state.sort,'relevance');
 state.selection=['kept'];assert.equal(materialCatalogState(project).selection[0],'kept');assert.deepEqual(materialCatalogState({id:'new'}),{topic:'new',type:'',sort:'relevance',selection:[]});
});
test('selecting a recent material does not reshuffle an already visible result set',()=>{
 const original=rows(['a','b','c']),before=JSON.stringify(original);
 const initial=recentResults(original,{recentMaterials:['c']},''),refreshed=recentResults(original,{recentMaterials:['b','c']},'');
 assert.deepEqual(initial.map(row=>row.m.id),['c','a','b']);
 assert.deepEqual(stableMaterialResults(refreshed,initial.map(row=>row.m.id)).map(row=>row.m.id),['c','a','b']);
 assert.equal(JSON.stringify(original),before,'display changes do not alter user text or source records');
});
test('refreshing summaries retains surviving cards and admits new cards without duplicates',()=>{
 const updated=rows(['new','c','b']);updated[1].m.summary='新的已保存说明';
 assert.deepEqual(stableMaterialResults(updated,['a','b','c','b']).map(row=>row.m.id),['b','c','new']);
 assert.equal(stableMaterialResults(updated,['a','b','c'])[1].m.summary,'新的已保存说明');
});
test('display mode, navigation disclosure and selection share one result key; filters do not',()=>{
 const state={topic:'project',type:'笔记',sort:'relevance',facets:{year:'2024',source:'论文'},selection:['a']},key=materialResultKey('批次',state);
 assert.equal(materialResultKey('批次',{...state,selection:['b'],topicTreeOpen:true,materialView:'source',facets:{source:'论文',year:'2024'}}),key);
 for(const value of [{...state,type:'批注'},{...state,sort:'manual'},{...state,topic:'other'}])assert.notEqual(materialResultKey('批次',value),key);
 assert.notEqual(materialResultKey('新的检索',state),key);
});
test('record filters distinguish notes from annotations without changing their content classification',()=>{
 const materials=[{id:'annotation',kind:'annotation',primaryType:'方法',sourceText:'用户批注原文',summary:'批注说明'},{id:'note',kind:'note',primaryType:'方法',anchor:{annotationKey:'original-anchor'},sourceText:'用户笔记原文',summary:'笔记说明'},{id:'text',kind:'text',primaryType:'方法',sourceText:'论文原文'}],project={id:'p',title:'项目'},before=JSON.stringify(materials);
 const catalog=catalogFor(project,materials),state={topic:'p',type:'方法',facets:{recordType:'annotation'}};
 assert.deepEqual(catalogResults(materials,'',project,state).map(row=>row.m.id),['annotation']);
 state.facets.recordType='note';assert.deepEqual(catalogResults(materials,'',project,state).map(row=>row.m.id),['note']);
 state.facets.recordType='';assert.deepEqual(catalogResults(materials,'',project,state).map(row=>row.m.id),['annotation','note','text']);
 assert.deepEqual(Object.values(catalog.entries).map(entry=>entry.type),['方法','方法','方法']);assert.equal(JSON.stringify(materials),before);
});
test('saved AI discussions remain notes and PDF annotation records remain annotations',()=>{
 assert.equal(materialRecordType({sourceType:'ai-discussion'}),'note');
 assert.equal(materialRecordType({sourceType:'pdf-annotation'}),'annotation');
 assert.equal(materialRecordType({anchor:{annotationKey:'a'}}),'annotation');
 assert.equal(materialRecordType({kind:'formula'}),'');
});
function viewport(){
 const host={scrollTop:180,getBoundingClientRect:()=>({top:20})};
 const records=[{id:'hidden',top:140,height:40},{id:'reading',top:200,height:70},{id:'following',top:270,height:60}];
 const nodes=()=>records.map(record=>({dataset:{material:record.id},getBoundingClientRect:()=>({top:20+record.top-host.scrollTop,bottom:20+record.top-host.scrollTop+record.height})}));
 return {host,records,list:{querySelectorAll:()=>nodes()},edge:80};
}
test('the viewport anchor ignores cards hidden above sticky controls and retains partial visibility',()=>{
 const {host,list,records,edge}=viewport(),position=captureMaterialViewport(host,list,{edge});
 assert.equal(position.id,'reading');assert.equal(position.offset,-40);
 records.forEach(record=>record.top+=75);
 assert.equal(restoreMaterialViewport(host,list,position,{edge}),true);
 assert.equal(host.scrollTop,255);assert.equal(captureMaterialViewport(host,list,{edge}).id,'reading');
 assert.equal(captureMaterialViewport(host,list,{edge}).offset,-40);
});
test('restoring the same material compensates for navigation height without moving it on screen',()=>{
 const {host,list,edge}=viewport(),position=captureMaterialViewport(host,list,{edge});
 assert.equal(restoreMaterialViewport(host,list,position,{edge:edge+30}),true);
 assert.equal(captureMaterialViewport(host,list,{edge:edge+30}).id,'reading');
 assert.equal(captureMaterialViewport(host,list,{edge:edge+30}).offset,position.offset);
});
test('a removed viewport anchor safely retains the previous scroll position',()=>{
 const {host,list,records,edge}=viewport(),position=captureMaterialViewport(host,list,{edge});
 records.splice(1,1);host.scrollTop=40;
 assert.equal(restoreMaterialViewport(host,list,position,{edge}),false);
 assert.equal(host.scrollTop,position.scrollTop);
});
