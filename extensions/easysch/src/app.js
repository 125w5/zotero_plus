(function (E) {
	E.settings = () => ({ ...E.core.defaults, ...E.store.get().settings });
	E.getItem = id => Zotero.Items.getAsync(id);
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
		await E.initStorage();
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
				if (!attachment?.parentID) {
					Zotero.alert(Zotero.getMainWindow(), 'EasySch', '请先为独立 PDF 创建父条目');
					return;
				}
				E.open({ paperID: attachment.parentID, attachmentID: attachment.id,
					text: params.annotation.text, pageIndex: params.annotation.position?.pageIndex });
			});
			append(button);
		};
		Zotero.Reader.registerEventListener('renderTextSelectionPopup', E.readerHandler, E.id);
		// Only the isolated development launcher enables this integration test.
		if (Zotero.Prefs.get('extensions.easysch.smokeTest', true)) {
			Services.scriptloader.loadSubScript(E.rootURI + 'tests/runtime-smoke.js',
				{ EasySch: E, Zotero, Services, IOUtils, PathUtils, ChromeUtils, Cc, Ci });
		}
	};
	E.addWindow = function (win) {
		if (E.windows.has(win)) return;
		win.MozXULElement.insertFTLIfNeeded('easysch.ftl');
		let entry = win.document.createXULElement('menuitem');
		entry.id = 'easysch-open';
		entry.setAttribute('data-l10n-id', 'easysch-open');
		entry.addEventListener('command', () => E.open());
		win.document.getElementById('menu_ToolsPopup')?.append(entry);
		E.windows.add(win);
	};
	E.removeWindow = function (win) {
		win.document.getElementById('easysch-open')?.remove();
		win.document.querySelector('[href="easysch.ftl"]')?.remove();
		E.windows.delete(win);
	};
	E.open = function (selection) {
		// A single workspace avoids competing draft editors and duplicated requests.
		for (let panel of E.panels) {
			if (!panel.closed) {
				panel.focus();
				if (selection) panel.EasySchUI?.setSelection(selection);
				return panel;
			}
		}
		let win = Zotero.getMainWindow().openDialog('chrome://easysch/content/workspace.html',
			'easysch-workspace', 'chrome,dialog=no,resizable,centerscreen,width=1250,height=820', { api: E, selection });
		E.panels.add(win);
		win.addEventListener('unload', () => E.panels.delete(win), { once: true });
		return win;
	};
	E.stop = async function () {
		E.ai?.cancel();
		Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', E.readerHandler);
		for (let win of [...E.windows]) E.removeWindow(win);
		for (let win of [...E.panels]) win.close();
		E.panels.clear();
		await E.store?.flush();
	};
})(EasySch);
