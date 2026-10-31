/* SPDX-License-Identifier: AGPL-3.0-or-later */
// nb-selection:0: a paper choice saved by the earlier page can hold more folders
// than the current rule derives (a folder ticked only to look at it, or the
// other folder of a 精读 paper already in scope). An edit that keeps the ticked
// papers keeps those folders, so 精选 or 精读 never makes the plan stale; a
// changed tick, a mark outside the scope or a folder in the trash re-derives it.
// The real page and engine; only Zotero items and the model are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,FakeEvent,wait} from './notebook-page-harness.mjs';

const plan={title:'比较调制识别方法',novelty:'比较低信噪比下的两种方法',significance:'支持重复实验',feasibility:'拟在现有数据上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'信噪比可能影响识别准确率',falsification:'重复实验不支持该差异'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'现有数据'}],closest:[],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']};
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const papers=[
	{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]},
	{id:2,title:'Modulation recognition under noise',abstract:'Noise robust recognition.',folders:[17]},
	{id:3,title:'Radio survey',abstract:'Radio.',folders:[18]},
	{id:4,title:'Chapter structure notes',abstract:'Structure.',folders:[17,99]},
	{id:5,title:'Another topic',abstract:'Elsewhere.',folders:[99]}
];
// Papers 1 and 2 are ticked and only in folder 17; the saved choice also names
// folder 18 (or the given folders), as the earlier page saved it.
function world({collectionIDs=[17,18],reading,trashFolder=false}={}){
	let f=libraryWorld({folders:[{id:17,name:'项目文献'},{id:18,name:'通信',deleted:trashFolder},{id:99,name:'另一课题'}],papers,
		project:{title:'调制识别',paperCollectionID:17,createdPaperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs,paperIDs:[1,2],featuredPaperIDs:[]},researchScope:scope,...(reading?{readingSelection:{closeReadingPaperIDs:[],structurePaperID:null,structureOnly:true,...reading}}:{})},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较两种调制识别方法',constraints:'一周'},
		materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节：在低信噪比下比较两种识别方法。',sectionType:'方法',anchor:{paperItemID:1}}}});
	f.model=input=>({value:input.sourceSelection?structuredClone(plan):{suggestions:[]},model:'fixture'});
	return f;
}
const row=(page,paperID)=>page.doc.querySelector('.preparation-local-paper[data-paper-id="'+paperID+'"]');
const role=(page,paperID,text)=>row(page,paperID).querySelector('.preparation-paper-roles').children.find(node=>node.textContent===text);
const tick=(page,paperID,checked)=>{let check=row(page,paperID).querySelector('input');check.checked=checked;check.dispatchEvent(new FakeEvent('change'));};
const card=f=>f.N.planCardStatuses([f.id])[f.id];
const folderIDs=f=>f.project.preparationSourceSelection.collectionIDs.slice().sort((a,b)=>a-b);
const settle=async f=>{await wait(650);await f.quiet();};
async function evaluate(f,page){let before=f.notebook.versions.length;await page.$('evaluate').onclick();await f.quiet();assert.equal(f.notebook.versions.length,before+1,'生成可行性方案：'+page.$('status').textContent);}

test('精选 and 精读 on ticked papers keep the saved folders, so the plan stays current',async()=>{
	let f=world(),page=await f.openPage();
	try{
		await evaluate(f,page);assert.equal(card(f),'ready');
		await role(page,1,'精选').onclick();await settle(f);
		assert.deepEqual(f.project.preparationSourceSelection.featuredPaperIDs,[1],'the 精选 mark is saved');
		assert.deepEqual(folderIDs(f),[17,18],'the folder the earlier page saved stays');
		assert.equal(card(f),'ready','精选 is not a plan input');
		assert.equal((await f.N.assemblyEntryPlan(f.id)).action,'enter');
		await role(page,2,'精读').onclick();await settle(f);
		assert.deepEqual(f.project.readingSelection.closeReadingPaperIDs,[2]);
		assert.deepEqual(folderIDs(f),[17,18]);
		assert.equal(card(f),'ready','精读 on a paper already in scope is not a plan input');
		assert.doesNotMatch(page.$('status').textContent,/未保存/);
	}
	finally{await page.close();}
});

test('the other folder of a 精读 paper already in scope stays after 精选',async()=>{
	let f=world({collectionIDs:[17,99],reading:{closeReadingPaperIDs:[4]}}),page=await f.openPage();
	try{
		await evaluate(f,page);assert.equal(card(f),'ready');
		await role(page,1,'精选').onclick();await settle(f);
		assert.deepEqual(folderIDs(f),[17,99]);
		assert.equal(card(f),'ready');
	}
	finally{await page.close();}
});

test('a changed tick, or a 精读 paper the saved folders do not reach, derives the folders again',async()=>{
	let f=world(),page=await f.openPage();
	try{
		tick(page,2,false);await settle(f);
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[1]);
		assert.deepEqual(folderIDs(f),[17],'a folder that only filtered the list goes once the ticks change');
	}
	finally{await page.close();}
	let g=world(),other=await g.openPage();
	try{
		await role(other,5,'精读').onclick();await settle(g);
		assert.deepEqual(g.project.readingSelection.closeReadingPaperIDs,[5]);
		assert.deepEqual(folderIDs(g),[17,99],'the folder of a 精读 paper outside the scope is added');
	}
	finally{await other.close();}
});

test('a saved folder moved to the trash is left out and the choice still saves',async()=>{
	let f=world({trashFolder:true}),page=await f.openPage();
	try{
		await role(page,1,'精选').onclick();await settle(f);
		assert.doesNotMatch(page.$('status').textContent,/未保存|请为本项目选择文献文件夹/);
		assert.deepEqual(f.project.preparationSourceSelection.featuredPaperIDs,[1]);
		assert.deepEqual(folderIDs(f),[17]);
		await evaluate(f,page);assert.equal(card(f),'ready');
	}
	finally{await page.close();}
});
