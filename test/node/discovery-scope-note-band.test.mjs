/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The discovery card (research/ui/discovery.js): the scope note lives on the
// option band as one ellipsized line, so it never adds or removes a row, and
// its title carries the full note. The collapsed journal filter names the
// chosen journal in its title, since long journal names are clipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../../chrome/content/zotero/research/ui/discovery.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../chrome/content/zotero/research/discovery-unified.css', import.meta.url), 'utf8');
function load() {
	let ui = {};
	vm.runInNewContext(script, {EasySchUI: ui, AbortController, document: {querySelector: () => null}, window: {}, setTimeout, clearTimeout});
	return ui;
}
let field = (value = '') => ({value, title: '', textContent: '', checked: true, hidden: false, attributes: {}, setAttribute(key, next) {this.attributes[key] = next;}, focus() {}});

test('every scope note write also sets the title to the full note', async () => {
	let ui = load(), state = {settings: {}};
	Object.assign(ui, {discoveryScopeNote: field(), collectionStatus: field(), discoveryRetryButton: field(), discoveryScopeReady: Promise.resolve(), discoveryDomain: field('physics'), discoveryPrimary: field('AccMPEG'), discoverySecondary: field(), discoveryAcronym: field(), discoveryFuzzy: field(), collectionJournalType: field('top'), collectionJournal: field('S1'), collectionSort: field('date'), discoveryYears: field('5'), discoveryYearFrom: field(), discoveryYearTo: field(), $: () => field('openalex'), E: {store: {update: async fn => fn(state)}}, updateDiscoveryPaging() {}});
	ui.setDiscoveryScopeNote('这个缩写有多种含义，请选择研究领域或填写完整含义后再搜索。');
	assert.equal(ui.discoveryScopeNote.title, ui.discoveryScopeNote.textContent);
	await ui.resetDiscoveryFilters({keepKeywords: true});
	assert.match(ui.discoveryScopeNote.textContent, /^已取消研究领域、来源、期刊类别、指定期刊和年份限制/);
	assert.equal(ui.discoveryScopeNote.title, ui.discoveryScopeNote.textContent, 'a truncated reset note stays readable on hover');
	await ui.resetDiscoveryFilters();
	assert.equal(ui.discoveryScopeNote.textContent, '');
	assert.equal(ui.discoveryScopeNote.title, '', 'a cleared note leaves no stale tooltip');
	let writes = [...script.matchAll(/discoveryScopeNote\.textContent=/g)];
	assert.equal(writes.length, 1, 'only setDiscoveryScopeNote writes the note text');
});

test('the scope note is placed on the option band and only takes its free width', () => {
	assert.match(script, /meaningRow\.prepend\(this\.discoveryScopeNote\)/);
	assert.doesNotMatch(script, /hero\.append\(this\.discoveryScopeNote\)/, 'the note no longer opens its own row under the band');
	let rule = css.match(/\.discovery-scope-options>\.discovery-scope-note\{([^}]*)\}/)?.[1] || '';
	for (let declaration of ['flex:1 1 0', 'min-width:0', 'white-space:nowrap', 'text-overflow:ellipsis']) assert.ok(rule.includes(declaration), declaration);
	assert.doesNotMatch(css, /#view-search\.discovery-unified \.discovery-scope-note:empty\{display:none\}/, 'an empty note keeps the band unchanged instead of collapsing a row');
});

test('the collapsed journal filter names the chosen journal and ends in an ellipsis', () => {
	let ui = load(), name = 'Journal of the American Chemical Society: Controlled Methods';
	ui.collectionJournal = {value: 'S9', title: '', options: [{value: '', textContent: '全部期刊'}, {value: 'S9', textContent: name}]};
	ui.syncDiscoveryJournalTitle();
	assert.equal(ui.collectionJournal.title, name);
	ui.collectionJournal.value = '';
	ui.syncDiscoveryJournalTitle();
	assert.equal(ui.collectionJournal.title, '', 'all journals needs no tooltip');
	assert.match(script, /field\.dataset\.active=String\([^;]*\);this\.syncDiscoveryJournalTitle\(\);\}/, 'every control-state sync refreshes the journal title');
	assert.match(css, /\.discovery-feed-filters select\{flex:1 1 100px;[^}]*text-overflow:ellipsis\}/);
});
