/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The reader image-evidence row (xpcom/research/asset-reader.js and
// research/reader-image-evidence.css): opening the complete explanation hides
// the brief summary, so the same text never shows twice, and a keyboard user
// who opened it from the summary keeps focus on the explanation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css = await readFile(new URL('../../chrome/content/zotero/research/reader-image-evidence.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/asset-reader.js', import.meta.url), 'utf8');
let specificity = selector => [/#[\w-]+/g, /\.[\w-]+|\[[^\]]+\]/g, /(?:^|\s)[a-z][\w-]*/gi].map(pattern => (selector.match(pattern) || []).length);
let rule = selector => css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1];

test('a hidden brief summary is not forced back into view by the row display rule', () => {
	let shown = '#easysch-asset-panel .asset-evidence-row .asset-summary-trigger', hidden = shown + '[hidden]';
	assert.match(rule(shown), /display:block!important/, 'the summary button keeps its block layout when shown');
	assert.match(rule(hidden) || '', /display:none!important/, 'the hidden summary is removed from the layout');
	let [a, b] = [specificity(hidden), specificity(shown)], order = a.map((value, index) => value - b[index]).find(Boolean);
	assert.ok(order > 0, 'the hidden rule outranks the forced display');
});

test('expanding from a focused summary moves focus to the explanation; other expansions leave focus alone', () => {
	let line = source.split('\n').map(row => row.trim()).find(row => row.startsWith('card.setExplanationExpanded='));
	assert.ok(line, 'setExplanationExpanded is defined on one line');
	let setup = (activeName) => {
		let doc = {activeElement: null}, card = {dataset: {expanded: 'true'}, toggleExpanded() {}, refreshExplanation() {}};
		let brief = {name: 'brief', hidden: false, attributes: {}, setAttribute(key, value) {this.attributes[key] = value;}, focus() {doc.activeElement = brief;}};
		let full = {name: 'full', hidden: true, focus() {doc.activeElement = full;}}, other = {name: 'other'};
		doc.activeElement = {brief, other}[activeName];
		new Function('card', 'brief', 'full', 'doc', 'disposed', 'explanationRevision', line)(card, brief, full, doc, false, undefined);
		return {doc, card, brief, full, other};
	};
	let keyboard = setup('brief');
	keyboard.card.setExplanationExpanded(true);
	assert.equal(keyboard.brief.hidden, true); assert.equal(keyboard.full.hidden, false);
	assert.equal(keyboard.doc.activeElement, keyboard.full, 'focus follows the summary into the explanation');
	let elsewhere = setup('other');
	elsewhere.card.setExplanationExpanded(true);
	assert.equal(elsewhere.doc.activeElement, elsewhere.other, 'an expansion started elsewhere does not steal focus');
	keyboard.card.setExplanationExpanded(false);
	assert.equal(keyboard.brief.hidden, false, 'returning shows the summary again');
});
