/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { WORKBENCH_MODES, resolveWorkbenchMode, advanceHomeOverscroll, validateMaterialOrder, mergeMaterialOrder, bindWorkbenchEvidence, workbenchSessions, isAcademicWorkbenchSource, workbenchSourceIdentity, researchConversationContext, requestsMaterialPlacement, boundAssemblyContext, bindWorkbenchCitations } from '../../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import { assemblyTaskContext } from '../../../chrome/content/zotero/research/manuscript/assembly-task-context.mjs';
import * as Catalog from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Conversations from '../../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as Attachments from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';

test('workbench modes cover research and organization without a manuscript or image tool', () => {
	assert.deepEqual(WORKBENCH_MODES.map(mode => mode.id), ['auto', 'search', 'evaluate', 'organize', 'layout']);
	assert.equal(resolveWorkbenchMode('auto', '请查找相关的论文'), 'search');
	assert.equal(resolveWorkbenchMode('auto', '请按研究主题整理素材'), 'organize');
	assert.equal(resolveWorkbenchMode('auto', '整理素材的逻辑顺序'), 'layout');
	assert.equal(resolveWorkbenchMode('auto', '分析这个实验方案的可行性'), 'evaluate');
	assert.equal(resolveWorkbenchMode('auto', '这段证据的限制是什么'), 'discuss');
	assert.equal(resolveWorkbenchMode('search', '实验方案'), 'search');
	for (const prompt of ['解释这篇论文的鲁棒性检查', '什么是数据预处理', '解读文中的消融实验', '解释作者如何设计消融实验', '翻译论文的实验方案']) assert.equal(resolveWorkbenchMode('auto', prompt), 'discuss');
	assert.equal(resolveWorkbenchMode('auto', '请制定当前项目的鲁棒性实验方案'), 'evaluate');
	assert.equal(resolveWorkbenchMode('auto', '解释背景，然后设计实验方案'), 'evaluate');
	assert.equal(resolveWorkbenchMode('auto', '请搜索论文并解释方法'), 'search');
	assert.equal(resolveWorkbenchMode('auto', '整理素材并说明理由'), 'organize');
	assert.equal(resolveWorkbenchMode('auto', '梳理素材的逻辑顺序并解释原因'), 'layout');
	for (const prompt of ['请你推荐我可以使用的素材', '查找已有素材', '请推荐素材并说明依据']) assert.equal(resolveWorkbenchMode('auto', prompt), 'materials');
	for (const prompt of ['不用搜索素材，只解释概念', '为什么素材检索会报错', '解释推荐素材的方法']) assert.equal(resolveWorkbenchMode('auto', prompt), 'discuss');
	assert.equal(resolveWorkbenchMode('auto', '请你帮我设计一下我要写的流程'), 'layout');
	assert.equal(resolveWorkbenchMode('auto', '请推荐适合当前项目的论文'), 'search');
});

test('only deliberate successive upward wheel input at the home boundary enters the workbench', () => {
	let state = advanceHomeOverscroll(null, { deltaY: -70, now: 100, atTop: true });
	assert.equal(state.enter, false);
	state = advanceHomeOverscroll(state, { deltaY: -60, now: 250, atTop: true });
	assert.equal(state.enter, true);
	for (const override of [{ blocked: true }, { atTop: false }, { deltaY: 100 }]) {
		assert.equal(advanceHomeOverscroll(state, { deltaY: -90, now: 300, atTop: true, ...override }).enter, false);
	}
	assert.equal(advanceHomeOverscroll(state, { deltaY: -100, now: 1500, atTop: true }).enter, false, 'a fresh gesture cannot reuse stale accumulated distance');
});

test('existing material insertion is an explicit application action, while negative and explanatory prompts cannot authorize it',()=>{
 for(const prompt of ['我确认，随便挑一个素材放进我的装配并解释','请把素材插入当前论文','Can you add existing material to this assembly?']){assert.equal(requestsMaterialPlacement(prompt),true);assert.equal(resolveWorkbenchMode('discuss',prompt),'place');}
 for(const prompt of ['不要把素材放进装配','不用插入素材到论文，只解释','怎么把素材插入装配','Do not add material to this assembly.','Explain how to add material to assembly.'])assert.equal(requestsMaterialPlacement(prompt),false,prompt);
 assert.equal(resolveWorkbenchMode('auto','请检查装配的证据缺口'),'check');assert.equal(resolveWorkbenchMode('auto','核证据'),'check');assert.equal(resolveWorkbenchMode('auto','核对卷积网络的原文证据'),'discuss');
});

