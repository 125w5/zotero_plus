/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
	const C=ChromeUtils.importESModule('chrome://zotero/content/research/shared/corpus-library.mjs');
	const W=ChromeUtils.importESModule('chrome://zotero/content/research/shared/weekly-research.mjs');
	const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/manuscript-model.mjs');
	const Domain=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-domain.mjs');
	E.corpus={all:()=>E.store.get('corpora')||{},get:id=>E.store.get('corpora',id)};
	E.corpus.create=async(name,domain='')=>{if(!String(name).trim())throw Error('请填写语料库名称');const researchScope=Domain.normalizeResearchScope(domain),row={id:'corpus-'+Zotero.Utilities.randomString(12),name:String(name).trim(),domain:researchScope.domain,researchScope,entries:[],createdAt:new Date().toISOString()};await E.store.update(state=>{state.corpora||={};state.corpora[row.id]=row;});return row;};
	E.corpus.saveEntry=async(id,input)=>{const old=E.corpus.get(id)?.entries.find(row=>row.id===input.id),row=C.corpusEntry({...old,...input},{id:input.id||'entry-'+Zotero.Utilities.randomString(12)});if(!Domain.matchesResearchScope({...row,sourceText:row.text},C.corpusResearchScope(E.corpus.get(id))))throw Error('这份语料不符合语料库的研究领域或关键词');await E.store.update(state=>{const corpus=state.corpora?.[id];if(!corpus)throw Error('语料库不存在');const index=corpus.entries.findIndex(entry=>entry.id===row.id);if(index<0)corpus.entries.push(row);else corpus.entries[index]=row;corpus.updatedAt=row.updatedAt;});return row;};
	E.corpus.removeEntry=async(id,entryID)=>E.store.update(state=>{const corpus=state.corpora?.[id];if(corpus)corpus.entries=corpus.entries.filter(row=>row.id!==entryID);});
	E.corpus.collect=async(id,{paperIDs,section='',query='',ai=false,status=()=>{},signal}={})=>{
		const corpus=E.corpus.get(id);if(!corpus)throw Error('请选择语料库');
		paperIDs=paperIDs||E.library.selection().map(row=>row.id);if(!paperIDs.length)throw Error('请先在文库中选择论文');
		status('正在整理完整章节素材…');await E.manuscripts.ensureArticleSectionMaterials?.();
		const selected=new Set(paperIDs),all=Object.values(E.manuscripts.assetLibrary()).filter(row=>selected.has(row.paperItemID||row.anchor?.paperItemID)&&row.sourceText?.trim()&&!row.aiGenerated);
		const notes=await E.manuscripts.candidates(paperIDs),byID=new Map([...all,...notes].map(row=>[row.id,row]));
		const researchScope=C.corpusResearchScope(corpus);let materials=[...byID.values()].filter(row=>(!section||(row.sectionType||row.section||'').includes(section))&&Domain.matchesResearchScope(row,researchScope)&&!row.aiGenerated&&row.sourceType!=='ai-discussion'&&row.sourceType!=='ai-illustration'&&!(row.conversationID&&row.messageID));
		if(query){const words=query.toLowerCase().split(/[\s,，]+/).filter(Boolean);materials=materials.filter(row=>words.every(word=>(row.title+' '+row.sourceText).toLowerCase().includes(word)));}
		if(!materials.length)throw Error('所选论文还没有匹配的章节素材或批注。请先阅读、索引或更换筛选。');
		if(ai){status('正在挑选与研究目的相关的完整语料…');const allowed=materials.slice(0,80),result=await E.studio.request('从给定完整章节语料中选择符合研究目的的条目。只返回 {ids:[string]}，最多20条。不要改写或拆分语料，不生成新证据。',{task:'按研究目的挑选语料',purpose:query||corpus.name,domain:corpus.domain,section,candidates:allowed.map(row=>({id:row.id,title:row.title,text:row.sourceText.slice(0,2000)}))},status,signal);if(!Array.isArray(result.value.ids))throw Error('未返回有效的语料选择');const ids=new Set(result.value.ids);materials=allowed.filter(row=>ids.has(row.id));}
		if(signal?.aborted)throw Error('已取消语料整理');let added=0;
		for(const material of materials){if(E.corpus.get(id).entries.some(row=>row.materialID===material.id))continue;await E.corpus.saveEntry(id,{title:material.title,text:material.sourceText,section:section||material.sectionType||'引言',tags:material.tags||[],paperItemID:material.paperItemID||material.anchor?.paperItemID,materialID:material.id,origin:'source',uri:material.anchor?.url,anchor:material.anchor,sourceRevision:material.revision});added++;}return {added};
	};
	E.corpus.importProject=async(projectID,corpusID,entryIDs)=>{
		const corpus=E.corpus.get(corpusID);if(!corpus)throw Error('语料库不存在');const project=E.notebook?.project(projectID)||E.manuscripts.get(projectID);if(!project)throw Error('论文项目不存在');const entries=C.selectedCorpusMaterials(corpus,entryIDs,{researchScope:Domain.researchScopeFromProject(project)});if(!entries.length)throw Error('请勾选要导入的语料');
		// catalog saves through the manuscript revision guard. Advancing the
		// revision before that save makes a valid import look like a stale edit.
		let count=0;const apply=project=>{for(const entry of entries){if(project.materials.some(row=>row.corpusID===corpusID&&row.corpusEntryID===entry.corpusEntryID))continue;project.materials.push(M.material(entry));count++;}};
		if(E.notebook?.catalog)await E.notebook.catalog(projectID,apply);else await E.store.update(state=>{const current=state.manuscripts[projectID];if(!current)throw Error('论文项目不存在');apply(current);current.revision++;current.updatedAt=new Date().toISOString();});
		E.manuscripts.notifyAssetsChanged?.();return {count};
	};
	E.importZoteroLibrary=async(win=Zotero.getMainWindow())=>{
		const file=await E.pick(win,'选择 Zotero 导出的文库（RDF、RIS、BibTeX 或 JSON）','file','rdf;ris;bib;json');if(!file)return {cancelled:true};
		if(/\.sqlite$/i.test(file))throw Error('请选择 Zotero 导出的文库文件。原始数据库不能作为导入文件。');
		const imported=await win.Zotero_File_Interface.importFile({file,createNewCollection:true,linkFiles:false});if(!imported)throw Error('文库未导入，请确认文件格式与附件路径');return {imported:true};
	};
	E.openResearchResources=async(win=Zotero.getMainWindow(),options={})=>{
		const old=win.document.getElementById('easysch-research-resources');if(old){old.resourceOptions=options;win.Zotero_Tabs.select(old.parentElement.id);old.contentWindow?.ResearchResourcesUI?.open(options);return old.contentWindow;}
		const frame=win.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.id='easysch-research-resources';frame.resourceOptions=options;frame.style.cssText='border:0;width:100%;height:100%;flex:1;';
		const {container}=win.Zotero_Tabs.add({type:'research',title:'研究语料库',data:{resourceView:'corpus'},select:true});container.style.display='flex';container.append(frame);frame.src='chrome://zotero/content/research/research-resources.html';return frame.contentWindow;
	};
	E.weeklyResearch=async(options={})=>{
		const all=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,false,false),rows=[];
		for(const item of all){if(item.deleted)continue;const kind=item.isNote()?'note':item.isAnnotation()?'annotation':item.isRegularItem()?'paper':null;if(!kind)continue;let text='';if(kind==='note')text=Zotero.Utilities.cleanTags(item.getNote());else if(kind==='annotation')text=[item.annotationText,item.annotationComment].filter(Boolean).join('\n');rows.push({id:item.id,kind,title:kind==='annotation'?'原文批注':item.getField('title')||item.getNoteTitle?.(),text,paperItemID:kind==='annotation'?item.parentItem?.parentID:item.parentID,uri:E.library.uri(item),dateAdded:item.dateAdded,dateModified:item.dateModified});}
		return W.weeklyResearchEntries(E.store.get(),rows,options);
	};
	E.studio.createWeekly=async(status=()=>{},signal)=>{
		status('正在汇总过去七天的阅读、批注和研究记录…');const report=await E.weeklyResearch();if(signal?.aborted)throw Error('已取消');if(!report.entries.length)throw Error('过去七天没有研究记录。阅读、批注或保存研究笔记后可生成周报。');
		const content=W.weeklyPresentation(report),ids=new Set(report.entries.map(row=>row.paperItemID).filter(Boolean)),papers=[];for(const id of ids){const item=await Zotero.Items.getAsync(id);if(item?.isRegularItem())papers.push(E.library.describe(item));}
		const draft=await E.studio.create(papers.slice(0,12),{mode:'weekly'});return E.studio.patch(draft.id,next=>{next.title='本周研究进展 · '+report.end.slice(0,10);next.templateID='progress';next.weeklyRange={start:report.start,end:report.end};next.sources=content.sources;next.slides=content.slides;next.outline=content.outline;next.outlineApproved=true;next.materialsReady=true;next.step=5;next.weeklyEntryIDs=report.entries.map(row=>row.id);});
	};
	E.startResearchActivity=()=>{
		const seen=new Set(),observer=Zotero.Notifier.registerObserver({notify(event,type,ids){if(type!=='tab'||event!=='select')return;for(const tabID of ids){const reader=Zotero.Reader.getByTabID(tabID),attachment=reader?.itemID&&Zotero.Items.get(reader.itemID),paper=attachment?.parentItem||attachment;if(!paper)continue;const at=new Date().toISOString(),id=paper.id+'-'+at.slice(0,10);if(seen.has(id))continue;seen.add(id);E.store.update(state=>{state.researchActivity||=[];if(!state.researchActivity.some(row=>row.id===id))state.researchActivity.push({id,paperItemID:paper.id,title:paper.getField('title'),text:'阅读论文',at,uri:E.library.uri(attachment)});state.researchActivity=state.researchActivity.slice(-2000);}).catch(Zotero.logError);}}},['tab'],'easysch-weekly-reading');Zotero.addShutdownListener(()=>Zotero.Notifier.unregisterObserver(observer));
	};
})(Zotero.Research);
