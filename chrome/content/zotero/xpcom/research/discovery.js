/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
 const Ref=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs');
 const ReferenceMetadata=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-metadata.mjs');
 const Feed=ChromeUtils.importESModule('chrome://zotero/content/research/shared/discovery-feed.mjs');
 ChromeUtils.importESModule('chrome://zotero/content/research/shared/workspace-outputs.mjs').installWorkspaceOutputs(E,{Zotero,IOUtils:globalThis.IOUtils});
 const pdfReferenceTasks=new Map(),referenceControllers=new Set();let stopping=false;
 const checkReferences=signal=>{if(stopping||signal?.aborted)throw Error('已取消参考文献收集');};
 const referenceController=()=>{const controller=new (Zotero.getMainWindow().AbortController)();referenceControllers.add(controller);return controller;};
 E.referencesFromPDF=async(paper,{signal}={})=>{
  const item=await Zotero.Items.getAsync(paper.id),attachment=item?.isPDFAttachment()?item:await item?.getBestAttachment();
  if(!attachment?.isPDFAttachment())throw Error('这篇论文没有可读取的 PDF 附件');
  const path=await attachment.getFilePathAsync(),stat=path?await IOUtils.stat(path):null,key=Ref.REFERENCE_PARSE_VERSION+':'+attachment.id+':'+stat?.size+':'+stat?.lastModified;
  let task=pdfReferenceTasks.get(key);if(!task){task=(async()=>{const {text}=await Zotero.PDFWorker.getFullText(attachment.id,null),records=Ref.parseReferenceText(text);if(!records.length)throw Error('没有可靠识别 PDF 参考文献；未猜测引用关系');return {records,url:E.library.uri(attachment),version:E.assets.key(text)};})();pdfReferenceTasks.set(key,task);task.catch(()=>pdfReferenceTasks.delete(key));for(const old of [...pdfReferenceTasks.keys()].slice(0,-8))pdfReferenceTasks.delete(old);}
  const result=await task;if(signal?.aborted)throw Error('已取消');return {...result,records:result.records.map(ref=>({...ref,attachmentID:attachment.id,parentItemID:paper.id}))};
 };
 let lookupTail=Promise.resolve(),lastLookup=0;
 const referenceTasks=new Map(),metadataTasks=new Map();
 // A paper can resolve 300 references. Write their metadata every 20 lookups
 // or 2 s, and when a collection settles, rather than once per lookup.
 let referenceWriter=Feed.createStoreBranchWriter?Feed.createStoreBranchWriter(E,'referenceMetadata',{maxPending:20,onError:error=>Zotero.logError(error)}):{
	get:key=>E.store.get('referenceMetadata',key),
	set:(key,value)=>E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[key]=value;}),
	flush:()=>Promise.resolve()
 };
 E.collectReferences=async(paper,{signal,refresh=false,onProgress=()=>{}}={})=>{
  checkReferences(signal);
  let sourceVersion='metadata';const item=await Zotero.Items.getAsync(paper.id),attachment=item?.isPDFAttachment()?item:await item?.getBestAttachment();const path=await attachment?.getFilePathAsync();if(path){const stat=await IOUtils.stat(path);sourceVersion=attachment.id+':'+stat.size+':'+stat.lastModified;}
  const key='resolved-refs-v6:'+Ref.REFERENCE_PARSE_VERSION+':'+paper.id+':'+Ref.cleanDOI(paper.doi),cached=E.store.get('discovery',key);
  if(!refresh&&cached&&cached.referenceParseVersion===Ref.REFERENCE_PARSE_VERSION&&cached.sourceVersion===sourceVersion&&Date.now()-Date.parse(cached.at)<86400000){onProgress({done:cached.total,total:cached.total,found:cached.records.length,references:cached.references,records:cached.records,complete:true});return {...cached,cacheHit:true};}
  const taskKey=key+':'+sourceVersion;let task=referenceTasks.get(taskKey);if(task?.controller.signal.aborted){referenceTasks.delete(taskKey);task=null;}
  if(!task){
   task={listeners:new Set(),latest:null,controller:referenceController()};const workSignal=task.controller.signal;
   const notify=progress=>{task.latest=progress;for(const listener of task.listeners)try{listener(progress);}catch(error){Zotero.logError(error);}};
   task.promise=(async()=>{
  let refs=[],url='',notes=[];
  // Preserve PDF numbering and show all original references before the first
  // remote lookup. Publisher metadata is a fallback, not another row set.
  if(attachment)try{const pdf=await E.referencesFromPDF(paper,{signal:workSignal});refs=pdf.records;url=pdf.url;}catch(error){checkReferences(workSignal);notes.push(error.message);}
  checkReferences(workSignal);
  if(!refs.length&&paper.doi)try{
   url='https://api.crossref.org/works/'+encodeURIComponent(Ref.cleanDOI(paper.doi));
   const data=JSON.parse(await E.requestProvider(url,{signal:workSignal},12000)).message;checkReferences(workSignal);
   if(Ref.cleanDOI(data.DOI)!==Ref.cleanDOI(paper.doi))throw Error('返回的论文 DOI 不一致');
   refs=(data.reference||[]).map((r,i)=>({...Ref.referenceFromCrossref(r,i),parentItemID:paper.id,parentDOI:Ref.cleanDOI(paper.doi),sourceURL:url}));
  }catch(e){checkReferences(workSignal);notes.push('出版者题录不可用：'+e.message);}
  if(!refs.length)throw Error('暂未读取到参考文献'+(notes.length?'：'+notes.join('；'):''));
  const partial=new Map();notify({done:0,total:refs.length,found:0,references:refs,records:[]});
  const lookupOne=async ref=>{
   checkReferences(workSignal);
   const query=ref.title||ref.quote,arxiv=!ref.doi&&Ref.referenceArxiv(ref.quote),k=ref.doi?'doi:'+ref.doi:arxiv?'arxiv:'+arxiv:'bibliography:'+E.assets.key(query),entry=referenceWriter.get(k);
   // A retry only bypasses negative/failure entries; successfully acquired
   // metadata is reused. Different panes and papers share the same lookup.
   if(entry&&Date.now()-entry.at<(entry.records.length?604800000:3600000)&&(entry.records.length||entry.lookupVersion===ReferenceMetadata.REFERENCE_LOOKUP_VERSION&&!refresh)){if(entry.error)throw Error(entry.error);return entry.records;}
   return ReferenceMetadata.consumeReferenceTask(metadataTasks,k,async metadataSignal=>{try{
   const wait=lookupTail.then(async()=>{checkReferences(metadataSignal);await Zotero.Promise.delay(Math.max(0,lastLookup+180-Date.now()));checkReferences(metadataSignal);lastLookup=Date.now();});lookupTail=wait.catch(()=>{});await wait;
   const records=await ReferenceMetadata.lookupReferenceMetadata(E,ref,{signal:metadataSignal,Parser:Zotero.getMainWindow().DOMParser});checkReferences(metadataSignal);
   checkReferences(metadataSignal);await referenceWriter.set(k,{at:Date.now(),records,lookupVersion:ReferenceMetadata.REFERENCE_LOOKUP_VERSION});return records;
   }catch(error){checkReferences(metadataSignal);await referenceWriter.set(k,{at:Date.now(),records:[],error:error.message,lookupVersion:ReferenceMetadata.REFERENCE_LOOKUP_VERSION});throw error;}finally{for(const controller of referenceControllers)if(controller.signal===metadataSignal)referenceControllers.delete(controller);}}, {signal:workSignal,createController:referenceController});
  };
  const result={...await Ref.resolveReferences(refs,{lookup:lookupOne,signal:workSignal,limit:300,budget:Infinity,onProgress:progress=>{if(progress.record)partial.set(progress.index,progress.record);notify({...progress,references:refs,records:[...partial.values()]});}}),references:refs,url,notes,sourceVersion,referenceParseVersion:Ref.REFERENCE_PARSE_VERSION,at:new Date().toISOString(),cacheHit:false};
  checkReferences(workSignal);
  await E.store.update(s=>{s.discovery||={};s.discovery[key]=result;});notify({done:refs.length,total:refs.length,found:result.records.length,references:refs,records:result.records,complete:true});return result;
   })();referenceTasks.set(taskKey,task);task.promise.finally(()=>{task.settled=true;if(referenceTasks.get(taskKey)===task)referenceTasks.delete(taskKey);referenceControllers.delete(task.controller);referenceWriter.flush().catch(error=>Zotero.logError(error));}).catch(()=>{});
  }
  const listener=progress=>{if(!signal?.aborted)onProgress(progress);};task.listeners.add(listener);if(task.latest)listener(task.latest);
  // Detaching one pane must not cancel another pane's shared background job.
  let abort;try{return await Promise.race([task.promise,new Promise((_,reject)=>{if(signal){abort=()=>reject(Error('已取消'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}})]);}finally{task.listeners.delete(listener);if(abort)signal.removeEventListener('abort',abort);if(!task.listeners.size&&!task.settled)task.controller.abort();}
 };
 Zotero.addShutdownListener(async()=>{
  stopping=true;for(const controller of referenceControllers)controller.abort();
  // Queue unwritten reference metadata before any other shutdown step awaits.
  let pendingReferences=referenceWriter.flush().catch(error=>Zotero.logError(error));
  await E.stopJournalSubscriptions?.();
  await Promise.allSettled([...referenceTasks.values(),...metadataTasks.values()].map(task=>task.promise));
  await pendingReferences;await referenceWriter.flush().catch(error=>Zotero.logError(error));
  await E.store?.flush?.();
 });
	const graph = 'https://api.semanticscholar.org/graph/v1/',
		fields =
			'paperId,title,abstract,year,publicationDate,url,externalIds,authors,venue,openAccessPdf';
	const normalize = (p) => ({
		source: 'Semantic Scholar',
		id: p.paperId,
		title: p.title || '未提供标题',
		abstract: p.abstract || '',
		date: p.publicationDate || String(p.year || ''),
		doi: p.externalIds?.DOI || '',
		url: p.url || '',
		journal: p.venue || '',
		pdf: p.openAccessPdf?.url || '',
		authors: (p.authors || []).map((a) => ({
			lastName: a.name,
			firstName: '',
			fieldMode: 1,
		})),
	});
	E.discoverySearch=async(query,{signal,provider='semantic'}={})=>{if(provider==='crossref'){const data=JSON.parse(await E.requestProvider('https://api.crossref.org/works?query='+encodeURIComponent(query)+'&rows=8&filter=has-abstract:true',{signal}));const parser=new (Zotero.getMainWindow().DOMParser)();return (data.message?.items||[]).map(p=>({id:p.DOI,doi:p.DOI,title:p.title?.[0]||'',abstract:parser.parseFromString(p.abstract||'','text/html').body.textContent,url:p.URL||'https://doi.org/'+p.DOI,date:String(p.published?.['date-parts']?.[0]?.[0]||''),source:'Crossref'}));}const data=JSON.parse(await E.requestProvider(graph+'paper/search?query='+encodeURIComponent(query)+'&limit=8&fields='+fields,{signal}));return (data.data||[]).map(normalize);};
 // Metadata-first open-access browsing. Page cursors stay with their provider.
 const pageTasks=new Map();
 E.searchPaperPage=async(query,{provider='',page=1,cursor,filters={},limit=40,signal,researchScope,domain,onProgress,fillPage=false,refresh=false,domainMatch,queryExpansion,scanBudget}={})=>{
  const scope=Feed.normalizeResearchScope(researchScope||domain||{}),inputQuery=String(query||'').trim(),discovery=['rank','strict'].includes(domainMatch);query=Feed.buildResearchQuery(scope,inputQuery);if(!query&&!scope.topicID)throw Error('请输入研究主题');limit=Math.min(100,Math.max(5,limit));page=Math.max(1,page);
  if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});
  // A discovery search prepares its query once, with at most one model call
  // (translation and expansion together); every source then uses that result.
  let prepared=discovery?await E.prepareDiscoveryQuery(inputQuery,scope,signal,{domainMatch,queryExpansion,onPhase:phase=>onProgress?.({records:[],phase,partial:true})}):null;
  const choice=Feed.discoveryFilters(filters),topicRestricts=!!scope.topicID&&!(prepared?.domainMatch==='rank'&&prepared.groups?.length),restricted=choice.journalOnly||choice.sourceIDs.length||choice.topOnly||topicRestricts,key='pdf-search-v9-verified:'+JSON.stringify([prepared?prepared.query:query,provider,page,cursor,choice,limit,prepared?prepared.researchScope:scope,fillPage,prepared?.domainMatch||'',prepared?Number(scanBudget?.batches)||0:0]);if(topicRestricts&&provider&&provider!=='openalex')throw Error('所选在线研究主题需要 OpenAlex；可改用自定义领域名称检索其他来源。');if(['semantic','arxiv'].includes(provider)&&(choice.journalOnly||choice.sourceIDs.length))throw Error('当前来源不支持精确期刊筛选，请选择 OpenAlex、Crossref 或 Europe PMC。');if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});let active=pageTasks.get(key),task=active&&!active.signal?.aborted?active.promise:null;
  // A cached page whose journal lookup failed or had no key is fetched again, as in the feed.
  if(!task){task=(async()=>{const cache=Feed.discoveryBranch(E,'paperSearchPages',key);if(!refresh&&cache?.result?.records?.length&&Date.now()-cache.at<3600000&&!['failed','no-key'].includes(cache.result.scan?.metricLookup)){const snapshot=Feed.discoveryEnrichment(E);return{...cache.result,records:Feed.applyDiscoveryFilters(cache.result.records.map(row=>Feed.enrichDiscoveryRecord(row,E,snapshot)),choice),cacheHit:true};}
   // Each request already carries cancellation and provider cooldowns. A
   // global one-second queue here delayed unrelated and obsolete searches.
   if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});
   const started=Date.now(),scans=[];let result,fallback,errors=[];for(const name of provider?[provider]:restricted?['openalex']:['openalex','semantic','arxiv'])try{
    const offset=(page-1)*limit;let rows=[],more=false,total=0;
    if(['openalex','crossref','europepmc'].includes(name)){
     // Restricted searches may use the journal-aware fallback indexes; an
     // unrestricted one moves on to Semantic Scholar and arXiv below.
     const feed=await E.recommendationFeed({mode:'latest',query:inputQuery,researchScope:scope,page,cursor,limit,signal,provider:name,filters:{...choice,sort:choice.sort||'relevance'},onProgress,fillPage,refresh,...(prepared?{prepared,domainMatch:prepared.domainMatch,scanBudget,emptyFallback:!provider&&restricted}:{})});if(feed.error&&!feed.records.length)throw Error(feed.error);if(feed.scan)scans.push(feed.scan);result={...feed,provider:feed.providerID||name,providerName:feed.provider||'本地文库',query:prepared?prepared.query:query,limitations:[...errors,...(feed.limitations||[])]};
     if(prepared&&!provider&&!restricted&&!feed.records.length&&!feed.hasMore&&!feed.fallback&&!feed.scan?.total){fallback=result;result=undefined;continue;}
     if(!feed.error||provider||restricted)break;fallback=result;result=undefined;errors.push(feed.error);continue;
    }else if(name==='semantic'){
     prepared||=await E.prepareDiscoveryQuery(inputQuery,scope,signal);query=discovery?String(prepared.plainQuery||prepared.query):prepared.query;
     const range=Feed.discoveryDateRange(choice),year=range.from||range.to?'&year='+encodeURIComponent((range.from?range.from.slice(0,4):'')+'-'+(range.to?range.to.slice(0,4):'')):'';const data=JSON.parse(await E.requestProvider(graph+'paper/search?query='+encodeURIComponent(query)+'&openAccessPdf&offset='+offset+'&limit='+limit+'&fields='+fields+',citationCount'+year,{signal},20000));rows=(data.data||[]).map(p=>({...normalize(p),oa:true,citationCount:p.citationCount??null,retracted:null}));more=data.next!=null;total=Number(data.total)||rows.length;
    }else if(name==='arxiv'){prepared||=await E.prepareDiscoveryQuery(inputQuery,scope,signal);query=discovery?String(prepared.plainQuery||prepared.query):prepared.query;const data=await E.arxivSearchPage(query,{page,limit,signal,filters:choice});rows=data.records.map(p=>({...p,oa:true,retracted:null,citationCount:null,sourceType:'repository'}));more=data.hasMore;total=Number(data.total)||rows.length;}else throw Error('不支持的文献来源');
    // Discovery counts what each step removed, as the feed does.
    let scan=null;if(discovery){scan={scanned:0,matched:0,total,removed:{},relax:{},metricLookup:'',metricFailed:0};rows=E.screenDiscoveryBatch?await E.screenDiscoveryBatch(rows,{name,prepared,choice,stats:scan,signal,until:started+(Number(scanBudget?.ms)||20000)}):Feed.applyDiscoveryFilters(Feed.screenDiscoveryRows(rows,{name,prepared,stats:scan,choice,E}),choice);}
    else{const seen=new Set(),snapshot=Feed.discoveryEnrichment(E);rows=Feed.applyDiscoveryFilters(rows.map(row=>Feed.enrichDiscoveryRecord(row,E,snapshot)),choice).filter(r=>{const id=String(r.doi||r.url||r.id).toLowerCase();if(!r.title||!id||seen.has(id)||!(prepared?Feed.matchesPreparedDiscoveryScope(r,prepared):Feed.matchesResearchScope(r,scope)))return false;seen.add(id);return true;});}
    const verified=await Feed.verifiedDiscoveryRecords(E,rows,{signal,refresh,onProgress:progress=>onProgress?.({...progress,provider:name,page,nextPage:page,nextCursor:cursor,hasMore:true,effectiveResearchScope:prepared?.researchScope||scope,query,partial:true})}),failed=rows.length-verified.records.length;rows=scan?Feed.applyDiscoveryFilters(verified.records,choice):verified.records;
    if(scan){if(failed>0)scan.removed.probe=(scan.removed.probe||0)+failed;scan.exhausted=!more;scan.budgetHit=more&&!rows.length;scans.push(scan);}
    const notes=scan?[...(prepared.warning?[prepared.warning]:[]),...(prepared.notes||[]),...(scan.metricLookup==='no-key'?['未配置 easyScholar 密钥，期刊 TOP 无法核验；可在设置中保存密钥，或选择“包含未核验期刊”。']:[]),...(failed>0?[failed+' 篇论文的公开地址暂未通过 PDF 获取检查，已从可下载结果中排除。']:[])]:[];
    result={records:rows,effectiveResearchScope:prepared?.researchScope||scope,searchQuery:query,provider:name,page,nextPage:page+1,nextCursor:null,hasMore:more,cacheHit:false,filters:choice,filterOptions:{journals:Feed.discoveryJournalOptions(rows)},limitations:[...errors,...Feed.discoveryFilterLimitations(choice),...notes],query,...(scan?{scan}:{}),...(scan&&prepared.queryExpansion?{queryExpansion:prepared.queryExpansion}:{})};if(rows.length||provider)break;
   }catch(e){if(signal?.aborted||e.name==='AbortError')throw e;errors.push(name+'：'+e.message);}
   if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});if(fallback&&!result?.records.length&&!result?.hasMore)result={...fallback,limitations:[...new Set([...(fallback.limitations||[]),...errors])]};if(!result)throw Error('联网检索失败：'+errors.join('；'));
   // The status line counts every source this search scanned.
   if(scans.length>1)result={...result,scan:{...Feed.mergeDiscoveryScanStats(...scans),exhausted:!result.hasMore,budgetHit:!!result.hasMore&&!result.records.length}};
   if(['openalex','crossref','europepmc'].includes(result.provider))return result;await E.store.update(s=>{s.paperSearchPages||={};s.paperSearchPages[key]={at:Date.now(),result};const keys=Object.keys(s.paperSearchPages);for(const k of keys.slice(0,Math.max(0,keys.length-80)))delete s.paperSearchPages[k];});return result;
  })();active={promise:task,signal};pageTasks.set(key,active);task.finally(()=>{if(pageTasks.get(key)===active)pageTasks.delete(key);}).catch(()=>{});}
  const result=await task;if(signal?.aborted)throw Error('已取消');return result;
 };
 E.candidateMetric=async(record,{needTop=false}={})=>{if(!record.journal)return null;const item=new Zotero.Item('journalArticle');item.setField('publicationTitle',record.journal);if(record.issn)item.setField('ISSN',record.issn);return await E.ensurePaperMetrics(item,{needTop});};
 // Saves PDF bytes that have already arrived as the item's attachment; arxiv.js
 // uses the same step after its own download.
 E.attachDiscoveryPDF=async(item,bytes,record)=>{const path=PathUtils.join(Zotero.getTempDirectory().path,'easysch-oa-'+Zotero.Utilities.randomString(12)+'.pdf');try{await IOUtils.write(path,bytes);const attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:item.id,contentType:'application/pdf',title:record.title});attachment.setField('url',record.pdf);await attachment.saveTx({skipSelect:true});return attachment;}finally{await IOUtils.remove(path,{ignoreAbsent:true});}};
 const oaTasks=new Map();
 E.obtainOpenPaper=async(record,options={})=>{
  const {onProgress=()=>{},signal}=options,target=E.resolveAcademicTarget?await E.resolveAcademicTarget(options):{libraryID:options.libraryID,collectionID:options.collectionID};
  if(!record.oa||record.retracted)throw Error('此候选未确认可公开获取，或已标记撤稿；请先核对来源。');
  const key=String(target.libraryID||'')+':'+(record.doi||record.url||record.id);if(oaTasks.has(key)){const result=await oaTasks.get(key);if(E.placeAcademicInCollection)await E.placeAcademicInCollection(result.itemID,target);return{...result,...target};}
  const task=(async()=>{
   // Only an arXiv record (arxivRecordID) is filed as an arXiv preprint. A journal
   // article whose open copy is on arxiv.org keeps its own item type and journal.
   if(Ref.arxivRecordID(record))return E.importAcademicPDF(record,{open:false,onProgress,signal,...target});
   // The record is filed only after its PDF bytes have arrived.
   let found=E.findAcademicItem&&await E.findAcademicItem(record,target),attachment=found&&await E.library.localPDF(found);if(attachment){await E.placeAcademicInCollection?.(found.id,target);return{itemID:found.id,attachmentID:attachment.id,reused:true,...target};}
   if(!record.pdf||!/^https:\/\//.test(record.pdf))throw Error('暂无直接公开 PDF；文库没有变化，可打开来源页面。');
   if(Zotero.Libraries?.get?.(target.libraryID)?.filesEditable===false)throw Error('目标文库不能保存附件');if(signal?.aborted)throw Error('已取消');onProgress({stage:'download',text:'正在下载 PDF…'});
   // A failed download is recorded by the rule of the probe in obtainPaper (see arxivPDF). Its
   // error.lasting, as on discoveryPDFUnavailable's errors, tells the reference pane not to offer a retry.
   let bytes;try{bytes=await E.requestDiscoveryPDF(record.pdf,{signal,onProgress:progress=>onProgress({stage:'download',text:'正在下载 PDF…',...progress})});}catch(error){if(signal?.aborted||error?.name==='AbortError')throw error;let lasting=lastingPDF(String(error?.message??error));if(!arxivPDF(record.pdf)||lasting)await E.markDiscoveryPDFFailure?.(record.pdf,error);if(error&&typeof error==='object')error.lasting=lasting;throw error;}
   onProgress({stage:'save',text:'正在保存 PDF…'});
   let saved=await E.importAcademic(record,{select:false,...target}),item=await Zotero.Items.getAsync(saved.id);attachment=await E.library.localPDF(item);if(attachment)return{itemID:item.id,attachmentID:attachment.id,reused:true,...target};
   attachment=await E.attachDiscoveryPDF(item,bytes,record);
   await E.clearDiscoveryPDFFailure?.(record.pdf);E.manuscripts.queueArticle(attachment.id);return{itemID:item.id,attachmentID:attachment.id,downloaded:true,...target};
  })();oaTasks.set(key,task);try{return await task;}finally{oaTasks.delete(key);}
 };

	E.discover = async (
		paper,
		kind = 'references',
		{ signal, refresh = false, onProgress } = {},
	) => {
		if (kind === 'references') return E.collectReferences(paper,{signal,refresh,onProgress});
		if (!paper?.doi)
			throw Error(
				'当前论文没有 DOI。请先补全 DOI，或使用上方标题搜索；不会猜测引用关系。',
			);
		const key = paper.doi.toLowerCase() + ':' + kind,
			cached = E.store.get('discovery',key);
		if (!refresh && cached && Date.now() - Date.parse(cached.at) < 86400000)
			return { ...cached, cacheHit: true };
		let url, records;
		{
			const id = 'DOI:' + paper.doi;
			if (kind === 'citations') {
				url =
					graph +
					'paper/' +
					encodeURIComponent(id) +
					'/citations?limit=100&fields=' +
					fields;
				const data = JSON.parse(await E.requestProvider(url, { signal }));
				records = (data.data || []).map((x) => ({
					...normalize(x.citingPaper),
					reason: 'Semantic Scholar 收录的被引关系',
				}));
			} else if (kind === 'similar') {
				const p = JSON.parse(
					await E.requestProvider(
						graph + 'paper/' + encodeURIComponent(id) + '?fields=paperId',
						{ signal },
					),
				);
				url =
					'https://api.semanticscholar.org/recommendations/v1/papers/forpaper/' +
					p.paperId +
					'?limit=20&fields=' +
					fields;
				const data = JSON.parse(await E.requestProvider(url, { signal }));
				records = (data.recommendedPapers || []).map((p) => ({
					...normalize(p),
					reason: 'Semantic Scholar 推荐；相似性不代表支持论文结论',
				}));
			} else throw Error('不支持的发现类型');
		}
		if (signal?.aborted) throw Error('已取消');
		const result = {
			records,
			url,
			at: new Date().toISOString(),
			cacheHit: false,
		};
		await E.store.update((s) => {
			s.discovery ||= {};
			s.discovery[key] = result;
		});
		return result;
	};
 const obtaining=new Map();
 let pdfReason=error=>{let text=String(error||'').replace(/[，,]\s*(?:请重试|未保存为?附件)$/,'');return /\p{Script=Han}/u.test(text)?text:'来源暂时无法访问';};
 // A failure that repeats on every attempt at this address: 404/410, a web or
 // verification page, content that is not a PDF, or more than the 80 MB limit.
 let lastingPDF=text=>/（HTTP 4(?:04|10)）|返回网页或验证页面|返回非 PDF|超过 80 MB/.test(text);
 // arxiv.org turns automated access away for a while (403, 429, 5xx) and then lets it in again.
 // As in arxiv.js, an address there is recorded only for a failure that will repeat, whichever
 // row reached it; another host's refusal is recorded as before.
 let arxivPDF=url=>/^https:\/\/(?:export\.|www\.)?arxiv\.org\//i.test(url||'');
 // One wording for a public PDF that could not be fetched; unchanged says what
 // happened to the library. Only a failure that can pass says it can be retried;
 // the error's lasting says which, for a caller that records the address.
 E.discoveryPDFUnavailable=(error,unchanged)=>{let text=String(error?.message??error??''),lasting=lastingPDF(text),reason=pdfReason(text);return Object.assign(Error(lasting?reason+'；'+unchanged:'公开 PDF 暂不可用：'+reason+'；'+unchanged+'，可稍后重试'),{lasting});};
 E.obtainPaper=async(record,options={})=>{
  const{open=true,onProgress=()=>{},signal}=options,target=E.resolveAcademicTarget?await E.resolveAcademicTarget(options):{libraryID:options.libraryID,collectionID:options.collectionID},key=String(target.libraryID||'')+':'+(Ref.cleanDOI(record.doi)||record.url||record.id);
  let task=obtaining.get(key);
  if(!task){task=(async()=>{
   onProgress({stage:'lookup',text:'正在匹配文库…'});
   // Nothing is filed until a public PDF is resolved and probed; obtainOpenPaper
   // files the record only after the download.
   let existing=E.findAcademicItem&&await E.findAcademicItem(record,target),local=existing&&await E.library.localPDF(existing);
   if(local)return {itemID:existing.id,attachmentID:local.id,reused:true,path:await local.getFilePathAsync()};
   let unchanged=existing?'文库中的这条题录没有改动':'文库没有变化',candidate={...record};
   if(candidate.retracted)throw Error('该论文标记为撤稿，已停止自动下载');
   if(!/^https:\/\//i.test(candidate.pdf||'')&&candidate.doi){
    onProgress({stage:'resolve',text:'正在查找公开全文…'});
    try{const data=JSON.parse(await E.requestProvider('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(candidate.doi),{signal},15000));
     if(data.is_retracted)throw Error('该论文标记为撤稿，已停止自动下载');
     const location=[data.best_oa_location,...(data.locations||[])].find(x=>x?.is_oa&&/^https:\/\//i.test(x.pdf_url||''));
     if(location)candidate={...candidate,pdf:location.pdf_url,oa:true};
    }catch(error){if(error.message.includes('撤稿'))throw error;}
   }
   if(!/^https:\/\//i.test(candidate.pdf||''))throw Error('未找到公开 PDF；'+unchanged+'，可稍后重试');
   if(E.verifyDiscoveryPDF){onProgress({stage:'verify',text:'正在检查公开 PDF…'});let check=await E.verifyDiscoveryPDF(candidate.pdf,{signal});if(!check?.available){let failure=E.discoveryPDFUnavailable(check?.error,unchanged);if(arxivPDF(candidate.pdf)?failure.lasting:!check?.transient)await E.markDiscoveryPDFFailure?.(candidate.pdf,check?.error);throw failure;}}
   const result=await E.obtainOpenPaper({...candidate,oa:true},{onProgress,signal,...target});
   const attachment=await E.library.localPDF(result.attachmentID);
   if(!attachment)throw Error('附件保存失败：本机文件不可用；题录已保留');
   return {...result,path:await attachment.getFilePathAsync()};
  })();obtaining.set(key,task);task.finally(()=>obtaining.delete(key)).catch(()=>{});}
  const result=await task;if(E.placeAcademicInCollection)await E.placeAcademicInCollection(result.itemID,target);if(signal?.aborted)throw Error('已取消');const saved={...result,...target};await E.workspaceOutputs.rememberDownload(record,saved);onProgress({stage:'saved',text:'PDF 已保存'});if(open)await Zotero.Reader.open(result.attachmentID);return saved;
 };
 Feed.installDiscoveryFeed(E,{Zotero});
 const searchPage=E.searchPaperPage;E.searchPaperPage=(query,options={})=>E.runDiscoverySearchTask?E.runDiscoverySearchTask((signal,onProgress)=>searchPage(query,{...options,signal,onProgress}),options):searchPage(query,options);
 // Subscription checks stay inside the running application. No external
 // scheduler or browser tab is required, and disabled subscriptions do no I/O.
 Feed.installJournalSubscriptionTimer(E,{createController:()=>new (Zotero.getMainWindow().AbortController)(),onError:error=>Zotero.logError?.(error)});
})(Zotero.Research);
