(function (E) {
	let Z = E.library = {};
	Z.describe = item => ({
		id: item.id, libraryID: item.libraryID, key: item.key, title: item.getField('title') || '(无标题)',
		authors: item.getCreators().map(c => [c.firstName, c.lastName].filter(Boolean).join(' ')).join(', '),
		year: item.getField('date'), journal: item.getField('publicationTitle'), doi: item.getField('DOI'),
		tags: item.getTags().map(t => t.tag), related: item.relatedItems || [],
		citeKey: E.core.citeKey(item)
	});
	Z.selection = function () {
		let selected = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
		let items = selected.map(item => item.parentID ? Zotero.Items.get(item.parentID) : item)
			.filter(item => item?.isRegularItem());
		return [...new Map(items.map(item => [item.id, item])).values()].map(Z.describe);
	};
	Z.uri = function (item, pageIndex) {
		let library = Zotero.Libraries.get(item.libraryID);
		let scope = library.libraryType === 'group' ? `groups/${library.groupID}` : 'library';
		let type = item.isAttachment() ? 'open-pdf' : 'select';
		return `zotero://${type}/${scope}/items/${item.key}`
			+ (Number.isInteger(pageIndex) && pageIndex >= 0 ? `?page=${pageIndex + 1}` : '');
	};
	Z.sources = async function (papers, selection) {
		let sources = [], warnings = [];
		let budget = Math.floor(60000 / Math.max(1, papers.length));
		for (let [index, paper] of papers.entries()) {
			let item = await Zotero.Items.getAsync(paper.id);
			let prefix = `P${index + 1}`;
			sources.push({ id: `${prefix}-M`, paperKey: E.core.paperKey(paper),
				label: paper.title, text: JSON.stringify({ title: paper.title, authors: paper.authors,
					journal: paper.journal, date: paper.year, DOI: paper.doi,
					abstract: item.getField('abstractNote') }).slice(0, 6000), uri: Z.uri(item) });
			if (selection?.paperID === paper.id) {
				let attachment = Zotero.Items.get(selection.attachmentID);
				sources.push({ id: `${prefix}-S`, paperKey: E.core.paperKey(paper), label: '当前选段',
					text: selection.text.slice(0, 12000), uri: Z.uri(attachment, selection.pageIndex),
					attachmentID: attachment.id, pageIndex: selection.pageIndex });
			}
			let attachments = await Zotero.Items.getAsync(item.getAttachments());
			let pdf = attachments.find(a => a.isPDFAttachment());
			if (!pdf) { warnings.push(`${paper.title}：无 PDF，使用元数据和摘要。`); continue; }
			let used = 0;
			for (let annotation of pdf.getAnnotations().slice(0, 25)) {
				let text = [annotation.annotationText, annotation.annotationComment].filter(Boolean).join('\n');
				if (!text) continue;
				let position;
				try { position = JSON.parse(annotation.annotationPosition); } catch (_) { position = {}; }
				let chunk = text.slice(0, Math.min(2500, Math.max(0, budget / 3 - used)));
				if (!chunk) break;
				used += chunk.length;
				sources.push({ id: `${prefix}-A${annotation.key}`, paperKey: E.core.paperKey(paper),
					label: `批注 · ${annotation.annotationPageLabel || '页码未知'}`, text: chunk,
					uri: Z.uri(pdf, position.pageIndex), attachmentID: pdf.id, pageIndex: position.pageIndex });
			}
			try {
				let { text } = await Zotero.PDFWorker.getFullText(pdf.id, null);
				if (!text?.trim()) { warnings.push(`${paper.title}：PDF 无可提取文字，扫描件需先 OCR。`); continue; }
				let remaining = budget - used;
				// Sample across the whole paper instead of dropping results at the end.
				let count = Math.max(1, Math.ceil(remaining / 3500));
				let size = Math.floor(remaining / count);
				for (let n = 0; n < count; n++) {
					let start = text.length <= remaining ? n * size : Math.floor(n * (text.length - size) / Math.max(1, count - 1));
					let chunk = text.slice(start, start + size);
					if (!chunk.trim()) continue;
					sources.push({ id: `${prefix}-T${n + 1}`, paperKey: E.core.paperKey(paper),
						label: `正文片段 ${n + 1}（定位到附件）`, text: chunk, uri: Z.uri(pdf), attachmentID: pdf.id });
				}
				if (text.length > remaining) warnings.push(`${paper.title}：超出上下文预算，已跨全文取样；结果不代表逐页完整审查。`);
			}
			catch (_) { warnings.push(`${paper.title}：PDF 提取失败，请检查文件是否已下载或加密。`); }
		}
		return { sources, warnings };
	};
	Z.openSource = async source => {
		if (source.attachmentID) {
			await Zotero.Reader.open(source.attachmentID,
				Number.isInteger(source.pageIndex) ? { pageIndex: source.pageIndex } : undefined);
		}
		else Zotero.launchURL(source.uri);
	};
	Z.note = async function (paper, record) {
		let parent = await Zotero.Items.getAsync(paper.id);
		if (!Zotero.Libraries.get(parent.libraryID).editable) throw new Error('当前资料库只读');
		let h = E.core.escapeHTML;
		let body = `<h1>EasySch · ${h(paper.title)}</h1><p>AI 辅助分析，请核对原文。</p>`;
		for (let section of record.result.sections) {
			body += `<h2>${h(section.heading)}</h2><p>${h(section.body).replace(/\n/g, '<br/>')}</p><p>`;
			body += section.sources.map(id => {
				let source = record.sources.find(s => s.id === id);
				return `<a href="${h(source.uri)}">${h(source.label)} [${h(id)}]</a>`;
			}).join(' · ') + '</p>';
		}
		let note = new Zotero.Item('note');
		note.libraryID = parent.libraryID;
		note.parentID = parent.id;
		note.setNote(body);
		await note.saveTx();
		return note.id;
	};
	Z.addTags = async function (paper, tags) {
		let item = await Zotero.Items.getAsync(paper.id);
		if (!Zotero.Libraries.get(item.libraryID).editable) throw new Error('当前资料库只读');
		for (let tag of tags) item.addTag(tag);
		await item.saveTx();
	};
	Z.bibliography = async function (papers) {
		return Promise.all(papers.map(async paper => {
			let item = await Zotero.Items.getAsync(paper.id);
			let csl = Zotero.Utilities.Item.itemToCSLJSON(item);
			csl.id = paper.citeKey;
			return csl;
		}));
	};
	Z.biblatex = async function (papers) {
		let translator = new Zotero.Translate.Export();
		let available = await translator.getTranslators();
		let chosen = available.find(t => t.label === 'Better BibLaTeX')
			|| available.find(t => t.label === 'BibLaTeX');
		if (!chosen) throw new Error('未找到 BibLaTeX translator，请检查 Zotero 转换器安装');
		translator.setTranslator(chosen.translatorID);
		translator.setItems(await Zotero.Items.getAsync(papers.map(p => p.id)));
		await translator.translate();
		return { text: translator.string, translator: chosen.label };
	};
	E.credentials = {
		async all(endpoint) {
			return (await Services.logins.getAllLogins()).filter(login =>
				login.hostname === 'chrome://easysch' && login.httpRealm === endpoint);
		},
		async get(endpoint) { return (await this.all(endpoint))[0]?.password || ''; },
		async set(endpoint, key) {
			for (let login of await this.all(endpoint)) {
				if (Services.logins.removeLoginAsync) await Services.logins.removeLoginAsync(login);
				else Services.logins.removeLogin(login);
			}
			if (!key) return;
			let login = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
			login.init('chrome://easysch', null, endpoint, 'API Key', key, '', '');
			await Services.logins.addLoginAsync(login);
		}
	};
})(EasySch);
