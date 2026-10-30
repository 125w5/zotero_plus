/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Corpus collection against the real service (xpcom/research/research-resources.js):
// stable identity for Zotero notes and annotations (WSB-06), only the selected
// papers (WSB-08), a checked AI reply (WSB-15), purpose ranking instead of a
// search filter (WSB-01), keyword scope (WSB-16), the import domain check
// (WSB-20) and an explained empty result (WSB-21).
import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture, annotationCandidate, chapter, Corpus, Domain, Model} from './corpus-gap-harness.mjs';

test('WSB-06: collecting a published annotation again adds it once', async () => {
	let published = {...annotationCandidate(), id: 'asset-stable77', assetID: 'asset-stable77', revision: 1};
	let f = serviceFixture({library: {[published.id]: published}, candidates: async () => [annotationCandidate()]});
	let corpus = await f.E.corpus.create('自旋');
	let first = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.equal(first.added, 1, 'the card and the fresh Zotero candidate are one annotation');
	let second = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.equal(second.added, 0);
	assert.equal(second.present, 1);
	assert.equal(f.store.corpora[corpus.id].entries.length, 1);
	assert.equal(f.store.corpora[corpus.id].entries[0].materialID, 'asset-stable77');
});

test('WSB-06: an annotation that is not a card yet is published once and keeps that material id', async () => {
	let f = serviceFixture({candidates: async () => [annotationCandidate()]});
	let corpus = await f.E.corpus.create('自旋');
	assert.equal((await f.E.corpus.collect(corpus.id, {paperIDs: [1]})).added, 1);
	let [entry] = f.store.corpora[corpus.id].entries;
	assert.match(entry.materialID, /^asset-/, 'the entry points at a real material card');
	assert.ok(f.store.researchMaterials[entry.materialID]);
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
	assert.equal(f.store.corpora[corpus.id].entries.length, 1);
	assert.equal(Object.keys(f.store.researchMaterials).length, 1, 'no second card for the same annotation');
});

test('WSB-06: an entry collected before the fix is recognized by its paper and text', async () => {
	let f = serviceFixture({candidates: async () => [annotationCandidate()]});
	let corpus = await f.E.corpus.create('自旋');
	corpus.entries.push(Corpus.corpusEntry({title: '批注', text: 'A highlighted sentence about quantum spin.', paperItemID: 1, materialID: 'material-old-one-off', origin: 'source'}, {id: 'legacy'}));
	let result = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: result.added, present: result.present}, {added: 0, present: 1});
	assert.equal(f.store.corpora[corpus.id].entries.length, 1);
});

test('WSB-06: an annotation whose card has no text left is not published again into that card', async () => {
	let card = {...annotationCandidate(), id: 'asset-empty', assetID: 'asset-empty', sourceText: '', revision: 2};
	let f = serviceFixture({library: {[card.id]: card}, candidates: async () => [annotationCandidate()]});
	let corpus = await f.E.corpus.create('自旋');
	await assert.rejects(f.E.corpus.collect(corpus.id, {paperIDs: [1]}), /还没有可收集的章节素材、笔记或批注/);
	assert.equal(f.calls.publish.length, 0);
});

test('WSB-08: PPT draft records without a selected paper are not collected', async () => {
	let record = Model.material({kind: 'experiment', sourceRecordID: 'draft-x:c1', title: '实验记录 · 组会', sourceText: 'Unrelated lab record typed into a PPT draft.', anchor: {sourceText: 'Unrelated lab record typed into a PPT draft.'}});
	let f = serviceFixture({library: {[chapter(0).id]: chapter(0)}, candidates: async () => [record]});
	let corpus = await f.E.corpus.create('全局');
	assert.equal((await f.E.corpus.collect(corpus.id, {paperIDs: [1]})).added, 1);
	let [entry] = f.store.corpora[corpus.id].entries;
	assert.equal(entry.materialID, 'chapter-0');
	assert.ok(!f.store.corpora[corpus.id].entries.some(row => row.text.includes('PPT draft')));
	let only = serviceFixture({candidates: async () => [record]}), empty = await only.E.corpus.create('全局');
	await assert.rejects(only.E.corpus.collect(empty.id, {paperIDs: [1]}), /还没有可收集的章节素材、笔记或批注；语料库未改动/);
});

test('WSB-15: AI 挑选 keeps at most 20 known ids and refuses a reply without a usable id', async () => {
	let library = Object.fromEntries(Array.from({length: 30}, (_, index) => [chapter(index).id, chapter(index)]));
	let f = serviceFixture({library, request: async () => ({value: {ids: Object.keys(library)}})});
	let corpus = await f.E.corpus.create('自旋');
	let result = await f.E.corpus.collect(corpus.id, {paperIDs: [1], ai: true, purpose: '低温测量'});
	assert.equal(result.added, 20);
	assert.equal(result.dropped, 10);
	assert.equal(f.store.corpora[corpus.id].entries.length, 20);
	for (let [value, message] of [[null, /没有返回有效的语料编号列表/], [{}, /没有返回有效的语料编号列表/], [{ids: ['made-up-id']}, /编号都不在候选语料中/], [{ids: []}, /没有选出符合研究目的的语料/]]) {
		let g = serviceFixture({library, request: async () => ({value})}), target = await g.E.corpus.create('自旋');
		await assert.rejects(g.E.corpus.collect(target.id, {paperIDs: [1], ai: true}), error => message.test(error.message) && /语料库未改动/.test(error.message), JSON.stringify(value));
		assert.equal(g.store.corpora[target.id].entries.length, 0);
	}
});

