/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-10: paper ticks and 精选/精读/结构参考 marks are saved shortly after a
// change and on destroy. DC-07: 清空选择 clears only the filtered papers.
// WSB-17: the research scope ranks the visible local list; the folder filter
// only narrows that list and is never saved as the paper scope.
// The page runs on the real notebook engine, so every save passes its checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,FakeEvent,until,wait,clone} from './notebook-page-harness.mjs';

const folders=[{id:17,name:'生物'},{id:18,name:'通信'},{id:19,name:'调制识别 · 文献'},{id:99,name:'另一课题'}];
const papers=[
	{id:1,title:'A study of zebra stripes',abstract:'Animal patterns.',folders:[17]},
	{id:2,title:'B survey of bridges',abstract:'Civil structures.',folders:[17,99]},
	{id:3,title:'C automatic modulation recognition',abstract:'Modulation recognition under low SNR.',folders:[18]},
	{id:4,title:'D notes on chapter structure',abstract:'How chapters build an argument.',folders:[99]}
];
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
// A project with its own empty folder (19) and, unless given, no saved choice.
function world({selection,reading,trashed=[],notebook={},materials,model}={}){
	let f=libraryWorld({folders,papers:papers.map(row=>({...row,deleted:trashed.includes(row.id)})),materials,
		project:{title:'调制识别',paperCollectionID:19,createdPaperCollectionID:19,materialPaperIDs:selection?.paperIDs||[],paperSelectionExplicit:!!selection,researchScope:scope,...(selection?{preparationSourceSelection:{featuredPaperIDs:[],...selection}}:{}),...(reading?{readingSelection:{closeReadingPaperIDs:[],structurePaperID:null,structureOnly:true,...reading}}:{})},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,...notebook}});
	f.model=model||null;f.saves=[];let save=f.N.savePreparationChoice;f.N.savePreparationChoice=(id,choice)=>{f.saves.push(clone(choice));return save(id,choice);};
	return f;
}
const order=page=>page.doc.querySelector('.preparation-local-papers').children.map(row=>Number(row.dataset.paperId));
const row=(page,paperID)=>page.doc.querySelector('.preparation-local-paper[data-paper-id="'+paperID+'"]');
const tick=(page,paperID,checked)=>{let check=row(page,paperID).querySelector('input');check.checked=checked;check.dispatchEvent(new FakeEvent('change'));};
const role=(page,paperID,text)=>row(page,paperID).querySelector('.preparation-paper-roles').children.find(node=>node.textContent===text);
const folderCheck=(page,name)=>page.doc.querySelectorAll('.preparation-folder-picker label').find(node=>node.textContent.startsWith(name+' ·')).querySelector('input');
const tool=(page,text)=>page.doc.querySelector('.preparation-local-tools').children.find(node=>node.textContent===text);
const filterLabel=page=>page.doc.querySelector('.preparation-folder-picker summary').textContent;
const saved=selection=>({closeReadingPaperIDs:[],structurePaperID:null,structureOnly:true,...selection});

test('with an empty search the research scope puts matching papers first and keeps every paper listed',async()=>{
	let f=world({selection:{collectionIDs:[17,18,99],paperIDs:[1,2,3]}}),page=await f.openPage();
	try{
		assert.deepEqual(order(page),[3,1,2,4]);
		assert.equal(filterLabel(page),'筛选文件夹','the saved folder scope is not a folder filter');
	}
	finally{await page.close();}
});

test('an automatic paper choice is not a folder filter, and looking at a folder saves nothing',async()=>{
	let f=world(),page=await f.openPage();
	try{
		assert.deepEqual(order(page),[3,1,2,4],'the automatic choice (paper 3) hides no paper');
		assert.equal(row(page,3).querySelector('input').checked,true);
		let biology=folderCheck(page,'生物');biology.checked=true;biology.dispatchEvent(new FakeEvent('change'));
		assert.deepEqual(order(page),[1,2]);assert.equal(filterLabel(page),'1 个文件夹');
		await wait(650);await f.quiet();
		assert.deepEqual(f.saves,[],'a folder filter is a view, not a saved choice');assert.equal(f.project.preparationSourceSelection,undefined);
		await tool(page,'全部文件夹').onclick();
		assert.deepEqual(order(page),[3,1,2,4]);
		await wait(650);assert.deepEqual(f.saves,[]);
	}
	finally{await page.close();}
});

test('a paper downloaded into the project folder joins the list and the count',async()=>{
	let f=world();f.E.searchPaperPage=async()=>({records:[{id:'r6',itemID:6,title:'F modulation recognition benchmark',pdf:'https://example.test/f.pdf'}],provider:'fixture'});
	let page=await f.openPage();
	try{
		await page.doc.querySelector('[data-action=recommended-papers]').onclick();
		await page.doc.querySelector('.preparation-online-tools button').onclick();
		assert.deepEqual(f.project.preparationSourceSelection.collectionIDs,[18],'the task saved the automatic choice');
		await page.doc.querySelector('.preparation-online-papers button').onclick();await f.quiet();
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[3,6]);
		assert.ok(order(page).includes(6),'the downloaded paper is listed');
		assert.equal(page.doc.querySelector('.plan-evidence-heading small').textContent,'2 篇已选');
	}
	finally{await page.close();}
});

