/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureWritingPreview,assertWritingPreviewCurrent,writingPreviewDiff,validateWritingPreview,writingEvidenceExcerpts,writingEvidenceCoverage,applyWritingPreview,revertWritingPreview,writingResultContext} from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import {writingSnapshotHash} from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import {createHash} from 'node:crypto';
import {protectedTokens} from '../../chrome/content/zotero/research/shared/writing-protection.mjs';
import {assemblyTaskContext} from '../../chrome/content/zotero/research/manuscript/assembly-task-context.mjs';
import {assemblyWritingIntent,captureAssemblyWritingRequest} from '../../chrome/content/zotero/research/manuscript/assembly-writing-request.mjs';
import {assertAIAction,assertResearchPrompt,assertWritingPreviewPrompt} from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
const fixture=()=>({id:'p',title:'独立测试',sections:[{id:'results',title:'结果'},{id:'methods',title:'方法'}],materials:[{id:'m',kind:'note',revision:1,title:'独立测试',sourceText:'Accuracy was 91.2% at 20 Hz. The threshold was $x_i \\leq 2$.',anchor:{pageIndex:2}}],blocks:[{id:'b',type:'paragraph',sectionID:'results',text:'准确率为 91.2%，采样率为 20 Hz，阈值为 $x_i \\leq 2$。',materials:[{id:'m',revision:1,role:'primary'}],revision:1,runs:[{text:'准确率为 ',bold:true},{text:'91.2%，采样率为 20 Hz，阈值为 $x_i \\leq 2$。',italic:true}]},{id:'next',type:'paragraph',sectionID:'methods',text:'人工方法原文。',materials:[],revision:1}],ui:{blockID:'b',sectionID:'results'},proposals:[]});
const variants=capture=>{const quoteIDs=writingEvidenceExcerpts(capture).map(row=>row.quoteID);return {variants:[{label:'先报告结果',text:'独立测试的准确率为 91.2%，采样率为 20 Hz，阈值为 $x_i \\leq 2$。',quoteIDs},{label:'先说明条件',text:'在 20 Hz 的采样条件与 $x_i \\leq 2$ 的阈值下，准确率为 91.2%。',quoteIDs}]};};
const preview=p=>{const capture=captureWritingPreview(p);return validateWritingPreview(capture,variants(capture),{id:'test-preview',model:'selected-model',thinkingLevel:'high'});};
test('candidate generation is separate from author manuscript and carries at least two verified alternatives',()=>{
 const p=fixture(),before=structuredClone(p),result=preview(p);assert.deepEqual(p,before);assert.equal(result.status,'pending');assert.equal(result.variants.length,2);assert.equal(result.model,'selected-model');assert.ok(result.variants.every(row=>row.evidence.some(e=>e.sourceID==='m')));assert.ok(result.variants[0].diff.some(part=>part.kind==='insert'));
});
test('preview rejects missing/invented evidence, duplicate alternatives and changed numerical/LaTeX content',()=>{
 const p=fixture(),capture=captureWritingPreview(p);for(const mutate of [value=>value.variants.pop(),value=>value.variants[1].text=value.variants[0].text,value=>value.variants[0].quoteIDs=['W999'],value=>value.variants[0].text=value.variants[0].text.replace('91.2%','99.9%'),value=>value.variants[0].text=value.variants[0].text.replace('20 Hz','20 ms'),value=>value.variants[0].text=value.variants[0].text.replace('x_i','x_j')]){const value=variants(capture);mutate(value);assert.throws(()=>validateWritingPreview(capture,value));}assert.equal(p.blocks[0].revision,1);
});
test('manual adoption preserves material identities, untouched blocks and formatting on unchanged original words',()=>{
 const p=fixture(),before=structuredClone(p),result=preview(p);p.proposals.push(result);assert.throws(()=>applyWritingPreview(p,result,result.variants[0].id),/确认采用/);const changed=applyWritingPreview(p,result,result.variants[0].id,{confirmed:true});assert.equal(changed.text,result.variants[0].text);assert.deepEqual(changed.materials,before.blocks[0].materials);assert.deepEqual(p.materials,before.materials);assert.deepEqual(p.blocks[1],before.blocks[1]);assert.ok(changed.runs.some(row=>row.bold&&row.text.includes('准确率')));assert.ok(changed.runs.some(row=>row.italic&&row.text.includes('$x_i \\leq 2$')));assert.equal(result.status,'accepted');
 revertWritingPreview(p,result,{confirmed:true});assert.deepEqual(p.blocks,before.blocks);assert.deepEqual(p.materials,before.materials);assert.equal(result.status,'reverted');
});
test('concurrent author/source/outline changes or a locked/changed selection reject pending previews',()=>{
 for(const mutate of [p=>p.blocks[0].text+='人工补充',p=>p.blocks[0].runs[0].bold=false,p=>p.materials[0].sourceText+='source update',p=>p.materials[0].revision++,p=>p.sections[0].title='讨论',p=>p.blocks[0].locked=true,p=>p.ui.blockID='next']){const p=fixture(),result=preview(p);mutate(p);const before=structuredClone(p);assert.throws(()=>applyWritingPreview(p,result,result.variants[0].id,{confirmed:true}));assert.deepEqual(p,before);}
});
test('revert refuses to overwrite later manual edits or locks',()=>{
 for(const mutate of [p=>p.blocks[0].text+='新的人工解释',p=>p.blocks[0].locked=true]){const p=fixture(),result=preview(p);applyWritingPreview(p,result,result.variants[0].id,{confirmed:true});mutate(p);const before=structuredClone(p);assert.throws(()=>revertWritingPreview(p,result,{confirmed:true}),/人工修改|锁定/);assert.deepEqual(p,before);}
});
test('empty section previews create a real same-section paragraph only after manual adoption and can revert it',()=>{
 const p=fixture();p.blocks=p.blocks.slice(1);p.ui.blockID='';const before=structuredClone(p),result=preview(p);assert.equal(p.blocks.length,1);applyWritingPreview(p,result,result.variants[0].id,{confirmed:true,createBlock:(type,sectionID)=>({id:'created',type,sectionID,text:'',materials:[],revision:1})});const block=p.blocks.find(row=>row.id==='created');assert.equal(block.sectionID,'results');assert.deepEqual(block.materials,[{id:'m',revision:1,role:'support'}]);assert.equal(p.blocks[1].id,'next');p.proposals.push(result);assert.equal(writingResultContext(p).status,'accepted');revertWritingPreview(p,result,{confirmed:true});assert.deepEqual(p.blocks,before.blocks);
});
test('an existing empty paragraph gains the chosen real evidence bindings only when its candidate is adopted',()=>{
 const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;p.blocks[0].materials=[];const result=preview(p);assert.deepEqual(p.blocks[0].materials,[]);applyWritingPreview(p,result,result.variants[0].id,{confirmed:true});assert.deepEqual(p.blocks[0].materials,[{id:'m',revision:1,role:'support'}]);assert.ok(p.blocks[0].evidence.every(row=>row.materialID==='m'&&p.materials[0].sourceText.includes(row.quote)));revertWritingPreview(p,result,{confirmed:true});assert.deepEqual(p.blocks[0].materials,[]);assert.equal(p.blocks[0].evidence,undefined);
});
test('adopting a placeholder produces an exportable paragraph and reverts its full original identity',()=>{
 const p=fixture();p.blocks[0].type='placeholder';p.blocks[0].text='';delete p.blocks[0].runs;const before=structuredClone(p.blocks[0]),result=preview(p);assert.equal(p.blocks[0].type,'placeholder');const block=applyWritingPreview(p,result,result.variants[0].id,{confirmed:true});assert.equal(block.type,'paragraph');assert.equal(block.id,before.id);assert.equal(block.sectionID,before.sectionID);assert.equal(block.text,result.variants[0].text);revertWritingPreview(p,result,{confirmed:true});assert.deepEqual(p.blocks[0],before);
});
test('text diffs can reconstruct each side exactly and never carry raw HTML',()=>{
 for(const [before,after]of [['甲乙 old $x_i$。','甲丙 new $x_i$。'],['','新增正文'],['保留原段落',''],['<script>旧</script>','<strong>新</strong>']]){const diff=writingPreviewDiff(before,after);assert.equal(diff.filter(part=>part.kind!=='insert').map(part=>part.text).join(''),before);assert.equal(diff.filter(part=>part.kind!=='delete').map(part=>part.text).join(''),after);assert.ok(diff.every(part=>typeof part.text==='string'&&!('html' in part)));}
});
test('result context derives actual candidate state and ignores pointer position',()=>{
 const p=fixture(),result=preview(p);p.proposals.push(result);p.hoveredBlockID='next';assert.equal(assemblyTaskContext(p).writingResult.previewID,result.id);assert.equal(writingResultContext(p).selectedText,result.variants[0].text);p.ui.blockID='next';p.ui.sectionID='methods';assert.equal(writingResultContext(p),null);
});
test('dedicated candidate requests are allowed while legacy direct write/apply and image generation remain closed',()=>{
 assert.equal(assertAIAction('manuscript_preview'),'manuscript_preview');assert.equal(assertWritingPreviewPrompt('请润色当前段落'),'请润色当前段落');assert.throws(()=>assertResearchPrompt('请润色当前段落'));for(const name of ['manuscript_write','manuscript_rewrite','manuscript_apply'])assert.throws(()=>assertAIAction(name));assert.throws(()=>assertWritingPreviewPrompt('请生成一张图片'));assert.ok(assemblyWritingIntent('请润色当前段落'));assert.ok(assemblyWritingIntent('准备两个候选正文'));assert.equal(assemblyWritingIntent('解释原文公式'),false);assert.equal(captureAssemblyWritingRequest(fixture(),'解释原文公式'),null);assert.equal(captureAssemblyWritingRequest(fixture(),'请润色当前段落').blockID,'b');
});
test('real content captures remain current across unrelated UI/save state, but stale material records are rejected',()=>{
 const p=fixture(),capture=captureWritingPreview(p);p.revision=100;p.ui.scrollTop=450;assert.doesNotThrow(()=>assertWritingPreviewCurrent(p,capture));p.materials[0].verification='stale';assert.throws(()=>captureWritingPreview(p),/来源有更新/);
});
test('source snapshots use SHA-256 over exact UTF-8 including long Unicode originals',()=>{
 for(const text of ['', 'abc', '中文与 $E_{\\mathrm{F}}$ 😀', 'a'.repeat(1000000)])assert.equal(writingSnapshotHash(text),'sha256:'+createHash('sha256').update(text).digest('hex'));
});
test('long chapters share the bounded evidence budget and expose the exact omitted ranges',()=>{
 const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;p.materials[0].sourceText='a'.repeat(90000);p.materials.push({id:'second',revision:1,kind:'note',title:'第二材料',sourceText:'b'.repeat(90000),anchor:{}});p.blocks[0].materials.push({id:'second',revision:1});
 const capture=captureWritingPreview(p),excerpts=writingEvidenceExcerpts(capture),coverage=writingEvidenceCoverage(capture,excerpts);assert.equal(excerpts.length,80);assert.deepEqual(excerpts.slice(0,2).map(row=>row.sourceID),['m','second']);assert.equal(excerpts.filter(row=>row.sourceID==='m').length,40);assert.equal(excerpts.filter(row=>row.sourceID==='second').length,40);
 for(const row of coverage){assert.equal(row.totalCharacters,90000);assert.equal(row.readCharacters,40000);assert.equal(row.truncated,true);assert.deepEqual(row.ranges[0],{start:0,end:1000});}
 for(const row of excerpts)assert.equal(row.quote,p.materials.find(material=>material.id===row.sourceID).sourceText.slice(row.start,row.end));
});
test('persisted candidates retain only used exact quotes, not complete chapter copies or literal fingerprints',()=>{
 const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;p.materials[0].sourceText='Original source text. '.repeat(60000);p.materials[0].anchor.sourceText=p.materials[0].sourceText;p.materials.push({id:'second',revision:1,kind:'note',title:'第二材料',sourceText:'Second source text.',anchor:{pageIndex:8}});p.blocks[0].materials.push({id:'second',revision:1});
 const capture=captureWritingPreview(p),quoteIDs=writingEvidenceExcerpts(capture).slice(0,2).map(row=>row.quoteID),result=validateWritingPreview(capture,{variants:[{label:'一',text:'两份材料提供了不同的研究条件。',quoteIDs},{label:'二',text:'研究条件分别来自两份实际材料。',quoteIDs}]});
 assert.equal(result.capture.sources[0].text,undefined);assert.equal(result.capture.sources[0].anchor,undefined);assert.match(result.capture.sources[0].textHash,/^sha256:[a-f0-9]{64}$/);assert.equal(result.capture.fingerprint.length,71);assert.equal(result.capture.evidenceExcerpts.length,2);assert.ok(JSON.stringify(result).length<10000);
 const reloaded=JSON.parse(JSON.stringify(result));assert.doesNotThrow(()=>assertWritingPreviewCurrent(p,reloaded.capture));const edited=validateWritingPreview(reloaded.capture,{variants:reloaded.variants.map(row=>({label:row.label,text:row.text,quoteIDs:row.evidence.map(e=>e.quoteID)}))});assert.deepEqual(edited.variants.map(row=>row.text),result.variants.map(row=>row.text));applyWritingPreview(p,reloaded,reloaded.variants[0].id,{confirmed:true});revertWritingPreview(p,reloaded,{confirmed:true});assert.equal(p.blocks[0].text,'');
});
test('compact persisted previews detect same-revision unseen-tail, anchor and exact-quote corruption',()=>{
 for(const mutate of [p=>p.materials[0].sourceText=p.materials[0].sourceText.slice(0,-1)+'changed',p=>p.materials[0].anchor.pageIndex=9,p=>p.materials[0].anchor.sourceText='changed anchor text',p=>p.materials[0].anchors[1].pageIndex=10,p=>p.materials[0].latex='x_j',(_p,result)=>result.capture.evidenceExcerpts[0].quote='invented quote']){
  const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;p.materials[0].sourceText='source '.repeat(20000);p.materials[0].anchors=[{pageIndex:2},{pageIndex:3}];const capture=captureWritingPreview(p),quoteIDs=[writingEvidenceExcerpts(capture)[0].quoteID],result=validateWritingPreview(capture,{variants:[{text:'材料记录了研究条件。',quoteIDs},{text:'研究条件来自实际材料。',quoteIDs}]});mutate(p,result);const before=structuredClone(p);assert.throws(()=>applyWritingPreview(p,result,result.variants[0].id,{confirmed:true}),/来源已变化|依据与原文/);assert.deepEqual(p,before);
 }
});
test('balanced excerpts keep complete inline math when a source formula crosses the chunk boundary',()=>{
 const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;const latex='$E_{\\mathrm{F}} = x_i + 2$';p.materials[0].sourceText='a'.repeat(990)+latex+' more evidence';const capture=captureWritingPreview(p),excerpts=writingEvidenceExcerpts(capture);assert.equal(excerpts[0].end,990);assert.ok(excerpts.some(row=>row.quote.includes(latex)));for(const row of excerpts)assert.doesNotThrow(()=>protectedTokens(row.quote));assert.doesNotThrow(()=>validateWritingPreview(capture,{variants:[{text:'原式为 '+latex+'。',quoteIDs:excerpts.map(e=>e.quoteID)},{text:'依据 '+latex+' 可解释该条件。',quoteIDs:excerpts.map(e=>e.quoteID)}]}));
});
test('too many selected sources fail clearly instead of silently skipping later materials',()=>{
 const p=fixture();p.blocks[0].text='';delete p.blocks[0].runs;p.materials=Array.from({length:81},(_,index)=>({id:'m'+index,revision:1,kind:'note',title:'真实材料 '+index,sourceText:'Actual evidence.',anchor:{}}));p.blocks[0].materials=p.materials.map(row=>({id:row.id,revision:1}));assert.throws(()=>writingEvidenceExcerpts(captureWritingPreview(p)),/超过 80 份/);
});
test('mutable request snapshots cannot replace human text or source quotes without matching the current project',()=>{
 for(const mutate of [capture=>capture.before.text='fabricated human text',capture=>capture.sources[0].text='fabricated original source']){const p=fixture(),capture=captureWritingPreview(p);mutate(capture);assert.throws(()=>assertWritingPreviewCurrent(p,capture),/快照与当前原文/);}
});
test('existing version-one candidates keep their original sequential evidence identifiers and strict stale protection',()=>{
 const stable=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
 const p=fixture(),capture=captureWritingPreview(p);capture.version=1;capture.sources=p.materials.map(material=>({id:material.id,revision:material.revision,assetID:material.assetID||'',kind:material.kind,title:material.title||'',paperTitle:material.paperTitle||'',text:material.sourceText,anchor:structuredClone(material.anchor||{}),verification:material.verification||'',aiGenerated:!!material.aiGenerated}));capture.fingerprint=stable({projectID:capture.projectID,title:capture.title,sectionID:capture.sectionID,blockID:capture.blockID,before:capture.before,outline:capture.outline,sources:capture.sources});const result=validateWritingPreview(capture,variants(capture));assert.doesNotThrow(()=>assertWritingPreviewCurrent(p,result.capture));applyWritingPreview(p,result,result.variants[0].id,{confirmed:true});revertWritingPreview(p,result,{confirmed:true});p.materials[0].anchor.pageIndex=7;assert.throws(()=>assertWritingPreviewCurrent(p,result.capture),/来源已变化/);
});
