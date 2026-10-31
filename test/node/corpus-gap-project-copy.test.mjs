/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-09: 复制项目 takes the project's research notebook along, so the copy keeps
// its plan versions, decisions and drafts, and its adopted plan still resolves.
// The copy gets its own plan version ids and plan cards, so a change to the
// copy's plan never marks the original's plan card stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as ProjectAnnotations from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as ProjectCopy from '../../chrome/content/zotero/research/shared/project-copy.mjs';

let service = name => readFile(new URL('../../chrome/content/zotero/xpcom/research/' + name, import.meta.url), 'utf8');
let code = await service('manuscript.js'), writingCode = await service('manuscript-writing.js'), notebookCode = await service('notebook.js');

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
	assert.equal(copied.versions.length, 2);
	assert.equal(copied.versions[1].plan.title, '方案二');
	assert.ok(copied.versions.every(row => !['v1', 'v2'].includes(row.id)), 'the copy has its own plan version ids');
	assert.equal(copied.selectedVersion, copied.versions[1].id);
	assert.equal(copied.decisions[0].text, '采用四探针法');
	assert.equal(copied.artifacts[0].id, 'artifact-' + copied.versions[1].id, 'the plan card follows its version, as N.confirm names it');
	assert.equal(copied.artifacts[0].versionID, copied.versions[1].id);
	assert.equal(copied.messages.length, 1);
	assert.equal(copied.assessment.status, 'ready', 'a finished assessment is part of the plan history');
	assert.equal(copied.assessment.versionID, copied.versions[1].id);
	assert.equal(data.manuscripts[copy.id].researchPreparation.planVersionID, copied.versions[1].id, 'the adopted plan version resolves in the copy');
	assert.equal(data.researchNotebooks[id].selectedVersion, 'v2', 'the original keeps its own ids');
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

// WSB-09-shared-plan-card: the real manuscript, writing and notebook services on
// one in-memory store, so a plan card is published by N.confirm, read back
// through A.get (syncAssets) and marked stale by N.invalidateArtifacts.
let hash = (text) => {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
	return (value >>> 0).toString(16);
};
let fail = (error) => {
	throw error;
};
let draftVersion = () => ({id: 'plan-v1', number: 1, status: 'draft', idea: '低温下的自旋输运', sources: [], sourceRevisions: {}, sourceItemVersions: {}, plan: {title: '四探针比较方案', novelty: '比较两种测量', significance: '支持重复测量', feasibility: '实验尚未进行', minimumValidation: '保留独立样本', hypotheses: [{id: 'h1', claim: '温度影响自旋输运', falsification: '重复测量不支持该差异'}], closest: [], experiments: [{id: 'e1', hypothesisID: 'h1', title: '四探针测量计划'}], pending: ['补充样品记录'], openQuestions: [], decisions: [{id: 'd1', decision: '采用四探针法'}]}});

function notebookSetup() {
	let project = Model.createProject('低温输运');
	let data = {manuscripts: {[project.id]: project}, researchNotebooks: {[project.id]: {query: '', selectedMaterial: null, messages: [], versions: [draftVersion()], decisions: [], artifacts: [], selectedVersion: 'plan-v1'}}, researchMaterials: {}, projectReadings: {}, projectTaskPlans: {}};
	let E = {store: {get: (...path) => structuredClone(path.reduce((value, key) => value?.[key], data)), update: async fn => fn(data)}, assets: {key: value => hash(JSON.stringify(value))}};
	let modules = {'manuscript-model.mjs': Model, 'material-exclusions.mjs': Exclusions, 'academic-plan.mjs': Plan, 'research-domain.mjs': Domain, 'material-project-annotations.mjs': ProjectAnnotations, 'research-thread.mjs': Thread, 'writing-framework.mjs': Framework, 'assembly-writing-preview.mjs': Writing, 'project-copy.mjs': ProjectCopy};
	let context = vm.createContext({Zotero: {Research: E, getMainWindow: () => null, Items: {get: () => null, getAsync: async () => null}, logError: fail}, ChromeUtils: {importESModule: url => modules[url.split('/').at(-1)] || {}}});
	vm.runInContext(code, context);
	E.manuscripts.ensureLibraryItem = async () => {};
	E.manuscripts.onAssetsChanged = () => () => {};
	vm.runInContext(writingCode, context);
	vm.runInContext(notebookCode, context);
	return {A: E.manuscripts, N: E.notebook, data, id: project.id};
}
// A confirmed plan card applied to the project and placed on the page, as
// enterAssembly and a drop from the notebook's artifact list leave it.
function adopt(data, id, artifact) {
	let project = data.manuscripts[id], card = structuredClone(data.researchMaterials[artifact.materialID]), section = project.sections[0].id;
	project.researchPreparation = {planVersionID: artifact.versionID, planVersionNumber: 1, planStatus: 'confirmed', plan: {title: card.title}};
	project.materials.push(card);
	project.blocks.push(Model.block('paragraph', section, {text: '本文按已确认方案比较两种测量。', materials: [{id: card.id, role: 'primary', revision: card.revision}], artifactID: card.artifactID, review: 'verified'}));
	return card;
}

