// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createRuntime } from '../src/runtime.mjs';
import { validatePlan, validateDataset } from '../src/plan.mjs';
import { renderAndInspect } from '../src/render.mjs';
const evidence=[{id:'E1',text:'Example fixture only. Input is encoded, then classified.',label:'Test fixture',uri:'zotero://open-pdf/library/items/TESTKEY1?page=2'}];
const plan={version:1,title:'Research export test',slides:[
  {kind:'text',title:'Evidence linked summary',bullets:['Fixture content, not scientific results.'],sources:['E1']},
  {kind:'diagram',title:'Editable method diagram',nodes:[{id:'a',label:'Input'},{id:'b',label:'Encoder'},{id:'c',label:'Classifier'}],edges:[{from:'a',to:'b'},{from:'b',to:'c'}],sources:['E1']},
  {kind:'chart',title:'Synthetic fixture data',datasetID:'fixture',chartType:'bar',sources:['E1']}
]};
const datasets=[{id:'fixture',provenance:'Synthetic regression fixture; not experimental observations',labels:['A','B'],series:[{name:'Fixture',values:[2,3]}]}];
test('rejects fabricated evidence, numerical observations and broken relations',()=>{
  assert.throws(()=>validatePlan({...plan,slides:[{...plan.slides[0],sources:['fake']}]},evidence),/evidence/);
  assert.throws(()=>validatePlan({...plan,slides:[{...plan.slides[2],values:[90]}]},evidence),/forbidden/);
  assert.throws(()=>validatePlan({...plan,slides:[{...plan.slides[1],edges:[{from:'a',to:'unknown'}]}]},evidence),/edge/);
  assert.throws(()=>validateDataset({...datasets[0],series:[{name:'bad',values:[2]}]}),/observations/);
});
test('paper plans reject generic layouts and missing visual evidence',()=>{
  assert.throws(()=>validatePlan({...plan,version:2},evidence),/60%/);
  const s={kind:'asset',title:'Figure',assetIDs:['a'],layoutType:'original',sources:['E1'],slidePurpose:'Explain evidence',claim:'Author observation',assetReason:'Original figure',speakerFocus:'Axis',bullets:[]};
  assert.throws(()=>validatePlan({version:2,title:'x',slides:[s,s,s]},evidence),/连续三页/);
  assert.throws(()=>validatePlan({version:2,title:'x',slides:[{...s,layoutType:'zoom'}]},evidence),/两个/);
});
test('scatter and heatmap retain supplied values in editable objects',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'easysch-data-test-'));
  const runtime=await createRuntime({directory,evidence,datasets:[{...datasets[0],labels:['1','2']}]});
  try {
    const result=await runtime.call('export_research_deck',{plan:{version:1,title:'Synthetic data test',slides:['scatter','heatmap'].map(chartType=>({...plan.slides[2],chartType}))}});
    const zip=await JSZip.loadAsync(await fs.readFile(result.path));
    assert.match(await zip.file('ppt/charts/chart1.xml').async('string'),/scatterChart/);
    assert.match(await zip.file('ppt/slides/slide2.xml').async('string'),/<a:tbl>/);
    assert.ok(Object.keys(zip.files).some(p=>p.startsWith('ppt/embeddings/')&&p.endsWith('.xlsx')));
  } finally {await runtime.dispose();}
});
test('real DSH registry rejects unknown tools and emits editable PPTX, diagram and chart',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'easysch-engine-test-'));
  const runtime=await createRuntime({directory,evidence,datasets});
  try {
    assert.equal((await runtime.prompt()).tools.length,2);
    await assert.rejects(runtime.call('shell',{command:'ignored'}));
    await runtime.call('validate_research_plan',{plan});
    const result=await runtime.call('export_research_deck',{plan});
    const zip=await JSZip.loadAsync(await fs.readFile(result.path));
    const slide=await zip.file('ppt/slides/slide2.xml').async('string');
    assert.match(slide,/Input/); assert.match(slide,/Encoder/); assert.doesNotMatch(slide,/<p:pic>/);
    const chartFile=Object.keys(zip.files).find(p=>/^ppt\/charts\/chart\d+\.xml$/.test(p));
    assert.match(await zip.file(chartFile).async('string'),/<c:v>3<\/c:v>/);
    assert.ok(Object.keys(zip.files).some(p=>p.startsWith('ppt/embeddings/')&&p.endsWith('.xlsx')));
    assert.match(await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string'),/page=2/);
    assert.match(await fs.readFile(path.join(directory,'figure-2.drawio'),'utf8'),/edge="1"/);
    assert.equal(result.visualReview,'pending');
    if(process.env.EASYSCH_TEST_SOFFICE && process.env.EASYSCH_TEST_PDFTOPPM) {
      const rendered=await renderAndInspect(result,{soffice:process.env.EASYSCH_TEST_SOFFICE,pdftoppm:process.env.EASYSCH_TEST_PDFTOPPM});
      assert.equal(rendered.previews.length,3);
      assert.equal(rendered.renderReport.pages.length,3);
      assert.ok(rendered.renderReport.pages.every(p=>p.inkRatio>0.001));
    }
    console.log('Verified fixture:',result.path);
    if(process.env.EASYSCH_TEST_OUTPUT) await fs.cp(directory,process.env.EASYSCH_TEST_OUTPUT,{recursive:true});
  } finally {await runtime.dispose();}
});
