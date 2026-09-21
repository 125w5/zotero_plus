/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
 const Ref=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs');
 E.referencesFromPDF=async(paper,{signal}={})=>{
  const item=await Zotero.Items.getAsync(paper.id),attachment=item?.isPDFAttachment()?item:await item?.getBestAttachment();
  if(!attachment?.isPDFAttachment())throw Error('这篇论文没有可读取的 PDF 附件');
  const {text}=await Zotero.PDFWorker.getFullText(attachment.id,null);if(signal?.aborted)throw Error('已取消');
  const records=Ref.parseReferenceText(text).map(ref=>({...ref,attachmentID:attachment.id,parentItemID:paper.id}));
  if(!records.length)throw Error('没有可靠识别 PDF 参考文献；未猜测引用关系');
  return {records,url:E.library.uri(attachment),version:E.assets.key(text)};
 };
 let lookupTail=Promise.resolve(),lastLookup=0;
 E.collectReferences=async(paper,{signal,refresh=false,onProgress=()=>{}}={})=>{
  if(signal?.aborted)throw Error('已取消');
  let sourceVersion='metadata';const item=await Zotero.Items.getAsync(paper.id),attachment=item?.isPDFAttachment()?item:await item?.getBestAttachment();const path=await attachment?.getFilePathAsync();if(path){const stat=await IOUtils.stat(path);sourceVersion=attachment.id+':'+stat.size+':'+stat.lastModified;}
  const key='resolved-refs-v2:'+paper.id+':'+Ref.cleanDOI(paper.doi),cached=E.store.get().discovery?.[key];
  if(!refresh&&cached&&cached.sourceVersion===sourceVersion&&Date.now()-Date.parse(cached.at)<86400000)return {...cached,cacheHit:true};
  let refs=[],url='',notes=[];
  if(paper.doi)try{
   url='https://api.crossref.org/works/'+encodeURIComponent(Ref.cleanDOI(paper.doi));
   const data=JSON.parse(await E.requestProvider(url,{signal},12000)).message;
   if(Ref.cleanDOI(data.DOI)!==Ref.cleanDOI(paper.doi))throw Error('返回的论文 DOI 不一致');
   refs=(data.reference||[]).map((r,i)=>({...Ref.referenceFromCrossref(r,i),parentItemID:paper.id,parentDOI:Ref.cleanDOI(paper.doi),sourceURL:url}));
  }catch(e){if(signal?.aborted)throw Error('已取消');notes.push('出版者题录不可用，已尝试读取 PDF');}
  if(!refs.length){try{const pdf=await E.referencesFromPDF(paper,{signal});refs=pdf.records;url=pdf.url;}catch(e){if(signal?.aborted)throw Error('已取消');throw Error('暂时无法收集这篇论文的参考文献：'+e.message);}}
  const pending=new Map();
  const lookupOne=async ref=>{
   const query=ref.title||ref.quote,arxiv=!ref.doi&&Ref.referenceArxiv(ref.quote),k=ref.doi?'doi:'+ref.doi:arxiv?'arxiv:'+arxiv:'bibliography:'+E.assets.key(query),entry=E.store.get().referenceMetadata?.[k];
   if(!refresh&&entry&&Date.now()-entry.at<(entry.records.length?604800000:3600000))return entry.records;
   const wait=lookupTail.then(async()=>{await Zotero.Promise.delay(Math.max(0,lastLookup+180-Date.now()));lastLookup=Date.now();});lookupTail=wait.catch(()=>{});await wait;if(signal?.aborted)throw Error('已取消');
   if(arxiv){const p=await E.arxivMetadata(arxiv);if(signal?.aborted)throw Error('已取消');await E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[k]={at:Date.now(),records:[p]};});return [p];}
   const target=ref.doi?'https://api.crossref.org/works/'+encodeURIComponent(ref.doi):'https://api.crossref.org/works?query.bibliographic='+encodeURIComponent(query.slice(0,700))+'&rows=3';
   const data=JSON.parse(await E.requestProvider(target,{signal},10000)).message;
   const records=(ref.doi?[data]:data.items||[]).map(Ref.crossrefRecord);
   const parser=new (Zotero.getMainWindow().DOMParser)();for(const p of records)p.abstract=parser.parseFromString(p.abstract||'','text/html').body.textContent;
   if(signal?.aborted)throw Error('已取消');await E.store.update(s=>{s.referenceMetadata||={};s.referenceMetadata[k]={at:Date.now(),records};});return records;
  };
  const lookup=ref=>{const k=ref.doi||ref.quote||ref.title;if(!pending.has(k))pending.set(k,lookupOne(ref));return pending.get(k);};
  const result={...await Ref.resolveReferences(refs,{lookup,signal,onProgress}),references:refs,url,notes,sourceVersion,at:new Date().toISOString(),cacheHit:false};
  if(signal?.aborted)throw Error('已取消');await E.store.update(s=>{s.discovery||={};s.discovery[key]=result;});return result;
 };
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
 E.searchPaperPage=async(query,{provider='',page=1,limit=20,signal}={})=>{
  query=String(query).trim();if(!query)throw Error('请输入研究主题');limit=Math.min(40,Math.max(5,limit));page=Math.max(1,page);
  const key='oa-v2:'+JSON.stringify([query,provider,page,limit]);let task=pageTasks.get(key);
  if(!task){task=(async()=>{const cache=E.store.get().paperSearchPages?.[key];if(cache&&Date.now()-cache.at<3600000)return {...cache.result,cacheHit:true};
   const turn=pageTail.then(async()=>{await Zotero.Promise.delay(Math.max(0,pageLast+1000-Date.now()));pageLast=Date.now();});pageTail=turn.catch(()=>{});await turn;
   let result,errors=[];for(const name of provider?[provider]:['openalex','semantic','arxiv'])try{
    const offset=(page-1)*limit;let rows=[],more=false;
    if(name==='openalex'){
     const url='https://api.openalex.org/works?search='+encodeURIComponent(query)+'&filter=open_access.is_oa:true,is_retracted:false&per-page='+limit+'&page='+page;
     const data=JSON.parse(await E.requestProvider(url,{},20000));
     rows=(data.results||[]).map(p=>{const words=[];for(const [word,positions] of Object.entries(p.abstract_inverted_index||{}))for(const i of positions)words[i]=word;const location=p.best_oa_location||p.primary_location;return {id:p.id,title:p.title,abstract:words.join(' '),doi:(p.doi||'').replace(/^https?:\/\/doi.org\//,''),url:location?.landing_page_url||p.doi||p.id,pdf:location?.pdf_url||'',journal:p.primary_location?.source?.display_name||'',issn:p.primary_location?.source?.issn_l||'',source:'OpenAlex',date:String(p.publication_year||''),citationCount:p.cited_by_count??null,oa:true,retracted:p.is_retracted===true,authors:(p.authorships||[]).map(a=>({lastName:a.author.display_name,fieldMode:1}))};});more=offset+rows.length<(data.meta?.count||0);
    }else if(name==='semantic'){
     const data=JSON.parse(await E.requestProvider(graph+'paper/search?query='+encodeURIComponent(query)+'&openAccessPdf&offset='+offset+'&limit='+limit+'&fields='+fields+',citationCount',{ },20000));rows=(data.data||[]).filter(p=>p.openAccessPdf?.url).map(p=>({...normalize(p),oa:true,citationCount:p.citationCount??null,retracted:null}));more=data.next!=null;
    }else{const data=await E.arxivSearchPage(query,{page,limit});rows=data.records.map(p=>({...p,oa:true,retracted:null,citationCount:null}));more=data.hasMore;}
    const seen=new Set();rows=rows.filter(r=>{const id=(r.doi||r.url||r.id).toLowerCase();if(!r.title||!id||seen.has(id))return false;seen.add(id);return true;});
    result={records:rows,provider:name,page,hasMore:more,cacheHit:false,limitations:errors,query};if(rows.length||provider)break;
   }catch(e){errors.push(name+'：'+e.message);}
   if(!result)throw Error('联网检索失败：'+errors.join('；'));await E.store.update(s=>{s.paperSearchPages||={};s.paperSearchPages[key]={at:Date.now(),result};const keys=Object.keys(s.paperSearchPages);for(const k of keys.slice(0,Math.max(0,keys.length-80)))delete s.paperSearchPages[k];});return result;
  })();pageTasks.set(key,task);task.finally(()=>pageTasks.delete(key)).catch(()=>{});}
  const result=await task;if(signal?.aborted)throw Error('已取消');return result;
 };
 E.candidateMetric=async record=>{if(!record.journal)return null;const item=new Zotero.Item('journalArticle');item.setField('publicationTitle',record.journal);if(record.issn)item.setField('ISSN',record.issn);return await E.ensurePaperMetrics(item);};
 const oaTasks=new Map();
 E.obtainOpenPaper=async record=>{
  if(!record.oa||record.retracted)throw Error('此候选未确认可公开获取，或已标记撤稿；请先核对来源。');
  const key=record.doi||record.url||record.id;if(oaTasks.has(key))return oaTasks.get(key);
  const task=(async()=>{if(/arxiv.org\/(abs|pdf)\//i.test(record.url+' '+record.pdf))return E.importAcademicPDF(record,{open:false});
   const saved=await E.importAcademic(record,{select:false}),item=await Zotero.Items.getAsync(saved.id);let attachment=await item.getBestAttachment();if(attachment?.isPDFAttachment()&&await attachment.getFilePathAsync()&&await IOUtils.exists(await attachment.getFilePathAsync()))return {itemID:item.id,attachmentID:attachment.id,reused:true};
   if(!record.pdf||!/^https:\/\//.test(record.pdf))throw Error('题录已保留，暂无直接公开 PDF；可打开来源页面。');
   let response;try{response=await Zotero.HTTP.request('GET',record.pdf,{responseType:'arraybuffer',timeout:45000,followRedirects:true,successCodes:false});}catch(_){throw Error('公开 PDF 下载失败或超时，题录已保留');}
   if(response.status<200||response.status>=300)throw Error('公开 PDF 下载失败（HTTP '+response.status+'），题录已保留');const bytes=new Uint8Array(response.response);ChromeUtils.importESModule('chrome://zotero/content/research/shared/arxiv.mjs').assertPDF(bytes);
   const path=PathUtils.join(Zotero.getTempDirectory().path,'easysch-oa-'+Zotero.Utilities.randomString(12)+'.pdf');try{await IOUtils.write(path,bytes);attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:item.id,contentType:'application/pdf',title:record.title});attachment.setField('url',record.pdf);await attachment.saveTx({skipSelect:true});}finally{await IOUtils.remove(path,{ignoreAbsent:true});}
   E.manuscripts.queueArticle(attachment.id);return {itemID:item.id,attachmentID:attachment.id,downloaded:true};
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
 E.obtainPaper=async(record,{open=true}={})=>{
  const key=Ref.cleanDOI(record.doi)||record.url||record.id;
  let task=obtaining.get(key);
  if(!task){task=(async()=>{
   const saved=await E.importAcademic(record,{select:false}),item=await Zotero.Items.getAsync(saved.id);
   const local=await E.library.localPDF(item);
   if(local)return {itemID:item.id,attachmentID:local.id,reused:true,path:await local.getFilePathAsync()};
   let candidate={...record};
   if(!candidate.pdf&&candidate.doi){
    try{const data=JSON.parse(await E.requestProvider('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(candidate.doi),{},15000));
     if(data.is_retracted)throw Error('该论文标记为撤稿，已停止自动下载');
     const location=[data.best_oa_location,...(data.locations||[])].find(x=>x?.is_oa&&x.pdf_url);
     if(location)candidate={...candidate,pdf:location.pdf_url,oa:true};
    }catch(error){if(error.message.includes('撤稿'))throw error;}
   }
   if(!candidate.pdf)throw Error('未找到公开 PDF；题录与摘要已保留，不加入文献阅读。');
   if(candidate.retracted)throw Error('该论文标记为撤稿，已停止自动下载');
   const result=await E.obtainOpenPaper({...candidate,oa:true});
   const attachment=await E.library.localPDF(result.attachmentID);
   if(!attachment)throw Error('附件保存失败：本机文件不可用；题录已保留');
   return {...result,path:await attachment.getFilePathAsync()};
  })();obtaining.set(key,task);task.finally(()=>obtaining.delete(key)).catch(()=>{});}
  const result=await task;if(open)await Zotero.Reader.open(result.attachmentID);return result;
 };
})(Zotero.Research);
