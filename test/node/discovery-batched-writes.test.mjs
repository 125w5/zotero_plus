/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createStoreBranchWriter, installDiscoveryPDF, verifiedDiscoveryRecords, PDF_CHECK_VERSION} from '../../chrome/content/zotero/research/shared/discovery-pdf.mjs';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as References from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import * as ReferenceMetadata from '../../chrome/content/zotero/research/shared/reference-metadata.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeTimers() {
	let timers = new Map(), serial = 0;
	return {
		setTimeout(fn, delay) {let id = ++serial; timers.set(id, {fn, delay}); return id;},
		clearTimeout(id) {timers.delete(id);},
		get size() {return timers.size;},
		async run() {let due = [...timers.values()]; timers.clear(); for (let timer of due) timer.fn(); await tick(); await tick();}
	};
}
// Counts commits per top-level branch by comparing serialized branches.
// Commits run one at a time, as in the workspace store.
function storeFixture(state = {}) {
	let commits = [], reads = [], queue = Promise.resolve();
	return {state, commits, reads, store: {
		get(...path) {reads.push(path); let value = state; for (let key of path) value = value?.[key]; return value === undefined ? undefined : structuredClone(value);},
		update(fn) {
			let run = queue.then(async () => {let before = new Map(Object.keys(state).map(key => [key, JSON.stringify(state[key])])); await fn(state); commits.push(Object.keys(state).filter(key => before.get(key) !== JSON.stringify(state[key])));});
			queue = run.catch(() => {});
			return run;
		},
		flush: () => queue
	}};
}
const touched = (f, branch) => f.commits.filter(keys => keys.includes(branch)).length;

test('a burst of cache entries becomes one commit, readable before it is written', async () => {
	let f = storeFixture(), clock = fakeTimers(), E = {store: f.store, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};
	let writer = createStoreBranchWriter(E, 'discoveryChinese', {limit: 3});
	for (let n = 0; n < 5; n++) await writer.set('k' + n, {title: 't' + n});
	assert.equal(f.commits.length, 0); assert.equal(writer.pending, 5); assert.equal(writer.get('k4').title, 't4');
	assert.equal(clock.size, 1, 'one trailing timer for the burst');
	await clock.run();
	assert.equal(f.commits.length, 1); assert.deepEqual(Object.keys(f.state.discoveryChinese), ['k2', 'k3', 'k4'], 'the branch keeps its newest entries');
	assert.equal(writer.get('k4').title, 't4');
});

test('a full batch writes at once, a failed write is retried, and no timers means immediate writes', async () => {
	let f = storeFixture(), clock = fakeTimers(), E = {store: f.store, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};
	let writer = createStoreBranchWriter(E, 'referenceMetadata', {maxPending: 3});
	await writer.set('a', 1); await writer.set('b', 2); assert.equal(f.commits.length, 0);
	await writer.set('c', 3); assert.equal(f.commits.length, 1, 'the third entry flushes the batch'); assert.equal(clock.size, 0);
	let update = f.store.update;
	f.store.update = async () => {throw Error('disk full');};
	await writer.set('d', 4); await assert.rejects(writer.flush(), /disk full/);
	assert.equal(writer.get('d'), 4, 'an unwritten entry stays readable');
	f.store.update = update; await writer.flush();
	assert.equal(f.state.referenceMetadata.d, 4);
	let g = storeFixture(), plain = createStoreBranchWriter({store: g.store}, 'discoveryBriefs');
	await plain.set('x', {text: '中文'}); assert.equal(g.commits.length, 1); assert.equal(g.state.discoveryBriefs.x.text, '中文');
});

