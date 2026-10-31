/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const P=ChromeUtils.importESModule('chrome://zotero/content/research/shared/arxiv.mjs'),Dates=ChromeUtils.importESModule('chrome://zotero/content/research/shared/discovery-dates.mjs');let tail=Promise.resolve(),last=0;const downloads=new Map();
 const request=(url,binary=false,signal)=>{
  if(binary)return E.requestDiscoveryPDF(url,{signal});
  const turn=tail.catch(()=>{}).then(async()=>{if(signal?.aborted)throw Error('已取消文献检索');await Zotero.Promise.delay(Math.max(0,last+3100-Date.now()));if(signal?.aborted)throw Error('已取消文献检索');last=Date.now();});tail=turn.catch(()=>{});
  const next=turn.then(async()=>{for(let attempt=0;attempt<2;attempt++){
  if(signal?.aborted)throw Error('已取消文献检索');let r,xhr;const abort=()=>xhr?.abort();
  try{signal?.addEventListener('abort',abort,{once:true});r=await Zotero.HTTP.request('GET',url,{responseType:binary?'arraybuffer':'text',responseCharset:'UTF-8',timeout:12000,followRedirects:true,successCodes:false,errorDelayMax:0,requestObserver:request=>{xhr=request;if(signal?.aborted)abort();},headers:{'User-Agent':'EasySch/0.1 (Zotero research client; https://github.com/125w5/zotero_plus)'}});}catch(e){if(signal?.aborted)throw Error('已取消文献检索');Zotero.logError(e);throw Error((binary?'PDF 下载':'文献检索')+'连接失败或超时；请检查 Zotero 的网络与代理');}finally{signal?.removeEventListener('abort',abort);}
  if(signal?.aborted)throw Error('已取消文献检索');
  if(r.status>=200&&r.status<300)return binary?new Uint8Array(r.response):r.responseText;
  if([429,500,502,503,504].includes(r.status)&&attempt<1){const retry=r.getResponseHeader('Retry-After'),seconds=retry?(Number(retry)||Math.ceil((Date.parse(retry)-Date.now())/1000)):3*(attempt+1);if(seconds>10)throw Error('arXiv 检索限流（HTTP '+r.status+'），服务要求稍后重试；可用已知 arXiv 编号获取论文');await Zotero.Promise.delay(Math.max(3100,seconds*1000));continue;}
  throw Error((binary?'PDF 下载':'文献检索')+'失败（HTTP '+r.status+'）'+(r.status===429?'：arXiv 限流，请稍后重试；已知编号可直接获取':''));
 }});return next;};
 const parse=(text,type)=>new(Zotero.getMainWindow().DOMParser)().parseFromString(text,type);
 E.arxivMetadata=async(id,{signal}={})=>{id=P.arxivID(id);if(!id)throw Error('arXiv 编号格式不正确');const html=await request('https://arxiv.org/abs/'+id,false,signal),doc=parse(html,'text/html'),meta=n=>doc.querySelector(`meta[name="${n}"]`)?.content||'';
  if(!meta('citation_title'))throw Error('元数据读取失败：arXiv 未返回论文页面');
  return {source:'arXiv',id,title:meta('citation_title'),abstract:doc.querySelector('blockquote.abstract')?.textContent.replace(/^\s*Abstract:\s*/,'').trim()||meta('description'),date:meta('citation_date'),doi:meta('citation_doi'),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...doc.querySelectorAll('meta[name="citation_author"]')].map(m=>({lastName:m.content,firstName:'',fieldMode:1}))};
 };
 E.arxivSearchPage=async(query,{page=1,limit=20,signal,filters={}}={})=>{
  const range=Dates.discoveryDateRange(filters),terms=query.replace(/["\\]/g,' ').split(/\s+/).filter(Boolean).map(t=>'all:"'+t+'"');if(range.from||range.to)terms.push('submittedDate:['+(range.from?range.from.replace(/-/g,'')+'0000':'100001010000')+' TO '+(range.to?range.to.replace(/-/g,'')+'2359':'300012312359')+']');
  const parameters=new URLSearchParams({search_query:terms.join(' AND '),start:String((page-1)*limit),max_results:String(limit)});if(filters.sort==='date'){parameters.set('sortBy','submittedDate');parameters.set('sortOrder','descending');}
  const doc=parse(await request('https://export.arxiv.org/api/query?'+parameters,false,signal),'application/xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='feed')throw Error('arXiv 返回非文献数据');const records=[...doc.getElementsByTagNameNS('http://www.w3.org/2005/Atom','entry')].map(entry=>{const text=name=>entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom',name)[0]?.textContent?.trim()||'',id=P.arxivID(text('id'));return id?{id,source:'arXiv',title:text('title'),abstract:text('summary'),date:text('published').slice(0,10),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom','author')].map(a=>({lastName:a.textContent.trim(),fieldMode:1}))}:null;}).filter(Boolean);return {records,hasMore:page*limit<Number(doc.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/','totalResults')[0]?.textContent||0)};
 };
 const legacy=E.searchAcademic;
 E.searchAcademic=async(query,source='pubmed')=>{if(source!=='arxiv')return legacy(query,source);query=String(query).trim();if(!query||query.length>300)throw Error('请输入论文标题、arXiv 编号或链接');const cache=E.store.get('academicSearch')?.['arxiv:'+query];if(cache&&Date.now()-cache.at<86400000)return cache.results;
  const id=P.arxivID(query);let results;if(id)results=[await E.arxivMetadata(id)];else{
   const terms=query.replace(/["\\]/g,' ').split(/\s+/).filter(Boolean).map(t=>'all:"'+t+'"').join(' AND '),doc=parse(await request('https://export.arxiv.org/api/query?search_query='+encodeURIComponent(terms)+'&start=0&max_results=10'),'application/xml');
   if(doc.querySelector('parsererror')||doc.documentElement.localName!=='feed')throw Error('检索返回非 Atom 文献数据');
   results=[...doc.getElementsByTagNameNS('http://www.w3.org/2005/Atom','entry')].map(entry=>{const text=name=>entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom',name)[0]?.textContent?.trim()||'',id=P.arxivID(text('id'));if(!id)return null;return {source:'arXiv',id,title:text('title'),abstract:text('summary'),date:text('published').slice(0,10),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom','author')].map(a=>({lastName:a.textContent.trim(),firstName:'',fieldMode:1}))};}).filter(Boolean);
  }
  await E.store.update(s=>{s.academicSearch||={};s.academicSearch['arxiv:'+query]={at:Date.now(),results};});return results;
 };
 // A saved PDF of this arXiv paper whose file is still on disk. A copy of exactly this version
 // comes first. Else, when either number names no version, the same paper matches: a number
 // without a version is the latest, so the newest saved version is taken. A copy saved without
 // a version is then reused even if a newer version came out after it was fetched; that is the
 // price of not downloading the same paper twice. Two named versions are two PDFs.
 const versionPDF=async(item,id)=>{let v=/v(\d+)$/i,base=id.replace(v,''),best=null,rank=-1;for(let aid of item.getAttachments()){let a=await Zotero.Items.getAsync(aid),saved=a?.isPDFAttachment()&&P.arxivID(a.getField('url'));if(!saved||saved!==id&&!(saved.replace(v,'')===base&&(!v.test(saved)||!v.test(id))))continue;let path=await a.getFilePathAsync();if(!path||!await IOUtils.exists(path))continue;if(saved===id)return a;let n=Number(saved.match(v)?.[1]||0);if(n>rank){best=a;rank=n;}}return best;};
 E.importAcademicPDF=async(record,options={})=>{const{open=true,onProgress=()=>{},signal}=options,id=P.arxivID(record.id)||P.arxivID(record.url)||P.arxivID(record.pdf);if(!id)throw Error('无法识别 arXiv PDF 编号');const target=E.resolveAcademicTarget?await E.resolveAcademicTarget(options):{libraryID:options.libraryID||Zotero.getActiveZoteroPane().getSelectedLibraryIDs()[0]||Zotero.Libraries.userLibraryID,collectionID:options.collectionID},key=target.libraryID+':'+id;onProgress({stage:'lookup',text:'正在匹配文库…'});if(downloads.has(key)){const result=await downloads.get(key);if(E.placeAcademicInCollection)await E.placeAcademicInCollection(result.itemID,target);onProgress({stage:'saved',text:'PDF 已保存'});if(open)await Zotero.Reader.open(result.attachmentID);return{...result,...target,reused:true};}
  // As in obtainOpenPaper, the record is filed only after its PDF has arrived and
  // passed the PDF check; a failed download leaves the library as it was.
  const task=(async()=>{const normalized={...record,id,source:'arXiv',url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id},found=E.findAcademicItem&&await E.findAcademicItem(normalized,target);let item=found,attachment=found&&await versionPDF(found,id),transferred=false;
   if(attachment)await E.placeAcademicInCollection?.(found.id,target);
   else{
    const unchanged=found?'文库中的这条题录没有改动':'文库没有变化';if(Zotero.Libraries.get?.(target.libraryID)?.filesEditable===false)throw Error('目标文库不能保存附件；'+unchanged);onProgress({stage:'download',text:'正在下载 PDF…'});
    // Only a failure that will repeat (not a PDF, over the size limit, 404) is recorded,
    // which removes the row from offered downloads for a day; a rate limit, refusal or
    // timeout is not. A PDF that arrives clears the address.
    let bytes;try{bytes=await request(normalized.pdf,true,signal);P.assertPDF(bytes);}catch(error){if(signal?.aborted||error.name==='AbortError')throw error;const failure=E.discoveryPDFUnavailable(error,unchanged);if(failure.lasting)await E.markDiscoveryPDFFailure?.(normalized.pdf,error);throw failure;}
    await E.clearDiscoveryPDFFailure?.(normalized.pdf);onProgress({stage:'save',text:'正在保存 PDF…'});const saved=await E.importAcademic(normalized,{select:false,...target});item=await Zotero.Items.getAsync(saved.id);attachment=await versionPDF(item,id);
    if(!attachment){try{attachment=await E.attachDiscoveryPDF(item,bytes,normalized);}catch(e){throw Error('附件保存失败：'+e.message+'；题录已保留，可重试下载');}transferred=true;}
   }
   onProgress({stage:'saved',text:'PDF 已保存'});if(open)await Zotero.Reader.open(attachment.id);E.manuscripts.queueArticle(attachment.id);return{itemID:item.id,attachmentID:attachment.id,downloaded:transferred,reused:!transferred,path:await attachment.getFilePathAsync(),...target};
  })();downloads.set(key,task);try{return await task;}finally{downloads.delete(key);}
 };
 // Only an arXiv record (arxivRecordID) takes the arXiv preprint import. A journal
 // article whose open copy is on arxiv.org keeps the original path, its item type and journal.
 const obtain=E.obtainPaper;E.obtainPaper=async(record,options)=>{
  if(!P.arxivRecordID(record))return obtain(record,options);
  const result=await E.importAcademicPDF(record,options);await E.workspaceOutputs?.rememberDownload(record,result);return result;
 };
})(Zotero.Research);