test('bound assembly context verifies the exact current block, stage, source set and human LaTeX/table content',()=>{
 const project={id:'p',title:'实际标题',sections:[{id:'s',title:'方法'}],blocks:[{id:'b',sectionID:'s',type:'formula',text:'\\sum_i x_i',materials:[{id:'m1'},{id:'m2'}]}],materials:[{id:'m1'},{id:'m2'}],ui:{sectionID:'s',blockID:'b'}},context=assemblyTaskContext(project,'讨论这些变量');
 assert.equal(boundAssemblyContext(context,project,project.materials).userText,'\\sum_i x_i');
 for(const patch of [{projectID:'other'},{stage:'structure'},{materialIDs:['m1','m1']},{userText:'invented'},{blockID:'missing'}])assert.throws(()=>boundAssemblyContext({...context,...patch},project,project.materials));
 assert.throws(()=>boundAssemblyContext(context,project,[{id:'m1'}]),/不存在/);
 project.blocks[0]={...project.blocks[0],type:'table',text:'',table:{rows:[[{text:'x_i'},{text:'1'}],[{text:'hidden',hidden:true},{text:'中文'}]]}};
 const table=boundAssemblyContext(assemblyTaskContext(project),project,project.materials);assert.equal(table.userText,'x_i\t1\n中文');
 project.blocks[0].text='';project.blocks[0].type='paragraph';delete project.blocks[0].table;assert.equal(boundAssemblyContext(assemblyTaskContext(project),project,project.materials).stage,'materials');
});

test('citation aliases resolve only actual unique sources and preserve mathematical and code brackets',()=>{
 const sources=[{id:'m1',stableID:'material:m1'},{id:'P1-T0',stableID:'evidence:paper:3:9:P1-T0'},{id:'P1-T0',stableID:'evidence:paper:4:10:P1-T0'}];
 assert.equal(bindWorkbenchCitations('依据 [m1]，$x[1]$ 与 `list[1]`。',sources),'依据 [material:m1]，$x[1]$ 与 `list[1]`。');
 assert.throws(()=>bindWorkbenchCitations('依据 [P1-T0]',sources),/不明确/);assert.throws(()=>bindWorkbenchCitations('[material:invented]',sources),/未读取的来源/);
 assert.equal(bindWorkbenchCitations('[m1, material:m1]',sources),'[material:m1] [material:m1]');
 const foreign=vm.runInNewContext('new Map([["a",{id:"m1",stableID:"material:m1"}]])');assert.equal(bindWorkbenchCitations('[m1]',foreign),'[material:m1]');
});
test('paper reference numbers remain original citations while application source identities stay strictly bound',()=>{
 const sources=[{id:'P1-T0',stableID:'evidence:paper:3:9:P1-T0',sourceText:'The method follows prior work [1, 2–4] and is compared with [14].'}, {id:1,stableID:'paper:1',title:'A separately read paper'}],before=JSON.stringify(sources);
 const text='原论文引用 [1]、[2, 4] 与 [14]；实际读取内容为 [P1-T0]。';
 assert.equal(bindWorkbenchCitations(text,sources),'原论文引用 [1]、[2, 4] 与 [14]；实际读取内容为 [evidence:paper:3:9:P1-T0]。');
 assert.throws(()=>bindWorkbenchCitations('未经原文确认 [999]',sources),/未读取/);assert.throws(()=>bindWorkbenchCitations('[material:invented]',sources),/未读取/);
 assert.equal(JSON.stringify(sources),before,'local references neither invent source rows nor alter stored original text');
});

