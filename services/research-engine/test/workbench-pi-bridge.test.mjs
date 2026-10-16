// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual production bridge in a VM + pinned vendor Pi + actual SSE adapter.
// Application data and provider responses are controlled; no real model,
// network, Zotero window, file download or frontend acceptance is claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Catalog from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Workbench from '../../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as Transport from '../../../chrome/content/zotero/research/shared/pi-chat-transport.mjs';
import * as Evidence from '../../../chrome/content/zotero/research/shared/chat-evidence.mjs';
import * as VisualReading from '../../../chrome/content/zotero/research/shared/evidence-reading-context.mjs';
import * as Formula from '../../../chrome/content/zotero/research/shared/formula-research.mjs';
import * as Pi from '../../../chrome/content/zotero/research/vendor/pi-agent.mjs';
import * as Manuscript from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Pages from '../../../chrome/content/zotero/research/shared/assembly-pages.mjs';
import * as ChatFiles from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import { assemblyTaskContext } from '../../../chrome/content/zotero/research/manuscript/assembly-task-context.mjs';
import { providerHTTPError } from '../../../chrome/content/zotero/research/shared/provider-error.mjs';

const source = await readFile(new URL('../../../chrome/content/zotero/xpcom/research/workbench-agent.js', import.meta.url), 'utf8');
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
const wire = (delta, reason) => frame({ id: 'controlled-response', choices: [{ index: 0, delta, finish_reason: null }] })
	+ frame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) + 'data: [DONE]\n\n';
const text = value => wire({ content: value }, 'stop');
const call = (name, args, id = 'call-1') => wire({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
const toolResult = payload => JSON.parse(payload.messages.findLast(row => row.role === 'tool').content);
const plain = value => JSON.parse(JSON.stringify(value));
const rawMaterials = [
	{ id: 'm1', kind: 'paragraph', title: '卷积神经网络方法', summary: '中文方法说明', sourceText: 'CNN 在当前原文中用于提取局部特征。', paperItemID: 3, attachmentID: 9, anchor: { paperItemID: 3, attachmentID: 9, pageIndex: 2 } },
	{ id: 'm2', kind: 'idea', title: '用户研究构想', summary: '仍需验证的实验计划', sourceText: '待验证：改变信道条件后检查准确率。' },
	{ id: 'private', kind: 'note', title: '求职简历', sourceText: 'CNN personal resume information must not reach model.' },
];
function fixture(replies = [], overrides = {}) {
	const requests = [], calls = [], settings = { endpoint: 'https://controlled.invalid/v1', model: 'configured-model' }, mainWindow={document:{getElementById:()=>null}};
	const materials = structuredClone(rawMaterials).map(row=>({...row,revision:1})), project = { id: 'project-1', title: '跨域调制识别', materials, materialCatalog: { version: 1, topics: [{ id: 'project-1', name: '跨域调制识别' }], entries: { m1: { topics: ['project-1'], type: '方法', tags: [] }, m2: { topics: ['project-1'], type: '研究构想', tags: [] }, private: { topics: [], type: '用户笔记', tags: [] } }, orders: { 'project-1|': ['m1', 'm2'] }, aliases: [], collapsed: [] } };
	project.sections = [{id:'section-1',title:'方法'},{id:'section-2',title:'结果'}];project.blocks = [Manuscript.block('paragraph','section-1',{id:'authored',text:'用户已经写好的原文 x_i，不应被改写。'})];project.ui = {sectionID:'section-1',blockID:'authored'};
	let storedProject=plain(project);const saveProject=(value=project)=>{storedProject=plain(value);};
	const items = new Map([[3, { id: 3, title: '来源论文' }], [9, { id: 9, parentID: 3, title: '来源附件' }], [10, { id: 10, parentID: 4, title: '另一篇论文的附件' }]]);
	const E = {
		settings: () => settings, core: { endpoint: value => value },
		credentials: { async get() { calls.push('credentials'); return 'controlled-only'; } },
		async resolveModel(config) { calls.push('resolveModel'); return { ...config, model: 'default-resolved' }; },
		aiProgress: (model, stage) => stage + ' · ' + model,
		async requestProvider(url, options, _timeout, readResponse) {
			if (url.endsWith('/models')) { calls.push('model-list'); return JSON.stringify({ data: [{ id: 'listed-model' }] }); }
			const payload = JSON.parse(options.body); requests.push({ url, payload });
			const next = replies.shift();
			assert.ok(next, 'no unplanned provider request');
			const body = typeof next === 'function' ? next(payload) : next;
			const bytes = new TextEncoder().encode(body);
			return readResponse(new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }));
		},
		manuscripts: { model:Manuscript,get:id=>id===project.id?plain(storedProject):undefined,assetLibrary: () => Object.fromEntries(materials.map(row => [row.id, row])), summaryReader: () => row => row.summary || '', summaryFor: row => row.summary || '', async check(value){calls.push({kind:'checkAssembly',id:value.id});return [{blockID:'authored',severity:'warning',message:'当前段落尚未绑定支持素材'}];} },
		notebook: {
			project: id => id === project.id ? project : undefined, materials: () => materials,
			async catalog(id,update){assert.equal(id,project.id);calls.push({kind:'catalog',id});update(project);saveProject();},
			async evaluate(id, idea, _status, signal, options) { calls.push({ kind: 'evaluate', id, idea, signal, options }); return { id: 'plan-1', sources: [{ id: 'm1', materialID: 'm1', title: '真实方法', text: '原文摘录', anchor: { attachmentID: 9 } }, { id: 'web-old', doi: '10.1234/prior', title: '最接近工作', text: '实际提供的公开摘要' }], plan: { minimumValidation: '先做防泄漏的最小实验', feasibility: '数据和算力待补', pending: ['真实数据', '算力预算'], experiments: [{ id: 'e1' }], closest: [{ sourceID: 'm1', similarity: '实际方法片段' }, { sourceID: 'web-old', similarity: '依据摘要' }] } }; },
			async suggestTopics(id, _status, signal, options) { calls.push({ kind: 'topics', id, signal, options }); return { groups: [{ name: '跨域调制识别', materialIDs: ['m1', 'm2'] }], remaining: 0, total: 2, base: JSON.stringify(project.materialCatalog) }; },
		},
		async preparePassageSearch() { calls.push('preparePassages'); },
		findPaperPassages(query) { calls.push({ kind: 'passageSearch', query }); return [{ score: 20, snippet: '原文命中', m: { id: 'passage-9-3', title: 'Experimental setup', kind: 'paragraph', sourceRecordID: 'passage:document-hash:3', sourceVersion: 'document-hash', attachmentID: 9, paperItemID: 3, pageIndex: 4, position: { pageIndex: 4, rects: [[1, 2, 3, 4]] }, sourceText: 'CNN is trained using the source domain with a disjoint validation partition.' } }]; },
		async searchPaperPage(query, options) { calls.push({ kind: 'paperSearch', query, options }); return { records: [{ id: 'new-paper', title: 'A recent real candidate', doi: '10.1234/new', abstract: 'A provided abstract with domain adaptation.', date: '2026', citationCount: null }, { id: 'no-abstract', title: 'Metadata only candidate', doi: '10.1234/metadata' }], provider: 'controlled-search', page: 1, hasMore: true, limitations: ['部分条目只有题录'] }; },
		async getItem(id) { calls.push({ kind: 'getItem', id }); return items.get(id); },
		library: { describe: item => ({ id: item.id, title: item.title }), async sources(papers, selection) { calls.push({ kind: 'readPaper', papers, selection }); return { sources: [{ id: 'P1-T0', label: '原文第 3 页', text: '作者在原文中明确描述了防止数据泄漏的划分。', attachmentID: 9, pageIndex: 2 }], warnings: ['当前上下文仅含原文片段'] }; } },
		studio: { all: () => ({}), get: () => null, async open(options) { calls.push({ kind: 'openPPT', options }); } },
	};
	Object.assign(E, overrides);
	vm.runInNewContext(source, { Zotero: { Research: E, getMainWindow:()=>mainWindow }, ChromeUtils: { importESModule(uri) {
		if (uri.endsWith('/research-ai-policy.mjs')) return Policy;
		if (uri.endsWith('/material-catalog.mjs')) return Catalog;
		if (uri.endsWith('/assembly-pages.mjs')) return Pages;
		if (uri.endsWith('/agent-workbench.mjs')) return Workbench;
		if (uri.endsWith('/pi-chat-transport.mjs')) return Transport;
		if (uri.endsWith('/chat-evidence.mjs')) return Evidence;
		if (uri.endsWith('/chat-attachments.mjs')) return ChatFiles;
		if (uri.endsWith('/evidence-reading-context.mjs')) return VisualReading;
		if (uri.endsWith('/formula-research.mjs')) return Formula;
		if (uri.endsWith('/pi-agent.mjs')) return Pi;
		throw Error('unexpected module');
	} }, URL, Promise, Map, Set, Date });
	return { E, requests, calls, materials, project, settings, items, mainWindow,saveProject };
}

