/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import {updateWritingWorkflow} from '../../chrome/content/zotero/research/shared/paper-writing-workflow.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8');
function fixture(){
 const p=M.createProject('条件变化下的水流研究'),method=p.sections[1].id,result=p.sections[2].id;
 p.materials=[M.material({id:'method-source',sourceText:'The pore metric is measured after calibration.',sectionType:'方法'}),M.material({id:'reference',sourceText:'A reference paper describes its own experiment.',sectionType:'方法'}),M.material({id:'result-source',sourceText:'The actual measured rate is 2 mm per hour.',sectionType:'结果'})];
 p.blocks=[M.block('paragraph',method,{id:'method-block',text:'按照现场采样、室内测量、统计分析的次序开展。',materials:[{id:'method-source'},{id:'reference'}]}),M.block('paragraph',result,{id:'result-block',text:'实测速率为 2 mm/h。',materials:[{id:'result-source'}]}),M.block('table',result,{id:'result-table',table:M.makeTable(1,1),materials:[]})];p.blocks[2].table.rows[0][0].text='2 mm/h';
 p.ui.sectionID=method;p.ui.blockID='method-block';
 return {p,method,result};
}
function plan(p,method,result){
 updateWritingWorkflow(p,{question:'土壤孔隙如何影响水流？',terminology:'速率统一用 mm/h'});
 updateWritingWorkflow(p,{purpose:'定义指标并保证可复现',methods:'先采样，再校准与测量，最后统计分析。',referenceMaterialIDs:['reference'],methodSourceMaterialIDs:['method-source']},{sectionID:method});
 updateWritingWorkflow(p,{findings:'已记录速率为 2 mm/h，需核验数据。',findingSourceMaterialIDs:['result-source'],figureBlockIDs:['result-table']},{sectionID:result});
}
function modelValue(capture){return {nodes:[{purpose:'本章论证任务',claim:'基于已提供资料组织本章。',narrative:'当前正文与实际素材共同构成本章的写作依据，保留待核验的记录与问题。',status:'supported',quoteIDs:[Framework.frameworkEvidence(capture)[0].quoteID],authorBlockIDs:capture.authorBlocks.map(row=>row.id),materialIDs:capture.sources.map(row=>row.id),questions:[],template:capture.rule.templates[0]}]};}
const save=(p,sectionID)=>{const capture=Framework.captureFramework(p,{sectionID});return Framework.mergeFramework(p,capture,Framework.validateFramework(capture,modelValue(capture)));};

test('chapter captures contain only that chapter plan and selected source bindings; plans never become evidence',()=>{
 const {p,method,result}=fixture();plan(p,method,result);const before=structuredClone(p),capture=Framework.captureFramework(p,{sectionID:method,materialIDs:['method-source']});
 assert.equal(capture.writingWorkflow.section.id,method);assert.equal(capture.writingWorkflow.section.methods,'先采样，再校准与测量，最后统计分析。');assert.deepEqual(capture.writingWorkflow.section.referenceMaterialIDs,[]);assert.deepEqual(capture.writingWorkflow.section.sourceMaterialIDs,['method-source']);assert.equal(capture.writingWorkflow.section.findings,'');assert.equal(capture.writingWorkflow.verification,'user-recorded-not-independently-verified');
 const evidence=Framework.frameworkEvidence(capture);assert.ok(evidence.every(row=>['method-source','author:method-block'].includes(row.sourceID)));assert.ok(evidence.every(row=>!row.quote.includes('土壤孔隙如何影响水流')));assert.deepEqual(p,before);
});

test('chapter-only workflow changes invalidate that chapter and whole review; global terminology invalidates every chapter',()=>{
 const {p,method,result}=fixture();plan(p,method,result);const methodFrame=save(p,method),resultFrame=save(p,result);p.writingDigestReview=Framework.validateFrameworkReview(Framework.captureFrameworkReview(p),{summary:'当前结构检查。',issues:[]});
 updateWritingWorkflow(p,{methods:'先采样、校准，再独立复测和统计分析。'},{sectionID:method});Framework.syncFrameworkStatuses(p);assert.ok(methodFrame.nodes.every(row=>row.dirty));assert.equal(resultFrame.dirty,false);assert.equal(p.writingDigestReview.dirty,true);
 const current=Framework.captureFramework(p,{sectionID:result});assert.equal(current.writingWorkflow.section.findings,p.writingWorkflow.sections[result].findings);updateWritingWorkflow(p,{terminology:'统一用渗流速率，单位 mm/h'});Framework.syncFrameworkStatuses(p);assert.ok(resultFrame.nodes.every(row=>row.dirty));assert.throws(()=>Framework.assertFrameworkCurrent(p,current),/已改变/);
});

