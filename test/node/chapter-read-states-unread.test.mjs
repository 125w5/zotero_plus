/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A.chapterReadStates (xpcom/research/manuscript-writing.js) reports 未生成 for a
// chapter without a read and no longer computes that chapter's basis, which
// hashes the text of every linked material. Read chapters keep the states the
// basis gives them: the expected states below are computed the way the
// function computed them before, from the same modules and store.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import * as Assessment from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as Corpus from '../../chrome/content/zotero/research/shared/corpus-library.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as JsonStream from '../../chrome/content/zotero/research/shared/json-stream.mjs';
import * as ProjectCopy from '../../chrome/content/zotero/research/shared/project-copy.mjs';
import { readProject, deepFreeze } from './fixtures/chapter-read-project.mjs';

const root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url);
const sources = await Promise.all(['manuscript.js', 'manuscript-writing.js', 'manuscript-assessment.js'].map(file => readFile(new URL(file, root), 'utf8')));
let plain = value => JSON.parse(JSON.stringify(value));

// The services against a store that freezes peeks like storage.js, with
// research-thread.mjs counting chapterBasis calls.
function service(project = readProject()) {
	let state = { manuscripts: { [project.id]: structuredClone(project) }, projectReadings: {}, projectTaskPlans: {}, researchMaterials: {} }, basis = { calls: [] };
	let store = {
		get: (...path) => structuredClone(path.reduce((value, key) => value?.[key], state)),
		peek: (...path) => deepFreeze(structuredClone(path.reduce((value, key) => value?.[key], state))),
		update: async fn => { let draft = structuredClone(state); await fn(draft); state = draft; }
	};
	let spied = { ...Thread, chapterBasis: (...args) => { basis.calls.push(args[2]); return Thread.chapterBasis(...args); } };
	let E = { store, assets: { key: JSON.stringify }, notebook: { projectView: id => store.peek('manuscripts', id), stateView: () => undefined }, corpus: {} };
	let modules = { 'chat-completion.mjs': {}, 'json-stream.mjs': JsonStream, 'manuscript-model.mjs': M, 'research-ai-policy.mjs': Policy, 'material-exclusions.mjs': Exclusions, 'topic-materials.mjs': {}, 'material-content.mjs': {}, 'research-thread.mjs': spied, 'manuscript-assessment.mjs': Assessment, 'assembly-writing-preview.mjs': Writing, 'writing-framework.mjs': Framework, 'selection-target.mjs': Selection, 'corpus-library.mjs': Corpus, 'project-copy.mjs': ProjectCopy };
	let Zotero = { Research: E, Utilities: { randomString: () => 'fixed' }, getMainWindow: () => ({ document: { getElementById: () => null }, AbortController }), Prefs: { get: () => '' } };
	let context = vm.createContext({ Zotero, ChromeUtils: { importESModule: url => { let module = modules[url.split('/').at(-1)]; if (!module) throw Error('Unexpected import ' + url); return module; } }, URL, AbortController });
	for (let code of sources) vm.runInContext(code, context);
	return { A: E.manuscripts, basis, get state() { return state; } };
}
// The states as chapterReadStates computed them before: every chapter's basis.
function previousStates(f, projectID) {
	let project = f.state.manuscripts[projectID], readings = f.state.projectReadings[projectID] || null, current = Thread.threadContext(project, undefined, { readings, structureMaterials: [] }), states = {};
	for (let section of project.sections) {
		let read = readings?.chapters?.[section.id], basis = null;
		try { basis = Thread.chapterBasis(project, undefined, section.id, { thread: current, corpusRows: [] }); } catch { basis = null; }
		states[section.id] = Thread.chapterReadState(read, basis, { deferredIDs: read ? Thread.chapterDeferredIDs(current.decisions, current.plan?.experiments, section.id) : null, manualIDs: null, materialIDs: new Set(project.materials.map(row => row.id)) });
	}
	return plain(states);
}

test('chapters without a read are 未生成 and their basis is not computed', () => {
	let f = service();
	assert.deepEqual(plain(f.A.chapterReadStates('p')), { s1: { state: 'missing', changed: [] }, s2: { state: 'missing', changed: [] } });
	assert.deepEqual(f.basis.calls, [], 'no basis for a project without reads');
	assert.deepEqual(plain(f.A.chapterReadStates('p')), previousStates(f, 'p'));
	assert.throws(() => f.A.chapterReadStates('gone'), /论文项目已删除/, 'a missing project still throws');
});

test('a read chapter keeps the state its basis gives: current, stale after an edit, partial, update', () => {
	let f = service(), project = f.state.manuscripts.p, thread = Thread.threadContext(project, undefined, { readings: null, structureMaterials: [] });
	let saved = Thread.chapterBasis(project, undefined, 's2', { thread, corpusRows: [] });
	let scenarios = [
		['current', { basis: saved, nodes: [] }, () => {}],
		['stale after the chapter text changed', { basis: saved, nodes: [] }, state => { state.manuscripts.p.blocks.find(row => row.id === 'b2').text = '新写的方法段落'; }],
		['stale after a linked material changed', { basis: saved, nodes: [] }, state => { state.manuscripts.p.materials.find(row => row.id === 'm2').sourceText += ' Revised.'; }],
		['partial', { basis: saved, nodes: [], incomplete: { reason: 'output-limit' } }, () => {}],
		['update', { basis: saved, nodes: [{ id: 'n1', status: 'planned', pendingUpdate: { text: '新' } }] }, () => {}]
	];
	let seen = new Set();
	for (let [label, read, change] of scenarios) {
		let g = service();
		g.state.projectReadings.p = { at: '2026-10-01T00:00:00.000Z', chapters: { s2: read } };
		change(g.state);
		let states = plain(g.A.chapterReadStates('p'));
		assert.deepEqual(states, previousStates(g, 'p'), label);
		assert.deepEqual(states.s1, { state: 'missing', changed: [] }, label);
		assert.deepEqual(g.basis.calls, ['s2'], 'only the read chapter computes its basis: ' + label);
		seen.add(states.s2.state);
	}
	assert.deepEqual([...seen].sort(), ['current', 'partial', 'stale', 'update'], 'each scenario reaches the state it names');
});
