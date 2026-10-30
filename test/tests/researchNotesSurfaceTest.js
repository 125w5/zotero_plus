/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Native reader notes surface and preserved actions', function () {
	this.timeout(180000);
	const E = Zotero.Research;
	let win, reader, pdf, context, folder, child, standalone, parent;
	let prepareTranslation, indexArticle, queueImages;
	const checks = [];
	const wait = async (fn, label) => {
		for (let i = 0; i < 300; i++) {
			if (await fn()) return;
			await Zotero.Promise.delay(100);
		}
		throw Error('等待' + label + '超时');
	};
	const shot = async name => {
		const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		try {
			const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			canvas.getContext('2d').drawImage(image, 0, 0);
			const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
			await IOUtils.write(PathUtils.join(folder, name + '.png'), new Uint8Array(await blob.arrayBuffer()));
		}
		finally { image.close(); }
	};
	before(async () => {
		prepareTranslation = E.manuscripts.prepareTranslation;
		indexArticle = E.manuscripts.indexArticle;
		queueImages = E.assets.queueImages;
		E.manuscripts.prepareTranslation = E.manuscripts.indexArticle = E.assets.queueImages = async () => null;
		win = await loadZoteroPane();
		await E.attachWindow(win);
		win.resizeTo(1500, 1000);
		await win.Zotero_Tabs.closeAll();
		folder = PathUtils.join(Zotero.DataDirectory.dir, 'notes-surface-acceptance');
		await IOUtils.makeDirectory(folder, { ignoreExisting: true });
		parent = new Zotero.Item('journalArticle');
		parent.setField('title', '笔记显示验收：独立验证与固定测试条件');
		await parent.saveTx();
		const file = getTestDataDirectory();
		file.append('recognizePDF_test_arXiv.pdf');
		pdf = await Zotero.Attachments.importFromFile({ file, parentItemID: parent.id });
		child = new Zotero.Item('note');
		child.parentID = parent.id;
		child.setNote('<div data-schema-version="9"><p>条目笔记：阈值选择</p><p>保留人工笔记的完整文字。阈值使用独立验证数据选择，在测试集上固定。</p></div>');
		await child.saveTx();
		standalone = new Zotero.Item('note');
		standalone.setNote('<div data-schema-version="9"><p>独立笔记：下一步实验</p><p>比较不同采集批次，记录数据划分、误差和实验条件。</p></div>');
		await standalone.saveTx();
		reader = await Zotero.Reader.open(pdf.id, null, { allowDuplicate: true });
		await reader._initPromise;
		await wait(() => win.ZoteroContextPane.context?._getNotesContext(pdf.libraryID), '真实笔记面板');
		context = win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);
		win.ZoteroContextPane.collapsed = false;
		win.ZoteroContextPane.context.mode = 'notes';
		context.mode = 'notesList';
		context.input.value = '';
		context.affectedIDs.add(child.id);
		context.affectedIDs.add(standalone.id);
		await context._updateNotesList();
	});
	afterEach(function () { checks.push({ name: this.currentTest.title, state: this.currentTest.state, error: this.currentTest.err?.message }); });
	after(async () => {
		await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify({ checks, limitation: '真实原生阅读器与本地笔记；受控DOM事件；未调用模型' }, null, 2));
		E.manuscripts.prepareTranslation = prepareTranslation;
		E.manuscripts.indexArticle = indexArticle;
		E.assets.queueImages = queueImages;
		if (win && !win.closed) {
			await win.Zotero_Tabs.closeAll();
			win.close();
		}
	});
	it('shows item and all notes with native search, sort and create controls in one soft rail', async () => {
		await wait(() => context.notesList.querySelectorAll('note-row').length >= 2, '笔记列表');
		const before = [child.getNote(), standalone.getNote()];
		const row = [...context.notesList.querySelectorAll('note-row')].find(node => node.note?.id === child.id);
		assert.exists(row);
		const style = win.getComputedStyle(row), head = win.getComputedStyle(row.querySelector('.head'));
		assert.equal(style.borderRadius, '10px');
		assert.notEqual(style.boxShadow, 'none');
		assert.equal(head.borderBottomWidth, '0px', '来源和笔记内容不再各占一个色块');
		assert.equal(head.backgroundColor, 'rgba(0, 0, 0, 0)');
		assert.isAtLeast(context.input.getBoundingClientRect().height, 32);
		const surface = context.querySelector('.zotero-context-notes-list');
		assert.equal(win.getComputedStyle(surface).isolation, 'isolate');
		assert.notEqual(win.getComputedStyle(surface).backgroundColor, 'rgba(0, 0, 0, 0)', '搜索工具层不透出非激活面板的文字');
		for (const selector of ['.item-notes', '.all-notes']) {
			const section = context.notesList.querySelector(selector);
			assert.exists(section, selector);
			assert.exists(section.querySelector('.head [data-action="add"], .head .extra-buttons, .head toolbarbutton'), '原生新建笔记按钮保留');
		}
		const sort = context.querySelector('.easysch-note-sort');
		sort.click();
		let popup;
		await wait(() => { popup = [...context.querySelectorAll('menupopup')].find(node => node.state === 'open'); return popup; }, '笔记排序菜单');
		assert.includeMembers([...popup.querySelectorAll('menuitem')].map(node => node.getAttribute('label')), ['按修改时间（最新优先）', '按 PDF 页码']);
		popup.hidePopup();
		await shot('native-notes-list');
		context.input.value = '独立笔记：下一步实验';
		await context._updateNotesList();
		await wait(() => [...context.notesList.querySelectorAll('note-row')].some(node => node.note?.id === standalone.id), '笔记搜索');
		assert.notInclude([...context.notesList.querySelectorAll('note-row')].map(node => node.note?.id), child.id);
		context.input.value = '';
		await context._updateNotesList();
		const selected = [...context.notesList.querySelectorAll('note-row')].find(node => node.note?.id === child.id);
		selected.click();
		await wait(() => context._getCurrentEditor()?.item?.id === child.id, '笔记编辑器');
		assert.deepEqual([child.getNote(), standalone.getNote()], before, '搜索、排序和打开编辑不会改笔记内容');
	});
});
