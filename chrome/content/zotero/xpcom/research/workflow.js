/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
 const imageLocks=new Map(),pendingImageImports=new Map();
 async function withImageLock(target,fn){const previous=imageLocks.get(target);let release;const current=new Promise(resolve=>release=resolve);imageLocks.set(target,current);if(previous)await previous;try{return await fn();}finally{release();if(imageLocks.get(target)===current)imageLocks.delete(target);}}
 function trackImageImport(target,owner){const pending=pendingImageImports.get(target);if(pending)for(const other of pending)other.shared=true;if(owner){owner.shared=!!pending?.size;const owners=pending||new Set();owners.add(owner);pendingImageImports.set(target,owners);}}
 function releaseImageImport(owner){if(!owner||owner.released)return;owner.released=true;const owners=pendingImageImports.get(owner.target);owners?.delete(owner);if(owners&&!owners.size)pendingImageImports.delete(owner.target);}
 function imageReferenced(state,target,uri){const normal=target.replace(/\\/g,'/'),seen=new Set();const scan=value=>{if(typeof value==='string')return value===target||value===uri||value.replace(/\\/g,'/').includes(normal)||value.includes(uri);if(!value||typeof value!=='object'||seen.has(value))return false;seen.add(value);return Object.values(value).some(scan);};return Object.entries(state).some(([key,value])=>key!=='writingImages'&&scan(value));}
 async function rollbackImageImport(owner){if(!owner||owner.released)return;try{if(owner.shared||(!owner.created&&!owner.indexed))return;let removeFile=false;await E.store.update(state=>{const current=state.writingImages?.[owner.key],ours=owner.indexed&&current?.at===owner.record?.at&&current?.fingerprint===owner.record?.fingerprint&&current?.uri===owner.record?.uri;if(imageReferenced(state,owner.target,owner.uri))return;if(ours)delete state.writingImages[owner.key];removeFile=owner.created&&(!current||ours);});if(removeFile&&!owner.shared)await IOUtils.remove(owner.target,{ignoreAbsent:true});}finally{releaseImageImport(owner);}}
	E.importWritingImage = async (suppliedPath,{signal}={}) => {
  const checkAbort=()=>{if(signal?.aborted)throw Error('已取消');};
  const path=suppliedPath||await E.pick(Zotero.getMainWindow(),'选择图片素材','file','png;jpg;jpeg;webp');checkAbort();if(!path)return null;
  if(!/\.(png|jpe?g|webp)$/i.test(path))throw Error('请选择 PNG、JPEG 或 WebP 图片');
  const stat=await IOUtils.stat(path);checkAbort();if(stat.size>15*1024*1024)throw Error('图片超过 15 MB，请先缩小图片');
  const win=Zotero.getMainWindow(),image=new win.Image();image.src=await E.previewImage(path);checkAbort();try{await image.decode();}catch{throw Error('文件不是可读取的图片');}checkAbort();
  const fingerprint=await Zotero.Utilities.Internal.md5Async(path);checkAbort();const folder=PathUtils.join(E.dataDir,'writing-images');await IOUtils.makeDirectory(folder,{ignoreExisting:true});checkAbort();
  const target=PathUtils.join(folder,fingerprint+path.match(/\.[^.]+$/)[0].toLowerCase()),key=target.replace(/\\/g,'/'),uri=Zotero.File.pathToFileURI(target),owner=signal?{target,key,uri,created:false,indexed:false,shared:false,released:false}:null;
  trackImageImport(target,owner);
  const result=await withImageLock(target,async()=>{try{
   checkAbort();if(!await IOUtils.exists(target)){checkAbort();await IOUtils.copy(path,target);if(owner)owner.created=true;}checkAbort();
   await E.store.update(state=>{state.writingImages||={};if(!state.writingImages[key]){const record={uri,at:new Date().toISOString(),fingerprint};state.writingImages[key]=record;if(owner){owner.indexed=true;owner.record=record;}}});checkAbort();
   return {path:target,fingerprint,width:image.naturalWidth,height:image.naturalHeight,title:PathUtils.filename(path)};
  }catch(error){if(owner)try{await rollbackImageImport(owner);}catch(cleanupError){Zotero.logError(cleanupError);}throw signal?.aborted?Error('已取消'):error;}});
  if(owner){Object.defineProperties(result,{rollbackImport:{value:()=>withImageLock(target,()=>rollbackImageImport(owner))},finishImport:{value:()=>releaseImageImport(owner)}});}
  return result;
 };
	E.openWorkflow = async (page, selection) => {
		return E.openLibraryWorkspace(Zotero.getMainWindow(),page==='home'?'discovery':page==='research'?'agent':page,{selection});
	};
	// The tab-strip plus button creates an independent page. Navigation buttons
	// continue to reuse the original library workspace and its unsaved state.
	E.openWorkflowPage = async (page,{win=Zotero.getMainWindow(),createProject=false}={}) => {
		const titles={search:'文献检索',writing:'论文装配',ppt:'组会 PPT',schedule:'日程'};
		if(!titles[page])throw Error('不支持的科研页面');
		const doc=win.document,frame=doc.createElementNS('http://www.w3.org/1999/xhtml','iframe'),controller=new win.AbortController();
		frame.id='research-page-'+Zotero.Utilities.randomString(12);frame.title=titles[page];frame.style.cssText='width:100%;height:100%;border:0;flex:1;min-width:0';
		frame.researchPage=page;frame.researchCreateProject=createProject;frame.researchLibraryMode=true;frame.researchLibraryView=page;frame.researchOverlayMode='tab';
		const {id,container}=win.Zotero_Tabs.add({type:'research',title:titles[page],data:{workflowPage:page},select:true,onClose:()=>{controller.abort();frame.contentWindow?.EasySchUI?.suspendDiscovery?.();}});
		container.style.display='flex';container.append(frame);frame.src='chrome://zotero/content/research/workspace.html';
		for(let attempt=0;attempt<500;attempt++){
			if(controller.signal.aborted||win.closed)return null;
			const ui=frame.contentWindow?.EasySchUI;
			if(ui?.ready){
				if(page==='ppt')await ui.pptAssistantReady;
				if(controller.signal.aborted)return null;
				const {prepareReaderPaneStyles}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-pane-styles.mjs');
				await prepareReaderPaneStyles(frame.contentDocument,{Zotero,name:'workflow-tab',url:'chrome://zotero/content/research/library-workspace.css'});
				const {readNativeLibraryScope}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-scope.mjs');
				const scope=await readNativeLibraryScope(E,win,{signal:controller.signal});
				if(!controller.signal.aborted&&scope)await ui.setLibraryScope?.(scope,{signal:controller.signal,preserveActive:true});
				return controller.signal.aborted?null:ui;
			}
			await Zotero.Promise.delay(40);
		}
		if(!controller.signal.aborted){win.Zotero_Tabs.close(id);throw Error('新页面加载超时，请重试');}return null;
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
	E.saveReaderNote = async (selection, record, {reader:sourceReader} = {}) => {
		const attachment = await Zotero.Items.getAsync(selection.attachmentID);
		let position = selection.position;
		if (!attachment?.isPDFAttachment() || !position?.rects?.length)
			throw Error(
				'该选区没有精确坐标，请在 PDF 中重新划选；不会随意在页面上打标记',
			);
		E.assertReaderWritable(sourceReader || E.readerForAttachment(attachment.id), attachment);
		const h = E.core.escapeHTML,
			key = Zotero.DataObjectUtilities.generateKey();
		const summary = record.result.sections
			.map((s) => s.heading + '\n' + s.body)
			.join('\n\n');
		const label=record.model==='原文摘录'?'原文摘录':record.mode==='translate'||String(record.model).includes('机器翻译')?'机器翻译':'AI 补充';
		const NoteContent=ChromeUtils.importESModule('chrome://zotero/content/research/shared/selection-note-content.mjs'),Formula=ChromeUtils.importESModule('chrome://zotero/content/research/shared/formula-research.mjs');
		const formula=E.assets?.position&&NoteContent.selectionFormulaAsset(selection,E.assets.active?.get(selection.attachmentID)?.assets,E.assets.position),latex=selection.latex||selection.formulaLatex||(formula&&E.store.get('formulaTranscriptions',Formula.formulaSourceKey(formula))?.latex)||'';
		const content=NoteContent.selectionNoteHTML({selection,summary,label,latex,render:E.noteContentHTML,escape:h});
		const snapshot=!!formula&&!content.math;
		if(snapshot)position=E.assets.position(formula);
		let comment=label+(label==='原文摘录'?'':'（请核对）\n'+summary),same=E.selectionNoteLink?.(attachment.id,position,comment);
		if(same){
			let liveReader=sourceReader?.itemID===attachment.id&&!sourceReader._isUninitialized&&!sourceReader._isTabClosed?sourceReader:E.readerForAttachment(attachment.id);
			return {noteID:same.noteID,annotationID:same.annotationID,reused:true,warning:liveReader?await E.openSavedReaderNote(same.noteID,liveReader):''};
		}
		let annotation = new Zotero.Item('annotation'),
			note;
		annotation.libraryID = attachment.libraryID;
		annotation.key = key;
		await annotation.loadPrimaryData();
		annotation.parentID = attachment.id;
		annotation.annotationType = snapshot?'image':'highlight';
		annotation.annotationText = snapshot?'':content.math?'$$\n'+Formula.normalizeFormulaInput(latex)+'\n$$':selection.text;
		annotation.annotationComment = comment;
		annotation.annotationColor = '#a28ae5';
		annotation.annotationPageLabel = String(position.pageIndex + 1);
		annotation.annotationSortIndex =
			selection.sortIndex ||
			String(position.pageIndex).padStart(5, '0') + '|000000|00000';
		annotation.annotationPosition = JSON.stringify(position);
		annotation.setTags([{ tag: label }]);
		if(snapshot){
			// Native annotation rendering preserves the complete equation's PDF
			// glyphs and imports its durable image attachment into the new note.
			await annotation.saveTx();
			try{note=await Zotero.EditorInstance.createNoteFromAnnotations([annotation],{parentID:attachment.parentID||undefined,collectionID:!attachment.parentID?attachment.getCollections()[0]:undefined,noHeader:true,noComments:label==='原文摘录'});}
			catch(error){try{await Zotero.Items.trashTx(annotation.id);}catch(cleanupError){Zotero.logError(cleanupError);}throw error;}
		}else await Zotero.DB.executeTransaction(async () => {
			await annotation.save({ skipSelect: true });
			const uri =
				E.library.uri(attachment, position.pageIndex) + '&annotation=' + key;
			note = new Zotero.Item('note');
			note.libraryID = attachment.libraryID;
			if (attachment.parentID) note.parentID = attachment.parentID;
			else note.setCollections(attachment.getCollections());
			note.setNote(
				`<h1>${label}笔记</h1><p>${h(record.model || 'AI')} · ${h(record.at || new Date().toISOString())}</p>${content.html}<p><a href="${h(uri)}">回到 PDF 第 ${position.pageIndex + 1} 页选区</a></p>`,
			);
			await note.save({ skipSelect: true });
		});
		const originalNote = note.getNote(),
			originalComment = annotation.annotationComment;
		for(const reader of Zotero.Reader._readers.filter(r=>r.itemID===attachment.id&&r._window&&!r._window.closed&&!r._isTabClosed&&!r._isUninitialized))await reader.setAnnotations([annotation]);
		await E.rememberNoteLink(annotation,note,{translation:label==='原文摘录'?'':summary,generatedComment:annotation.annotationComment});
		const reader=sourceReader?.itemID===attachment.id&&!sourceReader._isUninitialized&&!sourceReader._isTabClosed?sourceReader:E.readerForAttachment(attachment.id);
		let warning=reader?await E.openSavedReaderNote(note.id,reader):'';
		return {
			noteID: note.id,
			annotationID: annotation.id,
			warning,
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
