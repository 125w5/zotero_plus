/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Pi application tools in native Zotero', function () {
	this.timeout(180000);
	const E = Zotero.Research;
	let win, prior, folder, requests, transcripts, model, project;
	const live = Zotero.Prefs.get('extensions.easysch.liveProviderTest', true);
	const report = { type: '真实 Zotero 与真实 Pi 工具循环；普通用例受控模型响应，live 用例独立标记', tests: [] };
	const sse = (delta, finish) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\ndata: [DONE]\n\n';
	before(async () => {
		win = await loadZoteroPane(); await E.attachWindow(win);
		folder = PathUtils.join(Zotero.DataDirectory.dir, 'pi-native-acceptance'); await IOUtils.makeDirectory(folder, { ignoreExisting: true });
		prior = { settings: E.settings, resolve: E.resolveModel, request: E.requestProvider, credentials: E.credentials.get, assets: E.manuscripts.assetLibrary, passages: E.findPaperPassages, summary: E.manuscripts.summaryReader, summaryFor: E.manuscripts.summaryFor };
		project = await E.manuscripts.create('Pi 研究辅助隔离验收 ' + Date.now());
	});
	beforeEach(() => {
		requests = 0; transcripts = []; model = 'controlled-pi';
		E.settings = () => ({ endpoint: 'https://controlled.invalid/v1', model }); E.resolveModel = async config => config; E.credentials.get = async () => 'controlled-test-no-credential';
		E.manuscripts.assetLibrary = () => ({ M1: { id: 'M1', title: '跨域调制识别', kind: 'paragraph', revision: 1, sourceText: '研究记录：训练和测试按采集批次分离，检查跨信道分布变化，使用独立验证集选择参数。', summary: '按采集批次划分数据，并检查跨信道性能。', tags: ['CNN'], anchor: { pageIndex: 2 } } });
		E.manuscripts.summaryReader = () => material => material.summary; E.manuscripts.summaryFor = material => material.summary; E.findPaperPassages = () => [];
		E.requestProvider = async (_url, options, _timeout, readResponse) => {
			requests++; const input = JSON.parse(options.body); transcripts.push(input);
			const text = requests === 1 ? sse({ tool_calls: [{ index: 0, id: 'call-local', type: 'function', function: { name: 'search_local_materials', arguments: JSON.stringify({ query: '调制识别' }) } }] }, 'tool_calls') : sse({ content: '应先按采集批次划分训练与测试，再检查跨信道性能。[material:M1] 这是一项验证计划，尚无实验结果。' }, 'stop');
			const data = new win.TextEncoder().encode(text); let read = false;
			return readResponse({ body: { getReader: () => ({ async read() { if (read) return { done: true }; read = true; return { value: data, done: false }; }, releaseLock() {} }) } });
		};
	});
	afterEach(async function () {
		report.tests.push({ name: this.currentTest.title, type: this.currentTest.title.startsWith('LIVE') ? '真实模型与真实网络' : '真实 Zotero；受控回复', state: this.currentTest.state, error: this.currentTest.err?.message, requestCount: requests });
		await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
	});
	after(async () => {
		E.settings = prior.settings; E.resolveModel = prior.resolve; E.requestProvider = prior.request; E.credentials.get = prior.credentials;
		E.manuscripts.assetLibrary = prior.assets; E.findPaperPassages = prior.passages; E.manuscripts.summaryReader = prior.summary; E.manuscripts.summaryFor = prior.summaryFor;
		await E.store.update(state => { delete state.manuscripts[project.id]; }); await E.store.flush(); win?.close();
	});
	it('executes local search via the actual Pi agent and returns the original material identity', async () => {
		const before = JSON.stringify(E.manuscripts.get(project.id)), stages = [];
		const result = await E.runWorkbenchTask({ prompt: '查找调制识别的已有知识，讨论数据划分', mode: 'discuss', projectID: '', modelID: 'selected-controlled-model', thinkingLevel: 'high', onProgress: text => stages.push(text) });
		assert.equal(requests, 2); assert.equal(transcripts[0].model, 'selected-controlled-model'); assert.notProperty(transcripts[0], 'reasoning_effort', '未知接口不能猜测思考参数');
		assert.exists(transcripts[1].messages.find(row => row.role === 'tool' && row.tool_call_id === 'call-local'));
		assert.include(result.text, '采集批次'); assert.equal(result.sources[0].stableID, 'material:M1'); assert.include(stages, '检索已有素材');
		assert.equal(JSON.stringify(E.manuscripts.get(project.id)), before, '不写入或改动论文正文');
	});
	it('blocks direct manuscript writing while exposing explicitly authorized image generation', async () => {
		let error; try { await E.runWorkbenchTask({ prompt:'帮我写论文引言' }); } catch (e) { error = e; } assert.match(error?.code || '', /^AI_/);
		assert.equal(requests, 0); assert.isTrue(E.piExtensions().find(row => row.id === 'images').enabled);
	});
	it('an explicit image request reaches the configured generator once through the real Pi tool loop',async()=>{
		const generate=E.generateResearchImage;let generated=0;
		E.generateResearchImage=async(prompt)=>{generated++;assert.equal(prompt,'数据处理流程说明图');return {path:PathUtils.join(folder,'controlled-generated.png'),model:'controlled-image'};};
		E.requestProvider=async(_url,options,_timeout,readResponse)=>{
			requests++;const payload=JSON.parse(options.body);transcripts.push(payload);
			if(requests===1){assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'generate_research_image'}});assert.exists(payload.tools.find(tool=>tool.function.name==='generate_research_image'));}
			const delta=requests===1?{tool_calls:[{index:0,id:'controlled-image',type:'function',function:{name:'generate_research_image',arguments:JSON.stringify({prompt:'数据处理流程说明图'})}}]}:{content:'图片已生成并保存在本地，作为 AI 生成的构想素材。'};
			const data=new win.TextEncoder().encode(sse(delta,requests===1?'tool_calls':'stop'));let read=false;return readResponse({body:{getReader:()=>({async read(){if(read)return {done:true};read=true;return {value:data,done:false};},releaseLock(){}})}});
		};
		try{const result=await E.runWorkbenchTask({prompt:'生成一张数据处理流程图',modelID:'selected-controlled-model'});assert.equal(generated,1);assert.equal(requests,2);assert.lengthOf(result.generatedImages,1);assert.equal(result.generatedImages[0].sourceType,'ai-illustration');assert.equal(result.generatedImages[0].model,'controlled-image');assert.isTrue(transcripts.every(row=>row.model==='selected-controlled-model'));}
		finally{E.generateResearchImage=generate;}
	});
	it('routes an ordinary material recommendation through Pi and strips only the current context echo', async () => {
		const request = E.requestProvider, source = {id: 'M1', kind: 'material', title: '跨域调制识别'};
		E.requestProvider = async (url, options, timeout, readResponse) => {
			const payload = JSON.parse(options.body);
			if (!requests) {
				assert.deepEqual(payload.tool_choice, {type: 'function', function: {name: 'search_local_materials'}});
				const text = sse({tool_calls: [{index: 0, id: 'call-local', type: 'function', function: {name: 'search_local_materials', arguments: JSON.stringify({query: '调制识别', projectID: '', selectedSource: source})}}]}, 'tool_calls');
				requests++; transcripts.push(payload); const data = new win.TextEncoder().encode(text); let read = false;
				return readResponse({body: {getReader: () => ({async read() {if (read) return {done: true}; read = true; return {value: data, done: false};}, releaseLock() {}})}});
			}
			assert.equal(payload.tool_choice, 'auto');
			const call = payload.messages.findLast(row => row.role === 'assistant').tool_calls[0];
			assert.deepEqual(JSON.parse(call.function.arguments), {query: '调制识别'});
			return request(url, options, timeout, readResponse);
		};
		const before = JSON.stringify(E.manuscripts.get(project.id));
		const result = await E.runWorkbenchTask({prompt: '请你推荐我可以使用的素材', selectedSource: source, modelID: 'selected-controlled-model', thinkingLevel: 'high'});
		assert.equal(requests, 2); assert.exists(result.sources.find(row => row.stableID === 'material:M1'));
		assert.equal(JSON.stringify(E.manuscripts.get(project.id)), before); assert.include(result.steps, '检索已有素材');
	});
	it('honors an already cancelled task before making a provider request', async () => {
		const controller = new win.AbortController(); controller.abort(); let error;
		try { await E.runWorkbenchTask({ prompt: '核对研究思路', signal: controller.signal }); } catch (e) { error = e; }
		assert.match(error?.message || '', /停止/); assert.equal(requests, 0);
	});
	it('uses real native catalog/model persistence when a user explicitly requests adding an existing material', async () => {
		const original = E.manuscripts.model.clone(E.manuscripts.get(project.id));
		E.requestProvider = async (_url, options, _timeout, readResponse) => {
			requests++;const payload=JSON.parse(options.body);transcripts.push(payload);
			const delta=requests===1?{tool_calls:[{index:0,id:'native-search',type:'function',function:{name:'search_local_materials',arguments:JSON.stringify({query:''})}}]}:requests===2?{tool_calls:[{index:0,id:'native-place',type:'function',function:{name:'place_material_in_assembly',arguments:JSON.stringify({materialID:'material:M1'})}}]}:{content:'已有素材已加入当前装配，可用于讨论采集批次与独立验证划分。[M1]'};
			const data=new win.TextEncoder().encode(sse(delta,requests<3?'tool_calls':'stop'));let read=false;return readResponse({body:{getReader:()=>({async read(){if(read)return {done:true};read=true;return {value:data,done:false};},releaseLock(){}})}});
		};
		try {
			const result=await E.runWorkbenchTask({prompt:'我确认，随便挑一个素材放进我的装配并解释',projectID:project.id,modelID:'native-selected',thinkingLevel:'high'}),current=E.manuscripts.get(project.id),inserted=current.blocks.find(block=>block.id===result.materialPlacements[0].blockID);
			assert.equal(requests,3);assert.exists(inserted);assert.equal(inserted.materials[0].id,'M1');assert.equal(inserted.text,'');assert.deepEqual(current.blocks.filter(block=>block.id!==inserted.id),original.blocks);assert.equal(current.materials.find(material=>material.id==='M1').sourceText,E.manuscripts.assetLibrary().M1.sourceText);assert.include(result.text,'[material:M1]');assert.isTrue(transcripts.every(row=>row.model==='native-selected'));
		} finally {original.revision=E.manuscripts.get(project.id).revision;await E.manuscripts.save(original);}
	});
	it('keeps genuine earlier source aliases in native cross-turn discussion without a new file read',async()=>{
		E.requestProvider=async(_url,options,_timeout,readResponse)=>{requests++;const payload=JSON.parse(options.body);transcripts.push(payload);const data=new win.TextEncoder().encode(sse({content:'根据此前的素材记录讨论独立验证划分。[M1]'},'stop'));let read=false;return readResponse({body:{getReader:()=>({async read(){if(read)return {done:true};read=true;return {value:data,done:false};},releaseLock(){}})}});};
		const result=await E.runWorkbenchTask({prompt:'继续讨论',modelID:'native-selected',history:[{role:'user',text:'数据如何划分'},{role:'assistant',text:'先前已读到按采集批次划分。',sources:[{id:'M1',stableID:'material:M1',title:'跨域调制识别',coverage:'此前实际读取的研究记录'}]}]});
		assert.equal(requests,1);assert.include(result.text,'[material:M1]');assert.equal(result.sources[0].coverage,'此前实际读取的研究记录');assert.notInclude(result.steps,'检索已有素材');
	});
	it('returns native concrete research choices and explicit regeneration through actual Pi continuation',async()=>{
		let choices=0;
		E.requestProvider=async(_url,options,_timeout,readResponse)=>{requests++;const payload=JSON.parse(options.body);transcripts.push(payload);const delta=requests<3?{tool_calls:[{index:0,id:'native-choice-'+requests,type:'function',function:{name:'ask_research_question',arguments:JSON.stringify({question:'先核对哪项条件？',options:requests===1?['采集批次','信道条件']:['训练测试划分','独立验证集'],basis:'当前用户请求讨论研究条件。',sourceIDs:[]})}}]}:{content:'先核对独立验证集的划分；不修改论文正文。'};const data=new win.TextEncoder().encode(sse(delta,requests<3?'tool_calls':'stop'));let read=false;return readResponse({body:{getReader:()=>({async read(){if(read)return {done:true};read=true;return {value:data,done:false};},releaseLock(){}})}});};
		await E.runWorkbenchTask({prompt:'讨论研究条件让我选择',modelID:'native-selected',onResearchQuestion:async request=>{assert.lengthOf(request.options,2);return ++choices===1?{action:'regenerate'}:{answer:'独立验证集'};}});
		assert.equal(choices,2);assert.equal(requests,3);assert.equal(JSON.parse(transcripts[1].messages.findLast(row=>row.role==='tool').content).action,'regenerate');assert.equal(JSON.parse(transcripts[2].messages.findLast(row=>row.role==='tool').content).answer,'独立验证集');
	});
	it('LIVE runs the configured model and a real local tool without editing a manuscript', async function () {
		if (!live) { this.skip(); return; }
		E.settings = prior.settings; E.resolveModel = prior.resolve; E.credentials.get = prior.credentials;
		const started = Date.now();
		report.live = { model: E.settings().model, providerRequests: 0, localRecords: '受控隔离研究记录，非真实文献检索' };
		E.requestProvider = (...args) => { requests++; report.live.providerRequests = requests; return prior.request(...args); };
		try {
			const result = await E.runWorkbenchTask({ prompt: '请调用 search_local_materials，检索“调制识别”。仅根据工具实际返回的研究记录，简要解释数据划分建议，不写论文正文。', mode: 'discuss', thinkingLevel: 'off' });
			assert.isAtLeast(requests, 2, '真实模型应调用工具并读取工具结果'); assert.include(result.steps, '检索已有素材'); assert.isAbove(result.text.length, 10); assert.exists(result.sources.find(row => row.stableID === 'material:M1'));
			Object.assign(report.live, { text: result.text, sourceIDs: result.sources.map(row => row.stableID) });
		} finally { report.live.elapsedMS = Date.now() - started; }
	});
});
