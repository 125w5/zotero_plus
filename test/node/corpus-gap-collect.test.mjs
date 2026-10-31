/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Corpus collection against the real service (xpcom/research/research-resources.js):
// stable identity for Zotero notes and annotations (WSB-06), only the selected
// papers (WSB-08), a checked AI reply (WSB-15), purpose ranking instead of a
// search filter (WSB-01), keyword scope (WSB-16), the import domain check
// (WSB-20) and an explained empty result (WSB-21). Corpus review: an AI card
// made from an annotation does not hide it (CR-1), a PDF without a parent item
// (CR-2), the outside count (CR-4), keyword-only scope messages (CR-5) and a
// corpus the project chose itself (WSB-20).
import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture, annotationCandidate, chapter, Corpus, Domain, Model} from './corpus-gap-harness.mjs';
import {topicCards} from '../../chrome/content/zotero/research/shared/topic-materials.mjs';
import {sectionMaterial} from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';

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

test('CR-1: an AI 主题素材 card made from an annotation does not keep that annotation out of the corpus', async () => {
	let f = serviceFixture({candidates: async () => [annotationCandidate()]});
	let [made] = topicCards({cards: [{title: '自旋输运', summary: '批注指出自旋输运的测量对象。', sourceID: 'source-77', quote: 'quantum spin'}]}, [{...annotationCandidate(), id: 'source-77'}], '自旋');
	let [ai] = (await f.E.manuscripts.publishMaterials([made])).cards;
	assert.equal(ai.aiGenerated, true);
	assert.deepEqual([ai.kind, ai.sourceItemID], ['annotation', 77], 'the AI card points at the same annotation');
	let corpus = await f.E.corpus.create('自旋');
	let result = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.equal(result.added, 1);
	let entries = f.store.corpora[corpus.id].entries;
	assert.equal(entries.length, 1);
	assert.equal(entries[0].text, 'A highlighted sentence about quantum spin.', 'the annotation itself is collected');
	assert.notEqual(entries[0].materialID, ai.id, 'the AI card stays out of the corpus');
	assert.equal(f.store.researchMaterials[entries[0].materialID].aiGenerated, undefined, 'the annotation gets its own plain card');
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
	assert.equal(Object.keys(f.store.researchMaterials).length, 2, 'one AI card and one plain card');
});

test('CR-1: a Zotero note saved from an AI 研究讨论 is still not collected as source text', async () => {
	let text = '模型讨论认为自旋输运效应显著。';
	let note = Model.material({kind: 'note', sourceItemID: 88, title: 'AI 讨论', sourceText: text, anchor: {paperItemID: 1, citationItemID: 1, attachmentID: null, sourceText: text}});
	let discussion = Model.material({kind: 'note', sourceItemID: 88, sourceRecordID: 'research-message:m1', sourceType: 'ai-discussion', aiGenerated: true, conversationID: 's1', messageID: 'm1', title: 'AI 讨论', sourceText: text, anchor: {noteID: 88, paperItemID: 1, sourceText: text}});
	let f = serviceFixture({library: {'asset-discussion': {...discussion, id: 'asset-discussion'}}, candidates: async () => [note]});
	let corpus = await f.E.corpus.create('自旋');
	await assert.rejects(f.E.corpus.collect(corpus.id, {paperIDs: [1]}), /还没有可收集的章节素材、笔记或批注/);
	assert.equal(f.calls.publish.length, 0, 'the discussion note is not published as a plain source card');
	assert.equal(f.store.corpora[corpus.id].entries.length, 0);
});

