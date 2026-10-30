/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSelectionTarget,assertSelectionTargetCurrent,selectionRequestContext,validateSelectionPreview,applySelectionPreview,revertSelectionPreview} from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import {rangeTextOffsets} from '../../chrome/content/zotero/research/manuscript/selection-assistant.mjs';
import {createMaterialHighlight,createMaterialHighlightGroup} from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import {updateWritingWorkflow} from '../../chrome/content/zotero/research/shared/paper-writing-workflow.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
const fixture=()=>({id:'paper',title:'独立测试',sections:[{id:'intro',title:'引言'},{id:'method',title:'方法'}],materials:[{id:'source',revision:1,kind:'note',summary:'该素材说明独立验证条件。',sourceText:'The controlled study uses held-out validation data. Accuracy was 91.2%.',anchor:{pageIndex:2},highlights:[]}],blocks:[{id:'a',sectionID:'intro',type:'paragraph',text:'保留前句。准确率为 91.2%，采样率为 20 Hz [1]。保留后句。',runs:[{text:'保留前句。',bold:true},{text:'准确率为 91.2%，采样率为 20 Hz [1]。',italic:true},{text:'保留后句。',bold:true}],materials:[{id:'source',revision:1}],revision:1},{id:'b',sectionID:'method',type:'paragraph',text:'完全独立的方法。',materials:[],revision:1}],writingFrameworks:{intro:{nodes:[{id:'unit',narrative:'建立问题。说明现有研究的验证范围。保留后文。',evidence:[{sourceID:'source'}],userEdited:false}]}},ui:{sectionID:'intro',blockID:'a'},proposals:[]});
const capture=project=>{const text='准确率为 91.2%，采样率为 20 Hz [1]。',start=project.blocks[0].text.indexOf(text);return captureSelectionTarget(project,{kind:'block',blockID:'a',start,end:start+text.length});};
const variants=()=>({variants:[{label:'先报告指标',text:'准确率达到 91.2%，采样频率为 20 Hz [1]。'},{label:'先交代条件',text:'采样率为 20 Hz 时，准确率为 91.2% [1]。'}]});
test('normalized DOM Range offsets do not depend on selection anchor or focus direction',()=>{
 const host={textContent:'甲乙丙丁戊',contains:node=>node?.host===host},start={host},end={host};
 // Both forward and backward Selection use this same normalized Range.
 const range={startContainer:start,endContainer:end,startOffset:1,endOffset:4,toString:()=> '乙丙丁',cloneRange:()=>({selectNodeContents(){},setEnd(){},toString:()=> '甲'})};
 for(const selection of [{anchorNode:start,focusNode:end,range},{anchorNode:end,focusNode:start,range}])assert.deepEqual(rangeTextOffsets(host,selection.range),{start:1,end:4,text:'乙丙丁',full:'甲乙丙丁戊'});
});
test('selected rewrite changes only the captured passage and keeps adjacent formatting and sections',()=>{
 const project=fixture(),before=structuredClone(project),target=capture(project),preview=validateSelectionPreview(target,variants());assert.deepEqual(project,before);assert.throws(()=>applySelectionPreview(project,preview,preview.variants[0].id),/确认/);
 applySelectionPreview(project,preview,preview.variants[0].id,{confirmed:true});assert.equal(project.blocks[0].text,'保留前句。准确率达到 91.2%，采样频率为 20 Hz [1]。保留后句。');assert.deepEqual(project.blocks[1],before.blocks[1]);assert.deepEqual(project.materials,before.materials);assert.ok(project.blocks[0].runs[0].bold);assert.ok(project.blocks[0].runs.at(-1).bold);revertSelectionPreview(project,preview,{confirmed:true});assert.deepEqual(project.blocks,before.blocks);
});
test('preview guards exact target, section, locks and sources against asynchronous changes',()=>{
 for(const mutate of [p=>p.blocks[0].text+='新内容',p=>p.blocks[0].sectionID='method',p=>p.blocks[0].locked=true,p=>p.materials[0].sourceText+='changed',p=>p.materials[0].revision++,p=>p.materials[0].anchor.pageIndex=4]){const project=fixture(),target=capture(project);mutate(project);assert.throws(()=>assertSelectionTargetCurrent(project,target));}
 const project=fixture(),target=capture(project);project.ui.blockID='b';project.ui.sectionID='method';project.revision=600;assert.doesNotThrow(()=>assertSelectionTargetCurrent(project,target));assert.equal(selectionRequestContext(project,target).section,'引言');
});
test('selection candidates reject changed figures, units, formulas, citations and duplicate versions',()=>{
 const project=fixture(),target=capture(project);for(const mutate of [v=>v.variants[0].text=v.variants[0].text.replace('91.2','99.9'),v=>v.variants[0].text=v.variants[0].text.replace('Hz','ms'),v=>v.variants[0].text=v.variants[0].text.replace('[1]',''),v=>v.variants[0].text+=' $x_i$',v=>v.variants[1].text=v.variants[0].text]){const value=variants();mutate(value);assert.throws(()=>validateSelectionPreview(target,value));}
});
test('digest selection updates a user-edited narrative without mutating source evidence or manuscript prose',()=>{
 const project=fixture(),before=structuredClone(project),start=project.writingFrameworks.intro.nodes[0].narrative.indexOf('说明'),text='说明现有研究的验证范围。',target=captureSelectionTarget(project,{kind:'digest',sectionID:'intro',unitID:'unit',start,end:start+text.length}),preview=validateSelectionPreview(target,{variants:[{label:'范围优先',text:'界定已有工作的验证范围。'},{label:'问题优先',text:'明确现有研究在哪些条件下进行了验证。'}]});
 applySelectionPreview(project,preview,preview.variants[0].id,{confirmed:true});assert.equal(project.writingFrameworks.intro.nodes[0].narrative,'建立问题。界定已有工作的验证范围。保留后文。');assert.equal(project.writingFrameworks.intro.nodes[0].userEdited,true);assert.deepEqual(project.blocks,before.blocks);assert.deepEqual(project.materials,before.materials);revertSelectionPreview(project,preview,{confirmed:true});assert.deepEqual(project.writingFrameworks,before.writingFrameworks);
});
test('revert refuses to overwrite subsequent manual work',()=>{
 const project=fixture(),preview=validateSelectionPreview(capture(project),variants());applySelectionPreview(project,preview,preview.variants[0].id,{confirmed:true});project.blocks[0].text+='人工补充';assert.throws(()=>revertSelectionPreview(project,preview,{confirmed:true}),/人工修改/);
});
test('material summary and annotation targets produce a patch rather than changing original evidence',()=>{
 const project=fixture(),material=project.materials[0],highlight=createMaterialHighlight(material,'held-out validation data.',{comment:'记录原始批注。'});material.highlights=[highlight];const before=structuredClone(project),target=captureSelectionTarget(project,{kind:'comment',materialID:material.id,highlightID:highlight.id,start:0,end:highlight.comment.length}),preview=validateSelectionPreview(target,{variants:[{text:'保留独立验证条件。'},{text:'说明验证集的划分方式。'}]});const result=applySelectionPreview(project,preview,preview.variants[0].id,{confirmed:true});assert.equal(result.value,'保留独立验证条件。');assert.deepEqual(project,before);assert.equal(result.material,material);
 const summary=captureSelectionTarget(project,{kind:'summary',materialID:material.id,displayText:'中文素材说明。',start:0,end:7});material.summary+='新的人工内容';assert.throws(()=>assertSelectionTargetCurrent(project,summary),/说明已经修改/);
});
test('source selection drafts an annotation with the same original anchor and never modifies source text',()=>{
 const project=fixture(),material=project.materials[0],selectionGroup=[{quote:'held-out validation data.',prefix:'The controlled study uses ',suffix:' Accuracy was 91.2%.'}],target=captureSelectionTarget(project,{kind:'source-note',materialID:material.id,displayText:'held-out validation data.',selectionGroup,start:0,end:25}),before=structuredClone(project),preview=validateSelectionPreview(target,{variants:[{label:'记录条件',text:'用于说明独立验证条件。'},{label:'待检查',text:'核对验证数据是否独立于训练数据。'}]});
 const result=applySelectionPreview(project,preview,preview.variants[0].id,{confirmed:true});assert.deepEqual(project,before);const saved=createMaterialHighlightGroup(material,target.selectionGroup,{comment:result.variant.text});assert.equal(saved[0].quote,'held-out validation data.');assert.equal(material.sourceText.slice(saved[0].start,saved[0].end),saved[0].quote);assert.equal(saved[0].comment,'用于说明独立验证条件。');
});

