/* SPDX-License-Identifier: AGPL-3.0-or-later */
// H7: a commit that only adds Chinese 说明 updates the visible cards in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionOnlyChange, refreshMaterialDescriptions } from '../../chrome/content/zotero/research/shared/material-description-refresh.mjs';

// The card shape materialDisplay draws in summary mode.
let node = (className, text = '') => ({ className, textContent: text, title: '', attributes: new Map(), getAttribute(name) { return this.attributes.get(name) ?? null; }, setAttribute(name, value) { this.attributes.set(name, String(value)); } });
let card = (id, name, summary, display = 'summary') => {
	let host = node('material-display'), heading = node('material-heading', name), excerpt = node('material-excerpt', summary);
	excerpt.title = summary;
	host.dataset = { material: id, display };
	host.setAttribute('title', [name, summary, '来源论文'].join('\n'));
	host.setAttribute('aria-label', name + '，方法，' + summary);
	host.querySelector = selector => (selector === '.material-heading' ? heading : selector === '.material-excerpt' ? excerpt : null);
	return host;
};
let listOf = cards => ({ querySelectorAll: () => cards });
let E = (titles, summaries) => ({ manuscripts: { titleFor: m => titles[m.id], summaryFor: m => summaries[m.id] }, renderContent: (target, text) => { target.textContent = text; } });

test('only a materialDescriptions commit counts as a description-only change', () => {
	assert.equal(descriptionOnlyChange(new Set(['materialDescriptions'])), true);
	for (let branches of [new Set(), new Set(['materialDescriptions', 'manuscripts']), new Set(['*']), undefined]) assert.equal(descriptionOnlyChange(branches), false);
});

test('new 说明 reach the visible cards in place; an unusual card or the selected material asks for a full render', () => {
	let a = card('a', 'Method', 'Original English text.'), b = card('b', '方法 · 对照', '已有中文说明。'), list = listOf([a, b]);
	let materials = { a: { id: 'a' }, b: { id: 'b' } }, env = E({ a: '方法 · 独立批次', b: '方法 · 对照' }, { a: '比较独立批次的识别差异。', b: '已有中文说明。' });
	assert.equal(refreshMaterialDescriptions(list, id => materials[id], { E: env }), true);
	let heading = a.querySelector('.material-heading'), excerpt = a.querySelector('.material-excerpt');
	assert.deepEqual([heading.textContent, excerpt.textContent, excerpt.title], ['方法 · 独立批次', '比较独立批次的识别差异。', '比较独立批次的识别差异。']);
	assert.equal(a.getAttribute('title'), '方法 · 独立批次\n比较独立批次的识别差异。\n来源论文', 'the tooltip follows');
	assert.equal(a.getAttribute('aria-label'), '方法 · 独立批次，方法，比较独立批次的识别差异。');
	assert.equal(b.querySelector('.material-heading').textContent, '方法 · 对照', 'an unchanged card is left alone');
	let selected = card('a', 'Method', 'Old.');
	assert.equal(refreshMaterialDescriptions(listOf([selected]), id => materials[id], { E: env, selectedID: 'a' }), false, 'the selected material also changes its detail pane');
	assert.equal(selected.querySelector('.material-heading').textContent, 'Method', 'nothing is patched when a full render follows');
	assert.equal(refreshMaterialDescriptions(listOf([card('a', 'x', 'y', 'source')]), id => materials[id], { E: env }), false, 'the 题目 · 分类 view renders in full');
	assert.equal(refreshMaterialDescriptions(listOf([card('gone', 'x', 'y')]), id => materials[id], { E: env }), false, 'an unknown card renders in full');
	assert.equal(refreshMaterialDescriptions(listOf([]), id => materials[id], { E: env }), false);
	assert.equal(refreshMaterialDescriptions(null, id => materials[id], { E: env }), false);
});

test('both library pages try the in-place update before a full render, and stop listening on pagehide', async () => {
	let { readFile } = await import('node:fs/promises'), read = path => readFile(new URL('../../chrome/content/zotero/research/' + path, import.meta.url), 'utf8');
	let [main, notebook] = await Promise.all([read('manuscript/main.mjs'), read('notebook.mjs')]);
	assert.match(main, /descriptionOnlyChange\(branches\)&&U\.p\.ui\.left==='materials'&&!U\.materialQuery&&refreshMaterialDescriptions\(\$\('material-results'\)/);
	assert.match(main, /if\(!inPlace\)renderLibrary\(\)/);
	assert.match(main, /U\.unsubscribeAssetBranches\?\.\(\)/);
	// One shared view per burst: N.state clones the whole notebook entry.
	assert.match(notebook, /descriptionOnlyChange\(branches\)\)\{const view=\(N\.stateView\|\|N\.state\)\(id\);if\(view\.view!=='plan'&&!N\.query\(id\)\)/);
	assert.match(notebook, /refreshMaterialDescriptions\(\$\('source-list'\),materialID=>byID\.get\(materialID\),\{E,selectedID:view\.selectedMaterial\}\)\)return;\}\}selectedRendered=null;scheduleRender\(\);/);
	assert.match(notebook, /assetBranchSubscription\?\.\(\);/);
});
