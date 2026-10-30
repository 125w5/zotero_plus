/* SPDX-License-Identifier: AGPL-3.0-or-later */
// DC-03: an open corpus entry form, or 编辑范围 form, belongs to the corpus it
// was opened in. Switching corpora closes it (asking first when it has unsaved
// changes), so an edit is never saved into another corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture, loadPage, settle, Corpus} from './corpus-gap-harness.mjs';

function twoCorpora() {
	let f = serviceFixture();
	f.store.corpora = {
		A: {id: 'A', name: 'Corpus A', domain: '', researchScope: {}, entries: [Corpus.corpusEntry({title: 'A entry', text: 'Original text of the A entry.', section: '引言'}, {id: 'entry-a1'})]},
		B: {id: 'B', name: 'Corpus B', domain: '', researchScope: {}, entries: [Corpus.corpusEntry({title: 'B entry', text: 'Text of the B entry.', section: '引言'}, {id: 'entry-b1'})]}
	};
	return f;
}

test('keeping an unsaved edit on a corpus switch stays in the owning corpus and saves there', async () => {
	let f = twoCorpora(), page = await loadPage(f.E, {confirm: () => false});
	assert.equal(page.$('corpus-title').textContent, 'Corpus A');
	await page.button(page.$('entries'), '编辑').click();
	page.$('entry-text').value = 'User edit made for the A entry.';
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.equal(page.prompts.length, 1, 'unsaved changes are confirmed before the switch');
	assert.equal(page.$('corpus-title').textContent, 'Corpus A', 'declining keeps the owning corpus open');
	assert.equal(page.$('entry-form').hidden, false);
	await page.$('entry-form').requestSubmit();
	await settle();
	assert.equal(f.store.corpora.A.entries[0].text, 'User edit made for the A entry.');
	assert.deepEqual([...f.store.corpora.B.entries.map(row => row.id)], ['entry-b1'], 'nothing is written into the other corpus');
});

test('discarding an unsaved edit on a corpus switch closes the form and writes nothing', async () => {
	let f = twoCorpora(), page = await loadPage(f.E, {confirm: () => true});
	await page.button(page.$('entries'), '编辑').click();
	page.$('entry-text').value = 'Draft that the user discards.';
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.equal(page.prompts.length, 1);
	assert.equal(page.$('corpus-title').textContent, 'Corpus B');
	assert.equal(page.$('entry-form').hidden, true, 'the form of corpus A does not stay open over corpus B');
	await page.$('add-entry').click();
	assert.equal(page.$('entry-text').value, '', 'a new entry starts empty');
	page.$('entry-title').value = 'B note';
	page.$('entry-text').value = 'A new note for corpus B.';
	await page.$('entry-form').requestSubmit();
	await settle();
	assert.equal(f.store.corpora.A.entries[0].text, 'Original text of the A entry.');
	assert.equal(f.store.corpora.B.entries.length, 2);
	assert.ok(!f.store.corpora.B.entries.some(row => row.id === 'entry-a1'), 'the A entry id never appears in corpus B');
});

test('an edit form without changes closes on a corpus switch without asking', async () => {
	let f = twoCorpora(), page = await loadPage(f.E);
	await page.button(page.$('entries'), '编辑').click();
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.equal(page.prompts.length, 0);
	assert.equal(page.$('corpus-title').textContent, 'Corpus B');
	assert.equal(page.$('entry-form').hidden, true);
});

test('removing the entry that is open in the form closes the form', async () => {
	let f = twoCorpora(), page = await loadPage(f.E);
	await page.button(page.$('entries'), '编辑').click();
	await page.button(page.$('entries'), '移除').click();
	await settle();
	assert.equal(f.store.corpora.A.entries.length, 0);
	assert.equal(page.$('entry-form').hidden, true, 'a stale save cannot bring the removed entry back');
});

function scopedCorpora() {
	let f = twoCorpora();
	f.store.corpora.A.researchScope = {primaryKeyword: '超导'};
	f.store.corpora.B.researchScope = {primaryKeyword: '细胞成像'};
	return f;
}

test('the 编辑范围 form closes on a corpus switch and never saves into the other corpus', async () => {
	let f = scopedCorpora(), page = await loadPage(f.E);
	await page.$('edit-corpus-scope').click();
	assert.equal(page.$('corpus-scope-primary').value, '超导');
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.equal(page.prompts.length, 0, 'an unchanged scope form closes without asking');
	assert.equal(page.$('corpus-title').textContent, 'Corpus B');
	assert.equal(page.$('corpus-scope-form').hidden, true);
	await page.$('corpus-scope-form').requestSubmit();
	await settle();
	assert.equal(f.store.corpora.B.researchScope.primaryKeyword, '细胞成像', 'the scope of corpus A is not saved into corpus B');
	assert.equal(f.store.corpora.A.researchScope.primaryKeyword, '超导');
});

test('a changed 编辑范围 form asks before a switch and saves only into its own corpus', async () => {
	let f = scopedCorpora(), answers = [false, true], page = await loadPage(f.E, {confirm: () => answers.shift()});
	await page.$('edit-corpus-scope').click();
	page.$('corpus-scope-primary').value = '自旋输运';
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.deepEqual(page.prompts, ['放弃尚未保存的研究范围修改？已保存的内容不受影响。']);
	assert.equal(page.$('corpus-title').textContent, 'Corpus A', 'declining keeps the owning corpus open');
	assert.equal(page.$('corpus-scope-form').hidden, false);
	await page.$('corpus-scope-form').requestSubmit();
	await settle();
	assert.equal(f.store.corpora.A.researchScope.primaryKeyword, '自旋输运');
	assert.equal(f.store.corpora.B.researchScope.primaryKeyword, '细胞成像');
	await page.$('edit-corpus-scope').click();
	page.$('corpus-scope-primary').value = '量子';
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.equal(page.prompts.length, 2);
	assert.equal(page.$('corpus-title').textContent, 'Corpus B');
	assert.equal(page.$('corpus-scope-form').hidden, true, 'discarding closes the form of corpus A');
	assert.equal(f.store.corpora.A.researchScope.primaryKeyword, '自旋输运', 'the discarded draft is not saved');
	assert.equal(f.store.corpora.B.researchScope.primaryKeyword, '细胞成像');
});

test('one prompt covers an unsaved entry edit and an unsaved scope edit', async () => {
	let f = scopedCorpora(), page = await loadPage(f.E, {confirm: () => true});
	await page.button(page.$('entries'), '编辑').click();
	page.$('entry-text').value = 'Unsaved entry draft.';
	await page.$('edit-corpus-scope').click();
	page.$('corpus-scope-primary').value = '未保存的关键词';
	await page.button(page.$('corpus-list'), 'Corpus B').click();
	await settle();
	assert.deepEqual(page.prompts, ['放弃尚未保存的语料修改和研究范围修改？已保存的内容不受影响。']);
	assert.equal(page.$('entry-form').hidden, true);
	assert.equal(page.$('corpus-scope-form').hidden, true);
	assert.equal(f.store.corpora.A.entries[0].text, 'Original text of the A entry.');
	assert.equal(f.store.corpora.A.researchScope.primaryKeyword, '超导');
});
