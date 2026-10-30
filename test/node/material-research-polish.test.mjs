/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {filterMaterialScope,materialSearchScope,saveMaterialResearchScope,saveMaterialBrowseScope,hasMaterialSearchFilters,resetMaterialSearchFilters,installMaterialResearchFilters} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {catalogResults} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import {researchScopeFromProject} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {evidenceSummary} from '../../chrome/content/zotero/research/shared/evidence-summary.mjs';
import {selectionQuoteRange,createTranslatedMaterialHighlight,normalizeMaterialHighlights} from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import {writingSnapshotHash} from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import {materialMarginGeometry} from '../../chrome/content/zotero/research/manuscript/material-margin.mjs';

test('material scope combines research field and two keywords without expanding CNN into neural networks',()=>{
 const project={};saveMaterialResearchScope(project,{domain:'communications',primaryKeyword:'CNN',secondaryKeyword:'modulation',fuzzy:true});
 saveMaterialBrowseScope(project,researchScopeFromProject(project));
 const rows=[{m:{id:'radio',title:'CNN for radio modulation classification',sourceText:'wireless channel'}},{m:{id:'vision',title:'CNN for image classification',sourceText:'computer vision'}},{m:{id:'broad',title:'Neural networks for modulation classification',sourceText:'wireless radio'}},{m:{id:'partial',title:'SCNN for radio modulation',sourceText:'wireless'}}];
 assert.deepEqual(filterMaterialScope(rows,project,'CNN').map(row=>row.m.id),['radio']);
 assert.deepEqual(filterMaterialScope(rows,project).map(row=>row.m.id),['radio'],'an explicitly saved browsing filter retains its primary keyword');
 assert.equal(materialSearchScope(project,'').primaryKeyword,'','an explicit empty input can clear the first keyword');
 assert.equal(researchScopeFromProject(project).secondaryKeyword,'modulation');assert.deepEqual(project.researchPreparation.researchScope,project.researchScope);
});
test('material scope keeps fuzzy morphology and matches both keyword groups in complete source context',()=>{
 const project={researchScope:{domain:'physics',primaryKeyword:'quantum',secondaryKeyword:'superconduct;超导',fuzzy:true}};
 saveMaterialBrowseScope(project,project.researchScope);
 const rows=[{m:{id:'match',title:'Quantum devices',paperTitle:'Superconducting circuits in physics'}},{m:{id:'other',title:'Quantum optics',sourceText:'photon'}}];
 assert.deepEqual(filterMaterialScope(rows,project,'quantum').map(row=>row.m.id),['match']);
 saveMaterialBrowseScope(project,{fuzzy:false});assert.equal(filterMaterialScope(rows,project,'quantum').length,0);
});

test('clearing material browsing restores all results and retains selection, sources and the feasibility plan',()=>{
 const scope={domain:'communications',primaryKeyword:'CNN',secondaryKeyword:'radio',excludedKeywords:['image'],acronymMeaning:'modulation',fuzzy:false};
 const materials=[{id:'radio',kind:'note',title:'CNN radio modulation',sourceText:'wireless channel'},{id:'vision',kind:'note',title:'Image recognition',sourceText:'computer vision'}];
 const project={id:'p',title:'通信研究',researchScope:structuredClone(scope),researchPreparation:{researchScope:structuredClone(scope),plan:{method:'人工实验方案'}},materials,blocks:[{text:'人工正文',materials:[{id:'radio',revision:1}]}],ui:{}};
 const state={topic:'p',type:'用户笔记',sort:'manual',selection:['radio'],filter:'不匹配',facets:{year:'2025',verification:'verified',section:'方法',recordType:'annotation',source:'某文献'},categoryID:'subclass'};
 project.ui.catalog=state;
 catalogResults(materials,'',project,state);
 const retained=structuredClone({plan:project.researchPreparation,scope:project.researchScope,materials:project.materials,blocks:project.blocks,catalog:project.materialCatalog}),selected=state.selection;
 assert.equal(filterMaterialScope(catalogResults(materials,'CNN',project,state),project,'CNN').length,0);
 assert.equal(hasMaterialSearchFilters(project,state,'CNN'),true);
 resetMaterialSearchFilters(project,state);
 assert.deepEqual(filterMaterialScope(catalogResults(materials,'',project,state),project,'').map(row=>row.m.id),['radio','vision']);
 assert.equal(hasMaterialSearchFilters(project,state,''),false);
 assert.equal(state.selection,selected);assert.deepEqual(state.selection,['radio']);
 assert.deepEqual({plan:project.researchPreparation,scope:project.researchScope,materials:project.materials,blocks:project.blocks,catalog:project.materialCatalog},retained);
 assert.equal(researchScopeFromProject(project).domain,'communications','the project research constraint remains active for planning and corpus import');
 saveMaterialBrowseScope(project,{domain:'computer-vision',primaryKeyword:'image'});
 assert.deepEqual(filterMaterialScope(materials.map(m=>({m})),project).map(row=>row.m.id),['vision']);
 assert.deepEqual(project.researchPreparation,retained.plan,'subsequent browsing does not revise the feasibility plan');
});

