/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationScope,rankPreparationPapers,materialChoicePage,mergePreparationSelection} from '../../chrome/content/zotero/research/shared/preparation-sources.mjs';

test('the current remote sensing topic replaces an unconfirmed legacy communications hint, while an edited field remains authoritative',()=>{
 const options={title:'遥感场景的高斯溅射重建',folderName:'遥感文献',scope:{domain:'communications',primaryKeyword:'AMC'}};
 assert.equal(preparationScope(options).domain,'earth-environment');assert.equal(preparationScope(options).primaryKeyword,'高斯溅射');
 assert.equal(preparationScope({...options,manual:true}).domain,'communications');assert.equal(preparationScope({...options,manual:true}).primaryKeyword,'AMC');
});

test('local matching crosses folders and language aliases, tolerates partial topics, and keeps acronym boundaries',()=>{
 const papers=[{id:1,title:'Remote sensing with Gaussian splatting',folderNames:['方法']},{id:2,title:'遥感图像重建',folderNames:['待读']},{id:3,title:'CNN architecture',folderNames:['神经网络']},{id:4,title:'scnndata unrelated',folderNames:['其他']}];
 assert.deepEqual(rankPreparationPapers(papers,'遥感').map(row=>row.id),[2,1]);
 assert.deepEqual(rankPreparationPapers(papers,'CNN').map(row=>row.id),[3]);
 assert.equal(rankPreparationPapers(papers,'',{domain:'communications',primaryKeyword:'遥感'}).length,2,'a stale field hint does not hard-exclude title matches');
});

test('218 complete materials are paged without splitting or truncating their source text',()=>{
 const materials=Array.from({length:218},(_,index)=>({id:'material-'+index,sourceText:('完整段落 '+index+'。').repeat(3000)})),suggestions=materials.map(row=>({materialID:row.id,sourceRevision:1}));
 const first=materialChoicePage(suggestions,materials),last=materialChoicePage(suggestions,materials,{offset:216});assert.equal(first.length,24);assert.equal(last.length,2);assert.strictEqual(first[0].material,materials[0]);assert.equal(first[0].material.sourceText,materials[0].sourceText);assert.equal(last[1].material.id,'material-217');
});

test('an explicit Camera IoT query does not include papers matching only a broader project hint',()=>{
 const papers=[{id:1,title:'Camera IoT video analytics',abstract:'Remote image processing'},{id:2,title:'YUBI-Real2Sim',abstract:'Camera image rendering from Gaussian splatting',folderNames:['关节3DGS']},{id:3,title:'AccMPEG: Camera IoT streaming',abstract:'Video analysis'}];
 assert.deepEqual(rankPreparationPapers(papers,'Camera IoT',{primaryKeyword:'image',secondaryKeyword:'Gaussian splatting'}).map(row=>row.id).sort(),[1,3]);
 assert.ok(rankPreparationPapers(papers,'',{primaryKeyword:'Gaussian splatting'}).some(row=>row.id===2),'a project hint still ranks recommendations when no query was entered');
 assert.deepEqual(rankPreparationPapers(papers,'Camera IoT').map(row=>row.id).sort(),[1,3],'a Camera-only abstract does not match the full explicit query');
 assert.ok(rankPreparationPapers(papers,'Camera IoT;Gaussian splatting').some(row=>row.id===2),'an explicit alternative remains selectable');
 assert.equal(rankPreparationPapers([{id:1,title:'遥感方法'}],'remote sensing').length,1,'a complete known English alias still finds its Chinese equivalent');
});

test('a refreshed candidate snapshot preserves unsaved exclusions and includes newly downloaded selected papers',()=>{
 assert.deepEqual([...mergePreparationSelection([1,2],new Set([1,4]),[1,2,3])].sort(),[1,3,4]);
 assert.deepEqual([...mergePreparationSelection([17],new Set(),[17])],[],'clearing the folder filter survives refresh');
});

test('saved topic keywords are retained even when an older project has no origin flag',()=>{
 const scope=preparationScope({title:'机器学习分析橘子腐烂程度',folderName:'橘子文献',scope:{domain:'machine-learning',primaryKeyword:'机器学习',secondaryKeyword:'CNN'}});assert.equal(scope.primaryKeyword,'机器学习');assert.equal(scope.secondaryKeyword,'CNN');assert.equal(scope.domain,'machine-learning');
});
