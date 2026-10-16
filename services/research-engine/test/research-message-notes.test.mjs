// SPDX-License-Identifier: AGPL-3.0-or-later
// Production note bridge + production material publisher in a VM. Zotero Item
// persistence/renderer are controlled boundaries; not a native editor test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as Model from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Topic from '../../../chrome/content/zotero/research/shared/topic-materials.mjs';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Evidence from '../../../chrome/content/zotero/research/shared/chat-evidence.mjs';
import * as Explanation from '../../../chrome/content/zotero/research/shared/material-content.mjs';
import * as Framework from '../../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Writing from '../../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';

const [coreSource, publisherSource, noteSource] = await Promise.all(['core', 'manuscript-writing', 'research-message-notes'].map(name => readFile(new URL('../../../chrome/content/zotero/xpcom/research/' + name + '.js', import.meta.url), 'utf8')));
const plain = value => JSON.parse(JSON.stringify(value));
const message = id => ({ id, role: 'assistant', text: '这是一条中文研究讨论。应首先核对假设与数据划分，具体实验仍属于待验证计划。', sources: [{ stableID: 'evidence:paper:3:9:P1', title: '来源论文', paperItemID: 3, attachmentID: 9, pageIndex: 2, sourceText: 'ORIGINAL-SOURCE-TEXT-MUST-NOT-BE-COPIED', position: { rects: [[1, 2, 3, 4]] } }] });
function fixture() {
	const state = { researchMaterials: {}, researchMessageNotes: {} }, projects = { p1: { id: 'p1', materials: [], blocks: [{ text: '用户正文保留。' }] }, p2: { id: 'p2', materials: [], blocks: [] } };
	const items = new Map([[3, { id: 3, libraryID: 1, isRegularItem: () => true }], [9, { id: 9, parentID: 3, key: 'ATTACHMENT', isRegularItem: () => false }]]);
	const calls = { created: [], renders: [], saved: [], set: [], publish: [], notices: 0, updates: 0, model: 0, activeCatalog: 0, maxCatalog: 0 };
	let nextID = 100, failPublish = 0, failCatalog = 0, failUpdateAt = 0;
	class Note {
		constructor(type) { assert.equal(type, 'note'); this.id = null; this.html = ''; calls.created.push(this); }
		setNote(html) { calls.set.push(this); this.html = html; }
		getNote() { return this.html; }
		async saveTx(options) { assert.equal(options.skipSelect, true); if (!this.id) this.id = nextID++; items.set(this.id, this); calls.saved.push(this); }
		isRegularItem() { return false; }
	}
	const E = {
		store: { get: (type, id) => type ? id === undefined ? state[type] : state[type]?.[id] : state,
			async update(fn) { calls.updates++; if (calls.updates === failUpdateAt) throw Error('controlled-storage-secret'); fn(state); } },
		assets: { key: value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16) },
		manuscripts: { model: Model, get: id => projects[id], all: () => projects, notifyAssetsChanged() { calls.notices++; } },
		notebook: { project: id => projects[id], async catalog(id, fn) {
			if (failCatalog-- > 0) throw Error('controlled-catalog-secret');
			calls.activeCatalog++; calls.maxCatalog = Math.max(calls.maxCatalog, calls.activeCatalog);
			try { const p = structuredClone(projects[id]); fn(p); await new Promise(resolve => setImmediate(resolve)); projects[id] = p; }
			finally { calls.activeCatalog--; }
		} },
		library: { uri: (item, page) => 'zotero://open-pdf/library/items/' + (item.key || item.id) + (Number.isInteger(page) ? '?page=' + (page + 1) : '') },
		ai: { run() { calls.model++; throw Error('saving a note must not call AI'); } },
		studio: { request() { calls.model++; throw Error('saving a note must not call AI'); } },
	};
	const ctx = { EasySch: E, Zotero: { Research: E, Item: Note, Items: { getAsync: async id => items.get(id) }, Libraries: { userLibraryID: 1 } }, ChromeUtils: { importESModule(uri) { if (uri.endsWith('/topic-materials.mjs')) return Topic; if (uri.endsWith('/research-ai-policy.mjs')) return Policy; if(uri.endsWith('/chat-evidence.mjs'))return Evidence;if(uri.endsWith('/material-content.mjs'))return Explanation;if(uri.endsWith('/assembly-writing-preview.mjs'))return Writing;if(uri.endsWith('/writing-framework.mjs'))return Framework;throw Error('unexpected module '+uri); } }, URL, Map, Set, Date, Promise };
	vm.runInNewContext(coreSource, ctx);
	E.noteContentHTML = text => { calls.renders.push(text); return '<p>' + E.core.escapeHTML(text) + '</p>'; };
	vm.runInNewContext(publisherSource, ctx);
	const publish = E.manuscripts.publishMaterials;
	E.manuscripts.publishMaterials = async cards => {
		calls.publish.push({ cards: plain(cards), registry: plain(state.researchMessageNotes) });
		if (failPublish-- > 0) throw Error('controlled-publish-secret');
		return publish(cards);
	};
	const reload = () => vm.runInNewContext(noteSource, ctx);
	reload();
	return { E, state, projects, items, calls, reload, failPublish: count => failPublish = count, failCatalog: count => failCatalog = count, failUpdate: count => failUpdateAt = count };
}

