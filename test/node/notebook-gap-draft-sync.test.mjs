/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-11: editing the research question, conditions, structure or scope reaches
// project.researchGoal and researchPreparation without starting a task.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {notebookFixture} from './notebook-gap-fixture.mjs';

test('a draft save updates the research goal shown on the home card',async()=>{
	let f=await notebookFixture();
	await f.N.saveDraft('study',{ideaDraft:'比较三种图像测量方法的误差'});
	assert.equal(f.project.researchGoal,'比较三种图像测量方法的误差');
	assert.equal(f.project.memory.goal,'比较三种图像测量方法的误差');
	assert.equal(f.project.researchPreparation.researchGoal,'比较三种图像测量方法的误差');
	await f.N.saveDraft('study',{constraints:'两周；无 GPU',structureDraft:'引言｜说明研究缺口\n结果｜报告误差'});
	assert.equal(f.project.researchPreparation.resourceConstraints,'两周；无 GPU');
	assert.equal(f.project.researchPreparation.structureDraft,'引言｜说明研究缺口\n结果｜报告误差');
	await f.N.saveDraft('study',{scopeOrigin:'manual',researchScope:{domain:'computer-vision',primaryKeyword:'image error'}});
	assert.equal(f.project.researchScope.primaryKeyword,'image error');
	assert.equal(f.project.researchPreparation.researchScope.primaryKeyword,'image error');
});

test('an emptied question or an unparsable structure keeps the saved values',async()=>{
	let f=await notebookFixture(),goal=f.project.researchGoal,structure=f.project.researchPreparation.structureDraft;
	await f.N.saveDraft('study',{ideaDraft:'   '});
	assert.equal(f.project.researchGoal,goal,'the card does not go blank while the field is cleared');
	await f.N.saveDraft('study',{structureDraft:''});
	assert.equal(f.project.researchPreparation.structureDraft,structure);
	let revision=JSON.stringify(f.project);await f.N.saveDraft('study',{constraints:f.N.state('study').constraints});
	assert.equal(JSON.stringify(f.project),revision,'an unchanged draft writes nothing');
});

test('the notebook page saves question, condition, structure and scope drafts through the sync',async()=>{
	let page=await readFile(new URL('../../chrome/content/zotero/research/notebook.mjs',import.meta.url),'utf8');
	assert.match(page,/key!=='questionDraft'&&N\.saveDraft\?N\.saveDraft\(id,change\)/);
	assert.match(page,/const SCOPE_SAVE_MS=550;/);
	assert.match(page,/\(N\.saveDraft\?N\.saveDraft\(id,change\):N\.update\(id,change\)\)\.catch/);
});