test('清空选择 clears only the papers in the current filter',async()=>{
	let f=world({selection:{collectionIDs:[17,18,99],paperIDs:[1,2,3]}}),page=await f.openPage();
	try{
		let check=folderCheck(page,'通信');check.checked=true;check.dispatchEvent(new FakeEvent('change'));
		assert.deepEqual(order(page),[3],'the folder filter shows one paper');
		await tool(page,'清空选择').onclick();
		assert.match(page.$('status').textContent,/仍保留/);
		await wait(650);await f.quiet();
		assert.deepEqual(f.saves.at(-1).paperIDs.sort(),[1,2],'picks under the other folder stay selected');
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs.slice().sort(),[1,2]);
	}
	finally{await page.close();}
});

test('ticks and 精读 marks are saved shortly after the change without starting a task',async()=>{
	let f=world({selection:{collectionIDs:[17,18,99],paperIDs:[1,2,3]}}),page=await f.openPage();
	try{
		tick(page,2,false);await role(page,3,'精读').onclick();
		assert.equal(f.saves.length,0,'the save waits for a pause');
		await wait(650);await f.quiet();
		assert.equal(f.saves.length,1,'one save for the burst');
		assert.deepEqual(f.saves[0].paperIDs.sort(),[1,3]);assert.deepEqual(f.saves[0].closeReadingPaperIDs,[3]);
		assert.deepEqual(f.project.readingSelection,saved({closeReadingPaperIDs:[3]}),'the engine accepted the choice');
	}
	finally{await page.close();}
});

test('closing the page saves a choice made just before',async()=>{
	let f=world({selection:{collectionIDs:[17,18,99],paperIDs:[1,2,3]}}),page=await f.openPage();
	tick(page,1,false);await page.close();
	assert.equal(f.saves.length,1,'pagehide/destroy writes the pending choice');
	assert.deepEqual(f.saves[0].paperIDs.sort(),[2,3]);
	await wait(650);
	assert.equal(f.saves.length,1,'the debounced save does not repeat it');
	assert.deepEqual(f.project.preparationSourceSelection.paperIDs.slice().sort(),[2,3]);
});

test('closing the page while an earlier save runs hands over the newest choice at once',async()=>{
	let f=world({selection:{collectionIDs:[17,18,99],paperIDs:[1,2,3]}}),page=await f.openPage(),getAsync=f.Zotero.Collections.getAsync,release,closing;
	// The first write waits in its folder scan, as a slow library does.
	f.Zotero.Collections.getAsync=id=>{f.Zotero.Collections.getAsync=getAsync;return new Promise(resolve=>{release=()=>resolve(getAsync(id));});};
	try{
		tick(page,1,false);await wait(650);
		assert.equal(f.saves.length,1);assert.ok(release,'the first write is still running');
		tick(page,2,false);closing=page.close();
		assert.equal(f.saves.length,2,'pagehide hands the newest choice to the engine before the page is gone');
		assert.deepEqual(f.saves[1].paperIDs,[3]);
	}
	finally{release?.();await (closing||page.close());await f.quiet();}
	assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[3],'the newest choice is stored last');
});

test('two overlapping saves of the paper choice are stored in the order they were made',async()=>{
	let f=world(),getAsync=f.Zotero.Collections.getAsync,release;
	f.Zotero.Collections.getAsync=id=>{f.Zotero.Collections.getAsync=getAsync;return new Promise(resolve=>{release=()=>resolve(getAsync(id));});};
	let first=f.N.savePreparationChoice(f.id,{collectionIDs:[17],paperIDs:[1,2]}),second=f.N.savePreparationChoice(f.id,{collectionIDs:[18],paperIDs:[3]});
	await wait(20);release();await Promise.all([first,second]);
	assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[3],'the later choice wins');
	assert.deepEqual(f.project.preparationSourceSelection.collectionIDs,[18]);
});
test('a 精读 or 结构参考 paper moved to the trash no longer blocks saving the choice',async()=>{
	for(let reading of [{closeReadingPaperIDs:[3]},{structurePaperID:3}]){
		let f=world({selection:{collectionIDs:[17,18],paperIDs:[1]},reading,trashed:[3]}),page=await f.openPage();
		try{
			await page.doc.querySelector('.preparation-online-tools button').onclick();await f.quiet();
			assert.equal(page.$('status').textContent,'已保存到本机',JSON.stringify(reading));
			assert.deepEqual(f.project.readingSelection,saved({}),'the trashed paper\'s mark is dropped');
			assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[1]);
		}
		finally{await page.close();}
	}
});