test('sessions migrate the actual old conversation and draft without losing source identity', () => {
	const messages = [{ id: 'old-user', role: 'user', text: '已经修改的研究问题', sources: [{ attachmentID: 31, position: { pageIndex: 2 } }] }];
	const state = workbenchSessions({ messages, draft: '未发送的中文', selectedID: 'material:old', projectID: 'old-project', mode: 'organize' }, 1000);
	assert.equal(state.version, 2); assert.equal(state.sessions.length, 1); assert.strictEqual(state.sessions[0].messages, messages); assert.equal(state.sessions[0].draft, '未发送的中文'); assert.equal(state.sessions[0].selectedID, 'material:old');
	state.sessions.push({ id: 'second', title: '第二个研究问题', messages: [], selectedID: 'paper:3' }); state.activeSessionID = 'second';
	const restored = workbenchSessions(JSON.parse(JSON.stringify(state))); assert.equal(restored.activeSessionID, 'second'); assert.equal(restored.sessions[0].messages[0].sources[0].position.pageIndex, 2);
	const fallback = workbenchSessions({ ...state, activeSessionID: 'missing' }); assert.equal(fallback.activeSessionID, state.sessions[0].id);
});
test('older formula discussion is retrieved with its pair while recent conversation and original math remain intact',()=>{
 const messages=[{id:'old-q',role:'user',text:'Fermi 能量 E_F 的定义是什么？'},{id:'old-a',role:'assistant',text:'$E_{\\mathrm{F}}$ 是原文给出的定义。',sources:[{attachmentID:3}]}];
 for(let index=0;index<16;index++)messages.push({id:'later-'+index,role:index%2?'assistant':'user',text:'当前讨论'+index});
 const prompt='再次解释 Fermi 能量和下标',before=JSON.stringify(messages),context=researchConversationContext([...messages,{role:'user',text:prompt}],prompt);
 assert.equal(context[0].id,'old-q');assert.equal(context[1].id,'old-a');assert.equal(context[1].text,'$E_{\\mathrm{F}}$ 是原文给出的定义。');assert.equal(context.at(-1).id,'later-15');assert.equal(context.length,14);assert.equal(JSON.stringify(messages),before);
});

test('academic home excludes personal assets without judging new work by citations or deleting records', () => {
	const rows = [{ id: 1, title: '张三简历 2026' }, { id: 2, title: 'Personal Curriculum Vitae' }, { id: 3, title: 'Cross-device modulation recognition', citationCount: 0 }, { id: 4, title: 'Learning representations with CNNs', citationCount: null }];
	assert.deepEqual(rows.filter(isAcademicWorkbenchSource).map(row => row.id), [3, 4]); assert.equal(rows.length, 4);
	assert.equal(workbenchSourceIdentity(rows[2]), 'paper:3'); assert.equal(workbenchSourceIdentity({ id: 'OA1', source: 'OpenAlex', doi: '10.1/new' }), 'web:10.1/new');
});

test('material ordering rejects fabricated ids and retains unmentioned assets and existing outside order', () => {
	assert.deepEqual(validateMaterialOrder({ order: ['b', 'a'] }, ['a', 'b', 'c']), ['b', 'a', 'c']);
	assert.throws(() => validateMaterialOrder({ order: ['a', 'a'] }, ['a']), /重复/u);
	assert.throws(() => validateMaterialOrder({ order: ['invented'] }, ['a']), /不存在/u);
	assert.deepEqual(mergeMaterialOrder(['x', 'a', 'y', 'b'], ['b', 'a'], ['a', 'b', 'x', 'y', 'z']), ['x', 'b', 'y', 'a', 'z']);
	assert.throws(() => mergeMaterialOrder(['a'], ['gone'], ['a']), /移除/u);
});

test('answer evidence binds exact original excerpts and rejects nonexistent claims', () => {
	const original = { quoteID: 'Q1', text: 'An original excerpt with x_i and 5%', materialID: 'm1' };
	assert.deepEqual(bindWorkbenchEvidence({ text: '中文回答', evidence: [{ quoteID: 'Q1' }, { quoteID: 'Q1' }] }, [original]), [original]);
	assert.throws(() => bindWorkbenchEvidence({ text: '中文回答', evidence: ['Q7'] }, [original]), /不存在/u);
	assert.throws(() => bindWorkbenchEvidence({ text: '', evidence: [] }, [original]), /实际/u);
});

async function controller() {
	const source = await readFile(new URL('../../../chrome/content/zotero/research/ui/agent-workbench.js', import.meta.url), 'utf8');
	const context = { EasySchUI: {}, AbortController, console, Date, setTimeout, clearTimeout };
	vm.createContext(context); vm.runInContext(source, context);
	return context.EasySchUI;
}

test('public search uses the existing metadata API and never downloads, writes prose, or invokes a model', async () => {
	const ui = await controller(), calls = [];
	Object.assign(ui, {
		agentRunning: false, agentInput: { value: '查找 CNN 文献', focus() {} }, agentMode: { value: 'search' }, agentData: { projectID: '', messages: [] }, agentSend: { setAttribute() {} }, agentRunStatus: {},
		agentTools: { resolveWorkbenchMode }, agentSearch: { value: '' }, renderAgentSources() {}, renderAgentMessages() {}, async saveAgentState() {},
		E: { aiPolicy: { assertResearchPrompt() {} }, async searchPaperPage(query, options) { calls.push({ query, options }); return { records: [{ id: 'doi1', title: 'Real API shaped fixture', abstract: 'Controlled abstract', doi: '10.1/example' }], provider: 'controlled', page: 1, hasMore: true }; } },
	});
	await ui.runAgentTask();
	assert.equal(calls.length, 1); assert.equal(calls[0].options.limit, 20);
	assert.equal(ui.agentData.messages[1].sources[0].coverage, '依据摘要 · 全文尚未获取');
	assert.equal(ui.agentWebSources[0].stableID, 'web:10.1/example');
	assert.equal(ui.agentData.messages[1].searchState.hasMore, true);
	assert.equal(ui.agentRunning, false);
});

