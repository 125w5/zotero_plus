/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 保存标注 on a full-text hit. The rows findPaperPassages returns carry no
// revision; saving a highlight on one copies it into the project's materials
// (saveProjectMaterialHighlights), and every project save checks each material
// for an anchor, source text and an integer revision (M.assertProject). The
// copy starts at revision 1, as a new material does (M.material), so the
// project keeps saving; highlights count in annotationRevision. Real assembly
// code and services, with one indexed PDF: assembly-details-harness.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './assembly-details-harness.mjs';

const text='The measurement setup uses two calibrated cameras and a fixed target board.';
const index={manuscriptIndex:{9:{status:'complete',documentKey:'doc-9',pdfHash:'doc-9'}},manuscriptDocuments:{'doc-9':{pdfHash:'doc-9',paragraphs:[{section:'2.1 Methods',pageIndex:2,sourceText:text,position:{pageIndex:2,rects:[[72,600,520,640]]}}]}}};
const outcome=promise=>promise.then(()=>'saved',error=>error.message);

test('a highlight saved on a full-text hit copies it with a version, and the project keeps saving',async()=>{
	const f=await fixture({store:index}),hit=f.E.findPaperPassages('calibrated cameras')[0];
	assert.equal(hit?.m.id,'passage-9-0','the indexed paragraph is a full-text hit');assert.equal(hit.m.revision,undefined,'full-text rows carry no revision');
	// A click on the hit in the material library (material-library.mjs) opens its details.
	f.sandbox.showMaterial(hit.m);assert.equal(f.box.dataset.materialId,hit.m.id);
	const saved=outcome(f.overviews.at(-1).options.onSaveHighlights([{id:'h1',text:'two calibrated cameras',comment:''}]));
	await f.flush();
	assert.equal(await saved,'saved','the highlight is saved');
	const copy=f.state('manuscripts','p').materials.find(row=>row.id===hit.m.id);
	assert.ok(copy,'the copy is saved with the project');
	assert.equal(copy.revision,1,'the copy starts at the first version');
	assert.deepEqual(copy.projectHighlights.map(row=>row.text),['two calibrated cameras']);
	assert.equal(copy.sourceText,text);assert.equal(copy.anchor.attachmentID,9);
	assert.deepEqual(f.notice(),{text:'已保存本项目素材批注',error:false});
	// Later edits keep saving, and a second highlight keeps the version.
	f.U.p.title='研究 · 修订';f.sandbox.persist();await f.flush();
	assert.equal(f.state('manuscripts','p').title,'研究 · 修订','the project keeps saving');
	const again=outcome(f.overviews.at(-1).options.onSaveHighlights([...copy.projectHighlights,{id:'h2',text:'fixed target board',comment:''}]));
	await f.flush();
	assert.equal(await again,'saved');
	const next=f.state('manuscripts','p').materials.find(row=>row.id===hit.m.id);
	assert.equal(next.revision,1,'a highlight does not change the material version');assert.equal(next.annotationRevision,2);
	assert.equal(f.writes,0,'nothing is written to the shared material library');
	assert.deepEqual(f.failures,[]);
});