test('a stored suggestion naming a trashed paper is not prefilled into the material choice',async()=>{
	let f=world({selection:{collectionIDs:[17],paperIDs:[1]},trashed:[3],notebook:{readingRecommendation:{closeReadingPaperIDs:[3],structurePaperID:3,reason:'旧建议'}},
		materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节原文。',sectionType:'方法'}},model:()=>({value:{suggestions:[]},model:'fixture'})}),page=await f.openPage();
	try{
		let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
		await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
		let dialog=page.doc.querySelector('#preparation-tools-dialog');
		assert.equal(dialog.querySelector('select[aria-label="结构参考论文，仅学习结构"]').value,'','no structure reference is prefilled');
		dialog.querySelectorAll('button').find(node=>node.textContent==='保存准备素材').click();
		await until(()=>!page.doc.querySelector('#preparation-tools-dialog')||dialog.querySelector('.preparation-feedback').textContent,'保存结果');
		assert.equal(dialog.querySelector('.preparation-feedback').textContent,'','the save is not rejected');
		await collecting;
		assert.deepEqual(f.project.readingSelection,saved({}));
	}
	finally{page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});

test('leaving the material choice keeps the reading marks, and accepting saves the suggested ones',async()=>{
	let f=world({selection:{collectionIDs:[17,99],paperIDs:[1,2]},materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:2,title:'方法章节',sourceText:'完整方法章节原文。',sectionType:'方法'}},
		model:()=>({value:{suggestions:[],readingSelection:{closeReadingPaperIDs:[4],structurePaperID:4,reason:'学习章节结构'}},model:'fixture'})}),page=await f.openPage();
	let open=async()=>{let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');return {collecting,dialog:page.doc.querySelector('#preparation-tools-dialog')};};
	try{
		let {collecting,dialog}=await open();
		assert.equal(dialog.querySelector('select[aria-label="结构参考论文，仅学习结构"]').value,'4','the suggestion is shown in the dialog');
		await dialog.querySelectorAll('button').find(node=>node.textContent==='返回').onclick();await collecting;
		tick(page,1,false);await wait(650);await f.quiet();
		assert.deepEqual(f.project.readingSelection,saved({}),'the left suggestion is not saved by an unrelated change');
		assert.equal(role(page,4,'精读').getAttribute('aria-pressed'),'false');
		({collecting,dialog}=await open());
		await dialog.querySelectorAll('button').find(node=>node.textContent==='保存准备素材').onclick();await collecting;
		assert.deepEqual(f.project.readingSelection,saved({closeReadingPaperIDs:[4],structurePaperID:4}),'accepting saves the suggested marks');
		assert.equal(role(page,4,'精读').getAttribute('aria-pressed'),'true');assert.equal(role(page,4,'结构参考').getAttribute('aria-pressed'),'true');
	}
	finally{page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});

test('only a ticked paper can be 精选, and unticking it clears the mark',async()=>{
	let f=world({selection:{collectionIDs:[17,99],paperIDs:[1,2]}}),page=await f.openPage();
	try{
		let unticked=role(page,4,'精选');
		assert.equal(unticked.disabled,true);assert.equal(unticked.title,'只有已勾选的论文可以设为精选');
		let featured=role(page,1,'精选');await featured.onclick();
		assert.equal(featured.getAttribute('aria-pressed'),'true');
		tick(page,1,false);
		assert.equal(featured.disabled,true);assert.equal(featured.getAttribute('aria-pressed'),'false','the mark goes with the tick');
		await wait(650);await f.quiet();
		assert.deepEqual(f.saves.at(-1).featuredPaperIDs,[]);assert.deepEqual(f.project.preparationSourceSelection.featuredPaperIDs,[]);
		tick(page,1,true);assert.equal(featured.disabled,false);await featured.onclick();
		await tool(page,'清空选择').onclick();
		assert.equal(role(page,1,'精选').getAttribute('aria-pressed'),'false','清空选择 clears 精选 too');
		await wait(650);await f.quiet();
		assert.deepEqual(f.saves.at(-1).featuredPaperIDs,[]);
	}
	finally{await page.close();}
});

test('a 结构参考 paper brings its folder into scope only when the scope does not reach it',async()=>{
	let f=world({selection:{collectionIDs:[17],paperIDs:[1]}}),page=await f.openPage();
	try{
		await role(page,2,'结构参考').onclick();await wait(650);await f.quiet();
		assert.deepEqual(f.project.preparationSourceSelection.collectionIDs,[17],'paper 2 is already reached through folder 17');
		assert.equal(f.project.readingSelection.structurePaperID,2);
		await role(page,4,'结构参考').onclick();await wait(650);await f.quiet();
		assert.deepEqual(f.project.preparationSourceSelection.collectionIDs.slice().sort(),[17,99],'paper 4 is only in folder 99');
		assert.equal(f.project.readingSelection.structurePaperID,4,'the engine accepts it');
	}
	finally{await page.close();}
});