test('saving uses the real publisher, stores the answer once and preserves safe links and evidence anchors', async () => {
	const h = fixture(), m = message('answer-1'), before = JSON.stringify(m.sources);
	m.sources.push({ stableID: 'web:paper', title: '<img src=x onerror=run()>', url: 'https://example.org/paper?q="quoted"&x=1', sourceText: 'OTHER-ORIGINAL-DO-NOT-COPY' }, { title: 'Unsafe', uri: 'javascript:alert(1)' }, { title: 'File', uri: 'file:///private/document.pdf' });
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's1', projectID: 'p1' });
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.saved.length, 1);
	assert.deepEqual(h.calls.renders, [m.text]);
	const note = h.items.get(saved.noteID);
	assert.equal(note.parentID, 3);
	assert.match(note.html, /zotero:\/\/open-pdf\/library\/items\/ATTACHMENT\?page=3/);
	assert.match(note.html, /https:\/\/example.org\/paper\?q=&quot;quoted&quot;&amp;x=1/);
	assert.match(note.html, /&lt;img src=x onerror=run\(\)&gt;/);
	assert.doesNotMatch(note.html, /ORIGINAL-SOURCE|OTHER-ORIGINAL|javascript:|file:\/\/|<img/);
	assert.equal(JSON.stringify(m.sources[0]), JSON.stringify(JSON.parse(before)[0]));
	const material = h.state.researchMaterials[saved.materialID];
	assert.equal(material.sourceText, m.text);
	assert.equal(material.kind, 'note');
	assert.equal(material.sourceType, 'ai-discussion');
	assert.equal(material.aiGenerated, true);
	assert.equal(material.generationStatus, 'completed');
	assert.match(material.coverage, /需核验/);
	assert.equal(material.sourceRefs[0].attachmentID, 9);
	assert.equal(material.sourceRefs[0].pageIndex, 2);
	assert.equal('sourceText' in material.sourceRefs[0], false);
	assert.equal(h.projects.p1.materials.length, 1);
	assert.equal(h.projects.p1.blocks[0].text, '用户正文保留。');
	assert.equal(h.calls.model, 0);
	assert.equal(Object.values(h.calls.publish[0].registry)[0].noteID, saved.noteID, 'note mapping exists before asset publication');
});

test('same message saved concurrently and into multiple projects reuses one note and one material', async () => {
	const h = fixture(), m = message('answer-2');
	const [a, b] = await Promise.all([h.E.saveResearchMessageNote(m, { sessionID: 's1', projectID: 'p1' }), h.E.saveResearchMessageNote(m, { sessionID: 's1', projectID: 'p2' })]);
	assert.equal(a.noteID, b.noteID);
	assert.equal(a.materialID, b.materialID);
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.publish.length, 1);
	assert.equal(h.projects.p1.materials.length, 1);
	assert.equal(h.projects.p2.materials.length, 1);
	await h.E.saveResearchMessageNote(m, { sessionID: 's1', projectID: 'p1' });
	assert.equal(h.projects.p1.materials.length, 1);
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.set.length, 1);
});

test('a shared saved answer note includes its exact preceding question once without copying source text',async()=>{
 const h=fixture(),m=message('question-answer'),question='为什么要按采集设备划分 $x_i$？';h.E.workbenchConversations={get:id=>id==='question-session'?{messages:[{id:'q',role:'user',text:question},m]}:null};
 const saved=await h.E.saveResearchMessageNote(m,{sessionID:'question-session'}),note=h.items.get(saved.noteID),material=h.state.researchMaterials[saved.materialID];
 assert.deepEqual(h.calls.renders,[question,m.text]);assert.equal(note.html.split(question).length-1,1);assert.match(note.html,/<strong>问题<\/strong>/);assert.equal(material.title,question);assert.equal(material.sourceText,'问题：'+question+'\n\n回答：\n'+m.text);assert.doesNotMatch(note.html,/ORIGINAL-SOURCE-TEXT/);
});

