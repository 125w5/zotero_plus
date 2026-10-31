/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A library card renamed in the details pane keeps showing the typed title
// after many later 说明 edits: editAsset keeps the last 30 history rows, and
// the row that records the old title must stay among them (A.titleFor reads
// the rename from history).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, asset, key} from './assembly-details-harness.mjs';

const stub = f => {
	f.E.studio.request = async (prompt, input) => input?.materials
		? {value: {summaries: input.materials.map(x => ({id: x.id, title: '标定装置示意图', text: '说明标定装置与靶板的布置方式。'}))}, model: 'stub'}
		: {value: {title: '标定装置示意图', text: '说明标定装置与靶板的布置方式。'}, model: 'stub'};
};

test('a renamed library card keeps its typed Latin title after 40 说明 saves', async () => {
	let f = await fixture({assets: [asset('m1', 7), asset('lib1', 9, {title: 'Figure 2. Calibration setup', summary: '说明标定装置与靶板的布置。'})], project: ['m1']});
	stub(f);
	f.show('lib1');
	await f.flush();
	let {input} = f.open('lib1');
	input.value = 'Camera rig';
	input.onkeydown(key('Enter'));
	await f.flush();
	await f.flush();
	assert.equal(f.A.titleFor(f.stored('lib1')), 'Camera rig');
	for (let i = 1; i <= 40; i++) {
		let saving = f.explanations.at(-1).options.onSave({summary: '第 ' + i + ' 次改写的说明。'});
		await f.flush();
		await saving;
		await f.flush();
	}
	let row = f.stored('lib1');
	assert.ok(row.history.length <= 30, 'history stays capped');
	assert.ok(row.history.some(entry => entry.title === 'Figure 2. Calibration setup'), 'the row with the old title is kept');
	assert.equal(f.A.titleFor(row), 'Camera rig');
	assert.deepEqual(f.failures, []);
});
