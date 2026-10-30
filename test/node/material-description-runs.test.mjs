/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as sections from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as language from '../../chrome/content/zotero/research/shared/material-language.mjs';

const code = await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-index.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({timers = false} = {}) {
	let data = {}, writes = 0, requests = [], shutdown = [], queued = new Map(), delays = new Map(), serial = 0;
	let E = {manuscripts: {model: {}}, assets: {key: values => values.join('|')},
		store: {get: (...path) => path.reduce((value, key) => value?.[key], data), update: async fn => {writes++; await fn(data);}},
		studio: {request: (_system, input, _status, signal) => new Promise((resolve, reject) => {
			let request = {input, signal, resolve: () => resolve({model: 'controlled', value: {summaries: input.materials.map(m => ({id: m.id, title: '基线评估', text: '独立数据用于评估基线。'}))}}), fail: message => reject(Error(message))};
			requests.push(request);
			signal?.addEventListener('abort', () => reject(Object.assign(Error('已取消'), {name: 'AbortError'})), {once: true});
		})}};
	if (timers) {E.setTimeout = (fn, delay) => {let id = ++serial; queued.set(id, fn); delays.set(id, delay); return id;}; E.clearTimeout = id => {queued.delete(id); delays.delete(id);};}
	vm.runInNewContext(code, {Zotero: {Research: E, logError: () => {}, getMainWindow: () => ({AbortController}), addShutdownListener: fn => shutdown.push(fn)}, ChromeUtils: {importESModule: uri => uri.includes('article-section-materials') ? sections : language}});
	return {A: E.manuscripts, data, requests, shutdown, queued, delays, get writes() {return writes;}};
}
const cards = (count, prefix = 'c') => Array.from({length: count}, (_, n) => ({id: prefix + n, revision: 1, title: 'English material ' + n, sourceText: 'A baseline is tested on held-out data.'}));
// Bounded, so a regression fails instead of hanging the suite.
async function requested(f, count) {for (let n = 0; f.requests.length < count; n++) {if (n > 200) throw Error('expected ' + count + ' model requests, saw ' + f.requests.length); await tick();}}
async function answer(f, count) {for (let n = 0; n < count; n++) {await requested(f, n + 1); f.requests[n].resolve(); await tick();}}

test('without the application timers each finished batch is written at once', async () => {
	let f = setup(), rows = cards(12);
	let run = f.A.ensureChineseSummaries(rows);
	await answer(f, 1); await requested(f, 2);
	assert.equal(f.writes, 1); assert.equal(Object.keys(f.data.materialDescriptions).length, 4);
	await answer(f, 3); await run;
	assert.equal(f.writes, 3); assert.equal(Object.keys(f.data.materialDescriptions).length, 12);
});

test('finished batches are readable at once and written together within 2 s, not only when the run ends', async () => {
	let f = setup({timers: true}), rows = cards(12);
	let run = f.A.ensureChineseSummaries(rows);
	await answer(f, 1); await requested(f, 2);
	assert.equal(f.writes, 0, 'no write per batch');
	assert.equal(f.A.summaryFor(rows[0]), '独立数据用于评估基线。', 'a finished batch is readable from memory');
	assert.equal(f.A.summaryReader()(rows[1]), '独立数据用于评估基线。');
	let deadline = [...f.delays].find(([, delay]) => delay === 2000)?.[0];
	assert.ok(deadline, 'the first unwritten batch arms a 2 s write deadline');
	let fn = f.queued.get(deadline); f.queued.delete(deadline); f.delays.delete(deadline); fn();
	assert.equal(f.writes, 1, 'a long run is written while it is still running'); assert.equal(Object.keys(f.data.materialDescriptions).length, 4);
	await answer(f, 3); await run;
	assert.equal(f.writes, 2, 'the batches finished after the deadline are written once, when the run ends');
	assert.equal(Object.keys(f.data.materialDescriptions).length, 12);
	assert.equal([...f.delays.values()].includes(2000), false, 'no write deadline stays armed after the run');
});

test('stopping a run keeps the finished batch, writes once, and leaves the rest retryable', async () => {
	let f = setup(), rows = cards(12), controller = new AbortController();
	let run = f.A.ensureChineseSummaries(rows, {retry: true, signal: controller.signal});
	await answer(f, 1);
	await requested(f, 2);
	controller.abort();
	assert.equal(f.requests[1].signal.aborted, true, 'the running model request is cancelled');
	await run;
	assert.equal(f.writes, 1); assert.equal(Object.keys(f.data.materialDescriptions).length, 4);
	assert.ok(Object.values(f.data.materialDescriptions).every(row => row.summaryZh && !row.summaryZhError), 'no failure is recorded for stopped cards');
	assert.equal(f.requests.length, 2, 'the third batch never starts');
	let retry = f.A.ensureChineseSummaries(rows.slice(4));
	await answer(f, 4); await retry;
	assert.equal(Object.keys(f.data.materialDescriptions).length, 12, 'stopped cards are described by a later run');
});