test('actual bridge performs local tool continuation, unwraps passages and keeps the selected model', async () => {
	const h = fixture([call('search_local_materials', { query: '卷积神经网络' }), payload => {
		const result = toolResult(payload);
		assert.equal(result.materials[0].id, 'material:m1');
		assert.equal(result.passages[0].id, 'evidence:passage:document-hash:3');
		assert.match(result.passages[0].text, /disjoint validation/);
		assert.doesNotMatch(JSON.stringify(payload.messages), /personal resume information/);
		return text('原文使用独立验证划分，应继续核验域划分的公平性。[evidence:passage:document-hash:3]');
	}]);
	const before = JSON.stringify(h.materials);
	const result = await h.E.runWorkbenchTask({ prompt: '核对卷积网络的原文证据', modelID: 'selected-model', thinkingLevel: 'high', history: [{ role: 'user', text: '核对卷积网络的原文证据' }] });
	assert.equal(result.model, 'selected-model');
	assert.equal(h.requests.length, 2);
	assert.ok(h.requests.every(row => row.payload.model === 'selected-model'));
	assert.equal(h.calls.includes('resolveModel'), false, 'explicit model must not migrate');
	assert.equal(h.requests[0].payload.messages.filter(row => row.role === 'user').length, 1, 'latest question is not duplicated');
	assert.ok(h.calls.includes('preparePassages'));
	assert.equal(result.sources.find(row => row.stableID === 'evidence:passage:document-hash:3').attachmentID, 9);
	assert.equal(result.sources.find(row => row.stableID === 'evidence:passage:document-hash:3').pageIndex, 4);
	assert.match(result.steps.join('\n'), /检索已有素材/);
	assert.equal(JSON.stringify(h.materials), before);
	const names = h.requests[0].payload.tools.map(row => row.function.name);
	assert.ok(names.includes('search_local_materials'));
	assert.ok(!names.includes('evaluate_experiment_plan'));
	assert.ok(!names.includes('list_project_materials'));
	assert.ok(!names.some(name => /delete|shell|exec|write|generate_image|generate_chart/.test(name)));
});

test('a material recommendation defaults to the built-in search and accepts only an exact application-context echo', async () => {
	const selectedSource = {...rawMaterials[0], kind: 'material'}, diagnostics = [];
	const h = fixture([payload => {
		assert.deepEqual(payload.tool_choice, {type: 'function', function: {name: 'search_local_materials'}});
		assert.equal(payload.reasoning_effort, 'high');
		const input = JSON.parse(payload.messages.at(-1).content);
		assert.equal(input.applicationContext.project.title, '跨域调制识别'); assert.ok(!Object.hasOwn(input, 'projectID'));
		return call('search_local_materials', {query: '卷积神经网络', projectID: 'project-1', selectedSource: {id: 'm1', kind: 'material', title: selectedSource.title}});
	}, payload => {
		const assistant = payload.messages.findLast(row => row.role === 'assistant');
		assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), {query: '卷积神经网络'});
		assert.equal(payload.tool_choice, 'auto');
		assert.equal(toolResult(payload).materials[0].id, 'material:m1');
		return text('这条原文方法素材可以用于核对局部特征的作用。[material:m1]');
	}]);
	h.settings.reasoningParameter = 'reasoning_effort'; const before = JSON.stringify(h.project);
	const result = await h.E.runWorkbenchTask({prompt: '请你推荐我可以使用的素材', projectID: 'project-1', selectedSource, modelID: 'selected-model', thinkingLevel: 'high', onDiagnostics: value => diagnostics.push(value)});
	assert.equal(h.requests.length, 2); assert.ok(h.requests.every(row => row.payload.model === 'selected-model'));
	assert.equal(result.sources[0].stableID, 'material:m1'); assert.ok(result.steps.includes('检索已有素材'));
	assert.equal(h.calls.includes('resolveModel'), false); assert.equal(JSON.stringify(h.project), before);
	assert.ok(diagnostics.every(row => row.invalidToolMessageCount === 0));
});

test('model-supplied project or source changes are rejected before any application tool executes', async () => {
	for (const extra of [{projectID: 'another-project'}, {selectedSource: {id: 'm2', kind: 'material'}}]) {
		const h = fixture([call('search_local_materials', {query: '卷积神经网络', ...extra})]);
		await assert.rejects(h.E.runWorkbenchTask({prompt: '请推荐可以使用的素材', projectID: 'project-1', selectedSource: {...rawMaterials[0], kind: 'material'}, modelID: 'selected-model'}), /工具参数与当前项目或资料不一致/);
		assert.equal(h.requests.length, 1); assert.equal(h.calls.includes('preparePassages'), false);
		assert.equal(h.calls.some(row => row.kind === 'passageSearch'), false);
	}
});
test('every public tool declares only actual strict arguments; exact source context with reordered nested keys is stripped before Pi schema validation',async()=>{
 const selectedSource={...rawMaterials[0],kind:'material'},h=fixture([payload=>{
  for(const row of payload.tools){const parameters=row.function.parameters;assert.equal(parameters.additionalProperties,false);assert.ok(!Object.hasOwn(parameters.properties,'projectID'));assert.ok(!Object.hasOwn(parameters.properties,'selectedSource'));assert.deepEqual(parameters.required,Object.keys(parameters.properties));}
  return call('search_local_materials',{query:'CNN',projectID:'project-1',selectedSource:{id:'m1',kind:'material',anchor:{pageIndex:2,attachmentID:9,paperItemID:3}}});
 },payload=>{assert.deepEqual(JSON.parse(payload.messages.findLast(row=>row.role==='assistant').tool_calls[0].function.arguments),{query:'CNN'});return text('根据当前真实素材说明局部特征。[material:m1]');}]);
 const result=await h.E.runWorkbenchTask({prompt:'请推荐可用素材',projectID:h.project.id,selectedSource});assert.equal(h.requests.length,2);assert.match(result.text,/局部特征/);
 const forged=fixture([call('search_local_materials',{query:'CNN',projectID:'project-1',selectedSource:{id:'m1',anchor:{pageIndex:99,attachmentID:9,paperItemID:3}}})]);await assert.rejects(forged.E.runWorkbenchTask({prompt:'请推荐可用素材',projectID:forged.project.id,selectedSource}),/工具参数与当前项目或资料不一致/);assert.equal(forged.calls.includes('preparePassages'),false);
});

