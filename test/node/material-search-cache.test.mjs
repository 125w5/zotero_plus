/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import {articleSectionView, ARTICLE_SECTION_VERSION, materialSection} from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import {materialAnchors} from '../../chrome/content/zotero/research/shared/material-clues.mjs';
import {chineseSummary} from '../../chrome/content/zotero/research/shared/material-language.mjs';
import {materialSearchScope, filterMaterialScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {matchesResearchScope} from '../../chrome/content/zotero/research/shared/research-domain.mjs';

// The search, catalogue and chapter view as they were before the per-keystroke
// work was cut (searchMaterials without its field memo). Results, order,
// snippets and reasons must stay identical.
const {normalize, TAGS, catalogFor, materialRecordType} = Catalog;
const list = value => Array.isArray(value) ? value.flatMap(list) : value && typeof value === 'object' ? value.label ? [String(value.label)] : Object.values(value).flatMap(list) : [String(value ?? '')];
function contains(text, term) {if (!text.includes(term)) return false; if (!/^[a-z0-9]+$/i.test(term)) return true; return new RegExp('(^|[^a-z0-9])' + term + '(?=$|[^a-z0-9])', 'u').test(text);}
function legacySearch(materials, query, {summary = m => m.summary || m.summaryZh || '', tags = TAGS, tagsOf = m => m.tags} = {}) {
	const q = normalize(query); if (!q) return materials.map(m => ({m, score: 0, reason: '', snippet: summary(m)}));
	const concepts = tags.filter(t => [t.name, ...t.aliases].some(a => contains(q, normalize(a))));
	const words = (q.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9+.-]*/gu) || []).flatMap(word => /[\p{Script=Han}]/u.test(word) ? [word, ...word.split(/(?:在|中的|用于|应用于|基于|针对|研究|的应用|应用|方面|之中|以及)/u).filter(term => term.length >= 2)] : [word]);
	const groups = words.map(w => {const tag = tags.find(t => [t.name, ...t.aliases].some(a => normalize(a) === w)); return tag ? [tag.name, ...tag.aliases].map(normalize) : [w];});
	for (const t of concepts) groups.push([t.name, ...t.aliases].map(normalize));
	return materials.map(m => {const contents = (m.contents || []).flatMap(entry => entry.type === 'table' ? [entry.caption, ...(entry.rows || []).flat()] : [entry.text, entry.latex, entry.caption]).filter(Boolean).join(' '); const fields = [['中文说明', summary(m)], ['标题', m.title], ['论文章节', [m.section, m.chapter, m.sectionType, m.anchor?.section].filter(Boolean).join(' ')], ['补充说明与图表', contents], ['标签与别名', list([tagsOf(m), m.explicitTags, m.inferredTags, m.field, m.method]).join(' ')], ['原文或用户笔记', m.sourceText], ['来源', list([m.paperTitle, m.coverage, m.author, m.doi, m.anchor?.url]).join(' ')]];
		let score = 0, hit = null; for (const [name, value] of fields) {const text = normalize(value); let n = contains(text, q) ? 12 : 0; for (const group of groups) if (group.some(w => contains(text, w))) n += 4; else for (const w of group) if (/^[\p{Script=Han}]{3,}$/u.test(w)) {const pairs = Array.from({length: w.length - 1}, (_, i) => w.slice(i, i + 2)), count = pairs.filter(s => text.includes(s)).length; if (count >= 2 && count / pairs.length >= 0.6) n += count / pairs.length;} if (n) {score += n; if (!hit || n > hit.n) hit = {name, value: String(value || ''), n};}}
		const display = hit ? hit.value.normalize('NFKC').replace(/\s+/gu, ' ') : '', folded = display && display.toLocaleLowerCase(), positions = [q, ...groups.flat()].map(term => folded.indexOf(term)).filter(i => i >= 0), index = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 20); return {m, score, reason: hit ? '命中' + hit.name + (concepts.length ? ' · 含规范别名' : '') : '', snippet: (index ? '…' : '') + display.slice(index, index + 130)};
	}).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));
}
function legacyCatalogResults(all, query, p, s, summary = m => m.summary || '') {
	const c = catalogFor(p, all), projectIDs = s.sourceScope === 'project' ? new Set((p.materials || []).map(m => m.id)) : null, cards = all.filter(m => (!projectIDs || projectIDs.has(m.id)) && (!s.topic || c.entries[m.id].topics.includes(s.topic)) && (!s.type || c.entries[m.id].type === s.type) && (!s.categoryID || c.entries[m.id].categoryID === s.categoryID));
	let matches = legacySearch(cards, query, {summary, tags: [...c.aliases, ...TAGS], tagsOf: m => [...c.entries[m.id].tags, ...(Array.isArray(m.tags) ? m.tags : [])]});
	if (s.filter) matches = matches.filter(({m}) => legacySearch([{...m, summary: [summary(m), m.verification, m.year, m.date, c.entries[m.id].tags].join(' ')}], s.filter).length);
	matches = matches.filter(({m}) => Object.entries(s.facets || {}).every(([key, value]) => !value || (key === 'recordType' ? materialRecordType(m) === value : key === 'section' ? materialSection(m) === value : key === 'verification' ? (m.verification || 'unverified') === value : legacySearch([{id: m.id, title: '', summary: key === 'year' ? String(m.year || m.date || '') : key === 'source' ? [m.coverage, m.anchor?.url, m.paperTitle, m.title].filter(Boolean).join(' ') : [m[key], ...c.entries[m.id].tags].filter(Boolean).join(' ')}], value, {tags: [...c.aliases, ...TAGS]}).length)));
	const order = c.orders[(s.topic || '') + '|' + (s.type || '') + (s.categoryID ? '|' + s.categoryID : '')] || []; if (s.sort === 'manual') {let ids = new Map(); for (let [i, id] of order.entries()) if (!ids.has(id)) ids.set(id, i); for (let [i, m] of cards.entries()) if (!ids.has(m.id)) ids.set(m.id, order.length + i); matches.sort((a, b) => (ids.get(a.m.id) ?? -1) - (ids.get(b.m.id) ?? -1));} return matches;
}
function legacyFilterScope(rows, project, query) {
	const scope = materialSearchScope(project, query), primary = scope.primaryKeyword;
	if (scope.fuzzy) scope.primaryKeyword = '';
	const records = new Map(rows.map(row => [row, Object.create(row.m, {title: {value: [row.m.title, row.m.paperTitle].filter(Boolean).join(' '), enumerable: true}})]));
	const scoped = rows.filter(row => matchesResearchScope(records.get(row), scope)); if (!scope.fuzzy || !primary) return scoped;
	const matched = new Set(legacySearch(scoped.map(row => records.get(row)), primary).map(hit => hit.m)); return scoped.filter(row => matched.has(records.get(row)));
}
const machineFragment = m => m.kind === 'semantic' && m.aiGenerated === true && !m.userEdited && (m.revision || 1) === 1 && !m.history?.length && !m.contents?.length && !m.data && !m.sourceItemID && m.verification !== 'stale' && m.analysisVersion !== ARTICLE_SECTION_VERSION;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const anchorSignature = value => JSON.stringify(canonical([value.pageIndex, value.sourceText, value.position || null]));
function legacySectionView(materials, {protectedIDs = [], memberships = {}} = {}) {
	const protectedSet = new Set(protectedIDs), byID = new Map(materials.map(m => [m.id, m])), hidden = new Set();
	for (const aggregate of materials) if (aggregate.analysisVersion === ARTICLE_SECTION_VERSION && aggregate.sourceVersion) {
		const members = [...(aggregate.derivedFrom || []), ...Object.keys(memberships).filter(id => memberships[id] === aggregate.id)];
		for (const id of members) {const original = byID.get(id); if (original && machineFragment(original) && original.sourceVersion === aggregate.sourceVersion && !protectedSet.has(id)) hidden.add(id);}
		if (aggregate.userEdited || (aggregate.revision || 1) !== 1 || protectedSet.has(aggregate.id)) continue;
		const newer = materials.filter(m => m.analysisVersion === ARTICLE_SECTION_VERSION && m.sourceVersion === aggregate.sourceVersion && m.attachmentID === aggregate.attachmentID && String(m.parseVersion || '') > String(aggregate.parseVersion || ''));
		const covered = new Set(newer.flatMap(m => materialAnchors(m).map(anchorSignature)));
		const originals = materialAnchors(aggregate);
		if (originals.length && originals.every(anchor => covered.has(anchorSignature(anchor)))) hidden.add(aggregate.id);
	}
	return materials.filter(m => !hidden.has(m.id));
}
let seed = 7;
const random = () => {seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648;};
const pick = values => values[Math.floor(random() * values.length)];
const CN = ['本段报告相位噪声补偿在低信噪比下的效果。', '相位跟踪环路先估计噪声，再做补偿。', '噪声功率谱密度随载波频偏变化。', '跨设备验证使用另一批接收机数据。', '卷积神经网络用于调制识别，相关工作见第二章。', '高斯溅射用于三维重建，遥感影像另行处理。', '实验相关的超参数见附录。', '补偿后的误码率下降约两个数量级。'];
const EN = ['A CNN classifies the modulation from IQ samples.', 'Automatic modulation classification (AMC) at low SNR.', 'Phase noise compensation uses a pilot-aided loop.', 'The CNNX baseline is unrelated to convolutional networks.', 'Few-shot learning is evaluated on remote sensing scenes.', '3D Gaussian splatting renders the scene in real time.'];
const sentence = n => Array.from({length: n}, () => random() < 0.3 ? pick(EN) + ' ' : pick(CN)).join('');
const deepFreeze = value => {if (value && typeof value === 'object' && !Object.isFrozen(value)) {for (const key of Object.keys(value)) deepFreeze(value[key]); Object.freeze(value);} return value;};
// Frozen shared cards (tables, formulas, data rows, aliases, sections), chapter
// cards with older/newer parses and member fragments, and editable project cards.
function fixture() {
	seed = 7;
	const library = [], sections = [], memberships = {};
	for (let i = 0; i < 120; i++) {
		const m = {id: 'lib-' + String(i).padStart(3, '0'), revision: 1 + (i % 2), kind: ['semantic', 'annotation', 'note', 'experiment'][i % 4], title: i % 3 ? '素材 ' + i + ' ' + pick(['相位', '噪声', 'CNN', '调制识别', 'Gaussian splatting']) : 'Material ' + i, summary: i % 5 === 1 ? '' : i % 5 === 2 ? 'English summary ' + pick(EN) : sentence(2), summaryZh: i % 5 === 1 ? sentence(1) : undefined, summaryZhRevision: i % 5 === 1 ? 1 + (i % 2) : undefined, sourceText: sentence(4 + (i % 6)), explicitTags: [pick(['调制识别', 'CNN', '域适应', 'domain generalization', '3DGS', '遥感'])], inferredTags: i % 4 ? [{label: pick(['低信噪比', 'few shot']), status: 'ai-suggested'}] : [], field: i % 7 === 0 ? '无线通信' : undefined, method: i % 6 === 0 ? 'CNN' : undefined, year: 2016 + (i % 9), paperTitle: 'Study ' + (i % 13), verification: ['unverified', 'verified', 'stale'][i % 3], section: i % 4 === 1 ? pick(['3 方法', '5 结果', 'Introduction', '相关工作']) : undefined, anchor: {attachmentID: 100 + (i % 9), url: i % 11 === 0 ? 'https://example.org/' + i : undefined, section: i % 8 === 3 ? '实验' : undefined}};
		if (i % 4 === 3) m.contents = [{type: 'table', caption: '表 ' + i + ' 各信噪比下的准确率', rows: [['SNR', 'CNN'], ['0', String(60 + i)], ['10', '相位补偿后 ' + (80 + i % 9)]]}, {type: 'formula', latex: 'x_i = s_i e^{j\\phi_i}', text: sentence(1)}];
		if (i % 9 === 4) m.data = {rows: [['a', 'b'], ['1', '2']]};
		library.push(deepFreeze(m));
	}
	for (let d = 0; d < 12; d++) {
		const version = 'pdf-' + d, attachmentID = 500 + d, paragraphs = Array.from({length: 3}, (_, n) => ({pageIndex: n, sourceText: sentence(3), position: {pageIndex: n, rects: [[1, 2 + n, 3, 4]]}}));
		const fragments = paragraphs.map((row, n) => ({id: 'frag-' + d + '-' + n, kind: 'semantic', aiGenerated: true, revision: 1, title: '片段 ' + n, summary: sentence(1), sourceVersion: version, attachmentID, anchor: {...row, attachmentID}, sourceText: row.sourceText, ...(d % 5 === 4 && n === 0 ? {userEdited: true} : {})}));
		const card = (id, parseVersion, rows, extra = {}) => ({id, kind: 'semantic', aiGenerated: true, revision: 1, analysisVersion: ARTICLE_SECTION_VERSION, sourceVersion: version, parseVersion, attachmentID, title: '第 ' + d + ' 篇 · 结果', section: '5 结果', sectionType: '结果', summary: sentence(2), sourceText: rows.map(row => row.sourceText).join('\n\n'), anchors: rows.map(row => ({...row, attachmentID})), anchor: {...rows[0], attachmentID}, explicitTags: ['调制识别'], ...extra});
		sections.push(card('section-' + d, 'v1', paragraphs, {...(d % 2 ? {derivedFrom: fragments.slice(0, 2).map(m => m.id)} : {}), ...(d === 9 ? {userEdited: true} : {})}));
		if (d % 2 === 0) memberships[fragments[0].id] = 'section-' + d;
		if (d % 3 === 0) sections.push(card('section-' + d + '-v2', 'v2', d % 6 === 0 ? paragraphs : paragraphs.slice(1)));
		if (d % 4 === 1) sections.push(card('section-' + d + '-v3', 'v3', paragraphs, {attachmentID: attachmentID + 1000}));
		sections.push(...fragments);
	}
	sections.forEach(deepFreeze);
	const project = {id: 'paper', title: '相位噪声补偿研究', blocks: [], ui: {catalog: {topic: '', type: '', sort: 'relevance', selection: []}}, materials: Array.from({length: 30}, (_, i) => ({id: 'own-' + i, revision: 1, kind: i % 2 ? 'note' : 'semantic', title: '项目素材 ' + i, summary: sentence(1), sourceText: sentence(3), tags: i % 3 ? ['相位噪声'] : 'CNN', explicitTags: ['调制识别'], year: 2020 + (i % 4), verification: 'unverified'}))};
	project.materialCatalog = {version: 1, topics: [{id: 'paper', name: 'P'}], entries: {}, orders: {'|': ['own-3', 'lib-010', 'own-1']}, aliases: [{name: '相位噪声补偿', aliases: ['PNC', 'phase noise compensation'], parent: '信号处理'}], collapsed: []};
	return {library, sections, memberships, project};
}
const QUERIES = ['相', '相位', '相位噪', '相位噪声', '相位噪声补', '相位噪声补偿', '噪声补偿相位', 'CNN', 'cnn', 'AMC', 'modulation classification', 'convolutional neural network', '高斯溅射', '3DGS', 'domain generalization', 'few shot', 'PNC', 'phase noise compensation', '低信噪比 跨设备', '基于卷积神经网络的调制识别研究', 'c++ (v2.1)', '  ', ''];
const STATES = [{}, {filter: '低信噪比'}, {filter: 'verified CNN'}, {facets: {method: 'CNN'}}, {facets: {year: '2020'}}, {facets: {source: 'Study 1'}}, {facets: {field: '无线通信'}}, {facets: {section: '结果', recordType: 'annotation'}}, {facets: {verification: 'verified', recordType: 'note'}}, {sort: 'manual'}, {sourceScope: 'project'}];
const rowsOf = rows => rows.map(({m, score, reason, snippet}) => [m.id, score, reason, snippet]);
const summarize = m => chineseSummary({...m});
const stateOf = patch => ({topic: '', type: '', sort: 'relevance', selection: [], facets: {}, ...patch});
const current = (all, query, project, state) => filterMaterialScope(Catalog.catalogResults(all, query, project, state, summarize), project, query);
const before = (all, query, project, state) => legacyFilterScope(legacyCatalogResults(all, query, project, state, summarize), project, query);
function countLongNormalize(fn) {
	const original = String.prototype.normalize; let calls = 0;
	// eslint-disable-next-line no-extend-native
	String.prototype.normalize = function (...args) {if (this.length >= 60) calls++; return original.apply(this, args);};
	// eslint-disable-next-line no-extend-native
	try {fn();} finally {String.prototype.normalize = original;}
	return calls;
}

