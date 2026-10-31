/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The corpus page (research/research-resources.mjs): a collapsed corpus card
// previews 180 characters. A cut preview ends in … (without a dangling
// punctuation mark before it), a short entry stays exact, and collapsing an
// expanded card restores the same marked preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture, loadPage} from './corpus-gap-harness.mjs';

let longText = '引言中的完整论证保留研究背景、问题和适用条件。'.repeat(12);
let periodCut = '完整方法：' + '完整来源上下文。'.repeat(400);

async function page() {
	let f = serviceFixture();
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: [
		{id: 'long', title: '完整方法说明', section: '引言', text: longText},
		{id: 'period', title: '批次 0', section: '方法', text: periodCut},
		{id: 'short', title: '短句', section: '结论', text: '  简短结论，\n  无需截断。 '}
	]};
	let loaded = await loadPage(f.E);
	let card = title => loaded.$('entries').querySelectorAll('article').find(node => node.querySelector('strong')?.textContent === title);
	return {...loaded, card, summary: title => card(title).querySelector('summary')};
}

test('a collapsed corpus preview that is cut ends in an ellipsis', async () => {
	let p = await page();
	let long = p.summary('完整方法说明').textContent;
	assert.ok(long.endsWith('…'), 'the cut preview is marked');
	assert.equal(long, longText.slice(0, 180) + '…');
	let period = p.summary('批次 0').textContent;
	assert.ok(period.endsWith('上下文…'), 'a cut that lands after punctuation does not show 。…');
	assert.equal(p.summary('短句').textContent, '简短结论， 无需截断。', 'an entry within the limit is shown whole and unmarked');
});

test('collapsing an expanded corpus card restores the marked preview', async () => {
	let p = await page();
	let details = p.card('完整方法说明').querySelector('details'), summary = details.querySelector('summary');
	details.open = true; details.ontoggle();
	assert.equal(summary.textContent, '完整语料');
	assert.equal(details.querySelector('p').textContent, longText, 'the expanded card shows the full entry');
	details.open = false; details.ontoggle();
	assert.equal(summary.textContent, longText.slice(0, 180) + '…');
});
