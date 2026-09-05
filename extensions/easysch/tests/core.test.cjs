const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const E = load('core', 'storage', 'ai');

test('API URLs reject credential leakage and remote plaintext, accept local models', () => {
	for (const url of ['http://remote.example/v1', 'https://secret:pass@example.com/v1', 'https://example.com/v1?key=secret', 'file:///etc/passwd']) {
		assert.throws(() => E.core.endpoint(url));
	}
	assert.equal(E.core.endpoint('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
	assert.equal(E.core.endpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1');
});
test('AI source IDs must refer to actual evidence, translation requires questions', () => {
	const raw = { sections: [{ heading: 'Method', body: 'Verified text', sources: ['P1-S'] }], questions: ['Why?', 'How?'] };
	assert.equal(E.core.validateResult(JSON.stringify(raw), [{ id: 'P1-S' }], 'translate').sections.length, 1);
	assert.throws(() => E.core.validateResult(JSON.stringify(raw), [{ id: 'P2-S' }], 'analyze'), /不存在/);
	assert.throws(() => E.core.validateResult(JSON.stringify({ ...raw, questions: [] }), [{ id: 'P1-S' }], 'translate'), /两个/);
	assert.throws(() => E.core.validateResult('<script>evil</script>', [], 'analyze'), /JSON/);
});
test('storage serializes concurrent edits, separates library keys and survives failed writes', async () => {
	let disk, fail = false;
	const store = E.createStore({ read: async () => null, write: async data => { if (fail) throw Error('disk full'); disk = JSON.parse(JSON.stringify(data)); } });
	await store.init();
	await Promise.all([store.update(s => { s.papers['1:ABCD'] = { records: ['one'] }; }), store.update(s => { s.papers['2:ABCD'] = { records: ['two'] }; })]);
	assert.equal(Object.keys(disk.papers).length, 2);
	fail = true; await assert.rejects(store.update(s => { s.papers = {}; }), /disk full/);
	assert.equal(Object.keys(store.get().papers).length, 2);
	fail = false; await store.update(s => { s.settings.model = 'local'; });
	assert.equal(store.get().settings.model, 'local');
});
test('corrupt and future data are not replaced', async () => {
	const store = E.createStore({ read: async () => ({ version: 99 }), write: async () => assert.fail('must not write') });
	await assert.rejects(store.init(), /版本/);
});
test('knowledge graph only derives observed tag and relation edges', () => {
	const graph = E.core.graph([
		{ id: 1, key: 'A', tags: ['biology'], related: [] },
		{ id: 2, key: 'B', tags: ['biology'], related: [] },
		{ id: 3, key: 'C', tags: ['physics'], related: [] }
	]);
	assert.equal(graph.edges.length, 1); assert.equal(graph.edges[0].label, 'biology');
});
test('journal draft checks preserve code and escaped dollars, flag unknown citations', () => {
	assert.equal(E.core.lint('An equation $x=2$ and `literal $` plus \\$5 [@ES1_ABC].', ['ES1_ABC']).length, 0);
	assert.equal(E.core.lint('Incomplete $x and [@unknown]', []).length, 2);
	assert.throws(() => E.core.task('test', '2025-02-29'));
	assert.equal(E.core.task('test', '2024-02-29').due, '2024-02-29');
});
test('Pandoc uses argv, supports native math/citations and per-format templates', () => {
	const config = { input: 'C:/space name/source.md', output: 'C:/out.docx', format: 'docx', bibliography: 'C:/refs.json',
		csl: 'C:/IEEE.csl', referenceDoc: 'C:/reference.docx', latexTemplate: 'C:/a.tex', resourcePath: 'C:/space name' };
	const args = E.core.pandocArgs(config);
	assert.ok(args.includes('--reference-doc')); assert.ok(!args.includes('--template'));
	assert.equal(args.at(-1), config.input); assert.ok(args.includes('--citeproc'));
	assert.throws(() => E.core.pandocArgs({ ...config, format: 'exe' }));
});
test('HTML used for Zotero notes escapes active content', () => {
	assert.equal(E.core.escapeHTML('<img onerror="evil()">'), '&lt;img onerror=&quot;evil()&quot;&gt;');
});

async function aiFixture(fetch) {
	const store = E.createStore({ read: async () => null, write: async () => {} }); await store.init();
	const ai = E.createAI({ fetch, controller: () => new AbortController(), settings: () => ({ endpoint: 'https://model.test/v1', model: 'test', language: 'Chinese', template: 'test' }),
		credential: async () => 'private-token', store, collect: async () => ({ sources: [{ id: 'P1-M', text: 'paper evidence', uri: 'zotero://select/library/items/ABC' }], warnings: [] }) });
	return { ai, store };
}
test('AI saves validated results, keeps credentials out of memory and prevents redirects', async () => {
	const { ai, store } = await aiFixture(async (url, options) => {
		assert.equal(url, 'https://model.test/v1/chat/completions'); assert.equal(options.redirect, 'error');
		assert.equal(options.headers.Authorization, 'Bearer private-token');
		return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ sections: [{ heading: 'test', body: 'answer', sources: ['P1-M'] }] }) } }] }) };
	});
	await ai.run({ mode: 'analyze', papers: [{ libraryID: 1, key: 'ABC', title: 'test' }] });
	assert.equal(store.get().papers['1:ABC'].records.length, 1);
	assert.ok(!JSON.stringify(store.get()).includes('private-token'));
});
test('HTTP errors do not persist fabricated analysis', async () => {
	const { ai, store } = await aiFixture(async () => ({ ok: false, status: 401 }));
	await assert.rejects(ai.run({ mode: 'analyze', papers: [{ libraryID: 1, key: 'ABC' }] }), /HTTP 401/);
	assert.equal(Object.keys(store.get().papers).length, 0);
});
test('cancellation stops the request and never saves partial output', async () => {
	let started;
	const ready = new Promise(resolve => { started = resolve; });
	const { ai, store } = await aiFixture(async (_, options) => { started(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('abort')))); });
	const request = ai.run({ mode: 'analyze', papers: [{ libraryID: 1, key: 'ABC' }] });
	await ready; ai.cancel(); await assert.rejects(request, /取消/);
	assert.equal(Object.keys(store.get().papers).length, 0);
});