test('clearing a researched topic also clears its exact identity and terms without editing the plan',()=>{
 const scope={domain:'Spin transport',topicID:'https://openalex.org/T1234',topicTerms:['spintronics'],primaryKeyword:'spin'},project={researchScope:structuredClone(scope),researchPreparation:{researchScope:structuredClone(scope)},ui:{}};
 saveMaterialBrowseScope(project,scope);assert.equal(materialSearchScope(project).topicID,scope.topicID);
 const saved=structuredClone(project.researchPreparation);resetMaterialSearchFilters(project,{});
 assert.equal(materialSearchScope(project).topicID,undefined);assert.equal(materialSearchScope(project).topicTerms,undefined);assert.equal(hasMaterialSearchFilters(project,{},''),false);assert.deepEqual(project.researchPreparation,saved);
 assert.equal(filterMaterialScope([{m:{title:'Unrelated local material'}}],project,'').length,1);
});

test('the clear control cancels an uncommitted secondary keyword and synchronizes its visible fields',()=>{
 class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes=new Map();this.listeners=new Map();this.dataset={};this.value='';}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  get options(){return this.children;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key);}
  addEventListener(key,run){this.listeners.set(key,run);}
 }
 const timers=new Map();let serial=0,changed=0;
 const doc={createElement:tag=>new Element(tag,doc),createElementNS:(_,tag)=>new Element(tag,doc),getElementById:()=>null,querySelector:()=>null,addEventListener(){},defaultView:{setTimeout:run=>{timers.set(++serial,run);return serial;},clearTimeout:id=>timers.delete(id)}};
 doc.head=new Element('head',doc);
 const project={researchPreparation:{researchScope:{domain:'physics',primaryKeyword:'spin',secondaryKeyword:'quantum',fuzzy:false}},ui:{materialResearchScope:{domain:'physics',primaryKeyword:'spin',secondaryKeyword:'quantum',fuzzy:false}}},catalog={selection:['keep']};
 const before=structuredClone(project.researchPreparation),host=new Element('div',doc);
 const root=installMaterialResearchFilters(host,project,{onChange:()=>changed++,onReset:()=>resetMaterialSearchFilters(project,catalog),active:()=>hasMaterialSearchFilters(project,catalog)});
 const [picker,reset,secondary,fuzzy]=root.children,domain=picker.children[0];
 assert.equal(domain.value,'physics');assert.equal(reset.disabled,false);
 secondary.value='stale keyword';secondary.oninput();assert.equal(timers.size,1);
 reset.onclick();assert.equal(timers.size,0,'a delayed input cannot restore the old filter after clear');
 assert.equal(domain.value,'');assert.equal(secondary.value,'');assert.equal(fuzzy.getAttribute('aria-pressed'),'true');assert.equal(reset.disabled,true);assert.equal(changed,0);
 assert.deepEqual(catalog.selection,['keep']);assert.deepEqual(project.researchPreparation,before);
});

test('prepared sources are browsable without matching the entire feasibility goal in every excerpt',()=>{
 const project={researchScope:{domain:'communications',primaryKeyword:'Camera IoT adaptation optimization',secondaryKeyword:'bandwidth',fuzzy:true},researchPreparation:{plan:{feasibility:'人工确认的方案'}},ui:{}},before=structuredClone(project),rows=[{m:{id:'method',title:'AccMPEG 方法',sourceText:'根据目标检测任务分配视频编码质量。'}},{m:{id:'result',title:'实验结果',sourceText:'Comparison of video compression performance.'}}];
 assert.equal(materialSearchScope(project).primaryKeyword,'');assert.equal(materialSearchScope(project).domain,'');assert.deepEqual(filterMaterialScope(rows,project,''),rows);assert.deepEqual(project,before);
 saveMaterialBrowseScope(project,{primaryKeyword:'AccMPEG'});assert.deepEqual(filterMaterialScope(rows,project).map(row=>row.m.id),['method']);assert.deepEqual(project.researchScope,before.researchScope);
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

test('material annotations open on the right without resizing the paper and clamp on narrow canvases',()=>{
 const roomy=materialMarginGeometry({innerWidth:1100,pageRight:820});assert.equal(roomy.left,828);assert.equal(roomy.railWidth,228);
 for(const innerWidth of [10,220,346,640,900,1100,1600])for(const pageRight of [80,300,794,1400]){
  const layout=materialMarginGeometry({innerWidth,pageRight});
  assert.ok(layout.left>=0);assert.ok(layout.left+layout.railWidth<=innerWidth,`${innerWidth}px canvas keeps annotation controls reachable`);
  assert.ok(layout.railWidth>0);assert.equal(layout.paperWidth,undefined);assert.equal(layout.paperOffset,undefined,'floating annotations never prescribe a paper offset');
 }
 assert.ok(materialMarginGeometry({innerWidth:346}).railWidth<roomy.railWidth,'a narrow canvas reduces only the annotation card');
});