test('material search returns the rows, order, snippets and reasons it returned before', () => {
	const {library, sections, memberships, project} = fixture(), all = articleSectionView([...library, ...sections, ...project.materials], {memberships, protectedIDs: ['section-6']});
	let reasons = new Set(), clipped = 0;
	for (const [fuzzy, states] of [[true, STATES], [false, STATES.slice(0, 3)]]) {
		project.ui.materialResearchScope = {fuzzy};
		for (const [n, patch] of states.entries()) for (const query of n ? QUERIES.filter((_, i) => i % 3 === 0 || [7, 16, 22].includes(i)) : QUERIES) {
			const label = JSON.stringify({fuzzy, patch, query}), found = Catalog.catalogResults(all, query, project, stateOf(patch), summarize), old = legacyCatalogResults(all, query, project, stateOf(patch), summarize);
			assert.deepEqual(rowsOf(found), rowsOf(old), label);
			const rows = rowsOf(filterMaterialScope(found, project, query));
			assert.deepEqual(rows, rowsOf(legacyFilterScope(old, project, query)), 'scope ' + label);
			for (const row of rowsOf(found)) {reasons.add(row[2]); if (row[3].startsWith('…')) clipped++;}
		}
	}
	for (const query of ['相位噪声补偿', 'CNN', '高斯溅射', 'modulation classification']) assert.ok(current(all, query, project, stateOf({})).length, query + ' finds materials');
	assert.ok(Catalog.catalogResults(all, 'PNC', project, stateOf({}), summarize).length, 'the project alias PNC finds materials');
	assert.ok([...reasons].some(reason => reason.endsWith('含规范别名')), 'alias hits are labelled');
	assert.ok(['命中中文说明', '命中标题', '命中补充说明与图表', '命中原文或用户笔记'].every(reason => reasons.has(reason)), [...reasons].join(','));
	assert.ok(clipped, 'long fields give clipped snippets');
	// Full-text passage rows are searched with an empty title and summary.
	const twins = all.map(m => ({...m, title: '', summary: ''})), tags = [{name: '消融实验', aliases: ['ablation'], parent: '实验'}, ...TAGS];
	for (const query of QUERIES) assert.deepEqual(rowsOf(Catalog.searchMaterials(twins, query, {tags})), rowsOf(legacySearch(twins, query, {tags})), query);
});