test('logical order applies and undoes the catalog overlay without touching document blocks', async () => {
	const ui = await controller(), project = { id: 'p', title: 'Project', materials: [], blocks: [{ id: 'b', text: 'User authored original prose' }], materialCatalog: { version: 1, topics: [{ id: 'p', name: 'Project' }], entries: { a: { type: '方法', topics: ['p'], tags: [] }, b: { type: '方法', topics: ['p'], tags: [] }, outside: { type: '方法', topics: ['p'], tags: [] } }, orders: { 'p|': ['a', 'outside', 'b'] } } };
	const original = JSON.stringify(project.blocks), materials = [{ id: 'a' }, { id: 'outside' }, { id: 'b' }];
	Object.assign(ui, { agentCatalog: Catalog, agentTools: { mergeMaterialOrder }, async saveAgentState() {}, renderAgentMessages() {}, E: { notebook: { materials: () => materials, async catalog(id, update) { assert.equal(id, 'p'); update(project); } } } });
	const message = { projectID: 'p', layoutSuggestion: { order: ['b', 'a'], baseOrder: ['a', 'outside', 'b'] } };
	await ui.applyAgentLayout(message); assert.deepEqual(Array.from(project.materialCatalog.orders['p|']), ['b', 'outside', 'a']); assert.equal(JSON.stringify(project.blocks), original);
	await ui.applyAgentLayout(message); assert.deepEqual(Array.from(project.materialCatalog.orders['p|']), ['a', 'outside', 'b']); assert.equal(JSON.stringify(project.blocks), original);
	project.materialCatalog.orders['p|'] = ['b', 'a', 'outside'];
	await assert.rejects(ui.applyAgentLayout(message), /已改变/u);
});

test('a failed initial storage write restores the input and cannot leave a permanent running task', async () => {
	const ui = await controller(); let requested = 0;
	Object.assign(ui, { agentInput: { value: '查找相关论文', focus() {} }, agentMode: { value: 'search' }, agentData: { projectID: '', messages: [] }, agentSend: { setAttribute() {} }, agentRunStatus: {}, agentTools: { resolveWorkbenchMode }, renderAgentMessages() {}, async saveAgentState() { throw Error('磁盘写入失败'); }, E: { async searchPaperPage() { requested++; } } });
	await ui.runAgentTask(); assert.equal(requested, 0); assert.equal(ui.agentRunning, false); assert.equal(ui.agentController, null); assert.equal(ui.agentInput.value, '查找相关论文'); assert.equal(ui.agentData.messages.length, 0); assert.equal(ui.agentRunStatus.textContent, '磁盘写入失败'); assert.equal(ui.agentSend.textContent, '↑');
});

test('layout scopes both search hits and a selected card before the paid request', async () => {
	const ui = await controller(), materials = [{ id: 'inside', title: '本项目方法', summary: '中文方法说明' }, { id: 'elsewhere', title: '另一个项目排序', summary: '不应参与本项目排布' }], project = { id: 'p', materialCatalog: { topics: [{ id: 'p' }, { id: 'other' }], entries: { inside: { topics: ['p'], tags: [] }, elsewhere: { topics: ['other'], tags: [] } }, orders: {} } };
	let requestedIDs;
	Object.assign(ui, { agentInput: { value: '整理素材排序', focus() {} }, agentMode: { value: 'layout' }, agentData: { projectID: 'p', messages: [] }, agentSelected: { ...materials[1], kind: 'material' }, agentSend: { setAttribute() {} }, agentRunStatus: {}, agentTools: { resolveWorkbenchMode, validateMaterialOrder }, agentCatalog: Catalog, agentMaterials: () => materials, renderAgentMessages() {}, async saveAgentState() {}, E: { manuscripts: { summaryReader: () => material => material.summary, summaryFor: material => material.summary }, notebook: { project: () => project }, studio: { async request(system, payload) { requestedIDs = payload.materials.map(material => material.id); return { value: { text: '只整理本研究项目', order: ['inside'] } }; } } } });
	await ui.runAgentTask(); assert.deepEqual(Array.from(requestedIDs), ['inside']); assert.deepEqual(Array.from(ui.agentData.messages[1].layoutSuggestion.order), ['inside']); assert.equal(ui.agentRunning, false);
});