test('selected editing carries only its chapter plan and rejects changed requirements while allowing unrelated chapter edits',()=>{
 const project=fixture();updateWritingWorkflow(project,{question:'独立验证条件如何影响表现？',terminology:'统一称独立验证'});updateWritingWorkflow(project,{purpose:'界定验证问题',structure:'先条件，再指标',methodSourceMaterialIDs:['source']},{sectionID:'intro'});updateWritingWorkflow(project,{methods:'其他章节的私密操作记录'},{sectionID:'method'});
 const target=capture(project),context=selectionRequestContext(project,target);assert.equal(context.rule.type,'引言');assert.equal(context.writingWorkflow.section.structure,'先条件，再指标');assert.deepEqual(context.writingWorkflow.section.sourceMaterialIDs,['source']);assert.ok(!JSON.stringify(context).includes('私密操作'));
 updateWritingWorkflow(project,{methods:'其他章节改为新的实施次序'},{sectionID:'method'});assert.doesNotThrow(()=>assertSelectionTargetCurrent(project,target));
 updateWritingWorkflow(project,{structure:'先指标，再条件'},{sectionID:'intro'});assert.throws(()=>assertSelectionTargetCurrent(project,target),/计划或要求已经变化/);
 for(const change of [p=>p.blocks[0].requirements='不能提前报告结果',p=>p.sections[0].writingPurpose='说明研究缺口',p=>p.sections[0].title='结果',p=>p.title='改为另一研究问题']){const p=fixture(),selection=capture(p);change(p);assert.throws(()=>assertSelectionTargetCurrent(p,selection),/计划或要求已经变化/);}
});

