/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Research-only agent workbench', function () {
	this.timeout(90000);
	const E = Zotero.Research;
	let win, frame, ui, folder, prior, priorState, project, papers, modelCalls = 0, backgroundModelCalls = 0, downloadCalls = 0, opened = [], searchCalls = [], overviewCalls = [];
	const report = { type: '真实 Zotero chrome 页面与布局；来源、检索和模型回复受控，不代表真实模型、联网或真人鼠标验收', tests: [] };
	const wait = async (fn, label) => { for (let n = 0; n < 180; n++) { if (fn()) return; await Zotero.Promise.delay(40); } throw Error('等待' + label + '超时'); };
	const blockModelRequest = () => { const stack = new Error().stack || ''; if (stack.includes('agent-workbench.js')) modelCalls++; else backgroundModelCalls++; throw Error('此受控测试不调用真实模型'); };
	const materials = [
		{ id: 'controlled-workbench-m1', kind: 'paragraph', title: '特征提取方法', summary: '利用卷积神经网络提取局部特征。', sourceText: 'The CNN extracts local features.', anchor: { attachmentID: 995501, pageIndex: 2 }, primaryType: '方法', revision: 1 },
		{ id: 'controlled-workbench-m2', kind: 'paragraph', title: '验证划分', summary: '测试集按设备划分，避免来源泄漏。', sourceText: 'Split test devices before normalization.', anchor: { attachmentID: 995502, pageIndex: 3 }, primaryType: '实验设置', revision: 1 },
	];
	async function capture(name) {
		const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		try { const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0); const blob = await new Promise(resolve => canvas.toBlob(resolve)); await IOUtils.write(PathUtils.join(folder, name + '.png'), new Uint8Array(await blob.arrayBuffer())); }
		finally { image.close(); }
	}
	before(async () => {
		await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
		prior = { selection: E.library.selection, candidates: E.library.readingCandidates, overview: E.renderPaperOverview, search: E.searchPaperPage, obtain: E.obtainPaper, ask: E.askPaper, request: E.studio.request, assets: E.manuscripts.assetLibrary, materials: E.notebook.materials, prepare: E.manuscripts.prepareTranslation, metadata: E.completePaperMetadata, metrics: E.ensurePaperMetrics, open: E.library.openSource, runTask: E.runWorkbenchTask, models: E.workbenchModels, pane: E.mountWorkbenchSourcePane };
		priorState = E.store.get('researchWorkbench');
		E.manuscripts.prepareTranslation = async () => null; E.completePaperMetadata = async () => {}; E.ensurePaperMetrics = async () => null;
		const first = new Zotero.Item('journalArticle'); first.libraryID = Zotero.Libraries.userLibraryID; first.setField('title', '受控来源：跨设备识别'); first.setField('abstractNote', '受控摘要，不代表真实研究结果。'); await first.saveTx();
		const second = new Zotero.Item('journalArticle'); second.libraryID = Zotero.Libraries.userLibraryID; second.setField('title', '受控来源：验证与泄漏'); await second.saveTx();
		papers = [E.library.describe(first), E.library.describe(second)];
		project = E.manuscripts.model.createProject('受控工作台项目', 'imrad'); project.materials = JSON.parse(JSON.stringify(materials));
		await E.store.update(state => { state.manuscripts ||= {}; state.manuscripts[project.id] = project; state.researchWorkbench = { mode: 'auto', projectID: project.id, selectedID: '', messages: [] }; });
		E.library.selection = () => []; E.library.readingCandidates = async () => papers;
		E.manuscripts.assetLibrary = () => Object.fromEntries(materials.map(material => [material.id, material])); E.notebook.materials = () => materials;
		const renderOverview = async (host, item) => { overviewCalls.push(item?.id); host.setAttribute('data-preview-paper-id', String(item.id)); host.textContent = '受控首页与摘要：' + item.getField('title'); };
		E.renderPaperOverview = renderOverview;
		E.searchPaperPage = async (query, options) => {
			const page = options.page || 1; searchCalls.push({ query, page });
			// Fill a real scrolling viewport so page two is requested by reaching
			// its end, rather than by an immediately visible one-row sentinel.
			const records = Array.from({ length: page === 1 ? 40 : 1 }, (_, index) => {
				const suffix = page + (index ? '-' + index : '');
				return { id: 'controlled-open-paper-' + suffix, title: '受控公开文献 ' + suffix, doi: '10.1000/controlled-' + suffix, abstract: 'An actual API-shaped controlled abstract.', source: '受控来源', url: 'https://example.org/controlled-' + suffix };
			});
			return { records, provider: 'controlled', page, hasMore: page < 2, limitations: [] };
		};
		E.obtainPaper = async () => { downloadCalls++; throw Error('此受控测试不下载全文'); };
		E.askPaper = async () => blockModelRequest(); E.studio.request = async () => blockModelRequest();
		E.library.openSource = async source => { opened.push(source); };
		// The legacy source/search fixtures remain API-controlled. The unified
		// task and source-pane bridges are exercised separately below, without
		// accidentally invoking a live model or network request during layout QA.
		E.runWorkbenchTask = undefined; E.workbenchModels = () => [{ id: 'controlled-model', label: '受控模型' }]; E.mountWorkbenchSourcePane = undefined;
		const sessionWindows=Zotero.Session.state.windows;Zotero.Session.state.windows=[];
		try{win = await loadZoteroPane(); await E.attachWindow(win);}finally{Zotero.Session.state.windows=sessionWindows;}
		win.restore?.();win.focus();win.resizeTo(1460,940);
		// attachWindow can finish loading application modules. Install this
		// controlled renderer after startup; native boot jobs remain blocked and
		// are recorded separately from requests made by the tested workbench.
		E.renderPaperOverview = renderOverview;
		E.runWorkbenchTask = undefined; E.workbenchModels = () => [{ id: 'controlled-model', label: '受控模型' }]; E.mountWorkbenchSourcePane = undefined;
		folder = PathUtils.join(Zotero.DataDirectory.dir, 'agent-workbench-acceptance'); await IOUtils.makeDirectory(folder, { ignoreExisting: true });
		await E.openResearchAgent(); await wait(() => { frame = win.document.getElementById('easysch-library-discovery-frame'); ui = frame?.contentWindow.EasySchUI; return ui?.ready && !frame.inert && ui.agentSources.length === 2; }, '原生同页工作台页面');
		assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');assert.notExists(win.document.getElementById('easysch-workspace-frame'));
	});
	afterEach(async function () { report.tests.push({ name: this.currentTest.title, state: this.currentTest.state, error: this.currentTest.err?.message }); report.modelRequests = { workbench: modelCalls, unrelatedStartupBlocked: backgroundModelCalls }; report.previewCalls = overviewCalls; await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2)); });
	after(async () => {
		E.library.selection = prior.selection; E.library.readingCandidates = prior.candidates; E.renderPaperOverview = prior.overview; E.searchPaperPage = prior.search; E.obtainPaper = prior.obtain; E.askPaper = prior.ask; E.studio.request = prior.request; E.manuscripts.assetLibrary = prior.assets; E.notebook.materials = prior.materials; E.manuscripts.prepareTranslation = prior.prepare; E.completePaperMetadata = prior.metadata; E.ensurePaperMetrics = prior.metrics; E.library.openSource = prior.open;
		E.runWorkbenchTask = prior.runTask; E.workbenchModels = prior.models; E.mountWorkbenchSourcePane = prior.pane;
		await E.store.update(state => { if (priorState === undefined) delete state.researchWorkbench; else state.researchWorkbench = priorState; delete state.manuscripts[project.id]; });
		await Zotero.Items.trashTx(papers.map(paper => paper.id)); await E.store.flush(); win?.close();
	});

	it('keeps library reading in the current library tab with selection preserved', async () => {
		await win.ZoteroPane.selectItem(papers[0].id);
		const before=win.Zotero_Tabs.getState().length;
		await E.openLibraryReading(win);
		assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');
		assert.equal(win.Zotero_Tabs.getState().length,before);
		assert.equal(win.ZoteroPane.itemsView.getSelectedItems()[0].id,papers[0].id);
		await capture('native-library-reading');
	});

	it('keeps public discovery in the native library shell and restores the exact local tree and selection',async()=>{
		const tree=win.ZoteroPane.itemsView,selected=tree.getSelectedItems()[0]?.id,tabs=win.Zotero_Tabs.getState().length;
		const nativeTree=win.document.getElementById('zotero-items-pane'),toolbar=win.document.getElementById('zotero-toolbar-item-tree'),container=win.document.getElementById('zotero-items-pane-container');
		const discovery=await E.openLibraryWorkspace(win,'discovery'),homeFrame=win.document.getElementById('easysch-library-discovery-frame');
		assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');assert.equal(win.Zotero_Tabs.getState().length,tabs);assert.strictEqual(win.ZoteroPane.itemsView,tree);
		assert.isTrue(homeFrame.contentDocument.body.classList.contains('library-discovery'));assert.isTrue(win.document.getElementById('zotero-items-pane').hidden);
		await wait(()=>win.getComputedStyle(nativeTree).display==='none'&&homeFrame.getBoundingClientRect().height>container.getBoundingClientRect().height-60,'推荐独占中间区域');
		assert.equal(nativeTree.getBoundingClientRect().height,0,'原生树不占据推荐页上半部分');assert.equal(toolbar.getBoundingClientRect().height,0,'原生工具栏不占据推荐页上半部分');
		const frameRect=homeFrame.getBoundingClientRect(),containerRect=container.getBoundingClientRect();
		assert.isTrue(container.querySelector('.library-workspace-tabs').hidden,'原生左栏已提供导航，推荐区不重复显示模式栏');
		assert.isAtMost(Math.abs(frameRect.top-containerRect.top),2,'推荐页直接使用内容区顶端');assert.isAtMost(Math.abs(frameRect.bottom-containerRect.bottom),2,'推荐页填满中间区域');assert.closeTo(frameRect.width,containerRect.width,2,'推荐使用完整文库内容宽度');
		assert.equal(win.getComputedStyle(win.document.getElementById('zotero-item-pane')).display,'none','不留下空白的原生右栏');
		assert.lengthOf(discovery.agentHomeList.querySelectorAll('.workbench-recommendation'),0,'推荐页不重复本地文库');
		discovery.agentRecommendations=[{id:'controlled-recommendation',title:'受控相关论文',source:'受控来源',abstract:'Controlled abstract.'}];discovery.renderAgentHome();
		await capture('native-library-discovery');
		// A notifier refresh can change the hidden native tree's selection while
		// discovery is open. Returning must restore the original visible choice.
		await tree.selectItems([papers[1].id],true,true);assert.equal(tree.getSelectedItems()[0].id,papers[1].id);
		await E.openLibraryReading(win);
		assert.isFalse(win.document.getElementById('zotero-items-pane').hidden);assert.strictEqual(win.ZoteroPane.itemsView,tree);assert.equal(tree.getSelectedItems()[0]?.id,selected);
		await wait(()=>nativeTree.getBoundingClientRect().height>100,'恢复原生文库完整列表');assert.notEqual(win.getComputedStyle(nativeTree).display,'none');
		assert.strictEqual((await E.openLibraryWorkspace(win,'discovery')),discovery,'切换复用已有推荐视图');await E.openLibraryReading(win);
	});

	it('opens research conversation without any embedded PDF reader or duplicate reading navigation',async()=>{
		await E.openResearchAgent();assert.equal(ui.activeView,'agent');assert.notExists(frame.contentDocument.querySelector('.rail [data-tab=research]'));
		assert.notExists(ui.agentPreview.querySelector('browser,.workbench-pdf-reader'));assert.exists(ui.$('manuscript-projects'));assert.equal(ui.$('draft').tagName.toLowerCase(),'textarea');
		assert.lengthOf(searchCalls,0);assert.equal(modelCalls,0);assert.equal(downloadCalls,0);assert.equal(frame.contentDocument.documentElement.dataset.appearance,'light');
		await capture('research-conversation-no-embedded-reader');
	});

	it('keeps recommendation scrolling inside the recommendation page and preserves Ctrl wheel',async()=>{
		const discovery=await E.openLibraryWorkspace(win,'discovery'),homeFrame=win.document.getElementById('easysch-library-discovery-frame'),view=homeFrame.contentWindow,scroll=homeFrame.contentDocument.querySelector('main');
		const wheel=(deltaY,ctrlKey=false)=>scroll.dispatchEvent(new view.WheelEvent('wheel',{deltaY,ctrlKey,bubbles:true,cancelable:true}));scroll.scrollTop=0;
		const tabs=win.Zotero_Tabs.getState().length;
		wheel(-80,true);assert.equal(discovery.activeView,'home','Ctrl滚轮不触发模式切换');assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');wheel(-70);assert.equal(discovery.activeView,'home','轻微上滑仍保留推荐');wheel(-60);
		await Zotero.Promise.delay(120);assert.equal(win._researchLibraryWorkspace.mode,'discovery');assert.equal(discovery.activeView,'home');assert.strictEqual(discovery,ui);assert.strictEqual(homeFrame,frame);assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');assert.equal(win.Zotero_Tabs.getState().length,tabs);assert.notExists(win.document.getElementById('easysch-workspace-frame'));
		await capture('native-discovery-retains-scroll-context');
	});

	it('single click previews a stable source, arrow keys preview the next source and only double click opens PDF', async () => {
		await E.openResearchAgent();ui.agentTab='sources';ui.renderAgentSources();const browser=ui.agentSourceList.closest('details');if(browser)browser.open=true;const before = [...ui.agentSourceList.querySelectorAll('.agent-source-row')].map(row => row.dataset.sourceID); const row = ui.agentSourceList.querySelector('.agent-source-row'); assert.exists(row);row.focus();await wait(()=>frame.contentDocument.activeElement===row,'来源列表真实获得焦点'); row.click();
		try { await wait(() => ui.agentPreview.querySelector('[data-preview-paper-id]'), '来源预览'); } catch (error) { throw Error(error.message + '；实际预览：' + ui.agentPreview.textContent + '；已调用条目：' + overviewCalls.join(',')); }
		assert.equal(ui.agentSelected.id, papers[0].id); assert.lengthOf(opened, 0); assert.equal(downloadCalls, 0);
		const focused = frame.contentDocument.activeElement; focused.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await wait(() => ui.agentSelected.id === papers[1].id, '键盘同步预览'); assert.deepEqual([...ui.agentSourceList.querySelectorAll('.agent-source-row')].map(button => button.dataset.sourceID), before); assert.equal(frame.contentDocument.activeElement.dataset.sourceID, 'paper:' + papers[1].id);
		const savedLocal = E.library.localPDF; E.library.localPDF = async () => ({ id: 995502 }); try { ui.agentSourceList.querySelectorAll('.agent-source-row')[1].dispatchEvent(new frame.contentWindow.MouseEvent('dblclick', { bubbles: true })); await wait(() => opened.length === 1, '双击定位来源'); assert.equal(opened[0].attachmentID, 995502); } finally { E.library.localPDF = savedLocal; }
	});

	it('keeps Tab/Enter inert during Chinese composition and allows keyboard mode switching afterwards', async () => {
		const view = frame.contentWindow, mode = ui.agentMode.value; let sent = 0; const run = ui.runAgentTask; ui.runAgentTask = async () => { sent++; };
		try {
			ui.agentInput.dispatchEvent(new view.CompositionEvent('compositionstart', { bubbles: true }));
			for (const key of ['Tab', 'Enter']) ui.agentInput.dispatchEvent(new view.KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true }));
			assert.equal(ui.agentMode.value, mode); assert.equal(sent, 0);
			ui.agentInput.dispatchEvent(new view.CompositionEvent('compositionend', { bubbles: true })); ui.agentInput.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.notEqual(ui.agentMode.value, mode);
			ui.agentInput.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })); assert.equal(sent, 0); ui.agentInput.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(() => sent === 1, 'Enter发送');
		} finally { ui.runAgentTask = run; }
	});

	it('public search returns source previews and successive cached pages without downloading or running a model', async () => {
		ui.agentMode.value = 'search'; ui.agentInput.value = '查找跨设备调制识别的论文'; await ui.runAgentTask(); assert.lengthOf(searchCalls, 1); assert.equal(modelCalls, 0); assert.equal(downloadCalls, 0);
		assert.equal(ui.agentWebSources[0].coverage, '依据摘要 · 全文尚未获取'); assert.notExists(ui.agentSourceList.querySelector('.agent-load-more'));
		const list = ui.agentSourceList, firstIDs = ui.agentWebSources.map(source => source.stableID);
		await wait(() => list.scrollHeight > list.clientHeight + 200, '来源列表实际滚动区域');
		assert.lengthOf(firstIDs, 40); assert.lengthOf(searchCalls, 1, '未到列表末尾不预取下一页');
		for (let index = 0; index < 3; index++) { list.scrollTop = list.scrollHeight; list.dispatchEvent(new frame.contentWindow.Event('scroll')); }
		await wait(() => searchCalls.length === 2 && !ui.agentLoadingPage, '滚动自动加载下一页');
		assert.equal(searchCalls[1].page, 2); assert.lengthOf(ui.agentWebSources, 41); assert.isFalse(ui.agentWebSearch.hasMore);
		assert.deepEqual(ui.agentWebSources.slice(0, 40).map(source => source.stableID), firstIDs, '分页保留原有来源身份与顺序');
		assert.equal(ui.agentWebSources[40].stableID, 'web:10.1000/controlled-2');
		for (let index = 0; index < 3; index++) list.dispatchEvent(new frame.contentWindow.Event('scroll'));
		await Zotero.Promise.delay(100); assert.lengthOf(searchCalls, 2, '重复滚动与观察器共享分页，末页不再请求');
		assert.lengthOf(ui.agentMessages.querySelectorAll('.agent-message.user'), 1); assert.lengthOf(ui.agentMessages.querySelectorAll('.agent-message.assistant'), 1); assert.equal(downloadCalls, 0); assert.equal(modelCalls, 0);
		const obtain = E.obtainPaper, openedBefore = opened.length, pending = []; let requests = 0;
		E.obtainPaper = () => { requests++; return new Promise((resolve, reject) => pending.push({ resolve, reject })); };
		try {
			const source = ui.agentWebSources[0]; ui.previewAgentSource(source); let button = ui.agentPreview.querySelector('.agent-preview-open');
			assert.equal(button.getAttribute('aria-label'), '获取公开全文'); assert.exists(button.querySelector('svg[data-icon=download]')); assert.notInclude(button.textContent, '↗', '公开全文使用下载图标');
			button.click(); button.click(); await wait(() => requests === 1, '受控全文获取'); assert.isTrue(button.disabled); assert.equal(button.getAttribute('aria-busy'), 'true'); assert.exists(button.querySelector('svg[data-icon=loading]'));
			ui.previewAgentSource({ ...source }); button = ui.agentPreview.querySelector('.agent-preview-open'); assert.isTrue(button.disabled, '重绘来源仍保留等待状态');
			const duplicate = ui.openAgentSource({ ...source }); await Zotero.Promise.delay(40); assert.equal(requests, 1, '按钮与其他来源入口共享正在运行的获取');
			pending[0].resolve({ attachmentID: 995509 }); await duplicate; await wait(() => !button.disabled, '全文完成反馈'); assert.exists(button.querySelector('svg[data-icon=saved]')); assert.equal(button.getAttribute('aria-label'), '打开已保存全文');
			button.click(); await wait(() => opened.at(-1)?.attachmentID === 995509, '打开已有全文'); assert.equal(requests, 1, '保存成功后直接打开附件');
			ui.previewAgentSource(ui.agentWebSources[1]); button = ui.agentPreview.querySelector('.agent-preview-open'); button.click(); await wait(() => requests === 2, '第二份受控全文获取'); pending[1].reject(Error('受控公开全文不可用'));
			await wait(() => button.dataset.downloadState === 'error', '全文失败恢复'); assert.isFalse(button.disabled); assert.exists(button.querySelector('svg[data-icon=error]')); assert.equal(button.getAttribute('aria-label'), '重试获取公开全文');
			button.click(); await wait(() => requests === 3, '失败后允许重试'); pending[2].resolve({ attachmentID: 995510 }); await wait(() => button.dataset.downloadState === 'saved', '重试成功'); assert.isFalse(button.disabled);
		} finally { E.obtainPaper = obtain; opened.splice(openedBefore); for (const source of ui.agentWebSources) ui.agentSourceDownloads?.delete(ui.agentSourceDownloadKey(source)); }
	});

	 it('keeps aligned readable turns inside the native CLUI glass shell', async () => {
		ui.agentCLUI.setConversation();await Zotero.Promise.delay(300);
		const view = frame.contentWindow, composer = ui.agentInput.closest('.agent-composer'), composerRect = composer.getBoundingClientRect();
		const messages = [...ui.agentMessages.querySelectorAll('.agent-message.user,.agent-message.assistant')];
		assert.isAtLeast(messages.length, 2);
		for (const message of messages) {
			assert.isAtLeast(message.getBoundingClientRect().left-composerRect.left,12,'卡片保留阅读留白');assert.isAtMost(message.getBoundingClientRect().left-composerRect.left,24,'回答与问题共用同一阅读边界');
			const textStyle=view.getComputedStyle(message.querySelector('.agent-message-text'));
			assert.equal(textStyle.textAlign, 'left');assert.equal(textStyle.fontFamily,view.getComputedStyle(ui.agentInput).fontFamily);assert.equal(textStyle.filter,'none');assert.equal(textStyle.backdropFilter,'none','正文不受到边缘玻璃滤镜影响');
			assert.isAtMost(message.getBoundingClientRect().width, 721, '保留合理正文宽度');
		}
		assert.notEqual(view.getComputedStyle(composer).backdropFilter,'none');assert.notEqual(view.getComputedStyle(frame.contentDocument.querySelector('.agent-clui .clui-native-shell')).backdropFilter,'none');assert.include(view.getComputedStyle(ui.agentMessages).maskImage,'linear-gradient');
		const scroll = ui.agentMessages.scrollTop; ui.agentMessages.scrollTop = 0;
		try { await capture('left-aligned-conversation'); } finally { ui.agentMessages.scrollTop = scroll; }
	 });

	it('material previews and context actions preserve original anchors and do not reorder sources', async () => {
		ui.agentTab = 'materials'; ui.renderAgentSources(); const rows = [...ui.agentSourceList.querySelectorAll('.agent-source-row')], order = rows.map(row => row.dataset.sourceID); rows[0].click(); await wait(() => ui.agentSelected?.id === materials[0].id, '素材中文预览'); assert.include(ui.agentPreview.textContent, '卷积神经网络'); assert.include(ui.agentPreview.textContent, materials[0].sourceText);
		await ui.openAgentSource(ui.agentSelected); assert.equal(opened.at(-1).attachmentID, 995501); assert.equal(opened.at(-1).pageIndex, 2);
		ui.agentSourceList.querySelector('.agent-source-row').dispatchEvent(new frame.contentWindow.MouseEvent('contextmenu', { clientX: 300, clientY: 200, bubbles: true, cancelable: true })); const menu = frame.contentDocument.querySelector('.agent-source-menu'); assert.exists(menu); assert.lengthOf(menu.querySelectorAll('button'), 2); assert.include(menu.textContent, '围绕这份资料提问'); assert.notInclude(menu.textContent, '写论文'); menu.querySelector('button:last-child').click(); await wait(() => !menu.isConnected, '右键提问'); assert.deepEqual([...ui.agentSourceList.querySelectorAll('.agent-source-row')].map(row => row.dataset.sourceID), order);
	});

	it('renders stored material math, script glyphs and table cells without flattening the original source', async () => {
		const priorPage = E.manuscripts.translationPage, priorImage = E.previewImage, openedBefore = opened.length;
		const anchor = { attachmentID: 995501, pageIndex: 2, position: { rects: [[0, 0, 500, 500]] }, sourceText: 'Saved original excerpts.' };
		const rich = {
			pdfHash: 'controlled-rich-source', blocks: [
				{ id: 'controlled-glyphs', kind: 'text', sourceText: 'The state xi2 is observed.\n\nThe original words remain unchanged.', sourceRuns: [{ text: 'The state ' }, { text: 'x', italic: true }, { text: 'i', script: 'sub' }, { text: '2', script: 'super' }, { text: ' is observed.\n\nThe original words remain unchanged.' }], position: { rects: [[10, 10, 200, 40]] } },
				{ id: 'controlled-inline-math', kind: 'text', sourceText: 'The critic minimizes ZXQMATH0ZXQ after training.', fontSize: 10, inlineMath: [{ placeholder: 'ZXQMATH0ZXQ', height: 18, baselineOffset: 3, visualAsset: { path: 'controlled-source-inline.png' } }], position: { rects: [[10, 50, 200, 70]] } },
				{ id: 'controlled-formula', kind: 'formula', latex: 'L = \\sum_{i=1}^{n} x_i^2', position: { rects: [[10, 80, 200, 110]] } },
				{ id: 'controlled-table', kind: 'table', rows: [['Variable', 'Value'], [{ text: 'xi', runs: [{ text: 'x', italic: true }, { text: 'i', script: 'sub' }] }, 'Original measurement']], position: { rects: [[10, 120, 200, 160]] } },
				{ id: 'controlled-original-formula', kind: 'formula', sourceText: 'x i 2 = 1', visualAsset: { path: 'controlled-source-formula.png' }, position: { rects: [[10, 170, 200, 190]] } },
			],
		};
		const crop = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><rect width="220" height="60" fill="white"/><text x="12" y="40" font-family="serif" font-style="italic" font-size="32">x<tspan dy="8" font-size="18">i</tspan><tspan dy="-22" font-size="18">2</tspan><tspan dy="14" font-style="normal" font-size="32"> = 1</tspan></text></svg>');
		E.manuscripts.translationPage = (id, page) => id === 995501 && page === 2 ? rich : priorPage?.(id, page);
		E.previewImage = path => path.startsWith('controlled-source-') ? Promise.resolve(crop) : priorImage(path);
		try {
			assert.exists(ui.agentMaterialSource, '真实工作台加载富原文渲染器');
			ui.previewAgentSource({ ...materials[0], kind: 'material', stableID: 'material:' + materials[0].id, sourceVersion: rich.pdfHash, anchors: [anchor], anchor });
			const source = ui.agentPreview.querySelector('.agent-material-source');
			await E.prepareContentStyles(frame.contentDocument);
			await wait(() => [...source.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0), '原文数学裁图解码');
			assert.equal(source.querySelector('sup').textContent, '2'); assert.equal(source.querySelector('sub').textContent, 'i'); assert.exists(source.querySelector('em'));
			assert.lengthOf(source.querySelectorAll('table'), 1); assert.lengthOf(source.querySelectorAll('tr'), 2); assert.lengthOf(source.querySelectorAll('th'), 2); assert.lengthOf(source.querySelectorAll('td'), 2); assert.exists(source.querySelector('td sub'));
			assert.equal(source.querySelector('.formula-typeset .katex annotation').textContent, 'L = \\sum_{i=1}^{n} x_i^2');
			assert.lengthOf(source.querySelectorAll('img'), 2); assert.notInclude(source.textContent, 'ZXQMATH'); assert.notInclude(source.textContent, 'x i 2 = 1', '未将公式 OCR 当作排版源码');
			const inline = source.querySelector('.agent-source-inline-math'); assert.equal(frame.contentWindow.getComputedStyle(inline).display, 'inline');
			inline.dispatchEvent(new frame.contentWindow.MouseEvent('dblclick', { bubbles: true, cancelable: true })); await wait(() => opened.length > openedBefore, '公式裁图定位原文'); assert.equal(opened.at(-1).attachmentID, 995501); assert.equal(opened.at(-1).pageIndex, 2); assert.deepEqual(opened.at(-1).position, rich.blocks[1].position);
			inline.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter')); await wait(() => frame.contentDocument.querySelector('.research-media-hover'), '局部原式放大');
			await capture('material-original-math-and-table'); ui.previewAgentSource({ ...materials[1], kind: 'material', stableID: 'material:' + materials[1].id }); assert.notExists(frame.contentDocument.querySelector('.research-media-hover'), '切换素材清理旧悬停层'); assert.isFalse(source.isConnected);
		} finally { E.manuscripts.translationPage = priorPage; E.previewImage = priorImage; opened.splice(openedBefore); }
	});

	it('preserves source browsing scroll and discards stale image previews when switching back to the same card', async () => {
		const priorPreview = E.previewImage, priorState = E.notebook.state, priorMarkdown = E.notebook.planMarkdown, releases = []; let subscriptions = 0, hoverCleanups = 0;
		E.previewImage = () => new Promise(resolve => releases.push(resolve));
		try {
			const first = { ...materials[0], kind: 'material', stableID: 'material:' + materials[0].id, imagePath: 'controlled-image.png' }, second = { ...materials[1], kind: 'material', stableID: 'material:' + materials[1].id };
			ui.previewAgentSource(first); ui.previewAgentSource(second); ui.previewAgentSource(first); assert.lengthOf(releases, 2);
			releases[0]('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')); await Zotero.Promise.delay(30); assert.lengthOf(ui.agentPreview.querySelectorAll('img[src]'), 0, '第一次A的晚回复不能写进第三次A');
			releases[1]('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')); await wait(() => ui.agentPreview.querySelectorAll('img[src]').length === 1, '当前图片预览');
			const subscribed = ui.el('div'); subscribed._overviewOff = () => subscriptions++; subscribed._overviewHoverCleanup = () => hoverCleanups++; ui.agentPreview.append(subscribed);
			E.notebook.state = () => ({ versions: [{ id: 'controlled-plan', number: 1 }] }); E.notebook.planMarkdown = () => '受控实验计划，非实验结果。'; await ui.showAgentPlan(project.id, 'controlled-plan'); assert.equal(subscriptions, 1); assert.equal(hoverCleanups, 1);
			ui.agentTab = 'sources'; const originals = ui.agentSources; ui.agentSources = Array.from({ length: 60 }, (_, index) => ({ ...papers[0], id: 'controlled-scroll-' + index, title: '受控滚动来源 ' + index })); ui.renderAgentSources(); ui.agentSourceList.scrollTop = 260; const before = ui.agentSourceList.scrollTop; assert.isAbove(before, 0); ui.renderAgentSources(); assert.equal(ui.agentSourceList.scrollTop, before, '独立保存通知不能把来源列表跳回顶部'); ui.agentSources = originals; ui.renderAgentSources();
		} finally { E.previewImage = priorPreview; E.notebook.state = priorState; E.notebook.planMarkdown = priorMarkdown; }
	});

	it('fits the actual workbench widths and keeps one bottom composer clear of source content', async () => {
		ui.openAgentWorkbench(); await Zotero.Promise.delay(100); const savedStyle = frame.getAttribute('style');
		const logo = ui.$('view-agent').querySelector('.agent-composer-footer .easysch-symbol'); assert.isAbove(logo.getBoundingClientRect().width, 15); const logoStyle = frame.contentWindow.getComputedStyle(logo); assert.include(logoStyle.backgroundImage, 'easysch-symbol-black.png'); const logoImage = new frame.contentWindow.Image(); logoImage.src = logoStyle.backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1]; await logoImage.decode(); assert.isAbove(logoImage.naturalWidth, 0, '复用的实际Logo资源可解码');
		try { for (const width of [1100, 900]) { frame.style.width = width + 'px'; frame.style.maxWidth = width + 'px'; await Zotero.Promise.delay(100); const workbench = ui.$('view-agent'), composer = workbench.querySelector('.agent-composer'), conversation = workbench.querySelector('.agent-conversation'); assert.isAtMost(workbench.scrollWidth - workbench.clientWidth, 2, '工作台不横向溢出'); assert.isAtMost(composer.getBoundingClientRect().bottom, conversation.getBoundingClientRect().bottom + 1); assert.lengthOf(workbench.querySelectorAll('.agent-composer textarea'), 1); assert.oneOf(frame.contentWindow.getComputedStyle(composer).position, ['static','relative'], '输入框留在flex正常流，仅为渐隐边缘提供定位'); assert.isAtMost(ui.agentMessages.getBoundingClientRect().bottom,composer.getBoundingClientRect().top+1,'底部输入框不会覆盖可选的消息'); assert.equal(frame.contentWindow.getComputedStyle(ui.agentSourceList).overflowY, 'auto'); } await capture('agent-workbench-narrow'); }
		finally { frame.setAttribute('style', savedStyle); }
		await capture('agent-workbench');
	});

	it('grows the existing multiline input upward and keeps the send baseline, focus, caret and IME behavior', async () => {
		// Prior source/detail actions can leave another native tab selected. A
		// hidden chrome iframe cannot receive focus, even though its layout still
		// reports the resized textarea. Use the real entry route before testing
		// that resizing preserves an already focused input.
		await E.openResearchAgent();
		await wait(() => win.Zotero_Tabs.selectedID === 'zotero-pane' && !frame.inert, '原生文库中的研究对话可见');
		ui.openAgentWorkbench(); const view = frame.contentWindow, input = ui.agentInput, composer = ui.$('view-agent').querySelector('.agent-composer'), value = input.value;
		const inputEvent = () => input.dispatchEvent(new view.Event('input', { bubbles: true }));
		try {
			input.value = ''; inputEvent(); await wait(() => input.getBoundingClientRect().height <= 77, '恢复默认输入高度');
			input.focus(); await wait(() => frame.contentDocument.activeElement === input, '多行展开前输入框实际获得焦点');
			const before = composer.getBoundingClientRect(), sendBefore = ui.agentSend.getBoundingClientRect(), inputBefore = input.getBoundingClientRect();
			const calls = searchCalls.length, requests = modelCalls, messages = ui.agentData.messages.length;
			input.value = Array.from({ length: 14 }, (_, index) => '第' + (index + 1) + '条：核对研究资料和实验条件。').join('\n'); input.setSelectionRange(18, 18); inputEvent();
			await wait(() => input.getBoundingClientRect().height >= 179, '多行输入向上展开'); const after = composer.getBoundingClientRect(), sendAfter = ui.agentSend.getBoundingClientRect();
			assert.strictEqual(ui.agentInput, input, '不替换或复制用户输入节点'); assert.strictEqual(frame.contentDocument.activeElement, input); assert.equal(input.selectionStart, 18); assert.equal(input.selectionEnd, 18);
			assert.closeTo(after.bottom, before.bottom, 1, '输入框底边不位移'); assert.closeTo(sendAfter.bottom, sendBefore.bottom, 1, '发送按钮保持底部基线'); assert.closeTo(after.width, before.width, 1, '宽度不随输入跳动'); assert.isBelow(after.top, before.top - 60, '高度从底部向上增长'); assert.isAtMost(input.getBoundingClientRect().height, 181);
			if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) { assert.include(view.getComputedStyle(input).transitionProperty, 'height'); assert.isAbove(parseFloat(view.getComputedStyle(input).transitionDuration), 0); }
			input.dispatchEvent(new view.CompositionEvent('compositionstart', { bubbles: true })); input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); assert.lengthOf(ui.agentData.messages, messages); assert.equal(searchCalls.length, calls); assert.equal(modelCalls, requests); input.dispatchEvent(new view.CompositionEvent('compositionend', { bubbles: true }));
			await capture('agent-workbench-multiline');
			input.value = ''; inputEvent(); await wait(() => Math.abs(input.getBoundingClientRect().height-inputBefore.height)<1, '清空后平滑收回'); assert.closeTo(input.getBoundingClientRect().height, inputBefore.height, 1); assert.closeTo(composer.getBoundingClientRect().bottom, before.bottom, 1); assert.strictEqual(frame.contentDocument.activeElement, input);
		} finally { input.value = value; inputEvent(); await ui.flushAgentDraft(); }
	});

	it('restores actual saved conversation, selected material and mode after a chrome page reload', async () => {
		const draft = '尚未发送的研究问题\n需要核对数据划分。'; ui.agentInput.value = draft; ui.agentInput.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true })); await ui.flushAgentDraft();
		ui.agentData.mode = 'organize'; ui.agentMode.value = 'organize'; ui.previewAgentSource({ ...materials[1], kind: 'material', stableID: 'material:' + materials[1].id }); await ui.saveAgentState(); await E.store.flush(); const selectedID = ui.agentData.selectedID; const old = ui; frame.contentWindow.location.reload(); await wait(() => { ui = frame.contentWindow.EasySchUI; return ui && ui !== old && ui.ready && win._researchLibraryWorkspace.ui===ui && !frame.inert && ui.agentSelected?.stableID === selectedID; }, '同页重载恢复研究记录与宿主');
		assert.equal(ui.agentMode.value, 'organize'); assert.lengthOf(ui.agentData.messages, 2); assert.include(ui.agentData.messages[1].text, '公开文献候选'); assert.equal(ui.agentSelected.id, materials[1].id); assert.lengthOf(searchCalls, 2, '重载不重新联网检索'); assert.equal(modelCalls, 0); assert.equal(downloadCalls, 0);
		assert.equal(ui.agentInput.value, draft, '保留未发送草稿，不自动提交');
		ui.agentReturn={tab:'home',scroll:0};ui.openAgentWorkbench(); frame.contentWindow.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(()=>win.Zotero_Tabs.selectedID==='zotero-pane'&&win._researchLibraryWorkspace.mode==='discovery'&&ui.activeView==='home','Esc 返回同一文库推荐');
	});

	it('the native conversation entry reuses the ready workspace and opens agent mode without submitting', async () => {
		const previousFrame = frame, searches = searchCalls.length, messages = ui.agentData.messages.length;
		assert.isFunction(E.openResearchAgent);
		await E.openResearchAgent();
		assert.strictEqual(win.document.getElementById('easysch-library-discovery-frame'), previousFrame); assert.lengthOf(win.document.querySelectorAll('#easysch-library-discovery-frame'), 1); assert.notExists(win.document.getElementById('easysch-workspace-frame'));assert.equal(ui.activeView, 'agent'); assert.lengthOf(ui.agentData.messages, messages); assert.lengthOf(searchCalls, searches); assert.equal(modelCalls, 0); assert.equal(downloadCalls, 0);
	});

	it('continues a unified task in this conversation and preserves separate drafts when creating or switching sessions', async () => {
		const legacy = E.runWorkbenchTask, originalID = ui.agentData.activeSessionID, originalProject = JSON.stringify(E.manuscripts.get(project.id)), priorSessionIDs = (E.store.get('researchWorkbench')?.sessions||[]).map(session => session.id); let calls = 0;
		E.runWorkbenchTask = async request => { calls++; assert.equal(request.modelID, 'controlled-model'); assert.equal(request.thinkingLevel, 'medium'); assert.isTrue(request.history.some(message => message.role === 'user')); request.onProgress('正在核对已有证据'); return { text: '受控可行性讨论：先核对数据划分，实验尚未完成。', sources: [{ ...papers[0], kind: 'paper', stableID: 'paper:' + papers[0].id }], steps: ['查找证据', '检查实验条件'] }; };
		try {
			ui.agentMode.value = 'auto'; ui.agentThinking.value = 'medium'; ui.agentInput.value = '比较已找到论文的方法和实验条件'; await ui.runAgentTask(); assert.equal(calls, 1); assert.include(ui.agentData.messages.at(-1).text, '实验尚未完成'); assert.equal(JSON.stringify(E.manuscripts.get(project.id)), originalProject, '对话任务不改写论文'); const savedMessages = ui.agentData.messages.length;
			await ui.createAgentSession(); const nextID = ui.agentData.activeSessionID; assert.notEqual(nextID, originalID); assert.lengthOf(ui.agentData.messages, 0); assert.equal(ui.agentInput.value, ''); ui.agentInput.value = '第二个研究问题的未发送草稿'; ui.agentInput.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true })); await ui.flushAgentDraft();
			await ui.switchAgentSession(originalID); assert.lengthOf(ui.agentData.messages, savedMessages); assert.equal(ui.agentInput.value, ''); await ui.switchAgentSession(nextID); assert.equal(ui.agentInput.value, '第二个研究问题的未发送草稿'); const saved = E.store.get('researchWorkbench'); assert.equal(saved.version, 2); assert.equal(saved.sessions.length, priorSessionIDs.length + 1, '用户已编写的新草稿会保存在历史中'); assert.isTrue(priorSessionIDs.every(id => saved.sessions.some(session => session.id === id)), '旧会话全部保留'); assert.equal(saved.sessions.find(session=>session.id===nextID)?.draft,'第二个研究问题的未发送草稿','保存分支保留未发送内容供重启恢复'); assert.equal(E.workbenchConversations.snapshot().activeSessionID,nextID); assert.equal(E.workbenchConversations.get(nextID).draft,'第二个研究问题的未发送草稿'); assert.lengthOf(ui.agentSessionList.querySelectorAll('.agent-session-row'), saved.sessions.length);
			await ui.switchAgentSession(originalID); assert.equal(calls, 1, '切换对话不会重新提交研究任务');
		} finally { E.runWorkbenchTask = legacy; }
	});

	it('keeps the source tabs in a stable order and releases embedded panes when switching views', async () => {
		const legacy = E.mountWorkbenchSourcePane; let mounted = [], cleaned = 0;
		E.mountWorkbenchSourcePane = async (host, row, tab, options) => { mounted.push(tab); assert.isFalse(options.signal.aborted); host.replaceChildren(ui.el('p', '受控来源面板 · ' + tab)); return () => { cleaned++; }; };
		try { ui.previewAgentSource({ ...materials[0], kind: 'material', stableID: 'material:' + materials[0].id }); const tabs = () => [...ui.agentPreview.querySelectorAll('[data-preview-tab]')].map(button => button.dataset.previewTab); assert.deepEqual(tabs(), ['info', 'images', 'annotations', 'references']);
			const original = ui.agentPreview.querySelector('.agent-preview-open'); assert.equal(original.getAttribute('aria-label'), '查看原文');const before=opened.length;original.click();await wait(()=>opened.length===before+1,'明确打开原生来源');assert.lengthOf(mounted,0,'预览栏不实例化PDF');
			assert.equal(ui.agentPreview.querySelector('[data-preview-tab=info]').getAttribute('aria-selected'), 'true');
			await ui.renderAgentPreviewPane(ui.agentSelected, 'images');assert.equal(cleaned,0);assert.deepEqual(tabs(),['info','images','annotations','references']);ui.previewAgentSource({...materials[1],kind:'material',stableID:'material:'+materials[1].id});assert.equal(cleaned,1);assert.deepEqual(mounted,['images']); }
		finally { E.mountWorkbenchSourcePane = legacy; }
	});

	it('uses conversation file selection and curation with a real sidebar and spreadsheet detail without changing the question scope',async()=>{
		const oldPreview=E.chatAttachments.preview,oldLocation=E.chatAttachments.location,oldRun=E.runWorkbenchTask;let request;
		try{
			await ui.createAgentSession();ui.openAgentWorkbench();const id=ui.agentData.activeSessionID;
			E.chatAttachments.location=async()=>({path:'受控文件位置（UI 验收）',folders:['受控工作台项目'],library:'我的文库'});
			E.chatAttachments.preview=async(sessionID,fileID)=>{assert.equal(sessionID,id);assert.equal(fileID,'attachment:controlled-sheet');return {kind:'spreadsheet',reference:E.chatAttachments.get(id)[0],rows:[],warnings:[],workbook:{selectedSheet:'实验',sheets:[{name:'实验',rows:3,columns:2}],sections:[{range:'A1:B3',startColumn:1,endColumn:2,cells:[{row:1,values:['方法','准确率']},{row:2,values:['基线',0.81]},{row:3,values:['实验',0.84]}]}]}};};
			await E.workbenchConversations.attach(id,[{id:'attachment:controlled-sheet',title:'实验对照.xlsx',kind:'spreadsheet',attachmentID:999990},{id:'attachment:controlled-note',title:'实验备忘.txt',kind:'text',attachmentID:999991}]);
			const rail=ui.agentFileRails[0].root;await wait(()=>rail.querySelectorAll('.conversation-file').length===2,'当前对话文件');
			rail.querySelector('[data-file-id="attachment:controlled-sheet"] .conversation-file-star').click();await wait(()=>E.chatAttachments.get(id)[0].featured,'保存精选');
			rail.querySelector('[data-file-filter=featured]').click();assert.lengthOf(rail.querySelectorAll('.conversation-file'),1);rail.querySelector('[data-file-filter=all]').click();
			rail.querySelector('[data-file-id="attachment:controlled-note"] .conversation-file-check').click();await wait(()=>E.chatAttachments.get(id)[1].selected===false,'取消本轮备忘');
			rail.querySelector('[data-file-id="attachment:controlled-sheet"] .conversation-file-preview').click();await wait(()=>ui.agentPreview.querySelector('.conversation-sheet-table'),'实际单元格预览');assert.include(ui.agentPreview.textContent,'0.84');assert.lengthOf(ui.agentPreview.querySelectorAll('browser,iframe'),0);
			await capture('conversation-files-spreadsheet-detail');
			E.runWorkbenchTask=async value=>{request=value;return {text:'根据当前选中的实验表比较。',sources:[],steps:[]};};ui.agentInput.value='比较所选表格中的方法';await ui.runAgentTask();assert.equal(request.sessionID,id);assert.deepEqual(request.attachments.map(row=>row.id),['attachment:controlled-sheet']);assert.equal(ui.agentData.activeSessionID,id,'预览及提问保留多文件会话');
			await ui.createAgentSession();assert.lengthOf(ui.agentFileRails[0].root.querySelectorAll('.conversation-file'),0,'新对话不显示旧文件');await ui.switchAgentSession(id);await wait(()=>ui.agentFileRails[0].root.querySelectorAll('.conversation-file').length===2,'恢复所属对话文件');assert.isTrue(E.chatAttachments.get(id)[0].featured);assert.isFalse(E.chatAttachments.get(id)[1].selected);
		}finally{E.chatAttachments.preview=oldPreview;E.chatAttachments.location=oldLocation;E.runWorkbenchTask=oldRun;}
	});
	it('offers an explicit research direction choice and drafts the confirmed answer without sending a task',async()=>{
		ui.openAgentWorkbench();const before=ui.agentData.messages.length;ui.agentInput.value='';const pending=ui.chooseAgentDirection();
		await wait(()=>frame.contentDocument.querySelector('.conversation-question-option'),'方向选择卡');const doc=frame.contentDocument;doc.querySelector('.conversation-question-option').click();assert.equal(ui.agentInput.value,'');assert.equal(ui.agentData.messages.length,before);doc.querySelector('.conversation-question-submit').click();await pending;assert.include(ui.agentInput.value,'确定研究方向');assert.equal(ui.agentData.messages.length,before);await capture('conversation-research-direction-choice');
	});
	 it('uses compact input, a normal reply card and enlarged inspection with dim-only single clicks and pinned double-click behavior',async()=>{
		await ui.createAgentSession();ui.openAgentWorkbench();const id=ui.agentData.activeSessionID,doc=frame.contentDocument,view=frame.contentWindow,root=doc.querySelector('.agent-clui');
		assert.equal(root.dataset.cluiSize,'compact');
		const center=doc.querySelector('.agent-conversation');assert.isAbove(parseFloat(view.getComputedStyle(center).borderTopWidth),0,'中心对话有明确框架');assert.isAbove(parseFloat(view.getComputedStyle(center).borderRadius),10);assert.equal(doc.querySelector('.agent-topbar .agent-new-session'),null,'新对话只放资料栏');
		const starter=doc.querySelector('.agent-workspace-starter');starter.click();await wait(()=>ui.agentInput.value.includes('本次资料'),'研究快捷问题填入');ui.agentInput.value='';ui.updateAgentDraft();
		await E.workbenchConversations.append(id,{role:'user',text:'请核对这些研究条件。'});await E.workbenchConversations.append(id,{role:'assistant',text:Array.from({length:12},(_,i)=>'研究条件 '+(i+1)+'：按设备划分数据，保留验证集和独立测试集。').join('\n\n'),sources:[]});
		ui.agentCLUI.setConversation();await Zotero.Promise.delay(320);const normal=root.getBoundingClientRect(),normalLog=ui.agentMessages.getBoundingClientRect();assert.isAbove(normalLog.height,center.getBoundingClientRect().height*.35,'常规对话充分使用中心高度');assert.isAbove(normal.width,center.getBoundingClientRect().width*.85);assert.equal(doc.querySelector('.agent-conversation-heading').textContent.includes('本次资料'),true);await capture('research-clui-conversation');
		ui.agentMessages.querySelector('.agent-message-text').dispatchEvent(new view.MouseEvent('click',{bubbles:true}));await Zotero.Promise.delay(320);assert.equal(root.dataset.cluiSize,'detail');assert.isAbove(ui.agentMessages.getBoundingClientRect().height,normalLog.height+40);assert.isAtLeast(root.getBoundingClientRect().width,normal.width);await capture('research-clui-detail');
		doc.body.dispatchEvent(new view.MouseEvent('click',{bubbles:true}));assert.equal(root.dataset.dimmed,'true');assert.equal(root.dataset.cluiSize,'detail');
		ui.agentCLUI.setPinned(true);doc.body.dispatchEvent(new view.MouseEvent('dblclick',{bubbles:true}));assert.equal(root.dataset.cluiSize,'detail');ui.agentCLUI.setPinned(false);doc.body.dispatchEvent(new view.MouseEvent('dblclick',{bubbles:true}));await Zotero.Promise.delay(320);assert.equal(root.dataset.cluiSize,'compact');assert.isBelow(root.getBoundingClientRect().height,normal.height-80);await capture('research-clui-compact');
	 });
	it('switches recent conversations without scanning manuscripts or rebuilding retained answer content',async()=>{
		const S=E.workbenchConversations,first=ui.agentData.activeSessionID,second=await S.create({title:'原生性能切换验收',origin:'workbench'});await S.append(second.id,{role:'user',text:'另一段研究问题'});await S.append(second.id,{role:'assistant',text:'保留这段对话内容。',sources:[]});await ui.switchAgentSession(first);
		const answer=ui.agentMessages.querySelector('.agent-message.assistant'),all=E.manuscripts.all;let scans=0;E.manuscripts.all=(...args)=>{scans++;return all.apply(E.manuscripts,args);};
		try{await S.update(first,{draft:'未发送的性能验收草稿'},{origin:'agent'});assert.strictEqual(ui.agentMessages.querySelector('.agent-message.assistant'),answer);await ui.switchAgentSession(second.id);await ui.switchAgentSession(first);await Zotero.Promise.delay(180);assert.equal(ui.agentInput.value,'未发送的性能验收草稿');assert.strictEqual(ui.agentMessages.querySelector('.agent-message.assistant'),answer,'切换回来复用Markdown及图片节点');assert.equal(scans,0,'草稿及会话切换不扫描全部论文项目');await capture('research-conversation-performance-retained');}
		finally{E.manuscripts.all=all;await S.remove(second.id);}
	});
});