const placementPrompt='我确认，随便挑一个素材放进我的装配并解释';
function placementReplies(id='m1',last='已加入当前装配，原文用于核对局部特征。[material:m1]'){
 return [call('search_local_materials',{query:''}),payload=>{assert.equal(toolResult(payload).materials[0].id,'material:m1');assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'place_material_in_assembly'}});return call('place_material_in_assembly',{materialID:'material:'+id},'insert-1');},text(last)];
}
test('explicit material placement calls the built-in model/catalog insertion, retains original assets and never writes authored prose',async()=>{
 const h=fixture(placementReplies()),authored=JSON.stringify(h.project.blocks[0]),assets=JSON.stringify(h.materials);h.settings.reasoningParameter='reasoning_effort';
 const result=await h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id,modelID:'selected-model',thinkingLevel:'high'});
 assert.equal(h.project.blocks.length,2);assert.equal(JSON.stringify(h.project.blocks[0]),authored);assert.equal(JSON.stringify(h.materials),assets);
 assert.equal(h.project.blocks[1].text,'');assert.equal(h.project.blocks[1].materials[0].id,'m1');assert.equal(h.project.blocks[1].sectionID,'section-1');assert.equal(h.project.ui.blockID,h.project.blocks[1].id);
 assert.equal(result.materialPlacements[0].blockID,h.project.blocks[1].id);assert.equal(h.calls.filter(row=>row.kind==='catalog').length,1);
 assert.ok(h.requests.every(row=>row.payload.model==='selected-model'&&row.payload.reasoning_effort==='high'));
});
test('native application insertion preserves image and table source content rather than creating a generic generated document',async()=>{
 for(const kind of ['image','table']){
  const h=fixture(placementReplies()),original=h.materials[0];original.revision=2;original.anchor.revision=2;
  if(kind==='image')original.imagePath='original-complete-figure.png';else original.data={rows:[['x_i','value'],['原始记录','42']]};
  const before=JSON.stringify(original);await h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id});
  const inserted=h.project.blocks[1];assert.equal(inserted.type,kind);assert.equal(JSON.stringify(original),before);assert.equal(inserted.text,'');
  if(kind==='image')assert.equal(inserted.imagePath,original.imagePath);else {assert.equal(inserted.table.rows[1][1].text,'42');assert.equal(inserted.table.binding.materialID,'m1');assert.equal(inserted.table.binding.revision,2);}
 }
});
test('an already open assembly uses its existing insertion/undo/persist path and no duplicate catalog operation',async()=>{
 const h=fixture(placementReplies()),actions=[],ui={p:h.project,ready:true,saving:Promise.resolve(),placeAssemblyMaterial(material,options){actions.push('insert');assert.strictEqual(material,h.materials[0]);return Pages.placeAssemblyMaterial(this.p,Manuscript,material,options);},async persist(){await Promise.resolve();actions.push('persist');h.saveProject(this.p);}};
 h.mainWindow.document.getElementById=id=>id==='manuscript-project-1'?{contentWindow:{ManuscriptUI:ui}}:null;
 const result=await h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id});assert.deepEqual(actions,['insert','persist']);assert.equal(h.calls.some(row=>row.kind==='catalog'),false);assert.equal(result.materialPlacements[0].blockID,h.project.ui.blockID);
});
const pagePrompt='在结果上面新增一页 放你说的内容';
function prepareResults(h){h.project.sections=[{id:'results',title:'结果'},{id:'methods',title:'方法'}];h.project.blocks=[Manuscript.block('paragraph','results',{id:'result-1',text:'人工结果，变量 x_i。',runs:[{text:'人工结果，变量 x_i。',bold:true}]}),Manuscript.block('paragraph','results',{id:'result-2',text:'人工结果尾部。'}),Manuscript.block('paragraph','methods',{id:'method-1',text:'人工方法。'})];h.project.ui={sectionID:'results',blockID:'result-2'};return h;}
function citedHistory(h){return [{role:'user',text:'哪些原素材支持当前结果？'},{role:'assistant',text:'受控AI研究讨论，不是待写入正文。[material:m1] [material:m2]',sources:h.materials.slice(0,2).map(row=>({...row,stableID:'material:'+row.id}))}];}
const originalFields=blocks=>blocks.map(row=>({id:row.id,sectionID:row.sectionID,type:row.type,text:row.text,runs:row.runs,materials:row.materials}));
for(const failure of ['reported','uncommitted'])test('a '+failure+' editor page save cannot use live memory as proof of persistence or report completion',async()=>{
 const expected=failure==='reported'?'受控写盘失败：项目原文件仍保留。':'未确认装配操作已保存，请检查当前项目';
 const h=prepareResults(fixture([call('read_assembly_context',{}),call('insert_assembly_page',{sectionID:'results',position:'before'}),payload=>{assert.equal(payload.tool_choice,'auto');assert.ok(payload.messages.findLast(row=>row.role==='tool').content.includes(expected),'真实 Pi 工具结果保留存储失败原因');return text('已新增页面并保存。');}]));h.saveProject();
 const original=plain(originalFields(h.project.blocks)),stored=JSON.stringify(h.E.manuscripts.get(h.project.id));let insertions=0,saves=0;
 const ui={p:h.project,ready:true,saving:Promise.resolve(),insertAssemblyPage(options){insertions++;return Pages.insertAssemblyPage(this.p,Manuscript,options);},async persist(){saves++;if(failure==='reported')this.saveError=Error(expected);}};
 h.mainWindow.document.getElementById=id=>id==='manuscript-project-1'?{contentWindow:{ManuscriptUI:ui}}:null;
 await assert.rejects(h.E.runWorkbenchTask({prompt:'请在结果上面新增一页',projectID:h.project.id}),error=>error.message===expected);
 assert.equal(insertions,1);assert.equal(saves,1);assert.equal(h.requests.length,3,'失败后停止强制写工具，不重复新增页');assert.ok(h.project.blocks.some(row=>row.explicitPage),'失败队列中的内存页面确实存在，不能把它当作已保存');
 assert.equal(JSON.stringify(h.E.manuscripts.get(h.project.id)),stored,'独立保存快照没有收到新增页');assert.deepEqual(plain(originalFields(h.project.blocks.filter(row=>!row.explicitPage))),original,'既有人工内容保持原样');
});
test('an editor material save rejection returns the actual storage error rather than claiming a successful application action',async()=>{
 const message='受控保存失败：存储卷不可写。',h=fixture([call('search_local_materials',{query:''}),call('place_material_in_assembly',{materialID:'material:m1'}),payload=>{assert.equal(payload.tool_choice,'auto');assert.equal(payload.messages.findLast(row=>row.role==='tool').content,message);return text('素材已加入并保存。[material:m1]');}]),stored=JSON.stringify(h.E.manuscripts.get(h.project.id)),original=JSON.stringify(h.project.blocks[0]);let insertions=0;
 const ui={p:h.project,ready:true,saving:Promise.resolve(),placeAssemblyMaterial(material,options){insertions++;return Pages.placeAssemblyMaterial(this.p,Manuscript,material,options);},async persist(){this.saveError=Error(message);}};
 h.mainWindow.document.getElementById=id=>id==='manuscript-project-1'?{contentWindow:{ManuscriptUI:ui}}:null;
 await assert.rejects(h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id}),error=>error.message===message);
 assert.equal(insertions,1);assert.equal(h.requests.length,3);assert.equal(h.project.blocks.length,2);assert.equal(JSON.stringify(h.project.blocks[0]),original);assert.equal(JSON.stringify(h.E.manuscripts.get(h.project.id)),stored);
});
test('the actual Pi four-tool page pipeline rereads real citations and ignores later selection without copying assistant prose',async()=>{
 const h=prepareResults(fixture());h.settings.reasoningParameter='reasoning_effort';const original=plain(originalFields(h.project.blocks)),sources=JSON.stringify(h.materials),context=assemblyTaskContext(h.project,pagePrompt),names=['read_assembly_context','insert_assembly_page','read_cited_materials','place_cited_materials_on_page'];let permissions=0;
 const replies=names.map((name,index)=>payload=>{assert.deepEqual(payload.tool_choice,{type:'function',function:{name}});if(index===1){h.project.ui={sectionID:'methods',blockID:'method-1'};assert.equal(toolResult(payload).blockID,'result-2');}if(index===3)assert.deepEqual(toolResult(payload).materials.map(row=>row.id),['material:m1','material:m2']);return call(name,name==='insert_assembly_page'?{sectionID:'results',position:'before'}:{},'actual-page-'+index);});replies.push(payload=>{assert.equal(toolResult(payload).placements.length,2);return text('已有原素材已加入同章节新增页。[material:m1]');});
 h.E.requestProvider=async(_url,options,_timeout,readResponse)=>{const payload=JSON.parse(options.body);h.requests.push({payload});const reply=replies.shift();assert.ok(reply);const body=typeof reply==='function'?reply(payload):reply;return readResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}));};
 const result=await h.E.runWorkbenchTask({prompt:pagePrompt,projectID:h.project.id,assemblyContext:context,history:citedHistory(h),modelID:'explicit-page-model',thinkingLevel:'high',executionMode:'auto',onToolPermission:()=>{permissions++;return false;}});
 assert.equal(h.requests.length,5);assert.equal(permissions,0);assert.ok(h.requests.every(row=>row.payload.model==='explicit-page-model'&&row.payload.reasoning_effort==='high'));assert.equal(result.pageInsertions.length,1);assert.equal(result.materialPlacements.length,2);const added=result.materialPlacements.map(value=>h.project.blocks.find(row=>row.id===value.blockID));assert.equal(added[0].id,result.pageInsertions[0].pageID);assert.deepEqual(plain(added.map(row=>row.materials[0].id)),['m1','m2']);assert.ok(added.every(row=>row.sectionID==='results'&&row.assembly&&row.text===''));assert.deepEqual(plain(originalFields(h.project.blocks.filter(row=>!added.includes(row)))),original);assert.equal(h.project.blocks[2].id,'result-1');assert.equal(h.project.blocks[2].pageBreakBefore,true);assert.equal(JSON.stringify(h.materials),sources);assert.doesNotMatch(JSON.stringify(h.project.blocks),/受控AI研究讨论/);assert.ok(h.project.layoutHistory.length>=1,'背景操作保留可恢复的原项目快照');
});
test('an actual page request with no genuine earlier citations creates a blank page and reports the missing originals without forced retries',async()=>{
 const h=prepareResults(fixture([call('read_assembly_context',{}),call('insert_assembly_page',{sectionID:'results',position:'before'}),call('read_cited_materials',{}),payload=>{assert.equal(payload.tool_choice,'auto');assert.equal(toolResult(payload).materials.length,0);return text('已完成。');}]));const originals=plain(originalFields(h.project.blocks));
 const result=await h.E.runWorkbenchTask({prompt:pagePrompt,projectID:h.project.id,history:[{role:'assistant',text:'只有讨论，没有真实素材引用。',sources:[]}]});assert.equal(h.requests.length,4);assert.equal(result.pageInsertions.length,1);assert.equal(result.materialPlacements,undefined);assert.equal(result.missingCitedMaterials,true);assert.match(result.text,/新页保持空白/);assert.doesNotMatch(result.text,/已完成/);const marker=h.project.blocks.find(row=>row.id===result.pageInsertions[0].pageID);assert.equal(marker.text,'');assert.equal(marker.emptyStarter,true);assert.deepEqual(plain(originalFields(h.project.blocks.filter(row=>row!==marker))),originals);
});
test('Ask page denial does not create a marker and later source denial accurately retains an already saved page',async()=>{
 const denied=prepareResults(fixture([call('read_assembly_context',{}),call('insert_assembly_page',{sectionID:'results',position:'before'}),text('页面已新增。')])),before=JSON.stringify(denied.project);let asks=0;
 const cancelled=await denied.E.runWorkbenchTask({prompt:'请在结果上面新增一页',projectID:denied.project.id,executionMode:'ask',onToolPermission:()=>{asks++;return false;}});assert.equal(asks,1);assert.equal(JSON.stringify(denied.project),before);assert.equal(cancelled.pageInsertions,undefined);assert.match(cancelled.text,/取消/);assert.doesNotMatch(cancelled.text,/已新增/);
 const partial=prepareResults(fixture([call('read_assembly_context',{}),call('insert_assembly_page',{sectionID:'results',position:'before'}),call('read_cited_materials',{}),call('place_cited_materials_on_page',{}),text('素材已放入。')])),permissions=[];
 const result=await partial.E.runWorkbenchTask({prompt:pagePrompt,projectID:partial.project.id,history:citedHistory(partial),executionMode:'ask',onToolPermission:request=>{permissions.push(request.toolName);return request.toolName==='insert_assembly_page';}});assert.deepEqual(permissions,['insert_assembly_page','place_cited_materials_on_page']);assert.equal(result.pageInsertions.length,1);assert.equal(result.materialPlacements,undefined);assert.match(result.text,/新增页面已保留/);assert.match(result.text,/没有继续加入素材/);assert.equal(partial.project.blocks.find(row=>row.id===result.pageInsertions[0].pageID).materials.length,0);
});
test('page mutation revalidates a real manual change made during the permission await before writing anything',async()=>{
 const h=prepareResults(fixture([call('read_assembly_context',{}),call('insert_assembly_page',{sectionID:'results',position:'before'}),payload=>{assert.match(payload.messages.findLast(row=>row.role==='tool').content,/人工内容或来源已变化/);return text('新增失败，保留人工修改。');}]));let asks=0;
 await assert.rejects(h.E.runWorkbenchTask({prompt:'请在结果上面新增一页',projectID:h.project.id,executionMode:'ask',onToolPermission:()=>{asks++;h.project.blocks[1].text='人工在等待期间补写的结果。';return true;}}),/人工内容或来源已变化/);assert.equal(asks,1);assert.equal(h.project.blocks.length,3);assert.equal(h.project.blocks[1].text,'人工在等待期间补写的结果。');assert.ok(!h.project.blocks.some(row=>row.explicitPage));
});
test('Ask pauses only an authorized write, supplies actual material IDs, and rejection cannot be reported as successful placement',async()=>{
 const h=fixture(placementReplies()),before=JSON.stringify(h.project),permissions=[];
 const result=await h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id,executionMode:'ask',onToolPermission:async request=>{permissions.push(request);assert.equal(h.project.blocks.length,1);return false;}});
 assert.equal(permissions.length,1);assert.equal(permissions[0].toolName,'place_material_in_assembly');assert.deepEqual(plain(permissions[0].materialIDs),['m1']);assert.equal(JSON.stringify(h.project),before);
 assert.equal(result.materialPlacements,undefined);assert.match(result.text,/取消/);assert.doesNotMatch(result.text,/已加入/);assert.deepEqual(plain(result.cancelledTools),['place_material_in_assembly']);
 const approved=fixture(placementReplies());let approvedCount=0;await approved.E.runWorkbenchTask({prompt:placementPrompt,projectID:approved.project.id,executionMode:'ask',onToolPermission:async()=>{approvedCount++;return true;}});assert.equal(approvedCount,1);assert.equal(approved.project.blocks.length,2);
});
test('permission wait revalidates live source revision, and read-only Ask tasks never request a write permission',async()=>{
 const h=fixture([call('search_local_materials',{query:''}),call('place_material_in_assembly',{materialID:'material:m1'}),payload=>{assert.match(payload.messages.at(-1).content,/素材已变化/);return text('不能加入已变化的素材。');}]);h.materials[0].revision=1;
 await assert.rejects(h.E.runWorkbenchTask({prompt:placementPrompt,projectID:h.project.id,executionMode:'ask',onToolPermission:async()=>{h.materials[0].revision++;return true;}}),/尚未完成/);assert.equal(h.project.blocks.length,1);assert.equal(h.calls.some(row=>row.kind==='catalog'),false);
 const readOnly=fixture([call('search_local_materials',{query:'CNN'}),text('当前素材描述局部特征。[material:m1]')]);let asks=0;await readOnly.E.runWorkbenchTask({prompt:'推荐已有素材',executionMode:'ask',onToolPermission:async()=>{asks++;return true;}});assert.equal(asks,0);
});
test('scope failure, unread material, plain discussion, and negative requests cannot insert material',async()=>{
 for(const projectID of ['', 'missing']){const h=fixture();await assert.rejects(h.E.runWorkbenchTask({prompt:placementPrompt,projectID}),/研究项目/);assert.equal(h.requests.length,0);assert.equal(h.calls.length,0);}
 const unread=fixture([call('place_material_in_assembly',{materialID:'material:m1'})]);await assert.rejects(unread.E.runWorkbenchTask({prompt:placementPrompt,projectID:unread.project.id}));assert.equal(unread.project.blocks.length,1);
 for(const prompt of ['不要把素材放进装配，只解释概念','怎么把素材放进装配','解释已有素材']){
  const h=fixture([payload=>{assert.ok(!payload.tools.some(row=>row.function.name==='place_material_in_assembly'));return text('可以讨论现有资料。');}]);await h.E.runWorkbenchTask({prompt,projectID:h.project.id});assert.equal(h.project.blocks.length,1);
 }
});
test('assembly discussions read actual direction, structure, bound materials, human prose and LaTeX without generating prose',async()=>{
 for(const stage of ['direction','structure','materials','block']){
  const h=fixture([call('read_assembly_context',{}),payload=>{const result=toolResult(payload);assert.equal(result.stage,stage);assert.equal(result.userText,h.project.blocks[0]?.text||'');if(stage==='materials')assert.equal(result.materials[0].id,'material:m1');return text(stage==='materials'?'这里已有原文方法素材，可以讨论引用位置。[m1]':'基于当前项目讨论论证结构与待补证据。');}]);
  if(stage==='direction'){h.project.title='未命名论文';h.project.materials=[];h.project.blocks[0].text='';}
  if(stage==='structure'){h.project.materials=[];h.project.blocks[0].text='';}
  if(stage==='materials'){h.project.blocks[0].text='';h.project.blocks[0].materials=[{id:'m1'}];}
  if(stage==='block'){h.project.blocks[0].type='formula';h.project.blocks[0].text='\\frac{x_i}{\\mathrm{e}}';h.project.blocks[0].materials=[{id:'m1'}];}
  const before=JSON.stringify(h.project),context=assemblyTaskContext(h.project,'解释当前位置');const result=await h.E.runWorkbenchTask({prompt:'解释当前位置',projectID:h.project.id,assemblyContext:context,modelID:'chosen',thinkingLevel:'medium'});
  assert.deepEqual(h.requests[0].payload.tool_choice,{type:'function',function:{name:'read_assembly_context'}});assert.equal(JSON.parse(h.requests[0].payload.messages.at(-1).content).applicationContext.assembly.stage,stage);assert.equal(JSON.stringify(h.project),before);assert.ok(result.steps.includes('读取当前装配上下文'));
 }
 const stale=fixture();await assert.rejects(stale.E.runWorkbenchTask({prompt:'解释当前模块',projectID:stale.project.id,assemblyContext:{...assemblyTaskContext(stale.project),userText:'模型杜撰正文'}}),/已经变化/);assert.equal(stale.calls.length,0);
});
test('explicit assembly verification runs the actual checker and cannot claim facts have been certified',async()=>{
 const h=fixture([call('check_assembly_evidence',{}),payload=>{const result=toolResult(payload);assert.equal(result.issueCount,1);assert.equal(result.issues[0].blockID,'authored');return text('当前段落缺少支持素材；应补充已有证据。');}]),before=JSON.stringify(h.project);
 const result=await h.E.runWorkbenchTask({prompt:'请检查当前项目的证据缺口',projectID:h.project.id});assert.equal(h.calls.filter(row=>row.kind==='checkAssembly').length,1);assert.equal(JSON.stringify(h.project),before);assert.ok(result.steps.includes('检查装配证据'));
 const bare=fixture([text('证据已全部核验。')]);await assert.rejects(bare.E.runWorkbenchTask({prompt:'核证据',projectID:bare.project.id}),/装配证据检查尚未完成/);
});
test('selected-source reading uses all captured module bindings even when focus and preview move during the task',async()=>{
 let h;
 h=fixture([call('read_assembly_context',{}),payload=>{
  const result=toolResult(payload);assert.deepEqual(result.materials.map(row=>row.id),['material:m1','material:m2']);
  h.project.ui.blockID='another';h.project.ui.sectionID='section-2';
  return call('read_selected_source',{});
 },payload=>{
  const result=toolResult(payload);assert.equal(result.blockID,'authored');assert.deepEqual(result.sources.map(row=>row.id),['material:m1','material:m2']);assert.match(result.sources[0].text,/CNN/);
  assert.doesNotMatch(JSON.stringify(result),/personal resume/);return text('当前位置已有方法素材和待验证构想。[material:m1] [material:m2]');
 }]);
 h.project.blocks[0].materials=[{id:'m1'},{id:'m2'}];h.project.blocks.push(Manuscript.block('paragraph','section-2',{id:'another',text:'另一个主题的人工作品'}));
 const content=JSON.stringify(h.project.blocks),context=assemblyTaskContext(h.project,'解释当前位置');
 const result=await h.E.runWorkbenchTask({prompt:'解释当前位置',projectID:h.project.id,assemblyContext:context,selectedSource:{kind:'material',id:'private'},modelID:'chosen',thinkingLevel:'high'});
 assert.equal(h.requests.length,3);assert.equal(result.sources.length,2);assert.equal(result.model,'chosen');assert.equal(JSON.stringify(h.project.blocks),content);assert.equal(h.project.ui.blockID,'another');
});
test('captured assembly source reads reject real content edits instead of reading stale or unrelated module data',async()=>{
 let h;h=fixture([call('read_assembly_context',{}),()=>{h.project.blocks[0].text+=' changed after send';return call('read_selected_source',{});},payload=>{
  assert.match(payload.messages.at(-1).content,/当前人工内容已经变化/);return text('当前模块已经编辑，请重新发起讨论。');
 }]);
 h.project.blocks[0].materials=[{id:'m1'}];const context=assemblyTaskContext(h.project);
 const result=await h.E.runWorkbenchTask({prompt:'解释当前位置',projectID:h.project.id,assemblyContext:context});assert.match(result.text,/重新发起/);assert.equal(h.requests.length,3);
 assert.ok(!result.sources.some(row=>row.sourceText?.includes('changed after send')));
});
test('research decisions expose concrete options, receive a real answer and send regeneration as an explicit Pi tool result',async()=>{
 const decisions=[],question={question:'先核对哪一种证据？',options:['原文方法','数据划分'],basis:'用户正在检查当前研究条件。',sourceIDs:[]};
 const h=fixture([call('ask_research_question',question,'question-1'),payload=>{assert.equal(toolResult(payload).action,'regenerate');return call('ask_research_question',{...question,options:['跨域评估设置','独立验证集']},'question-2');},payload=>{assert.equal(toolResult(payload).answer,'独立验证集');return text('先检查独立验证集的来源与划分，暂不建立论文正文。');}]);
 const result=await h.E.runWorkbenchTask({prompt:'讨论研究路线并让我选择',modelID:'chosen',thinkingLevel:'high',onResearchQuestion:async request=>{decisions.push(request);return decisions.length===1?{action:'regenerate'}:{answer:'独立验证集'};}});
 assert.equal(decisions.length,2);assert.equal(decisions[0].id,'question-1');assert.deepEqual(plain(decisions[1].options),['跨域评估设置','独立验证集']);assert.equal(h.requests.length,3);assert.equal(result.materialPlacements,undefined);assert.ok(h.requests.every(row=>row.payload.model==='chosen'));
 assert.equal(result.researchDecisions.length,1);assert.equal(result.researchDecisions[0].answer,'独立验证集');
 const forged=fixture([call('ask_research_question',{...question,sourceIDs:['material:invented']}),text('请先检索实际资料。')]);let callbacks=0;await forged.E.runWorkbenchTask({prompt:'讨论研究路线',onResearchQuestion:async()=>{callbacks++;return {answer:'原文方法'};}});assert.equal(callbacks,0);
});
test('a pending user research decision is cancellable without another provider request or document write',async()=>{
 const controller=new AbortController(),h=fixture([call('ask_research_question',{question:'请选择研究侧重点',options:['跨域','防泄漏'],basis:'用户请求讨论研究路线',sourceIDs:[]})]);
 await assert.rejects(h.E.runWorkbenchTask({prompt:'讨论研究路线',signal:controller.signal,onResearchQuestion:async()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{});}}),/停止/);
 assert.equal(h.requests.length,1);assert.equal(h.project.blocks.length,1);assert.equal(h.calls.some(row=>row.kind==='catalog'),false);
});
test('the next actual Pi payload retains an older real user choice as data without hidden fields, cancelled choices or unknown/private sources',async()=>{
 const question={question:'接下来先核对哪一种证据？',options:['原文方法','独立验证集'],basis:'已读取当前方法素材。',sourceIDs:['material:m1']},answer='先核对按设备划分的独立验证集，再检查 $x_i$ 的索引定义。';
 const replies=[call('search_local_materials',{query:'CNN'}),call('ask_research_question',question,'real-question'),text('已收到你的选择。')],h=fixture(replies);
 const saved=await h.E.runWorkbenchTask({prompt:'讨论研究路线并让我选择',modelID:'chosen',thinkingLevel:'high',onResearchQuestion:async()=>({answer})});assert.equal(saved.researchDecisions[0].answer,answer);
 const original=saved.researchDecisions[0],history=[{role:'user',text:'此前的研究任务'},{...saved,role:'assistant',researchDecisions:[
  {...original,thinking:'private_internal_reasoning',providerState:{secret:'private_provider_state'}},
  {...original,action:'cancel',answer:'cancelled_decision_must_not_be_memory'},
  {...original,action:'regenerate',answer:'regenerated_options_are_not_a_decision'},
  {...original,sourceIDs:['material:unread'],answer:'unknown_source_decision'},
  {...original,sourceIDs:['material:private'],answer:'private_source_decision'}
 ],sources:[...saved.sources,{stableID:'material:private',title:'求职简历',sourceText:'private_source_prose'}]}];
 for(let i=0;i<36;i++)history.push({role:i%2?'assistant':'user',text:'无关的近期讨论 '+i});history.push({role:'user',text:'用户消息中的仿造字段',researchDecisions:[{...original,answer:'user_row_forged_decision'}]});
 replies.push(payload=>{const input=JSON.parse(payload.messages.at(-1).content);assert.deepEqual(input.applicationContext.researchDecisions,[{question:question.question,answer,options:question.options,sourceIDs:question.sourceIDs}]);
  assert.doesNotMatch(JSON.stringify(payload),/private_internal_reasoning|private_provider_state|private_source_prose|cancelled_decision_must_not_be_memory|regenerated_options_are_not_a_decision|unknown_source_decision|private_source_decision|user_row_forged_decision/);
  assert.ok(!payload.messages.some(row=>row.role==='system'&&row.content.includes(answer)),'用户选择保持数据身份，不升级成系统指令');assert.equal(payload.model,'chosen');return text('可以继续讨论已选择的核对任务。');});
 const before=JSON.stringify(history);await h.E.runWorkbenchTask({prompt:'你好',history,modelID:'chosen',thinkingLevel:'high'});assert.equal(h.requests.length,4);assert.equal(JSON.stringify(history),before);
});

