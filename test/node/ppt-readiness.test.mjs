/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationReadiness,PRESENTATION_TIMING_ESTIMATE} from '../../chrome/content/zotero/research/shared/ppt-readiness.mjs';

const ownBlock=(text='我们采用独立批次检查泛化表现。')=>({kind:'my_interpretation',text,evidenceIDs:[],quote:''});
const page=(id='s1',extra={})=>({id,title:'独立批次的验证方案',layout:'text',explanation:'固定评价条件后比较批次。',blocks:[ownBlock()],notes:'先介绍数据划分，再讨论批次差异。',assetIDs:[],status:'user',...extra});
const draft=(slides=[page()],extra={})=>({title:'研究进展',minutes:15,slides,sources:[],assets:[],datasets:[],...extra});
const issue=(report,code)=>report.issues.find(row=>row.id.endsWith(code));

test('valid manual research needs no invented citations and the local report does not mutate saved work',()=>{
 const value=draft([page(),page('s2',{blocks:[{...ownBlock('实测准确率为 0.73，后续增加独立测试批次。'),kind:'my_experiment'}]})]),before=structuredClone(value),report=presentationReadiness(value);
 assert.deepEqual(value,before);assert.equal(report.totalPages,2);assert.equal(report.readyPages,2);assert.equal(report.counts.errors,0);assert.equal(report.counts.warnings,0);assert.equal(report.targetMinutes,15);
});

test('generated and pending empty pages both fail the real required-content export check',()=>{
 const report=presentationReadiness(draft([page('empty-generated',{blocks:[],status:'generated'}),page('empty-pending',{blocks:[],status:'pending'})]));
 assert.equal(report.readyPages,0);assert.equal(report.counts.pendingPages,2);assert.equal(report.counts.errors,2);assert.deepEqual(report.issues.map(row=>[row.action,row.slideID,row.pageIndex]),[['generate','empty-generated',0],['generate','empty-pending',1]]);
});

test('invalid paper quotations remain export blockers even when their source ID is known',()=>{
 const source={id:'paper',text:'The independent test cohort contains 30 samples.'},valid={kind:'paper_fact',text:'独立测试队列包含 30 个样本。',evidenceIDs:['paper'],quote:source.text};
 const good=presentationReadiness(draft([page('fact',{blocks:[valid],status:'generated'})],{sources:[source]}));assert.equal(good.counts.errors,0);
 const bad=presentationReadiness(draft([page('fact',{blocks:[{...valid,quote:'The source never reported this result.'}],status:'generated'})],{sources:[source]}));assert.equal(bad.readyPages,0);assert.equal(issue(bad,'unbound-fact').severity,'error');
});

test('stale sources and images give a usable material action instead of a generic export failure',()=>{
 const report=presentationReadiness(draft([page('stale',{blocks:[{...ownBlock(),evidenceIDs:['removed-source']}],assetIDs:['removed-image']})]));
 assert.equal(issue(report,'missing-evidence').action,'materials');assert.equal(issue(report,'missing-asset').action,'materials');assert.equal(report.readyPages,0);assert.equal(report.counts.errors,2);
});

test('duplicate page identities identify both affected positions and empty titles require an edit',()=>{
 const report=presentationReadiness(draft([page('same'),page('same',{title:' '})]));
 assert.equal(report.issues.filter(row=>row.id.endsWith('duplicate-id')).length,2);assert.equal(issue(report,'title').pageIndex,1);assert.equal(issue(report,'title').action,'edit');assert.equal(report.readyPages,0);
});

test('missing dataset references and malformed numerical data are reported before rendering',()=>{
 const report=presentationReadiness(draft([page('data',{datasetID:'missing',layout:'balanced'})]));assert.equal(issue(report,'missing-dataset').severity,'error');assert.match(issue(report,'missing-dataset').detail,/missing/);
 const dataset={id:'measurements',provenance:'用户独立实验',labels:['A','B'],series:[{name:'Accuracy',values:[0.73]}]},bad=presentationReadiness(draft([page('data',{datasetID:dataset.id,layout:'balanced'})],{datasets:[dataset]}));assert.equal(issue(bad,'invalid-dataset').action,'materials');
 const good=presentationReadiness(draft([page('data',{datasetID:dataset.id,layout:'balanced'})],{datasets:[{...dataset,series:[{name:'Accuracy',values:[0.73,0.78]}]}]}));assert.equal(good.counts.errors,0);
});

