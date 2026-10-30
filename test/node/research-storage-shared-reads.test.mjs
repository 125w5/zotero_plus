/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js', import.meta.url), 'utf8');
const load = (context = {}) => {
	let E = {};
	vm.runInNewContext(source, {EasySch: E, ...context});
	return E;
};
// Values created inside the vm context have that context's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const counting = () => {
	let calls = [];
	return {calls, JSON: {parse: JSON.parse, stringify(value, ...args) { calls.push(value); return JSON.stringify(value, ...args); }}};
};

test('shared reads return one frozen committed value, while get() keeps detached copies', async () => {
	let E = load(), writes = [];
	let store = E.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {}, researchMaterials: {m1: {id: 'm1', anchors: [{page: 1}]}, m2: {id: 'm2', anchors: []}}}), write: async next => writes.push(next)});
	await store.init();
	let first = store.peek('researchMaterials');
	assert.equal(store.peek('researchMaterials'), first, 'repeated reads share the committed value');
	assert.ok(Object.isFrozen(first) && Object.isFrozen(first.m1) && Object.isFrozen(first.m1.anchors[0]));
	assert.throws(() => { first.m1.title = 'changed'; }, TypeError);
	let copy = store.get('researchMaterials');
	copy.m1.title = 'local';
	assert.equal(store.peek('researchMaterials', 'm1').title, undefined);
	assert.equal(store.peek('researchMaterials', 'absent', 'deeper'), undefined);
	assert.equal(store.peek('version'), 1);
	await store.update(s => { s.researchMaterials.m2.anchors.push({page: 2}); });
	let after = store.peek('researchMaterials');
	assert.notEqual(after, first);
	assert.equal(after.m1, first.m1, 'unchanged entries keep their shared identity');
	assert.equal(after.m2.anchors[0].page, 2);
	assert.ok(Object.isFrozen(after.m2.anchors));
	assert.equal(first.m2.anchors.length, 0, 'an earlier shared read never changes');
	assert.equal(writes.length, 1);
});

test('transactions over frozen shared data support native array and object edits', async () => {
	let E = load();
	let store = E.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {rows: [{id: 'a', n: 1}, {id: 'b', n: 2}], nested: {x: 1}}}), write: async () => {}});
	await store.init();
	store.peek('settings');
	await store.update(s => {
		assert.deepEqual(Object.keys(s.settings.rows), ['0', '1'], 'enumerating a frozen array draft is allowed');
		assert.deepEqual({...s.settings.nested}, {x: 1});
		assert.equal(JSON.stringify(s.settings.rows), '[{"id":"a","n":1},{"id":"b","n":2}]');
		s.settings.rows.sort((a, b) => b.n - a.n);
		s.settings.rows.push({id: 'c', n: 3});
		s.settings.rows.splice(0, 1);
		s.settings.rows[0].n = 9;
		delete s.settings.nested.x;
		s.settings.nested.y = 2;
		assert.deepEqual([...s.settings.rows].map(row => row.id), ['a', 'c']);
	});
	assert.deepEqual(plain(store.get('settings')), {rows: [{id: 'a', n: 9}, {id: 'c', n: 3}], nested: {y: 2}});
	assert.ok(Object.isFrozen(store.peek('settings', 'rows', 1)));
});

test('idle freezing works in bounded slices and leaves the branch writable through transactions', async () => {
	let E = load();
	let store = E.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {}, researchMaterials: {a: {x: [1]}, b: {x: [2]}, c: {x: [3]}}}), write: async () => {}});
	await store.init();
	let ticks = 0;
	assert.equal(store.freezeIdle('researchMaterials', () => ++ticks > 2), false);
	assert.equal(store.freezeIdle('researchMaterials', () => false), true);
	assert.equal(store.freezeIdle('absent', () => false), true);
	await store.update(s => { s.researchMaterials.b.x.push(4); });
	assert.deepEqual(plain(store.get('researchMaterials', 'b', 'x')), [2, 4]);
});