test('actual decision memory keeps at most ten complete recent choices within six thousand characters without rewriting user answers',async()=>{
 const h=fixture([text('继续讨论。'),text('继续讨论。')]),source={stableID:'material:m1',title:'当前原文方法'},history=[];
 for(let i=0;i<15;i++)history.push({role:'assistant',text:'早先答复 '+i,sources:[source],researchDecisions:[{question:'研究选择 '+i,answer:'实际选择 '+i,options:['原文方法','独立验证集'],sourceIDs:[source.stableID]}]});
 await h.E.runWorkbenchTask({prompt:'你好',history});let values=JSON.parse(h.requests[0].payload.messages.at(-1).content).applicationContext.researchDecisions;assert.equal(values.length,10);assert.equal(values[0].answer,'实际选择 5');assert.equal(values.at(-1).answer,'实际选择 14');
 for(const row of history){row.researchDecisions[0].question+='完整问题'.repeat(60);row.researchDecisions[0].answer+='完整人工选择'.repeat(200);}
 const before=JSON.stringify(history);await h.E.runWorkbenchTask({prompt:'你好',history});values=JSON.parse(h.requests[1].payload.messages.at(-1).content).applicationContext.researchDecisions;assert.ok(values.length>0&&values.length<10);assert.ok(JSON.stringify(values).length<=6000);
 for(const value of values){const actual=history.flatMap(row=>row.researchDecisions).find(row=>row.question===value.question);assert.equal(value.answer,actual.answer);assert.deepEqual(value.options,actual.options);assert.deepEqual(value.sourceIDs,actual.sourceIDs);}assert.equal(JSON.stringify(history),before);
});