test('the chapter-card view hides the same cards as before', () => {
	const {library, sections, memberships, project} = fixture(), cards = [...library, ...sections, ...project.materials], ids = rows => rows.map(m => m.id);
	for (const protectedIDs of [[], ['section-6', 'frag-2-0'], ['section-0-v2', 'section-3']]) assert.deepEqual(ids(articleSectionView(cards, {protectedIDs, memberships})), ids(legacySectionView(cards, {protectedIDs, memberships})), protectedIDs.join());
	const visible = new Set(ids(articleSectionView(cards, {memberships})));
	assert.equal(visible.has('section-0'), false, 'a newer parse with the same anchors hides the older chapter card');
	assert.equal(visible.has('section-3'), true, 'a newer parse that covers only part of the anchors keeps it');
	assert.equal(visible.has('section-9'), true, 'an edited chapter card stays');
	assert.equal(visible.has('section-1'), true, 'a newer parse of another attachment does not cover it');
	assert.equal(visible.has('frag-0-0'), false, 'a member fragment is hidden');
	assert.equal(visible.has('frag-1-1'), false, 'a derived-from fragment is hidden');
});

test('repeated searches do not normalize unchanged materials again, and edits are searched at once', () => {
	const {library, sections, memberships, project} = fixture(), queries = ['相', '相位噪声', '相位噪声补偿', 'CNN', 'PNC'];
	let all = articleSectionView([...library, ...sections, ...project.materials], {memberships});
	const run = query => current(all, query, project, stateOf({}));
	project.ui.materialResearchScope = {fuzzy: true};
	assert.ok(countLongNormalize(() => queries.forEach(run)) > 100, 'the first searches normalize the library once');
	assert.equal(countLongNormalize(() => queries.forEach(run)), 0, 'repeating them reuses every normalized field');
	const own = project.materials[4];
	own.summary = '本段新增：' + '振荡器老化导致的残余相位抖动需要单独标定，'.repeat(3);
	const edited = countLongNormalize(() => assert.deepEqual(rowsOf(run('振荡器老化')).map(row => row.slice(0, 3)), [[own.id, 20, '命中中文说明']]));
	assert.ok(edited >= 1 && edited <= 8, 'only the edited text is normalized again: ' + edited);
	own.contents = [...(own.contents || []), {type: 'text', text: '批注：此处的锁相环带宽取值需要复核。'}];
	assert.deepEqual(rowsOf(run('锁相环带宽')).map(row => row.slice(0, 3)), [[own.id, 20, '命中补充说明与图表']], 'an added annotation is searched');
	// A shared card edited through the store is a new frozen object.
	const at = all.findIndex(m => m.id === 'lib-007'), replaced = deepFreeze({...all[at], summary: '共享素材的新说明：天线阵列校准误差的来源分析，' + '包括温漂与互耦。'.repeat(4)});
	all = all.map((m, i) => i === at ? replaced : m);
	assert.equal(run('天线阵列校准')[0]?.m, replaced);
	assert.deepEqual(run('振荡器老化').map(row => row.m.id), [own.id]);
	for (const query of [...queries, '振荡器老化', '锁相环带宽', '天线阵列校准']) assert.deepEqual(rowsOf(run(query)), rowsOf(before(all, query, project, stateOf({}))), query);
});

test('a delegating scope record reuses its material normalized text and follows later edits', () => {
	const m = {id: 'x', title: 'T', summary: '', sourceText: '长文本'.repeat(40) + ' phase noise compensation'};
	Catalog.searchMaterials([m], 'phase');
	const record = Object.create(m, {title: {value: 'T Study', enumerable: true}});
	assert.equal(countLongNormalize(() => Catalog.searchMaterials([record], 'absent')), 0, 'the source text is not normalized a second time');
	m.sourceText = '长文本'.repeat(40) + ' carrier offset';
	assert.deepEqual(Catalog.searchMaterials([record], 'carrier').map(row => row.m), [record]);
	assert.deepEqual(Catalog.searchMaterials([record], 'phase'), []);
	assert.deepEqual(Catalog.searchMaterials([m], 'carrier').map(row => row.m), [m]);
});