test('CR-1: an AI 研究讨论 note whose card names another paper or none is still not collected after the note moves under a paper', async () => {
	let text = '问题：自旋输运是否显著？\n\n回答：\n模型认为自旋输运效应显著。', own = '用户自己写的自旋输运笔记。';
	// The card keeps the paper of the save: none for a note saved without a source, the old paper after a Zotero merge.
	let discussion = paperItemID => ({...Model.material({kind: 'note', sourceItemID: 88, sourceRecordID: 'research-message:["s1","m1"]', sourceType: 'ai-discussion', aiGenerated: true, conversationID: 's1', messageID: 'm1', title: '自旋输运是否显著？', sourceText: text, anchor: {noteID: 88, paperItemID, sourceText: text}}), id: 'asset-discussion'});
	// A.candidates reads the same Zotero note as a child note of paper 1.
	let moved = Model.material({kind: 'note', sourceItemID: 88, title: '自旋输运是否显著？', sourceText: text, anchor: {paperItemID: 1, citationItemID: 1, attachmentID: null, sourceText: text}});
	let plain = Model.material({kind: 'note', sourceItemID: 55, title: '我的笔记', sourceText: own, anchor: {paperItemID: 1, citationItemID: 1, attachmentID: null, sourceText: own}});
	let f = serviceFixture({library: {'asset-discussion': discussion(null)}, candidates: async () => [moved]});
	let corpus = await f.E.corpus.create('自旋');
	await assert.rejects(f.E.corpus.collect(corpus.id, {paperIDs: [1]}), /还没有可收集的章节素材、笔记或批注/);
	assert.equal(f.calls.publish.length, 0, 'the discussion note is not published as a plain source card');
	let g = serviceFixture({library: {'asset-discussion': discussion(9), [chapter(0).id]: chapter(0)}, candidates: async () => [moved, plain]});
	let target = await g.E.corpus.create('自旋');
	assert.equal((await g.E.corpus.collect(target.id, {paperIDs: [1]})).added, 2);
	assert.deepEqual([...g.store.corpora[target.id].entries.map(row => row.text)], [chapter(0).sourceText, own], 'the chapter and the user note are collected');
	assert.deepEqual(g.calls.publish, [1], 'only the user note gets a card');
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

test('CR-2: a selected PDF without a parent item has its annotations and chapter cards collected; PPT draft records stay out', async () => {
	let text = 'Spin relaxation measured in the standalone PDF.';
	let section = sectionMaterial({title: '方法', type: '方法', key: 'method', paragraphs: [{id: 'P1', pageIndex: 0, sourceText: text, section: '方法'}]}, {attachmentID: 30, paperTitle: '独立 PDF', pdfHash: 'h30', parseVersion: 1, id: 'section-30'});
	let record = Model.material({kind: 'experiment', sourceRecordID: 'draft-x:c1', title: '实验记录 · 组会', sourceText: 'Unrelated lab record typed into a PPT draft.', anchor: {sourceText: 'Unrelated lab record typed into a PPT draft.'}});
	let other = chapter(5, {paperItemID: null, anchor: {paperItemID: null, attachmentID: 31, pageIndex: 0, sourceText: 'x'}});
	let f = serviceFixture({library: {[section.id]: section, [other.id]: other, [chapter(0).id]: chapter(0)}, selection: [{id: 30}], candidates: async () => [annotationCandidate({sourceItemID: 300, paperItemID: null, attachmentID: 30, text: 'Annotation on a PDF without a parent item.'}), annotationCandidate({sourceItemID: 310, paperItemID: null, attachmentID: 31, text: 'Annotation on another standalone PDF.'}), record]});
	assert.equal(section.paperItemID, null);
	let corpus = await f.E.corpus.create('全局');
	assert.equal((await f.E.corpus.collect(corpus.id)).added, 2, 'the library selection is the PDF itself');
	let entries = f.store.corpora[corpus.id].entries;
	assert.deepEqual([...entries.map(row => row.text)].sort(), ['Annotation on a PDF without a parent item.', text]);
	assert.ok(entries.some(row => row.materialID === 'section-30'));
	assert.ok(!entries.some(row => /PPT draft|another standalone|cryostat/.test(row.text)), 'other PDFs, other papers and PPT draft records stay out');
});

test('CR-2: a manual entry with the same text does not keep the annotation of a PDF without a parent item out of the corpus', async () => {
	let text = 'Spin relaxation time depends on temperature.';
	let f = serviceFixture({selection: [{id: 30}], candidates: async () => [annotationCandidate({sourceItemID: 300, paperItemID: null, attachmentID: 30, text})]});
	let corpus = await f.E.corpus.create('全局');
	await f.E.corpus.saveEntry(corpus.id, {title: '我的笔记', text});
	let result = await f.E.corpus.collect(corpus.id);
	assert.deepEqual({added: result.added, present: result.present}, {added: 1, present: 0});
	let entries = f.store.corpora[corpus.id].entries;
	assert.deepEqual([...entries.map(row => row.origin)], ['manual', 'source']);
	assert.equal(entries[1].anchor.attachmentID, 30, 'the annotation keeps its PDF location');
	let again = await f.E.corpus.collect(corpus.id);
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
});

test('CR-2: the same highlighted sentence on two PDFs without a parent item adds one entry for each PDF', async () => {
	let same = 'The sample is cooled to 4 K before each measurement.';
	let f = serviceFixture({selection: [{id: 30}, {id: 31}], candidates: async () => [annotationCandidate({sourceItemID: 300, paperItemID: null, attachmentID: 30, text: same}), annotationCandidate({sourceItemID: 310, paperItemID: null, attachmentID: 31, text: same})]});
	let corpus = await f.E.corpus.create('全局');
	assert.equal((await f.E.corpus.collect(corpus.id)).added, 2);
	assert.deepEqual([...f.store.corpora[corpus.id].entries.map(row => row.anchor.attachmentID)].sort(), [30, 31]);
	let again = await f.E.corpus.collect(corpus.id);
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 2});
});