test('a stale paper read cannot replace a newly selected source preview', async () => {
	const ui = await controller(), pending = [], rendered = [];
	const node = () => ({ children: [], isConnected: true, dataset: {}, setAttribute() {}, append(...nodes) { this.children.push(...nodes); } });
	Object.assign(ui, { agentData: {}, async saveAgentState() {}, renderAgentSources() {}, el: node, agentButton: node, agentPreview: node(), resetAgentPreview() { for (const child of this.agentPreview.children) child.isConnected = false; this.agentPreview.children = []; return this.agentPreviewGeneration = (this.agentPreviewGeneration || 0) + 1; }, E: { getItem(id) { return new Promise(resolve => pending.push({ id, resolve })); }, renderPaperOverview(host, item) { rendered.push(item.id); host.textContent = item.getField('title'); } } });
	const first = ui.previewAgentSource({ id: 1, kind: 'paper', stableID: 'paper:1', title: '第一篇' });
	const second = ui.previewAgentSource({ id: 2, kind: 'paper', stableID: 'paper:2', title: '第二篇' });
	pending[0].resolve({ id: 1, getField: () => '第一篇' }); await first;
	assert.deepEqual(rendered, []);
	pending[1].resolve({ id: 2, getField: () => '第二篇' }); await second;
	assert.deepEqual(rendered, [2]); assert.equal(ui.agentData.selectedID, 'paper:2');
	const missing = ui.previewAgentSource({ id: 3, kind: 'paper', stableID: 'paper:3', title: '已移除来源' }); pending[2].resolve(null); await missing;
	assert.match(ui.agentPreview.children[1].textContent, /文献条目不可用/u);
});

test('the unified research task receives configured model, source and conversation instead of separate model calls', async () => {
	const ui = await controller(), calls = [], selected = { id: 4, kind: 'paper', stableID: 'paper:4' };
	Object.assign(ui, { agentInput: { value: '评估这个研究问题并查找反证', focus() {} }, agentMode: { value: 'auto' }, agentModel: { value: 'user-model' }, agentThinking: { value: 'medium' }, agentData: { projectID: '', messages: [{ id: 'earlier', role: 'user', text: '已有研究条件' }] }, agentSelected: selected, agentSend: { setAttribute() {} }, agentRunStatus: {}, agentTools: { resolveWorkbenchMode, workbenchSourceIdentity }, renderAgentMessages() {}, renderAgentSources() {}, async saveAgentState() {}, E: { async runWorkbenchTask(request) { calls.push(request); request.onProgress('正在核对证据'); return { text: '现有资料不足以确认假设，应先进行最小验证。', sources: [{ id: 4, title: '实际提供的论文', kind: 'paper' }], steps: ['核对来源', '评估最小验证'] }; }, studio: { request() { throw Error('不能绕过统一研究流程'); } } } });
	await ui.runAgentTask(); assert.equal(calls.length, 1); assert.equal(calls[0].modelID, 'user-model'); assert.equal(calls[0].thinkingLevel, 'medium'); assert.strictEqual(calls[0].selectedSource, selected); assert.equal(calls[0].history[0].text, '已有研究条件'); assert.equal(ui.agentData.messages.at(-1).sources[0].stableID, 'paper:4'); assert.equal(ui.agentRunning, false);
});
test('workbench passes its saved Ask policy, real callbacks and complete source history instead of truncating inherited evidence',async()=>{
 const ui=await controller(),calls=[],history=Array.from({length:30},(_,i)=>({id:'old-'+i,role:i%2?'assistant':'user',text:'已保存讨论'+i,...(i===1?{sources:[{stableID:'paper:4',title:'此前已读论文'}]}:{})})),interactionCalls=[],permission=async value=>{interactionCalls.push(['permission',value]);return true;},question=async value=>{interactionCalls.push(['question',value]);return {action:'regenerate'};};
 Object.assign(ui,{agentInput:{value:'继续核对证据',focus(){}},agentMode:{value:'auto'},agentExecution:{value:'ask'},agentData:{activeSessionID:'sending-session',projectID:'',messages:history,executionMode:'ask'},agentInteractions:{requestToolPermission:permission,requestResearchQuestion:question},agentSend:{setAttribute(){}},agentRunStatus:{},agentTools:{resolveWorkbenchMode,workbenchSourceIdentity},renderAgentMessages(){},renderAgentSources(){},async saveAgentState(){},E:{async runWorkbenchTask(request){calls.push(request);return {text:'继续讨论已保存证据。',sources:[],steps:[],researchDecisions:[{question:'核对什么',answer:'独立验证集'}]};}}});
 await ui.runAgentTask();assert.equal(calls[0].executionMode,'ask');ui.agentData.activeSessionID='changed-session';assert.equal(await calls[0].onToolPermission({label:'已有素材'}),true);assert.deepEqual(await calls[0].onResearchQuestion({question:'选择'}),{action:'regenerate'});assert.equal(interactionCalls[0][1].sessionID,'sending-session');assert.equal(interactionCalls[1][1].sessionID,'sending-session');assert.equal(calls[0].history[1].sources[0].stableID,'paper:4');assert.equal(calls[0].history.length,31);assert.notStrictEqual(calls[0].history,ui.agentData.messages);assert.equal(ui.agentData.messages.at(-1).researchDecisions[0].answer,'独立验证集');
});

