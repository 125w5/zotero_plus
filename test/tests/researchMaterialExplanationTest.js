/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Source-preserving material explanations and formula editing', function () {
	this.timeout(120000);
	const E = Zotero.Research, base = 'chrome://zotero/content/research/';
	const Content = ChromeUtils.importESModule(base + 'shared/material-content.mjs');
	const Formula = ChromeUtils.importESModule(base + 'manuscript/formula-editor.mjs');
	const Explanation = ChromeUtils.importESModule(base + 'manuscript/material-content-editor.mjs');
	const Preview = ChromeUtils.importESModule(base + 'shared/media-preview.mjs');
	let win, frame, host, projectID, prior, disposer;
	const wait = async (fn, label = '素材编辑器') => {for (let n = 0; n < 200; n++) {if (fn()) return; await Zotero.Promise.delay(30);} throw Error('等待 ' + label + ' 超时');};
	const click = (root, label) => {const button = [...root.querySelectorAll('button')].find(node => node.textContent === label); assert.exists(button, label); button.click();};
	before(async () => {
		win = await loadZoteroPane(); await E.attachWindow(win);
		const project = await E.manuscripts.create('素材说明与数学排版受控验收 ' + Date.now()); projectID = project.id; await E.manuscripts.open(projectID);
		await wait(() => {frame = win.document.getElementById('manuscript-' + projectID); return frame?.contentWindow.ManuscriptUI?.ready;});
		host = frame.contentDocument.createElement('div'); host.id = 'material-explanation-test'; frame.contentDocument.body.append(host);
		prior = {request: E.studio.request, index: E.assets.index, previewImage: E.previewImage};
		E.previewImage = async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
	});
	afterEach(() => {disposer?.(); disposer = null; Preview.disposeMediaPreviews(host); host.replaceChildren(); E.studio.request = prior.request; E.assets.index = prior.index;});
	after(async () => {E.previewImage = prior.previewImage; host?.remove(); if (projectID) {win.Zotero_Tabs.close('manuscript-' + projectID); await E.manuscripts.remove(projectID);}});
	it('accepts only explanation edits and never applies source or PDF geometry changes', function () {
		const original = {sourceText: 'x i 2 = 1', anchor: {pageIndex: 4, position: {rects: [[1, 2, 3, 4]]}}, imagePath: 'original.png'};
		const patch = Content.materialExplanationPatch({summary: '变量含义应核对原文。', contents: [{type: 'formula', latex: 'x_i^2 = 1'}, {type: 'table', rows: [['变量', '值'], ['x', '1']]}], sourceText: 'changed', anchor: {pageIndex: 9}, imagePath: 'replacement.png'});
		assert.deepEqual(Object.keys(patch).sort(), ['contents', 'summary']); assert.equal(original.sourceText, 'x i 2 = 1');
		assert.equal(Content.explicitFormula(original), '');
		assert.throws(() => Content.normalizeMaterialContents([{type: 'table', rows: [['a'], ['b', 'c']]}]));
	});
	it('preserves PDF caption scripts without treating caption data as HTML or guessing TeX', function () {
		Content.renderSourceRuns(host, '', [{text: 'x', fontStyle: 'italic'}, {text: 'i', script: 'sub'}, {text: '2', script: 'super'}, {text: '<img src=x onerror=alert(1)>'}]);
		assert.equal(host.querySelector('sub').textContent, 'i'); assert.equal(host.querySelector('sup').textContent, '2'); assert.equal(host.querySelector('em').textContent, 'x'); assert.notExists(host.querySelector('img'));
		host.replaceChildren(); Content.renderSourceRuns(host, 'A different excerpt', [{text: 'x', script: 'sub'}]); assert.equal(host.textContent, 'A different excerpt'); assert.notExists(host.querySelector('sub'));
	});
	it('renders editable LaTeX with a real live preview and retains original formula images in source selection', async function () {
		const id = 987123, calls = [], asset = {id: 'original-formula', kind: 'formula', attachmentID: id, label: 'Eq. 3', pageIndex: 2, bbox: [10, 20, 150, 80], path: 'fixture.png', sourceText: 'broken OCR'};
		E.assets.index = async input => {assert.equal(input, id); return {assets: [asset, {...asset}, {...asset, kind: 'figure'}]};};
		const testE={...E,assets:{...E.assets,recognizeFormula:async row=>({latex:'x_i^2=1',needsReview:true,sourceImagePath:row.path,uncertainties:[]})}};
		const control = Formula.renderFormulaEditor(host, {text: 'E_{\\mathrm{F}} = x_i^2', E:testE, attachmentIDs: [id], embedded: true, onOpenAnchor: anchor => calls.push(anchor), onUseEvidence: row => calls.push(row)}); disposer = control.dispose;
		assert.exists(host.querySelector('.katex')); assert.include(host.querySelector('annotation').textContent, '\\mathrm{F}');
		control.input.value = '\\frac{x_i}{2}'; control.input.dispatchEvent(new frame.contentWindow.Event('input', {bubbles: true}));
		assert.include(host.querySelector('annotation').textContent, '\\frac'); click(host, '从论文选择'); await wait(() => host.querySelector('.formula-source-card'));
		assert.lengthOf(host.querySelectorAll('.formula-source-card'), 1); assert.notInclude(host.textContent, '使用 LaTeX'); click(host, '识别并使用'); await wait(() => calls.length === 1); assert.equal(control.getValue(), 'x_i^2=1');assert.isTrue(calls[0].formulaRecognition.needsReview);assert.equal(calls[0].path,asset.path);
	});
	it('lets users add formula, table and image explanation blocks and save them without modifying source', async function () {
		const material = {id: 'explanation-ui', summary: '原说明', summaryZh: '原说明', sourceText: 'Evidence: x is the measured value.', anchor: {pageIndex: 2}}, saved = [];
		const testE = {...E, manuscripts: {...E.manuscripts, summaryFor: m => m.summary, image: async () => 'fixture.png'}};
		const control = Explanation.renderMaterialExplanationEditor(host, material, {E: testE, onSave: async patch => {saved.push(patch); return patch;}}); disposer = control.dispose; control.edit();
		click(host, 'ƒ'); await wait(() => host.querySelector('.formula-latex-input')); host.querySelector('.formula-latex-input').value = 'x_i^2';
		click(host, '▦'); await wait(() => host.querySelector('.material-table-size')); click(host.querySelector('.material-table-size'), '添加');
		click(host, '▧'); await wait(() => host.querySelector('.material-content-edit-block img')); click(host, '保存'); await wait(() => saved.length === 1 && host.querySelector('.material-explanation-body .katex'));
		assert.equal(material.sourceText, 'Evidence: x is the measured value.'); assert.deepEqual(saved[0].contents.map(x => x.type), ['formula', 'table', 'image']); assert.equal(saved[0].contents[0].latex, 'x_i^2');
	});
	it('keeps AI explanation edits as a reviewable draft and passes no manuscript body', async function () {
		const material = {summary: '原说明', sourceText: 'Source: the analysis is limited to the reported data.'}, before = JSON.stringify(material), inputs = [];
		E.studio.request = async (system, input) => {inputs.push({system, input}); return {value: {summary: '解释仅针对论文报告的数据。'}};};
		const result = await Explanation.refineMaterialExplanation(E, material, material.summary); assert.equal(result, '解释仅针对论文报告的数据。'); assert.equal(JSON.stringify(material), before);
		assert.include(inputs[0].system, '不写、续写或改写论文正文'); assert.notProperty(inputs[0].input, 'blocks'); assert.notProperty(inputs[0].input, 'manuscript');
	});
	it('retains unsaved edits across detail remounts, and releases the dirty guard after saving', async function () {
		const material = {id: 'draft-reopen', summary: '原说明', sourceText: 'Immutable source'}, testE = {...E, manuscripts: {...E.manuscripts, summaryFor: m => m.summary}};
		let control = Explanation.renderMaterialExplanationEditor(host, material, {E: testE, onSave: async patch => patch}); control.edit();
		const input = host.querySelector('[aria-label="中文素材说明"]'); input.value = '未保存的用户修改'; input.dispatchEvent(new frame.contentWindow.Event('input', {bubbles: true})); assert.isTrue(control.isDirty()); control.dispose();
		control = Explanation.renderMaterialExplanationEditor(host, material, {E: testE, onSave: async patch => patch}); disposer = control.dispose;
		assert.equal(host.querySelector('[aria-label="中文素材说明"]').value, '未保存的用户修改'); assert.equal(material.summary, '原说明'); click(host, '保存'); await wait(() => material.summary === '未保存的用户修改'); assert.isFalse(control.isDirty());
	});
	it('separates hover enlargement, single-click fullscreen and double-click location', async function () {
		const doc = frame.contentDocument, image = doc.createElement('img'), calls = []; host.append(image); image.src = await E.previewImage('fixture');
		disposer = Preview.installMediaPreview(image, {onLocate: () => calls.push('location'), hoverDelay: 10});
		image.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter')); await wait(() => doc.querySelector('.research-media-hover')); assert.notExists(doc.querySelector('.research-media-modal'));
		image.click(); await wait(() => doc.querySelector('.research-media-modal')); doc.querySelector('.research-media-modal').close();
		image.click(); image.dispatchEvent(new frame.contentWindow.MouseEvent('dblclick', {bubbles: true, cancelable: true})); await wait(() => calls.length === 1); await Zotero.Promise.delay(250); assert.notExists(doc.querySelector('.research-media-modal'));
	});
});
