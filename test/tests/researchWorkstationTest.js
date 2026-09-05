describe('Built-in research workstation', function () {
	let R = Zotero.Research, win, item;
	before(async function () {
		win = await loadZoteroPane();
		win.resizeTo(1500, 920);
		await R.attachWindow(win);
		item = await createDataObject('item', { itemType: 'journalArticle', title: 'Research integration fixture', ISSN: '0028-0836', date: '2020' });
		item.setField('ISSN', '0028-0836'); item.setField('date', '2020'); await item.saveTx();
	});
	after(function () { win?.close(); });
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
		let popup = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
		R.readerHandler({ reader: { itemID: attachment.id }, doc: win.document,
			params: { annotation: { text: text.text.slice(0, 80), position: { pageIndex: 0 } } }, append: node => popup.append(node) });
		assert.sameMembers([...popup.querySelectorAll('button.easysch-reader-action')].map(button => button.textContent),
			['翻译', 'AI 解释', '专业术语', '生成示意图', '更多 · 工作台']);
		await capture('research-pdf.png');
		reader.close();
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
		win.ZoteroPane.tagSelector.contextTag = { name: '调制识别' };
		await win.ZoteroPane.tagSelector.createStudySet();
		let studySet = (await Zotero.Searches.getAll(item.libraryID)).find(search => search.name === '研究集 · 调制识别');
		assert.exists(studySet);
		assert.equal(win.ZoteroPane.collectionsView.selectedTreeRow.id, `S${studySet.id}`);
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
		await R.openDOCX(attachment.id);
		let frame = win.document.getElementById(`easysch-docx-frame-${attachment.id}`);
		for (let n = 0; n < 100 && frame.contentDocument.getElementById('title')?.textContent === '正在读取…'; n++) await Zotero.Promise.delay(100);
		assert.equal(win.Zotero_Tabs.selectedType, 'research-docx');
		assert.include(frame.contentDocument.getElementById('document').textContent, 'quartzbiomarker');
		assert.exists(frame.contentDocument.querySelector('table'));
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
		assert.equal(result.visualReview, 'pending');
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
