/* SPDX-License-Identifier: AGPL-3.0-or-later */
// nb-selection:1: 保存准备素材 and 应用所选并进入装配 save the confirmed 精读 and
// 结构参考 marks through the page's queued paper-choice save, so an autosave
// still running with the earlier marks cannot overwrite them afterwards; a
// failed save keeps the page's own marks, so a later edit cannot save the
// unconfirmed suggestion. The real page and engine; Zotero and the model are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,FakeEvent,until,wait} from './notebook-page-harness.mjs';

const folders=[{id:17,name:'生物'},{id:18,name:'通信'},{id:19,name:'调制识别 · 文献'},{id:99,name:'另一课题'}];
const papers=[
	{id:1,title:'A study of zebra stripes',abstract:'Animal patterns.',folders:[17]},
	{id:2,title:'B survey of bridges',abstract:'Civil structures.',folders:[17,99]},
	{id:3,title:'C automatic modulation recognition',abstract:'Modulation recognition under low SNR.',folders:[18]},
	{id:4,title:'D notes on chapter structure',abstract:'How chapters build an argument.',folders:[99]}
];
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const suggestion={value:{suggestions:[],readingSelection:{closeReadingPaperIDs:[4],structurePaperID:4,reason:'学习章节结构'}},model:'fixture'};
const world=()=>libraryWorld({folders,papers,
	project:{title:'调制识别',paperCollectionID:19,createdPaperCollectionID:19,materialPaperIDs:[1,2],paperSelectionExplicit:true,researchScope:scope,preparationSourceSelection:{collectionIDs:[17,99],paperIDs:[1,2],featuredPaperIDs:[]}},
	notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope},
	materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:2,title:'方法章节',sourceText:'完整方法章节原文。',sectionType:'方法'}}});
const marks=f=>{let saved=f.project.readingSelection;return saved?{close:saved.closeReadingPaperIDs,structure:saved.structurePaperID}:null;};
const pressed=(page,paperID,text)=>page.doc.querySelector('.preparation-local-paper[data-paper-id="'+paperID+'"] .preparation-paper-roles').children.find(node=>node.textContent===text).getAttribute('aria-pressed');
const dialogButton=(dialog,text)=>dialog.querySelectorAll('button').find(node=>node.textContent===text);

for(let edit of [false,true])test('accepting the material choice while an autosave runs stores the confirmed marks'+(edit?' (structure changed to paper 2)':' (the suggestion kept)'),async()=>{
	let f=world(),gate=null,held=null,page2;
	f.model=async()=>{await new Promise(resolve=>{gate=resolve;});return structuredClone(suggestion);};
	let page=await f.openPage(),original=f.N.setPreparationSources;
	try{
		let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
		await until(()=>gate,'用途建议请求');
		// The autosave of an untick waits in its first step until the choice is accepted.
		f.N.setPreparationSources=(id,choice)=>{f.N.setPreparationSources=original;return new Promise((resolve,reject)=>{held=()=>original(id,choice).then(resolve,reject);});};
		let check=page.doc.querySelector('.preparation-local-paper[data-paper-id="1"] input');check.checked=false;check.dispatchEvent(new FakeEvent('change'));
		await until(()=>held,'自动保存开始');
		gate();
		await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
		let dialog=page.doc.querySelector('#preparation-tools-dialog'),select=dialog.querySelector('select[aria-label="结构参考论文，仅学习结构"]');
		assert.equal(select.value,'4','the suggestion is prefilled');
		if(edit){select.value='2';select.onchange();}
		let accepting=dialogButton(dialog,'保存准备素材').onclick();
		assert.equal(await Promise.race([Promise.resolve(accepting).then(()=>'saved'),wait(200).then(()=>'waiting')]),'waiting','the accept waits for the earlier save');
		held();await accepting;await collecting;await f.quiet();await wait(650);await f.quiet();
		let confirmed={close:[4],structure:edit?2:4};
		assert.deepEqual(marks(f),confirmed,'the confirmed marks are stored last');
		assert.deepEqual(f.project.preparationSourceSelection.paperIDs,[2],'the untick is saved too');
		assert.equal(pressed(page,4,'精读'),'true');assert.equal(pressed(page,edit?2:4,'结构参考'),'true');
		await page.close();await f.quiet();
		assert.deepEqual(marks(f),confirmed,'closing the page keeps them');
		page2=await f.openPage();
		assert.equal(pressed(page2,4,'精读'),'true');assert.equal(pressed(page2,edit?2:4,'结构参考'),'true','the reopened page shows them');
	}
	finally{f.N.setPreparationSources=original;held?.();page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();await page2?.close();}
});

test('a failed accept keeps the page\'s marks, so a later edit does not save the suggestion',async()=>{
	let f=world();f.model=async()=>structuredClone(suggestion);
	let page=await f.openPage(),original=f.N.saveReadingSelection;
	try{
		let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
		await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
		let dialog=page.doc.querySelector('#preparation-tools-dialog');
		f.N.saveReadingSelection=async()=>{throw Error('数据库忙，请稍后重试');};
		try{await dialogButton(dialog,'保存准备素材').onclick();}
		finally{f.N.saveReadingSelection=original;}
		assert.match(dialog.querySelector('.preparation-feedback').textContent,/数据库忙/);
		assert.equal(pressed(page,4,'精读'),'false','the unconfirmed suggestion is not shown as the page\'s mark');
		await dialogButton(dialog,'返回').onclick();await collecting;await f.quiet();
		let close=page.doc.querySelector('.preparation-local-paper[data-paper-id="2"] .preparation-paper-roles').children.find(node=>node.textContent==='精读');
		await close.onclick();await close.onclick();await wait(650);await f.quiet();
		assert.deepEqual(marks(f),{close:[],structure:null},'the later edit saves the page\'s own marks');
	}
	finally{f.N.saveReadingSelection=original;page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});