test('bursts of asset notifications reach listeners once, after the burst', async () => {
	let f = setup({timers: true}), calls = 0;
	f.A.onAssetsChanged(() => calls++);
	for (let n = 0; n < 10; n++) f.A.notifyAssetsChanged();
	let fire = () => {let due = [...f.queued.values()]; f.queued.clear(); for (let fn of due) fn();};
	assert.equal(calls, 0); assert.equal(f.queued.size, 1, 'one trailing timer');
	fire();
	assert.equal(calls, 1, 'the final notification is delivered');
	let run = f.A.ensureChineseSummaries(cards(8));
	await answer(f, 2); await run;
	assert.equal(calls, 1); assert.equal(f.queued.size, 1);
	fire();
	assert.equal(calls, 2, 'two summary batches notify once');
});

test('shutdown stops description runs and writes their finished batches', async () => {
	let f = setup({timers: true}), rows = cards(8);
	let run = f.A.ensureChineseSummaries(rows);
	await answer(f, 1); await requested(f, 2);
	assert.equal(f.writes, 0, 'the finished batch waits for its write deadline');
	await Promise.all(f.shutdown.map(fn => fn()));
	assert.equal(Object.keys(f.data.materialDescriptions).length, 4);
	assert.equal(f.requests[1].signal.aborted, true);
	await run;
	assert.equal(Object.keys(f.data.materialDescriptions).length, 4);
	assert.equal([...f.delays.values()].includes(2000), false);
});

test('stopping one run settles at once while another run’s request is still answering, and its cards stay retryable', async () => {
	let f = setup(), rows = cards(20), controller = new AbortController(), settled = false;
	let background = f.A.ensureChineseSummaries(rows.slice(0, 12));
	await requested(f, 1);
	let stopped = f.A.ensureChineseSummaries(rows, {retry: true, signal: controller.signal}).then(() => {settled = true;});
	for (let n = 0; n < 5; n++) await tick();
	controller.abort();
	for (let n = 0; n < 5; n++) await tick();
	assert.equal(settled, true, 'the stopped call does not wait for the other run');
	assert.equal(f.requests.length, 1, 'the stopped run sent no request');
	let later = f.A.ensureChineseSummaries(rows.slice(12));
	await answer(f, 5); await Promise.all([background, stopped, later]);
	assert.equal(f.requests.length, 5, 'its queued batches skip their request');
	assert.deepEqual(f.requests.slice(3).flatMap(r => r.input.materials.map(m => m.id.split('|')[0])), rows.slice(12).map(m => m.id), 'a later pass describes the stopped cards');
	assert.equal(Object.keys(f.data.materialDescriptions).length, 20);
});

test('a stop after the run has finished leaves its failures attempted', async () => {
	let f = setup(), rows = cards(4), controller = new AbortController();
	let run = f.A.ensureChineseSummaries(rows, {retry: true, signal: controller.signal});
	await requested(f, 1);
	f.requests[0].fail('HTTP 503'); await run;
	assert.match(f.A.summaryFor(rows[0]), /暂未完成/);
	controller.abort();
	await f.A.ensureChineseSummaries(rows);
	assert.equal(f.requests.length, 1, 'a background pass does not retry the failure by itself');
	let retry = f.A.ensureChineseSummaries(rows, {retry: true});
	await answer(f, 2); await retry;
	assert.equal(f.A.summaryFor(rows[0]), '独立数据用于评估基线。');
});

test('a stopped run’s queued batch never releases cards that a newer run is describing', async () => {
	let f = setup(), rows = cards(12), controller = new AbortController();
	let background = f.A.ensureChineseSummaries(rows.slice(0, 4));
	await requested(f, 1);
	let stopped = f.A.ensureChineseSummaries(rows, {retry: true, signal: controller.signal});
	for (let n = 0; n < 5; n++) await tick();
	controller.abort();
	for (let n = 0; n < 5; n++) await tick();
	let newer = f.A.ensureChineseSummaries(rows.slice(4), {retry: true});
	await answer(f, 2); await requested(f, 3);
	let again = f.A.ensureChineseSummaries(rows.slice(8), {retry: true});
	await answer(f, 3);
	for (let n = 0; n < 5; n++) await tick();
	assert.equal(f.requests.length, 3, 'cards the newer run is describing are not requested twice');
	await Promise.all([background, stopped, newer, again]);
	assert.equal(Object.keys(f.data.materialDescriptions).length, 12);
});