test('saved material uses the exact preceding question and a complete numbered TeX preview without changing the original answer', async () => {
	const h = fixture(), question = '请解释采集批次如何影响误差，并给出核对顺序？', m = message('tex-preview');
	m.text = '首先核对数据划分。'.repeat(18) + '\n\n公式为 $$\\sum_{i=1}^{N} x_i^2 = \\frac{1}{N} \\sum_{i=1}^{N} y_i^2$$，其中 $x_i$ 是变量。[material:private-card-ID]';
	m.sources.push({stableID: 'material:private-card-ID', title: '误差定义', sourceText: 'ACTUAL-EXCERPT-MUST-NOT-BE-COPIED'});
	const before = JSON.stringify(m), display = Evidence.numberedCitationText(m);
	h.E.workbenchConversations = {get: () => ({messages: [{id: 'actual-question', role: 'user', text: question}, {...m, question: '过时问题'}]})};
	const saved = await h.E.saveResearchMessageNote({...m, question: '过时问题'}, {sessionID: 'tex-session'}), material = h.state.researchMaterials[saved.materialID];
	assert.equal(material.title, question); assert.equal(material.summary, display); assert.ok(material.summary.length > 160);
	assert.match(material.summary, /\$\$\\sum_\{i=1\}\^\{N\} x_i\^2/); assert.match(material.summary, /\[1\]/); assert.doesNotMatch(material.summary, /private-card-ID/);
	assert.equal(material.sourceText, '问题：' + question + '\n\n回答：\n' + m.text); assert.equal(material.anchor.sourceText, m.text); assert.equal(JSON.stringify(m), before);
	assert.equal(material.sourceRefs.at(-1).id, 'material:private-card-ID'); assert.equal(h.calls.model, 0);
	material.title = '人工改过的名称'; material.summary = '人工说明 $z_j$'; material.userEdited = true;
	await h.E.saveResearchMessageNote(m, {sessionID: 'tex-session'});
	assert.equal(material.title, '人工改过的名称'); assert.equal(material.summary, '人工说明 $z_j$'); assert.equal(h.calls.publish.length, 1);
});

test('answer-only material titles are compact and contain neither raw formula delimiters nor internal citation IDs', async () => {
	const h = fixture(), m = message('fallback-title'); m.text = '公式 $x_i^2$ 可用于核对误差。[material:private-card-ID]';
	m.sources = [{stableID: 'material:private-card-ID', title: '误差定义'}];
	const saved = await h.E.saveResearchMessageNote(m), material = h.state.researchMaterials[saved.materialID];
	assert.match(material.title, /公式/); assert.doesNotMatch(material.title, /\$|private-card-ID/);
	assert.equal(material.summary, '公式 $x_i^2$ 可用于核对误差。[1]'); assert.equal(material.sourceText, m.text);
});

test('publication failure and module restart reuse the saved note without overwriting later manual edits', async () => {
	const h = fixture(), m = message('retry-asset'); h.failPublish(1);
	await assert.rejects(h.E.saveResearchMessageNote(m, { sessionID: 's2' }), /笔记已保存；素材入库未完成/);
	const note = h.calls.created[0]; note.html += '<p>用户后来补写的批判与反证。</p>';
	const manual = note.html; h.reload();
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's2', projectID: 'p1' });
	assert.equal(saved.noteID, note.id);
	assert.equal(note.html, manual);
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.set.length, 1);
	assert.equal(h.calls.saved.length, 1);
	assert.equal(Object.keys(h.state.researchMaterials).length, 1);
	assert.equal(h.calls.model, 0);
});

test('temporary registry write failure keeps an in-memory note reference for a safe retry', async () => {
	const h = fixture(), m = message('retry-registry'); h.failUpdate(1);
	await assert.rejects(h.E.saveResearchMessageNote(m, { sessionID: 's3' }), /保存关联信息未完成/);
	const note = h.calls.created[0]; note.html += '<p>保留用户补充。</p>';
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's3' });
	assert.equal(saved.noteID, note.id);
	assert.match(note.html, /保留用户补充/);
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.saved.length, 1);
});

test('failed final registry write cannot create a second material when publication already succeeded', async () => {
	const h = fixture(), m = message('retry-final-registry'); h.failUpdate(3);
	await assert.rejects(h.E.saveResearchMessageNote(m, { sessionID: 's4' }), /素材入库未完成/);
	assert.equal(Object.keys(h.state.researchMaterials).length, 1);
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's4' });
	assert.equal(h.calls.publish.length, 1);
	assert.equal(h.calls.created.length, 1);
	assert.ok(h.state.researchMaterials[saved.materialID]);
});

test('project association failure is retryable without rebuilding a saved note or asset', async () => {
	const h = fixture(), m = message('retry-project'); h.failCatalog(1);
	await assert.rejects(h.E.saveResearchMessageNote(m, { sessionID: 's5', projectID: 'p1' }), /加入项目未完成/);
	const note = h.calls.created[0]; note.html += '<p>项目关联失败期间的用户编辑。</p>';
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's5', projectID: 'p1' });
	assert.equal(h.calls.publish.length, 1);
	assert.equal(h.calls.created.length, 1);
	assert.match(note.html, /用户编辑/);
	assert.equal(h.projects.p1.materials[0].id, saved.materialID);
	assert.equal(h.projects.p1.materials.length, 1);
});