test('PDF checks write only new probes; a scan answered from the cache commits nothing', async () => {
	let f = storeFixture({discoveryPDFChecks: {}}), E = {store: f.store}, fetches = 0;
	let bytes = new TextEncoder().encode('%PDF-1.7\n' + 'controlled bytes '.repeat(80));
	installDiscoveryPDF(E, {fetch: async () => {fetches++; return {ok: true, status: 200, headers: {get: name => name === 'content-type' ? 'application/pdf' : ''}, body: new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}})};}});
	let rows = [{id: 1, title: 'A', pdf: 'https://repository.example/a.pdf'}, {id: 2, title: 'B', pdf: 'https://repository.example/b.pdf'}];
	await verifiedDiscoveryRecords(E, rows);
	assert.equal(touched(f, 'discoveryPDFChecks'), 1); assert.equal(Object.keys(f.state.discoveryPDFChecks).length, 2);
	assert.equal(f.state.discoveryPDFChecks['https://repository.example/a.pdf'].version, PDF_CHECK_VERSION);
	await verifiedDiscoveryRecords(E, rows);
	assert.equal(fetches, 2); assert.equal(f.commits.length, 1, 'cached probes cause no workspace write');
	await verifiedDiscoveryRecords(E, [...rows, {id: 3, title: 'C', pdf: 'https://repository.example/c.pdf'}]);
	assert.equal(f.commits.length, 2); assert.equal(Object.keys(f.state.discoveryPDFChecks).length, 3);
	let reads = f.reads.filter(path => path[0] === 'discoveryPDFChecks' && path.length === 1).length;
	assert.equal(reads, 0, 'flushing never clones the whole PDF-check branch');
});

test('a search that scans four pages writes PDF checks once, after it settles, and stores no raw scan rows', async () => {
	let f = storeFixture({journalMetricSnapshots: {}}), page = 0, bytes = new TextEncoder().encode('%PDF-1.7\n' + 'controlled bytes '.repeat(80));
	let E = {store: f.store, library: {},
		fetchDiscoveryPDF: async () => ({ok: true, status: 200, headers: {get: name => name === 'content-type' ? 'application/pdf' : ''}, body: new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}})}),
		requestProvider: async () => {page++; return JSON.stringify({results: [0, 1].map(n => ({id: 'https://openalex.org/W' + page + n, title: 'Psychology evidence ' + page + n, abstract_inverted_index: {Measured: [0], abstract: [1]}, best_oa_location: {is_oa: true, pdf_url: 'https://repository.example/' + page + n + '.pdf'}})), meta: {count: 400, next_cursor: 'c' + page}});}};
	Feed.installDiscoveryFeed(E, {Zotero: {getMainWindow: () => ({AbortController}), addShutdownListener() {}}});
	let result = await E.recommendationFeed({mode: 'latest', query: 'psychology', limit: 40, fillPage: true});
	await tick(); await tick();
	assert.equal(page, 4); assert.equal(result.records.length, 8);
	assert.equal(touched(f, 'discoveryPDFChecks'), 1, 'one PDF-check commit for four scans');
	assert.equal(Object.keys(f.state.discoveryPDFChecks).length, 8);
	let saved = Object.values(f.state.discoveryFeeds)[0];
	assert.deepEqual(Object.keys(saved).sort(), ['at', 'result']);
});

test('translated cards and repeated catalog lookups share one commit and are served from memory', async () => {
	let f = storeFixture(), clock = fakeTimers(), translations = 0, requests = 0, shutdown = [];
	let E = {store: f.store, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
		quickTranslate: async text => {translations++; let [title, abstract] = text.split('\nZXQBLOCK0ZXQ\n'); return {text: '中文' + title + (abstract ? '\nZXQBLOCK0ZXQ\n中文摘要' : '')};},
		requestProvider: async () => {requests++; return JSON.stringify({results: [{id: 'https://openalex.org/T10841', display_name: 'Environmental valuation', field: {display_name: 'Economics'}, keywords: ['valuation']}]});}};
	Feed.installDiscoveryFeed(E, {Zotero: {addShutdownListener: fn => shutdown.push(fn)}});
	let rows = Array.from({length: 30}, (_, n) => ({title: 'Measured paper ' + n, abstract: 'Measured abstract ' + n + '.'}));
	let values = await Promise.all(rows.map(row => E.discoveryChinese(row)));
	assert.equal(values[29].title, '中文Measured paper 29'); assert.equal(translations, 30);
	assert.equal(touched(f, 'discoveryChinese'), 0, 'no commit per card');
	assert.equal((await E.discoveryChinese(rows[3])).title, '中文Measured paper 3'); assert.equal(translations, 30, 'an unwritten translation is reused');
	await E.findDiscoveryTopics('environmental'); await E.findDiscoveryTopics('environmental');
	assert.equal(requests, 1); assert.equal(touched(f, 'discoveryTopics'), 0);
	await clock.run();
	assert.equal(touched(f, 'discoveryChinese'), 1); assert.equal(Object.keys(f.state.discoveryChinese).length, 30);
	assert.equal(touched(f, 'discoveryTopics'), 1);
	await E.discoveryChinese({title: 'Late paper', abstract: 'Late abstract.'});
	await Promise.all(shutdown.map(fn => fn()));
	assert.equal(Object.keys(f.state.discoveryChinese).length, 31, 'shutdown writes the pending translation');
});