test('the workbench passes inherited attachment references and retains them in the user message',async()=>{
 const ui=await controller(),calls=[],attachments=[{id:'attachment:71',kind:'docx',title:'数据划分.docx'}];
 Object.assign(ui,{agentInput:{value:'解释这个附件中的防泄漏设置',focus(){}},agentMode:{value:'auto'},agentModel:{value:'chosen-model'},agentThinking:{value:'high'},agentData:{activeSessionID:'shared-session',projectID:'',messages:[],attachments},agentSend:{setAttribute(){}},agentRunStatus:{},agentTools:{resolveWorkbenchMode,workbenchSourceIdentity},renderAgentMessages(){},renderAgentSources(){},async saveAgentState(){},E:{chatAttachments:{get:id=>id==='shared-session'?attachments:[]},async runWorkbenchTask(request){calls.push(request);return {text:'请核对划分是否先于预处理。',sources:[],steps:['读取附加资料']};}}});
 await ui.runAgentTask();assert.equal(calls.length,1);assert.equal(JSON.stringify(calls[0].attachments),JSON.stringify(attachments));assert.equal(JSON.stringify(ui.agentData.messages[0].attachments),JSON.stringify(attachments));assert.equal(calls[0].thinkingLevel,'high');assert.equal(calls[0].modelID,'chosen-model');
});

test('initial selection is consumed once while an ordinary workbench open routes to shared conversation', async () => {
	const source = await readFile(new URL('../../../chrome/content/zotero/research/ui/main.js', import.meta.url), 'utf8');
	const context = { window: { parent: { Zotero: { Research: {} } }, frameElement: {}, addEventListener() {} }, document: { querySelectorAll: () => [] } };
	vm.createContext(context); vm.runInContext(source, context); const ui = context.EasySchUI, actions = [];
	let mounts=0;
	for (const method of ['bind', 'initResearch', 'initWriting', 'initSettings', 'initMeetings', 'initSearch', 'initPaperSkills', 'initPPTStudio', 'initFlow', 'initDiscovery', 'initKnowledge', 'initWritingCards', 'initTasks', 'initManuscriptProjects', 'initSurface', 'initAgentWorkbench', 'initReadingWorkbench', 'loadSettings', 'loadProject']) ui[method] = () => {};
	ui.refresh = async () => actions.push('refresh'); ui.show = view => actions.push(view);ui.openAgentWorkbench=()=>actions.push('agent'); ui.setSelection = async selected => actions.push(selected.paperID);
	ui.initSurface=()=>{mounts++;};
	await Promise.all([ui.init(),ui.init()]); assert.deepEqual(actions, ['refresh', 'agent']);assert.equal(mounts,1,'重复加载事件不能创建重复功能');
	actions.length = 0; context.window.frameElement.researchSelection = { paperID: 14 };
	await ui.init(); assert.deepEqual(actions, [14]); assert.equal(context.window.frameElement.researchSelection, null);
	actions.length = 0; await ui.init(); assert.deepEqual(actions, ['refresh', 'agent']);assert.equal(mounts,1);
});