test('legacy project-scoped mapping migrates without replacing its edited note or edited material', async () => {
	const h = fixture(), m = message('legacy-answer');
	const first = await h.E.saveResearchMessageNote(m, { sessionID: 'legacy-session', projectID: 'p1' });
	const note = h.items.get(first.noteID); note.html += '<p>旧笔记手工补充。</p>';
	h.state.researchMaterials[first.materialID].summary = '用户修订过的中文说明';
	const old = { noteID: first.noteID, materialID: first.materialID, sessionID: 'legacy-session', messageID: m.id };
	h.state.researchMessageNotes = { ['legacy-session:' + m.id + ':p1']: old }; h.reload();
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 'legacy-session', projectID: 'p2' });
	assert.equal(saved.noteID, first.noteID);
	assert.equal(saved.materialID, first.materialID);
	assert.equal(saved.reused, true);
	assert.equal(h.calls.publish.length, 1);
	assert.equal(h.calls.created.length, 1);
	assert.match(note.html, /旧笔记手工补充/);
	assert.equal(h.state.researchMaterials[first.materialID].summary, '用户修订过的中文说明');
	assert.ok(h.state.researchMessageNotes[JSON.stringify(['legacy-session', m.id])]);
	assert.ok(h.state.researchMessageNotes['legacy-session:' + m.id + ':p1'], 'old mappings remain readable');
	assert.equal(h.projects.p2.materials[0].id, first.materialID);
});

test('a missing published asset is restored by the actual deterministic publisher without rewriting its note', async () => {
	const h = fixture(), m = message('missing-asset');
	const first = await h.E.saveResearchMessageNote(m, { sessionID: 's6' });
	delete h.state.researchMaterials[first.materialID];
	const note = h.items.get(first.noteID); note.html += '<p>人工内容保持。</p>';
	h.reload();
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 's6' });
	assert.equal(saved.noteID, first.noteID);
	assert.equal(saved.materialID, first.materialID);
	assert.match(note.html, /人工内容保持/);
	assert.equal(h.calls.created.length, 1);
	assert.equal(h.calls.set.length, 1);
});

test('partially saved legacy mappings reuse an existing asset despite old publisher hash inputs', async () => {
	const h = fixture(), m = message('legacy-partial');
	const first = await h.E.saveResearchMessageNote(m, { sessionID: 'old' });
	const legacyID = 'old:legacy-partial:p1';
	const material = h.state.researchMaterials[first.materialID]; material.sourceRecordID = 'research-message:' + legacyID; material.aiGenerated = false;
	h.state.researchMessageNotes = { [legacyID]: { noteID: first.noteID, sessionID: 'old', messageID: m.id } }; h.reload();
	const saved = await h.E.saveResearchMessageNote(m, { sessionID: 'old', projectID: 'p1' });
	assert.equal(saved.materialID, first.materialID);
	assert.equal(h.calls.publish.length, 1);
	assert.equal(Object.keys(h.state.researchMaterials).length, 1);
	assert.equal(h.calls.created.length, 1);
});

test('colon-containing IDs cannot collide, and different concurrent messages are not lost from the same project', async () => {
	const h = fixture();
	const [a, b] = await Promise.all([
		h.E.saveResearchMessageNote(message('b'), { sessionID: 's:a', projectID: 'p1' }),
		h.E.saveResearchMessageNote(message('a:b'), { sessionID: 's', projectID: 'p1' }),
	]);
	assert.notEqual(a.noteID, b.noteID);
	assert.notEqual(a.materialID, b.materialID);
	assert.equal(h.projects.p1.materials.length, 2);
	assert.equal(new Set(h.projects.p1.materials.map(row => row.id)).size, 2);
	assert.equal(h.calls.maxCatalog, 1, 'project clone writes are serialized');
	assert.equal(h.calls.model, 0);
});

test('invalid messages fail before saving and missing projects do not silently claim association', async () => {
	const h = fixture();
	for (const bad of [{ id: 'x', text: '' }, { text: '内容' }, { id: 'x', text: {} }]) await assert.rejects(h.E.saveResearchMessageNote(bad), /没有可保存的正文/);
	assert.equal(h.calls.created.length, 0);
	await assert.rejects(h.E.saveResearchMessageNote(message('unknown-project'), { projectID: 'missing' }), /关联项目已经不存在/);
	assert.equal(h.calls.created.length, 1, 'requested note remains available despite a missing project');
	assert.equal(Object.keys(h.state.researchMaterials).length, 1);
});