test('selected rewrite shares the effective feasibility preparation and rejects changes to scope or confirmed decisions',()=>{
 const p=fixture();p.researchScope={domain:'communications',primaryKeyword:'CNN',secondaryKeyword:'modulation'};p.researchPreparation={researchGoal:'比较信道条件',resourceConstraints:'两周',confirmedDecisions:[{decision:'按设备独立划分',reason:'防止数据泄漏'}],openQuestions:['测试条件是否独立？'],plan:{minimumValidation:'先验证基线'}};const target=capture(p),context=selectionRequestContext(p,target);assert.equal(context.preparation.researchScope.secondaryKeyword,'modulation');assert.equal(context.preparation.confirmedDecisions[0].decision,'按设备独立划分');assert.deepEqual(context.preparation.openQuestions,['测试条件是否独立？']);
 for(const mutate of [q=>q.researchScope.domain='physics',q=>q.researchPreparation.confirmedDecisions[0].decision='改用随机划分',q=>q.researchPreparation.openQuestions.push('增加实验')]){const q=structuredClone(p);mutate(q);assert.throws(()=>assertSelectionTargetCurrent(q,target),/计划或要求已经变化/);}
});

test('full source text and secondary PDF anchors participate in asynchronous selection validation',()=>{
 for(const change of [p=>p.materials[0].fullSourceText='另一份完整原文',p=>p.materials[0].sourceBlocks=[{sourceText:'新文本',sourceAnchor:{pageIndex:4}}],p=>p.materials[0].anchors=[{pageIndex:9}]]){const p=fixture(),target=capture(p);change(p);assert.throws(()=>assertSelectionTargetCurrent(p,target),/来源已经变化/);}
 const p=fixture();p.materials[0].fullSourceText='x'.repeat(10020);const context=selectionRequestContext(p,capture(p));assert.equal(context.sources[0].text.length,10000);assert.equal(context.sources[0].truncated,true);
});

