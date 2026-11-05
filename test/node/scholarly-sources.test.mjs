/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Scholarly API requests carry each service's key, the polite-pool contact email and a
// User-Agent; keys come from the login manager and never reach an unrelated URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/scholarly-sources.js', import.meta.url), 'utf8');
function load({keys = {}, contact = ''} = {}) {
	let saved = new Map(Object.entries(keys).map(([id, key]) => ['easysch-scholarly:' + id, key])), now = 0;
	let E = {
		credentials: {get: async realm => saved.get(realm) || '', set: async (realm, key) => { if (key) saved.set(realm, key); else saved.delete(realm); }},
		store: {peek: (...path) => path.join('.') === 'settings.scholarlyContact' ? contact : undefined},
		setTimeout: (fn) => { fn(); return 0; }
	};
	vm.runInNewContext(source, {EasySch: E, URL, Promise, Date: {now: () => now}, ChromeUtils: {}});
	return {E, saved};
}

test('each service gets its key in the way that service expects', async () => {
	let {E} = load({keys: {openalex: 'oa-key', semantic: 's2-key', core: 'core-key', 'springer-meta': 'meta-key', 'springer-oa': 'oa2-key'}, contact: 'me@example.org'});
	let openalex = await E.scholarly.prepare('https://api.openalex.org/works?search=cnn');
	assert.match(openalex.url, /api_key=oa-key/);
	assert.match(openalex.url, /mailto=me%40example.org/);
	assert.equal(openalex.redirect, 'follow', 'a key in the URL is not resent to another host by a redirect');
	let s2 = await E.scholarly.prepare('https://api.semanticscholar.org/graph/v1/paper/search?query=cnn');
	assert.equal(s2.options.headers['x-api-key'], 's2-key');
	assert.equal(s2.redirect, 'error', 'a key in a header never follows a redirect');
	let core = await E.scholarly.prepare('https://api.core.ac.uk/v3/search/works?q=cnn');
	assert.equal(core.options.headers.Authorization, 'Bearer core-key');
	assert.ok(core.url.startsWith('https://api.core.ac.uk/v3/search/works/?q=cnn'), 'CORE redirects the path without a slash, which a header key may not follow');
	assert.match((await E.scholarly.prepare('https://api.springernature.com/meta/v2/json?q=cnn')).url, /api_key=meta-key/);
	assert.match((await E.scholarly.prepare('https://api.springernature.com/openaccess/json?q=cnn')).url, /api_key=oa2-key/);
	let crossref = await E.scholarly.prepare('https://api.crossref.org/works?query=cnn');
	assert.match(crossref.url, /mailto=me%40example.org/);
	assert.match(crossref.options.headers['User-Agent'], /mailto:me@example\.org/);
});

test('other hosts are untouched and a missing key or email adds nothing', async () => {
	let {E} = load();
	assert.equal(await E.scholarly.prepare('https://api.deepseek.com/chat/completions'), null, 'model and translation requests are not changed');
	assert.equal(await E.scholarly.prepare('not a url'), null);
	let openalex = await E.scholarly.prepare('https://api.openalex.org/works?search=cnn');
	assert.doesNotMatch(openalex.url, /api_key|mailto/);
	assert.equal(openalex.options.headers['x-api-key'], undefined);
});

test('saving replaces a key, an empty value removes it, and the state never returns a key', async () => {
	let {E, saved} = load({keys: {openalex: 'old'}});
	await E.scholarly.save('openalex', '  new-key ');
	assert.equal(saved.get('easysch-scholarly:openalex'), 'new-key');
	assert.match((await E.scholarly.prepare('https://api.openalex.org/works?search=x')).url, /api_key=new-key/);
	let state = await E.scholarly.state();
	assert.equal(JSON.stringify(state.find(row => row.id === 'openalex')), JSON.stringify({id: 'openalex', label: 'OpenAlex', saved: true}));
	assert.ok(!JSON.stringify(state).includes('new-key'));
	await E.scholarly.save('openalex', '');
	assert.equal(await E.scholarly.has('openalex'), false);
	await assert.rejects(E.scholarly.save('crossref', 'x'), /未知的文献数据源/, 'services without a key cannot store one');
});
