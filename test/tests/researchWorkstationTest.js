describe('Built-in research workstation', function () {
	let R = Zotero.Research, win, item;
	before(async function () {
		win = await loadZoteroPane();
		// This is the isolated test profile. Clear restored test tabs before exercising focus-sensitive menus.
		win.Zotero_Tabs.closeAll();win.focus();await Zotero.Promise.delay(300);
		win.resizeTo(1500, 920);
		await R.attachWindow(win);
		item = await createDataObject('item', { itemType: 'journalArticle', title: 'Research integration fixture', ISSN: '0028-0836', date: '2020' });
		item.setField('ISSN', '0028-0836'); item.setField('date', '2020'); await item.saveTx();
	});
	after(function () { win?.close(); });
	it('uses home actions, persistent task editing and reviewed writing cards in the native UI',async function(){
		this.timeout(60000);win.Zotero_Tabs.select('zotero-pane');
		const pane=win.document.getElementById('zotero-items-pane'),menu=win.document.getElementById('research-home-menu');assert.exists(menu);
		pane.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,screenX:400,screenY:400}));await Zotero.Promise.delay(200);assert.equal(menu.state,'open');assert.lengthOf(menu.children,5);await capture('workflow-home-menu.png');menu.hidePopup();
		const ui=await R.openWorkflow('schedule');ui.$('task-title').value='UI 测试：完成论文方法复现';ui.$('task-date').value='2026-09-12T15:30';ui.$('add-task').click();
		for(let n=0;n<100&&!R.store.get().tasks.some(t=>t.title==='UI 测试：完成论文方法复现');n++)await Zotero.Promise.delay(30);
		assert.isTrue(R.store.get().tasks.some(t=>t.due==='2026-09-12T15:30'));ui.papers=[];ui.renderTasks();assert.include(ui.$('tasks').textContent,'UI 测试：完成论文方法复现');await capture('workflow-tasks.png');
		ui.show('writing');const before=ui.$('draft').value;ui.$('writing-card-body').value='我的实验只提供真实数据，当前结果仍待验证。';[...ui.$('writing-cards').querySelectorAll('button')].find(b=>b.textContent==='预览并插入内容卡').click();assert.equal(ui.$('draft').value,before);assert.include(ui.$('writing-insert-preview').textContent,'当前结果仍待验证');await capture('workflow-writing-preview.png');
		ui.$('writing-insert-preview').querySelector('button').click();await Zotero.Promise.delay(300);assert.include(ui.$('draft').value,'当前结果仍待验证');await ui.saveDraft(false);
		ui.show('research');assert.exists(ui.$('research-choose-papers'));await capture('workflow-reading.png');
	});
	it('previews references and confirms evidence-backed knowledge through the UI',async function(){
		this.timeout(60000);const ui=await R.openWorkflow('research',{paperID:item.id});
		const lookup=sinon.stub(R,'discover').resolves({records:[{title:'参考文献 UI 测试夹具',source:'Crossref',doi:'10.1000/test',url:'https://doi.org/10.1000/test',abstract:'受控摘要，用于界面测试',authors:[],reason:'出版者登记的引用关系'}],at:new Date().toISOString(),cacheHit:false});
		try{ui.show('search');await Zotero.Promise.delay(200);assert.include(ui.$('search-results').textContent,'参考文献 UI 测试夹具');ui.$('search-results').querySelector('details').open=true;await capture('workflow-references.png');}finally{lookup.restore();}
		const source={id:'P1-S',text:'Exact method evidence for this controlled UI fixture.',label:'测试夹具证据',uri:R.library.uri(item)};
		const ai=sinon.stub(R.ai,'run').resolves({model:'test-fixture',at:new Date().toISOString(),result:{sections:[{heading:'方法节点（测试）',body:'受控 AI 归纳，用于核对确认流程',quotes:[{source_id:'P1-S',text:'Exact method evidence'}],sources:['P1-S']}]},sources:[source]});
		try{ui.show('graph');ui.$('knowledge-suggest').click();for(let n=0;n<100&&!ui.$('graph-edges').querySelector('.knowledge-candidate');n++)await Zotero.Promise.delay(30);assert.exists(ui.$('graph-edges').querySelector('.knowledge-candidate'));await capture('workflow-knowledge-candidates.png');[...ui.$('graph-edges').querySelectorAll('button')].find(b=>b.textContent==='确认加入网络').click();await Zotero.Promise.delay(200);assert.exists(ui.$('graph').querySelector('svg'));await capture('workflow-knowledge-confirmed.png');}finally{ai.restore();}
	});
	it('opens all four PPT entries and edits an AUTO draft through six native steps', async function(){
		this.timeout(180000);
		let pdf=Zotero.Prefs.get('extensions.easysch.testPDF',true);if(!pdf||!Zotero.Prefs.get('extensions.easysch.assetPython',true))this.skip();
		const paper=await createDataObject('item',{itemType:'journalArticle',title:'PPT AUTO native fixture'});
		const attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(pdf),parentItemID:paper.id});
		await win.ZoteroPane.selectItem(paper.id);
		const wait=async fn=>{for(let n=0;n<1200;n++){if(fn())return;await Zotero.Promise.delay(50);}assert.isTrue(!!fn(),'UI operation did not complete');};
		assert.notExists(win.document.getElementById('easysch-ppt-toolbar'));const toolbar=win.document.querySelector('#easysch-home-navigation [data-page=ppt]');assert.exists(toolbar);toolbar.click();
		let frame;await wait(()=>{frame=win.document.getElementById('easysch-workspace-frame');return frame?.contentWindow.EasySchUI?.pptDraft;});
		let ui=frame.contentWindow.EasySchUI;assert.isFalse(ui.$('view-ppt').hidden);
		const first=ui.pptDraft.id;win.document.getElementById('easysch-ppt-context').dispatchEvent(new win.Event('command'));await wait(()=>ui.pptDraft.id!==first);
		const second=ui.pptDraft.id;ui.$('easysch-ppt-home').click();await wait(()=>ui.pptDraft.id!==second);
		const reader=await Zotero.Reader.open(attachment.id);await reader._initPromise;const rd=reader._iframeWindow.document;
		assert.notExists(rd.querySelector('.easysch-ppt-reader'));
		win.Zotero_Tabs.select(frame.parentElement.id);await Zotero.Promise.delay(200);await capture('ppt-step-1-materials.png');
		const secondPaper=await createDataObject('item',{itemType:'journalArticle',title:'PPT second paper picker fixture '+Date.now()});
		await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(pdf),parentItemID:secondPaper.id});
		ui.$('ppt-choose-papers').click();await wait(()=>ui.$('ppt-paper-picker')?.querySelector('input'));const pickerSearch=ui.$('ppt-paper-picker').querySelector('input');pickerSearch.value=secondPaper.getField('title');pickerSearch.dispatchEvent(new frame.contentWindow.Event('input'));await wait(()=>ui.$('ppt-paper-picker')?.querySelector(`[data-paper-id="${secondPaper.id}"]`));
		ui.$('ppt-paper-picker').querySelector(`[data-paper-id="${secondPaper.id}"]`).click();await capture('ppt-multiple-paper-picker.png');ui.$('ppt-paper-picker').querySelector('button.primary').click();await wait(()=>ui.pptDraft.papers.length===2);assert.equal(ui.pptDraft.templateID,'review');
		const scopeSelect=ui.$('ppt-source-scope').querySelector('select');scopeSelect.value='pages';scopeSelect.dispatchEvent(new frame.contentWindow.Event('change'));await wait(()=>ui.$('ppt-source-scope').querySelector('input'));
		const range=ui.$('ppt-source-scope').querySelector('input');range.value='1–2';range.dispatchEvent(new frame.contentWindow.Event('change'));await wait(()=>ui.pptDraft.scope.ranges?.[paper.id]==='1–2');
		const range2=ui.$('ppt-source-scope').querySelectorAll('input')[1];range2.value='1–2';range2.dispatchEvent(new frame.contentWindow.Event('change'));await wait(()=>ui.pptDraft.scope.ranges?.[secondPaper.id]==='1–2');
		await capture('ppt-source-scope.png');
		ui.$('ppt-next').click();await wait(()=>!ui.pptAbort&&ui.pptDraft.materialsReady);assert.equal(ui.pptDraft.step,1);
		assert.isTrue(ui.pptDraft.sources.every(s=>s.pageIndex===0||s.pageIndex===1),'PPT must exclude unselected pages and abstract');
		assert.lengthOf(ui.$('ppt-stage').querySelectorAll('[data-theme]'),4);await capture('ppt-step-2-templates.png');
		let calls=0;const original=R.studio.request;
		R.studio.request=async(system,input)=>{
			calls++;let id=input.sources[0].id;
			if(!input.outline)return {value:{sections:[{title:'研究问题',purpose:'论文提出的问题与范围',sourceIDs:[id],diagram:false},{title:'方法总览',purpose:'有证据的方法步骤',sourceIDs:[id],diagram:true},{title:'局限与讨论',purpose:'证据边界与待核对问题',sourceIDs:[id],diagram:false}]},model:'test-fixture'};
			const block={kind:'synthesis',text:'软件测试夹具用于验证完整论证内容能够保留。该页面明确区分论文提供的材料、系统归纳和仍需核对的问题，不代表真实科研结论。',evidenceIDs:[id]};
			return {value:{title:input.outline.title,explanation:'本页用于验证组会的图文编辑、来源显示和讲稿保留，不作为论文分析结果。',blocks:[{...block},{...block,kind:'unverified'},{...block}],notes:'测试讲稿，使用者应核对实际论文。',assetIDs:[],diagram:input.outline.diagram?{diagramType:'method_pipeline',title:'测试方法',nodes:[{id:'input',label:'输入材料',evidenceIDs:[id]},{id:'method',label:'分析步骤',evidenceIDs:[id]},{id:'output',label:'输出证据',evidenceIDs:[id]}],edges:[{source:'input',target:'method',relation:'分析'},{source:'method',target:'output',relation:'保存'}]}:undefined},model:'test-fixture',at:new Date().toISOString()};
		};
		try{
			ui.$('ppt-next').click();await wait(()=>!ui.pptAbort&&ui.pptDraft.step===2);const title=ui.$('ppt-outline').querySelector('input');title.value='用户修改的研究问题';title.dispatchEvent(new frame.contentWindow.Event('change'));await R.store.flush();await capture('ppt-step-3-outline.png');
			ui.$('ppt-next').click();await wait(()=>!ui.pptAbort&&ui.pptDraft.slides.length===3&&ui.pptDraft.slides.every(s=>s.status==='generated'));assert.equal(ui.pptDraft.slides[0].title,'用户修改的研究问题');await capture('ppt-step-4-visuals.png');
			ui.$('ppt-next').click();await wait(()=>ui.pptDraft.step===4);ui.$('ppt-user-text').value='我的复现实验使用独立数据划分，目前仍在排查数据预处理差异。这是用户自己的实验记录。';ui.$('ppt-add-contribution').click();await wait(()=>ui.pptDraft.contributions.length===1);await capture('ppt-step-5-my-experiment.png');
			ui.$('ppt-next').click();await wait(()=>ui.pptDraft.step===5);ui.pptSelected=1;ui.renderPPT();await wait(()=>ui.pptGraph?.getNodes().length===3||ui.$('ppt-graph')?.dataset.error);assert.isUndefined(ui.$('ppt-graph')?.dataset.error,ui.$('ppt-graph')?.dataset.error);
			const node=ui.$('ppt-diagram-editor').querySelector('.ppt-node-label');node.value='用户修改的输入';node.dispatchEvent(new frame.contentWindow.Event('change'));await wait(()=>R.studio.get(ui.pptDraft.id).slides[1].diagram.nodes[0].label==='用户修改的输入');
			await capture('ppt-step-6-diagram-editor.png');const before=R.studio.get(ui.pptDraft.id).slides[0],count=calls;ui.$('ppt-regenerate-page').click();await wait(()=>!ui.pptAbort&&calls>count);assert.equal(calls,count+1);assert.deepEqual(R.studio.get(ui.pptDraft.id).slides[0],before);
			const id=ui.pptDraft.id;win.Zotero_Tabs.close(frame.parentElement.id);await Zotero.Promise.delay(300);await R.studio.open();frame=win.document.getElementById('easysch-workspace-frame');ui=frame.contentWindow.EasySchUI;assert.equal(ui.pptDraft.id,id);assert.equal(ui.pptDraft.contributions.length,1);
			ui.pptSelected=1;ui.renderPPT();await ui.pptTask((status,signal)=>R.studio.renderPage(id,ui.pptDraft.slides[1].id,status,signal));assert.exists(ui.pptDraft.previews?.[ui.pptDraft.slides[1].id]?.path,ui.pptTaskText);
			win.Zotero_Tabs.select(frame.parentElement.id);await Zotero.Promise.delay(300);await capture('ppt-native-real-page.png');
		}finally{R.studio.request=original;await reader.close();}
	});
	it('generates a real evidence-linked AUTO presentation with the configured remote model', async function(){
		this.timeout(1800000);if(!Zotero.Prefs.get('extensions.easysch.livePPTTest',true))this.skip();
		const existingID=R.store.get().livePPTDraftID,existing=existingID&&R.studio.get(existingID);
		const pdf=Zotero.Prefs.get('extensions.easysch.testPDF',true),paper=await createDataObject('item',{itemType:'journalArticle',title:'C-AMC: Towards Complete Automatic Modulation Classification'});
		await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(pdf),parentItemID:paper.id});
		await R.studio.open({papers:[R.library.describe(paper)],newDraft:true});
		const frame=win.document.getElementById('easysch-workspace-frame'),ui=frame.contentWindow.EasySchUI;
		if(existing?.slides.length){ui.pptDraft=existing;if(existing.plannerVersion!==R.studio.plannerVersion){await R.studio.collect(existing.id,()=>{});await R.studio.prepareSlides(existing.id);}await ui.pptPatch(d=>d.step=3);ui.renderPPT();}else await R.store.update(s=>s.livePPTDraftID=ui.pptDraft.id);
		const wait=async()=>{for(let n=0;n<16000&&ui.pptAbort;n++)await Zotero.Promise.delay(100);assert.isFalse(!!ui.pptAbort);assert.isNull(ui.pptLastError,ui.pptLastError);};
		if(!existing?.slides.length){ui.$('ppt-next').click();await wait();ui.$('ppt-next').click();await wait();assert.equal(ui.pptDraft.step,2);await capture('ppt-live-outline.png');ui.$('ppt-next').click();}else ui.$('ppt-stage').querySelector('button.primary').click();
		await wait();assert.isAtLeast(ui.pptDraft.slides.length,12);assert.isAtLeast(ui.pptDraft.slides.filter(s=>s.diagram?.nodes.length).length,1);
		await ui.pptPatch(d=>d.step=5);ui.pptSelected=ui.pptDraft.slides.findIndex(s=>s.diagram);ui.renderPPT();await Zotero.Promise.delay(1500);win.Zotero_Tabs.select(frame.parentElement.id);await capture('ppt-live-diagram.png');
		ui.$('ppt-preview-all').click();await wait();const d=ui.pptDraft,result=d.lastPreview;
		assert.lengthOf(result.previews,d.slides.length);
		await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'ppt-studio-live.json'),JSON.stringify({draft:d,artifact:result},null,2));
	});
	it('reuses real paper assets in the Reader and exports a source-linked visual deck', async function () {
		this.timeout(180000);
		let pdf = Zotero.Prefs.get('extensions.easysch.testPDF', true);
		let python = Zotero.Prefs.get('extensions.easysch.assetPython', true);
		if (!pdf || !python || !await IOUtils.exists(python)) this.skip();
		let paper = await createDataObject('item', { itemType: 'journalArticle', title: 'C-AMC: Towards Complete Automatic Modulation Classification' });
		let attachment = await Zotero.Attachments.importFromFile({ file: Zotero.File.pathToFile(pdf), parentItemID: paper.id });
		let first = await R.assets.index(attachment.id, () => {}), second = await R.assets.index(attachment.id, () => {});
		assert.isTrue(second.cacheHit); assert.isAbove(second.assets.length, 0);
		let reader = await Zotero.Reader.open(attachment.id); await reader._initPromise;
		await reader._internalReader._primaryView.initializedPromise;
		await reader.navigate({pageIndex:4});
		let doc = reader._iframeWindow.document;
		assert.notExists(doc.querySelector('.easysch-assets-open'));
		// Legacy asset renderer component coverage; no public Reader toolbar entry.
		R.openAssetPanel(reader);
		for (let n=0;n<200&&!doc.querySelector('#easysch-asset-panel[data-ready="true"]');n++) await Zotero.Promise.delay(100);
		assert.exists(doc.querySelector('.easysch-asset-select'));
		for (let n=0;n<100&&!doc.querySelector('.easysch-asset-list img')?.naturalWidth;n++) await Zotero.Promise.delay(100);
		assert.isAbove(doc.querySelector('.easysch-asset-list img').naturalWidth,0);
		await capture('research-asset-reader.png');
		const assets = second.assets.filter(a => a.kind === 'figure' && ['Fig. 1','Fig. 4','Fig. 5','Fig. 7'].includes(a.label)).slice(0,4);
		assert.isAtLeast(assets.length,3);
		await R.attachAssetHover(reader);
		let pdfWin=reader._internalReader._primaryView._iframeWindow;
		win.Zotero_Tabs.select(reader.tabID);win.focus();await reader.navigate({pageIndex:4});pdfWin.PDFViewerApplication.pdfViewer.currentScaleValue='page-fit';
		for(let n=0;n<50;n++){pdfWin.document.querySelector('.page[data-page-number="5"]')?.scrollIntoView({block:'start',behavior:'instant'});await Zotero.Promise.delay(100);const r=pdfWin.document.querySelector('.page[data-page-number="5"]').getBoundingClientRect();if(r.top>=-10&&r.top<50)break;}
		let page=pdfWin.document.querySelector('.page[data-page-number="5"]');
		let figure=assets.find(a=>a.label==='Fig. 1');
		let rect=page.getBoundingClientRect();
		Cu.unwaiveXrays(pdfWin).synthesizeMouseEvent('mousemove',rect.left+(figure.bbox[0]+10)/figure.pageWidth*rect.width,rect.top+(figure.bbox[1]+10)/figure.pageHeight*rect.height,{inputSource:1},{isDOMEventSynthesized:true});
		await Zotero.Promise.delay(100);
		assert.equal(pdfWin.document.querySelector('.easysch-figure-hover').style.display,'block',pdfWin.document.querySelector('.easysch-figure-hover').dataset.hitTest||JSON.stringify({rect:rect.toJSON(),rotation:pdfWin.PDFViewerApplication.pdfViewer.getPageView(4).viewport.rotation}));
		R.openAssetPanel(reader,figure.id);
		for(let n=0;n<200&&!doc.querySelector('#easysch-asset-panel[data-ready="true"]');n++) await Zotero.Promise.delay(50);
		let card=doc.querySelector(`[data-asset-id="${figure.id}"]`);
		[...card.querySelectorAll('button')].find(b=>b.textContent.includes('查看高清')).click();
		for(let n=0;n<100&&!card.querySelector('canvas')?.onpointerdown;n++) await Zotero.Promise.delay(50);
		let canvas=card.querySelector('canvas');canvas.scrollIntoView({block:'center'});rect=canvas.getBoundingClientRect();
		let captureStub=sinon.stub(canvas,'setPointerCapture');
		canvas.onpointerdown({clientX:rect.left+rect.width*.55,clientY:rect.top+rect.height*.4,pointerId:1});
		canvas.onpointermove({clientX:rect.left+rect.width*.97,clientY:rect.top+rect.height*.95});canvas.onpointerup();captureStub.restore();
		await capture('research-asset-crop.png');
		let manualCount=R.assets.active.get(attachment.id).assets.filter(a=>a.userModified).length;
		[...card.querySelectorAll('button')].find(b=>b.textContent==='保存当前子图').click();
		for(let n=0;n<200&&R.assets.active.get(attachment.id).assets.filter(a=>a.userModified).length<=manualCount;n++) await Zotero.Promise.delay(50);
		assert.isAbove(R.assets.active.get(attachment.id).assets.filter(a=>a.userModified).length,manualCount);
		for (let asset of assets) { await R.assets.select(asset); asset.needsReview=false; }
		let plan=R.assets.makePlan(assets), request={plan,assets,record:{sources:R.assets.evidence(assets)},datasets:[]};
		let result=await R.previewPresentation(request,()=>{});
		assert.lengthOf(result.previews,assets.length);
		let cached=await R.previewPresentation(request,()=>{}); assert.isTrue(cached.cacheHit);
		await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'real-paper-deck.json'),JSON.stringify(result,null,2));
		doc.getElementById('easysch-asset-panel')?.remove(); reader.close();
		await R.store.update(s=>{s.assetTray=assets;}); R.open();
		let frame=win.document.getElementById('easysch-workspace-frame'),ui;
		for(let n=0;n<200;n++){ui=frame.contentWindow.EasySchUI;if(ui?.meetingTaskUI)break;await Zotero.Promise.delay(50);}
		ui.meetingID=null;ui.show('meetings');ui.$('meeting-paper-assets').click();
		for(let n=0;n<200&&(!ui.meetingID||ui.busy);n++)await Zotero.Promise.delay(50);
		assert.lengthOf(R.meetings.all()[ui.meetingID].assets,assets.length);
		ui.$('meeting-render').click();
		for(let n=0;n<1200&&(!R.meetings.all()[ui.meetingID].lastArtifact||ui.busy);n++)await Zotero.Promise.delay(100);
		assert.lengthOf(R.meetings.all()[ui.meetingID].lastArtifact.previews,assets.length);
		for(let n=0;n<100&&!ui.$('meeting-plan').querySelector('.actual-slide-previews img')?.naturalWidth;n++)await Zotero.Promise.delay(50);
		let preview=ui.$('meeting-plan').querySelector('.actual-slide-previews img');assert.isAbove(preview.naturalWidth,0);preview.scrollIntoView({block:'center'});await Zotero.Promise.delay(150);
		win.Zotero_Tabs.select(frame.parentElement.id); await Zotero.Promise.delay(300); assert.equal(win.Zotero_Tabs.selectedType,'research');
		await capture('research-paper-ppt.png');
	});
	it('renders a PDF page, loads fonts, extracts text and saves a highlight', async function () {
		this.timeout(60000);
		let userPDF = Zotero.Prefs.get('extensions.easysch.testPDF', true);
		let attachment = userPDF ? await Zotero.Attachments.importFromFile({ file: Zotero.File.pathToFile(userPDF) }) : await importFileAttachment('test.pdf');
		let reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		let view = reader._internalReader._primaryView;
		await view.initializedPromise;
		let pdfWin = view._iframeWindow;
		let app = pdfWin.PDFViewerApplication;
		for (let n = 0; n < 200 && app.pdfViewer.getPageView(0)?.renderingState !== 3; n++) await Zotero.Promise.delay(100);
		let page = app.pdfViewer.getPageView(0);
		assert.equal(page.renderingState, 3, 'First PDF page must actually finish rendering');
		assert.isAbove(page.canvas.width, 0);
		let text = await Zotero.PDFWorker.getFullText(attachment.id, 1);
		assert.isAbove(text.text.length, 0);
		let font = await win.fetch('resource://zotero/reader/pdf/web/standard_fonts/LiberationSans-Regular.ttf');
		assert.isTrue(font.ok, 'Bundled PDF font must load without 404');
		assert.isAbove((await font.arrayBuffer()).byteLength, 1000);
		let manager = reader._internalReader._annotationManager;
		manager._skipAnnotationSavingDebounce = true;
		let saved = waitForItemEvent('add');
		manager.addAnnotation(Components.utils.cloneInto({ type: 'highlight', color: '#ffd400', sortIndex: '00000|000001|00000',
			position: { pageIndex: 0, rects: [[20, 20, 120, 35]] }, text: text.text.slice(0, 50) }, reader._iframeWindow));
		await saved;
		assert.isAbove(attachment.getAnnotations().length, 0);
		reader._internalReader._updateState(Components.utils.cloneInto({ primaryViewSelectionPopup: { rect: [180, 180, 400, 200], annotation: { text: text.text.slice(0, 80), position: { pageIndex: 0 } } } }, reader._iframeWindow));
		let readerDoc = reader._iframeWindow.document;
		for (let n = 0; n < 100 && !readerDoc.querySelector('.easysch-reader-action'); n++) await Zotero.Promise.delay(50);
		let popup = readerDoc.querySelector('.selection-popup');
		assert.exists(popup, `Real Reader selection popup: readOnly=${reader._internalReader._state.readOnly}, state=${!!reader._internalReader._state.primaryViewSelectionPopup}, frame=${readerDoc.URL}`);
		assert.sameMembers([...popup.querySelectorAll('button.easysch-reader-action')].map(button => button.textContent),
			['翻译选中文字', '解释选中文字', '提取专业术语', '生成概念示意图', '更多 · 工作台']);
		let explain = sinon.stub(R.ai, 'run').resolves({ result: { sections: [{ heading: '选段翻译', body: '前台测试回复，非真实模型输出', sources: ['P1-S'] }] }, sources: [{id:'P1-S',text:text.text.slice(0,80),label:'当前选段 · PDF 第 1 页',attachmentID:attachment.id,pageIndex:0}] });
		try {
			[...popup.querySelectorAll('button.easysch-reader-action')].find(b=>b.textContent==='翻译选中文字').click();
			for (let n = 0; n < 50 && !popup.textContent.includes('前台测试回复'); n++) await Zotero.Promise.delay(50);
			assert.include(popup.textContent, '前台测试回复');
			assert.include(readerDoc.getElementById('easysch-reader-result').textContent,'前台测试回复');
			assert.equal(explain.firstCall.args[0].mode,'translate');
			for(const details of readerDoc.querySelectorAll('#easysch-reader-result details'))details.open=true;
			assert.equal(win.Zotero_Tabs.selectedType, 'reader');
		} finally { explain.restore(); }
		await capture('research-pdf.png');
		let diagramSlide = { title: '选段示意图（测试）', nodes: [{ id: 'a', label: '收集' }, { id: 'b', label: '整理' }], edges: [{ from: 'a', to: 'b' }], sources: ['P1-S'] };
		let diagramStub = sinon.stub(R, 'planSelectionDiagram').resolves({ slide: diagramSlide, sources: [], svg: R.selectionDiagramSVG(diagramSlide) });
		try {
			[...popup.querySelectorAll('button.easysch-reader-action')].find(b=>b.textContent==='生成概念示意图').click();
			for (let n = 0; n < 100 && !popup.querySelector('svg[viewBox="0 0 1280 720"]'); n++) await Zotero.Promise.delay(50);
			assert.exists(popup.querySelector('svg[viewBox="0 0 1280 720"]'));
			await capture('research-inline-diagram.png');
		} finally { diagramStub.restore(); }
		const contextView=reader._internalReader._primaryView;
		contextView._selectionRanges=Components.utils.cloneInto([{collapsed:false,pageIndex:0,sortIndex:'00000|000001|00000',text:text.text.slice(0,80),position:{pageIndex:0,rects:[[20,20,120,35]]}}],reader._iframeWindow);
		let resolveTranslation;const translation=new Promise(resolve=>resolveTranslation=resolve),rightClick=sinon.stub(R.ai,'run').returns(translation);
		try{
			readerDoc.getElementById('easysch-reader-result')?.remove();
			win.Zotero_Tabs.select(reader.tabID);win.focus();reader._iframeWindow.focus();await Zotero.Promise.delay(400);
			contextView._selectionRanges=Components.utils.cloneInto([{collapsed:false,pageIndex:0,sortIndex:'00000|000001|00000',text:text.text.slice(0,80),position:{pageIndex:0,rects:[[20,20,120,35]]}}],reader._iframeWindow);
			contextView._onOpenViewContextMenu(Components.utils.cloneInto({x:300,y:200},reader._iframeWindow));
			let menuitem;for(let n=0;n<50;n++){menuitem=[...win.document.querySelectorAll('menuitem')].find(n=>n.getAttribute('label')==='翻译选中文字'&&n.parentNode.state==='open');if(menuitem)break;await Zotero.Promise.delay(50);}assert.exists(menuitem,'Native right-click translation entry');
			await capture('reader-translation-context.png');menuitem.doCommand();menuitem.parentNode.hidePopup();
			for(let n=0;n<20&&!readerDoc.getElementById('easysch-reader-result');n++)await Zotero.Promise.delay(25);
			assert.exists(readerDoc.getElementById('easysch-reader-result'),'Result panel opens before remote translation resolves');
			resolveTranslation({result:{sections:[{heading:'译文',body:'右键翻译测试完成（受控回复）',sources:['P1-S']}]},sources:[{id:'P1-S',label:'PDF 第 1 页',text:text.text.slice(0,80),attachmentID:attachment.id,pageIndex:0}]});
			for(let n=0;n<50&&!readerDoc.getElementById('easysch-reader-result').textContent.includes('右键翻译测试完成');n++)await Zotero.Promise.delay(50);
			assert.include(readerDoc.getElementById('easysch-reader-result').textContent,'右键翻译测试完成');await capture('reader-context-translation-result.png');
		}finally{rightClick.restore();contextView._selectionRanges=Components.utils.cloneInto([],reader._iframeWindow);}
		const selection={paperID:attachment.parentID||attachment.id,attachmentID:attachment.id,text:'Only this exact selection',pageIndex:0};
		const scoped=await R.library.sources([R.library.describe(item)],selection);assert.lengthOf(scoped.sources,1);assert.equal(scoped.sources[0].text,selection.text);
		reader._internalReader._updateState(Components.utils.cloneInto({primaryViewSelectionPopup:null},reader._iframeWindow));
		await Zotero.Promise.delay(100);assert.include(readerDoc.getElementById('easysch-reader-result').textContent,'右键翻译测试完成','Result survives selection dismissal');
		await capture('reader-persistent-result.png');
		const saveNote=readerDoc.getElementById('research-save-annotation-note');assert.exists(saveNote);const count=attachment.getAnnotations().length;saveNote.click();
		for(let n=0;n<100&&attachment.getAnnotations().length===count;n++)await Zotero.Promise.delay(50);
		assert.equal(attachment.getAnnotations().length,count+1,readerDoc.getElementById('easysch-reader-result').textContent);await Zotero.Promise.delay(200);await capture('workflow-reader-note.png');
		reader.close();
	});
	it('saves and undoes both a real annotation and child note from the Reader preview',async function(){
		this.timeout(60000);const pdf=Zotero.Prefs.get('extensions.easysch.testPDF',true);if(!pdf)this.skip();
		const attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(pdf),parentItemID:item.id}),reader=await Zotero.Reader.open(attachment.id);await reader._initPromise;await reader._internalReader._primaryView.initializedPromise;await Zotero.Promise.delay(500);
		const selection={paperID:item.id,attachmentID:attachment.id,text:'Controlled selection for save integration test',pageIndex:0,position:{pageIndex:0,rects:[[20,20,120,35]]},sortIndex:'00000|000001|00000'};
		const card=R.readerResultCard(reader,reader._iframeWindow.document,selection,'笔记保存测试');card.render({model:'test-fixture',result:{sections:[{heading:'AI 补充',body:'受控解释，用于验证保存和撤销',sources:[]}]},sources:[]});const button=reader._iframeWindow.document.getElementById('research-save-annotation-note');button.click();
		for(let n=0;n<150&&!button.textContent.includes('已保存');n++)await Zotero.Promise.delay(40);assert.include(button.textContent,'已保存',reader._iframeWindow.document.getElementById('easysch-reader-result').textContent);assert.lengthOf(attachment.getAnnotations(),1);const note=Zotero.Items.get(item.getNotes().at(-1));assert.include(note.getNote(),'&amp;annotation=');assert.include(note.getNote(),'test-fixture');await capture('workflow-reader-note.png');
		[...reader._iframeWindow.document.querySelectorAll('#easysch-reader-result button')].find(b=>b.textContent==='撤销这次保存').click();await Zotero.Promise.delay(400);assert.isTrue(note.deleted);await reader.close();
	});
	it('lists actual PDF references in the frontend when no DOI is available',async function(){
		this.timeout(60000);const pdf=Zotero.Prefs.get('extensions.easysch.testPDF',true);if(!pdf)this.skip();const paper=await createDataObject('item',{itemType:'journalArticle',title:'PDF reference extraction fixture'});await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(pdf),parentItemID:paper.id});
		const ui=await R.openWorkflow('search',{paperID:paper.id});for(let n=0;n<300&&!ui.$('search-results').querySelector('article');n++)await Zotero.Promise.delay(100);assert.exists(ui.$('search-results').querySelector('article'),ui.$('search-results').textContent);assert.include(ui.$('search-results').textContent,'PDF 参考文献');assert.include(ui.$('search-results').textContent,'Frontiers of wireless');assert.notInclude(ui.$('search-results').querySelector('article h3').textContent,'[2]');await capture('workflow-pdf-references.png');const cached=await R.discover(R.library.describe(paper));assert.isTrue(cached.cacheHit);
	});
	it('renders colored native tags and preserves minute precision', async function () {
		item.addTag('已读'); item.addTag('调制识别'); await item.saveTx();
		await win.ZoteroPane.selectItem(item.id);
		let tree = win.ZoteroPane.itemsView;
		let cell = R.renderColumn(tree, tree.getRowIndexByID(item.id), '', { dataKey: 'research_tags', className: '' }, win.document);
		assert.include(cell.textContent, '调制识别');
		assert.equal(cell.children.length, 2);
		assert.equal(R.formatTime(new Date(2026, 8, 5, 9, 7)), '2026-09-05 09:07');
		assert.equal(R.core.task('meeting', '2026-09-06T14:35').due, '2026-09-06T14:35');
		assert.throws(() => R.core.task('meeting', '2026-02-30T14:35'), /日期/);
		win.ZoteroPane.tagSelector.handleTagContext({ name: '调制识别' }, { preventDefault() {}, screenX: 140, screenY: 600 });
		await capture('research-tag-menu.png');
		win.document.getElementById('create-tag-study-set').doCommand();
		for (let n = 0; n < 50 && !win.ZoteroPane.collectionsView.selectedTreeRow.id.startsWith('S'); n++) await Zotero.Promise.delay(100);
		win.document.getElementById('tag-menu').hidePopup();
		let studySet = Zotero.Searches.get(Number(win.ZoteroPane.collectionsView.selectedTreeRow.id.slice(1)));
		assert.exists(studySet);
		assert.equal(studySet.name, '研究集 · 调制识别');
		assert.equal(win.ZoteroPane.collectionsView.selectedTreeRow.id, `S${studySet.id}`);
		assert.include(await studySet.search(), item.id);
		item.removeTag('调制识别'); await item.saveTx();
		assert.notInclude(await studySet.search(), item.id);
		item.addTag('调制识别'); await item.saveTx();
		assert.include(await studySet.search(), item.id);
		await capture('research-study-set.png');
	});
	it('checks explicitly configured live services and searches both academic databases', async function () {
		this.timeout(240000);
		if (!Zotero.Prefs.get('extensions.easysch.liveProviderTest', true)) this.skip();
		let report = { at: new Date().toISOString(), providers: await R.testProviders(), search: {} };
		let importedPaper;
		for (let source of ['pubmed', 'arxiv']) {
			try {
				let records = await R.searchAcademic(source === 'pubmed' ? 'cancer immunotherapy' : 'automatic modulation classification', source);
				assert.isAbove(records.length, 0);
				let saved = await R.importAcademic(records[0]);
				assert.isAbove(saved.id, 0);
				importedPaper ||= Zotero.Items.get(saved.id);
				report.search[source] = { count: records.length, imported: true, title: records[0].title };
			}
			catch (e) { report.search[source] = { error: e.message }; }
		}
		if (importedPaper) {
			try {
				let record = await R.ai.run({ mode: 'ask', papers: [R.library.describe(importedPaper)], prompt: '只用一个短章节概述摘要中的研究问题，引用证据 ID；不要推测未提供的全文。' });
				assert.isTrue(record.result.sections.some(s => s.quotes?.length));
				assert.equal(record.promptPolicy.skill, 'citation_check');
				report.analysis = { model: record.model, sections: record.result.sections.length, evidence: record.sources.length, saved: true };
			}
			catch (e) { report.analysis = { error: e.message }; }
		}
		await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir, 'provider-verification.json'), JSON.stringify(report, null, 2));
		assert.isFalse(Object.values(report.search).some(v => v.error), 'See provider-verification.json');
		assert.isTrue(Object.values(report.providers).every(v => v.includes('成功')), 'All supplied service credentials must work');
		assert.isTrue(report.analysis?.saved, 'Structured AI analysis must persist real evidence');
	});
	it('stores year-specific journal metrics independently and reads native columns', async function () {
		await R.saveMetrics([
			{ issn: '0028-0836', metric_year: 2020, source: 'test-fixture', impact_factor: 9 },
			{ issn: '0028-0836', metric_year: 2021, source: 'test-fixture', impact_factor: 12, cas_large_category: '测试分区' }
		]);
		assert.equal(R.field(item, 'research_impact_factor'), 12);
		assert.equal(R.field(item, 'research_publicationIF'), 9);
		assert.equal(item.getField('extra'), '');
		assert.throws(() => R.validateMetric({ issn: '0028-0837', metric_year: 2020, source: 'test' }), /校验/);
		await R.saveState(item, { reading: '精读' });
		assert.equal(R.field(item, 'research_reading'), '精读');
		let saved = await R.db.valueQueryAsync('SELECT state FROM research_items WHERE item_key=?', [R.key(item)]);
		assert.equal(JSON.parse(saved).reading, '精读');
	});
	it('extracts DOCX structure and indexes it in the native search engine', async function () {
		const { extractDOCX, parsePart } = ChromeUtils.importESModule(R.rootURI + 'docx.mjs');
		let file = getTestDataDirectory(); file.append('research-fixture.docx');
		let data = await extractDOCX(file.path);
		assert.include(data.text, 'quartzbiomarker');
		assert.notInclude(data.text, 'deletedfinding');
		assert.equal(data.tables.length, 1);
		assert.equal(data.citations.length, 1);
		assert.isTrue(data.paragraphs.some(p => p.style === 'Heading1'));
		assert.isTrue(data.paragraphs.some(p => p.part === 'word/comments.xml'));
		assert.throws(() => parsePart('<!DOCTYPE a><a/>', 'test'), /DTD/);
		let attachment = await Zotero.Attachments.importFromFile({ file, parentItemID: item.id,
			contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
		await Zotero.Fulltext.indexItems([attachment.id]);
		let search = new Zotero.Search(); search.libraryID = item.libraryID;
		search.addCondition('fulltextContent', 'contains', 'quartzbiomarker');
		assert.include(await search.search(), attachment.id);
		let standaloneSources = await R.library.sources([R.library.describe(attachment)]);
		assert.isTrue(standaloneSources.sources.some(s => s.docx));
		let sources = await R.library.sources([R.library.describe(item)]);
		assert.isTrue(sources.sources.some(s => s.docx && s.text.includes('quartzbiomarker')));
		await win.ZoteroPane.viewAttachment(attachment.id);
		let frame = win.document.getElementById(`easysch-docx-frame-${attachment.id}`);
		for (let n = 0; n < 100 && !frame.contentWindow.docxReady; n++) await Zotero.Promise.delay(100);
		assert.equal(win.Zotero_Tabs.selectedType, 'researchDocx');
		assert.include(frame.contentDocument.getElementById('document').textContent, 'quartzbiomarker');
		assert.exists(frame.contentDocument.querySelector('table'));
		assert.equal(frame.contentDocument.getElementById('document').textContent.split('table evidence').length - 1, 1);
		let selectedSources = await R.library.sources([R.library.describe(item)], { text: 'table evidence', attachmentID: attachment.id, paperID: item.id });
		assert.isTrue(selectedSources.sources.find(s => s.id === 'P1-S').docx);
		let queryInput = frame.contentDocument.getElementById('search'); queryInput.value = 'table evidence'; queryInput.dispatchEvent(new frame.contentWindow.Event('input'));
		assert.isFalse(frame.contentDocument.querySelector('table').hidden);
		queryInput.value = ''; queryInput.dispatchEvent(new frame.contentWindow.Event('input'));
		await capture('research-docx.png');
	});
	it('renders native columns, sidebar, and a workspace tab without an installed XPI', async function () {
		await win.ZoteroPane.selectItem(item.id);
		await R.applyView(win, ['title', 'year', 'research_tags', 'research_impact_factor', 'research_journalTags', 'research_cas_large_category', 'research_reading', 'dateAdded']);
		assert.isTrue(win.ZoteroPane.itemsView.getColumns().some(c => c.dataKey === 'research_impact_factor' && !c.hidden));
		assert.isString(R.sidebarID);
		let row = win.ZoteroPane.itemsView._getRowData(win.ZoteroPane.itemsView.getRowIndexByID(item.id));
		assert.equal(row.research_impact_factor, 12);
		assert.match(row.dateAdded, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
		await win.ZoteroPane.itemPane._itemDetails.scrollToPane(R.sidebarID, 'instant');
		await Zotero.Promise.delay(150);
		let pane = win.ZoteroPane.itemPane._itemDetails.getPane(R.sidebarID);
		assert.include(pane.textContent, '结构化速读');
		assert.include(pane.textContent, 'test-fixture');
		assert.equal(pane.querySelector('select').value, '精读');
		await capture('research-library.png');
		R.open({ paperID: item.id });
		let frame = win.document.getElementById('easysch-workspace-frame');
		for (let n = 0; n < 100 && !frame.contentWindow.EasySchUI?.ready; n++) await Zotero.Promise.delay(100);
		let ui = frame.contentWindow.EasySchUI;
		assert.isTrue(ui.ready, frame.contentDocument.getElementById('status')?.textContent);
		assert.equal(win.Zotero_Tabs.selectedType, 'research');
		assert.exists(frame.contentDocument.getElementById('meeting-save'));
		assert.equal(frame.contentDocument.getElementById('paper-skill').options.length, 12);
		assert.equal(frame.contentDocument.getElementById('paper-skill').value, 'close_read');
		assert.exists(frame.contentDocument.getElementById('save-paper-skill'));
		ui.show('meetings');
		assert.isFalse(frame.contentDocument.getElementById('view-meetings').hidden);
		await capture('research-workspace.png');
	});
	async function capture(name) {
		let image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		let canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
		canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0);
		let blob = await new Promise(resolve => canvas.toBlob(resolve)); image.close();
		await IOUtils.write(PathUtils.join(Zotero.DataDirectory.dir, name), new Uint8Array(await blob.arrayBuffer()));
	}
	it('persists group meeting projects, turns and follow-up tasks', async function () {
		let id = await R.meetings.save({ title: 'Test meeting', paperIDs: [item.id], minutes: 15 });
		await R.meetings.task(id, 'Verify sample size');
		assert.equal(R.meetings.all()[id].tasks[0].text, 'Verify sample size');
		let stub = sinon.stub(R.ai, 'run').resolves({ result: { sections: [], questions: [], keywords: [] } });
		try {
			await R.meetings.ask(id, '', () => {});
			await R.meetings.ask(id, 'My answer with evidence', () => {});
			assert.equal(R.meetings.all()[id].turns.length, 2);
			assert.include(stub.secondCall.args[0].prompt, 'My answer with evidence');
			assert.match((await getPromiseError(R.meetings.ask(id, '', () => {}))).message, /回答/);
		} finally { stub.restore(); }
	});
	it('runs the DSH artifact engine through native pipes without opening another app', async function () {
		this.timeout(120000);
		let command = Zotero.Prefs.get('extensions.easysch.engineNode', true);
		let entry = Zotero.Prefs.get('extensions.easysch.engineEntry', true);
		if (!command || !entry || !await IOUtils.exists(command) || !await IOUtils.exists(entry)) {
			this.skip();
		}
		let prompt = await R.runArtifactEngine({ operation: 'prompt' });
		assert.equal(prompt.tools.length, 2);
		let record = { sources: [{ id: 'E1', text: 'Input is encoded and classified.', label: 'Fixture', uri: 'https://example.org' }], result: { sections: [{ heading: 'Method', body: 'Input is encoded and classified.', sources: ['E1'] }] } };
		let result = await R.runArtifactEngine({ operation: 'export', title: 'Native DSH fixture', record, directory: Zotero.DataDirectory.dir });
		assert.isTrue(await IOUtils.exists(result.path));
		assert.include(['pending', 'human_review_required'], result.visualReview);
		let id = await R.meetings.save({ title: '前台预览验收（模拟数据）', paperIDs: [item.id], minutes: 10 });
		let plan = { title: '前台预览验收', slides: [
			{ kind: 'text', title: '研究问题', bullets: ['测试夹具，非真实科研结论。'], sources: ['E1'] },
			{ kind: 'diagram', title: '方法流程', nodes: [{ id: 'a', label: '输入' }, { id: 'b', label: '编码' }, { id: 'c', label: '分类' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], sources: ['E1'] },
			{ kind: 'chart', title: '图表功能测试（模拟数据）', datasetID: 'fixture', chartType: 'bar', sources: ['E1'] }
		] };
		await R.store.update(s => { Object.assign(s.meetings[id], { outline: record, slidePlan: plan, datasets: [{ id: 'fixture', provenance: '软件测试模拟数据，非实验结果', labels: ['A', 'B'], series: [{ name: '测试', values: [2, 3] }] }] }); });
		R.open();
		let ui = win.document.getElementById('easysch-workspace-frame').contentWindow.EasySchUI;
		ui.meetingID = id; ui.loadMeeting(); ui.show('meetings');
		ui.$('meeting-render').click();
		for (let n = 0; n < 1100 && ui.busy; n++) await Zotero.Promise.delay(100);
		let artifact = R.meetings.all()[id].lastArtifact;
		assert.exists(artifact, ui.$('status').textContent);
		if (Zotero.Prefs.get('extensions.easysch.soffice', true)) {
			assert.equal(artifact.previews?.length, 3, JSON.stringify(artifact.warnings));
			for (let n = 0; n < 100 && ui.$('meeting-plan').querySelectorAll('.actual-slide-previews img').length < 3; n++) await Zotero.Promise.delay(100);
			assert.lengthOf(ui.$('meeting-plan').querySelectorAll('.actual-slide-previews img'), 3);
			for (let [index, image] of [...ui.$('meeting-plan').querySelectorAll('.actual-slide-previews img')].entries()) {
				for (let n = 0; n < 50 && !image.naturalWidth; n++) await Zotero.Promise.delay(50);
				assert.isAbove(image.naturalWidth, 0);
				image.scrollIntoView({ block: 'center' }); await Zotero.Promise.delay(150);
				await capture(`research-ppt-preview-${index + 1}.png`);
			}
		}
		if (Zotero.Prefs.get('extensions.easysch.liveProviderTest', true)) {
			let id = await R.meetings.save({ title: 'Pipeline test', paperIDs: [item.id], minutes: 5 });
			await R.store.update(s => { s.meetings[id].outline = record; });
			let plan = await R.planPresentation(R.meetings.all()[id], () => {});
			assert.isAbove(plan.slides.length, 0);
			let output = await R.runArtifactEngine({ operation: 'export', title: 'Live plan fixture', record, plan, directory: Zotero.DataDirectory.dir });
			assert.isTrue(await IOUtils.exists(output.path));
		}
	});
	it('exports DOCX equations and an editable group meeting PPTX with Pandoc', async function () {
		if (!R.settings().pandoc || !await IOUtils.exists(R.settings().pandoc)) this.skip();
		let folder = Zotero.DataDirectory.dir;
		let papers = [R.library.describe(item)];
		for (let format of ['docx', 'pptx', 'latex']) {
			let result = await R.exportDocument({ folder, title: 'Native research export test',
				markdown: `## Research question\n\nEvidence [@${papers[0].citeKey}].\n\n## Model\n\n$E=mc^2$`, papers, format });
			assert.isTrue(await IOUtils.exists(result.path));
			if (format === 'docx') {
				let zip = Components.classes['@mozilla.org/libjar/zip-reader;1'].createInstance(Components.interfaces.nsIZipReader);
				zip.open(Zotero.File.pathToFile(result.path));
				try {
					let stream = zip.getInputStream('word/document.xml'), xml;
					try { xml = await Zotero.File.getContentsAsync(stream); } finally { stream.close(); }
					assert.include(xml, 'm:oMath');
				} finally { zip.close(); }
			}
		}
	});
});