test('the workspace serializer matches JSON.stringify and re-encodes only changed entries', () => {
	let {calls, JSON: json} = counting(), E = load({JSON: json});
	let serializer = E.createWorkspaceSerializer();
	let data = {version: 1, settings: {model: '模型', empty: {}, list: [1, {a: null}], skip: undefined}, papers: {'10': {t: '十'}, '2': {t: '二'}, b: {t: 'b'}}, text: '中文 ', none: null, removed: undefined, empty: {}};
	assert.equal(serializer.serialize(data), JSON.stringify(data));
	calls.length = 0;
	let next = {...data, papers: {...data.papers, b: {t: 'changed'}}};
	assert.equal(serializer.serialize(next), JSON.stringify(next));
	assert.ok(calls.includes(next.papers.b), 'the changed entry is encoded');
	assert.ok(!calls.includes(data.papers['2']) && !calls.includes(data.settings.list), 'unchanged entries reuse their pieces');
	let fewer = {...next};
	delete fewer.text;
	delete fewer.papers;
	assert.equal(serializer.serialize(fewer), JSON.stringify(fewer));
	let restored = {...fewer, papers: next.papers};
	assert.equal(serializer.serialize(restored), JSON.stringify(restored));
});

test('UTF-8 pieces assemble the same document as the text serializer', () => {
	let E = load(), encoder = new TextEncoder();
	let serializer = E.createWorkspaceSerializer({encode: text => encoder.encode(text), join: parts => Buffer.concat(parts)});
	let data = {version: 1, papers: {one: {text: '缓存完整论文 ∑ 𝛼'.repeat(50)}}, settings: {model: 'chosen'}, list: ['a', {b: [1, 2]}]};
	assert.equal(new TextDecoder().decode(serializer.serialize(data)), JSON.stringify(data));
	let next = {...data, settings: {model: '新的'}};
	assert.equal(new TextDecoder().decode(serializer.serialize(next)), JSON.stringify(next));
});

test('priming encodes in deadline-bounded slices and never replaces a record from a pending write', () => {
	let {calls, JSON: json} = counting(), E = load({JSON: json});
	let serializer = E.createWorkspaceSerializer();
	let data = {big: Object.fromEntries(Array.from({length: 50}, (_, i) => ['k' + i, {i}]))}, ticks = 0;
	assert.equal(serializer.prime(data, () => ++ticks > 10), false);
	let primed = calls.filter(value => value && typeof value === 'object').length;
	assert.ok(primed > 0 && primed < 50);
	calls.length = 0;
	assert.equal(serializer.serialize(data), JSON.stringify(data));
	assert.equal(calls.filter(value => value && typeof value === 'object').length, 50 - primed, 'the write completes only the remaining entries');
	let pending = E.createWorkspaceSerializer(), committed = {a: {x: {v: 1}}}, written = {a: {x: {v: 2}}};
	pending.serialize(written);
	assert.equal(pending.prime(committed, () => false), true);
	calls.length = 0;
	assert.equal(pending.serialize(written), JSON.stringify(written));
	assert.equal(calls.length, 0, 'the pending record is reused');
});

test('native storage writes cached UTF-8 bytes atomically when an encoder is available', async () => {
	let initial = {version: 1, papers: {one: {text: '已生成内容'.repeat(2000)}}, projects: {}, settings: {model: 'old'}}, writes = [];
	let E = load({TextEncoder, Zotero: {DataDirectory: {dir: '/isolated'}}, PathUtils: {join: (...parts) => parts.join('/')}, IOUtils: {
		makeDirectory: async () => {}, exists: async () => true, readUTF8: async () => JSON.stringify(initial),
		write: async (path, bytes, options) => { writes.push({path, bytes, options}); },
		writeUTF8: async () => { throw Error('the text path must not be used'); },
	}});
	await E.initStorage();
	await E.store.update(s => { s.settings.model = '新'; });
	await E.store.update(s => { s.papers.two = {text: '第二篇'}; });
	assert.equal(writes.length, 2);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(writes[1].bytes)), {...initial, papers: {...initial.papers, two: {text: '第二篇'}}, settings: {model: '新'}});
	assert.equal(writes[1].path, '/isolated/easysch/workspace.json');
	assert.equal(writes[1].options.tmpPath, '/isolated/easysch/workspace.json.tmp');
	assert.equal(writes[1].options.backupFile, '/isolated/easysch/workspace.json.bak');
});