test('sources read before bounded recent history remain usable, while ambiguous local paper IDs are still rejected',async()=>{
 const old={id:'P1-T0',stableID:'evidence:paper:3:9:P1-T0',title:'原文方法',coverage:'此前读取的原文片段'},history=[{role:'user',text:'旧问题'},{role:'assistant',text:'旧答复',sources:[old]}];for(let i=0;i<16;i++)history.push({role:i%2?'assistant':'user',text:'新对话'+i});
 const h=fixture([text('继续根据此前原文片段核对。[P1-T0]')]);const result=await h.E.runWorkbenchTask({prompt:'继续',history});assert.equal(result.sources.length,1);assert.equal(result.sources[0].stableID,old.stableID);assert.match(result.text,/\[evidence:paper:3:9:P1-T0\]/);assert.equal(h.requests[0].payload.messages.some(row=>row.content==='旧答复'),false);
 const ambiguous=fixture([text('依据原文。[P1-T0]')]);await assert.rejects(ambiguous.E.runWorkbenchTask({prompt:'继续',history:[{role:'assistant',text:'先前答复',sources:[old,{...old,stableID:'evidence:paper:4:10:P1-T0'}]}]}),/不明确/);
});

test('unrecognized tool arguments retain strict Pi validation and a bare material claim cannot bypass the built-in search', async () => {
	const h = fixture([call('search_local_materials', {query: '卷积神经网络', arbitraryField: 'unrecognized'}), payload => {
		assert.match(payload.messages.at(-1).content, /Validation failed/);
		assert.deepEqual(payload.tool_choice, {type: 'function', function: {name: 'search_local_materials'}});
		return text('检索已完成。');
	}]);
	await assert.rejects(h.E.runWorkbenchTask({prompt: '请推荐我可以使用的素材'}), /素材检索尚未完成/);
	assert.equal(h.calls.includes('preparePassages'), false);
	const plainReply = fixture([text('可以使用卷积方法素材。')]);
	await assert.rejects(plainReply.E.runWorkbenchTask({prompt: '请推荐已有素材'}), /素材检索尚未完成/);
	assert.equal(plainReply.requests.length, 1);
});

