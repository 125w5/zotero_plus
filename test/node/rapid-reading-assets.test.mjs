/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {rapidReadingAssets,rapidAssetPresentation} from '../../chrome/content/zotero/research/shared/rapid-reading-assets.mjs';
import {rapidReadingArticleFlow} from '../../chrome/content/zotero/research/shared/rapid-reading-data.mjs';
import {RAPID_READING_PROMPT,rapidReadingDepth,validateRapidReadingDepth,rapidAssetCaptions} from '../../chrome/content/zotero/research/shared/rapid-reading-prompt.mjs';

const whole={id:'whole',attachmentID:13,pdfHash:'same-pdf',kind:'figure',pageIndex:8,label:'Figure A1',caption:'Failure cases in reconstruction.',bbox:[20,30,500,450],path:'complete-failure-cases.png'};

test('reading reuses complete evidence figures, discards unmatched raster fragments and keeps intentional manual crops',()=>{
 const raw={...whole,id:'bitmap',kind:'image',label:'未匹配图号',caption:'',bbox:[30,50,180,120]},partial={...raw,id:'partial-figure',kind:'figure',label:'Fig. A1'},manual={...partial,id:'manual-comparison',label:'Fig. A1(a)',userModified:true},neighbor={...whole,id:'neighbor',label:'Figure A2',bbox:[30,50,180,120]},formula={...whole,id:'formula',kind:'formula',label:'Equation 1'},input=[raw,partial,whole,manual,neighbor,formula,{...whole,id:'excluded',evidenceEligible:false}],before=structuredClone(input);
 assert.deepEqual(rapidReadingAssets(input).map(row=>row.id),['whole','manual-comparison','neighbor','formula']);assert.deepEqual(input,before,'the view does not delete saved extraction records or crops');
 const otherPage={...partial,id:'other-page',pageIndex:9};assert.ok(rapidReadingAssets([whole,otherPage]).includes(otherPage));
});

test('an exact-region manual replacement is retained through the existing evidence deduplicator',()=>{
 const manual={...whole,id:'manual-full',path:'manual-complete.png',userModified:true};const uniqueAssets=rows=>rows.reduce((result,row)=>{const index=result.findIndex(prior=>prior.pageIndex===row.pageIndex&&prior.bbox.join()===row.bbox.join());if(index<0)result.push(row);else if(row.userModified)result[index]=row;return result;},[]);
 assert.strictEqual(rapidReadingAssets([whole,manual],{uniqueAssets})[0],manual);
});

test('a sparse extraction index reuses retained source-linked evidence figures from this attachment only',()=>{
 const material={id:'saved-complete',title:'论文图片 · Figure A1',imageRetained:true,imagePath:'retained-complete.png',sourceRecordID:'pdf-image:same-pdf:8:20,30,500,450',sourceText:'Actual full figure caption.',summary:'完整失败案例对比。',sourceAnchors:[{attachmentID:13,paperItemID:7,pageIndex:8,position:{rects:[[20,350,500,770]]}}]},foreign={...material,id:'foreign-paper',sourceRecordID:'pdf-image:another-pdf:8:20,30,500,450'},wrongAnchor={...material,id:'wrong-attachment',sourceRecordID:'pdf-image:same-pdf:9:20,30,500,450',sourceAnchors:[{attachmentID:99,pageIndex:9}]},before=structuredClone(material);
 const rows=rapidReadingAssets([],{materials:[material,foreign,wrongAnchor],attachmentID:13,pdfHash:'same-pdf'});assert.equal(rows.length,1);assert.equal(rows[0].path,material.imagePath);assert.equal(rows[0].pageHeight,800);assert.deepEqual(rows[0].bbox,whole.bbox);assert.equal(rows[0].caption,material.sourceText);assert.equal(rows[0].label,'Figure A1');assert.equal(rows[0].attachmentID,13);assert.deepEqual(material,before);
 assert.equal(rapidReadingAssets([whole],{materials:[material],attachmentID:13,pdfHash:'same-pdf'}).length,1,'the same original region is not duplicated');
 assert.equal(rapidReadingAssets([],{materials:[material],attachmentID:13,pdfHash:'changed-file'}).length,0,'a replaced PDF cannot reuse images from its old content');
 assert.equal(rapidReadingAssets([],{materials:[material]}).length,0,'both the selected attachment and real PDF hash must be known');
});

test('the Chinese brief and retained full image come from the same saved evidence material without changing it',()=>{
 const material={imageRetained:true,imagePath:'retained-complete.png',summary:'失败案例显示重建遗漏遮挡区域。'.repeat(30),imageExplanation:{result:{sections:[{heading:'失败情形',body:'完整中文说明。'}]}}},before=structuredClone(material),view=rapidAssetPresentation(whole,material);
 assert.equal(view.path,'retained-complete.png');assert.ok(view.summary.length<170);assert.match(view.summary,/失败案例/);assert.doesNotMatch(view.summary,/Failure cases/);assert.equal(view.label,'图 A1');assert.deepEqual(material,before);
 assert.equal(rapidAssetPresentation(whole,{summary:'Pending summary',generationStatus:'pending'}).summary,'中文图表摘要待整理');
});