const metricsSource = await readFile(new URL('../../chrome/content/zotero/xpcom/research/metrics-provider.js', import.meta.url), 'utf8');
test('new journal metrics share one commit and one item-tree refresh, and shutdown writes the rest', async () => {
	let f = storeFixture(), clock = fakeTimers(), refreshes = 0, shutdown = [];
	let R = {store: f.store, metrics: new Map(), credentials: {get: async () => 'controlled-key'}, issn: item => item.issn, refreshTrees: () => refreshes++, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};
	vm.runInNewContext(metricsSource, {Zotero: {Research: R, addShutdownListener: fn => shutdown.push(fn), logError() {}}});
	// easyScholar officialRank.all: sciif, sci quartile, CAS category sciUp and,
	// for a CAS TOP journal only, sciUpTop such as 化学TOP.
	R.readJournalRank = async journal => ({sciif: String(journal.length), sci: 'Q1', sciUp: '化学1区', ...(journal.endsWith('2') ? {sciUpTop: '化学TOP'} : {})});
	let item = n => ({issn: '0000000' + n, isRegularItem: () => true, getField: () => 'Journal ' + n});
	let metrics = await Promise.all([1, 2, 3, 4, 5].map(n => R.ensurePaperMetrics(item(n))));
	assert.ok(metrics.every(metric => metric.impact_factor > 0));
	assert.equal(metrics[1].top_status, 'reported'); assert.equal(metrics[1].cas_top, '化学TOP'); assert.equal(metrics[0].top_status, 'not-top'); assert.equal(metrics[0].metric_year, null);
	assert.equal(f.commits.length, 0, 'no workspace write per journal'); assert.equal(refreshes, 0);
	assert.equal(Object.keys(R.pendingJournalMetrics()).length, 5);
	assert.equal(R.currentMetric(item(3)).impact_factor, 9, 'the item tree reads the new metric from memory');
	await clock.run();
	assert.equal(f.commits.length, 1); assert.equal(Object.keys(f.state.journalMetricSnapshots).length, 5); assert.equal(refreshes, 1);
	assert.equal(Object.keys(R.pendingJournalMetrics()).length, 0);
	await R.ensurePaperMetrics(item(6)); assert.equal(f.commits.length, 1);
	await Promise.all(shutdown.map(fn => fn()));
	assert.equal(f.commits.length, 2); assert.equal(Object.keys(f.state.journalMetricSnapshots).length, 6);
});

