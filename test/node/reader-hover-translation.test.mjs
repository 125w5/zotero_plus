/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-tools.js', import.meta.url), 'utf8');
function load(quickTranslate) {
	let E = {quickTranslate};
	vm.runInNewContext(source, {Zotero: {Research: E}, ChromeUtils: {importESModule: path => path.endsWith('reader-rapid-reading.mjs') ? {installRapidReading() {}} : {}}});
	return E;
}

test('hovering a highlight uses machine translation only and never writes the workspace', async () => {
	let calls = [];
	let E = load(async (text, signal, options) => {calls.push({text, signal, options}); return {text: '译文 ' + text, provider: 'Azure'};});
	let controller = new AbortController();
	assert.equal((await E.hoverTranslation('Measured baseline.', controller.signal)).text, '译文 Measured baseline.');
	assert.equal(calls[0].options.allowModelFallback, false, 'no paid model fallback');
	assert.equal(calls[0].options.persist, false, 'no workspace write per hover');
	assert.equal(calls[0].signal, controller.signal, 'leaving the highlight can cancel the request');
	for (let n = 0; n < 5; n++) await E.hoverTranslation('Measured baseline.');
	assert.equal(calls.length, 1, 'repeat hovers reuse the in-memory result');
});

test('an unavailable translator is not cached, and the hover cache stays bounded', async () => {
	let calls = 0, fail = true;
	let E = load(async text => {calls++; if (fail) throw Error('机器翻译暂不可用'); return {text: 'zh:' + text};});
	await assert.rejects(E.hoverTranslation('Retry me.'), /不可用/);
	fail = false; assert.equal((await E.hoverTranslation('Retry me.')).text, 'zh:Retry me.'); assert.equal(calls, 2);
	for (let n = 0; n < 205; n++) await E.hoverTranslation('Sentence ' + n);
	calls = 0; await E.hoverTranslation('Retry me.');
	assert.equal(calls, 1, 'the oldest entry is evicted after 200 newer ones');
});

test('the hover tooltip routes through the cancellable machine-only helper', () => {
	let start = source.indexOf('E.attachReaderInteractions='), end = source.indexOf('\n }', source.indexOf('doc.addEventListener(\'pointermove\'', start));
	let hover = source.slice(start, end);
	assert.ok(start > 0 && end > start);
	assert.doesNotMatch(hover, /E\.quickTranslate\(a\.text\)/);
	assert.match(hover, /E\.hoverTranslation\(a\.text,controller\.signal\)/);
});
