/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Opening or restoring the feasibility page reads the project and writes nothing:
// an inferred scope is shown until a task saves it, and a project without a
// paper folder gets one when the user saves a paper choice or starts a task.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,FakeEvent,until} from './notebook-page-harness.mjs';

const papers=[
	{id:1,title:'Automatic modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[18]},
	{id:2,title:'A study of zebra stripes',abstract:'Animal patterns.',folders:[17]},
	{id:3,title:'Bridges under wind load',abstract:'Civil structures.',folders:[17]}
];
const folders=[{id:17,name:'生物'},{id:18,name:'通信'}];
// A project like the ones the session restore opens: no paper folder, no saved scope.
const legacy=()=>libraryWorld({folders,papers,project:{title:'旧版准备项目'},notebook:{view:'plan',workflowStage:'feasibility',ideaDraft:'低信噪比下的调制识别',constraints:'一周'}});
const order=page=>page.doc.querySelector('.preparation-local-papers').children.map(row=>Number(row.dataset.paperId));

test('restoring a preparation page without a folder or a confirmed scope writes nothing, also when it closes',async()=>{
	let world=legacy(),before=world.snapshot();
	let page=await world.openPage();
	try{
		assert.equal(world.snapshot(),before,'the project and its notebook state are unchanged');
		assert.equal(world.counts.saves,0,'no project save, so revision and updatedAt stay');
		assert.deepEqual(world.created,[],'no Zotero folder is created behind the user');
		assert.equal(page.$('project-paper-folder').value,'','no folder is shown as chosen');
		assert.match(page.$('project-paper-summary').textContent,/尚未选择文献文件夹/);
		let shown=(await world.N.preparationLibrary(world.id)).researchScope;
		assert.ok(shown.primaryKeyword,'the inferred scope has a keyword to show');
		assert.equal(page.$('primary-keyword').value,shown.primaryKeyword,'the inferred scope is shown as a suggestion');
		assert.deepEqual(order(page),[1,2,3],'the suggestion ranks the local list');
		assert.deepEqual(page.failures,[]);assert.deepEqual(world.logged,[]);
		// nb-selection:4: closing the untouched page saves no draft either.
		await page.close();
		assert.equal(world.snapshot(),before,'closing the untouched page leaves the project and notebook as they were');
		assert.equal(world.counts.saves,0,'closing saves no project');
	}
	finally{await page.close();}
});

test('closing an untouched page with a manual scope writes nothing',async()=>{
	let scope={domain:'communications',primaryKeyword:'调制识别'},world=libraryWorld({folders,papers,project:{title:'旧版准备项目'},notebook:{view:'plan',workflowStage:'feasibility',ideaDraft:'低信噪比下的调制识别',constraints:'一周',scopeOrigin:'manual',researchScope:scope}}),before=world.snapshot();
	let page=await world.openPage();
	await page.close();
	assert.equal(world.snapshot(),before);
	assert.equal(world.counts.saves,0);
});

test('a field edited, saved and typed back to its loaded text before closing is stored as typed',async()=>{
	let world=legacy(),page=await world.openPage();
	try{
		let idea=page.$('idea');
		idea.value='比较两种调制识别方法';idea.dispatchEvent(new FakeEvent('input'));
		await until(()=>world.notebook.ideaDraft==='比较两种调制识别方法','草稿已保存');await world.quiet();
		idea.value='低信噪比下的调制识别';idea.dispatchEvent(new FakeEvent('input'));
	}
	finally{await page.close();}
	assert.equal(world.notebook.ideaDraft,'低信噪比下的调制识别','closing saves the text typed back');
	assert.equal(world.project.researchGoal,'低信噪比下的调制识别');
});

test('a value the page puts into a field without an input event is saved when the page closes',async()=>{
	let world=legacy(),page=await world.openPage();
	try{page.$('idea').value='页面填入的研究问题';}
	finally{await page.close();}
	assert.equal(world.notebook.ideaDraft,'页面填入的研究问题');
});

test('the first paper choice on a project without a folder creates its folder and is saved',async()=>{
	let world=legacy(),page=await world.openPage();
	try{
		assert.deepEqual(world.created,[]);
		let check=page.doc.querySelector('.preparation-local-paper[data-paper-id="2"] input[type=checkbox]');
		check.checked=true;check.dispatchEvent(new FakeEvent('change'));
		await until(()=>world.project.preparationSourceSelection,'论文选择已保存');await world.quiet();
		assert.deepEqual(world.created,['旧版准备项目 · 文献'],'one project folder, made by the user\'s choice');
		assert.equal(world.project.paperCollectionID,world.project.createdPaperCollectionID);
		assert.deepEqual(world.project.preparationSourceSelection.paperIDs.slice().sort(),[1,2]);
		assert.doesNotMatch(page.$('status').textContent,/未保存/);
		assert.equal(Number(page.$('project-paper-folder').value),world.project.paperCollectionID,'the folder picker shows the new folder');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

test('starting a task saves the scope that was shown and the choice it uses',async()=>{
	let world=legacy(),page=await world.openPage();
	try{
		let shown=page.$('primary-keyword').value,search=page.doc.querySelector('.preparation-online-tools button');
		assert.equal(search.textContent,'检索可下载论文');
		await search.onclick();await world.quiet();
		assert.equal(page.$('status').textContent,'已保存到本机');
		assert.equal(world.notebook.researchScope.primaryKeyword,shown);
		assert.equal(world.project.researchScope.primaryKeyword,shown);
		assert.ok(world.project.paperCollectionID,'the task gave the project its folder');
		assert.deepEqual(world.project.preparationSourceSelection.paperIDs,[1]);
	}
	finally{await page.close();}
});

test('editing the scope reranks the local list without reading the library again',async()=>{
	let world=libraryWorld({folders,papers,project:{title:'调制识别',paperCollectionID:18,materialPaperIDs:[1],researchScope:{domain:'communications',primaryKeyword:'modulation recognition'}},notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:{domain:'communications',primaryKeyword:'modulation recognition'}}});
	let read=world.N.preparationLibrary,reads=0;world.N.preparationLibrary=(...args)=>{reads++;return read(...args);};
	let page=await world.openPage();
	try{
		assert.deepEqual(order(page),[1,2,3]);
		let field=page.$('primary-keyword');field.value='zebra';field.dispatchEvent(new FakeEvent('change'));await world.quiet();
		assert.equal(world.notebook.researchScope.primaryKeyword,'zebra');
		assert.deepEqual(order(page),[2,1,3],'the list follows the edited scope');
		assert.equal(reads,1,'reranking reuses the loaded library');
	}
	finally{await page.close();}
});

test('saving an unchanged preparation does not save the project again',async()=>{
	let world=legacy(),draft={idea:'低信噪比下的调制识别',constraints:'一周',researchScope:{domain:'communications',primaryKeyword:'调制识别'}};
	await world.N.savePreparation(world.id,draft);let saves=world.counts.saves,before=world.snapshot();
	await world.N.savePreparation(world.id,draft);
	assert.equal(world.counts.saves,saves,'no second save');assert.equal(world.snapshot(),before,'revision and updatedAt stay');
	await world.N.savePreparation(world.id,{...draft,constraints:'两周'});
	assert.equal(world.counts.saves,saves+1);assert.equal(world.project.researchPreparation.resourceConstraints,'两周');
});
