/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	let nextRequest = 0, queue = Promise.resolve();
 const imports=new Map(),Screen=ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-screening.mjs');
 R.resolveAcademicTarget=async function(options={}){
  const pane=Zotero.getActiveZoteroPane(),explicit=Object.hasOwn(options,'collectionID'),chosen=explicit?options.collectionID:pane.getSelectedCollections?.()[0]?.id;
  let collection=null;if(chosen!=null&&chosen!==false){const id=Number(chosen);if(!Number.isInteger(id)||id<=0)throw Error('请选择有效的论文文件夹');collection=await Zotero.Collections.getAsync(id);if(!collection||collection.deleted)throw Error('论文文件夹已删除或不可用，请重新选择');}
  const libraryID=Number(options.libraryID||collection?.libraryID||pane.getSelectedLibraryIDs()[0]||Zotero.Libraries.userLibraryID),library=Zotero.Libraries.get(libraryID);
  if(!library?.editable)throw Error('目标文库只读');if(collection&&collection.libraryID!==libraryID)throw Error('论文文件夹与目标文库不一致');
  return{libraryID,collectionID:collection?.id||null,collectionName:collection?.name||''};
 };
 const collectionInfo=collection=>{const names=[collection.name],seen=new Set([collection.id]);let parent=collection.parentID&&Zotero.Collections.get(collection.parentID);while(parent&&!seen.has(parent.id)){seen.add(parent.id);names.unshift(parent.name);parent=parent.parentID&&Zotero.Collections.get(parent.parentID);}return{id:collection.id,name:collection.name,libraryID:collection.libraryID,parentID:collection.parentID||null,path:names.join(' / ')};};
 R.discoveryCollections=async function({libraryID=Zotero.Libraries.userLibraryID}={}){const library=Zotero.Libraries.get(libraryID);if(!library?.editable)throw Error('目标文库只读');return{libraryID,collections:Zotero.Collections.getByLibrary(libraryID,true,false).map(collectionInfo)};};
 R.createDiscoveryCollection=async function(name,{parentID=null,libraryID=Zotero.Libraries.userLibraryID}={}){
  name=String(name||'').trim();if(!name||name.length>200)throw Error('文件夹名称需要为 1–200 个字符');const target=await R.resolveAcademicTarget({libraryID,collectionID:parentID}),collection=new Zotero.Collection();collection.libraryID=target.libraryID;collection.name=name;if(target.collectionID)collection.parentID=target.collectionID;await collection.saveTx();return collectionInfo(collection);
 };
 R.placeAcademicInCollection=async function(itemID,options={}){const target=await R.resolveAcademicTarget(options);if(!target.collectionID)return target;let item=await Zotero.Items.getAsync(itemID);if(item?.parentID)item=await Zotero.Items.getAsync(item.parentID);if(!item||item.deleted||item.libraryID!==target.libraryID)throw Error('论文与目标文件夹不在同一个文库');if(!item.getCollections().includes(target.collectionID)){item.addToCollection(target.collectionID);await item.saveTx({skipSelect:true});}return target;};
 R.screenPaper=Screen.screenPaper;
 R.duplicatePaperSuggestions=async()=>{const groups=new Map(),items=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false);for(const item of items){if(!item.isRegularItem()||item.deleted)continue;const key=Screen.paperIdentity({doi:item.getField('DOI'),url:item.getField('url')});if(!key)continue;const identity=key.replace(/^(arxiv:.*)v\d+$/,'$1');if(!groups.has(identity))groups.set(identity,[]);groups.get(identity).push({id:item.id,title:item.getField('title')});}return [...groups.entries()].filter(([,items])=>items.length>1).map(([identity,items])=>({identity,items}));};
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
	// Import and the reference pane's full-text check share one duplicate rule.
	async function findRecord(record, libraryID) {
		let identity=Screen.paperIdentity(record);if(identity?.startsWith('arxiv:')){let base=identity.slice(6).replace(/v\d+$/,'');let byURL=new Zotero.Search();byURL.libraryID=libraryID;byURL.addCondition('url','contains','arxiv.org/abs/'+base);let matches=await Zotero.Items.getAsync(await byURL.search());let found=matches.find(x=>x.isRegularItem()&&!x.deleted&&Screen.paperIdentity({url:x.getField('url')})?.replace(/v\d+$/,'')==='arxiv:'+base);if(found)return found;}
		let doi=Screen.doiKey(record.doi);if(!doi&&!record.url)return null;let search=new Zotero.Search();search.libraryID=libraryID;search.addCondition(doi?'DOI':'url','is',doi||record.url);
		let existing=await Zotero.Items.getAsync(await search.search());return existing.find(item=>item.isRegularItem()&&!item.deleted)||null;
	}
	R.findAcademicItem=async function(record,options={}){let target=await R.resolveAcademicTarget(options);return findRecord(record,target.libraryID);};
	async function importRecord(record, options = {}) {
		const {select=true}=options,target=await R.resolveAcademicTarget(options);let pane=Zotero.getActiveZoteroPane(),libraryID=target.libraryID;
		const reuse=async found=>{await R.placeAcademicInCollection(found.id,{libraryID,collectionID:target.collectionID});if(select)await pane.selectItem(found.id,{noTabSwitch:true});return{id:found.id,existing:true,...target};};
		let found=await findRecord(record,libraryID);if(found)return reuse(found);
		if(!Screen.doiKey(record.doi)&&!record.url)throw Error('缺少 DOI 或可核验来源网址，无法判重入库');
		let item = new Zotero.Item(record.source === 'arXiv' ? 'preprint' : 'journalArticle'); item.libraryID = libraryID;
		for (let [field, value] of Object.entries({ title: record.title, abstractNote: record.abstract, date: record.date, DOI: record.doi, url: record.url })) if (value) item.setField(field, value);
		if (record.source !== 'arXiv') { if (record.journal) item.setField('publicationTitle', record.journal); if (record.issn) item.setField('ISSN', record.issn); if(record.source==='PubMed')item.setField('extra', 'PMID: ' + record.id); }
		else { item.setField('repository', 'arXiv'); item.setField('archiveID', record.id); }
		item.setCreators((record.authors||[]).map(a => ({ ...a, creatorType: 'author' })));
		if(target.collectionID)item.setCollections([target.collectionID]);
		await item.saveTx({skipSelect:!select});if(select)await pane.selectItem(item.id,{noTabSwitch:true});return{id:item.id,existing:false,...target};
	};
 R.importAcademic=async function(record,options={}){const target=await R.resolveAcademicTarget(options),key=target.libraryID+':'+Screen.paperIdentity(record);let task=imports.get(key);if(!task){task=importRecord(record,{...options,...target});imports.set(key,task);task.finally(()=>imports.delete(key)).catch(()=>{});}const result=await task;await R.placeAcademicInCollection(result.id,target);return{...result,...target};};
})(Zotero.Research);
