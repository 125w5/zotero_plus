/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
	const C=ChromeUtils.importESModule('chrome://zotero/content/research/shared/corpus-library.mjs');
	const W=ChromeUtils.importESModule('chrome://zotero/content/research/shared/weekly-research.mjs');
	const Domain=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-domain.mjs');
	// A corpus domain labels the corpus and orders AI 挑选 candidates. Its few
	// terms are not required in every chapter: keywords and exclusions decide.
	const ENTRY_SCOPE={domain:false};
	E.corpus={all:()=>E.store.get('corpora')||{},get:id=>E.store.get('corpora',id)};
	// Shared frozen corpora for lists, ranking and revision checks; never mutate
	// them. A replaced all()/get() (tests, integrations) stays authoritative.
	const originalAll=E.corpus.all,originalGet=E.corpus.get;
	E.corpus.allView=()=>E.corpus.all!==originalAll?E.corpus.all():(E.store.peek?E.store.peek('corpora'):E.store.get('corpora'))||{};
	E.corpus.view=id=>E.corpus.get!==originalGet?E.corpus.get(id):E.store.peek?E.store.peek('corpora',id):E.store.get('corpora',id);
	E.corpus.update=async(id,{name,researchScope}={})=>{
		if(name!==undefined&&!String(name).trim())throw Error('请填写语料库名称');const scope=researchScope===undefined?undefined:Domain.normalizeResearchScope(researchScope);
		await E.store.update(state=>{const corpus=state.corpora?.[id];if(!corpus)throw Error('语料库不存在');if(name!==undefined)corpus.name=String(name).trim();if(scope){corpus.researchScope=scope;corpus.domain=scope.domain;}corpus.updatedAt=new Date().toISOString();});return E.corpus.view(id);
	};
	E.corpus.create=async(name,domain='')=>{if(!String(name).trim())throw Error('请填写语料库名称');const researchScope=Domain.normalizeResearchScope(domain),row={id:'corpus-'+Zotero.Utilities.randomString(12),name:String(name).trim(),domain:researchScope.domain,researchScope,entries:[],createdAt:new Date().toISOString()};await E.store.update(state=>{state.corpora||={};state.corpora[row.id]=row;});return row;};
	// Editing the text of a source entry makes it the user's text: origin manual,
	// sourceEdited and the first original text kept. Paper and anchor stay as
	// provenance only. Manual rows outside the corpus scope save with a warning.
	E.corpus.saveEntry=async(id,input)=>{
		const corpus=E.corpus.view(id),old=corpus?.entries.find(row=>row.id===input.id),edited=!!old&&(old.origin==='source'||old.sourceEdited)&&input.text!==undefined&&String(input.text).trim()!==String(old.text||'').trim();
		const row=C.corpusEntry({...old,...input,...(edited?{origin:'manual',sourceEdited:true,originalText:old.originalText||old.text}:{})},{id:input.id||'entry-'+Zotero.Utilities.randomString(12)}),inScope=Domain.matchesResearchScope(C.corpusSourceRecord(row),C.corpusResearchScope(corpus),ENTRY_SCOPE);
		if(!inScope&&row.origin==='source')throw Error('这份语料不符合语料库的研究领域或关键词');
		await E.store.update(state=>{const current=state.corpora?.[id];if(!current)throw Error('语料库不存在');const index=current.entries.findIndex(entry=>entry.id===row.id);if(index<0)current.entries.push(row);else current.entries[index]=row;current.updatedAt=row.updatedAt;});
		return inScope?row:{...row,scopeWarning:'这份手工语料不含语料库的研究领域或关键词；已保存，用于分析前请核对'};
	};
	E.corpus.removeEntry=async(id,entryID)=>E.store.update(state=>{const corpus=state.corpora?.[id];if(corpus)corpus.entries=corpus.entries.filter(row=>row.id!==entryID);});
	const sourceMaterial=row=>row.sourceText?.trim()&&row.kind!=='idea'&&!['ai-discussion','ai-illustration'].includes(row.sourceType)&&!(row.conversationID&&row.messageID)&&(!row.aiGenerated||row.kind==='semantic'&&/^article-section-zh-/.test(row.analysisVersion||'')&&row.anchor?.attachmentID&&row.sourceParagraphIDs?.length);
	// Save a collected batch once. Large chapters must not clone and serialize
	// the whole library separately for every paragraph in the batch. A row is
	// present when its material id, or its paper with its text, is already in
	// the corpus. Zotero notes and annotations (ids in `publish`) are published
	// first, so their entries keep a stable material id.
	const appendMaterials=async(id,materials,{section='',signal,publish}={})=>{
		const corpus=E.corpus.view(id);if(!corpus)throw Error('语料库不存在');
		const known=new Set(corpus.entries.flatMap(row=>[...C.corpusKeys(row)])),knownIDs=new Set(corpus.entries.map(row=>row.materialID).filter(Boolean)),batch=new Set(),scope=C.corpusResearchScope(corpus),keep=[];let present=0,outside=0;
		for(const material of materials){
			if(signal?.aborted)throw Error('已取消语料整理');
			if(!sourceMaterial(material))continue;const keys=[...C.corpusKeys({...material,materialID:material.id})];
			if(keys.some(key=>known.has(key)||batch.has(key))){present++;continue;}
			if(!Domain.matchesResearchScope(C.corpusSourceRecord(material),scope,ENTRY_SCOPE)){outside++;continue;}
			for(const key of keys)batch.add(key);keep.push(material);
		}
		let cards=keep;const pending=publish?.size&&E.manuscripts.publishMaterials?keep.filter(row=>publish.has(row.id)):[];
		if(pending.length){const saved=(await E.manuscripts.publishMaterials(pending)).cards,byID=new Map(pending.map((row,index)=>[row.id,saved[index]]));cards=keep.map(row=>byID.get(row.id)||row);E.manuscripts.notifyAssetsChanged?.();}
		const entries=[],ids=new Set();
		for(const card of cards){
			if(signal?.aborted)throw Error('已取消语料整理');
			if(knownIDs.has(card.id)||ids.has(card.id)){present++;continue;}ids.add(card.id);
			entries.push(C.corpusEntry({title:card.title,paperTitle:card.paperTitle,text:card.sourceText,section:section||card.sectionType||card.section||'',tags:card.tags||[],paperItemID:card.paperItemID||card.anchor?.paperItemID,materialID:card.id,origin:'source',uri:card.anchor?.url,anchor:card.anchor,sourceRevision:card.revision},{id:'entry-'+Zotero.Utilities.randomString(12)}));
		}
		let added=0;
		if(entries.length)await E.store.update(state=>{if(signal?.aborted)throw Error('已取消语料整理');const current=state.corpora?.[id];if(!current)throw Error('语料库不存在');const existing=new Set(current.entries.map(row=>row.materialID).filter(Boolean));added=0;for(const entry of entries)if(!existing.has(entry.materialID)){current.entries.push(entry);existing.add(entry.materialID);added++;}current.updatedAt=new Date().toISOString();});
		return {added,present,outside};
	};
	E.corpus.prepareProject=async(projectID,{materials,paperIDs,signal,status=()=>{}}={})=>{
		const project=E.notebook?.project(projectID)||E.manuscripts.get(projectID);if(!project)throw Error('论文项目不存在');
		if(signal?.aborted)throw Error('已取消语料整理');
		const corpora=E.corpus.all();let corpus=Object.values(corpora).find(row=>row.projectID===projectID);
		const scope=Domain.normalizeResearchScope(Domain.researchScopeFromProject(project));
		if(!corpus){corpus=await E.corpus.create(project.title+' · 语料',scope);await E.store.update(state=>{state.corpora[corpus.id].projectID=projectID;});}
		else if(JSON.stringify(C.corpusResearchScope(corpus))!==JSON.stringify(scope))await E.store.update(state=>{const current=state.corpora[corpus.id];current.researchScope=scope;current.domain=scope.domain;});
		const ids=new Set(paperIDs||project.preparationSourceSelection?.paperIDs||project.materialPaperIDs||[]);
		const source=materials||[...Object.values(E.manuscripts.assetLibrary()),...(project.materials||[])],owned=new Set((project.materials||[]).map(row=>row.id));
		const rows=source.filter(row=>ids.has(row.paperItemID||row.anchor?.paperItemID)||owned.has(row.id));
		status('正在保存项目完整语料…');const result=await appendMaterials(corpus.id,rows,{signal});
		return {...result,corpusID:corpus.id,total:E.corpus.get(corpus.id).entries.length};
	};
	// The search box filters 收集所选论文; AI 挑选 ignores it and ranks the
	// candidates by its own research purpose. Every refusal says what was found.
	E.corpus.collect=async(id,{paperIDs,section='',query='',purpose='',ai=false,status=()=>{},signal}={})=>{
		const corpus=E.corpus.view(id);if(!corpus)throw Error('请选择语料库');
		const stop=()=>{if(signal?.aborted)throw Error('已取消语料整理');};
		paperIDs=paperIDs||E.library.selection().map(row=>row.id);if(!paperIDs.length)throw Error('请先在文库中选择论文');
		status('正在整理完整章节素材…');await E.manuscripts.ensureArticleSectionMaterials?.();stop();
		// Rows of the selected papers, and notes selected on their own. PPT draft
		// records and other rows without a selected paper stay out.
		const selected=new Set(paperIDs),chosen=row=>selected.has(row.paperItemID||row.anchor?.paperItemID)||selected.has(row.sourceItemID),sourceKey=row=>row.sourceItemID?row.kind+'\0'+row.sourceItemID:'';
		const library=E.manuscripts.assetLibraryView?E.manuscripts.assetLibraryView():E.manuscripts.assetLibrary(),cards=Object.values(library).filter(chosen),published=new Set(cards.map(sourceKey).filter(Boolean));
		// A Zotero note or annotation that is already a material card is read from that card.
		const notes=(await E.manuscripts.candidates(paperIDs)).filter(row=>chosen(row)&&!published.has(sourceKey(row)));stop();
		const sources=[],seen=new Set();for(const row of [...cards,...notes]){if(!sourceMaterial(row))continue;const keys=[...C.corpusKeys({...row,materialID:row.id})];if(keys.some(key=>seen.has(key)))continue;for(const key of keys)seen.add(key);sources.push(row);}
		if(!sources.length)throw Error('所选论文还没有可收集的章节素材、笔记或批注；语料库未改动。请先阅读并索引论文，或在 PDF 中添加批注。');
		const researchScope=C.corpusResearchScope(corpus),inScope=sources.filter(row=>Domain.matchesResearchScope(C.corpusSourceRecord(row),researchScope,ENTRY_SCOPE));
		if(!inScope.length)throw Error('所选论文的 '+sources.length+' 份素材都不含语料库的关键词；语料库未改动。可在“编辑范围”中调整关键词。');
		const words=ai?[]:String(query).normalize('NFKC').toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
		const matched=inScope.filter(row=>(!section||(row.sectionType||row.section||'').includes(section))&&(!words.length||words.every(word=>C.corpusSearchText({...row,text:row.sourceText}).includes(word))));
		if(!matched.length)throw Error('所选论文有 '+inScope.length+' 份符合范围的素材，但都不匹配当前的'+(words.length&&section?'搜索词和章节筛选':words.length?'搜索词':'章节筛选')+'；语料库未改动。可清空筛选后重试。');
		const known=new Set(corpus.entries.flatMap(row=>[...C.corpusKeys(row)])),fresh=matched.filter(row=>![...C.corpusKeys({...row,materialID:row.id})].some(key=>known.has(key))),present=matched.length-fresh.length;
		if(!fresh.length)return {added:0,present,outside:0,dropped:0};
		let picked=fresh,dropped=0;
		if(ai){
			const aim=purpose||corpus.name,allowed=C.rankCorpusCandidates(fresh,{purpose:aim,researchScope}).slice(0,80),byID=new Map(allowed.map(row=>[String(row.id),row]));status('正在挑选与研究目的相关的完整语料…');
			const reply=await E.studio.request('从给定完整章节语料中选择符合研究目的的条目。只返回 {ids:[string]}，最多20条。不要改写或拆分语料，不生成新证据。',{task:'按研究目的挑选语料',purpose:aim,domain:corpus.domain,section,candidates:allowed.map(row=>({id:row.id,title:row.title,text:row.sourceText.slice(0,2000)}))},status,signal);stop();
			const ids=reply?.value&&typeof reply.value==='object'&&Array.isArray(reply.value.ids)?reply.value.ids:null;if(!ids)throw Error('模型没有返回有效的语料编号列表；语料库未改动。请重新运行 AI 挑选。');
			const valid=[...new Set(ids.map(String))].filter(key=>byID.has(key));if(!valid.length)throw Error(ids.length?'模型返回的编号都不在候选语料中；语料库未改动。请重新运行 AI 挑选。':'模型没有选出符合研究目的的语料；语料库未改动。可换一种说法描述研究目的后重试。');
			picked=valid.slice(0,20).map(key=>byID.get(key));dropped=valid.length-picked.length;
		}
		const result=await appendMaterials(id,picked,{section,signal,publish:new Set(notes.map(row=>row.id))});
		return {...result,present:present+result.present,dropped};
	};
	const projectFor=id=>E.notebook?.projectView?.(id)||E.notebook?.project?.(id)||E.manuscripts.get(id);
	const fitsProject=(corpus,scope)=>{const domain=C.corpusResearchScope(corpus).domain;return !domain||domain==='other'||!scope.domain||scope.domain==='other'||domain===scope.domain;};
	// The project's chosen corpora, else every scope-matching corpus except the
	// project's own automatic corpus. projectID null means all corpora (chat).
	E.corpus.eligible=(projectID,{corpusIDs}={})=>{
		const corpora=Object.values(E.corpus.allView()).filter(row=>row?.id&&Array.isArray(row.entries)),project=projectID?projectFor(projectID):null;if(!projectID)return corpora;if(!project)return [];
		const chosen=corpusIDs||project.preparationCorpusSelection?.corpusIDs;if(Array.isArray(chosen))return chosen.map(id=>corpora.find(row=>row.id===id)).filter(Boolean);
		const scope=Domain.researchScopeFromProject(project);return corpora.filter(row=>row.projectID!==projectID&&fitsProject(row,scope));
	};
	// Scope results are cached per frozen entry and per corpus/project scope pair.
	const scopeChecks=new Map();
	const scopeCheck=(corpus,scope)=>{const key=JSON.stringify([C.corpusResearchScope(corpus),scope]);let cache=scopeChecks.get(key);if(!cache){if(scopeChecks.size>32)scopeChecks.clear();cache=new WeakMap();scopeChecks.set(key,cache);}return entry=>{if(cache.has(entry))return cache.get(entry);const value=C.corpusEntryInScope(entry,corpus,scope,ENTRY_SCOPE);if(Object.isFrozen(entry))cache.set(entry,value);return value;};};
	const corpusRow=(corpus,entry,origin,inScope,section=entry.section)=>{
		const provenance=C.corpusEntryProvenance(entry,origin),located=provenance==='source',matches=located&&origin&&String(origin.sourceText||'').trim()===String(entry.text||'').trim(),anchors=matches&&origin.anchors?.length?origin.anchors:null;
		return Object.freeze({id:'corpus-'+entry.id,corpusID:corpus.id,corpusName:corpus.name||'',corpusEntryID:entry.id,originMaterialID:entry.materialID||null,sourceRevision:entry.sourceRevision??null,corpusRevision:C.corpusEntryRevision(entry),origin:located?'source':'manual',edited:provenance==='edited',...(inScope?{}:{scopeWarning:true}),kind:located&&origin?.kind&&origin.kind!=='idea'?origin.kind:'note',title:entry.title||origin?.title||'',paperTitle:entry.paperTitle||origin?.paperTitle||'',sourceText:entry.text,summary:origin?.summary||'',sectionType:section,tags:entry.tags||[],paperItemID:entry.paperItemID||origin?.paperItemID||null,anchor:located?(matches&&origin.anchor?origin.anchor:entry.anchor)||{paperItemID:entry.paperItemID||null,sourceText:entry.text}:{paperItemID:entry.paperItemID||null,citationItemID:entry.paperItemID||null,attachmentID:entry.anchor?.attachmentID||null,url:entry.uri||entry.anchor?.url||null,sourceText:entry.text},...(anchors?{anchors}:{}),coverage:provenance==='source'?'语料库 · 原文摘录':provenance==='edited'?'语料库 · 人工编辑，需核验':'语料库手工条目，需核验',verification:located?origin?.verification||'unverified':'user',...(located&&origin?.aiGenerated?{aiGenerated:true,analysisVersion:origin.analysisVersion||''}:{})});
	};
	// Material-shaped, scope-checked rows that are not yet in the project, ranked
	// by overlap with the query. Rows are frozen; clone before adopting them.
	E.corpus.projectRows=(projectID,{sectionType='',query='',limit=24,corpusIDs,ids,includeCopied=false,excludeMaterialIDs=[]}={})=>{
		const project=projectID?projectFor(projectID):null,scope=project?Domain.researchScopeFromProject(project):null,library=E.manuscripts.assetLibraryView?E.manuscripts.assetLibraryView():E.manuscripts.assetLibrary?.()||{};
		const owned=new Set((project?.materials||[]).map(row=>row.id)),copied=new Set((project?.materials||[]).flatMap(row=>row.corpusEntryID?[row.corpusEntryID,row.corpusID+'\0'+row.corpusEntryID]:[])),excluded=new Set(excludeMaterialIDs),wanted=ids?new Set(ids):null,items=[];
		for(const corpus of E.corpus.eligible(projectID,{corpusIDs})){const entryInScope=scopeCheck(corpus,scope);for(const entry of corpus.entries){
			if(!entry?.id||!String(entry.text||'').trim()||wanted&&!wanted.has('corpus-'+entry.id))continue;
			if(!includeCopied&&(owned.has('corpus-'+entry.id)||copied.has(entry.id)||copied.has(corpus.id+'\0'+entry.id)||entry.materialID&&owned.has(entry.materialID)))continue;
			if(entry.materialID&&excluded.has(entry.materialID))continue;
			const manual=entry.origin!=='source'||entry.sourceEdited,inScope=entryInScope(entry);if(!inScope&&!manual)continue;
			// An unedited source entry takes its section from the origin material,
			// which also repairs entries once coerced to 引言.
			const origin=entry.materialID?library[entry.materialID]:null,section=!manual&&origin?.sectionType?origin.sectionType:entry.section;
			items.push({corpus,entry,inScope,origin,section});
		}}
		return C.rankCorpusEntries(items,{query,sectionType,limit,entryOf:item=>item.entry,sectionOf:item=>item.section}).map(({corpus,entry,inScope,origin,section})=>corpusRow(corpus,entry,origin,inScope,section));
	};
	// Project corpus copies whose text is not the verified source text: manual or
	// edited rows, and copies made before F10 from an edited source entry, which
	// still read origin 'source'. Their text is compared with the corpus entry's
	// origin material; a copy with nothing left to compare against counts as manual.
	E.corpus.manualCopyIDs=project=>{
		const ids=new Set(),library=E.manuscripts?.assetLibraryView?E.manuscripts.assetLibraryView():E.manuscripts?.assetLibrary?.()||{};
		for(const copy of project?.materials||[]){
			if(!copy?.corpusEntryID)continue;
			if(copy.origin!=='source'||copy.edited||/人工编辑|手工条目/.test(copy.coverage||'')){ids.add(copy.id);continue;}
			const entry=copy.corpusID?E.corpus.view(copy.corpusID)?.entries?.find(row=>row?.id===copy.corpusEntryID):null,materialID=entry?.materialID||copy.originMaterialID,origin=materialID?library[materialID]:null;
			const text=String(copy.sourceText||'').trim(),originText=String(origin?.sourceText??origin?.anchor?.sourceText??'').trim();
			const verified=entry?C.corpusEntryProvenance(entry,origin)==='source'&&text===String(entry.text||'').trim():!!originText&&text===originText;
			if(!verified)ids.add(copy.id);
		}
		return ids;
	};
	E.corpus.projectSummary=projectID=>{const project=projectID?projectFor(projectID):null,corpora=E.corpus.eligible(projectID);return {corpusIDs:corpora.map(row=>row.id),chosen:Array.isArray(project?.preparationCorpusSelection?.corpusIDs),corpora:corpora.length,entries:corpora.reduce((sum,row)=>sum+row.entries.length,0),names:corpora.slice(0,6).map(row=>row.name||'')};};
	// One lazy lookup per caller: corpus row id ('corpus-'+entryID) -> revision.
	// The id index is built once; only the requested entries are hashed.
	E.corpus.revisionLookup=()=>{let map=null;return id=>{if(!map){map=new Map();for(const corpus of Object.values(E.corpus.allView()))for(const entry of corpus?.entries||[])if(entry?.id)map.set('corpus-'+entry.id,entry);}const entry=map.get(id);return entry?C.corpusEntryRevision(entry):undefined;};};
	E.corpus.importProject=async(projectID,corpusID,entryIDs)=>{
		const corpus=E.corpus.view(corpusID);if(!corpus)throw Error('语料库不存在');const project=projectFor(projectID);if(!project)throw Error('论文项目不存在');const researchScope=Domain.researchScopeFromProject(project);
		// Rows no longer need a literal domain term, so the corpus domain itself
		// must fit the project; a corpus without a domain fits every project.
		if(!fitsProject(corpus,researchScope))throw Error('这个语料库的研究领域与项目不同，未导入；项目素材未改动。可在“编辑范围”中把语料库的研究领域改为项目领域或不限后再导入。');
		C.selectedCorpusMaterials(corpus,entryIDs,{researchScope,...ENTRY_SCOPE});
		const rows=E.corpus.projectRows(projectID,{corpusIDs:[corpusID],ids:entryIDs.map(id=>'corpus-'+id),includeCopied:true,limit:Infinity});if(!rows.length)throw Error('请勾选要导入的语料');
		// catalog saves through the manuscript revision guard. Advancing the
		// revision before that save makes a valid import look like a stale edit.
		let count=0,reused=0;const warnings=rows.filter(row=>row.scopeWarning).length,apply=project=>{for(const row of rows){if(project.materials.some(item=>item.id===row.id||item.corpusEntryID===row.corpusEntryID&&(!item.corpusID||item.corpusID===corpusID)||row.originMaterialID&&item.id===row.originMaterialID)){reused++;continue;}project.materials.push(C.corpusMaterialCopy(row));count++;}};
		if(E.notebook?.catalog)await E.notebook.catalog(projectID,apply);else await E.store.update(state=>{const current=state.manuscripts[projectID];if(!current)throw Error('论文项目不存在');apply(current);current.revision++;current.updatedAt=new Date().toISOString();});
		E.manuscripts.notifyAssetsChanged?.();return {count,reused,warnings};
	};
	E.importZoteroLibrary=async(win=Zotero.getMainWindow())=>{
		const file=await E.pick(win,'选择 Zotero 导出的文库（RDF、RIS、BibTeX 或 JSON）','file','rdf;ris;bib;json');if(!file)return {cancelled:true};
		if(/\.sqlite$/i.test(file))throw Error('请选择 Zotero 导出的文库文件。原始数据库不能作为导入文件。');
		const imported=await win.Zotero_File_Interface.importFile({file,createNewCollection:true,linkFiles:false});if(!imported)throw Error('文库未导入，请确认文件格式与附件路径');return {imported:true};
	};
	E.openResearchResources=async(win=Zotero.getMainWindow(),options={})=>{
		const old=win.document.getElementById('easysch-research-resources');if(old){old.resourceOptions=options;win.Zotero_Tabs.select(old.parentElement.id);old.contentWindow?.ResearchResourcesUI?.open(options);return old.contentWindow;}
		const frame=win.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.id='easysch-research-resources';frame.resourceOptions=options;frame.style.cssText='border:0;width:100%;height:100%;flex:1;';
		const {container}=win.Zotero_Tabs.add({type:'research',title:'研究语料库',data:{resourceView:'corpus'},select:true,onClose:()=>{try{frame.contentWindow?.ResearchResourcesUI?.cancel?.();}catch(error){Zotero.logError(error);}}});container.style.display='flex';container.append(frame);frame.src='chrome://zotero/content/research/research-resources.html';return frame.contentWindow;
	};
	E.weeklyResearch=async(options={})=>{
		options={...options};let scope=options.scope;
		if(scope?.collectionID){const collection=await Zotero.Collections.getAsync(scope.collectionID),ids=new Set();if(!collection)throw Error('周报文件夹已不存在，请重新选择。');const visit=async folder=>{await folder.loadDataType('childItems');for(const id of folder.getChildItems(true)||[])ids.add(id);await folder.loadDataType('childCollections');for(const id of folder.getChildCollections(true)||[])await visit(await Zotero.Collections.getAsync(id));};await visit(collection);scope={...scope,label:scope.label||scope.folder||collection.name,paperIDs:[...ids]};}
		else if(scope)scope={...scope,paperIDs:scope.paperIDs||(scope.files||[]).map(row=>row.paperItemID).filter(Boolean)};
		options.scope=scope;const all=await Zotero.Items.getAll(scope?.libraryID||Zotero.Libraries.userLibraryID,false,false),rows=[];
		for(const item of all){if(item.deleted)continue;const kind=item.isNote()?'note':item.isAnnotation()?'annotation':item.isRegularItem()?'paper':null;if(!kind)continue;let text='';if(kind==='note')text=Zotero.Utilities.cleanTags(item.getNote());else if(kind==='annotation')text=[item.annotationText,item.annotationComment].filter(Boolean).join('\n');rows.push({id:item.id,kind,title:kind==='annotation'?'原文批注':item.getField('title')||item.getNoteTitle?.(),text,paperItemID:kind==='annotation'?item.parentItem?.parentID:item.parentID,uri:E.library.uri(item),dateAdded:item.dateAdded,dateModified:item.dateModified});}
		const state=Object.fromEntries(['researchActivity','papers','manuscripts','pptDrafts'].map(key=>[key,E.store.get(key)]));
		return W.weeklyResearchEntries(state,rows,options);
	};
	E.studio.createWeekly=async(status=()=>{},signal,options={})=>{
		const check=()=>{if(signal?.aborted)throw Object.assign(Error('已取消本周汇报生成'),{name:'AbortError'});};check();
		// Native entry points also inherit the selected collection. Passing
		// scope:null explicitly is the whole-library action.
		if(!Object.hasOwn(options,'scope')){const folder=Zotero.getActiveZoteroPane?.()?.getSelectedCollections?.()[0];if(folder)options={...options,scope:{collectionID:folder.id,libraryID:folder.libraryID,label:folder.name}};}
		status('正在汇总过去七天的阅读、批注和研究记录…');const report=await E.weeklyResearch(options);if(signal?.aborted)throw Error('已取消');if(!report.entries.length)throw Error((report.scope?.label||'所选范围')+'过去七天没有研究记录。阅读、批注或保存研究笔记后可生成周报。');
		const minutes=options.minutes||15,content=W.weeklyPresentation(report,{minutes}),ids=new Set(report.entries.map(row=>row.paperItemID).filter(Boolean)),papers=[];for(const id of ids){check();const item=await Zotero.Items.getAsync(id);check();if(item?.isRegularItem?.())papers.push(E.library.describe(item));}check();
		const draft=await E.studio.create(papers.slice(0,12),{mode:'weekly'});return E.studio.patch(draft.id,next=>{next.title='本周研究进展 · '+report.end.slice(0,10);next.minutes=minutes;next.templateID='progress';next.weeklyRange={start:report.start,end:report.end,scope:report.scope};next.sources=content.sources;next.slides=content.slides;next.outline=content.outline;next.outlineApproved=true;next.materialsReady=true;next.step=5;next.weeklyEntryIDs=report.entries.map(row=>row.id);});
	};
	E.startResearchActivity=()=>{
		const seen=new Set(),observer=Zotero.Notifier.registerObserver({notify(event,type,ids){if(type!=='tab'||event!=='select')return;for(const tabID of ids){const reader=Zotero.Reader.getByTabID(tabID),attachment=reader?.itemID&&Zotero.Items.get(reader.itemID),paper=attachment?.parentItem||attachment;if(!paper)continue;const at=new Date().toISOString(),id=paper.id+'-'+at.slice(0,10);if(seen.has(id))continue;seen.add(id);E.store.update(state=>{state.researchActivity||=[];if(!state.researchActivity.some(row=>row.id===id))state.researchActivity.push({id,paperItemID:paper.id,title:paper.getField('title'),text:'阅读论文',at,uri:E.library.uri(attachment)});state.researchActivity=state.researchActivity.slice(-2000);}).catch(Zotero.logError);}}},['tab'],'easysch-weekly-reading');Zotero.addShutdownListener(()=>Zotero.Notifier.unregisterObserver(observer));
	};
})(Zotero.Research);
