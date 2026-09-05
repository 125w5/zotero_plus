/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	let nextRequest = 0, queue = Promise.resolve();
	const cached = new Map();
	async function request(url, spacing = 400) {
		let result = queue.then(async () => {
			let delay = nextRequest - Date.now(); if (delay > 0) await Zotero.Promise.delay(delay);
			nextRequest = Date.now() + spacing;
			return R.requestProvider(url);
		});
		queue = result.catch(() => {}); return result;
	}
	const parse = text => new (Zotero.getMainWindow().DOMParser)().parseFromString(text, 'application/xml');
	const text = (node, selector) => node.querySelector(selector)?.textContent.trim() || '';
	R.searchAcademic = async function (query, source = 'pubmed') {
		query = String(query).trim(); if (!query || query.length > 300) throw new Error('请输入 1–300 字符检索词');
		let key = source + ':' + query;
		if (cached.has(key) && Date.now() - cached.get(key).at < 300000) return cached.get(key).results;
		let results;
		if (source === 'pubmed') {
			let base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
			let search = JSON.parse(await request(base + 'esearch.fcgi?db=pubmed&retmode=json&retmax=10&term=' + encodeURIComponent(query)));
			let ids = search.esearchresult?.idlist;
			if (!Array.isArray(ids)) throw new Error('PubMed 返回格式异常');
			if (!ids.length) return [];
			let doc = parse(await request(base + 'efetch.fcgi?db=pubmed&retmode=xml&id=' + ids.join(',')));
			results = [...doc.querySelectorAll('PubmedArticle')].map(article => {
				let id = text(article, 'PMID');
				return { source: 'PubMed', id, title: text(article, 'ArticleTitle'),
					abstract: [...article.querySelectorAll('AbstractText')].map(n => n.textContent).join('\n'),
					journal: text(article, 'Journal > Title'), issn: text(article, 'ISSN'),
					date: ['Year', 'Month', 'Day'].map(k => text(article, 'PubDate > ' + k)).filter(Boolean).join(' '),
					doi: text(article, 'ArticleId[IdType="doi"]'), url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
					authors: [...article.querySelectorAll('Author')].map(a => ({ firstName: text(a, 'ForeName'), lastName: text(a, 'LastName') || text(a, 'CollectiveName') })).filter(a => a.lastName) };
			});
		}
		else if (source === 'arxiv') {
			let terms = query.replace(/["\\]/g, ' ').split(/\s+/).filter(Boolean).map(term => 'all:"' + term + '"').join(' AND ');
			let doc = parse(await request('https://export.arxiv.org/api/query?search_query=' + encodeURIComponent(terms) + '&start=0&max_results=10&sortBy=relevance', 3100));
			results = [...doc.querySelectorAll('entry')].map(entry => ({ source: 'arXiv',
				id: text(entry, 'id').split('/abs/')[1], title: text(entry, 'title').replace(/\s+/g, ' '),
				abstract: text(entry, 'summary'), date: text(entry, 'published').slice(0, 10),
				url: text(entry, 'id').replace('http:', 'https:'),
				doi: entry.getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'doi')[0]?.textContent || '',
				pdf: [...entry.querySelectorAll('link')].find(n => n.getAttribute('title') === 'pdf')?.getAttribute('href')?.replace('http:', 'https:'),
				authors: [...entry.querySelectorAll('author > name')].map(n => ({ firstName: '', lastName: n.textContent.trim(), fieldMode: 1 }))
			})).filter(r => r.id);
		}
		else throw new Error('不支持的检索源');
		cached.set(key, { results, at: Date.now() }); return results;
	};
	R.importAcademicPDF = async function (record) {
		let url = new URL(record.pdf);
		if (url.protocol !== 'https:' || url.hostname !== 'arxiv.org') throw new Error('只下载 arXiv 官方开放 PDF');
		let saved = await R.importAcademic(record), item = Zotero.Items.get(saved.id);
		let attachment = await item.getBestAttachment();
		if (!attachment?.isPDFAttachment()) attachment = await Zotero.Attachments.importFromURL({ url: url.href, parentItemID: item.id, contentType: 'application/pdf' });
		if (!attachment) throw new Error('PDF 下载失败；题录已保留，可点击原址下载');
		await Zotero.Reader.open(attachment.id);
	};
	R.importAcademic = async function (record) {
		let pane = Zotero.getActiveZoteroPane(), libraryID = pane.getSelectedLibraryIDs()[0] || Zotero.Libraries.userLibraryID;
		if (!Zotero.Libraries.get(libraryID).editable) throw new Error('目标文库只读');
		let search = new Zotero.Search(); search.libraryID = libraryID;
		search.addCondition(record.doi ? 'DOI' : 'url', 'is', record.doi || record.url);
		let existing = await search.search(); if (existing.length) { await pane.selectItem(existing[0], { noTabSwitch: true }); return { id: existing[0], existing: true }; }
		let item = new Zotero.Item(record.source === 'PubMed' ? 'journalArticle' : 'preprint'); item.libraryID = libraryID;
		for (let [field, value] of Object.entries({ title: record.title, abstractNote: record.abstract, date: record.date, DOI: record.doi, url: record.url })) if (value) item.setField(field, value);
		if (record.source === 'PubMed') { if (record.journal) item.setField('publicationTitle', record.journal); if (record.issn) item.setField('ISSN', record.issn); item.setField('extra', 'PMID: ' + record.id); }
		else { item.setField('repository', 'arXiv'); item.setField('archiveID', record.id); }
		item.setCreators(record.authors.map(a => ({ ...a, creatorType: 'author' })));
		let collection = pane.getSelectedCollections()[0]; if (collection) item.setCollections([collection.id]);
		await item.saveTx(); await pane.selectItem(item.id, { noTabSwitch: true }); return { id: item.id, existing: false };
	};
})(Zotero.Research);
