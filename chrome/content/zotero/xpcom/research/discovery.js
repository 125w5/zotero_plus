/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
 const Ref=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs');
 const Feed=ChromeUtils.importESModule('chrome://zotero/content/research/shared/discovery-feed.mjs');
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
 E.collectReferences=async(paper,{signal,refresh=false,onProgress=()=>{}}={})=>{
  checkReferences(signal);
  let sourceVersion='metadata';const item=await Zotero.Items.getAsync(paper.id),attachment=item?.isPDFAttachment()?item:await item?.getBestAttachment();const path=await attachment?.getFilePathAsync();if(path){const stat=await IOUtils.stat(path);sourceVersion=attachment.id+':'+stat.size+':'+stat.lastModified;}
  const key='resolved-refs-v5:'+Ref.REFERENCE_PARSE_VERSION+':'+paper.id+':'+Ref.cleanDOI(paper.doi),cached=E.store.get().discovery?.[key];
  if(!refresh&&cached&&cached.referenceParseVersion===Ref.REFERENCE_PARSE_VERSION&&cached.sourceVersion===sourceVersion&&Date.now()-Date.parse(cached.at)<86400000){onProgress({done:cached.total,total:cached.total,found:cached.records.length,references:cached.references,records:cached.records,complete:true});return {...cached,cacheHit:true};}
  const taskKey=key+':'+sourceVersion;let task=referenceTasks.get(taskKey);
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
   const query=ref.title||ref.quote,arxiv=!ref.doi&&Ref.referenceArxiv(ref.quote),k=ref.doi?'doi:'+ref.doi:arxiv?'arxiv:'+arxiv:'bibliography:'+E.assets.key(query),entry=E.store.get().referenceMetadata?.[k];
   // A retry only bypasses negative/failure entries; successfully acquired
   // metadata is reused. Different panes and papers share the same lookup.
   if(entry&&Date.now()-entry.at<(entry.records.length?604800000:3600000)&&(entry.records.length||!refresh)){if(entry.error)throw Error(entry.error);return entry.records;}
   if(metadataTasks.has(k))return metadataTasks.get(k);
   const controller=referenceController(),metadataSignal=controller.signal;
   const metadata=(async()=>{try{
   const wait=lookupTail.then(async()=>{checkReferences(metadataSignal);await Zotero.Promise.delay(Math.max(0,lastLookup+180-Date.now()));checkReferences(metadataSignal);lastLookup=Date.now();});lookupTail=wait.catch(()=>{});await wait;
   if(arxiv){const p=await E.arxivMetadata(arxiv,{signal:metadataSignal});checkReferences(metadataSignal);await E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[k]={at:Date.now(),records:[p]};});return [p];}
   const target=ref.doi?'https://api.crossref.org/works/'+encodeURIComponent(ref.doi):'https://api.crossref.org/works?query.bibliographic='+encodeURIComponent(query.slice(0,700))+'&rows=3';
   const data=JSON.parse(await E.requestProvider(target,{signal:metadataSignal},10000)).message;checkReferences(metadataSignal);
   const records=(ref.doi?[data]:data.items||[]).map(Ref.crossrefRecord);
   const parser=new (Zotero.getMainWindow().DOMParser)();for(const p of records)p.abstract=parser.parseFromString(p.abstract||'','text/html').body.textContent;
   await E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[k]={at:Date.now(),records};});return records;
   }catch(error){checkReferences(metadataSignal);await E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[k]={at:Date.now(),records:[],error:error.message};});throw error;}finally{referenceControllers.delete(controller);}})();
   metadataTasks.set(k,metadata);try{return await metadata;}finally{metadataTasks.delete(k);}
  };
  const result={...await Ref.resolveReferences(refs,{lookup:lookupOne,signal:workSignal,limit:300,budget:Infinity,onProgress:progress=>{if(progress.record)partial.set(progress.index,progress.record);notify({...progress,references:refs,records:[...partial.values()]});}}),references:refs,url,notes,sourceVersion,referenceParseVersion:Ref.REFERENCE_PARSE_VERSION,at:new Date().toISOString(),cacheHit:false};
  checkReferences(workSignal);
  await E.store.update(s=>{s.discovery||={};s.discovery[key]=result;});notify({done:refs.length,total:refs.length,found:result.records.length,references:refs,records:result.records,complete:true});return result;
   })();referenceTasks.set(taskKey,task);task.promise.finally(()=>{referenceTasks.delete(taskKey);referenceControllers.delete(task.controller);}).catch(()=>{});
  }
  const listener=progress=>{if(!signal?.aborted)onProgress(progress);};task.listeners.add(listener);if(task.latest)listener(task.latest);
  // Detaching one pane must not cancel another pane's shared background job.
  let abort;try{return await Promise.race([task.promise,new Promise((_,reject)=>{if(signal){abort=()=>reject(Error('已取消'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}})]);}finally{task.listeners.delete(listener);if(abort)signal.removeEventListener('abort',abort);}
 };
 Zotero.addShutdownListener(async()=>{
  stopping=true;for(const controller of referenceControllers)controller.abort();
  await Promise.allSettled([...referenceTasks.values()].map(task=>task.promise).concat([...metadataTasks.values()]));
  await E.store?.flush?.();
 });
	const graph = 'https://api.semanticscholar.org/graph/v1/',
		fields =
			'paperId,title,abstract,year,url,externalIds,authors,venue,openAccessPdf';
	const normalize = (p) => ({
		source: 'Semantic Scholar',
		id: p.paperId,
		title: p.title || '未提供标题',
		abstract: p.abstract || '',
		date: String(p.year || ''),
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
 const pageTasks=new Map();let pageTail=Promise.resolve(),pageLast=0;
 E.searchPaperPage=async(query,{provider='',page=1,cursor,filters={},limit=20,signal}={})=>{
  query=String(query).trim();if(!query)throw Error('请输入研究主题');limit=Math.min(40,Math.max(5,limit));page=Math.max(1,page);
  const choice=Feed.discoveryFilters(filters),restricted=choice.journalOnly||choice.sourceIDs.length||choice.topOnly,key='pdf-search-v4:'+JSON.stringify([query,provider,page,cursor,choice,limit]);let task=pageTasks.get(key);
  if(!task){task=(async()=>{const cache=E.store.get().paperSearchPages?.[key];if(cache&&Date.now()-cache.at<3600000)return{...cache.result,records:Feed.applyDiscoveryFilters(cache.result.records.map(row=>Feed.enrichDiscoveryRecord(row,E)),choice),cacheHit:true};
   const turn=pageTail.then(async()=>{await Zotero.Promise.delay(Math.max(0,pageLast+1000-Date.now()));pageLast=Date.now();});pageTail=turn.catch(()=>{});await turn;
   let result,fallback,errors=[];for(const name of provider?[provider]:restricted?['openalex']:['openalex','semantic','arxiv'])try{
    const offset=(page-1)*limit;let rows=[],more=false;
    if(['openalex','crossref','europepmc'].includes(name)){
     const feed=await E.recommendationFeed({mode:'latest',query,page,cursor,limit,signal,provider:name,filters:{...choice,sort:choice.sort||'relevance'}});if(feed.error&&!feed.records.length)throw Error(feed.error);result={...feed,provider:feed.providerID||name,providerName:feed.provider||'本地文库',query,limitations:[...errors,...(feed.limitations||[])]};if(!feed.error||provider||restricted)break;fallback=result;result=undefined;errors.push(feed.error);continue;
    }else if(name==='semantic'){
     const data=JSON.parse(await E.requestProvider(graph+'paper/search?query='+encodeURIComponent(query)+'&openAccessPdf&offset='+offset+'&limit='+limit+'&fields='+fields+',citationCount',{signal},20000));rows=(data.data||[]).map(p=>({...normalize(p),oa:true,citationCount:p.citationCount??null,retracted:null}));more=data.next!=null;
    }else if(name==='arxiv'){const data=await E.arxivSearchPage(query,{page,limit,signal});rows=data.records.map(p=>({...p,oa:true,retracted:null,citationCount:null,sourceType:'repository'}));more=data.hasMore;}else throw Error('不支持的文献来源');
    const seen=new Set();rows=Feed.applyDiscoveryFilters(rows.map(row=>Feed.enrichDiscoveryRecord(row,E)),choice).filter(r=>{const id=String(r.doi||r.url||r.id).toLowerCase();if(!r.title||!id||seen.has(id))return false;seen.add(id);return true;});
    result={records:rows,provider:name,page,nextPage:page+1,nextCursor:null,hasMore:more,cacheHit:false,filters:choice,filterOptions:{journals:Feed.discoveryJournalOptions(rows)},limitations:[...errors,...Feed.discoveryFilterLimitations(choice)],query};if(rows.length||provider)break;
   }catch(e){if(signal?.aborted||e.name==='AbortError')throw e;errors.push(name+'：'+e.message);}
   if(fallback&&!result?.records.length)result={...fallback,limitations:[...new Set([...(fallback.limitations||[]),...errors])]};if(!result)throw Error('联网检索失败：'+errors.join('；'));await E.store.update(s=>{s.paperSearchPages||={};s.paperSearchPages[key]={at:Date.now(),result};const keys=Object.keys(s.paperSearchPages);for(const k of keys.slice(0,Math.max(0,keys.length-80)))delete s.paperSearchPages[k];});return result;
  })();pageTasks.set(key,task);task.finally(()=>pageTasks.delete(key)).catch(()=>{});}
  const result=await task;if(signal?.aborted)throw Error('已取消');return result;
 };
 E.candidateMetric=async record=>{if(!record.journal)return null;const item=new Zotero.Item('journalArticle');item.setField('publicationTitle',record.journal);if(record.issn)item.setField('ISSN',record.issn);return await E.ensurePaperMetrics(item);};
 const oaTasks=new Map();
 E.obtainOpenPaper=async(record,options={})=>{
  const {onProgress=()=>{},signal}=options,target=E.resolveAcademicTarget?await E.resolveAcademicTarget(options):{libraryID:options.libraryID,collectionID:options.collectionID};
  if(!record.oa||record.retracted)throw Error('此候选未确认可公开获取，或已标记撤稿；请先核对来源。');
  const key=String(target.libraryID||'')+':'+(record.doi||record.url||record.id);if(oaTasks.has(key)){const result=await oaTasks.get(key);if(E.placeAcademicInCollection)await E.placeAcademicInCollection(result.itemID,target);return{...result,...target};}
  const task=(async()=>{if(/arxiv.org\/(abs|pdf)\//i.test(record.url+' '+record.pdf))return E.importAcademicPDF(record,{open:false,onProgress,signal,...target});
   onProgress({stage:'lookup',text:'正在匹配文库…'});
   const saved=await E.importAcademic(record,{select:false,...target}),item=await Zotero.Items.getAsync(saved.id);let attachment=await E.library.localPDF(item);if(attachment)return{itemID:item.id,attachmentID:attachment.id,reused:true,...target};
   if(!record.pdf||!/^https:\/\//.test(record.pdf))throw Error('题录已保留，暂无直接公开 PDF；可打开来源页面。');
   if(Zotero.Libraries?.get?.(target.libraryID)?.filesEditable===false)throw Error('目标文库不能保存附件');if(signal?.aborted)throw Error('已取消');onProgress({stage:'download',text:'正在下载 PDF…'});
   let response;try{response=await Zotero.HTTP.request('GET',record.pdf,{responseType:'arraybuffer',timeout:45000,followRedirects:true,successCodes:false});}catch(_){throw Error('公开 PDF 下载失败或超时，题录已保留');}
   if(signal?.aborted)throw Error('已取消');if(response.status<200||response.status>=300){const error=Error('公开 PDF 下载失败（HTTP '+response.status+'），题录已保留');if([401,403,404,410].includes(response.status))await E.markDiscoveryPDFFailure?.(record.pdf,error);throw error;}const bytes=new Uint8Array(response.response);try{ChromeUtils.importESModule('chrome://zotero/content/research/shared/arxiv.mjs').assertPDF(bytes);}catch(error){await E.markDiscoveryPDFFailure?.(record.pdf,error);throw error;}
   onProgress({stage:'save',text:'正在保存 PDF…'});
   const path=PathUtils.join(Zotero.getTempDirectory().path,'easysch-oa-'+Zotero.Utilities.randomString(12)+'.pdf');try{await IOUtils.write(path,bytes);attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:item.id,contentType:'application/pdf',title:record.title});attachment.setField('url',record.pdf);await attachment.saveTx({skipSelect:true});}finally{await IOUtils.remove(path,{ignoreAbsent:true});}
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
			cached = E.store.get().discovery?.[key];
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
 E.obtainPaper=async(record,options={})=>{
  const{open=true,onProgress=()=>{},signal}=options,target=E.resolveAcademicTarget?await E.resolveAcademicTarget(options):{libraryID:options.libraryID,collectionID:options.collectionID},key=String(target.libraryID||'')+':'+(Ref.cleanDOI(record.doi)||record.url||record.id);
  let task=obtaining.get(key);
  if(!task){task=(async()=>{
   onProgress({stage:'lookup',text:'正在匹配文库…'});
   const saved=await E.importAcademic(record,{select:false,...target}),item=await Zotero.Items.getAsync(saved.id);
   const local=await E.library.localPDF(item);
   if(local)return {itemID:item.id,attachmentID:local.id,reused:true,path:await local.getFilePathAsync()};
   let candidate={...record};
   if(!candidate.pdf&&candidate.doi){
    onProgress({stage:'resolve',text:'正在查找公开全文…'});
    try{const data=JSON.parse(await E.requestProvider('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(candidate.doi),{signal},15000));
     if(data.is_retracted)throw Error('该论文标记为撤稿，已停止自动下载');
     const location=[data.best_oa_location,...(data.locations||[])].find(x=>x?.is_oa&&x.pdf_url);
     if(location)candidate={...candidate,pdf:location.pdf_url,oa:true};
    }catch(error){if(error.message.includes('撤稿'))throw error;}
   }
   if(!candidate.pdf)throw Error('未找到公开 PDF；题录与摘要已保留，不加入文献阅读。');
   if(candidate.retracted)throw Error('该论文标记为撤稿，已停止自动下载');
   const result=await E.obtainOpenPaper({...candidate,oa:true},{onProgress,signal,...target});
   const attachment=await E.library.localPDF(result.attachmentID);
   if(!attachment)throw Error('附件保存失败：本机文件不可用；题录已保留');
   return {...result,path:await attachment.getFilePathAsync()};
  })();obtaining.set(key,task);task.finally(()=>obtaining.delete(key)).catch(()=>{});}
  const result=await task;if(E.placeAcademicInCollection)await E.placeAcademicInCollection(result.itemID,target);if(signal?.aborted)throw Error('已取消');onProgress({stage:'saved',text:'PDF 已保存'});if(open)await Zotero.Reader.open(result.attachmentID);return{...result,...target};
 };
 Feed.installDiscoveryFeed(E,{Zotero});
})(Zotero.Research);