test('diagnostics with tool execution disabled send no function schemas or tool-choice parameter', async () => {
	const h = fixture([payload => {
		assert.ok(!Object.hasOwn(payload, 'tools')); assert.ok(!Object.hasOwn(payload, 'tool_choice'));
		return text('你好，可以讨论研究问题。');
	}]);
	await h.E.runWorkbenchTask({prompt: '你好', modelID: 'selected-model', allowToolExecution: false});
	assert.equal(h.requests.length, 1);
});
test('current visual detail provides live paper pixels and complete local definitions in its first Pi request',async()=>{
	const asset={id:'eq8',attachmentID:9,paperItemID:3,pageIndex:2,bbox:[1,2,30,40],path:'trusted-original.png',kind:'formula',label:'Eq. 8',caption:'T\nV\nX\nX',paperTitle:'来源论文'},h=fixture([payload=>{
		const content=payload.messages.at(-1).content;assert.equal(content.length,2);assert.equal(content[1].image_url.url,'data:image/png;base64,actual-pixels');const input=JSON.parse(content[0].text);
		assert.match(input.currentVisualEvidence.sources[0].text,/\\frac/);assert.match(input.currentVisualEvidence.sources[1].text,/deterministic hidden state/);assert.ok(!JSON.stringify(input).includes(asset.caption));return text('公式对时间和车辆索引求平均，以 $A_v[t]$ 表示当前信息年龄。[evidence:asset:9:eq8]');
	}]);
	h.items.get(9).isPDFAttachment=()=>true;
	h.E.assets={active:new Map([[9,{assets:[asset]}]]),position:()=>({pageIndex:2,rects:[[1,2,30,40]]}),contextFor:async()=>[{id:'definition',text:'h_t is a deterministic hidden state.',pageIndex:2,attachmentID:9}]};
	h.E.store={get:()=>({latex:'\\frac{1}{T}\\sum_t A_v[t]'})};h.E.previewImage=async path=>{assert.equal(path,'trusted-original.png');return 'data:image/png;base64,actual-pixels';};
	const result=await h.E.runWorkbenchTask({prompt:'解释这个公式在文章中的作用',mode:'discuss',modelID:'selected-vision',thinkingLevel:'high',allowToolExecution:false,selectedSource:{id:3,kind:'paper',paperItemID:3,evidenceAsset:{...asset,path:'untrusted-ui-path'}}});
	assert.equal(h.requests.length,1);assert.equal(h.requests[0].payload.model,'selected-vision');assert.equal(result.sources[0].attachmentID,9);assert.equal(result.sources.length,2);
});

test('two identical greetings after a 63-source answer preserve real roles without replaying every source as a new result', async () => {
	const savedSources = Array.from({ length: 63 }, (_, index) => ({ id: 'saved-' + index, stableID: 'web:saved-' + index, title: '已检索论文 ' + index, coverage: '仅依据摘要', abstract: '此前真正保存的摘要' }));
	const history = [{ role: 'user', text: '比较这些论文的证据' }, { role: 'assistant', text: '此前对话的比较，仍需核验全文。[web:saved-0]', sources: savedSources }], before = JSON.stringify(history), diagnostics = [];
	const h = fixture([payload => {
		assert.deepEqual(payload.messages.map(row => row.role), ['system', 'user', 'assistant', 'user']);
		assert.equal(payload.messages[2].content, history[1].text);
		assert.equal(JSON.parse(payload.messages.at(-1).content).historySources.length, 1);
		return text('你好，可以继续讨论研究问题。');
	}, payload => {
		assert.deepEqual(payload.messages.map(row => row.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
		assert.equal(payload.messages[3].content, '你好');
		assert.equal(payload.messages[4].content, '你好，可以继续讨论研究问题。');
		assert.equal(JSON.parse(payload.messages.at(-1).content).question, '你好');
		return text('你好，之前摘要中的比较仍需要全文核验。[web:saved-0]');
	}]);
	const first = await h.E.runWorkbenchTask({ prompt: '你好', mode: 'discuss', modelID: 'selected-model', history, onDiagnostics: value => diagnostics.push(value) });
	assert.equal(first.sources.length, 0, 'uncited earlier papers are not reported as a fresh source read');
	const second = await h.E.runWorkbenchTask({ prompt: '你好', mode: 'discuss', modelID: 'selected-model', history: [...history, { role: 'user', text: '你好' }, { role: 'assistant', text: first.text, sources: first.sources }], onDiagnostics: value => diagnostics.push(value) });
	assert.equal(h.requests.length, 2); assert.equal(h.calls.includes('resolveModel'), false); assert.ok(h.requests.every(row => row.payload.model === 'selected-model'));
	assert.equal(second.sources.length, 1); assert.equal(second.sources[0].stableID, savedSources[0].stableID); assert.equal(second.sources[0].coverage, '仅依据摘要');
	assert.equal(diagnostics[0].roleCounts.assistant, 1); assert.equal(diagnostics[1].roleCounts.assistant, 2); assert.equal(JSON.stringify(history), before);
});

test('saved source continuity never accepts a fabricated follow-up citation', async () => {
	const h = fixture([text('无法支持这条引用。[web:invented]')]);
	await assert.rejects(h.E.runWorkbenchTask({ prompt: '继续讨论', history: [{ role: 'assistant', text: '此前讨论', sources: [{ stableID: 'web:known', title: '已保存来源' }] }] }), /未读取的来源/);
	assert.equal(h.requests.length, 1);
});

test('a 74-page review with 429 paragraphs is read by bounded excerpts; a greeting never replays the full paper',async()=>{
 const paragraphs=Array.from({length:429},(_,i)=>({id:'P1-L'+i,label:'原文段落 '+i,text:(i===287?'robustness under unknown channel. ':'CNN architectures and evaluation. ').repeat(140),attachmentID:9,pageIndex:Math.floor(i/6)})),diagnostics=[];
 const h=fixture([call('read_selected_source',{}),payload=>{const result=toolResult(payload);assert.equal(result.totalExcerptCount,429);assert.ok(result.excerptCount<=24);assert.ok(result.sources.some(row=>row.id.endsWith(':P1-L287')));assert.ok(result.sources.reduce((sum,row)=>sum+row.text.length,0)<=48000);return text('综述讨论未知信道下的鲁棒性。[evidence:paper:3:9:P1-L287]');},payload=>{const last=JSON.parse(payload.messages.at(-1).content);assert.equal(last.historySources.length,1);assert.equal(last.historySources[0].id,'evidence:paper:3:9:P1-L287');assert.ok(JSON.stringify(payload).length<18000);return text('你好，可以继续讨论这篇综述。');}],{library:{describe:item=>({id:item.id,title:item.title}),sources:async()=>({sources:paragraphs,warnings:[]})}});
 const first=await h.E.runWorkbenchTask({prompt:'robustness unknown channel',mode:'discuss',selectedSource:{kind:'paper',id:3},modelID:'selected-model',onDiagnostics:value=>diagnostics.push(value)}),second=await h.E.runWorkbenchTask({prompt:'你好',mode:'discuss',modelID:'selected-model',history:[{role:'user',text:'robustness unknown channel'},{role:'assistant',text:first.text,sources:first.sources}],onDiagnostics:value=>diagnostics.push(value)});
 assert.equal(h.requests.length,3);assert.equal(second.sources.length,0);assert.ok(diagnostics[1].textCharacters<60000);assert.ok(diagnostics[2].textCharacters<8000);assert.ok(h.requests.every(row=>row.payload.model==='selected-model'));assert.equal(paragraphs[287].text.length>2400,true,'原文未被截断覆盖');
});

test('current-paper search passes the explicit paper scope to the existing passage index',async()=>{
 let selection;const h=fixture([call('search_current_paper',{query:'式 3 假设'}),text('当前式(3)的变量定义需要按原文核验。[evidence:passage:document:3]')],{findPaperPassages:async(query,options)=>{selection={query,options};return [{m:{id:'hit',sourceRecordID:'passage:document:3',sourceText:'The equation (3) assumes independent samples.',paperItemID:3,attachmentID:9,pageIndex:2}}];}});
 const result=await h.E.runWorkbenchTask({prompt:'解释当前论文式(3)',selectedSource:{id:3,kind:'paper'}});assert.deepEqual(plain(selection),{query:'式 3 假设',options:{paperID:3,limit:12}});assert.equal(result.sources[0].paperItemID,3);assert.equal(h.requests.length,2);
});

test('a real-shaped second-turn HTTP 400 retains safe diagnostics and stops without retry or substitution', async () => {
	const h = fixture([text('你好，可以继续讨论。'), () => { throw providerHTTPError(400, { error: { code: 'invalid_messages', message: 'messages invalid; echoed private transcript controlled-key https://private.invalid' } }); }]), diagnostics = [];
	const first = await h.E.runWorkbenchTask({ prompt: '你好', mode: 'discuss', modelID: 'selected-model', onDiagnostics: value => diagnostics.push(value) });
	await assert.rejects(h.E.runWorkbenchTask({ prompt: '你好', mode: 'discuss', modelID: 'selected-model', history: [{ role: 'user', text: '你好' }, { role: 'assistant', text: first.text }], onDiagnostics: value => diagnostics.push(value) }), { message: '服务返回 HTTP 400：对话或工具消息格式与接口不兼容，本轮未执行工具' });
	assert.equal(h.requests.length, 2); assert.equal(h.calls.includes('resolveModel'), false); assert.equal(diagnostics[1].roleCounts.assistant, 1); assert.ok(diagnostics[1].requestBytes > diagnostics[0].requestBytes);
	assert.doesNotMatch(JSON.stringify(diagnostics), /private|controlled-key|你好|讨论/);
});

test('auto search really invokes metadata retrieval, preserves unknown citation data and pagination', async () => {
	const h = fixture([call('search_public_papers', { query: 'domain adaptation AMC' }), payload => {
		const result = toolResult(payload);
		assert.equal(result.records.length, 2);
		assert.equal(result.records[0].impactFactor, null);
		assert.equal(result.records[1].coverage, '仅依据题录');
		return text('找到两个公开题录候选；第一篇仅依据摘要，全文尚未获取。[web:10.1234/new]');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '查找跨域调制识别论文', mode: 'auto' });
	assert.match(h.requests[0].payload.messages[0].content, /当前任务类型：search/);
	assert.deepEqual(plain(result.searchState), { query: 'domain adaptation AMC', provider: 'controlled-search', limit: 20, page: 1, hasMore: true });
	assert.equal(result.sources.length, 2);
	assert.equal(result.sources[0].citationCount, null);
	assert.equal(h.calls.filter(row => row.kind === 'paperSearch').length, 1);
	assert.equal(h.calls.includes('resolveModel'), true, 'default model still uses migration resolver');
});

test('auto evaluation creates a real tool result and canonicalizes old plan source IDs', async () => {
	const h = fixture([call('evaluate_experiment_plan', { idea: '评估域划分的可行性' }), payload => {
		const result = toolResult(payload);
		assert.equal(result.versionID, 'plan-1');
		assert.deepEqual(result.closest.map(row => row.sourceID), ['material:m1', 'web:10.1234/prior']);
		assert.equal(result.status, '实验计划，尚未执行实验');
		assert.deepEqual(result.pending, ['真实数据', '算力预算']);
		return text('可行性仍受数据与算力约束，先做防泄漏的最小验证；接近工作的差异需要核验。[web:10.1234/prior]');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '评估这个实验方案可行性', mode: 'auto', projectID: 'project-1', modelID: 'selected-evaluation', thinkingLevel: 'medium' });
	assert.equal(result.planVersionID, 'plan-1');
	assert.equal(result.projectID, 'project-1');
	const evaluation = h.calls.find(row => row.kind === 'evaluate');
	assert.equal(evaluation.options.modelConfig.model, 'selected-evaluation');
	assert.equal(evaluation.options.modelConfig.selectedModel, true);
	assert.equal(evaluation.options.modelConfig.thinkingLevel, 'medium');
	assert.ok(evaluation.signal instanceof AbortSignal);
	assert.equal(result.sources.find(row => row.materialID === 'm1').stableID, 'material:m1');
});

test('theme and order tools return reviewable proposals without modifying assets or prose', async () => {
	const h = fixture([call('search_local_materials',{query:''}),payload=>{assert.equal(toolResult(payload).materials[0].id,'material:m1');assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'suggest_material_topics'}});return call('suggest_material_topics', { instruction: '按研究问题整理素材主题' });}, text('已准备主题归组建议，确认后应用。[m1]')]);
	const before = JSON.stringify(h.project);
	const organized = await h.E.runWorkbenchTask({ prompt: '按主题整理素材', projectID: 'project-1', modelID: 'selected-organizer' });
	assert.equal(organized.topicSuggestion.groups.length, 1);
	assert.match(organized.text,/\[material:m1\]/);assert.equal(organized.sources.find(row=>row.id==='m1').stableID,'material:m1');
	assert.equal(h.calls.find(row => row.kind === 'topics').options.modelConfig.model, 'selected-organizer');
	assert.equal(JSON.stringify(h.project), before);
	const layout = fixture([call('list_project_materials', {}), payload => {
		assert.deepEqual(toolResult(payload).materials.map(row => row.id), ['m1', 'm2']);
		assert.deepEqual(payload.tool_choice, {type: 'function', function: {name: 'suggest_material_order'}});
		return call('suggest_material_order', { order: ['m2', 'm1'], reason: '先核对假设，再阅读证据' }, 'sort-1');
	}, text('素材顺序建议已经准备好，正文和证据关系保持原样。[m2]')]);
	const layoutBefore = JSON.stringify(layout.project);
	const ordered = await layout.E.runWorkbenchTask({ prompt: '梳理素材的逻辑顺序', projectID: 'project-1' });
	assert.deepEqual(layout.requests[0].payload.tool_choice, {type: 'function', function: {name: 'list_project_materials'}});
	assert.equal(layout.requests.at(-1).payload.tool_choice, 'auto');
	assert.deepEqual(plain(ordered.layoutSuggestion), { order: ['m2', 'm1'], baseOrder: ['m1', 'm2'] });
	assert.equal(JSON.stringify(layout.project), layoutBefore);
	assert.match(ordered.text,/\[material:m2\]/);assert.equal(ordered.sources.find(row=>row.id==='m2').stableID,'material:m2');
});

test('unknown project, missing required project and blocked authorship fail before any model or credential access', async () => {
	for (const request of [
		{ prompt: '普通学术问题', projectID: 'missing' },
		{ prompt: '评估实验方案' }, { prompt: '按主题整理素材' }, { prompt: '调整布局' },
		{ prompt: '帮我写论文正文', projectID: 'project-1' },
	]) {
		const h = fixture();
		await assert.rejects(h.E.runWorkbenchTask(request), /研究项目|AI 不/);
		assert.equal(h.requests.length, 0);
		assert.equal(h.calls.length, 0);
	}
});

test('an explicit image request runs the configured generator and reports a saved local AI image through Pi',async()=>{
	let generated=0;const h=fixture([payload=>{assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'generate_research_image'}});return call('generate_research_image',{prompt:'数据流程说明图'});},payload=>{assert.equal(toolResult(payload).provenance,'AI 生成构想素材，不是来源证据或实验结果');return text('图片已生成并保存，可用作构想素材。');}],{generateResearchImage:async(prompt)=>{generated++;assert.equal(prompt,'数据流程说明图');return {path:'/library/writing-images/controlled.png',model:'gpt-image-2.5-flare'};}});
	const result=await h.E.runWorkbenchTask({prompt:'生成一张数据流程图',modelID:'selected-chat-model'});
	assert.equal(generated,1);assert.equal(h.requests.length,2);assert.equal(result.generatedImages[0].imagePath,'/library/writing-images/controlled.png');assert.equal(result.generatedImages[0].model,'gpt-image-2.5-flare');assert.ok(h.requests.every(request=>request.payload.model==='selected-chat-model'));
});

