/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	E.importWritingImage = async (suppliedPath) => {
  const path=suppliedPath||await E.pick(Zotero.getMainWindow(),'选择图片素材','file','png;jpg;jpeg;webp');if(!path)return null;
  if(!/\.(png|jpe?g|webp)$/i.test(path))throw Error('请选择 PNG、JPEG 或 WebP 图片');
  const stat=await IOUtils.stat(path);if(stat.size>15*1024*1024)throw Error('图片超过 15 MB，请先缩小图片');
  const win=Zotero.getMainWindow(),image=new win.Image();image.src=await E.previewImage(path);try{await image.decode();}catch{throw Error('文件不是可读取的图片');}
  const fingerprint=await Zotero.Utilities.Internal.md5Async(path),folder=PathUtils.join(E.dataDir,'writing-images');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const target=PathUtils.join(folder,fingerprint+path.match(/\.[^.]+$/)[0].toLowerCase());if(!await IOUtils.exists(target))await IOUtils.copy(path,target);
  await E.store.update(s=>{s.writingImages||={};s.writingImages[target.replace(/\\/g,'/')]={uri:Zotero.File.pathToFileURI(target),at:new Date().toISOString(),fingerprint};});
  return {path:target,fingerprint,width:image.naturalWidth,height:image.naturalHeight,title:PathUtils.filename(path)};
 };
	E.openWorkflow = async (page, selection) => {
		const w = E.open();
		for (let i = 0; i < 200 && !w.EasySchUI?.ready; i++)
			await Zotero.Promise.delay(30);
		if (!w.EasySchUI?.ready) throw Error('页面尚未准备好，请重试');
		if (selection) await w.EasySchUI.setSelection(selection);
		w.EasySchUI.show(page);
		return w.EasySchUI;
	};
	E.installHomeMenu = (win) => {
		const doc = win.document,
			pane = doc.getElementById('zotero-items-pane');
		if (!pane || pane._researchContext) return;
		const menu = doc.createXULElement('menupopup');
		menu.id = 'research-home-menu';
		doc.documentElement.append(menu);
		const add = (label, run) => {
			const b = doc.createXULElement('menuitem');
			b.setAttribute('label', label);
			b.addEventListener('command', () =>
				Promise.resolve()
					.then(run)
					.catch((e) => Services.prompt.alert(win, '科研助手', e.message)),
			);
			menu.append(b);
		};
		add('新建研究分类', () => win.ZoteroPane.newCollection());
		add('导入文献', () => win.Zotero_File_Interface.importFile());
		add('新建笔记', () => win.ZoteroPane.newNote(false));
		add('整理选中文献', async () => {
			const ui = await E.openWorkflow('research');
			if(ui.busy)throw Error('请先等待当前分析完成或取消');
			await ui.refresh();
			await ui.showOrganize();
		});
		add('第一次使用？', async () => {
			const ui = await E.openWorkflow('research');
			ui.showHelp();
		});
		pane._researchContext = (event) => {
			if (event.target.closest('.row, [role="row"], .column-header, .virtualized-table-header, button, input, textarea')) return;
			event.preventDefault();
			event.stopPropagation();
			menu.openPopupAtScreen(event.screenX, event.screenY, true);
		};
		pane.addEventListener('contextmenu', pane._researchContext, true);
		const items = doc.getElementById('zotero-itemmenu');
		const group = doc.createXULElement('menu');
		group.id = 'research-item-actions';
		group.setAttribute('label', '阅读与整理');
		const sub = doc.createXULElement('menupopup');
		group.append(sub);
		for (const [label, page] of [
			['AI 阅读与笔记', 'research'],
			['引用与相似论文', 'search'],
			['写作与引用', 'writing'],
		]) {
			const b = doc.createXULElement('menuitem');
			b.setAttribute('label', label);
			b.addEventListener('command', () => {
				const p = E.library.selection()[0];
				E.openWorkflow(page, p && { paperID: p.id }).catch((e) =>
					Zotero.logError(e),
				);
			});
			sub.append(b);
		}
		items?.append(group);
	};
	E.saveReaderNote = async (selection, record) => {
		const attachment = await Zotero.Items.getAsync(selection.attachmentID),
			position = selection.position;
		if (!attachment?.isPDFAttachment() || !position?.rects?.length)
			throw Error(
				'该选区没有精确坐标，请在 PDF 中重新划选；不会随意在页面上打标记',
			);
		if (!Zotero.Libraries.get(attachment.libraryID).editable)
			throw Error('当前文库只读');
		const h = E.core.escapeHTML,
			key = Zotero.DataObjectUtilities.generateKey();
		const summary = record.result.sections
			.map((s) => s.heading + '\n' + s.body)
			.join('\n\n');
		const label=record.model==='原文摘录'?'原文摘录':String(record.model).includes('机器翻译')?'机器翻译':'AI 补充';
		let annotation = new Zotero.Item('annotation'),
			note;
		annotation.libraryID = attachment.libraryID;
		annotation.key = key;
		await annotation.loadPrimaryData();
		annotation.parentID = attachment.id;
		annotation.annotationType = 'highlight';
		annotation.annotationText = selection.text;
		annotation.annotationComment = label + (label==='原文摘录'?'':'（请核对）')+'\n' + summary;
		annotation.annotationColor = '#a28ae5';
		annotation.annotationPageLabel = String(position.pageIndex + 1);
		annotation.annotationSortIndex =
			selection.sortIndex ||
			String(position.pageIndex).padStart(5, '0') + '|000000|00000';
		annotation.annotationPosition = JSON.stringify(position);
		annotation.setTags([{ tag: label }]);
		await Zotero.DB.executeTransaction(async () => {
			await annotation.save({ skipSelect: true });
			const uri =
				E.library.uri(attachment, position.pageIndex) + '&annotation=' + key;
			note = new Zotero.Item('note');
			note.libraryID = attachment.libraryID;
			if (attachment.parentID) note.parentID = attachment.parentID;
			else note.setCollections(attachment.getCollections());
			note.setNote(
				`<h1>${label}笔记</h1><p>${h(record.model || 'AI')} · ${h(record.at || new Date().toISOString())}</p><blockquote>${h(selection.text)}</blockquote>${E.noteContentHTML(summary)}<p><a href="${h(uri)}">回到 PDF 第 ${position.pageIndex + 1} 页选区</a></p>`,
			);
			await note.save({ skipSelect: true });
		});
		const originalNote = note.getNote(),
			originalComment = annotation.annotationComment;
		for(const reader of Zotero.Reader._readers.filter(r=>r.itemID===attachment.id))await reader.setAnnotations([annotation]);
		await E.rememberNoteLink(annotation,note,{translation:summary,generatedComment:annotation.annotationComment});
		const reader=Zotero.Reader._readers.find(r=>r.itemID===attachment.id);
		if(reader)await E.openReaderNote(note.id,reader);
		return {
			noteID: note.id,
			annotationID: annotation.id,
			undo: async () => {
				const a = await Zotero.Items.getAsync(annotation.id),
					n = await Zotero.Items.getAsync(note.id);
				if (
					a?.annotationComment !== originalComment ||
					n?.getNote() !== originalNote
				)
					throw Error('笔记或批注已被修改，请在文库中检查后手动删除');
				await Zotero.Items.trashTx([annotation.id, note.id]);
			},
		};
	};
})(Zotero.Research);
