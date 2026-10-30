/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { streamPreview } from '../../chrome/content/zotero/research/shared/stream-preview.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { installRapidReading } from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';
import { rapidReadingEditKey } from '../../chrome/content/zotero/research/shared/rapid-reading-data.mjs';

let prefixes = (text, step) => {
	let out = [];
	for (let end = step; end <= text.length; end += step) out.push(text.slice(0, end));
	return out;
};

test('a streamed reply shows its label and tail at most once per step of new text (AI-03)', () => {
	let shown = [], live = streamPreview(value => shown.push(value), { step: 10, tail: 8 });
	let reply = '本章说明独立批次对照的设计与已有依据，并列出仍待补齐的跨设备数据和图表。';
	for (let text of prefixes(reply, 4)) live(text, '正在整理');
	assert.ok(shown.length >= 2 && shown.length <= Math.ceil(reply.length / 10), 'throttled to one line per 10 new characters');
	for (let line of shown) assert.match(line, /^正在整理…/);
	assert.equal(shown.at(-1).length, '正在整理…'.length + 8, 'only the tail of the text is shown');
	assert.ok(reply.includes(shown.at(-1).slice('正在整理…'.length)), 'the tail is the reply text itself');
	let count = shown.length;
	live('', '正在整理');
	live('   \n  ', '正在整理');
	assert.equal(shown.length, count, 'empty text shows nothing');
});

test('a format repair or a retry that streams from the start again restarts the preview instead of freezing it', () => {
	let shown = [], live = streamPreview(value => shown.push(value), { step: 10, tail: 30 });
	let first = '第一次回复的文字很长，已经超过了好几个步长，因此会显示若干次进度。';
	for (let text of prefixes(first, 5)) live(text, '正在生成候选');
	let before = shown.length;
	// S.request sends '' before a format repair; the retry then streams from the start.
	live('', '正在生成候选');
	let second = '重新开始的回复';
	live(second + '，继续写到足够长度。', '正在生成候选');
	assert.equal(shown.length, before + 1, 'the shorter restarted reply is shown at once');
	assert.match(shown.at(-1), /重新开始的回复/);
	live('另一章的回复已经写到足够长度。', '正在整理《方法》速读');
	assert.match(shown.at(-1), /^正在整理《方法》速读…另一章/, 'a new label restarts the preview');
	assert.equal(Thread.streamPreview, streamPreview, 'research-thread re-exports the same helper');
});

test('the reader rapid read streams its first brief and a selection answer into the caller status, and saves only the validated reply', async () => {
	let state = {}, calls = [], statuses = [];
	// Briefs run 40-120 characters; the preview starts after the first 40.
	let brief = '本文在受控条件下比较三种互补评分，说明每种评分适用的明确前提，并指出这些前提在独立数据上仍需复核的部分。', answer = '这一段说明三种评分的适用条件：每种评分只在其明确前提成立时使用，不能互相替代，也不能把一种评分的结论直接推广到另一种。';
	let source = 'The paper reports three complementary scores with explicit conditions.';
	let paper = { id: 7, getField: name => name === 'title' ? 'Local evidence paper' : '' }, attachment = { id: 13, parentItem: paper, isPDFAttachment: () => true, dateModified: 'fixed' };
	let request = async (system, input, status, signal, options) => {
		calls.push({ input, options });
		let value = input.evidenceExcerpts ? { sections: [{ role: 'method', heading: '条件与评分', brief: { text: brief, quoteIDs: [input.evidenceExcerpts[0].quoteID] }, points: [{ text: 'A controlled explanation of the three scores.', quoteIDs: [input.evidenceExcerpts[0].quoteID] }] }] } : { text: answer };
		let json = JSON.stringify(value), streamed = value.text || value.sections[0].brief.text;
		// The real S.request passes json-stream partialText of the reply so far.
		for (let end = 6; end <= streamed.length; end += 6) options.onText(streamed.slice(0, end));
		assert.ok(json.length > streamed.length);
		return { value, model: options.modelConfig.model, at: 'controlled' };
	};
	let E = { store: { get: (branch, key) => branch ? key === undefined ? state[branch] : state[branch]?.[key] : state, update: async fn => fn(state) }, settings: () => ({ endpoint: 'https://configured.invalid/v1', model: 'configured-default' }), core: { endpoint: value => value.replace(/\/+$/u, '') }, workbenchConversations: { getForScope: () => ({ modelID: 'reading-model', thinkingLevel: 'off' }), getActive: () => ({}) }, assets: { key: value => JSON.stringify(value), fileSignature: async () => 'pdf-v1', index: async () => ({ pdfHash: 'pdf-v1', assets: [] }) }, library: { describe: () => ({ id: 13 }), sources: async () => ({ sources: [{ id: 'page-1', attachmentID: 13, pageIndex: 0, label: 'Page 1', text: source }], warnings: [] }) }, studio: { request }, setTimeout, clearTimeout };
	let Zotero = { getMainWindow: () => ({ AbortController }), Items: { getAsync: async () => attachment }, addShutdownListener() {}, logError() {} };
	installRapidReading(E, { Zotero });
	let local = await E.prepareReaderRapidReading(13, { status: value => statuses.push(value) });
	assert.equal(typeof calls[0].options.onText, 'function');
	let live = statuses.filter(value => value.startsWith('正在整理速读…'));
	assert.ok(live.length >= 1, 'the brief streams into the reader status');
	for (let line of live) assert.ok(brief.includes(line.slice('正在整理速读…'.length)), 'only reply text, never JSON syntax');
	assert.equal(local.record.sections[0].points[0].text, 'A controlled explanation of the three scores.', 'the saved reading is the validated reply');
	let section = local.record.sections[0], point = section.points[0], pointKey = E.assets.key(rapidReadingEditKey(section, 0, point, 0)), answered = [];
	let result = await E.requestReaderRapidReadingSelection({ local, pointKey, summaryText: point.text, text: point.text, mode: 'explain', status: value => answered.push(value) });
	assert.equal(result, answer);
	assert.ok(answered.some(value => value.startsWith('正在解释…')), 'the selection answer streams into the caller status');
	E.stopRapidReadingPreparation();
});

test('every selection-assistant model call forwards a live preview to its progress line (AI-03)', async () => {
	let source = await readFile(new URL('../../chrome/content/zotero/research/manuscript/selection-assistant.mjs', import.meta.url), 'utf8');
	for (let call of ['previewReadSelection(U.p.id,{target:captured,mode:\'rewrite\'', 'previewSelection(U.p.id,{target:captured,instruction', 'previewReadSelection(U.p.id,{target:captured,mode:\'explain\'']) {
		let start = source.indexOf(call), end = source.indexOf('});', start);
		assert.ok(start >= 0, call);
		assert.match(source.slice(start, end), /onText:text=>live\(text,'正在[^']+'\)/, call + ' passes onText');
	}
	assert.equal((source.match(/live=streamPreview\(/g) || []).length, 3);
});