async function sharedController(initial={}) {
	const ui=await controller(),data={researchWorkbench:structuredClone(initial)},E={store:{get:key=>data[key],async update(fn){await Promise.resolve();fn(data);}}};let sequence=0;
	const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8');
	vm.runInNewContext(source,{Zotero:{Research:E,Utilities:{randomString:()=>String(++sequence)},logError:error=>{throw error;}},ChromeUtils:{importESModule:uri=>uri.endsWith('chat-attachments.mjs')?Attachments:Conversations}});
	Object.assign(ui,{E,agentData:E.workbenchConversations.snapshot(),agentInput:{value:'',focus(){},setAttribute(){},removeAttribute(){}},agentMode:{value:'auto'},agentModel:{value:'configured',options:[{value:'configured'}]},agentThinking:{value:'off'},agentSearch:{value:''},agentSend:{setAttribute(){},removeAttribute(){}},agentRunStatus:{},agentSourceList:{scrollTop:0},agentSources:[],agentWebSources:[],agentQuery:'',agentMaterials:()=>[],refreshAgentProjects(){},renderAgentSessions(){},renderAgentMessages(){},renderAgentSources(){this.agentVisibleSources=this.agentWebSources;},resetAgentPreview(){this.resets=(this.resets||0)+1;},async previewAgentSource(row){this.agentSelected=row;},agentTools:{resolveWorkbenchMode,workbenchSourceIdentity}});
	// This fixture exercises session state without a browser document. The real
	// empty preview is covered by the native workspace suite.
	ui.renderEmptyAgentPreview=()=>ui.resetAgentPreview();
	ui.restoreAgentSession(ui.agentData.activeSessionID);ui.agentInput.value=ui.agentData.draft;
	const search=[...ui.agentData.messages].reverse().find(message=>message.searchState);ui.agentWebSources=search?.sources||[];ui.agentWebSearch=search?.searchState;
	E.workbenchConversations.subscribe(value=>ui.receiveSharedAgentState(value));
	return {ui,S:E.workbenchConversations,data};
}
test('background legacy migration keeps the current search transcript and selected session intact',async()=>{
	const {ui,S}=await sharedController(),originalID=ui.agentData.activeSessionID;
	ui.E.searchPaperPage=async()=>({records:[{id:'paper-1',title:'Controlled metadata',doi:'10.1/one',abstract:'Original abstract'}],provider:'controlled',page:1,hasMore:true});
	ui.agentMode.value='search';ui.agentInput.value='查找跨设备调制识别论文';await ui.runAgentTask();
	await S.importLegacy('assembly:old',[{role:'user',text:'旧布局问题'},{role:'assistant',text:'旧整理回复'}],{origin:'assembly'});
	assert.equal(ui.agentData.activeSessionID,originalID);assert.equal(ui.agentData.messages.length,2);assert.equal(S.list().length,2);assert.equal(ui.agentWebSources.length,1);
	const reloaded=await sharedController(structuredClone(S.snapshot()));
	assert.equal(reloaded.ui.agentData.activeSessionID,originalID);assert.equal(reloaded.ui.agentData.messages.length,2);assert.equal(reloaded.ui.agentWebSearch.hasMore,true);assert.equal(reloaded.ui.agentWebSources[0].stableID,'web:10.1/one');
});
test('same-session shared draft updates cannot invalidate a running source pagination request',async()=>{
	const source={id:'one',kind:'web',stableID:'web:one'},state={query:'transfer',provider:'controlled',page:1,hasMore:true};
	const {ui,S}=await sharedController({messages:[{id:'search',role:'assistant',text:'候选',sources:[source],searchState:state}]});let resolve;
	ui.E.searchPaperPage=()=>new Promise(done=>{resolve=done;});const pending=ui.loadMoreAgentSources();
	await S.update(ui.agentData.activeSessionID,{draft:'分页期间输入的中文思路'},{origin:'reader'});
	resolve({records:[{id:'two',title:'Second candidate',abstract:'Second abstract'}],provider:'controlled',page:2,hasMore:false});await pending;
	assert.deepEqual(Array.from(ui.agentWebSources,row=>row.id),['one','two']);assert.equal(ui.agentWebSearch.page,2);assert.equal(ui.agentWebSearch.hasMore,false);assert.equal(ui.agentInput.value,'分页期间输入的中文思路');
	assert.equal(S.getActive().messages[0].sources.length,2);assert.equal(ui.agentLoadingPage,false);
});
test('external session selection restores separate drafts and source state without retaining another session preview',async()=>{
	const {ui,S}=await sharedController({draft:'第一个草稿',selectedID:'web:one',messages:[{id:'search',role:'assistant',text:'候选',sources:[{id:'one',kind:'web',stableID:'web:one'}],searchState:{query:'first',page:1,hasMore:true}}]});
	const originalID=ui.agentData.activeSessionID;ui.agentSelected={stableID:'web:one'};
	await ui.createAgentSession();const nextID=ui.agentData.activeSessionID;
	assert.notEqual(nextID,originalID);assert.equal(ui.agentInput.value,'');assert.equal(ui.agentWebSources.length,0);assert.equal(ui.agentWebSearch,undefined);assert.equal(ui.agentSelected,null);
	ui.agentInput.value='第二个未发送的中文草稿';ui.updateAgentDraft();await ui.flushAgentDraft();
	await ui.switchAgentSession(originalID);assert.equal(ui.agentInput.value,'第一个草稿');assert.equal(ui.agentWebSources.length,1);assert.equal(ui.agentWebSearch.query,'first');assert.equal(ui.agentSelected.stableID,'web:one');
	await S.select(nextID);assert.equal(ui.agentInput.value,'第二个未发送的中文草稿');assert.equal(ui.agentWebSources.length,0);assert.equal(ui.agentSelected,null);
});
test('an external surface switches sessions during draft debounce without losing the unfinished input',async()=>{
	const {ui,S}=await sharedController(),first=ui.agentData.activeSessionID,next=await S.create({title:'另一个界面的讨论'});
	await S.select(first);ui.agentInput.value='正在输入尚未保存的中文';ui.updateAgentDraft();
	await S.select(next.id);await S.updateHome({});
	assert.equal(S.get(first).draft,'正在输入尚未保存的中文');assert.equal(ui.agentInput.value,'');
	await S.select(first);assert.equal(ui.agentInput.value,'正在输入尚未保存的中文');
});
test('older shared save emissions cannot replace the newest local mode, source and draft before reload',async()=>{
	const {ui,S}=await sharedController({messages:[{id:'preserved',role:'assistant',text:'已保存的中文回答'}]}),stale=S.snapshot();
	ui.agentData.mode='organize';ui.agentMode.value='organize';ui.agentData.selectedID='material:new';ui.agentData.draft='保留未发送的中文草稿';ui.agentInput.value=ui.agentData.draft;
	const saving=ui.saveAgentState();ui.receiveSharedAgentState(stale);
	assert.equal(ui.agentMode.value,'organize');assert.equal(ui.agentData.selectedID,'material:new');assert.equal(ui.agentInput.value,'保留未发送的中文草稿');
	await saving;assert.equal(S.getActive().mode,'organize');assert.equal(S.getActive().selectedID,'material:new');assert.equal(S.getActive().draft,'保留未发送的中文草稿');
	const reloaded=await sharedController(structuredClone(S.snapshot()));assert.equal(reloaded.ui.agentData.mode,'organize');assert.equal(reloaded.ui.agentData.selectedID,'material:new');assert.equal(reloaded.ui.agentData.messages[0].text,'已保存的中文回答');assert.equal(reloaded.ui.agentInput.value,'保留未发送的中文草稿');
});
test('a queued source save preserves newer shared model, reasoning and execution choices instead of replaying unchanged defaults',async()=>{
 const {ui,S}=await sharedController(),id=ui.agentData.activeSessionID;
 // The other surface's choice is queued before the source preview save. Its
 // emission has not reached this UI yet, whose flattened values are defaults.
 const choosing=S.update(id,{modelID:'assembly-chosen-model',thinkingLevel:'high',executionMode:'ask',mode:'organize'},{origin:'assembly'});
 ui.agentData.selectedID='material:queued-preview';const saving=ui.saveAgentState();
 await choosing;await saving;
 const saved=S.get(id);assert.equal(saved.modelID,'assembly-chosen-model');assert.equal(saved.thinkingLevel,'high');assert.equal(saved.executionMode,'ask');assert.equal(saved.mode,'organize');assert.equal(saved.selectedID,'material:queued-preview');
 // Deliberately changing a control still writes that exact choice.
 ui.agentData.modelID='explicit-workbench-model';ui.agentData.thinkingLevel='medium';ui.agentData.executionMode='auto';ui.agentData.mode='auto';await ui.saveAgentState();
 assert.equal(S.get(id).modelID,'explicit-workbench-model');assert.equal(S.get(id).thinkingLevel,'medium');assert.equal(S.get(id).executionMode,'auto');assert.equal(S.get(id).mode,'auto');
});
test('shared source restoration supports synchronous material previews as well as asynchronous paper previews',async()=>{
	const {ui,S}=await sharedController();ui.agentMaterials=()=>[{id:'material-one',title:'真实素材'}];ui.previewAgentSource=row=>{ui.agentSelected=row;};
	await S.update(ui.agentData.activeSessionID,{selectedID:'material:material-one'});
	assert.equal(ui.agentSelected.id,'material-one');assert.equal(ui.agentData.selectedID,'material:material-one');
});
