/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function messages(locale) {
	let text = (await readFile(new URL('../../chrome/locale/' + locale + '/zotero/easysch.ftl', import.meta.url), 'utf8')).replace(/\r/g, '');
	let map = new Map(), current = null;
	for (let line of text.split('\n')) {
		let id = line.match(/^([a-z][\w-]*)\s*=/);
		if (id) {current = id[1]; map.set(current, []); continue;}
		let attribute = line.match(/^\s+\.([\w-]+)\s*=/);
		if (attribute && current) map.get(current).push(attribute[1]);
	}
	return map;
}

test('both locales define every EasySch message with the same attributes', async () => {
	let zh = await messages('zh-CN'), en = await messages('en-US');
	assert.deepEqual([...en.keys()].sort(), [...zh.keys()].sort());
	for (let [id, attributes] of zh) assert.deepEqual(en.get(id), attributes, id);
	for (let id of ['easysch-paper-overview', 'easysch-image-evidence', 'easysch-paper-references']) assert.deepEqual(en.get(id), ['label', 'tooltiptext'], id);
});

test('the acronym field is labelled as the full meaning in both locales', async () => {
	let zh = await readFile(new URL('../../chrome/locale/zh-CN/zotero/easysch.ftl', import.meta.url), 'utf8');
	let en = await readFile(new URL('../../chrome/locale/en-US/zotero/easysch.ftl', import.meta.url), 'utf8');
	assert.match(zh, /discovery-refinement-input =\r?\n {4}\.aria-label = 缩写完整含义\r?\n/);
	assert.match(en, /discovery-refinement-input =\r?\n {4}\.aria-label = Full acronym meaning\r?\n/);
	assert.doesNotMatch(zh + en, /排除词\r?\n {4}\.placeholder = 例如|excluded terms\r?\n {4}\.placeholder = For example/);
});
