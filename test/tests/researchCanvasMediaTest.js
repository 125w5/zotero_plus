/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Editable manuscript canvas media previews', function () {
	this.timeout(120000);
	const E = Zotero.Research, Media = ChromeUtils.importESModule('chrome://zotero/content/research/manuscript/canvas-media.mjs');
	let win, frame, host, projectID, cleanup;
	const wait = async (fn, label = '正文媒体预览') => {for (let n = 0; n < 200; n++) {if (fn()) return; await Zotero.Promise.delay(30);} throw Error('等待 ' + label + ' 超时');};
	const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
	const add = (tag, text, parent = host) => {const node = frame.contentDocument.createElement(tag); if (text !== undefined) node.textContent = text; parent.append(node); return node;};
	const doubleClick = node => {node.click(); node.dispatchEvent(new frame.contentWindow.MouseEvent('dblclick', {bubbles: true, cancelable: true}));};
	before(async () => {
		win = await loadZoteroPane(); await E.attachWindow(win);
		const project = await E.manuscripts.create('正文媒体交互受控验收 ' + Date.now()); projectID = project.id; await E.manuscripts.open(projectID);
		await wait(() => {frame = win.document.getElementById('manuscript-' + projectID); return frame?.contentWindow.ManuscriptUI?.ready;});
		host = frame.contentDocument.createElement('section'); host.dataset.id = 'media-test'; frame.contentDocument.body.append(host);
	});
	afterEach(() => {cleanup?.(); cleanup = null; Media.disposeCanvasMedia(host); host.replaceChildren();});
	after(async () => {host?.remove(); if (projectID) {win.Zotero_Tabs.close('manuscript-' + projectID); await E.manuscripts.remove(projectID);}});
	it('shows image hover preview, opens single-click fullscreen and routes authored-image double-click to editing', async () => {
		const image = add('img'); image.src = imageData; image.alt = '人工图片'; const edits = [];
		cleanup = Media.installCanvasMedia(host, {id: 'image-1', type: 'image', imagePath: 'user.png', materials: []}, {E, hoverDelay: 10, onEdit: block => edits.push(block.id)});
		image.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter')); await wait(() => frame.contentDocument.querySelector('.research-media-hover'));
		assert.notExists(frame.contentDocument.querySelector('.research-media-modal')); image.click(); await wait(() => frame.contentDocument.querySelector('.research-media-modal'));
		frame.contentDocument.querySelector('.research-media-modal').close(); doubleClick(image); await wait(() => edits.length === 1); await Zotero.Promise.delay(250); assert.notExists(frame.contentDocument.querySelector('.research-media-modal'));
	});
	it('locates the exact bound PDF figure and retains original material data', async () => {
		const image = add('img'); image.src = imageData; const material = {id: 'pdf-image', imagePath: 'original.png', sourceText: 'Original source.', anchor: {attachmentID: 321, pageIndex: 5, position: {rects: [[1, 2, 3, 4]]}}}, block = {id: 'source-image', imagePath: 'original.png', materials: [{id: material.id}]}, before = JSON.stringify({material, block}), opened = [];
		cleanup = Media.installCanvasMedia(host, block, {E, materials: [material], onOpenAnchor: anchor => opened.push(anchor)});
		doubleClick(image); await wait(() => opened.length === 1);
		assert.equal(opened[0].attachmentID, material.anchor.attachmentID); assert.equal(opened[0].pageIndex, material.anchor.pageIndex);
		assert.deepEqual(opened[0].position, material.anchor.position); assert.equal(opened[0].sourceText, material.sourceText);
		assert.equal(JSON.stringify({material, block}), before);
	});
	it('keeps table cell clicks and editing intact and uses a compact preview on the existing caption line', async () => {
		const wrap = add('div'); wrap.className = 'table-wrap'; const caption = add('div', '表 1 用户数据', wrap), table = add('table', undefined, wrap), row = add('tr', undefined, table), td = add('td', undefined, row), cell = add('div', '$x_i^2$', td); cell.className = 'cell-editor'; cell.contentEditable = true;
		add('span', undefined, td).className = 'col-resize'; const before = table.innerHTML, edited = [];
		cleanup = Media.installCanvasMedia(host, {id: 'table-1', type: 'table', table: {}, materials: []}, {E, hoverDelay: 10, onEdit: block => edited.push(block.id)});
		assert.exists(caption.querySelector('.canvas-table-preview-button')); assert.notInclude(cell.className, 'research-media-trigger'); cell.click(); await Zotero.Promise.delay(250); assert.notExists(frame.contentDocument.querySelector('.research-media-modal'));
		const button = caption.querySelector('.canvas-table-preview-button'); button.click(); await wait(() => frame.contentDocument.querySelector('.research-media-modal'));
		const modal = frame.contentDocument.querySelector('.research-media-modal'); assert.notExists(modal.querySelector('[contenteditable],.col-resize')); assert.exists(modal.querySelector('.katex')); assert.equal(table.innerHTML, before); modal.close();
		doubleClick(button); await wait(() => edited.length === 1); assert.equal(cell.contentEditable, 'true'); assert.equal(table.innerHTML, before);
	});
	it('snapshots current cell edits while keeping merges and PDF-original data unchanged', function () {
		const table = add('table'), row = add('tr', undefined, table), cell = add('td', undefined, row), editor = add('div', '用户新值', cell); cell.rowSpan = 2; cell.colSpan = 2; editor.contentEditable = true; editor.className = 'cell-editor';
		const before = table.innerHTML, clone = Media.cloneCanvasTable(table, {E}); assert.equal(clone.querySelector('td').rowSpan, 2); assert.equal(clone.querySelector('td').colSpan, 2); assert.include(clone.textContent, '用户新值'); assert.notExists(clone.querySelector('[contenteditable]')); assert.equal(table.innerHTML, before);
	});
	it('cancels pending hover and fullscreen timers on canvas redraw without leaving floating media', async () => {
		const image = add('img'); image.src = imageData; cleanup = Media.installCanvasMedia(host, {id: 'dispose-image', materials: []}, {E, hoverDelay: 10});
		image.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter')); image.click(); cleanup(); cleanup(); await Zotero.Promise.delay(260);
		assert.notExists(frame.contentDocument.querySelector('.research-media-hover')); assert.notExists(frame.contentDocument.querySelector('.research-media-modal')); assert.notProperty(host.dataset, 'canvasMediaInstalled');
	});
});