test('Ask permission can cancel image generation before any paid image request',async()=>{
	let generated=0;const h=fixture([call('generate_research_image',{prompt:'数据流程说明图'}),text('已取消。')],{generateResearchImage:async()=>{generated++;throw Error('must not run');}});
	const result=await h.E.runWorkbenchTask({prompt:'生成一张数据流程图',executionMode:'ask',onToolPermission:async()=>false});assert.equal(generated,0);assert.match(result.text,/取消.*图片生成/);assert.equal(result.generatedImages,undefined);
});

test('search/evaluate/organize/layout cannot claim completion without a successful corresponding tool', async () => {
	for (const mode of ['search', 'evaluate', 'organize', 'layout']) {
		const h = fixture([text('已经完成全部任务。')]);
		await assert.rejects(h.E.runWorkbenchTask({ prompt: '执行当前任务', mode, projectID: 'project-1' }), /尚未完成/);
		assert.equal(h.requests.length, 1);
		assert.equal(h.calls.some(row => ['evaluate', 'topics', 'paperSearch'].includes(row.kind)), false);
	}
});

test('forged canonical and legacy evidence references are rejected instead of being saved as facts', async () => {
	for (const id of ['material:missing', 'evidence:missing', 'web:missing', 'paper:9999', 'source:made-up', 'web-unknown', 'Q999', '999']) {
		const h = fixture([text('这是未经读取的结论。[' + id + ']')]);
		await assert.rejects(h.E.runWorkbenchTask({ prompt: '解释协变量漂移的概念' }), /未读取的来源/);
	}
});

