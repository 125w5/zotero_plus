/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Material labels name the paper and read numbering one way, so the outline
// no longer shows four identical 引言 · 1. Introduction rows. Display only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as sections from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as language from '../../chrome/content/zotero/research/shared/material-language.mjs';

const code = await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-index.js', import.meta.url), 'utf8');
let item = (fields, extra = {}) => ({deleted: false, getField: name => fields[name] ?? '', ...extra});
function load(items = new Map(), {zotero = true} = {}) {
	let E = {manuscripts: {model: {}}, assets: {key: values => JSON.stringify(values)}, store: {get: () => undefined, update: async () => {}}};
	let Zotero = {Research: E, logError: () => {}, getMainWindow: () => ({AbortController}), addShutdownListener: () => {}, ...(zotero ? {Items: {get: id => items.get(id) || false}} : {})};
	vm.runInNewContext(code, {Zotero, ChromeUtils: {importESModule: uri => (uri.includes('article-section-materials') ? sections : language)}});
	return E.manuscripts;
}
let section = (paperItemID, heading, extra = {}) => ({id: 'section-' + paperItemID + '-' + heading, revision: 1, kind: 'semantic', sectionType: '引言', section: heading, title: heading, paperItemID, paperTitle: 'Task-aware transmission for camera IoT networks', sourceText: 'Original.', ...extra});

test('chapters of different papers get different labels; repeated numbering reads the same; stored data stays as it was', () => {
	let A = load(new Map([[101, item({firstCreator: 'Smith et al.', date: '2021-03-04 March 4, 2021', title: 'Camera IoT'})], [202, item({firstCreator: '张三', date: '2019', title: '另一篇'})]]));
	let a = section(101, '1. Introduction'), b = section(101, '1 Introduction'), c = section(202, '1. Introduction');
	let before = JSON.stringify([a, b, c]);
	assert.equal(A.titleFor(a), '引言 · 1 Introduction · Smith et al. 2021');
	assert.equal(A.titleFor(b), A.titleFor(a), '1. and 1 are one chapter of one paper');
	assert.equal(A.titleFor(c), '引言 · 1 Introduction · 张三 2019');
	assert.notEqual(A.titleFor(c), A.titleFor(a), 'the paper reference tells the two Introductions apart');
	assert.equal(JSON.stringify([a, b, c]), before, 'titles, sections and summaries are not rewritten');
});

test('numbering variants normalize for display without touching unnumbered or technical headings', () => {
	let A = load(new Map([[101, item({firstCreator: 'Smith', date: '2021'})]]));
	let label = heading => A.titleFor(section(101, heading));
	assert.equal(label('1.Introduction'), '引言 · 1 Introduction · Smith 2021');
	assert.equal(label('2.1. Setup'), '引言 · 2.1 Setup · Smith 2021');
	assert.equal(label('IV. RESULTS'), '引言 · IV RESULTS · Smith 2021');
	assert.equal(label('3D Reconstruction'), '引言 · 3D Reconstruction · Smith 2021');
	assert.equal(label('LC filter design'), '引言 · LC filter design · Smith 2021');
	assert.equal(label('V. Discussion'), '引言 · V Discussion · Smith 2021');
	for (let heading of ['A. Proofs', 'B. Datasets', 'C. Experimental details', 'D. Ablations', 'C. elegans models', 'L. monocytogenes growth']) {
		assert.equal(label(heading), '引言 · ' + heading + ' · Smith 2021', 'appendix letters and abbreviations keep their period: ' + heading);
	}
	assert.equal(A.titleFor(section(101, '引言')), '引言 · Smith 2021', 'a heading equal to its type is not repeated');
	assert.equal(A.titleFor(section(101, '未识别章节')), '引言 · Smith 2021');
});

test('without a loaded Zotero item the saved paper title is clipped as the reference; no paper means no reference', () => {
	let missing = load(new Map());
	assert.equal(missing.titleFor(section(999, '1. Introduction')), '引言 · 1 Introduction · Task-aware transmission…');
	assert.equal(missing.titleFor(section(999, '1. Introduction', {paperTitle: 'Learning robust representations for modulation recognition'})), '引言 · 1 Introduction · Learning robust…', 'a Latin title is cut at a word');
	let unloaded = load(new Map([[101, item({}, {getField() {throw Error('Item data not loaded');}})]]));
	assert.equal(unloaded.titleFor(section(101, '1. Introduction')), '引言 · 1 Introduction · Task-aware transmission…', 'an unloaded item falls back instead of throwing');
	let deleted = load(new Map([[101, item({firstCreator: 'Smith', date: '2021'}, {deleted: true})]]));
	assert.match(deleted.titleFor(section(101, '1 Introduction')), /Task-aware transmission…$/u, 'a deleted item is not used');
	let noZotero = load(new Map(), {zotero: false});
	assert.equal(noZotero.titleFor(section(0, '1. Introduction', {paperTitle: ''})), '引言 · 1 Introduction');
	let long = load(new Map([[101, item({firstCreator: 'Smith', date: '2021'})]]));
	let longLabel = long.titleFor(section(101, '1. ' + 'Very long heading words '.repeat(5)));
	assert.ok(longLabel.length <= 60 && longLabel.endsWith(' · Smith 2021'), 'the reference survives the 60-character cut of 有待填写的内容');
});

test('a long first author is clipped and the heading takes the room left, so the year survives both caller cuts', () => {
	let A = load(new Map([[1, item({firstCreator: 'International Organization for Standardization', date: '2020'})], [2, item({firstCreator: 'Krizhevsky and Hinton', date: '2012'})], [3, item({firstCreator: 'Krizhevsky and Hinton', date: '2017'})]]));
	let heading = '2. Related work on task-aware transmission for camera IoT networks';
	let label = id => A.titleFor({id: 's' + id, revision: 1, kind: 'semantic', sectionType: '相关工作', section: heading, title: heading, paperItemID: id, sourceText: 'x'});
	assert.equal(label(1), '相关工作 · 2 Related work on task-aware… · International… 2020');
	assert.equal(label(2), '相关工作 · 2 Related work on… · Krizhevsky and Hinton 2012');
	for (let id of [1, 2, 3]) {
		// The outline keeps 70 characters and 有待填写的内容 keeps 60.
		assert.match(label(id).slice(0, 60), /(?:2020|2012|2017)$/u, 'the year is inside the cut');
	}
	assert.notEqual(label(2).slice(0, 60), label(3).slice(0, 60), 'two papers by the same authors stay apart after the cut');
});

test('a user-chosen title is shown as written; generic passage labels gain the paper reference', () => {
	let A = load(new Map([[101, item({firstCreator: 'Smith', date: '2021'})]]));
	assert.equal(A.titleFor(section(101, '1. Introduction', {userEdited: true, title: '我的引言素材'})), '我的引言素材');
	assert.equal(A.titleFor({id: 'passage-1', revision: 1, title: 'Passage', paperItemID: 101, sourceText: 'x'}), '论文原文素材 · Smith 2021');
	assert.equal(A.titleFor({id: 'm-1', revision: 1, title: 'English only', paperItemID: 101, sourceText: 'x'}), '文献素材 · Smith 2021');
	assert.equal(A.titleFor({id: 'm-2', revision: 1, title: '中文素材标题', paperItemID: 101, sourceText: 'x'}), '中文素材标题', 'a readable Chinese title is kept');
	assert.equal(A.titleFor({id: 'm-3', revision: 1, title: 'note', sourceText: 'x'}), '文献素材');
});
