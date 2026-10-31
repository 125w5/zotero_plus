/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Corpus review CR-2 in the notebook (xpcom/research/notebook.js): 整理项目素材
// keeps the annotations of a selected PDF that has no parent item, whose rows
// carry the PDF's attachment id and no paper id. Annotations of PDFs that are
// not selected and PPT draft records stay out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture,clone} from './notebook-gap-fixture.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

const annotation=(attachmentID,paperItemID,text)=>Model.material({kind:'annotation',sourceItemID:attachmentID*10,title:'批注 · 第 1 页',sourceText:text,anchor:{paperItemID,citationItemID:paperItemID,attachmentID,pageIndex:0,position:{pageIndex:0},sourceText:text,annotationKey:'KEY'+attachmentID}});

test('CR-2: collecting project materials keeps the annotations of a selected PDF without a parent item',async()=>{
	let f=await notebookFixture(),queued=[],asked=null;
	let pdf={id:30,deleted:false,getField:key=>key==='title'?'独立 PDF':'',isRegularItem:()=>false,isPDFAttachment:()=>true,getAttachments:()=>[]};
	f.papers.set(30,pdf);f.pdfs.set(30,pdf);
	f.N.preparationPaperSelection=async()=>({collectionID:17,libraryID:1,name:'项目文献',papers:[],selectedPaperIDs:[1,30]});
	f.A.queueArticle=async id=>{queued.push(id);};
	let own=annotation(30,null,'独立 PDF 上的原文批注。'),paper=annotation(11,1,'论文 PDF 上的原文批注。'),unselected=annotation(40,null,'未选中 PDF 上的批注。');
	let record=Model.material({kind:'experiment',sourceRecordID:'draft-x:c1',title:'实验记录 · 组会',sourceText:'PPT 草稿中的实验记录。',anchor:{sourceText:'PPT 草稿中的实验记录。'}});
	f.A.candidates=async ids=>{asked=clone(ids);return [own,paper,unselected,record];};
	let result=await f.N.collectProjectMaterials('study');
	assert.deepEqual(asked,[1,30]);
	assert.deepEqual(queued,[30],'the standalone PDF is indexed like a paper PDF');
	let ids=result.materials.map(row=>row.id);
	assert.ok(ids.includes(own.id),'the standalone PDF annotation is a project material');
	assert.ok(ids.includes(paper.id),'paper annotations are still kept');
	assert.ok(!ids.includes(unselected.id),'a PDF that is not selected stays out');
	assert.ok(!ids.includes(record.id),'PPT draft records stay out');
	assert.deepEqual(Object.keys(f.assets).sort(),[own.id,paper.id].sort(),'only the selected annotations are published');
	assert.ok(result.suggestions.some(row=>row.materialID===own.id));
});
