/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {saveProjectMaterialHighlights,mergeMaterialAsset} from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import {materialAnnotationIdentity} from '../../chrome/content/zotero/research/shared/material-annotation-sync.mjs';
import {assemblyStageIssue,associateProjectMaterials,directionContext,directionSignature,validateDirectionRelocations} from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import {writingSnapshotHash} from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import {filterMaterialScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {catalogResults} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {matchMaterialSection,materialPlacementSuggestions,materialPlacementRevision,applyMaterialPlacements,materialPlacementPool,materialPlacementReport} from '../../chrome/content/zotero/research/shared/material-section-matching.mjs';

const source=()=>M.material({id:'source',assetID:'source',kind:'semantic',title:'3D Gaussian splatting',section:'2 Methods',sectionType:'方法',sourceText:'Gaussian splatting represents a three-dimensional scene.\n\nThe complete method retains every step and its original conditions.',anchor:{attachmentID:8,pageIndex:2,sourceText:'complete source'},revision:3});
test('project annotations retain the shared asset and another manuscript unchanged across source refresh',()=>{
 const shared=source(),before=structuredClone(shared),a=M.createProject('甲'),b=M.createProject('乙');b.materials=[structuredClone(shared)];const highlights=[{id:'h',quote:'scene',comment:'本项目的方法讨论'}];
 const local=saveProjectMaterialHighlights(a,shared,highlights);assert.deepEqual(shared,before);assert.deepEqual(b.materials[0],before);assert.equal(a.materials[0],local);assert.notEqual(materialAnnotationIdentity(local),materialAnnotationIdentity(shared));
 assert.deepEqual(local.highlights,highlights);assert.equal(local.revision,3);assert.equal(local.annotationRevision,1);highlights[0].comment='mutate caller';assert.equal(local.highlights[0].comment,'本项目的方法讨论');
 mergeMaterialAsset(local,{...before,revision:4,summary:'来源的新说明',highlights:[]});assert.equal(local.revision,4);assert.equal(local.summary,'来源的新说明');assert.equal(local.highlights[0].comment,'本项目的方法讨论');assert.equal(local.projectHighlights[0].comment,'本项目的方法讨论');
 const second=saveProjectMaterialHighlights(b,shared,[]);assert.notEqual(materialAnnotationIdentity(local),materialAnnotationIdentity(second));assert.equal(local.highlights.length,1);
});
test('a Chinese research sentence finds concept aliases in complete source without a duplicate exact predicate',()=>{
 const p=M.createProject('高斯溅射在遥感中的应用'),rows=[source(),M.material({id:'other',title:'Marine ecology',kind:'note',sourceText:'Field sampling of plankton.'})],query='高斯溅射在遥感中的应用';p.researchScope={primaryKeyword:query,fuzzy:true};
 const catalog={topic:'',type:'',sort:'relevance',selection:[]};assert.deepEqual(filterMaterialScope(catalogResults(rows,query,p,catalog),p,query).map(row=>row.m.id),['source']);assert.equal(p.researchScope.primaryKeyword,query);
});
test('explicit material association keeps complete long sources, assigns chapters and never invents prose',()=>{
 const p=M.createProject('素材组装'),material=source();material.sourceText+='\n\n'+ '完整实验条件，保持大段上下文。'.repeat(1000);p.materials=[material,M.material({id:'intro',sectionType:'引言',sourceText:'已有问题与适用条件'}),M.material({id:'idea',kind:'idea',sourceText:'未经验证的构想'})];const original=structuredClone(p.materials);
 assert.equal(associateProjectMaterials(p,{createBlock:M.block}),2);const method=p.blocks.find(row=>row.sectionID===p.sections.find(s=>s.title==='方法').id);assert.equal(method.materials[0].id,'source');assert.ok(p.blocks.every(row=>row.text===''));assert.deepEqual(p.materials,original);assert.equal(associateProjectMaterials(p,{createBlock:M.block}),0);
});
test('stage entry uses the same content requirements for progress buttons and next actions',()=>{
 const p=M.createProject('论文');assert.equal(assemblyStageIssue(p,0),'');assert.equal(assemblyStageIssue(p,1),'');assert.match(assemblyStageIssue(p,2),/速读/);assert.match(assemblyStageIssue(p,3),/正文/);assert.doesNotMatch(assemblyStageIssue(p,2)+assemblyStageIssue(p,3),/初稿/);
 assert.equal(assemblyStageIssue(p,2,{reads:1}),'','a project with only chapter reads reaches 速读细调');assert.equal(assemblyStageIssue(p,3,{reads:1}),'','and 内容导出');assert.equal(assemblyStageIssue(p,3,{tasks:2}),'','a task plan alone reaches 内容导出');
 p.draftBatch={status:'pending',previews:[{}]};assert.equal(assemblyStageIssue(p,2),'');assert.match(assemblyStageIssue(p,3),/正文/);p.blocks=[M.block('paragraph',p.sections[0].id,{text:'人工已写正文'})];assert.equal(assemblyStageIssue(p,2),'');assert.equal(assemblyStageIssue(p,3),'');
});

test('automatic matching uses actual chapter recommendations, retains unknown and structure-only sources, and never restores a removed link',()=>{
 const p=M.createProject('按可行性方案装配'),method=p.sections.find(row=>row.title==='方法');p.researchPreparation={plan:{researchQuestion:'核查独立设备测量'},materialRecommendations:[{materialID:'recommended',sectionID:method.id,sourceRevision:2,reason:'用于说明独立设备划分'}]};
 p.materials=[M.material({id:'recommended',revision:2,sourceText:'完整的设备测量段落。'.repeat(500),sectionType:'引言'}),M.material({id:'unknown',sourceText:'An unrelated complete paragraph.'}),M.material({id:'structure',anchor:{paperItemID:42},sectionType:'方法',sourceText:'This paper is only a structural reference.'})];p.readingSelection={structurePaperID:42,closeReadingPaperIDs:[]};const originals=structuredClone(p.materials);const prose=M.block('paragraph',p.sections[0].id,{text:'人工正文与排序必须保留'});p.blocks=[prose];
 assert.equal(associateProjectMaterials(p,{createBlock:M.block,requirePlan:true}),1);const placed=p.blocks.find(row=>row.materials.some(link=>link.id==='recommended'));assert.equal(placed.sectionID,method.id);assert.equal(p.blocks[0],prose);assert.equal(prose.text,'人工正文与排序必须保留');assert.deepEqual(p.materials,originals);assert.equal(matchMaterialSection(p,p.materials[1]),null);assert.equal(matchMaterialSection(p,p.materials[2]),null);
 placed.materials=[];assert.equal(associateProjectMaterials(p,{createBlock:M.block,requirePlan:true}),0,'手动解除的关联不因渲染或重开恢复');
});

test('an explicit matching preview repairs old first-chapter placements without rewriting prose and rejects a stale preview',()=>{
 const p=M.createProject('修复旧装配'),method=p.sections.find(row=>row.title==='方法');p.materials=[source(),M.material({id:'unknown',sourceText:'Unknown topic'})];p.researchPreparation={plan:{researchQuestion:'保留用户研究'}};p.blocks=[M.block('paragraph',p.sections[0].id,{text:'保留手工撰写的原句',materials:[{id:'source',role:'comparison',revision:3}]})];const before=structuredClone(p.blocks),materials=structuredClone(p.materials),suggestions=materialPlacementSuggestions(p),revision=materialPlacementRevision(p);assert.equal(suggestions.length,1);assert.equal(suggestions[0].sectionID,method.id);assert.equal(suggestions[0].hasAuthoredContext,true);assert.deepEqual(p.blocks,before,'预览不更改正文或关联');applyMaterialPlacements(p,suggestions,{createBlock:M.block,revision});assert.equal(p.blocks[0].text,before[0].text);assert.equal(p.blocks[0].materials.length,0);assert.equal(p.blocks.find(row=>row.sectionID===method.id).materials[0].id,'source');assert.deepEqual(p.materials,materials);assert.throws(()=>applyMaterialPlacements(p,suggestions,{createBlock:M.block,revision}),/已变化/);
});

test('matching uses specific chapter writing purposes before source labels and reconsiders unresolved sources after plan changes',()=>{
 const p=M.createProject('任务匹配'),method=p.sections.find(row=>row.title==='方法');p.researchPreparation={plan:{researchQuestion:'比较设备划分'}};p.materials=[M.material({id:'specific',sourceText:'按独立设备划分训练样本并完成信道校准。'})];assert.equal(associateProjectMaterials(p,{createBlock:M.block,requirePlan:true}),0);method.writingPurpose='说明独立设备划分与信道校准的操作顺序';assert.equal(associateProjectMaterials(p,{createBlock:M.block,requirePlan:true}),1);assert.equal(p.blocks.find(row=>row.materials.some(link=>link.id==='specific')).sectionID,method.id);
});

test('matching includes prepared library sources before their first import and reports already placed sources without claiming new work',()=>{
 const p=M.createProject('首次匹配'),ready=source(),unrelated=M.material({id:'excluded',sectionType:'方法',sourceText:'作者取消的完整素材'}),discussion=M.material({id:'discussion',sourceType:'ai-discussion',sectionType:'方法',sourceText:'模型讨论'}),before=structuredClone(p);
 const candidate=materialPlacementPool(p,[ready,unrelated,discussion],{selectedIDs:['source','discussion']}),report=materialPlacementReport(candidate);assert.equal(candidate.materials.length,1);assert.equal(report.suggestions.length,1);assert.equal(report.linked.length,0);assert.deepEqual(p,before,'核对预览不更改正文或来源');
 assert.equal(applyMaterialPlacements(candidate,report.suggestions,{createBlock:M.block,revision:materialPlacementRevision(candidate)}),1);const after=materialPlacementReport(candidate);assert.equal(after.suggestions.length,0);assert.equal(after.linked.length,1);assert.equal(after.sections.length,1);assert.equal(after.sections[0].title,'方法');assert.equal(after.sections[0].blocks[0].materials[0].id,'source');assert.equal(materialPlacementPool(p,[ready],{selectedIDs:[]}).materials.length,0,'取消全部推荐不能被匹配操作重新加回');
});
test('direction context carries actual full-plan choices and source excerpts, with relocation limited to existing unlocked blocks',()=>{
 const p=M.createProject('实际研究');p.materials=[source()];p.blocks=[M.block('paragraph',p.sections[0].id,{id:'b',materials:[{id:'source'}]})];p.researchPreparation={plan:{researchQuestion:'用户明确的问题',experiment:'已有实施计划'},recommendedPapers:[{id:'paper',title:'真实推荐论文'}],readingSelection:{closeReadingPaperIDs:[10],structurePaperID:20}};
 const context=directionContext(p);assert.equal(context.plan.experiment,'已有实施计划');assert.equal(context.materials[0].sourceExcerpt,p.materials[0].sourceText);assert.equal(context.materials[0].id,'source');assert.equal(context.readingSelection.structurePaperID,20);assert.equal(context.preparation.readingSelection.structurePaperID,20);assert.equal(context.recommendedPapers[0].id,'paper');
 const target=p.sections[1].id,rows=[{blockID:'b',sectionID:target,reason:'这里说明的是操作步骤'},{blockID:'b',sectionID:target,reason:'重复'},{blockID:'missing',sectionID:target,reason:'无效'}];assert.equal(validateDirectionRelocations(rows,p).length,1);p.blocks[0].locked=true;assert.equal(validateDirectionRelocations(rows,p).length,0);
});

test('large project source fingerprints reuse unchanged text across cloned snapshots and invalidate same-revision edits',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/research/shared/assembly-direction.mjs',import.meta.url),'utf8'),start=source.indexOf('const sourceHashes='),end=source.indexOf('export function migrateAssemblyFlow(',start);let hashed=0;
 const context=vm.createContext({writingSnapshotHash:text=>{hashed++;return writingSnapshotHash(text);}});vm.runInContext(source.slice(start,end)+'\nglobalThis.fingerprint=sourceHash;',context);
 const materials=Array.from({length:447},(_,index)=>({id:'source-'+index,revision:1,sourceText:'完整上下文 '+index+'，保留全部条件。'.repeat(80)}));
 const first=materials.map(row=>context.fingerprint('large-project',row));assert.equal(hashed,447);const copied=structuredClone(materials),again=copied.map(row=>context.fingerprint('large-project',row));assert.deepEqual(again,first);assert.equal(hashed,447,'all 447 unchanged sources reuse their fingerprints');
 copied[120].sourceText+=' 新的实验条件';const changed=copied.map(row=>context.fingerprint('large-project',row));assert.equal(hashed,448);assert.notEqual(changed[120],first[120]);assert.equal(copied[120].revision,1);assert.equal(changed[121],first[121]);
 context.fingerprint('other-project',{...copied[120],sourceText:'另一个项目的来源'});assert.equal(hashed,449);assert.equal(context.fingerprint('large-project',copied[120]),changed[120]);assert.equal(hashed,449,'another project cannot displace the same source ID');
 const project=M.createProject('大项目');project.materials=materials;const signature=directionSignature(project);assert.equal(directionSignature(structuredClone(project)),signature);project.materials[120].sourceText+=' 新的实验条件';assert.notEqual(directionSignature(project),signature);assert.equal(directionContext(project).materials[120].sourceExcerpt,project.materials[120].sourceText.slice(0,2000),'model excerpts retain their original scope');
});
