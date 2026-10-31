/* SPDX-License-Identifier: AGPL-3.0-or-later */
// nb-selection:3: a 精读 paper moved to the trash or to another folder while the
// feasibility page is open never leaves the paper choice half saved. The engine
// drops a mark on a paper Zotero has deleted or trashed before it writes; a save
// that still fails reads the library again and is retried once.
// The real page and engine; only Zotero items and the model are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,FakeEvent,until,wait} from './notebook-page-harness.mjs';

const folders=[{id:17,name:'项目文献'},{id:18,name:'通信'},{id:77,name:'新文件夹'},{id:99,name:'另一课题'}];
const papers=[
	{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]},
	{id:3,title:'Radio survey',abstract:'Radio modulation.',folders:[18]},
	{id:4,title:'Chapter structure notes',abstract:'Structure.',folders:[99]}
];
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
// Paper 4 is only in folder 99 and marked 精读; paper 1 is ticked unless given.
const world=({paperIDs=[1],collectionIDs=[17,99],materials}={})=>libraryWorld({folders,papers,materials,
	project:{title:'调制识别',paperCollectionID:17,createdPaperCollectionID:17,materialPaperIDs:paperIDs,paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs,paperIDs,featuredPaperIDs:[]},readingSelection:{closeReadingPaperIDs:[4],structurePaperID:null,structureOnly:true},researchScope:scope},
	notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope}});
const row=(page,paperID)=>page.doc.querySelector('.preparation-local-paper[data-paper-id="'+paperID+'"]');
const role=(page,paperID,text)=>row(page,paperID).querySelector('.preparation-paper-roles').children.find(node=>node.textContent===text);
const tick=(page,paperID)=>{let check=row(page,paperID).querySelector('input');check.checked=true;check.dispatchEvent(new FakeEvent('change'));};
const reading=f=>({close:f.project.readingSelection.closeReadingPaperIDs,structure:f.project.readingSelection.structurePaperID});
const settle=async f=>{await wait(650);await f.quiet();};
const trash=f=>{f.items.get(4).deleted=true;};
const move=f=>{f.items.get(4).folders=[77];};

for(let closing of [false,true])test('a 精读 paper trashed while the page is open never leaves the choice half saved'+(closing?' (page closed at once)':''),async()=>{
	let f=world(),page=await f.openPage(),reopened;
	try{
		trash(f);
		tick(page,3);await role(page,3,'结构参考').onclick();
		if(closing)await page.close();else await settle(f);
		if(!closing)assert.doesNotMatch(page.$('status').textContent,/未保存/);
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs.slice().sort(),[1,3]);
		assert.deepEqual(reading(f),{close:[],structure:3},'the trashed paper\'s mark is dropped and the new one is saved with the ticks');
		reopened=await f.openPage();
		assert.equal(row(reopened,3).querySelector('input').checked,true);
		assert.equal(role(reopened,3,'结构参考').getAttribute('aria-pressed'),'true','the reopened page shows the new 结构参考');
	}
	finally{await page.close();await reopened?.close();}
});

test('a 精读 paper moved to another folder while the page is open keeps its mark and brings its new folder',async()=>{
	let f=world(),page=await f.openPage();
	try{
		move(f);
		tick(page,3);await settle(f);
		assert.doesNotMatch(page.$('status').textContent,/未保存/);
		assert.deepEqual(reading(f),{close:[4],structure:null},'the mark on a paper still in the library stays');
		assert.ok(f.project.preparationSourceSelection.collectionIDs.includes(77),'the paper\'s new folder is in the saved scope');
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs.slice().sort(),[1,3]);
	}
	finally{await page.close();}
});

test('a ticked paper trashed while the page is open leaves the choice at the next edit',async()=>{
	let f=world({paperIDs:[1,3],collectionIDs:[17,18,99]}),page=await f.openPage();
	try{
		f.items.get(3).deleted=true;
		await role(page,1,'精选').onclick();await settle(f);
		assert.doesNotMatch(page.$('status').textContent,/未保存/);
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[1]);
		assert.deepEqual(f.project.preparationSourceSelection.featuredPaperIDs,[1],'the edit is saved');
		assert.equal(row(page,3),null,'the trashed paper leaves the list');
	}
	finally{await page.close();}
});

test('the material choice saves after a 精读 paper went to the trash while the page was open',async()=>{
	let f=world({materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节原文。',sectionType:'方法'}}});f.model=()=>({value:{suggestions:[]},model:'fixture'});
	let page=await f.openPage();
	try{
		trash(f);
		let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
		await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
		let dialog=page.doc.querySelector('#preparation-tools-dialog');
		await dialog.querySelectorAll('button').find(node=>node.textContent==='保存准备素材').onclick();await f.quiet();
		assert.equal(dialog.querySelector('.preparation-feedback').textContent,'','the save is not rejected');
		assert.equal(page.doc.querySelector('#preparation-tools-dialog'),null,'the choice closes');
		await collecting;
		assert.deepEqual(f.notebook.preparationMaterialIDs,['whole']);
		assert.deepEqual(reading(f),{close:[],structure:null},'the trashed paper\'s mark is dropped with the saved choice');
	}
	finally{page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});

for(let [label,change] of [['trashed',trash],['moved',move]])test('a task started right after the change runs ('+label+')',async()=>{
	let f=world(),page=await f.openPage();
	try{
		change(f);tick(page,3);
		await page.doc.querySelector('.preparation-online-tools button').onclick();await f.quiet();
		assert.equal(page.$('status').textContent,'已保存到本机');
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs.slice().sort(),[1,3]);
		assert.deepEqual(reading(f).close,label==='trashed'?[]:[4]);
	}
	finally{await page.close();}
});
