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
			let attachment = Zotero.Items.get(reader.itemID);
			let paperID = attachment.parentID || attachment.id;
			let selection = { paperID, attachmentID: attachment.id, text: params.annotation.text,
				pageIndex: params.annotation.position?.pageIndex };
			let output = doc.createElement('div');
			output.style.cssText = 'white-space:pre-wrap;width:min(520px,80vw);max-height:360px;overflow:auto;padding:10px;margin-top:6px;border-top:1px solid #ccd7da;user-select:text';
			let renderRecord = record => {
				output.replaceChildren();
				for (let section of record.result.sections) {
					let heading = doc.createElement('strong'); heading.textContent = section.heading;
					let body = doc.createElement('p'); body.textContent = section.body; body.style.margin = '4px 0 8px';
					output.append(heading, body);
					for (let id of section.sources) {
						let source = record.sources.find(value => value.id === id);
						if (!source) continue;
						let evidence = doc.createElement('button'); evidence.textContent = `[${id}] ${source.label}`; evidence.title = source.text;
						evidence.addEventListener('click', () => E.library.openSource(source)); output.append(evidence);
					}
				}
				if (record.result.keywords?.length) { let terms = doc.createElement('p'); terms.textContent = `术语：${record.result.keywords.join(' · ')}`; output.append(terms); }
			};
			let action = (label, handler) => {
				let button = doc.createElement('button'); button.textContent = label; button.className = 'easysch-reader-action';
				button.addEventListener('click', async () => {
					button.disabled = true;
					try { await handler(); }
					catch (error) { output.textContent = error.message; }
					finally { button.disabled = false; }
				});
				append(button);
			};
			for (let [label, mode] of [['翻译', 'translate'], ['AI 解释', 'selection_explain'], ['专业术语', 'selection_terms']]) {
				action(label, async () => {
					output.textContent = '正在提取选段与原文证据…';
					let paper = await Zotero.Items.getAsync(paperID);
					let record = await E.ai.run({ mode, papers: [E.library.describe(paper)], selection,
						onStatus: text => { output.textContent = text; } });
					renderRecord(record);
				});
			}
			action('生成示意图', async () => {
				output.textContent = '正在生成基于选段的图形计划…';
				let paper = await Zotero.Items.getAsync(paperID);
				let diagram = await E.planSelectionDiagram({ paper: E.library.describe(paper), selection,
					onStatus: text => { output.textContent = text; } });
				output.replaceChildren();
				let parsed = new doc.defaultView.DOMParser().parseFromString(diagram.svg, 'image/svg+xml').documentElement;
				parsed.setAttribute('style', 'width:100%;height:auto;display:block'); output.append(doc.importNode(parsed, true));
				let note = doc.createElement('p'); note.textContent = '示意图只表达当前选段，不补写未提供的步骤。'; output.append(note);
				let save = doc.createElement('button'); save.textContent = '保存可编辑 SVG';
				save.addEventListener('click', async () => { let path = await E.saveSelectionDiagram(diagram); if (path) { note.textContent = `已保存：${path}`; await E.reveal(path); } });
				output.append(save);
			});
			action('更多 · 工作台', () => E.open(selection));
			append(output);
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
		let { container } = main.Zotero_Tabs.add({ type: 'research-docx', title, data: { itemID: attachmentID }, select: true });
		container.style.display = 'flex';
		container.append(frame);
		frame.src = 'chrome://zotero/content/research/docx-viewer.html';
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