test('WSB-01: AI 挑选 sends its own purpose and never filters the candidates by the search box', async () => {
	let library = Object.fromEntries(Array.from({length: 5}, (_, index) => [chapter(index).id, chapter(index)]));
	let f = serviceFixture({library, request: async () => ({value: {ids: ['chapter-3']}})});
	let corpus = await f.E.corpus.create('自旋');
	let purpose = '选出描述实验装置的段落';
	let result = await f.E.corpus.collect(corpus.id, {paperIDs: [1], ai: true, purpose, query: purpose});
	assert.equal(result.added, 1);
	let [, input] = f.calls.request[0];
	assert.equal(input.purpose, purpose);
	assert.equal(input.candidates.length, 5, 'a purpose sentence is not an AND filter');
	await assert.rejects(f.E.corpus.collect(corpus.id, {paperIDs: [1], query: '不存在的词'}), /不匹配当前的搜索词；语料库未改动。可清空筛选后重试/);
});

test('WSB-01: with more than 80 candidates the model sees the ones closest to the purpose', async () => {
	let library = Object.fromEntries(Array.from({length: 90}, (_, index) => [chapter(index).id, chapter(index)]));
	library['chapter-85'] = chapter(85, {title: '稀释制冷机装置', sourceText: '稀释制冷机装置的搭建与 quantum spin 测量过程。'});
	let f = serviceFixture({library, request: async () => ({value: {ids: ['chapter-85']}})});
	let corpus = await f.E.corpus.create('自旋');
	await f.E.corpus.collect(corpus.id, {paperIDs: [1], ai: true, purpose: '稀释制冷机装置'});
	let [, input] = f.calls.request[0];
	assert.equal(input.candidates.length, 80);
	assert.equal(input.candidates[0].id, 'chapter-85');
});

test('WSB-16: a corpus with a domain collects and imports chapters that match its keyword only', async () => {
	let text = '超导样品的制备与低温输运测量，记录四探针接法和降温速率。';
	let f = serviceFixture({library: {m: {id: 'm', title: '方法', sourceText: text, paperItemID: 1, sectionType: '方法', revision: 1, anchor: {paperItemID: 1, attachmentID: 2, pageIndex: 0, sourceText: text}}}});
	let scope = {domain: 'physics', primaryKeyword: '超导'};
	assert.equal(Domain.matchesResearchScope({title: '方法', sourceText: text}, scope), false, 'the strict default needs a domain term');
	let corpus = await f.E.corpus.create('超导方法', scope);
	assert.equal((await f.E.corpus.collect(corpus.id, {paperIDs: [1]})).added, 1);
	let project = f.addProject('超导输运', scope);
	assert.equal((await f.E.corpus.importProject(project.id, corpus.id, [corpus.entries[0].id])).count, 1);
	let note = await f.E.corpus.saveEntry(corpus.id, {title: '我的记录', text: '超导转变温度附近的电阻台阶。'});
	assert.equal(note.scopeWarning, undefined, 'a note with the keyword is in scope');
});

test('WSB-20: a corpus from another research domain is refused on import; manual notes still save with a warning', async () => {
	let f = serviceFixture();
	let project = f.addProject('超导输运', {domain: 'physics', primaryKeyword: '超导'});
	let other = await f.E.corpus.create('细胞成像', {domain: 'biomedical'});
	await f.E.corpus.saveEntry(other.id, {id: 'note', title: '笔记', text: '超导磁体用于细胞成像。'});
	await assert.rejects(f.E.corpus.importProject(project.id, other.id, ['note']), /研究领域与项目不同，未导入；项目素材未改动/);
	assert.equal(f.store.manuscripts[project.id].materials.length, 0);
	let own = await f.E.corpus.create('超导', {domain: 'physics', primaryKeyword: '超导'});
	let saved = await f.E.corpus.saveEntry(own.id, {id: 'off', title: '旁注', text: '组会时间改到周四。'});
	assert.match(saved.scopeWarning, /已保存，用于分析前请核对/);
	let result = await f.E.corpus.importProject(project.id, own.id, ['off']);
	assert.deepEqual({count: result.count, warnings: result.warnings}, {count: 1, warnings: 1});
});

test('WSB-21: collecting papers that are already in the corpus reports them instead of a bare 0', async () => {
	let f = serviceFixture({library: {[chapter(0).id]: chapter(0)}});
	let corpus = await f.E.corpus.create('自旋');
	await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
});
