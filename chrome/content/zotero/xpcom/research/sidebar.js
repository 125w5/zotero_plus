/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	const presets = {
		'日常整理': ['title', 'firstCreator', 'year', 'research_tags', 'research_impact_factor', 'research_journalTags', 'dateAdded'],
		'文献筛选': ['title', 'year', 'research_impact_factor', 'research_jcr_quartile', 'research_cas_large_category', 'research_metricInfo', 'research_relevance'],
		'组会准备': ['title', 'research_reading', 'research_question', 'research_meeting', 'research_ppt']
	};
	R.applyView = function (win, keys) {
		let tree = win.ZoteroPane.itemsView, prefs = { ...tree._getColumnPrefs() };
		for (let col of tree.getColumns()) {
			// Preserve third-party columns and their independent settings.
			if (col.pluginID) continue;
			prefs[col.dataKey] = { ...prefs[col.dataKey], hidden: !keys.includes(col.dataKey),
				ordinal: keys.includes(col.dataKey) ? keys.indexOf(col.dataKey) : 100 + (col.ordinal || 0) };
		}
		tree._storeColumnPrefs(prefs);
		tree._rowCache = {};
		// Rebuild cell DOM only after React has applied the new column order.
		return new Promise(resolve => tree.forceUpdate(() => { tree.tree?.invalidate(); resolve(); }));
	};
	R.addViewMenu = function (win) {
		let menu = win.document.createXULElement('menu');
		menu.id = 'easysch-views'; menu.setAttribute('label', '科研文献视图');
		let popup = win.document.createXULElement('menupopup'); menu.append(popup);
		for (let [label, keys] of Object.entries(presets)) {
			let option = win.document.createXULElement('menuitem'); option.setAttribute('label', label);
			option.addEventListener('command', () => R.applyView(win, keys)); popup.append(option);
		}
		win.document.getElementById('menu_ToolsPopup')?.append(menu);
	};
	R.registerSidebar = function () {
		R.sidebarID = Zotero.ItemPaneManager.registerSection({
			paneID: 'research-workstation', pluginID: R.id,
			header: { l10nID: 'easysch-section', icon: 'chrome://zotero/skin/20/universal/note.svg' },
			sidenav: { l10nID: 'easysch-sidenav', icon: 'chrome://zotero/skin/20/universal/note.svg' },
			onItemChange: ({ item, setEnabled }) => setEnabled(!!item && (item.isRegularItem() || item.isAttachment())),
			onRender: ({ doc, body, item }) => R.renderSidebar(doc, body, item)
		});
		if (!R.sidebarID) throw new Error('科研侧栏注册失败');
	};
	R.renderSidebar = function (doc, body, originalItem) {
		body.replaceChildren();
		let item = originalItem?.parentID ? Zotero.Items.get(originalItem.parentID) : originalItem;
		if (!item) return;
		let el = (tag, text) => { let n = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); if (text) n.textContent = text; return n; };
		let box = el('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:12px;min-width:0';
		box.dataset.researchItem = String(item.id);
		let status = el('p'); status.setAttribute('role', 'status');
		let result = el('div'); result.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:65vh;overflow:auto';
		let regular = item.isRegularItem();
		let action = (label, fn) => {
			let button = el('button', label);
			button.addEventListener('click', async () => {
				button.disabled = true;
				try { await fn(); } catch (e) { status.textContent = e.message; }
				finally { button.disabled = false; }
			}); box.append(button); return button;
		};
		box.append(el('strong', '精读 · 证据 · 组会'));
		if (regular) {
			let label = el('label', '阅读状态 '), reading = el('select');
			for (let value of ['未读', '粗读', '精读', '已完成']) { let o = el('option', value); o.value = value; reading.append(o); }
			reading.value = R.field(item, 'research_reading'); reading.disabled = !item.library.editable;
			reading.addEventListener('change', () => R.saveState(item, { reading: reading.value }).catch(e => { status.textContent = e.message; }));
			label.append(reading); box.append(label);
			let metricLabel = el('small'); box.append(metricLabel);
			box._updateResearch = () => {
				reading.value = R.field(item, 'research_reading');
				let metric = R.metrics.get(R.issn(item))?.[0];
				metricLabel.textContent = metric ? `IF ${metric.impact_factor ?? '—'} · ${metric.metric_year} · ${metric.source}\n中科院 ${metric.cas_large_category || '—'} / JCR ${metric.jcr_quartile || '—'}\n获取时间 ${R.formatTime(metric.fetched_at)}` : '期刊指标尚无已核验数据。可导入含 ISSN、年份及来源的指标。';
			};
			box._updateResearch();
			action('导入期刊指标 JSON', async () => {
				let path = await R.pick(doc.defaultView, '导入期刊指标', 'file', 'json'); if (!path) return;
				if ((await IOUtils.stat(path)).size > 5 * 1024 * 1024) throw new Error('指标文件超过 5 MB');
				let records = JSON.parse(await IOUtils.readUTF8(path));
				if (!Array.isArray(records) || records.length > 10000) throw new Error('需要最多 10000 条指标的 JSON 数组');
				await R.saveMetrics(records); R.renderSidebar(doc, body, originalItem);
			});
			let yearLabel = el('label', '指标年份（核对后填写） '), year = el('input');
			year.type = 'number'; year.min = '1900'; year.max = String(new Date().getFullYear()); year.style.width = '6em'; yearLabel.append(year); box.append(yearLabel);
			action('查询 easyScholar 并预览', async () => {
				let data = await R.lookupMetrics(item, Number(year.value));
				result.replaceChildren(el('p', `按期刊名称匹配：${item.getField('publicationTitle')}。请核对 ISSN 与数据年份；API 未提供历史年份查询保证。`), el('pre', JSON.stringify(data, null, 2)));
				let save = el('button', '已核对期刊和年份，保存指标');
				save.addEventListener('click', async () => { try { await R.saveMetrics([data]); status.textContent = '指标已保存'; save.disabled = true; } catch (e) { status.textContent = e.message; } }); result.append(save);
			});
			let details = el('details'); details.append(el('summary', '课题与组会状态'));
			let inputs = {};
			for (let [key, title] of [['correspondingAuthor', '通讯作者'], ['importance', '重要程度'], ['relevance', '课题相关度'], ['topic', '研究方向'], ['method', '研究方法'], ['evidence', '证据强度'], ['question', '待解问题'], ['meeting', '组会状态'], ['ppt', 'PPT 状态'], ['cited', '写作引用'], ['rating', '评分']]) {
				let label = el('label', title + ' '), input = el('input'); input.value = R.field(item, 'research_' + key); input.maxLength = 500; input.style.width = '100%'; input.disabled = !item.library.editable; label.append(input); details.append(label); inputs[key] = input;
			}
			let saveState = el('button', '保存科研状态'); saveState.disabled = !item.library.editable;
			saveState.addEventListener('click', async () => { try { await R.saveState(item, Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, n.value]))); status.textContent = '科研状态已保存'; } catch (e) { status.textContent = e.message; } }); details.append(saveState); box.append(details);
			let prompt = el('textarea'); prompt.placeholder = '针对这篇论文提问，或填写翻译的原文'; prompt.setAttribute('aria-label', '论文问题或待翻译原文'); box.append(prompt);
			action('有道翻译', async () => {
				let translation = await R.translateYoudao(prompt.value);
				result.replaceChildren(el('small', '有道智云 · ' + R.formatTime(translation.at)), el('p', translation.text));
			});
			for (let [label, mode] of [['结构化速读', 'analyze'], ['术语与段落翻译', 'translate'], ['边读边问', 'ask']]) {
				action(label, async () => {
					let record = await R.ai.run({ papers: [R.library.describe(item)], mode,
						prompt: prompt.value, onStatus: text => { status.textContent = text; } });
					if (!box.isConnected) return;
					result.replaceChildren(el('small', `${record.model} · ${record.at}`));
					for (let section of record.result.sections) {
						result.append(el('h4', section.heading), el('p', section.body));
						for (let id of section.sources) {
							let source = record.sources.find(s => s.id === id), button = el('button', source.label);
							button.title = source.text; button.addEventListener('click', () => R.library.openSource(source).catch(e => { status.textContent = e.message; })); result.append(button);
						}
					}
					status.textContent = record.warnings.join('\n') || '已生成，请核对原文证据';
				});
			}
			action('取消分析', () => R.ai.cancel());
		}
		if (originalItem.isAttachment() && originalItem.attachmentContentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
			action('读取 DOCX / 建立全文索引', async () => {
				await Zotero.Fulltext.indexItems([originalItem.id]);
				const { extractDOCX } = ChromeUtils.importESModule(R.rootURI + 'docx.mjs');
				let data = await extractDOCX(await originalItem.getFilePathAsync());
				status.textContent = `${data.paragraphs.length} 段 · ${data.tables.length} 表 · ${data.citations.length} 引用字段`;
				result.textContent = data.text.slice(0, 30000);
			});
		}
		action('打开科研工作台 / 组会 / 写作', () => R.open({ paperID: item.id }));
		box.append(status, result); body.append(box);
	};
})(Zotero.Research);
