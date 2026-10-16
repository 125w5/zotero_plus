import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMaterialClues, materialAnchors} from '../../../chrome/content/zotero/research/shared/material-clues.mjs';

const anchor = (pageIndex, rect = [10, 20, 30, 40], sourceText = 'Original excerpt.') => ({
	paperItemID: 12, attachmentID: 24, pageIndex, position: {pageIndex, rects: [rect]}, sourceText,
});
const card = (id, extra = {}) => ({id, kind: 'semantic', title: '方法素材', summary: '方法的中文概括。', sourceVersion: 'file-v1', ...extra});

test('combines all recorded anchor formats without dropping separate same-page locations', () => {
	const first = anchor(2), other = anchor(2, [50, 20, 70, 40]);
	const material = card('m1', {anchors: [first, other], sourceAnchors: [first], anchor: first});
	const before = JSON.stringify(material), result = buildMaterialClues([material]);
	assert.equal(result.papers.length, 1);
	assert.equal(result.papers[0].pages.length, 1);
	assert.equal(result.papers[0].pages[0].excerpts.length, 2);
	assert.equal(result.excerptCount, 2);
	assert.equal(JSON.stringify(material), before);
});

test('deduplicates identical anchors across materials while preserving stable associations', () => {
	const result = buildMaterialClues([card('a', {anchor: anchor(0)}), card('b', {anchor: anchor(0)})]);
	const clue = result.papers[0].pages[0].excerpts[0];
	assert.deepEqual(clue.materialIDs, ['a', 'b']);
	assert.equal(result.materialCount, 2);
	assert.equal(result.excerptCount, 1);
	assert.equal('relation' in clue, false);
});

test('keeps distinct files and source versions separate and sorts pages numerically', () => {
	const result = buildMaterialClues([card('ten', {anchor: anchor(10)}), card('two', {anchor: anchor(2)}),
		card('version', {sourceVersion: 'file-v2', anchor: anchor(2)}),
		card('attachment', {anchor: {...anchor(2), attachmentID: 25}})]);
	assert.equal(result.papers[0].pages.length, 4);
	assert.deepEqual(result.papers[0].pages.map(page => page.pageIndex), [2, 2, 2, 10]);
});

test('does not present ideas, illustrations or local data as PDF evidence', () => {
	const result = buildMaterialClues([card('idea', {kind: 'idea', anchor: anchor(0)}),
		card('illustration', {sourceType: 'ai-illustration', anchor: anchor(0)}),
		card('data', {kind: 'experiment', data: {rows: [['模型', '准确率']]}, anchor: {sourceText: '实验记录'}})]);
	assert.equal(result.papers.length, 0);
	assert.deepEqual(result.other.map(value => value.kind), ['idea', 'idea', 'data']);
});

test('retains abstract coverage, unknown page and unresolved metadata without inventing details', () => {
	const material = card('abstract', {kind: 'abstract', paperItemID: 12, sourceText: 'Abstract only.'});
	const result = buildMaterialClues([material], {sourceInfo: () => ({title: 'Actual paper title', metric: null})});
	const paper = result.papers[0], page = paper.pages[0];
	assert.equal(paper.title, 'Actual paper title');
	assert.equal(paper.metric, null);
	assert.equal(page.pageIndex, null);
	assert.equal(page.excerpts[0].coverage, '仅依据摘要');
});

test('retains externally retrieved abstract boundaries and its URL without labeling it a user note', () => {
	const material = card('external-abstract', {kind: 'abstract', title: 'Retrieved paper',
		anchor: {url: 'https://arxiv.org/abs/2401.00001', sourceText: 'Only the retrieved abstract.'}});
	const before = JSON.stringify(material), result = buildMaterialClues([material]);
	assert.equal(result.papers.length, 0);
	assert.equal(result.other.length, 1);
	const source = result.other[0];
	assert.equal(source.kind, 'abstract');
	assert.equal(source.label, '仅依据摘要');
	assert.equal(source.anchors[0].url, material.anchor.url);
	assert.equal(source.anchors[0].sourceText, material.anchor.sourceText);
	assert.equal(source.anchors[0].attachmentID, null);
	assert.equal(JSON.stringify(material), before);
});

test('keeps a URL-only source as external material rather than inventing a local user note', () => {
	const result = buildMaterialClues([card('web-source', {anchor: {url: 'https://example.org/paper', sourceText: 'Retrieved page text.'}})]);
	assert.equal(result.other[0].kind, 'external');
	assert.equal(result.other[0].anchors[0].url, 'https://example.org/paper');
	assert.match(result.other[0].label, /未保存 PDF 原文/);
});

test('paper-linked personal notes are labeled separately and never counted as paper quotations', () => {
	const note = card('personal-note', {kind: 'note', sourceItemID: 90, anchor: anchor(2)});
	const result = buildMaterialClues([note]);
	const clue = result.papers[0].pages[0].excerpts[0];
	assert.equal(clue.kind, 'note');
	assert.equal(clue.coverage, '用户笔记，非论文原句');
	assert.equal(clue.materials[0].sourceItemID, 90);
	assert.deepEqual(clue.anchor.position, note.anchor.position);
	assert.equal(result.excerptCount, 0);
});

test('identical words do not merge a personal note, an abstract and a paper quotation', () => {
	const result = buildMaterialClues([card('quote', {anchor: anchor(2)}),
		card('note', {kind: 'note', anchor: anchor(2)}), card('abstract', {kind: 'abstract', anchor: anchor(2)})]);
	const excerpts = result.papers[0].pages[0].excerpts;
	assert.equal(excerpts.length, 3);
	assert.deepEqual(excerpts.map(clue => clue.kind), ['excerpt', 'note', 'abstract']);
	assert.deepEqual(excerpts.map(clue => clue.materialIDs), [['quote'], ['note'], ['abstract']]);
	assert.equal(result.excerptCount, 2);
});

test('anchor-specific paper metadata wins over the primary material paper', () => {
	const result = buildMaterialClues([card('multi', {paperItemID: 12, anchors: [anchor(0), {...anchor(3), paperItemID: 50, attachmentID: 100}]})],
		{sourceInfo: material => ({title: '论文 ' + material.paperItemID})});
	assert.deepEqual(result.papers.map(value => value.title), ['论文 12', '论文 50']);
	assert.deepEqual(result.papers.map(value => value.paperItemID), [12, 50]);
});

test('position page index is used only when an explicit page is missing', () => {
	const result = materialAnchors(card('m', {anchor: {attachmentID: 24, position: {pageIndex: 7, rects: [[1, 2, 3, 4]]}, sourceText: 'text'}}));
	assert.equal(result[0].pageIndex, 7);
	assert.equal(materialAnchors(card('m', {anchor: {...anchor(0), position: {pageIndex: 7}}}))[0].pageIndex, 0);
});