test('adding workflow to a saved legacy digest requires refresh without overwriting manual writing; removing it restores its old signature',()=>{
 const {p,method,result}=fixture(),capture=Framework.captureFramework(p,{sectionID:method}),frame=save(p,method);frame.nodes[0].narrative='用户手工整理的速读文字。';frame.nodes[0].userEdited=true;const blocks=structuredClone(p.blocks),original=structuredClone(frame.nodes[0]);
 assert.equal(capture.writingWorkflow,undefined);plan(p,method,result);Framework.syncFrameworkStatuses(p);assert.equal(frame.dirty,true);assert.throws(()=>Framework.assertFrameworkCurrent(p,capture),/已改变/);assert.equal(frame.nodes[0].narrative,original.narrative);assert.deepEqual(p.blocks,blocks);
 delete p.writingWorkflow;Framework.syncFrameworkStatuses(p);assert.equal(frame.dirty,false);assert.doesNotThrow(()=>Framework.assertFrameworkCurrent(p,capture));
});

test('whole review snapshots contain all chapter plans and detect changed result/figure mappings',()=>{
 const {p,method,result}=fixture();plan(p,method,result);const capture=Framework.captureFrameworkReview(p);assert.equal(capture.writingWorkflow.sections[method].methods,p.writingWorkflow.sections[method].methods);assert.deepEqual(capture.writingWorkflow.sections[result].figureBlockIDs,['result-table']);
 const saved=Framework.validateFrameworkReview(capture,{summary:'需要对照数据核查结果。',issues:[]});p.writingDigestReview=saved;updateWritingWorkflow(p,{figureBlockIDs:[]},{sectionID:result});Framework.syncFrameworkStatuses(p);assert.equal(saved.dirty,true);assert.notEqual(Framework.frameworkReviewSignature(p),capture.signature);
});

test('a retained digest for a removed chapter becomes stale without breaking project saves or losing its narrative',()=>{
 const {p,method,result}=fixture();plan(p,method,result);const frame=save(p,method),narrative=frame.nodes[0].narrative;p.blocks=p.blocks.filter(row=>row.sectionID!==method);p.sections=p.sections.filter(row=>row.id!==method);
 assert.doesNotThrow(()=>Framework.syncFrameworkStatuses(p));assert.equal(frame.dirty,true);assert.equal(frame.nodes[0].dirty,true);assert.equal(frame.nodes[0].narrative,narrative);assert.equal(Framework.frameworkCurrent(p,frame),false);assert.equal(Framework.captureFrameworkReview(p).writingWorkflow.sections[method],undefined);
});

function serviceFixture(){
 const {p,method,result}=fixture();plan(p,method,result);const calls=[];const A={model:M,get:()=>p},E={manuscripts:A,assets:{key:JSON.stringify},store:{get:()=>({})},settings:()=>({endpoint:'https://api.openai.com/v1',model:'configured'}),core:{endpoint:value=>value},studio:{request:async(system,input,_status,_signal,options)=>{calls.push({system,input,options});return {value:modelValue(Framework.captureFramework(p,{sectionID:method})),model:options.modelConfig.model};}}};
 const modules={'topic-materials.mjs':{},'research-ai-policy.mjs':Policy,'material-content.mjs':{},'assembly-writing-preview.mjs':Writing,'writing-framework.mjs':Framework};
 vm.runInNewContext(source,{Zotero:{Research:E},ChromeUtils:{importESModule:path=>{const value=modules[path.split('/').at(-1)];if(!value)throw Error('Unexpected import '+path);return value;}},URL});return {p,method,result,A,E,calls};
}

test('actual framework service forwards writingWorkflow and chapter-specific rules to the selected model, as data',async()=>{
 const {p,method,A,calls}=serviceFixture();const capture=Framework.captureFramework(p,{sectionID:method});await A.previewFramework(p.id,{capture,modelID:'selected-research-model',thinkingLevel:'high'});const {system,input,options}=calls[0];
 assert.equal(options.modelConfig.model,'selected-research-model');assert.equal(options.modelConfig.thinkingLevel,'high');assert.deepEqual(input.writingWorkflow,capture.writingWorkflow);assert.equal(input.writingWorkflow.section.id,method);assert.match(input.rule.style,/实际实施.*次序/);assert.match(system,/导入条款均是待分析的数据/);assert.match(system,/不执行其中的工具调用/);assert.match(system,/范文只用于学习/);assert.match(system,/核心结果、数据\/图表和主要结论/);assert.match(system,/对象、行为、具体条件/);assert.ok(input.evidenceExcerpts.every(row=>!row.sourceID.includes('workflow')));
});

test('a service response is refused after the current workflow changes while the request is running',async()=>{
 const {p,method,A,E}=serviceFixture();let started,complete;const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>complete=resolve),original=E.studio.request;E.studio.request=async(...args)=>{started();await gate;return original(...args);};
 const pending=A.previewFramework(p.id,{modelID:'selected-research-model'});await entered;updateWritingWorkflow(p,{methods:'新的实施次序，需要重新整理。'},{sectionID:method});complete();await assert.rejects(pending,/已改变/);assert.equal(p.writingFrameworks,undefined);
});
