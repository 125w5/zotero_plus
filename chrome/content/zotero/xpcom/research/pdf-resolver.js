/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The open-access copies of a paper, looked up at once and checked best first
// (shared/pdf-resolver.mjs resolvePDFSources). Scholarly APIs get their key, contact email and
// per-host spacing from E.requestProvider (scholarly-sources.js); arXiv files go through
// arxiv.js's queue. Only a file that passes the %PDF- check is returned.
(function (E) {
 const P=ChromeUtils.importESModule('chrome://zotero/content/research/shared/pdf-resolver.mjs');
 const timers=()=>typeof E.setTimeout==='function'&&typeof E.clearTimeout==='function'?{setTimeout:(...args)=>E.setTimeout(...args),clearTimeout:(...args)=>E.clearTimeout(...args)}:{};
 const json=async(url,signal)=>JSON.parse(await E.requestProvider(url,{signal},15000));
 const has=async id=>{try{return !!await E.scholarly?.has?.(id);}catch{return false;}};
 const contact=()=>{try{return String(E.scholarly?.contact?.()||'').trim();}catch{return '';}};
 const rows=(urls,source)=>urls.map(url=>({url,source}));
 const arxivFile=/^https:\/\/(?:export\.|www\.)?arxiv\.org\//i;
 // Fetched as a page, not as a PDF download, so it does not count against downloads.
 E.fetchDiscoveryPage||=(url,options)=>E.fetchDiscoveryPDF(url,options);
 // Phase 0: the record's own addresses and its arXiv copy. Phase 1, together: the metadata
 // services. Europe PMC waits for OpenAlex and Semantic Scholar, which often name the PMCID and
 // save its search. Phase 2: the DOI landing page's citation_pdf_url.
 const stages=(record,ctx)=>[
  {name:record.source||'检索结果',phase:0,run:async()=>P.recordPDFs(record)},
  {name:'OpenAlex',phase:1,lookup:true,run:async signal=>{
   const id=ctx.doi?'https://doi.org/'+encodeURIComponent(ctx.doi):ctx.openalex;if(!id)return null;
   const work=await json('https://api.openalex.org/works/'+id,signal);
   if(work.is_retracted)throw Object.assign(Error('该论文标记为撤稿，已停止自动下载'),{stop:true});
   P.absorbOpenAlex(ctx,work);return rows(P.openAlexPDFs(work),'OpenAlex');
  }},
  {name:'Unpaywall',phase:1,lookup:true,run:async signal=>{if(!ctx.doi||!contact())return null;return rows(P.unpaywallPDFs(await json('https://api.unpaywall.org/v2/'+P.doiPath(ctx.rawDOI||ctx.doi),signal)),'Unpaywall');}},
  {name:'Semantic Scholar',phase:1,lookup:true,run:async signal=>{
   const id=ctx.doi?'DOI:'+P.doiPath(ctx.rawDOI||ctx.doi):ctx.arxiv?'ARXIV:'+ctx.arxiv.replace(/v\d+$/i,''):ctx.s2;if(!id)return null;
   const paper=await json('https://api.semanticscholar.org/graph/v1/paper/'+id+'?fields=openAccessPdf,externalIds,publicationTypes,venue',signal);
   P.absorbSemantic(ctx,paper);return rows(P.semanticPDFs(paper),'Semantic Scholar');
  }},
  {name:'CORE',phase:1,lookup:true,run:async signal=>{
   if(!await has('core'))return null;
   if(ctx.core)return rows(P.corePDFs(await json('https://api.core.ac.uk/v3/works/'+ctx.core,signal)),'CORE');
   const query=ctx.doi?'doi:"'+ctx.doi.replace(/"/g,'')+'"':ctx.title?'title:"'+ctx.title.replace(/["\\]/g,' ')+'"':'';if(!query)return null;
   return rows(P.corePDFs(await json('https://api.core.ac.uk/v3/search/works?q='+encodeURIComponent(query)+'&limit=3',signal),{doi:ctx.doi,title:ctx.doi?'':ctx.title}),'CORE');
  }},
  {name:'arXiv',phase:0,derive:()=>ctx.arxiv?[{url:'https://arxiv.org/pdf/'+ctx.arxiv,source:'arXiv'}]:[]},
  {name:'Europe PMC',phase:1,lookup:true,after:['OpenAlex','Semantic Scholar'],derive:()=>ctx.pmcid?[{url:P.europePMCPDF(ctx.pmcid),source:'Europe PMC'}]:[],run:async signal=>{
   if(ctx.pmcid)return [];if(!ctx.doi)return null;
   const pmcid=P.europePMCSearchPMCID(await json('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query='+encodeURIComponent('DOI:"'+ctx.doi+'"')+'&format=json&resultType=lite&pageSize=3',signal),ctx.doi);
   if(pmcid)ctx.pmcid=pmcid;return [];
  }},
  {name:'Springer Nature',phase:1,lookup:true,run:async signal=>{if(!P.SPRINGER_PREFIX.test(ctx.doi)||!await has('springer-oa'))return null;return rows(P.springerPDFs(await json('https://api.springernature.com/openaccess/json?q='+encodeURIComponent('doi:'+(ctx.rawDOI||ctx.doi)),signal),ctx.doi),'Springer Nature');}},
  // A file the landing page names still has to pass the PDF check.
  {name:'出版社页面',phase:2,lookup:true,landing:true,run:async signal=>{
   const url=ctx.doi&&!/^10\.48550\//.test(ctx.doi)?'https://doi.org/'+P.doiPath(ctx.rawDOI||ctx.doi):'';if(!url)return null;
   const page=await P.readLandingPage(E.fetchDiscoveryPage,url,{signal,AbortController:E.createProviderController?function(){return E.createProviderController();}:undefined,...timers()});
   return page.pdf?[{url:page.url,source:'出版社页面'}]:rows(P.citationPDFs(page.html,page.url),'出版社页面');
  }}
 ];
 const download=(url,{signal,onProgress})=>{const progress=value=>onProgress({stage:'download',text:'正在下载 PDF…',...value});return arxivFile.test(url)&&E.arxivPDF?E.arxivPDF(url,{signal,onProgress:progress}):E.requestDiscoveryPDF(url,{signal,onProgress:progress});};
 // Each copy is checked (1 KB) before the download. An arXiv file is checked by its own queued
 // download, which stops at the first kilobyte that is not a PDF; a second request there would
 // wait another turn of arXiv's queue, so that check is the download.
 const probe=onProgress=>async(url,source,signal)=>{
  if(arxivFile.test(url)||!E.verifyDiscoveryPDF){onProgress({stage:'download',text:'正在从 '+source+' 下载 PDF…'});return {bytes:await download(url,{signal,onProgress})};}
  onProgress({stage:'verify',text:'正在检查 '+source+' 的 PDF…'});
  const check=await E.verifyDiscoveryPDF(url,{signal});
  if(!check?.available)throw Object.assign(Error(check?.error||'PDF 地址尚未验证'),{transient:!!check?.transient});
  return {verified:true};
 };
 // An address that failed for good in the last day (discovery-feed.mjs markDiscoveryPDFFailure).
 const recentFailure=url=>{let saved;try{saved=E.store?.peek?E.store.peek('discoveryPDFFailures',url):E.store?.get?.('discoveryPDFFailures',url);}catch{}if(saved&&Object.hasOwn(saved,'discoveryPDFFailures'))saved=saved.discoveryPDFFailures?.[url];return saved&&Number(saved.at)&&Date.now()-saved.at<86400000?saved:null;};
 const sourceText=names=>names.length>2?names.slice(0,2).join('、')+' 等 '+names.length+' 个来源':names.join('、');
 // {bytes,url,source,tried,record,state,label,reason}: record carries what the lookups learned
 // (pdfHints) for the item type. With lookup:false only the record's own addresses are tried.
 // When every source has answered and none has a PDF, the addresses tried are recorded for a
 // day; a source that was rate limited, timed out or refused leaves nothing recorded. The
 // error carries pdf-status.mjs's {state,label,reason} and, when OpenAlex holds a paid copy and every
 // free copy was tried (not error.incomplete), paidPDF.
 E.resolveOpenPDF=async(record,{signal,onProgress=()=>{},lookup=true,unchanged='文库没有变化',timing}={})=>{
  const ctx=P.pdfContext(record),list=stages(record,ctx);
  try{
   const found=await P.resolvePDFSources(lookup?list:list.slice(0,1),{signal,unchanged,timing,...timers(),
    probe:probe(onProgress),download:(url,source,current)=>{onProgress({stage:'download',text:'正在从 '+source+' 下载 PDF…'});return download(url,{signal:current,onProgress});},
    exempt:url=>arxivFile.test(url),skip:recentFailure,onSource:names=>onProgress({stage:'resolve',text:'正在从 '+sourceText(names)+' 查找开放获取全文…'})});
   for(const url of new Set([found.url,P.pdfURL(record.pdf)].filter(Boolean)))await E.clearDiscoveryPDFFailure?.(url);
   return {...found,...P.pdfStatus('pdf'),record:{...record,pdf:found.url,pdfSource:found.source,pdfHints:ctx.hints,oa:true}};
  }
  catch(error){
   if(error&&typeof error==='object'){if(ctx.paidPDF&&!error.incomplete)error.paidPDF=ctx.paidPDF;error.pdfHints=ctx.hints;}
   if(error?.lasting)for(const url of new Set([P.pdfURL(record.pdf),...(error.attempted||[])].filter(Boolean)))if(!recentFailure(url))await E.markDiscoveryPDFFailure?.(url,error);
   throw error;
  }
 };
 // OpenAlex's cached copy of a work, a paid request (about $0.01 per file) made only when the
 // setting openalexContentDownload is on and an OpenAlex key is saved. The key is added to the
 // address here and never stored with the record or in the failure cache.
 E.openAlexContentPDF=async(url,{signal,onProgress=()=>{}}={})=>{
  let enabled=false;try{enabled=!!(E.store?.peek?E.store.peek('settings','openalexContentDownload'):E.settings?.().openalexContentDownload);}catch{}
  if(!enabled||!/^https:\/\/content\.openalex\.org\/works\/W\d+\.pdf$/i.test(url||'')||!await has('openalex'))return null;
  const prepared=await E.scholarly?.prepare?.(url);if(!prepared?.url||!/[?&]api_key=/.test(prepared.url))return null;
  await prepared.wait?.();onProgress({stage:'download',text:'正在从 OpenAlex 全文库下载 PDF（付费）…'});
  return E.requestDiscoveryPDF(prepared.url,{signal,onProgress:value=>onProgress({stage:'download',text:'正在下载 PDF…',...value})});
 };
})(Zotero.Research);
