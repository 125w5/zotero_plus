/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-09: 复制项目 takes the project's research notebook along, so the copy keeps
// its plan versions, decisions and drafts, and its adopted plan still resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

let code = await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js', import.meta.url), 'utf8');

function setup(notebook) {
	let project = Model.createProject('低温输运');
	project.researchPreparation = {planVersionID: 'v2', planStatus: 'confirmed'};
	let data = {manuscripts: {[project.id]: project}, researchNotebooks: notebook ? {[project.id]: notebook} : {}, projectReadings: {[project.id]: {chapters: {}}}, projectTaskPlans: {}};
	let E = {store: {get: (...path) => structuredClone(path.reduce((value, key) => value?.[key], data)), update: async fn => fn(data)}};
	vm.runInNewContext(code, {Zotero: {Research: E}, ChromeUtils: {importESModule: url => (url.includes('manuscript-model') ? Model : {})}});
	E.manuscripts.ensureLibraryItem = async () => {};
	return {A: E.manuscripts, data, id: project.id};
}

test('a copied project keeps its plan versions, decisions and drafts', async () => {
	let notebook = {ideaDraft: '低温下的自旋输运', versions: [{id: 'v1'}, {id: 'v2', plan: {title: '方案二'}}], selectedVersion: 'v2', decisions: [{id: 'd1', text: '采用四探针法'}], artifacts: [{id: 'artifact-v2', versionID: 'v2', status: 'confirmed'}], messages: [{role: 'user', content: '先比较两种测量'}], assessment: {status: 'ready', versionID: 'v2'}};
	let {A, data, id} = setup(notebook);
	let copy = await A.copy(id);
	let copied = data.researchNotebooks[copy.id];
	assert.ok(copied, 'the copy has its own notebook entry');
	assert.deepEqual([...copied.versions.map(row => row.id)], ['v1', 'v2']);
	assert.equal(copied.selectedVersion, 'v2');
	assert.equal(copied.decisions[0].text, '采用四探针法');
	assert.equal(copied.artifacts[0].id, 'artifact-v2');
	assert.equal(copied.messages.length, 1);
	assert.equal(copied.assessment.status, 'ready', 'a finished assessment is part of the plan history');
	assert.ok(copied.versions.some(row => row.id === data.manuscripts[copy.id].researchPreparation.planVersionID), 'the adopted plan version resolves in the copy');
	copied.decisions.push({id: 'd2'});
	assert.equal(data.researchNotebooks[id].decisions.length, 1, 'the copy is detached from the original');
	assert.ok(data.projectReadings[copy.id], 'chapter reads still come along');
});

test('a copy does not inherit an assessment that is still running for the original', async () => {
	let {A, data, id} = setup({versions: [], decisions: [], artifacts: [], messages: [], assessment: {status: 'running', message: '正在比较本地已选文献中的接近工作与反证'}});
	let copy = await A.copy(id);
	assert.ok(data.researchNotebooks[copy.id]);
	assert.equal(data.researchNotebooks[copy.id].assessment, undefined);
	assert.equal(data.researchNotebooks[id].assessment.status, 'running', 'the original keeps its running job');
});

test('a project without notebook state copies without creating one', async () => {
	let {A, data, id} = setup(null);
	let copy = await A.copy(id);
	assert.ok(data.manuscripts[copy.id]);
	assert.equal(data.researchNotebooks[copy.id], undefined);
});
