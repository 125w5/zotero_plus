/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Corpus page (F09/F10): a corpus gets its own domain and keywords on creation
// and in the header, and an edited source entry reads as the user's own text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { corpusEntryProvenance, corpusEntry } from '../../chrome/content/zotero/research/shared/corpus-library.mjs';

let read = name => readFile(new URL('../../chrome/content/zotero/research/' + name, import.meta.url), 'utf8');

test('corpus creation and the corpus header carry the research scope through the corpus API', async () => {
	let [page, html] = await Promise.all([read('research-resources.mjs'), read('research-resources.html')]);
	for (let id of ['corpus-domain', 'corpus-primary', 'corpus-secondary', 'corpus-scope-form', 'corpus-scope-domain', 'corpus-scope-primary', 'corpus-scope-secondary', 'edit-corpus-scope', 'corpus-scope']) assert.match(html, new RegExp('id="' + id + '"'), id);
	assert.match(html, /research-corpus-scope\.css/);
	assert.match(page, /E\.corpus\.create\(\$\('corpus-name'\)\.value,createScope\.get\(\)\)/, 'creation passes domain and keywords');
	assert.match(page, /E\.corpus\.update\(target,\{researchScope:headerScope\.get\(\)\}\)/, 'the header edits the scope through E.corpus.update');
	assert.match(page, /const target=scopeEditing\?\.corpusID;/, 'the scope is saved into the corpus the form was opened for (DC-03)');
	assert.match(page, /researchScopeLabel\(scope\)/, 'the header shows the current scope');
	assert.match(page, /resetCreateScope=\(\)=>createScope\.set\(project\(\)\?researchScopeFromProject\(project\(\)\):\{\}\)/, 'a project corpus starts from the project scope, still editable');
});

test('an edited source entry is marked as the user text with its original kept', async () => {
	let page = await read('research-resources.mjs');
	assert.match(page, /card\.dataset\.provenance=provenance/);
	assert.match(page, /编辑前的原文/);
	assert.match(page, /人工编辑 · 需核验，不作为原文证据/);
	assert.match(page, /manual:'手工条目 · 需核验'/, 'the corpus page uses the same term as the read and the export (F12)');
	assert.doesNotMatch(page, /手动添加/);
	let origin = { id: 'm', sourceText: 'Original source paragraph.', revision: 1 };
	let edited = corpusEntry({ title: 'x', text: 'My own claim.', origin: 'manual', sourceEdited: true, originalText: origin.sourceText, materialID: 'm', paperItemID: 3 }, { id: 'e1' });
	assert.equal(corpusEntryProvenance(edited, origin), 'edited');
	assert.equal(edited.originalText, 'Original source paragraph.');
});