test('appendix A1 and supplemental S1 attach to their named explanation rather than nearer unrelated text',()=>{
 const sources=[{id:'near',attachmentID:13,pageIndex:8,bbox:[20,35,200,45]},{id:'a1',attachmentID:13,pageIndex:8,bbox:[20,500,200,520]},{id:'s1',attachmentID:13,pageIndex:9,bbox:[20,500,200,520]}],point=(text,sourceID)=>({text,evidence:[{sourceID,quote:'Original figure evidence.'}]}),record={sections:[{role:'method',heading:'局部方法',points:[point('与附录图无关的局部方法。','near')]},{role:'results',heading:'实际失败情形',points:[point('图 A1 展示完整失败案例。','a1'),point('Figure S1 reports the supplemental comparison.','s1')]}]},supplement={...whole,id:'supplement',pageIndex:9,label:'Figure S1'};
 const flow=rapidReadingArticleFlow(record,sources,[whole,supplement],{attachmentID:13});assert.deepEqual(flow.find(row=>row.point?.text.includes('局部方法')).assets,[]);assert.equal(flow.find(row=>row.point?.text.includes('A1')).assets[0].id,'whole');assert.equal(flow.find(row=>row.point?.text.includes('S1')).assets[0].id,'supplement');
});

test('a substantial source cannot be accepted as a few generic sentences, while a short source is not padded',()=>{
 const brief={sections:[{role:'method',points:[{text:'作者提出方法并进行了实验。'}]}]},depth=rapidReadingDepth([{text:'A detailed original methods and experiments passage. '.repeat(600)}]);assert.deepEqual(depth.targetChineseChars,[3000,5000]);assert.throws(()=>validateRapidReadingDepth(brief,depth),/过于简略/);
 const full={sections:[{role:'method',points:Array.from({length:12},()=>({text:'根据原文给出的输入条件，解释各模块的连接、控制变量和比较依据。'.repeat(6)}))}]};assert.strictEqual(validateRapidReadingDepth(full,depth),full);assert.strictEqual(validateRapidReadingDepth(brief,rapidReadingDepth([{text:'One short original paragraph.'}])),brief);assert.match(RAPID_READING_PROMPT,/为什么这样设计/);assert.match(RAPID_READING_PROMPT,/Failure cases/);assert.match(RAPID_READING_PROMPT,/防御性/);
});

test('detail validation counts evidence-bound natural paragraphs inside fewer JSON points',()=>{
 const depth=rapidReadingDepth([{text:'A detailed source passage about mechanisms and independent experimental comparisons. '.repeat(300)}]),paragraph='原文先定义输入条件，再说明数据经过各处理步骤的顺序、控制变量以及与基线的比较方式。'.repeat(4),record={sections:[{role:'method',points:[{text:Array(6).fill(paragraph).join('\n\n'),evidence:[{sourceID:'method',quote:'Actual methods evidence.'}]}]},{role:'results',points:[{text:Array(6).fill(paragraph).join('\r\n \r\n'),evidence:[{sourceID:'result',quote:'Actual comparative evidence.'}]}]}]};
 const before=structuredClone(record);assert.strictEqual(validateRapidReadingDepth(record,depth),record);assert.deepEqual(record,before,'a presentation-depth check does not alter text or supplied evidence');
});

test('sufficient continuous methods and experimental analysis is accepted while unsupported padding stays insufficient',()=>{
 const depth=rapidReadingDepth([{text:'A complete source about methods and experiments. '.repeat(500)}]),method='原文说明输入条件、处理顺序和各模块之间的连接，并据此安排与基线的比较。'.repeat(34),result='独立实验保持相同输入和控制条件，逐项比较处理步骤并记录观察到的失败情形。'.repeat(34),record={sections:[{role:'method',points:[{text:method,evidence:[{sourceID:'actual-method',quote:'Verified methods evidence.'}]}]},{role:'results',points:[{text:result,evidence:[{sourceID:'actual-result',quote:'Verified experimental evidence.'}]}]}]};
 assert.strictEqual(validateRapidReadingDepth(record,depth),record,'adequate bound mechanism and results prose does not fail because JSON has only two points');
 const noExperimentalEvidence=structuredClone(record);noExperimentalEvidence.sections[1].points[0].evidence=[];assert.throws(()=>validateRapidReadingDepth(noExperimentalEvidence,depth),/过于简略/);
 const generic={sections:[{role:'summary',points:[{text:'作者提出框架并进行了实验，方法具有一定优势。',evidence:[{sourceID:'real',quote:'A real source.'}]}]}]};assert.throws(()=>validateRapidReadingDepth(generic,depth),/过于简略/);
});

test('the generation context reuses saved Chinese evidence briefs and rejects a detailed article that only repeats the brief',()=>{
 const material={summary:'图中对比真实评测与仿真评测，保留相同的策略与测试任务。'},rows=rapidAssetCaptions([whole],{materialFor:()=>material});assert.equal(rows[0].summary,material.summary);assert.equal(rows[0].id,whole.id);assert.equal(rows[0].caption,whole.caption);
 const text='独立实验报告的结果。',record={sections:[{role:'results',brief:{text},points:[{text}]}]};assert.throws(()=>validateRapidReadingDepth(record,rapidReadingDepth([])),/概览重复/);
});