test('actual selection service forwards the scoped writing plan and refuses a response after that plan changes',async()=>{
 const p=fixture();updateWritingWorkflow(p,{question:'验证条件是什么？'});updateWritingWorkflow(p,{purpose:'说明当前验证条件',structure:'先条件再指标'},{sectionID:'intro'});const before=structuredClone(p),calls=[],A={model:{clone:structuredClone},get:()=>p},E={manuscripts:A,assets:{key:JSON.stringify},store:{get:()=>({})},settings:()=>({endpoint:'https://fixture.invalid/v1',model:'configured'}),core:{endpoint:value=>value},studio:{request:async(system,input,_progress,_signal,options)=>{calls.push({system,input,options});return {value:variants(),model:options.modelConfig.model};}}};
 const modules={'topic-materials.mjs':{},'research-ai-policy.mjs':Policy,'material-content.mjs':{},'assembly-writing-preview.mjs':{},'writing-framework.mjs':Framework,'selection-target.mjs':Selection};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8'),{Zotero:{Research:E,Utilities:{randomString:()=> 'selected-test'}},ChromeUtils:{importESModule:path=>{const module=modules[path.split('/').at(-1)];if(!module)throw Error('Unexpected import '+path);return module;}},URL});
 const preview=await A.previewSelection(p.id,{target:capture(p),instruction:'学术化改写选段',modelID:'selected-model',thinkingLevel:'high'});assert.equal(preview.status,'pending');assert.deepEqual(p,before);assert.equal(calls[0].options.modelConfig.model,'selected-model');assert.equal(calls[0].options.modelConfig.thinkingLevel,'high');assert.equal(calls[0].input.writingWorkflow.section.structure,'先条件再指标');assert.match(calls[0].system,/禁止 AI 套话/);assert.match(calls[0].system,/范文只学习结构与语言/);
 const original=E.studio.request;E.studio.request=async(...args)=>{const result=await original(...args);updateWritingWorkflow(p,{structure:'请求途中变更结构'},{sectionID:'intro'});return result;};await assert.rejects(A.previewSelection(p.id,{target:capture(p),instruction:'改写选段',modelID:'selected-model'}),/计划或要求已经变化/);assert.deepEqual(p.blocks,before.blocks);assert.deepEqual(p.materials,before.materials);
});

test('a selection rewrite sizes its budget from the selection, and a request to shorten asks for one variant (addendum 2)',async()=>{
 assert.deepEqual(Selection.selectionBudget('短句'),{maxTokens:3000,maxVariants:3,minVariants:2});
 const long='长'.repeat(1600),budget=Selection.selectionBudget(long);assert.equal(budget.maxVariants,1);assert.ok(budget.maxTokens>3000&&budget.maxTokens<=8000);
 assert.deepEqual(Selection.selectionBudget('一段需要缩短的正文。','精简一点'),{maxTokens:3000,maxVariants:1,minVariants:1});
 assert.equal(validateSelectionPreview(capture(fixture()),{variants:[variants().variants[0]]},{minVariants:1}).variants.length,1,'one variant is accepted when only one was asked for');
 assert.throws(()=>validateSelectionPreview(capture(fixture()),{variants:[variants().variants[0]]}),/两个或三个/);
 const p=fixture(),calls=[],A={model:{clone:structuredClone},get:()=>p},E={manuscripts:A,assets:{key:JSON.stringify},store:{get:()=>({})},settings:()=>({endpoint:'https://fixture.invalid/v1',model:'configured'}),core:{endpoint:value=>value},studio:{request:async(system,input,_progress,_signal,options)=>{calls.push({system,input,options});return {value:{variants:[variants().variants[0]]},model:options.modelConfig.model};}}};
 const modules={'topic-materials.mjs':{},'research-ai-policy.mjs':Policy,'material-content.mjs':{},'assembly-writing-preview.mjs':{},'writing-framework.mjs':Framework,'selection-target.mjs':Selection};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8'),{Zotero:{Research:E,Utilities:{randomString:()=> 'budget-test'}},ChromeUtils:{importESModule:path=>{const module=modules[path.split('/').at(-1)];if(!module)throw Error('Unexpected import '+path);return module;}},URL});
 const preview=await A.previewSelection(p.id,{target:capture(p),instruction:'精简这句',modelID:'selected-model'});
 assert.equal(preview.variants.length,1);assert.equal(calls[0].input.maxVariants,1);assert.match(calls[0].system,/提供一个简洁方案/);assert.ok(calls[0].options.maxTokens>=5000,'never below the earlier fixed budget');
});
