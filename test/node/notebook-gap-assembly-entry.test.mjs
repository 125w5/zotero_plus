/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-04: 继续装配 on a card whose plan is current but not yet applied takes
// the feasibility page's entry flow (with the 应用准备素材 choice) instead of
// confirming the plan and opening assembly without the prepared materials.
// assembly-entry:3/4: that flow is for a project without authored work. An
// applied plan that went stale, with a current plan beside it, opens planning
// on that plan; a project with authored text resumes its stage. The page's own
// entry, the card lock and the page polling are covered on the real page in
// notebook-assembly-entry-page.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture,clone} from './notebook-gap-fixture.mjs';
import {libraryWorld,until} from './notebook-page-harness.mjs';

async function unapplied({suggestions=true}={}){
	let f=await notebookFixture();
	f.assets.prepared={id:'prepared',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整方法章节原文。',sectionType:'方法'};
	await f.N.update('study',{versions:[{...f.version,status:'draft'}],...(suggestions?{materialSuggestions:[{materialID:'prepared',sectionID:'method',reason:'方法章节',sourceRevision:1}],preparationMaterialIDs:['prepared']}:{})});
	return f;
}

test('without prepared materials the card still enters assembly directly',async()=>{
	let f=await unapplied({suggestions:false});
	await f.N.openProject('study');
	assert.deepEqual(f.events.map(row=>row[0]),['assembly']);
	assert.equal(f.N.state('study').versions[0].status,'confirmed');
});

test('if the feasibility page never becomes ready, the card waits about 10 s, says what to do and changes nothing',async()=>{
	let f=await unapplied(),waited=0;
	f.Zotero.Promise={delay:async ms=>{waited+=ms;}};
	f.N.open=async()=>({});
	await assert.rejects(()=>f.N.openProject('study'),/方案和素材选择已保留.*确认方案，进入素材装配/);
	assert.ok(waited>=5000&&waited<=15000,'the card polls the page for about 10 s, not once: '+waited+' ms');
	assert.equal(f.N.state('study').versions[0].status,'draft');
	assert.equal(f.project.researchPreparation?.planVersionID,undefined);
	assert.deepEqual(f.events,[]);
});

// assembly-entry:3: the applied v1 went stale, v2 is current and nothing is
// written yet. The card opens planning on v2; applying it stays the user's step.
test('an applied plan that went stale opens planning on the current plan instead of resuming the old one',async()=>{
	let f=await notebookFixture();f.A.summaryReader=()=>m=>m.summary||'';
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。',summary:'人工挑选的证据'};
	await f.N.enterAssembly('study');
	await f.N.saveDraft('study',{constraints:'两周；补充一组对照'});
	f.E.studio.request=async()=>({value:{...clone(f.version.plan),closest:[]},model:'controlled'});
	let current=await f.N.evaluate('study',f.project.researchGoal);
	f.events.length=0;let before=clone(f.project);
	await f.N.openProject('study');
	assert.deepEqual(f.events.map(row=>row.slice(0,2)),[['plan','study']],'the feasibility page opens; assembly is not resumed on the old plan');
	assert.equal(f.N.state('study').workflowStage,'feasibility');
	assert.equal(f.N.state('study').selectedVersion,current.id);
	assert.equal(f.N.state('study').versions.find(row=>row.id===current.id).status,'draft','the card does not confirm the new plan');
	assert.deepEqual(f.project,before,'the applied plan, the stage and the project stay as they were');
});

test('an applied plan that is still current is resumed even when a newer draft exists',async()=>{
	let f=await notebookFixture();
	await f.N.enterAssembly('study');
	let revision=await f.N.editPlanField('study',{versionID:'plan-v1',path:'title',value:'比较图像测量方法（修订）'});
	f.events.length=0;let before=clone(f.project);
	await f.N.openProject('study');
	assert.deepEqual(f.events,[['assembly','study']]);
	assert.equal(f.N.state('study').versions.find(row=>row.id===revision.id).status,'draft');
	assert.deepEqual(f.project,before,'the applied plan stays the basis and the stage stays');
});

// assembly-entry:4: whether to apply the plan to authored work is the user's
// choice on the feasibility page, never the card's.
test('a project with authored text resumes its stage and never applies the unapplied plan, with or without prepared materials',async()=>{
	for(let suggestions of [false,true]){
		let f=await unapplied({suggestions});
		f.project.blocks=[{id:'authored',sectionID:'intro',type:'paragraph',text:'作者已写的引言。',materials:[]}];f.project.ui.step=2;f.project.ui.left='structure';
		let before=clone(f.project);
		await f.N.openProject('study');
		assert.deepEqual(f.events,[['assembly','study']],'prepared materials: '+suggestions);
		assert.deepEqual(f.project,before,'the stage, structure and text stay, and no plan is bound');
		assert.equal(f.N.state('study').versions[0].status,'draft');
		assert.equal(f.N.state('study').artifacts.length,0,'no plan card is published');
	}
});

// The real card flow on the real page: the AI suggests paper 3, which is in the
// project folder and also in another folder, as 结构参考, and the user keeps it.
const plan={title:'比较调制识别方法',novelty:'比较低信噪比下的两种方法',significance:'支持重复实验',feasibility:'拟在现有数据上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'信噪比可能影响识别准确率',falsification:'重复实验不支持该差异'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'现有数据'}],closest:[],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']};
test('a 结构参考 suggested on the feasibility page keeps the plan current when the card enters assembly',async()=>{
	let f=libraryWorld({folders:[{id:17,name:'项目文献'},{id:99,name:'另一课题'}],
		papers:[{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]},{id:2,title:'Modulation recognition under noise',abstract:'Noise robust recognition.',folders:[17]},{id:3,title:'How to structure a recognition paper',abstract:'Chapter structure.',folders:[17,99]}],
		project:{title:'调制识别',sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'},{id:'method',title:'方法',writingPurpose:'交代可复现实验'}],paperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:[1,2],featuredPaperIDs:[]},researchScope:{domain:'communications',primaryKeyword:'modulation recognition'}},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:{domain:'communications',primaryKeyword:'modulation recognition'},ideaDraft:'比较两种调制识别方法',constraints:'一周'},
		materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节：在低信噪比下比较两种识别方法。',sectionType:'方法',anchor:{paperItemID:1}}}});
	f.model=input=>input.sourceSelection?{value:structuredClone(plan),model:'fixture'}:{value:{suggestions:[{materialID:'whole',sectionID:'method',reason:'方法章节'}],readingSelection:{closeReadingPaperIDs:[],structurePaperID:3,reason:'学习论证结构'}},model:'fixture'};
	let page=await f.openPage();
	let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
	await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
	let dialog=page.doc.querySelector('#preparation-tools-dialog');
	assert.equal(dialog.querySelector('select[aria-label="结构参考论文，仅学习结构"]').value,'3','the AI suggestion is prefilled');
	await dialog.querySelectorAll('button').find(node=>node.textContent==='保存准备素材').onclick();await collecting;
	await page.$('evaluate').onclick();await f.quiet();
	assert.equal(f.notebook.versions.length,1,page.$('status').textContent);
	assert.equal(f.project.readingSelection.structurePaperID,3);
	assert.deepEqual(f.project.preparationSourceSelection.collectionIDs,[17]);
	assert.equal(f.N.planCardStatuses([f.id])[f.id],'ready','the card shows a current plan');
	await page.close();
	// 继续装配 on the card opens a new page that runs its own entry flow.
	let opening=f.N.openProject(f.id);
	await until(()=>f.page?.doc.querySelector('#preparation-tools-dialog,#assembly-entry-dialog'),'装配入口',5000);
	let stale=f.page.doc.querySelector('#assembly-entry-dialog');
	if(stale){let text=stale.textContent;stale.close();await opening;await f.page?.close();assert.fail('the card asked to update a current plan: '+text);}
	let handoff=f.page.doc.querySelector('#preparation-tools-dialog');
	assert.equal(handoff.querySelector('h2').textContent,'将准备素材用于装配');
	assert.deepEqual(f.project.preparationSourceSelection.collectionIDs,[17],'opening the page did not widen the folder scope');
	assert.equal(f.N.planCardStatuses([f.id])[f.id],'ready');
	await handoff.querySelectorAll('button').find(node=>node.textContent==='应用所选并进入装配').onclick();await opening;
	// The card call returns once the page runs its entry; the entry ends after the choice.
	await until(()=>f.events.at(-1)?.[0]==='assembly','进入装配');
	assert.deepEqual(f.events.at(-1),['assembly',f.id]);
	assert.equal(f.notebook.workflowStage,'assembly');
	assert.equal(f.project.researchPreparation.planVersionID,f.notebook.versions[0].id);
	assert.ok(f.project.blocks.some(block=>block.materials.some(link=>link.id==='whole')),'the chosen material is applied');
	await f.page?.close();
});
