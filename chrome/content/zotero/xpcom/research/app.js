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
		await E.importProviderSetup();
		// Storage is initialized before library windows open.
		let pandoc = Zotero.Prefs.get('extensions.easysch.pandoc', true);
		if (pandoc && !E.settings().pandoc && await IOUtils.exists(pandoc)) {
			await E.store.update(s => { s.settings.pandoc = pandoc; });
		}
		let main = Zotero.getMainWindow();
		E.setTimeout = main.setTimeout.bind(main);
		E.clearTimeout = main.clearTimeout.bind(main);
		E.ai = E.createAI({ fetch: main.fetch.bind(main), controller: () => new main.AbortController(),
			settings: E.settings, credential: endpoint => E.credentials.get(endpoint), store: E.store,
			collect: E.library.sources });
		for (let win of Zotero.getMainWindows()) E.addWindow(win);
		E.readerHandler = ({ reader, doc, params, append }) => {
			if (!params.annotation?.text) return;
			let button = doc.createElement('button');
			button.textContent = 'EasySch · 翻译与追问';
			button.className = 'easysch-reader-action';
			button.addEventListener('click', () => {
				let attachment = Zotero.Items.get(reader.itemID);

				E.open({ paperID: attachment.parentID || attachment.id, attachmentID: attachment.id,
					text: params.annotation.text, pageIndex: params.annotation.position?.pageIndex });
			});
			append(button);
			let translate = doc.createElement('button');
			translate.textContent = '有道翻译';
			translate.addEventListener('click', async () => {
				translate.disabled = true;
				let output = doc.createElement('div');
				output.style.cssText = 'white-space:pre-wrap;max-width:420px;max-height:250px;overflow:auto;padding:8px;user-select:text';
				output.textContent = '正在翻译…'; append(output);
				try { output.textContent = (await E.translateYoudao(params.annotation.text)).text; }
				catch (e) { output.textContent = e.message; }
				finally { translate.disabled = false; }
			});
			append(translate);
		};
		Zotero.Reader.registerEventListener('renderTextSelectionPopup', E.readerHandler, E.id);
		E.registerSidebar();
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
		E.addViewMenu(win);
		if (!Zotero.Prefs.get('extensions.easysch.columnLayoutV2', true)) {
			E.applyView(win, ['title', 'firstCreator', 'year', 'research_tags', 'research_impact_factor', 'research_journalTags', 'dateAdded']);
			Zotero.Prefs.set('extensions.easysch.columnLayoutV2', true, true);
		}
		win.addEventListener('unload', () => E.removeWindow(win), { once: true });
		E.windows.add(win);
	};
	E.removeWindow = function (win) {
		win.document.getElementById('easysch-open')?.remove();
		win.document.getElementById('easysch-views')?.remove();
		win.document.querySelector('[href="easysch.ftl"]')?.remove();
		E.windows.delete(win);
	};
	E.open = function (selection) {
		let main = Zotero.getMainWindow();
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
	E.stop = async function () {
		E.ai?.cancel();
		if (E.sidebarID) Zotero.ItemPaneManager.unregisterSection(E.sidebarID);
		Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', E.readerHandler);
		for (let win of [...E.windows]) E.removeWindow(win);
		for (let win of [...E.panels]) win.close();
		E.panels.clear();
		await E.store?.flush();
	};
})(EasySch);