test('CR-2: a manual entry with the text of a chapter card of a PDF without a parent item does not keep that card out', async () => {
	let text = 'Spin relaxation measured in the standalone PDF.';
	let section = sectionMaterial({title: '方法', type: '方法', key: 'method', paragraphs: [{id: 'P1', pageIndex: 0, sourceText: text, section: '方法'}]}, {attachmentID: 30, paperTitle: '独立 PDF', pdfHash: 'h30', parseVersion: 1, id: 'section-30'});
	let f = serviceFixture({library: {[section.id]: section}, selection: [{id: 30}]});
	let corpus = await f.E.corpus.create('全局');
	await f.E.corpus.saveEntry(corpus.id, {title: '我的笔记', text});
	let result = await f.E.corpus.collect(corpus.id);
	assert.deepEqual({added: result.added, present: result.present}, {added: 1, present: 0});
	assert.deepEqual([...f.store.corpora[corpus.id].entries.map(row => row.materialID)], [null, 'section-30']);
	let again = await f.E.corpus.collect(corpus.id);
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
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

test('CR-5: scope messages name only the keywords, so adding a domain word is not suggested as a fix', async () => {
	let f = serviceFixture();
	let scope = {domain: 'physics', primaryKeyword: '超导'};
	let corpus = await f.E.corpus.create('超导方法', scope);
	let note = await f.E.corpus.saveEntry(corpus.id, {title: '旁注', text: '量子物理组会改到周四。'});
	assert.match(note.scopeWarning, /^这份手工语料不含语料库的关键词；已保存/, 'the domain words 量子 and 物理 do not clear the warning');
	await assert.rejects(f.E.corpus.saveEntry(corpus.id, {title: '原文', text: '量子物理的测量记录。', origin: 'source', materialID: 'm-off'}), error => /语料库的关键词/.test(error.message) && !/研究领域/.test(error.message));
	let project = f.addProject('超导输运', scope);
	corpus.entries.push(Corpus.corpusEntry({title: '原文', text: '量子物理的测量记录。', origin: 'source', materialID: 'm-off', paperItemID: 1}, {id: 'off'}));
	await assert.rejects(f.E.corpus.importProject(project.id, corpus.id, ['off']), error => /1 份不含当前研究范围的关键词/.test(error.message) && !/研究领域/.test(error.message));
	assert.equal(f.store.manuscripts[project.id].materials.length, 0);
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

test('WSB-20: a corpus the project chose in preparation imports despite its domain; rows outside the keywords keep their warning', async () => {
	let f = serviceFixture();
	let project = f.addProject('超导输运', {domain: 'physics', primaryKeyword: '超导'});
	let chosen = await f.E.corpus.create('细胞成像', {domain: 'biomedical'}), elsewhere = await f.E.corpus.create('组织切片', {domain: 'biomedical'});
	await f.E.corpus.saveEntry(chosen.id, {id: 'fit', title: '笔记', text: '超导磁体用于细胞成像。'});
	await f.E.corpus.saveEntry(chosen.id, {id: 'off', title: '旁注', text: '显微镜预约改到周四。'});
	await f.E.corpus.saveEntry(elsewhere.id, {id: 'slice', title: '笔记', text: '超导磁体用于组织切片成像。'});
	project.preparationCorpusSelection = {corpusIDs: [chosen.id]};
	assert.deepEqual([...f.E.corpus.eligible(project.id).map(row => row.id)], [chosen.id], 'feasibility and assembly read this corpus');
	let result = await f.E.corpus.importProject(project.id, chosen.id, ['fit', 'off']);
	assert.deepEqual({count: result.count, warnings: result.warnings}, {count: 2, warnings: 1});
	let copies = f.store.manuscripts[project.id].materials;
	assert.equal(copies.find(row => row.corpusEntryID === 'off').scopeWarning, true);
	assert.equal(copies.find(row => row.corpusEntryID === 'fit').scopeWarning, undefined);
	await assert.rejects(f.E.corpus.importProject(project.id, elsewhere.id, ['slice']), /研究领域与项目不同，未导入；项目素材未改动/, 'a corpus the project did not choose is still checked');
	assert.equal(f.store.manuscripts[project.id].materials.length, 2);
});

test('WSB-21: collecting papers that are already in the corpus reports them instead of a bare 0', async () => {
	let f = serviceFixture({library: {[chapter(0).id]: chapter(0)}});
	let corpus = await f.E.corpus.create('自旋');
	await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present}, {added: 0, present: 1});
});

test('CR-4: collect reports the selected rows without the corpus keywords on every return path', async () => {
	let inside = chapter(0, {sourceText: '超导样品的低温输运测量。'});
	let f = serviceFixture({library: {[inside.id]: inside, [chapter(1).id]: chapter(1)}});
	let corpus = await f.E.corpus.create('超导', {primaryKeyword: '超导'});
	let first = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: first.added, present: first.present, outside: first.outside}, {added: 1, present: 0, outside: 1});
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present, outside: again.outside}, {added: 0, present: 1, outside: 1}, 'nothing fresh still counts the rows left out');
	let filtered = serviceFixture({library: {[inside.id]: inside, [chapter(1).id]: chapter(1), [chapter(2).id]: chapter(2, {sectionType: '引言'})}});
	let target = await filtered.E.corpus.create('超导', {primaryKeyword: '超导'});
	let result = await filtered.E.corpus.collect(target.id, {paperIDs: [1], section: '方法'});
	assert.deepEqual({added: result.added, outside: result.outside}, {added: 1, outside: 1}, 'a row the section filter leaves out is not counted as lacking keywords');
});

test('CR-4: rows collected before the corpus got its keywords count as present, not as left out', async () => {
	let inside = chapter(0, {sourceText: '超导样品的低温输运测量。'});
	let f = serviceFixture({library: {[inside.id]: inside, [chapter(1).id]: chapter(1)}});
	let corpus = await f.E.corpus.create('全部');
	assert.equal((await f.E.corpus.collect(corpus.id, {paperIDs: [1]})).added, 2);
	await f.E.corpus.update(corpus.id, {researchScope: {primaryKeyword: '超导'}});
	let again = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: again.added, present: again.present, outside: again.outside}, {added: 0, present: 2, outside: 0});
	f.store.researchMaterials['chapter-2'] = chapter(2);
	f.store.researchMaterials['chapter-3'] = chapter(3, {sourceText: '超导薄膜的临界电流测量。'});
	let mixed = await f.E.corpus.collect(corpus.id, {paperIDs: [1]});
	assert.deepEqual({added: mixed.added, present: mixed.present, outside: mixed.outside}, {added: 1, present: 2, outside: 1}, 'only the new row without the keyword is left out');
	assert.deepEqual([...f.store.corpora[corpus.id].entries.map(row => row.materialID)], ['chapter-0', 'chapter-1', 'chapter-3']);
});