const discoverySource = await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js', import.meta.url), 'utf8');
function referenceFixture(count, {hold = Infinity} = {}) {
	let f = storeFixture(), clock = fakeTimers(), shutdown = [], requests = 0, release;
	let bibliography = 'REFERENCES\n' + Array.from({length: count}, (_, n) => '[' + (n + 1) + '] Author' + n + ', "Controlled reference title number ' + n + '", 2019. DOI:10.5555/ref' + n).join('\n');
	let attachment = {id: 2, isPDFAttachment: () => true, getFilePathAsync: async () => '/controlled/reference.pdf'}, item = {id: 1, isPDFAttachment: () => false, getBestAttachment: async () => attachment};
	let gate = new Promise(resolve => release = resolve);
	let E = {library: {uri: () => 'zotero://controlled'}, assets: {key: value => JSON.stringify(value)}, store: f.store, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
		requestProvider: async (url, options) => {
			if (++requests > hold) await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('受控中止')), {once: true}));
			let doi = decodeURIComponent(url.split('/works/')[1]);
			return JSON.stringify({message: {DOI: doi, title: ['Controlled metadata ' + doi]}});
		}};
	let Zotero = {Research: E, Items: {getAsync: async () => item}, PDFWorker: {getFullText: async () => ({text: bibliography})}, Promise: {delay: async () => {}}, getMainWindow: () => ({AbortController, DOMParser: class {parseFromString(text) {return {body: {textContent: text}};}}}), addShutdownListener: fn => shutdown.push(fn), logError() {}};
	let modules = {'workspace-outputs.mjs': WorkspaceOutputs, 'reference-matcher.mjs': References, 'reference-metadata.mjs': ReferenceMetadata, 'discovery-feed.mjs': Feed};
	vm.runInNewContext(discoverySource, {Zotero, ChromeUtils: {importESModule: url => modules[url.split('/').at(-1)]}, IOUtils: {stat: async () => ({size: 1, lastModified: 1})}, AbortController, Promise, Date, Map, Set});
	return {E, f, clock, shutdown, gate, release, get requests() {return requests;}};
}
const metadataCommits = f => f.commits.filter(keys => keys.includes('referenceMetadata')).length;
test('resolving 45 references writes their metadata in batches of 20 plus one final write', async () => {
	let r = referenceFixture(45);
	let result = await r.E.collectReferences({id: 1});
	await tick(); await tick();
	assert.equal(result.references.length, 45); assert.equal(Object.keys(r.f.state.referenceMetadata).length, 45);
	assert.equal(metadataCommits(r.f), 3, 'two full batches and the remainder when the collection settles');
	assert.equal(r.clock.size, 0, 'the settled collection leaves no pending write timer');
	let again = await r.E.collectReferences({id: 1}, {refresh: true});
	assert.equal(again.records.length, 45); assert.equal(r.requests, 45, 'saved metadata is reused');
});
test('a stopped collection keeps the metadata it already resolved', async () => {
	let r = referenceFixture(30, {hold: 5}), controller = new AbortController(), progress = 0;
	let pending = r.E.collectReferences({id: 1}, {signal: controller.signal, onProgress: value => {if ((value.done || 0) >= 5) progress++;}});
	while (r.requests < 6) await tick();
	controller.abort(); await assert.rejects(pending, /已取消/);
	for (let n = 0; n < 6; n++) await tick();
	assert.equal(Object.keys(r.f.state.referenceMetadata || {}).length, 5, 'resolved entries are written on abort; cancelled ones are not cached as failures');
});
test('metadata saved by an older lookup version is looked up again; current metadata is reused', async () => {
	let r = referenceFixture(2);
	await r.E.collectReferences({id: 1});
	await tick(); await tick();
	assert.equal(r.requests, 2);
	let [stale, current] = Object.keys(r.f.state.referenceMetadata);
	// Before the open-access-only PDF rule, a record could keep the publisher's closed PDF.
	r.f.state.referenceMetadata[stale] = {...r.f.state.referenceMetadata[stale], lookupVersion: 'public-reference-2'};
	delete r.f.state.referenceMetadata[current].lookupVersion;
	let again = await r.E.collectReferences({id: 1}, {refresh: true});
	assert.equal(again.records.length, 2);
	assert.equal(r.requests, 4, 'both older entries are fetched again');
	await tick(); await tick();
	assert.ok(Object.values(r.f.state.referenceMetadata).every(entry => entry.lookupVersion === ReferenceMetadata.REFERENCE_LOOKUP_VERSION));
	await r.E.collectReferences({id: 1}, {refresh: true});
	assert.equal(r.requests, 4, 'entries from the current version are reused');
});

test('a journal metric that is not yet written already counts for TOP filtering', () => {
	let f = storeFixture({journalMetricSnapshots: {}});
	// The shape ensurePaperMetrics writes for an easyScholar answer.
	let E = {store: f.store, pendingJournalMetrics: () => ({'12345678': {at: '2026-10-29T08:00:00.000Z', metric: {issn: '12345678', journal: 'Chemical Journal', impact_factor: 9, jcr_quartile: 'Q1', cas_large_category: '化学1区', cas_top: '化学TOP', top_status: 'reported', metric_year: null, source: 'easyScholar 当前返回（年份未标明）', fetched_at: '2026-10-29T08:00:00.000Z'}}})};
	let row = Feed.enrichDiscoveryRecord({title: 'A', issn: '1234-5678', pdf: 'https://repository.example/a.pdf'}, E);
	assert.equal(row.metrics.top, true); assert.equal(row.metrics.topStatus, 'reported'); assert.equal(row.metrics.impactFactor, 9);
	assert.equal(Feed.applyDiscoveryFilters([row], {topOnly: true}).length, 1);
});
