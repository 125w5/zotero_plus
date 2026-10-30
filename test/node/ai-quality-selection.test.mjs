/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A PDF selection carries the paper metadata and same-page/adjacent context,
// read through the shared frozen store view. Controlled data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('a selection adds metadata and nearby paragraphs within a budget, reading the store view', async () => {
	const pdf = { id: 13, key: 'PDF', libraryID: 1, parentID: 7, attachmentContentType: 'application/pdf', isPDFAttachment: () => true, isAttachment: () => true };
	const parent = { id: 7, key: 'PARENT', libraryID: 1, isPDFAttachment: () => false, getField: name => (name === 'abstractNote' ? '论文研究跨域调制识别。' : name === 'title' ? '来源论文' : '') };
	const paragraphs = [{ sourceText: '式(3)中 h_t 表示隐藏状态。', pageIndex: 4 }, { sourceText: '当前选段：L = Σ_t h_t。', pageIndex: 4 }, { sourceText: '相邻页给出假设。', pageIndex: 5 }, { sourceText: '远处页面不相关。', pageIndex: 9 }];
	const reads = [], state = { manuscriptIndex: { 13: { documentKey: 'doc' } }, manuscriptDocuments: { doc: { paragraphs } } };
	const E = { core: { paperKey: () => 'paper' }, store: { peek: (...path) => {
		reads.push(path); return path.reduce((value, key) => value?.[key], state);
	}, get() {
		throw Error('a selection read must not clone cached documents');
	} } };
	const Zotero = { Items: { getAsync: async id => (id === 13 ? pdf : parent) }, Libraries: { get: () => ({ libraryType: 'user' }) } };
	vm.runInNewContext(fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/zotero.js', import.meta.url), 'utf8'), { EasySch: E, Zotero, IOUtils: { exists: async () => true } });
	const result = await E.library.sources([{ id: 7, title: '来源论文', authors: 'A. Author' }], { text: '当前选段：L = Σ_t h_t。', attachmentID: 13, pageIndex: 4 });
	assert.deepEqual(JSON.parse(JSON.stringify(result.sources.map(row => row.id))), ['P1-S', 'P1-M', 'P1-C1', 'P1-C2'], 'selection first, then metadata and same/adjacent page context');
	assert.match(result.sources[1].text, /跨域调制识别/);
	assert.equal(result.sources[2].text, '式(3)中 h_t 表示隐藏状态。'); assert.equal(result.sources[3].pageIndex, 5);
	assert.ok(!result.sources.some(row => /远处页面/.test(row.text)), 'distant pages stay out');
	assert.equal(result.sources.filter(row => row.text.includes('Σ_t h_t')).length, 1, 'the selection is not repeated as context');
	assert.deepEqual(JSON.parse(JSON.stringify(reads)), [['manuscriptIndex', '13'], ['manuscriptDocuments', 'doc']]);
});
