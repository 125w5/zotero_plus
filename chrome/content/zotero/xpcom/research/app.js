(function (E) {
	E.settings = () => ({ ...E.core.defaults, ...E.store.get().settings });
	E.getItem = id => Zotero.Items.getAsync(id);
	E.getCachedItem = id => Zotero.Items.get(id);
	E.reveal = path => Zotero.File.reveal(path);
	E.writeBib = async (folder, text) => {
		let path = PathUtils.join(folder, `references-${Date.now()}.bib`);
		await IOUtils.writeUTF8(path, text); return path;
	};
	E.compatibility = async () => {
		let { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
		let plugins = (await AddonManager.getAllAddons()).filter(p => p.isActive && /better.*(?:notes|bibtex)|pdf.*translate/i.test(p.name));
		return `Zotero ${Zotero.version}；已检测：${plugins.map(p => p.name + ' ' + p.version).join('、') || '未检测到可选插件'}。原生笔记、阅读器与 Word 插件继续使用。`;
	};
	E.windows = new Set();
	E.panels = new Set();
	E.start = async function () {
		await E.initDistribution();
		await E.importProviderSetup();
		// Storage is initialized before library windows open.
		let pandoc = Zotero.Prefs.get('extensions.easysch.pandoc', true);
		if (pandoc && !E.settings().pandoc && await IOUtils.exists(pandoc)) {
			await E.store.update(s => { s.settings.pandoc = pandoc; });
		}
		// Research services survive closing/reopening the main window. Timers must
		// belong to the application, and each AI request uses the current window.
		const timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
		E.setTimeout = timers.setTimeout;
		E.clearTimeout = timers.clearTimeout;
		await E.preparePassageSearch();
		E.manuscripts.startArticleIndex();
		E.ai = E.createAI({ fetch: (...args) => Zotero.getMainWindow().fetch(...args), controller: () => new (Zotero.getMainWindow().AbortController)(),
			settings: E.settings, credential: endpoint => E.credentials.get(endpoint), store: E.store,
			collect: E.library.sources });
		for (let win of Zotero.getMainWindows()) E.addWindow(win);
  E.readerHandler=({reader,doc,params,append})=>{
   if(!params.annotation?.text)return;
   const a=params.annotation,attachment=Zotero.Items.get(reader.itemID),selection={paperID:attachment.parentID||attachment.id,attachmentID:attachment.id,text:a.text,pageIndex:a.position?.pageIndex,position:JSON.parse(JSON.stringify(a.position||{})),sortIndex:a.sortIndex};
   E.renderQuickTranslation({reader,doc,selection,append});
  };
		Zotero.Reader.registerEventListener('renderTextSelectionPopup', E.readerHandler, E.id);
		E.installReaderContext();
		E.installReaderTools();
		E.installReaderTranslation();
		// Research tools live in the home workbench; the native Reader keeps notes and selection translation.
		E.registerSidebar();
		E.registerReaderPanes();
		Zotero.addShutdownListener(() => E.stop());
	};
	E.addWindow = function (win) {
		if (E.windows.has(win)) return;
		win.MozXULElement.insertFTLIfNeeded('easysch.ftl');
		let entry = win.document.createXULElement('menuitem');
		entry.id = 'easysch-open';
		entry.setAttribute('label', 'EasySch 科研工作台');
		entry.addEventListener('command', () => E.open());
		win.document.getElementById('menu_ToolsPopup')?.append(entry);
		let docxEntry = win.document.createXULElement('menuitem');
		docxEntry.id = 'easysch-open-docx';
		docxEntry.setAttribute('data-l10n-id', 'easysch-open-docx');
		docxEntry.hidden = true;
		docxEntry.addEventListener('command', () => {
			let item = win.ZoteroPane.getSelectedItems()[0];
			if (item) E.openDOCX(item.id).catch(error => Services.prompt.alert(win, 'EasySch', error.message));
		});
		let itemMenu = win.document.getElementById('zotero-itemmenu');
		let updateDocxEntry = () => {
			let items = win.ZoteroPane.getSelectedItems();
			docxEntry.hidden = items.length !== 1
				|| items[0].attachmentContentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		};
		docxEntry._easyschPopupHandler = updateDocxEntry;
		itemMenu?.addEventListener('popupshowing', updateDocxEntry);
		itemMenu?.append(docxEntry);
		E.addViewMenu(win);
		E.installNavigation(win);
		E.studio.addEntries(win);
		win.document.getElementById('easysch-ppt-toolbar')?.remove();
		E.installHomeMenu(win);
		E.manuscripts.syncLibrary().catch(e=>Zotero.logError(e));
		if (!Zotero.Prefs.get('extensions.easysch.columnLayoutV2', true)) {
			E.applyView(win, ['title', 'firstCreator', 'year', 'research_tags', 'research_impact_factor', 'research_journalTags', 'dateAdded']);
			Zotero.Prefs.set('extensions.easysch.columnLayoutV2', true, true);
		}
		win.addEventListener('unload', () => E.removeWindow(win), { once: true });
		E.windows.add(win);
	};
	E.removeWindow = function (win) {
		win._researchCalendar?.dispose();
		const pane=win.document.getElementById('zotero-items-pane');
		if(pane?._researchContext){pane.removeEventListener('contextmenu',pane._researchContext,true);delete pane._researchContext;}
		win.document.getElementById('research-home-menu')?.remove();
		win.document.getElementById('research-item-actions')?.remove();
		win.document.getElementById('easysch-ppt-toolbar')?.remove();
		win.document.getElementById('easysch-ppt-context')?.remove();
		win.document.getElementById('easysch-open')?.remove();
		win.document.getElementById('easysch-views')?.remove();
		let docxEntry = win.document.getElementById('easysch-open-docx');
		if (docxEntry?._easyschPopupHandler) {
			win.document.getElementById('zotero-itemmenu')?.removeEventListener('popupshowing', docxEntry._easyschPopupHandler);
		}
		docxEntry?.remove();
		win.document.querySelector('[href="easysch.ftl"]')?.remove();
		E.windows.delete(win);
	};
	E.open = function (selection) {
		let main = Zotero.getMainWindow();
		if (!selection) { const reader=Zotero.Reader.getByTabID(main.Zotero_Tabs.selectedID);const attachment=reader&&Zotero.Items.get(reader.itemID);if(attachment)selection={paperID:attachment.parentID||attachment.id,attachmentID:attachment.id,text:''}; }
		let existing = main.document.getElementById('easysch-workspace-frame');
		if (existing) {
			main.Zotero_Tabs.select(existing.parentElement.id);
			if (selection) existing.contentWindow.EasySchUI?.setSelection(selection);
			return existing.contentWindow;
		}
		let frame = main.document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe');
		frame.id = 'easysch-workspace-frame';
		frame.setAttribute('style', 'width:100%;height:100%;border:0;flex:1');
		frame.researchSelection = selection;
		let { container } = main.Zotero_Tabs.add({ type: 'research', title: 'EasySch 科研工作台', data: {}, select: true });
		container.style.display = 'flex';
		container.append(frame);
		frame.src = 'chrome://zotero/content/research/workspace.html';
		return frame.contentWindow;
	};
	E.openDOCX = async function (attachmentID) {
		let main = Zotero.getMainWindow();
		let item = await Zotero.Items.getAsync(attachmentID);
		if (!item?.isAttachment()
			|| item.attachmentContentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
			throw new Error('所选条目不是 DOCX 附件');
		}
		let frameID = `easysch-docx-frame-${attachmentID}`;
		let existing = main.document.getElementById(frameID);
		if (existing) {
			main.Zotero_Tabs.select(existing.parentElement.id);
			return existing.contentWindow;
		}
		let frame = main.document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe');
		frame.id = frameID;
		frame.setAttribute('style', 'width:100%;height:100%;border:0;flex:1');
		frame.docxItemID = attachmentID;
		let title = item.attachmentFilename || item.getField('title') || 'DOCX';
		let { container } = main.Zotero_Tabs.add({ type: 'researchDocx', title, data: { itemID: attachmentID }, select: true });
		container.style.display = 'flex';
		container.append(frame);
		frame.src = 'chrome://zotero/content/research/docx-viewer.html';
		return frame.contentWindow;
	};
	E.stop = async function () {
		E.ai?.cancel();
		if (E.sidebarID) Zotero.ItemPaneManager.unregisterSection(E.sidebarID);
		if (E.overviewID) Zotero.ItemPaneManager.unregisterSection(E.overviewID);
		for (const id of E.readerPaneIDs || []) Zotero.ItemPaneManager.unregisterSection(id);
		if (E.noteLinkObserver) Zotero.Notifier.unregisterObserver(E.noteLinkObserver);
		if (E.readerToolHandlers) {
			Zotero.Reader.unregisterEventListener('renderToolbar', E.readerToolHandlers.toolbar);
			Zotero.Reader.unregisterEventListener('createAnnotationContextMenu', E.readerToolHandlers.context);
		}
		Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', E.readerHandler);
		if(E.readerContextHandler)Zotero.Reader.unregisterEventListener('createViewContextMenu',E.readerContextHandler);
		if(E.readerTranslationToolbar)Zotero.Reader.unregisterEventListener('renderToolbar',E.readerTranslationToolbar);
		if(E.assetToolbar)Zotero.Reader.unregisterEventListener('renderToolbar', E.assetToolbar);
		for (let win of [...E.windows]) E.removeWindow(win);
		for (let win of [...E.panels]) win.close();
		E.panels.clear();
		await E.store?.flush();
	};
})(EasySch);