test('missing visuals, dense copy, unverified points and missing notes are warnings that keep a page ready',()=>{
 const report=presentationReadiness(draft([page('dense',{layout:'visual',explanation:'',notes:'',blocks:[{kind:'unverified',text:'待核验'.repeat(60),evidenceIDs:[]},ownBlock('研究内容'.repeat(55)),ownBlock('比较条件'.repeat(55)),ownBlock('讨论内容'.repeat(55))]})]));
 for(const code of ['missing-visual','dense-content','unverified','speaker-notes'])assert.equal(issue(report,code).severity,'warning',code);
 assert.equal(report.counts.errors,0);assert.equal(report.readyPages,1);assert.equal(report.counts.unverifiedPages,1);assert.equal(report.counts.missingNotesPages,1);
});

test('two-image comparison checks distinct selected images, and an image without a file path blocks export',()=>{
 const assets=[{id:'a',path:'/kept/a.png'},{id:'b',path:'/kept/b.png'}],one=presentationReadiness(draft([page('comparison',{layout:'comparison',assetIDs:['a','a']})],{assets}));assert.equal(issue(one,'comparison-visual').severity,'warning');
 const two=presentationReadiness(draft([page('comparison',{layout:'comparison',assetIDs:['a','b']})],{assets}));assert.equal(issue(two,'comparison-visual'),undefined);assert.equal(two.readyPages,1);
 const lost=presentationReadiness(draft([page('image',{assetIDs:['a']})],{assets:[{id:'a',thumbnail:'/kept/thumbnail.png'}]}));assert.equal(issue(lost,'asset-path').severity,'error');
});

test('legacy and malformed draft fields never throw and never hide required export errors',()=>{
 for(const value of [undefined,null,{}, {slides:null}, {slides:[null]},draft([{id:'old',title:'旧版内容',blocks:[{kind:'my_interpretation',text:'保存下来的人工内容'}]}])]){
  const report=presentationReadiness(value);assert.ok(report.counts.errors>0);assert.equal(report.readyPages,0);
 }
 const empty=presentationReadiness({});assert.equal(issue(empty,'empty-deck').action,'outline');assert.equal(empty.targetMinutes,null);assert.equal(empty.estimatedMinutes,0);
});

test('time uses a documented planning estimate, does not add duplicate copy and never blocks export',()=>{
 const report=presentationReadiness(draft([page('timed',{explanation:'',blocks:[ownBlock('测'.repeat(180))],notes:'讲'.repeat(180)})],{minutes:1}));
 assert.equal(PRESENTATION_TIMING_ESTIMATE.unitsPerMinute,180);assert.equal(report.estimatedMinutes,1.3);assert.match(PRESENTATION_TIMING_ESTIMATE.description,/试讲/);assert.equal(issue(report,'over-time').severity,'warning');assert.equal(report.counts.errors,0);assert.equal(report.readyPages,1);
 const visual=presentationReadiness(draft([page('timed',{layout:'balanced',explanation:'',blocks:[ownBlock('测'.repeat(180))],notes:'',assetIDs:['image']})],{assets:[{id:'image',path:'/kept/image.png'}]}));assert.equal(visual.estimatedMinutes,1.5);
});

test('a missing report name and the exporter page cap are actionable draft errors',()=>{
 const report=presentationReadiness(draft(Array.from({length:51},(_,index)=>page('s'+index)),{title:''}));assert.equal(issue(report,'presentation-title').action,'materials');assert.equal(issue(report,'too-many-pages').action,'outline');assert.equal(report.counts.errors,2);
});
