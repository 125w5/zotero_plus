/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {JOURNAL_FORMATS, JOURNAL_FORMAT_SCOPE, journalFormat} from '../../chrome/content/zotero/research/shared/journal-formats.mjs';

test('every journal preset says it sets citation and layout only, not submission compliance', () => {
	assert.match(JOURNAL_FORMAT_SCOPE, /仅设置引文与版式/);
	assert.match(JOURNAL_FORMAT_SCOPE, /不保证符合具体期刊投稿要求/);
	for (let format of JOURNAL_FORMATS) assert.ok(format.description.endsWith(JOURNAL_FORMAT_SCOPE), format.id);
	assert.match(journalFormat('ieee').description, /^双栏、顺序编码引用；/);
	assert.equal(journalFormat('ieee').label, 'IEEE 会议双栏稿');
});