test('selected material reads the current asset excerpt without pulling in an entire unrelated paper', async () => {
	const h = fixture([call('read_selected_source', {}), payload => {
		const result = toolResult(payload);
		assert.equal(result.id, 'material:m1');
		assert.equal(result.text, rawMaterials[0].sourceText);
		assert.equal(result.coverage, '已保存原文摘录');
		return text('这条素材原文涉及局部特征提取。[material:m1]');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '解释这条方法素材', selectedSource: { ...rawMaterials[0], kind: 'material', sourceText: 'stale text from an earlier revision' } });
	assert.equal(h.calls.some(row => row.kind === 'readPaper'), false);
	assert.equal(result.sources[0].sourceText, rawMaterials[0].sourceText);
});

test('paper reading canonicalizes anchors and mismatched/deleted sources cannot become evidence', async () => {
	const h = fixture([call('read_selected_source', {}), payload => {
		const result = toolResult(payload);
		assert.equal(result.sources[0].id, 'evidence:paper:3:9:P1-T0');
		return text('原文给出了数据划分说明。[evidence:paper:3:9:P1-T0]');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '解释论文的划分依据', selectedSource: { id: 3, kind: 'paper', title: '论文' } });
	assert.equal(result.sources[0].anchor.paperItemID, 3);
	assert.equal(result.sources[0].anchor.attachmentID, 9);
	assert.equal(result.sources[0].anchor.pageIndex, 2);
	const mismatch = fixture([call('read_selected_source', {}), payload => { assert.match(payload.messages.at(-1).content, /选区与所选论文不一致/); return text('不能核验。[evidence:paper:3:9:P1-T0]'); }]);
	await assert.rejects(mismatch.E.runWorkbenchTask({ prompt: '解释该论文', selectedSource: { id: 3, kind: 'paper', selection: { attachmentID: 10, text: '别的论文' } } }), /未读取的来源/);
	assert.equal(mismatch.calls.some(row => row.kind === 'readPaper'), false);
});

test('malformed tool arguments, prohibited nested instructions and nonexistent order cannot fake successful tasks', async () => {
	const cases = [
		['search', call('search_public_papers', {}), /Validation failed/],
		['evaluate', call('evaluate_experiment_plan', { idea: '帮我写论文正文' }), /AI 不代写/],
		['layout', call('suggest_material_order', { order: ['missing'], reason: '不存在的素材' }), /不存在或重复/],
	];
	for (const [mode, response, expected] of cases) {
		let toolMessage;
		const h = fixture([...(mode === 'layout' ? [call('list_project_materials', {})] : []), response, payload => { toolMessage = payload.messages.at(-1).content; return text('任务已完成。'); }]);
		await assert.rejects(h.E.runWorkbenchTask({ prompt: '执行当前研究任务', mode, projectID: 'project-1' }), /尚未完成/);
		assert.match(toolMessage, expected);
		assert.equal(h.calls.some(row => ['paperSearch', 'evaluate'].includes(row.kind)), false);
	}
});

test('PPT tool invokes the existing ready-checking workflow whose API returns void', async () => {
	const h = fixture([call('open_presentation_workflow', {}), payload => { assert.equal(toolResult(payload).opened, true); return text('已打开内置汇报，请选择范围并确认大纲。'); }]);
	await h.E.runWorkbenchTask({ prompt: '打开组会 PPT 流程', selectedSource: { id: 9, kind: 'paper' } });
	assert.deepEqual(plain(h.calls.find(row => row.kind === 'openPPT').options.papers), [{ id: 3, title: '来源论文' }]);
});

test('restricted gateway rejects a forbidden selected model without substituting another one', async () => {
	const h = fixture(); h.settings.endpoint = 'https://openai.goldgom.top/v1'; h.settings.model = 'gpt-6-luna';
	await assert.rejects(h.E.runWorkbenchTask({ prompt: '解释协变量漂移', modelID: 'another-model' }), /仅开放 GPT-6 Luna/);
	assert.equal(h.calls.length, 0);
	assert.equal(h.requests.length, 0);
});

test('model catalog cache follows a changed explicit configuration at the same endpoint', async () => {
	const h = fixture();
	assert.deepEqual(plain((await h.E.workbenchModels()).map(row => row.id)), ['configured-model', 'listed-model']);
	h.settings.model = 'changed-model';
	assert.deepEqual(plain((await h.E.workbenchModels()).map(row => row.id)), ['changed-model', 'listed-model']);
	assert.equal(h.calls.filter(row => row === 'model-list').length, 2);
});

test('source explanation of robustness remains a discussion without a project', async () => {
	const h = fixture([text('鲁棒性检查用于比较方法在条件变化下的表现，具体设置仍需依据原文核验。')]);
	const result = await h.E.runWorkbenchTask({ prompt: '解释这篇论文的鲁棒性检查', mode: 'auto' });
	assert.ok(result.text);
	assert.match(h.requests[0].payload.messages[0].content, /当前任务类型：discuss/);
});

test('chat attachments contain actual document text and image pixels in the pinned Pi request', async () => {
 const id='evidence:chat:attachment:71:0',calls=[];
 const h=fixture([call('read_attached_sources',{}),payload=>{
  const result=toolResult(payload);assert.equal(result.sources[0].text,'The disjoint held-out devices are assigned before preprocessing.');
  assert.equal(result.imageCount,1);const user=payload.messages.find(row=>row.role==='user'&&Array.isArray(row.content));
  assert.ok(user);assert.match(user.content.find(part=>part.type==='text').text,/disjoint held-out/);
  assert.equal(user.content.find(part=>part.type==='image_url').image_url.url,'data:image/png;base64,aW1hZ2UtcGl4ZWxz');
  assert.equal(payload.reasoning_effort,'high');assert.equal(payload.model,'selected-vision-model');
  assert.doesNotMatch(JSON.stringify(payload),/C:\\|original-private-path/);return text('应核对按设备划分是否先于预处理。['+id+']');
 }],{chatAttachments:{async read(refs,options){calls.push({refs,options});return {rows:[{id,stableID:id,title:'研究附件',kind:'material',sourceText:'The disjoint held-out devices are assigned before preprocessing.',coverage:'实际DOCX内容片段'}],images:[{type:'image',mimeType:'image/png',data:'aW1hZ2UtcGl4ZWxz'}],warnings:[]};}}});
 h.settings.reasoningParameter='reasoning_effort';const refs=[{id:'attachment:71',title:'文件名不能替代全文.docx'}];
 const result=await h.E.runWorkbenchTask({prompt:'解释附加文档中的数据划分，并解读图片。',attachments:refs,mode:'discuss',modelID:'selected-vision-model',thinkingLevel:'high'});
 assert.equal(calls.length,1);assert.deepEqual(calls[0].refs,refs);assert.equal(result.sources[0].stableID,id);assert.ok(result.steps.includes('读取附加资料'));
});

test('unreadable attached documents fail before any model request without fabricated content',async()=>{
 const h=fixture([],{chatAttachments:{async read(){throw Error('附件尚未下载到本机。');}}});
 await assert.rejects(()=>h.E.runWorkbenchTask({prompt:'解读附加文件',attachments:[{id:'attachment:72'}]}),/尚未下载/);assert.equal(h.requests.length,0);
});
test('current session exclusions filter saved answers, selected paper previews and local search evidence before actual Pi requests',async()=>{
 const session={id:'scope-isolated',attachments:[{id:'attachment:9',attachmentID:9,paperItemID:3,kind:'pdf',selected:false}]},history=[{role:'user',text:'先前的问题',attachments:plain(session.attachments)},{role:'assistant',text:'excluded-secret-from-an-old-file',sources:[{id:'old',stableID:'evidence:chat:attachment:9:0',attachmentID:9,paperItemID:3,sourceText:'excluded-secret-source'}]}],before=JSON.stringify(history),reads=[];
 const h=fixture([payload=>{assert.doesNotMatch(JSON.stringify(payload.messages),/excluded-secret/);const input=JSON.parse(payload.messages.at(-1).content);assert.equal(input.applicationContext.selectedSource,null);assert.equal(input.historySources,undefined);return call('read_selected_source',{});},payload=>{assert.deepEqual(toolResult(payload).sources,[]);return call('search_local_materials',{query:'CNN'});},payload=>{const result=toolResult(payload);assert.deepEqual(result.materials,[]);assert.deepEqual(result.passages,[]);return text('本轮未选择这份资料，可以选择后再查看具体证据。');}],{
  workbenchConversations:{get:id=>id===session.id?plain(session):null,subscribe:()=>()=>{}},chatAttachments:{async read(refs,options){reads.push({refs:plain(refs),sessionID:options.sessionID});return {rows:[],images:[],warnings:[]};}}
 });
 const result=await h.E.runWorkbenchTask({prompt:'讨论当前资料',mode:'discuss',sessionID:session.id,history,selectedSource:{id:3,paperItemID:3,kind:'paper',title:'已取消选择的论文'}});
 assert.equal(reads.length,0,'没有选用资料时不调用文件读取器');assert.equal(h.calls.some(value=>value?.kind==='readPaper'),false);assert.equal(result.sources.length,0);assert.equal(JSON.stringify(history),before);
});
test('a separately selected material can be read even when the parent PDF is unselected',async()=>{
 const session={id:'local-material-scope',attachments:[{id:'attachment:9',attachmentID:9,paperItemID:3,kind:'pdf',selected:false},{id:'material:m1',materialID:'m1',attachmentID:9,paperItemID:3,selected:true}]};
 const h=fixture([call('read_selected_source',{}),payload=>{assert.equal(toolResult(payload).id,'material:m1');assert.match(toolResult(payload).text,/局部特征/);return text('这份单独选入的素材说明 CNN 提取局部特征。[material:m1]');}],{workbenchConversations:{get:()=>plain(session),subscribe:()=>()=>{}},chatAttachments:{read:async()=>({rows:[],images:[],warnings:[]})}});
 const result=await h.E.runWorkbenchTask({prompt:'解释这份素材',mode:'discuss',sessionID:session.id,selectedSource:{...plain(rawMaterials[0]),kind:'material'}});assert.equal(result.sources[0].stableID,'material:m1');
});
test('changing file scope during the provider response stops its old answer and releases the conversation subscription',async()=>{
 const session={id:'scope-changes',attachments:[{id:'attachment:71',attachmentID:71,kind:'text',selected:true}]};let listener,released=0;
 const h=fixture([()=>{session.attachments[0].selected=false;listener();return text('不能保存的旧范围回答');}],{workbenchConversations:{get:()=>plain(session),subscribe:callback=>{listener=callback;return()=>released++;}},chatAttachments:{read:async()=>({rows:[{id:'read',stableID:'evidence:chat:attachment:71:0',attachmentID:71,sourceText:'实际已经读取的文本'}],images:[],warnings:[]})}});
 await assert.rejects(()=>h.E.runWorkbenchTask({prompt:'解释所选文本',mode:'discuss',sessionID:session.id}),/资料选择已变化.*本次任务已停止/);assert.equal(released,1);assert.equal(h.requests.length,1);
});
test('ordinary clear explanations remain direct even when research choice cards are available',async()=>{
 let questions=0;const h=fixture([text('鲁棒性指条件变化时仍保持表现的能力。')]);
 const result=await h.E.runWorkbenchTask({prompt:'解释鲁棒性的含义',mode:'discuss',onResearchQuestion:async()=>{questions++;return {answer:'无需选项'};}});
 assert.equal(questions,0);assert.match(result.text,/条件变化/);assert.match(h.requests[0].payload.messages[0].content,/结构范文选择或材料取舍/);
});
