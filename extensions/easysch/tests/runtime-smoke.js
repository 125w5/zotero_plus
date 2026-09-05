(async function (E) {
	let checks = [], win;
	let record = async (name, fn) => {
		try { let detail = await fn(); checks.push({ name, passed: true, detail }); }
		catch (error) { checks.push({ name, passed: false, error: String(error), stack: error.stack }); }
		await IOUtils.writeUTF8(PathUtils.join(E.dataDir, 'smoke-results.json'), JSON.stringify(checks, null, 2));
	};
	if (!Zotero.DataDirectory.dir.includes('easysch-test-data')) return;
	await Zotero.uiReadyPromise;
	let paper, pdf, papers;
	await record('Create isolated fixture with real Zotero items', async () => {
		paper = new Zotero.Item('journalArticle'); paper.libraryID = Zotero.Libraries.userLibraryID;
		paper.setField('title', 'EasySch Integration Test — Evidence and Scientific Writing');
		paper.setField('publicationTitle', 'Integration Test Journal'); paper.setField('date', '2026');
		paper.setField('abstractNote', 'A synthetic fixture to validate evidence links and journal export. Not a real publication.');
		paper.setCreators([{ firstName: 'Test', lastName: 'Researcher', creatorType: 'author' }]);
		paper.addTag('easysch-test'); await paper.saveTx();
		papers = [E.library.describe(paper)];
		let root = Zotero.Prefs.get('extensions.easysch.testRepo', true);
		pdf = await Zotero.Attachments.importFromFile({ file: PathUtils.join(root, 'test', 'tests', 'data', 'wonderland_short.pdf'), parentItemID: paper.id });
		return { paperID: paper.id, pdfID: pdf.id };
	});
	await record('Extract real PDF and preserve source links', async () => {
		let result = await E.library.sources(papers);
		if (!result.sources.some(s => s.attachmentID === pdf.id && s.text.length > 100)) throw Error('No PDF text');
		return { sources: result.sources.length, warnings: result.warnings };
	});
	await record('Native note integration escapes model HTML', async () => {
		let source = { id: 'P1-M', label: 'Metadata', uri: E.library.uri(paper) };
		let noteID = await E.library.note(papers[0], { sources: [source], result: { sections: [{ heading: 'Test', body: '<script>alert(1)</script>', sources: ['P1-M'] }] } });
		let note = await Zotero.Items.getAsync(noteID);
		if (note.getNote().includes('<script>')) throw Error('Unescaped HTML');
		return noteID;
	});
	await record('Credential storage is isolated by endpoint', async () => {
		let endpoint = 'http://localhost:11434/v1';
		await E.credentials.set(endpoint, 'TEST-ONLY-DO-NOT-USE');
		if (await E.credentials.get(endpoint) !== 'TEST-ONLY-DO-NOT-USE') throw Error('Credential roundtrip failed');
		if (await E.credentials.get('http://localhost:11435/v1')) throw Error('Credential crossed endpoint');
		await E.credentials.set(endpoint, '');
	});
	await record('Workspace loads native DOM and selection', async () => {
		win = E.open({ paperID: paper.id, attachmentID: pdf.id, text: 'An actual reader selection fixture.', pageIndex: 0 });
		for (let n = 0; n < 100 && !win.EasySchUI?.ready; n++) await Zotero.Promise.delay(100);
		if (!win.EasySchUI?.ready) throw Error('Workspace did not initialize: ' + win.document.documentElement.outerHTML.slice(0, 400));
		if (!win.document.getElementById('paper-list').textContent.includes('Integration Test')) throw Error('Missing paper');
		return { width: win.innerWidth, height: win.innerHeight };
	});
	await record('Draft, tasks and view switching', async () => {
		let ui = win.EasySchUI;
		ui.$('draft').value = '# Introduction\n\nA test citation [@' + papers[0].citeKey + '].\n\n## Methods\n\n$$E = mc^2$$';
		ui.$('draft-title').value = 'EasySch Journal Export Test'; ui.dirty = true; await ui.saveDraft(false);
		await ui.updateProject(p => { p.tasks = [E.core.task('Review the experimental baseline', '2026-09-10')]; });
		for (let tab of ['writing', 'schedule', 'settings', 'graph', 'research']) ui.show(tab);
		if (ui.project().draft !== ui.$('draft').value || ui.project().tasks.length !== 1) throw Error('Persistence failed');
	});
	await record('Markdown math preview sanitizes untrusted model HTML', async () => {
		let ui = win.EasySchUI, target = ui.$('draft-preview');
		ui.renderMarkdown(target, '# Scientific equation\n\n$$E = mc^2$$\n\n<img src="https://invalid.example/pixel" onerror="window.compromised=true"/><script>window.compromised=true</script>');
		if (target.querySelector('img,script,iframe') || win.compromised) throw Error('Unsafe preview content');
		if (!target.querySelector('.katex')) throw Error('Math was not rendered');
		ui.show('writing'); target.hidden = false;
		let formula = target.querySelector('.katex-html');
		if (formula.namespaceURI !== 'http://www.w3.org/1999/xhtml' || formula.getBoundingClientRect().width < 10) throw Error('Math is present but invisible');
	});
	await record('Pandoc real DOCX LaTeX PPTX conversion', async () => {
		let repo = Zotero.Prefs.get('extensions.easysch.testRepo', true);
		let tools = PathUtils.join(PathUtils.parent(repo), '.tools');
		await E.store.update(s => { s.settings.pandoc = PathUtils.join(tools, 'pandoc', 'pandoc-3.11', 'pandoc.exe'); });
		let outputs = [];
		for (let format of ['docx', 'latex', 'pptx']) outputs.push(await E.exportDocument({ folder: E.dataDir,
			title: 'EasySch Journal Export Test', markdown: win.EasySchUI.$('draft').value, papers, format }));
		return outputs;
	});
	await record('Workspace visual capture', async () => {
		let ui = win.EasySchUI; ui.show('writing'); ui.$('draft-preview').hidden = false;
		ui.renderMarkdown(ui.$('draft-preview'), ui.$('draft').value);
		ui.$('draft').style.minHeight = '180px'; ui.$('draft').style.height = '180px';
		await Zotero.Promise.delay(400);
		await win.document.fonts.ready;
		let bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(new win.DOMRect(0, 0, win.innerWidth, win.innerHeight), 1, 'white');
		let canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
		canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
		let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
		await IOUtils.write(PathUtils.join(E.dataDir, 'workspace.png'), new Uint8Array(await blob.arrayBuffer()));
	});
	await record('Main window hook unload and reload', async () => {
		let main = Zotero.getMainWindow(); E.removeWindow(main);
		if (main.document.getElementById('easysch-open')) throw Error('Menu leaked');
		E.addWindow(main);
		if (!main.document.getElementById('easysch-open')) throw Error('Menu not restored');
	});
	await IOUtils.writeUTF8(PathUtils.join(E.dataDir, 'smoke-complete.json'), JSON.stringify({ passed: checks.every(c => c.passed), checks }, null, 2));
	// Release mapped XPI files so the next isolated test can install a new build.
	if (win && !win.closed) win.close();
	Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
})(EasySch).catch(error => Zotero.logError(error));