test('a changed hypothesis in the copy leaves the original plan card and its page current', async () => {
	let {A, N, data, id} = notebookSetup();
	let artifact = await N.confirm(id, 'plan-v1');
	let card = adopt(data, id, artifact);
	assert.deepEqual(Model.validate(A.get(id)), [], 'the original passes the check before the copy');
	let copy = await A.copy(id);
	// N.evaluate calls this when the copy's next plan version changes h1.
	await N.invalidateArtifacts(copy.id, ['h1']);
	let copied = data.researchNotebooks[copy.id].artifacts[0];
	assert.equal(copied.status, 'needs-review', 'the copy reviews its own plan card');
	assert.notEqual(copied.materialID, card.id);
	assert.equal(data.researchMaterials[copied.materialID].verification, 'stale');
	assert.equal(data.researchNotebooks[id].artifacts[0].status, 'confirmed');
	assert.equal(data.researchMaterials[card.id].verification, card.verification, 'the original plan card is not marked stale');
	assert.equal(data.researchMaterials[card.id].revision, card.revision);
	assert.deepEqual(Model.validate(A.get(id)), [], 'the original page still passes the check, so its generation is not blocked');
	assert.equal(N.planCardStatuses([id])[id], 'ready');
	assert.ok(Model.validate(A.get(copy.id)).some(issue => issue.message === '来源或数据已变化，需要重新核验'), 'the copy page follows its own stale plan card');
});

test('a copy holds none of the original plan version, artifact or plan card ids', async () => {
	let {A, N, data, id} = notebookSetup();
	let artifact = await N.confirm(id, 'plan-v1');
	let card = adopt(data, id, artifact), notebook = data.researchNotebooks[id];
	notebook.versions.push({...structuredClone(notebook.versions[0]), id: 'plan-v2', number: 2, status: 'draft', editedFrom: 'plan-v1'});
	Object.assign(notebook, {selectedVersion: 'plan-v2', selectedMaterial: card.id, recentMaterials: [card.id], sourceContext: {[card.id]: 'full'}, assessment: {status: 'ready', versionID: 'plan-v2', message: '可行性方案已准备好'}});
	notebook.messages.push({id: 'm1', role: 'assistant', text: '已生成第 2 版方案。', versionID: 'plan-v2'}, {id: 'm2', role: 'user', channel: 'source', contextID: card.id, text: '这张方案卡的假设是什么'});
	data.projectReadings[id] = {chapters: {[data.manuscripts[id].sections[0].id]: {omitted: [{id: card.id, title: card.title, reason: 'not-evidence'}]}}};
	let before = JSON.stringify({notebook, card: data.researchMaterials[card.id]});
	let copy = await A.copy(id);
	let stored = data.manuscripts[copy.id], copied = data.researchNotebooks[copy.id], text = JSON.stringify([stored, copied, data.projectReadings[copy.id]]);
	for (let old of ['plan-v1', 'plan-v2', artifact.id, card.id]) assert.ok(!text.includes(JSON.stringify(old)), 'the copy still refers to ' + old);
	let [first, second] = copied.versions;
	assert.equal(second.editedFrom, first.id);
	assert.equal(copied.selectedVersion, second.id);
	assert.equal(copied.assessment.versionID, second.id);
	assert.equal(stored.researchPreparation.planVersionID, first.id, 'the adopted plan resolves in the copy');
	assert.equal(copied.messages.find(row => row.versionID).versionID, second.id);
	assert.ok(copied.decisions.length && copied.decisions.every(row => row.versionID === first.id));
	let plan = copied.artifacts[0], copiedCard = data.researchMaterials[plan.materialID];
	assert.equal(plan.id, 'artifact-' + first.id);
	assert.equal(plan.versionID, first.id);
	assert.ok(copiedCard, 'the copy plan card is republished under its own artifact');
	assert.equal(copiedCard.assetID, plan.materialID);
	assert.equal(copiedCard.artifactID, plan.id);
	assert.equal(copiedCard.sourceRecordID, plan.id);
	assert.equal(copiedCard.sourceText, card.sourceText);
	assert.equal(copiedCard.revision, card.revision, 'the page link keeps matching its card, so the copy is not marked stale');
	assert.equal(stored.materials.at(-1).id, plan.materialID);
	assert.equal(stored.blocks.at(-1).materials[0].id, plan.materialID);
	assert.equal(stored.blocks.at(-1).artifactID, plan.id);
	assert.equal(copied.selectedMaterial, plan.materialID);
	assert.equal(copied.sourceContext[plan.materialID], 'full');
	assert.equal(copied.messages.find(row => row.channel === 'source').contextID, plan.materialID);
	assert.equal(Object.values(data.projectReadings[copy.id].chapters)[0].omitted[0].id, plan.materialID);
	assert.equal(JSON.stringify({notebook: data.researchNotebooks[id], card: data.researchMaterials[card.id]}), before, 'the original notebook and plan card are unchanged');
	assert.deepEqual(Model.validate(A.get(copy.id)), []);
	assert.equal(N.planCardStatuses([copy.id])[copy.id], 'ready');
	assert.equal((await N.confirm(copy.id, first.id)).materialID, plan.materialID, 'confirming in the copy finds its own plan card');
});

test('confirming the same draft in the original and the copy publishes two plan cards', async () => {
	let {A, N, data, id} = notebookSetup();
	let copy = await A.copy(id), draft = data.researchNotebooks[copy.id].versions[0];
	assert.notEqual(draft.id, 'plan-v1');
	let original = await N.confirm(id, 'plan-v1'), copied = await N.confirm(copy.id, draft.id);
	assert.notEqual(copied.materialID, original.materialID, 'each project confirms its own plan card');
	await N.invalidateArtifacts(copy.id, ['h1']);
	assert.equal(data.researchMaterials[original.materialID].verification, 'unverified');
	assert.equal(data.researchNotebooks[id].artifacts[0].status, 'confirmed');
});
