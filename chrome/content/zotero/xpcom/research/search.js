/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	let nextRequest = 0, queue = Promise.resolve();
 let Resolver;const imports=new Map(),Screen=ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-screening.mjs');
 // Items filed only so Zotero's Find Available PDF can attach to them (discovery.js findWithZotero):
 // id -> {key,claimed}. Any other caller that gets one back claims it, and a claimed item is kept.
 // erasing: id -> the erase under way; the duplicate check waits for it.
 const provisional=new Map(),erasing=new Map(),claim=id=>{const entry=provisional.get(id);if(entry)entry.claimed=true;};
 R.releaseProvisionalItem=id=>provisional.delete(id);
 // Erases a provisional item no other caller has had; false when it is kept.
 R.discardProvisionalItem=item=>{const entry=provisional.get(item?.id);provisional.delete(item?.id);if(!entry||entry.claimed||imports.has(entry.key))return Promise.resolve(false);
  const erase=(async()=>{try{if(!item.deleted)await item.eraseTx();return true;}catch(error){Zotero.logError(error);return false;}finally{erasing.delete(item.id);}})();erasing.set(item.id,erase);return erase;};
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
 // The library list a top-level item is shown in: 论文 or 未关联资料 (project
 // rows, standalone notes and files). Children follow their top-level item.
 let ItemScope;const libraryItemScope=itemID=>{const get=id=>{try{return Zotero.Items.get(Number(id));}catch{return null;}};let item=get(itemID);for(let depth=0;item&&depth<4&&(item.parentItemID||item.parentID);depth++)item=get(item.parentItemID||item.parentID);if(!item)return null;ItemScope||=ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-item-scope.mjs');const projects=new Set(Object.values(R.store?.get('manuscriptLibrary')||{}).map(ref=>ref.itemID));return ['papers','unlinked'].find(scope=>ItemScope.belongsToLibraryScope(item,scope,get,row=>projects.has(row.id)))||'papers';};
 // A notebook, writing, search, PPT or agent page hides the native list and item
 // pane. Selecting there shows nothing, focuses the hidden tree and can move the
 // folder those pages read their sources from, so return to the list first; the
 // pages keep their content (writing and agent drafts are saved on the way).
 R.showLibraryItem=async(itemID,options={})=>{
  const pane=Zotero.getActiveZoteroPane();let win,workspace;try{win=Zotero.getMainWindow?.();workspace=win?._researchLibraryWorkspace;}catch{}
  const scope=workspace?.showItemScope&&libraryItemScope(itemID);if(!scope||workspace.mode==='local'&&workspace.itemScope===scope)return pane.selectItem(itemID,options);
  // A caller in another tab (noTabSwitch) must not bring the library forward.
  if(options.noTabSwitch&&win.Zotero_Tabs?.selectedID!=='zotero-pane')return false;
  let failure;try{await workspace.showItemScope(scope);}catch(error){failure=error;Zotero.logError(error);}
  const result=await pane.selectItem(itemID,options);
  if(failure)throw Object.assign(Error('已在文库中选中条目，但切换到文库列表时出错：'+(failure?.message||failure)),{cause:failure});return result;
 };
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
		let found=await matchRecord(record,libraryID);
		if(found&&erasing.has(found.id)){await erasing.get(found.id);return findRecord(record,libraryID);}
		return found;
	}
	async function matchRecord(record, libraryID) {
		let identity=Screen.paperIdentity(record);if(identity?.startsWith('arxiv:')){let base=identity.slice(6).replace(/v\d+$/,'');let byURL=new Zotero.Search();byURL.libraryID=libraryID;byURL.addCondition('url','contains','arxiv.org/abs/'+base);let matches=await Zotero.Items.getAsync(await byURL.search());let found=matches.find(x=>x.isRegularItem()&&!x.deleted&&Screen.paperIdentity({url:x.getField('url')})?.replace(/v\d+$/,'')==='arxiv:'+base);if(found)return found;}
		let doi=Screen.doiKey(record.doi);if(!doi&&!record.url)return null;let search=new Zotero.Search();search.libraryID=libraryID;search.addCondition(doi?'DOI':'url','is',doi||record.url);
		let existing=await Zotero.Items.getAsync(await search.search());return existing.find(item=>item.isRegularItem()&&!item.deleted)||null;
	}
	R.findAcademicItem=async function(record,options={}){let target=await R.resolveAcademicTarget(options),found=await findRecord(record,target.libraryID);if(found)claim(found.id);return found;};
	// The item's full metadata (all authors with given and family names, volume, issue, pages,
	// ISSN) from Zotero's identifier translators, as Add Item by Identifier (lookup.js) does, but
	// with libraryID false: the translator saves nothing and adds no attachment; importRecord files
	// it. An arXiv record, or a record whose only DOI is arXiv's, asks the arXiv translator.
	// obtainPaper starts the lookup while the PDF is sought; after METADATA_TIMEOUT from the start
	// the hand-built item is used.
	const METADATA_TIMEOUT = 15000, metadataTasks = new Map();
	const identifierOf = record => {
		let ctx = (Resolver ||= ChromeUtils.importESModule('chrome://zotero/content/research/shared/pdf-resolver.mjs')).pdfContext(record);
		if (ctx.arxiv && (record.source === 'arXiv' || !ctx.doi || /^10\.48550\//.test(ctx.doi))) return { arXiv: ctx.arxiv };
		return ctx.rawDOI ? { DOI: ctx.rawDOI } : null;
	};
	const later = (ms, fn) => { let set = typeof R.setTimeout === 'function' ? R.setTimeout : typeof setTimeout === 'function' ? setTimeout : null; if (!set) return () => {}; let clear = typeof R.clearTimeout === 'function' ? R.clearTimeout : typeof clearTimeout === 'function' ? clearTimeout : () => {}, id = set(fn, ms); return () => clear(id); };
	async function translateIdentifier(identifier) {
		let translate = new Zotero.Translate.Search();
		translate.setIdentifier(identifier);
		let translators = await translate.getTranslators();
		if (!translators?.length) return null;
		translate.setTranslator(translators);
		let items = await translate.translate({ libraryID: false, saveAttachments: false });
		return items?.find(item => item?.itemType && item.itemType !== 'note' && item.itemType !== 'attachment') || null;
	}
	R.prefetchPaperMetadata = function (record) {
		if (typeof Zotero.Translate?.Search !== 'function') return null;
		let identifier; try { identifier = identifierOf(record); } catch { identifier = null; }
		if (!identifier) return null;
		let key = JSON.stringify(identifier), task = metadataTasks.get(key);
		if (!task) {
			let stop = () => {};
			task = Promise.race([translateIdentifier(identifier).catch(error => { Zotero.debug?.('EasySch: metadata lookup failed: ' + error); return null; }), new Promise(resolve => { stop = later(METADATA_TIMEOUT, () => resolve(null)); })]).finally(() => stop());
			metadataTasks.set(key, task);
			task.then(json => { if (!json && metadataTasks.get(key) === task) metadataTasks.delete(key); });
			for (let old of [...metadataTasks.keys()].slice(0, -40)) metadataTasks.delete(old);
		}
		return task;
	};
	// Translator JSON as Zotero's ItemSaver takes it, without its attachments, notes or ids.
	const importJSON = json => {
		let copy = { ...json };
		for (let field of ['attachments', 'notes', 'seeAlso', 'dateAdded', 'dateModified', 'version', 'id', 'itemID', 'key', 'path', 'collections', 'relations', 'libraryID']) delete copy[field];
		if (copy.accessDate === 'CURRENT_TIMESTAMP') copy.accessDate = Zotero.Date?.dateToISO ? Zotero.Date.dateToISO(new Date()) : undefined;
		if (copy.accessDate === undefined) delete copy.accessDate;
		copy.creators = (copy.creators || []).filter(creator => creator && (creator.lastName || creator.firstName || creator.name)).map(creator => ({ ...creator, creatorType: creator.creatorType || 'author' }));
		let automatic = Zotero.Prefs?.get ? Zotero.Prefs.get('automaticTags') !== false : true;
		copy.tags = (copy.tags || []).map(tag => typeof tag === 'string' ? { tag } : tag).filter(tag => tag?.tag && String(tag.tag).trim() && (automatic || tag.type !== 1));
		return copy;
	};
	const fillEmpty = (item, field, value) => {
		if (!value) return;
		try { if (Zotero.ItemFields?.isValidForType && !Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field), item.itemTypeID)) return; if (!item.getField(field)) item.setField(field, value); } catch {}
	};
	// The translator's item, with what the search record knows filling the fields it left empty.
	function translatedItem(json, record, libraryID) {
		let item = new Zotero.Item(json.itemType); item.libraryID = libraryID;
		item.fromJSON(importJSON(json));
		let venue = record.journal || record.venue || record.pdfHints?.venue;
		for (let [field, value] of Object.entries({ title: record.title, abstractNote: record.abstract, date: record.date, DOI: record.doi, url: record.url, publicationTitle: venue, proceedingsTitle: venue, repository: record.source === 'arXiv' ? 'arXiv' : '', ISSN: record.issn })) fillEmpty(item, field, value);
		// The arXiv translator gives http:// addresses; the duplicate check and the reader use https.
		if (record.source === 'arXiv' && record.url) { try { item.setField('url', record.url); if (!item.getField('archiveID')) item.setField('archiveID', record.id); } catch {} }
		// The duplicate check (findRecord) searches the DOI as the search record wrote it.
		try { if (record.doi && item.getField('DOI') && Screen.doiKey(item.getField('DOI')) === Screen.doiKey(record.doi)) item.setField('DOI', record.doi); } catch {}
		let extra = String(item.getField('extra') || '');
		if (record.source === 'PubMed' && record.id && !/^PMID:/m.test(extra)) item.setField('extra', (extra ? extra + '\n' : '') + 'PMID: ' + record.id);
		if (!item.getCreators().length && record.authors?.length) item.setCreators(record.authors.map(a => ({ ...a, creatorType: 'author' })));
		return item;
	}
	async function saveTranslatorNotes(json, item) {
		for (let note of json?.notes || []) {
			let text = typeof note === 'string' ? note : note?.note;
			if (!text) continue;
			try { let child = new Zotero.Item('note'); child.libraryID = item.libraryID; child.parentID = item.id; child.setNote(text); await child.saveTx({ skipSelect: true }); }
			catch (error) { Zotero.logError(error); }
		}
	}
	async function importRecord(record, options = {}) {
		const {select=true}=options,target=await R.resolveAcademicTarget(options);let libraryID=target.libraryID;
		const reuse=async found=>{claim(found.id);await R.placeAcademicInCollection(found.id,{libraryID,collectionID:target.collectionID});if(select)await R.showLibraryItem(found.id,{noTabSwitch:true});return{id:found.id,existing:true,...target};};
		let found=await findRecord(record,libraryID);if(found)return reuse(found);
		if(!Screen.doiKey(record.doi)&&!record.url)throw Error('缺少 DOI 或可核验来源网址，无法判重入库');
		let json = await R.prefetchPaperMetadata(record), item = null;
		if (json) { try { item = translatedItem(json, record, libraryID); } catch (error) { Zotero.logError(error); item = null; } }
		if (item) {
			if (target.collectionID) item.setCollections([target.collectionID]);
			await item.saveTx({ skipSelect: !select }); await saveTranslatorNotes(json, item);
			if (select) await R.showLibraryItem(item.id, { noTabSwitch: true }); return { id: item.id, existing: false, metadata: 'translator', ...target };
		}
		// Conference paper, preprint or journal article, from the record's type and venue and what
		// pdf-resolver.js learned (record.pdfHints).
		let type = (Resolver ||= ChromeUtils.importESModule('chrome://zotero/content/research/shared/pdf-resolver.mjs')).paperItemType(record);
		item = new Zotero.Item(type); item.libraryID = libraryID;
		for (let [field, value] of Object.entries({ title: record.title, abstractNote: record.abstract, date: record.date, DOI: record.doi, url: record.url })) if (value) item.setField(field, value);
		if (record.source === 'arXiv') { item.setField('repository', 'arXiv'); item.setField('archiveID', record.id); }
		else if (type === 'preprint') { let repository = record.journal || record.venue || record.pdfHints?.venue; if (repository) item.setField('repository', repository); }
		else { let venue = record.journal || record.venue || record.pdfHints?.venue; if (venue) item.setField(type === 'conferencePaper' ? 'proceedingsTitle' : 'publicationTitle', venue); if (record.issn) item.setField('ISSN', record.issn); }
		if (record.source === 'PubMed') item.setField('extra', 'PMID: ' + record.id);
		item.setCreators((record.authors||[]).map(a => ({ ...a, creatorType: 'author' })));
		if(target.collectionID)item.setCollections([target.collectionID]);
		await item.saveTx({skipSelect:!select});if(select)await R.showLibraryItem(item.id,{noTabSwitch:true});return{id:item.id,existing:false,...target};
	};
 // options.provisional (findWithZotero): a new item is registered as provisional before any caller
 // sees it. A caller that joins another caller's import gets joined:true and claims the item.
 R.importAcademic=async function(record,options={}){const target=await R.resolveAcademicTarget(options),key=target.libraryID+':'+Screen.paperIdentity(record);let task=imports.get(key),joined=!!task;if(!task){task=importRecord(record,{...options,...target}).then(result=>{if(options.provisional&&!result.existing)provisional.set(result.id,{key,claimed:false});return result;});imports.set(key,task);task.finally(()=>imports.delete(key)).catch(()=>{});}const result=await task;if(joined||!options.provisional)claim(result.id);await R.placeAcademicInCollection(result.id,target);return{...result,...target,...(joined?{joined:true}:{})};};
})(Zotero.Research);
