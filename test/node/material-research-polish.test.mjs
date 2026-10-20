/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {filterMaterialScope,materialSearchScope,saveMaterialResearchScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {researchScopeFromProject} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {evidenceSummary} from '../../chrome/content/zotero/research/shared/evidence-summary.mjs';
import {selectionQuoteRange,createTranslatedMaterialHighlight,normalizeMaterialHighlights} from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import {writingSnapshotHash} from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import {materialMarginGeometry} from '../../chrome/content/zotero/research/manuscript/material-margin.mjs';

test('material scope combines research field and two keywords without expanding CNN into neural networks',()=>{
 const project={};saveMaterialResearchScope(project,{domain:'communications',primaryKeyword:'CNN',secondaryKeyword:'modulation',fuzzy:true});
 const rows=[{m:{id:'radio',title:'CNN for radio modulation classification',sourceText:'wireless channel'}},{m:{id:'vision',title:'CNN for image classification',sourceText:'computer vision'}},{m:{id:'broad',title:'Neural networks for modulation classification',sourceText:'wireless radio'}},{m:{id:'partial',title:'SCNN for radio modulation',sourceText:'wireless'}}];
 assert.deepEqual(filterMaterialScope(rows,project,'CNN').map(row=>row.m.id),['radio']);
 assert.deepEqual(filterMaterialScope(rows,project).map(row=>row.m.id),['radio'],'initial filtering retains the feasibility primary keyword');
 assert.equal(materialSearchScope(project,'').primaryKeyword,'','an explicit empty input can clear the first keyword');
 assert.equal(researchScopeFromProject(project).secondaryKeyword,'modulation');assert.deepEqual(project.researchPreparation.researchScope,project.researchScope);
});
test('material scope keeps fuzzy morphology and matches both keyword groups in complete source context',()=>{
 const project={researchScope:{domain:'physics',primaryKeyword:'quantum',secondaryKeyword:'superconduct;超导',fuzzy:true}};
 const rows=[{m:{id:'match',title:'Quantum devices',paperTitle:'Superconducting circuits in physics'}},{m:{id:'other',title:'Quantum optics',sourceText:'photon'}}];
 assert.deepEqual(filterMaterialScope(rows,project,'quantum').map(row=>row.m.id),['match']);
 saveMaterialResearchScope(project,{fuzzy:false});assert.equal(filterMaterialScope(rows,project,'quantum').length,0);
});
test('evidence summary is concise display text while complete explanations and pending states remain intact',()=>{
 const material={summary:'## 结果\n**方法**在固定测试条件下报告了误差变化。[1] '+ '原图保留了坐标轴、对照方法和不同采样条件。'.repeat(10),imageExplanation:{result:{sections:[{heading:'结果',body:'完整解读'}]}}},before=structuredClone(material),brief=evidenceSummary(material,{limit:88});
 assert.ok(brief.length<=89);assert.ok(!brief.includes('**'));assert.ok(!brief.includes('[1]'));assert.deepEqual(material,before);
 assert.equal(evidenceSummary({summary:'尚未核验的生成文本',generationStatus:'pending'}),'');assert.equal(evidenceSummary({summary:'人工中文说明',generationStatus:'pending',userEdited:true}),'人工中文说明');
});
test('a quote unique within its immutable translated source is not rejected by omitted neighbouring math display',()=>{
 const original='The threshold is chosen using independent validation data.',text='阈值 $t$ 通过独立验证数据选择。',material={sourceText:original,sourceVersion:'v1'},hash=writingSnapshotHash;
 const context={text,textHash:hash(text),sourceText:original,sourceHash:hash(original),sourceVersion:'v1',materialSourceHash:hash(original),sourceAnchor:{sourceText:original,sourceVersion:'v1'}};
 const row=createTranslatedMaterialHighlight(material,'独立验证数据',{context,prefix:'阈值 通过',suffix:'选择。',style:'underline'});
 assert.equal(row.translation.quote,'独立验证数据');assert.equal(normalizeMaterialHighlights([row],material)[0].style,'underline');assert.equal(row.originalContext.text,original);
 assert.equal(selectionQuoteRange('甲 相同内容 乙 相同内容','相同内容',{prefix:'被显示层移除的公式'}),null,'ambiguous quotes remain unanchored');
 assert.deepEqual(selectionQuoteRange('甲 相同内容 乙 相同内容','相同内容',{prefix:'乙 '}),{start:9,end:13});
});

test('outside annotation rails and zoomed papers fit the actual middle canvas width',()=>{
 for(const innerWidth of [220,346,640,900,1100,1600])for(const zoom of [.5,1,1.25,1.8]){
  const layout=materialMarginGeometry({innerWidth,zoom}),paperLeft=layout.paperOffset*zoom,paperRight=paperLeft+layout.paperWidth*zoom;
  assert.ok(paperRight<=innerWidth+.01,`${innerWidth}px at ${zoom}x must not clip the right paper edge`);
  assert.ok(paperLeft-layout.gap-layout.railWidth>=-.01,'the comment rail stays inside the left canvas edge');
  assert.ok(layout.paperWidth>0);assert.ok(layout.paperPadding*2<layout.paperWidth);
 }
 assert.ok(materialMarginGeometry({innerWidth:346}).railWidth<materialMarginGeometry({innerWidth:1100}).railWidth,'a narrow canvas reduces the annotation rail');
});
