/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Assembly material clues in native Zotero', function () {
	this.timeout(90000);
	let win, frame, ui, project, paper, attachment, otherAttachment, folder;
	let material, otherMaterial, delayedMaterial, abstractMaterial, noteMaterial, sourceNote, firstBlock, secondBlock, sandbox, pageStub;
	const R = Zotero.Research;
	const normalImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jX8AAAAASUVORK5CYII=';
	const staleImage = normalImage + '#stale-thumbnail';
	const report = {
		type: '真实 Zotero 中央标签页及 DOM 自动测试；素材、来源定位和缩略图使用受控夹具。不是真人前台、真实模型或联网验收。',
		checks: [],
	};
	const clone = value => JSON.parse(JSON.stringify(value));
	const wait = async (fn, message = '等待装配界面', attempts = 200) => {
		for (let i = 0; i < attempts; i++) {
			if (await fn()) return;
			await Zotero.Promise.delay(50);
		}
		throw Error(message + '超时：' + (ui?.$('status')?.textContent || ''));
	};
	async function openProject() {
		await R.manuscripts.open(project.id);
		await wait(() => {
			frame = win.document.getElementById('manuscript-' + project.id);
			ui = frame?.contentWindow.ManuscriptUI;
			return ui?.ready;
		});
	}
	async function selectMaterial(value) {
		if (ui.p.ui.left !== 'materials') {
			ui.p.ui.left = 'materials';
			ui.renderLibrary();
		}
		const card = ui.$('library').querySelector('[data-material="' + value.id + '"]');
		assert.exists(card, '左侧显示验收素材：' + value.title);
		card.click();
		await wait(() => ui.$('details').dataset.materialId === value.id
			&& ui.$('details').querySelector('.material-clues'), '素材线索显示');
		await wait(() => R.notebook.state(project.id).selectedMaterial === value.id, '共享选中状态保存');
	}
	function assertExplanation(value) {
		const explanation = ui.$('details').querySelector('.material-explanation-body');
		assert.exists(explanation, '独立中文说明区保留');
		assert.include(explanation.textContent, value.summary, '当前素材的完整中文说明可见');
		assert.isAbove(explanation.getBoundingClientRect().height, 0, '中文说明无需展开原文即可阅读');
		assert.isFalse(ui.$('details').querySelector('.material-clues').textContent.includes(value.summary), '原文区不重复说明');
		return explanation;
	}
	function anchor(pageIndex, quote, rect) {
		return {
			paperItemID: paper.id,
			attachmentID: attachment.id,
			citationItemID: paper.id,
			pageIndex,
			position: {pageIndex, rects: [rect]},
			sourceText: quote,
			sourceVersion: 'controlled-native-clues-v1',
		};
	}
	async function capture(name) {
		const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		canvas.getContext('2d').drawImage(image, 0, 0);
		const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
		await IOUtils.write(PathUtils.join(folder, name), new Uint8Array(await blob.arrayBuffer()));
		image.close();
	}
	before(async () => {
		win = await loadZoteroPane();
		win.Zotero_Tabs.closeAll();
		win.focus();
		win.resizeTo(1450, 950);
		await R.attachWindow(win);
		folder = PathUtils.join(Zotero.DataDirectory.dir, 'material-clues-acceptance');
		await IOUtils.makeDirectory(folder, {ignoreExisting: true});
		sandbox = sinon.createSandbox();
		// Imported attachments are real Zotero records. Their semantic excerpts and
		// positions below are test fixtures, so indexing/model jobs stay disabled.
		if (R.manuscripts.queueArticle) sandbox.stub(R.manuscripts, 'queueArticle').resolves();
		if (R.manuscripts.queueTranslation) sandbox.stub(R.manuscripts, 'queueTranslation').resolves();
		if (R.manuscripts.ensureChineseSummaries) sandbox.stub(R.manuscripts, 'ensureChineseSummaries').resolves();
		if (R.quickTranslate) sandbox.stub(R, 'quickTranslate').callsFake(async text => ({text: '受控中文译文：' + text, provider: 'controlled'}));
		paper = await createDataObject('item', {
			itemType: 'journalArticle',
			title: '素材线索原生验收论文（受控夹具）',
			publicationTitle: '软件交互验收资料',
			date: '2026',
		});
		attachment = await importFileAttachment('wonderland_short.pdf', {parentID: paper.id});
		otherAttachment = await importFileAttachment('wonderland_short.pdf', {parentID: paper.id});
		const M = R.manuscripts.model;
		const anchors = [
			anchor(0, 'First controlled source excerpt; not an experimental result.', [60, 600, 210, 612]),
			anchor(0, 'A separate controlled excerpt on the same page.', [60, 550, 240, 564]),
			anchor(1, 'Second-page controlled source excerpt for precise navigation.', [80, 460, 270, 476]),
		];
		material = M.material({
			title: '受控验收素材 · 方法线索', kind: 'semantic', category: '方法',
			summary: '用于验证两页来源线索的中文说明，不代表真实实验结论。',
			paperTitle: paper.getField('title'), sourceText: anchors[0].sourceText,
			sourceVersion: 'controlled-native-clues-v1', userEdited: true,
			anchor: anchors[0], sourceAnchors: anchors,
		});
		otherMaterial = M.material({
			title: '受控验收素材 · 另一段', kind: 'semantic', category: '背景与问题',
			summary: '另一张素材的中文说明，用于检验选中与预览不会混淆。',
			paperTitle: paper.getField('title'), userEdited: true,
			anchor: anchor(1, 'A different material with its own source position.', [100, 350, 280, 365]),
			sourceVersion: 'controlled-native-clues-v1',
		});
		const delayedAnchor = {...anchor(2, 'Controlled delayed thumbnail excerpt.', [80, 500, 260, 516]),
			attachmentID: otherAttachment.id};
		delayedMaterial = M.material({
			title: '受控验收素材 · 延迟缩略图', kind: 'semantic', category: '方法',
			summary: '此素材用于验证过期缩略图不会写入另一张素材的详情。',
			paperTitle: paper.getField('title'), userEdited: true, anchor: delayedAnchor,
			sourceVersion: 'controlled-native-clues-v1',
		});
		abstractMaterial = M.material({
			title: '受控验收素材 · 外部摘要', kind: 'abstract', category: '背景与问题',
			summary: '只读到外部摘要的中文概括，不能当作全文结论。', userEdited: true,
			anchor: {sourceText: 'Controlled abstract only; no full text was retrieved.',
				url: 'https://example.org/controlled-abstract'},
		});
		sourceNote = new Zotero.Item('note');
		sourceNote.parentID = paper.id;
		sourceNote.setNote('<p>受控用户笔记，仅供来源类型验收。</p>');
		await sourceNote.saveTx();
		noteMaterial = M.material({
			title: '受控验收素材 · 关联论文的用户笔记', kind: 'note', category: '用户笔记',
			summary: '用户自己的理解，虽关联论文，但不属于论文原句。', userEdited: true,
			sourceItemID: sourceNote.id, paperTitle: paper.getField('title'),
			// Deliberately repeats an excerpt: identical words do not make a user's
			// note acquire the provenance of a PDF excerpt.
			anchor: anchors[0], sourceVersion: 'controlled-native-clues-v1',
		});
		project = await R.manuscripts.create('素材线索原生交互验收');
		firstBlock = M.block('paragraph', project.sections[0].id, {
			text: '第一段正文仅用于软件验收。',
			assembly: true,
			materials: [{id: material.id, role: 'primary', revision: material.revision}],
		});
		secondBlock = M.block('paragraph', project.sections[0].id, {
			text: '第二段正文仅用于软件验收。',
			materials: [{id: otherMaterial.id, role: 'primary', revision: otherMaterial.revision}],
		});
		project.materials = [material, otherMaterial, delayedMaterial, abstractMaterial, noteMaterial];
		project.blocks = [firstBlock, secondBlock];
		project.ui.blockID = firstBlock.id;
		project.ui.left = 'materials';
		project.ui.rightOpen = true;
		project = await R.manuscripts.save(project);
		// This isolated profile can already contain hundreds of genuine assets.
		// Use the shared Chinese query instead of relying on fixtures appearing
		// inside the first 50 results of an unfiltered material library.
		await R.notebook.update(project.id, {query: '受控验收素材'});
		pageStub = sandbox.stub(R.assets, 'page').callsFake(async ({attachmentID, pageIndex}) => ({
			path: 'controlled-page-' + attachmentID + '-' + pageIndex,
		}));
		sandbox.stub(R, 'previewImage').resolves(normalImage);
		await openProject();
	});
	after(async () => {
		try {
			report.projectID = project?.id;
			if (folder) await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
			if (frame?.parentElement) win.Zotero_Tabs.close(frame.parentElement.id);
			await R.store.flush();
			if (project) {
				const libraryItem = R.store.get('manuscriptLibrary', project.id)?.itemID;
				await R.store.update(state => {
					delete state.manuscripts?.[project.id];
					delete state.researchNotebooks?.[project.id];
					delete state.manuscriptLibrary?.[project.id];
				});
				if (libraryItem && Zotero.Items.get(libraryItem)) await Zotero.Items.get(libraryItem).eraseTx();
			}
			if (paper && Zotero.Items.get(paper.id)) await paper.eraseTx();
		}
		finally {
			sandbox?.restore();
			win?.close();
		}
	});
	it('previews the paper overview with a single source disclosure and complete two-page anchors without opening a reader', async () => {
		const tabs = win.Zotero_Tabs.numTabs;
		const readerOpen = sandbox.spy(Zotero.Reader, 'open');
		try {
			await selectMaterial(material);
			const clues = ui.$('details').querySelector('.material-clues');
			assertExplanation(material);
			assert.include(clues.textContent, paper.getField('title'));
			assert.lengthOf(clues.querySelectorAll('.clue-source'), 1, '同一论文只显示一个来源组');
			assert.lengthOf(clues.querySelectorAll('.clue-page'), 1, '只用一个原文与译文抽屉，不按页二级折叠');
			assert.lengthOf(clues.querySelectorAll('.material-source-page'), 2, '两页原文完整保留');
			for (const page of clues.querySelectorAll('.clue-page')) {
				assert.equal(page.tagName, 'DETAILS');assert.isFalse(page.open, '原文默认收起');
				assert.equal(page.querySelector('.clue-page-content').getBoundingClientRect().height, 0, '长摘录不挤占说明空间');
			}
			assert.lengthOf(clues.querySelectorAll('.clue-excerpt'), 3, '同页不同位置保留，重复主 anchor 去重');
			for (const source of material.sourceAnchors) assert.include(clues.textContent, source.sourceText);
			assert.isFalse(readerOpen.called, '普通单击不打开 PDF');
			assert.equal(win.Zotero_Tabs.numTabs, tabs, '普通预览不增加标签');
			assert.isAbove(clues.getBoundingClientRect().height, 0);
			await capture('01-material-source-clues-collapsed.png');
			assert.notInclude(clues.textContent,'处摘录','去掉冗余摘录计数');
			assert.notExists(clues.querySelector('details details'),'来源不再二级折叠');
			const beforeTranslations=R.quickTranslate.callCount,page=clues.querySelector('.clue-page');page.querySelector('summary').click();assert.isTrue(page.open);assert.isAbove(page.querySelector('.clue-page-content').getBoundingClientRect().height,0,'单击仍可展开完整原文');
			await wait(()=>clues.querySelectorAll('.material-source-translation').length===3,'同栏显示各处原文的中文译文');
			assert.equal(R.quickTranslate.callCount-beforeTranslations,3,'仅翻译三个真实摘录');
			for(const translation of clues.querySelectorAll('.material-source-translation'))assert.include(translation.textContent,'受控中文译文：');
			page.querySelector('summary').click();assert.isFalse(page.open);assert.isFalse(readerOpen.called,'折叠不打开阅读器');
			report.checks.push('原生DOM单击素材：中文说明、论文、两页三处原文线索；不打开PDF、不增加标签');
		}
		finally { readerOpen.restore(); }
	});
	it('keeps an unchanged-source check silent without adding a permanent status row', async () => {
		await selectMaterial(material);
		assert.isTrue(ui.$('status').hidden, '闲置状态无常驻提示');
		const originalText = ui.$('status').textContent;
		const refresh = sandbox.stub(R.manuscripts, 'refreshMaterial').resolves({sourceText: material.sourceText});
		try {
			// The source check sits directly in the material's action row.
			const maintenance = ui.$('details').querySelector('.material-maintenance-actions');
			assert.exists(maintenance, '素材操作行');
			const check = [...maintenance.querySelectorAll('button')].find(button => button.textContent === '核查来源');
			assert.exists(check);check.click();await wait(() => refresh.calledOnce, '受控来源检查');
			await Zotero.Promise.delay(50);
			assert.isTrue(ui.$('status').hidden);
			assert.equal(ui.$('status').textContent, originalText, '来源未变不产生无意义的成功提示');
			assert.equal(ui.p.materials.find(value => value.id === material.id).sourceText, material.sourceText);
			report.checks.push('受控来源检查：原文没有变化时保持安静，不新增常驻底栏提示');
		}
		finally { refresh.restore(); }
	});
	it('shows an external abstract as abstract-only and opens its actual URL', async () => {
		await selectMaterial(abstractMaterial);
		const clues = ui.$('details').querySelector('.material-clues');
		assert.exists(clues.querySelector('.clue-local-abstract'));
		assert.include(clues.textContent, '仅依据摘要');
		assert.include(clues.textContent, abstractMaterial.sourceText);
		assert.notExists(clues.querySelector('.clue-paper'), '无全文附件不伪装为 PDF 论文来源');
		assert.notInclude(clues.querySelector('.clue-heading').textContent, '处摘录');
		const open = sandbox.stub(Zotero, 'launchURL').returns(undefined);
		try {
			clues.querySelector('.clue-local-abstract [data-clue-open]').click();
			await wait(() => open.calledOnce, '打开外部摘要 URL');
			assert.equal(open.firstCall.args[0], abstractMaterial.anchor.url);
			report.checks.push('受控摘要来源：保留原文和仅依据摘要标记；来源动作指向真实保存URL');
		}
		finally { open.restore(); }
	});
	it('keeps a paper-linked user note separate from original paper excerpts', async () => {
		await selectMaterial(noteMaterial);
		const clues = ui.$('details').querySelector('.material-clues');
		assert.include(clues.textContent, '用户笔记，非论文原句');
		assert.include(clues.querySelector('.clue-heading').textContent, '用户笔记，非论文原句');
		assert.notInclude(clues.querySelector('.clue-heading').textContent, '条笔记', '去掉冗余笔记计数，仍明确来源边界');
		assert.notInclude(clues.querySelector('.clue-heading').textContent, '处摘录');
		assert.exists(clues.querySelector('.clue-excerpt .clue-local-text'));
		assert.notExists(clues.querySelector('.clue-excerpt .clue-quote'), '笔记不使用论文引文样式');
		const opened = sandbox.stub(R.manuscripts, 'openAnchor').resolves();
		try {
			const action = [...clues.querySelectorAll('button')].find(button => button.textContent === '打开来源笔记');
			assert.exists(action);action.click();await wait(() => opened.calledOnce, '打开来源笔记');
			assert.equal(opened.firstCall.args[0].sourceItemID, sourceNote.id);
			assert.isNull(opened.firstCall.args[0].anchor.attachmentID, '笔记入口打开笔记，不冒充论文位置');
			report.checks.push('受控用户笔记：论文关联保留；明确非论文原句、单独计数并打开原笔记');
		}
		finally { opened.restore(); }
	});
	it('keeps the exact second-page position when the user chooses source navigation', async () => {
		await selectMaterial(material);
		const opened = [];
		const source = sandbox.stub(R.library, 'openSource').callsFake(async value => { opened.push(clone(value)); });
		const expected = material.sourceAnchors[2];
		const location = ui.$('details').querySelector('.clue-excerpt [data-clue-open][data-page="1"]');
		assert.exists(location, '第二页定位按钮');
		try {
			location.click();
			await wait(() => opened.length === 1, '来源定位');
			assert.equal(opened[0].attachmentID, expected.attachmentID);
			assert.equal(opened[0].pageIndex, expected.pageIndex);
			assert.deepEqual(opened[0].position, clone(expected.position));
			assert.deepEqual(clone(ui.p.materials.find(value => value.id === material.id).sourceAnchors), material.sourceAnchors,
				'定位不改变来源关系');
			report.checks.push('受控来源打开：第二页attachmentID/pageIndex/rects准确，原始anchor保持不变');
		}
		finally { source.restore(); }
	});
	it('returns from module material clues to the same module and switches modules cleanly', async () => {
		ui.selectBlock(firstBlock.id);
		const sourceButton = ui.$('details').querySelector('[data-action="preview-material"][data-material-id="' + material.id + '"]');
		assert.exists(sourceButton, '当前模块来源素材可预览');
		sourceButton.click();
		await wait(() => ui.$('details').dataset.materialId === material.id, '模块来源预览');
		assert.equal(ui.p.ui.blockID, firstBlock.id, '查看来源保留当前模块');
		const back = ui.$('details').querySelector('[data-action="return-module"]');
		assert.exists(back, '可直接返回正文模块');
		back.click();
		await wait(() => !ui.previewMaterialID, '返回当前模块');
		assert.equal(ui.p.ui.blockID, firstBlock.id);
		assert.exists(ui.$('canvas').querySelector('[data-id="' + firstBlock.id + '"].selected'));
		ui.selectBlock(secondBlock.id);
		assert.equal(ui.p.ui.blockID, secondBlock.id);
		assert.notEqual(ui.$('details').dataset.materialId, material.id, '切换模块不残留其他素材选择');
		assert.exists(ui.$('canvas').querySelector('[data-id="' + secondBlock.id + '"].selected'));
		report.checks.push('原生DOM：模块来源点击→线索→返回同一模块；切换模块清除素材预览');
	});
	it('opens clues from a material frame title without bubbling into the enclosing block', async () => {
		ui.selectBlock(secondBlock.id);
		const title = ui.$('canvas').querySelector('[data-id="' + firstBlock.id
			+ '"] .material-caption [data-action="preview-material"][data-material-id="' + material.id + '"]');
		assert.exists(title, '素材框中的名称入口');
		title.click();
		await wait(() => ui.$('details').dataset.materialId === material.id, '素材框名称打开线索');
		assert.equal(ui.p.ui.blockID, firstBlock.id, '名称点击将后续操作关联到它所属的模块');
		const selectedCard = ui.$('library').querySelector('[data-material="' + material.id + '"]');
		assert.equal(selectedCard.getAttribute('aria-selected'), 'true', '正文框名称与左侧素材选择一致');
		assertExplanation(material);
		await wait(() => R.notebook.state(project.id).selectedMaterial === material.id && !ui.pendingMaterialSelection);
		ui.$('details').querySelector('[data-action="return-module"]').click();
		await wait(() => !ui.previewMaterialID && !ui.pendingMaterialSelection);
		assert.equal(ui.p.ui.blockID, firstBlock.id, '返回正文仍对应素材所属模块');
		report.checks.push('原生DOM：点击另一段的素材框名称打开线索；操作目标与返回位置都对应所属模块');
	});
	it('keeps the latest visible selection while an older notebook selection is still saving', async () => {
		ui.selectBlock(firstBlock.id);
		await wait(() => R.notebook.state(project.id).selectedMaterial === null && !ui.pendingMaterialSelection,
			'清除此前素材选中');
		const originalSelect = R.notebook.select;
		let releaseFirst, releaseSecond;
		const firstGate = new Promise(resolve => { releaseFirst = resolve; });
		const secondGate = new Promise(resolve => { releaseSecond = resolve; });
		const delayedSelect = sandbox.stub(R.notebook, 'select').callsFake(async (id, materialID) => {
			if (materialID === material.id) await firstGate;
			else if (materialID === otherMaterial.id) await secondGate;
			return originalSelect.call(R.notebook, id, materialID);
		});
		try {
			ui.$('library').querySelector('[data-material="' + material.id + '"]').click();
			ui.$('library').querySelector('[data-material="' + otherMaterial.id + '"]').click();
			assert.isTrue(delayedSelect.calledWith(project.id, material.id));
			assert.isTrue(delayedSelect.calledWith(project.id, otherMaterial.id));
			assert.equal(ui.$('details').dataset.materialId, otherMaterial.id, '新单击立即预览');
			releaseFirst();
			await wait(() => R.notebook.state(project.id).selectedMaterial === material.id, '较早选中的延迟保存');
			assert.equal(ui.$('details').dataset.materialId, otherMaterial.id,
				'旧保存通知到达时，不把右栏改回上一素材');
			assert.equal(ui.previewMaterialID, otherMaterial.id);
			releaseSecond();
			await wait(() => R.notebook.state(project.id).selectedMaterial === otherMaterial.id
				&& !ui.pendingMaterialSelection, '最新选中保存');
			assert.equal(ui.$('details').dataset.materialId, otherMaterial.id);
			assertExplanation(otherMaterial);
			report.checks.push('受控保存延迟：快速A→B单击，A保存通知不改回A，最终共享状态与右栏保持B');
		}
		finally {
			releaseFirst();
			releaseSecond();
			delayedSelect.restore();
			await R.store.flush();
		}
	});
	it('restores the selected material and source clues after closing and reopening the central tab', async () => {
		await selectMaterial(otherMaterial);
		await ui.persist();
		await R.store.flush();
		win.Zotero_Tabs.close(frame.parentElement.id);
		await openProject();
		await wait(() => ui.$('details').dataset.materialId === otherMaterial.id, '重开恢复选中素材');
		assertExplanation(otherMaterial);
		const card = ui.$('library').querySelector('[data-material="' + otherMaterial.id + '"]');
		assert.exists(card);
		assert.equal(card.getAttribute('aria-selected'), 'true');
		assert.equal(R.notebook.state(project.id).selectedMaterial, otherMaterial.id);
		report.checks.push('关闭重开原生中央标签：素材选中、左栏反馈与右栏来源线索恢复；不是进程重启验收');
	});
	it('discards an obsolete page thumbnail response after changing the selected material', async () => {
		let resolveThumbnail;
		const deferred = new Promise(resolve => { resolveThumbnail = resolve; });
		pageStub.callsFake(({attachmentID, pageIndex}) => attachmentID === otherAttachment.id && pageIndex === 2
			? deferred : Promise.resolve({path: 'controlled-page-' + attachmentID + '-' + pageIndex}));
		R.previewImage.callsFake(async path => path === 'controlled-stale-page' ? staleImage : normalImage);
		await selectMaterial(delayedMaterial);
		const oldRoot = ui.$('details').querySelector('.material-clues');
		const thumbnail = oldRoot.querySelector('.clue-thumbnail');
		assert.exists(thumbnail);
		oldRoot.querySelector('.clue-page summary').click();
		await wait(() => pageStub.getCalls().some(call => call.args[0].attachmentID === otherAttachment.id
			&& call.args[0].pageIndex === 2), '受控延迟缩略图请求');
		await selectMaterial(otherMaterial);
		const currentRoot = ui.$('details').querySelector('.material-clues');
		assert.isFalse(oldRoot.isConnected);
		resolveThumbnail({path: 'controlled-stale-page'});
		await Zotero.Promise.delay(150);
		assert.equal(ui.$('details').dataset.materialId, otherMaterial.id);
		assert.equal(ui.$('details').querySelector('.material-clues'), currentRoot);
		const explanation = assertExplanation(otherMaterial);
		assert.notInclude(explanation.textContent, delayedMaterial.summary);
		assert.isFalse([...currentRoot.querySelectorAll('img')].some(image => image.getAttribute('src') === staleImage));
		report.checks.push('受控延迟响应：旧素材缩略图被丢弃，不污染新素材详情');
	});
});
