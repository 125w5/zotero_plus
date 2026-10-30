/* SPDX-License-Identifier: AGPL-3.0-or-later */
// F25: a 速读 edit is written only while the stored edit is the one the pane
// read, so two reader panes never overwrite each other silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRapidReadEdit } from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';

test('the store mutator refuses an edit made against an older stored edit', () => {
	let state = {}, first = { originalText: 'AI', text: '甲窗口', origin: 'manual', editedAt: 't1' }, second = { originalText: 'AI', text: '乙窗口', origin: 'manual', editedAt: 't2' };
	applyRapidReadEdit(state, 'paper', 'p1', first, null);
	assert.equal(state.rapidReadEdits.paper.points.p1.text, '甲窗口');
	assert.throws(() => applyRapidReadEdit(state, 'paper', 'p1', second, null), error => error.code === 'RAPID_EDIT_CONFLICT' && /其他窗口/.test(error.message), 'a pane that still saw no edit is refused');
	assert.equal(state.rapidReadEdits.paper.points.p1.text, '甲窗口', 'the other pane edit stays');
	applyRapidReadEdit(state, 'paper', 'p1', second, first);
	assert.equal(state.rapidReadEdits.paper.points.p1.text, '乙窗口');
	applyRapidReadEdit(state, 'paper', 'p1', null, second);
	assert.equal(state.rapidReadEdits.paper, undefined, '恢复 AI 解析 removes the edit and the empty entry');
});
