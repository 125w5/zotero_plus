/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A PDF downloaded into a writing project's folder is indexed into article sections and
// those section cards join the project's corpus. Nothing happens without a project, and a
// failure never turns a finished download into an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/corpus-intake.js', import.meta.url), 'utf8');
function load({projects = {p1: {id: 'p1', paperCollectionID: 17}}, failIndex = false, failCorpus = false} = {}) {
	let calls = [], logged = [];
	let E = {
		manuscripts: {
			allView: () => projects,
			queueArticle: async id => { calls.push(['index', id]); if (failIndex) throw Error('index failed'); return {status: 'complete'}; }
		},
		corpus: {prepareProject: async (projectID, options) => { calls.push(['corpus', projectID, [...options.paperIDs]]); if (failCorpus) throw Error('corpus failed'); return {added: 3}; }},
		setTimeout: () => 0
	};
	vm.runInNewContext(source, {EasySch: E, Zotero: {logError: error => logged.push(error.message)}});
	return {E, calls, logged};
}

test('a download into a project folder is indexed and then filed into that project\'s corpus', async () => {
	let {E, calls} = load();
	let result = await E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {collectionID: 17});
	assert.equal(result.added, 3);
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['index', 6], ['corpus', 'p1', [5, 6]]], 'sections first, then the corpus');
	calls.length = 0;
	await E.corpusIntake.afterDownload({itemID: 8, attachmentID: 9}, {projectID: 'p2', collectionID: 99});
	assert.equal(calls.at(-1)[1], 'p2', 'an explicit project wins over the folder');
});

test('a download without a writing project leaves every corpus alone', async () => {
	let {E, calls} = load();
	assert.equal(E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {collectionID: 404}), null, 'a folder of no project');
	assert.equal(E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {}), null);
	assert.equal(E.corpusIntake.afterDownload({itemID: 5}, {projectID: 'p1'}), null, 'no PDF attachment');
	assert.equal(calls.length, 0);
});

test('the same download is filed once, and a failure is only logged', async () => {
	let {E, calls} = load();
	let first = E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {projectID: 'p1'}), second = E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {projectID: 'p1'});
	assert.equal(first, second);
	await first;
	assert.equal(calls.filter(row => row[0] === 'corpus').length, 1);
	let failing = load({failCorpus: true});
	assert.equal(await failing.E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {projectID: 'p1'}), null);
	assert.deepEqual(failing.logged, ['corpus failed']);
	let indexFails = load({failIndex: true});
	assert.equal(await indexFails.E.corpusIntake.afterDownload({itemID: 5, attachmentID: 6}, {projectID: 'p1'}), null);
	assert.equal(indexFails.calls.some(row => row[0] === 'corpus'), false, 'no corpus entries without section cards');
});
