/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-04: 继续装配 on a card whose plan is current but not yet applied takes
// the feasibility page's entry flow (with the 应用准备素材 choice) instead of
// confirming the plan and opening assembly without the prepared materials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture} from './notebook-gap-fixture.mjs';

async function unapplied({suggestions=true}={}){
	let f=await notebookFixture();
	f.assets.prepared={id:'prepared',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整方法章节原文。',sectionType:'方法'};
	await f.N.update('study',{versions:[{...f.version,status:'draft'}],...(suggestions?{materialSuggestions:[{materialID:'prepared',sectionID:'method',reason:'方法章节',sourceRevision:1}],preparationMaterialIDs:['prepared']}:{})});
	return f;
}

test('with prepared materials the card enters through the feasibility page and its material choice',async()=>{
	let f=await unapplied(),entered=0;
	f.N.open=async(id,options)=>{f.events.push(['plan',id,options]);return {NotebookUI:{ready:true,enterAssembly:async()=>{entered++;}}};};
	await f.N.openProject('study',{host:'library'});
	assert.equal(entered,1,'the page runs the same entry as 确认方案，进入素材装配');
	assert.equal(f.N.state('study').versions[0].status,'draft','the card does not confirm the plan on its own');
	assert.equal(f.project.researchPreparation?.planVersionID,undefined);
	assert.equal(f.N.state('study').view,'plan');
	assert.deepEqual(f.events,[['plan','study',{host:'library'}]],'assembly is not opened behind the choice');
});

test('without prepared materials the card still enters assembly directly',async()=>{
	let f=await unapplied({suggestions:false});
	await f.N.openProject('study');
	assert.deepEqual(f.events.map(row=>row[0]),['assembly']);
	assert.equal(f.N.state('study').versions[0].status,'confirmed');
});

test('if the feasibility page does not load, the card says what to do and changes nothing',async()=>{
	let f=await unapplied();
	f.N.open=async()=>({});
	await assert.rejects(()=>f.N.openProject('study'),/方案和素材选择已保留.*确认方案，进入素材装配/);
	assert.equal(f.N.state('study').versions[0].status,'draft');
	assert.equal(f.project.researchPreparation?.planVersionID,undefined);
});
