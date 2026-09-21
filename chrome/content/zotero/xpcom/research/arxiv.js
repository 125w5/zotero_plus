/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const P=ChromeUtils.importESModule('chrome://zotero/content/research/shared/arxiv.mjs');let tail=Promise.resolve(),last=0;const downloads=new Map();
 const request=(url,binary=false)=>{const next=tail.then(async()=>{for(let attempt=0;attempt<3;attempt++){
  await Zotero.Promise.delay(Math.max(0,last+3100-Date.now()));last=Date.now();let r;
  try{r=await Zotero.HTTP.request('GET',url,{responseType:binary?'arraybuffer':'text',responseCharset:'UTF-8',timeout:60000,followRedirects:true,successCodes:false,errorDelayMax:0,headers:{'User-Agent':'EasySch/0.1 (Zotero research client; https://github.com/125w5/zotero_plus)'}});}catch(e){Zotero.logError(e);throw Error((binary?'PDF 下载':'文献检索')+'连接失败或超时；请检查 Zotero 的网络与代理');}
  if(r.status>=200&&r.status<300)return binary?new Uint8Array(r.response):r.responseText;
  if([429,500,502,503,504].includes(r.status)&&attempt<2){const retry=r.getResponseHeader('Retry-After'),seconds=retry?(Number(retry)||Math.ceil((Date.parse(retry)-Date.now())/1000)):3*(attempt+1);if(seconds>30)throw Error('arXiv 检索限流（HTTP '+r.status+'），服务要求稍后重试；可用已知 arXiv 编号获取论文');await Zotero.Promise.delay(Math.max(3100,seconds*1000));continue;}
  throw Error((binary?'PDF 下载':'文献检索')+'失败（HTTP '+r.status+'）'+(r.status===429?'：arXiv 限流，请稍后重试；已知编号可直接获取':''));
 }});tail=next.catch(()=>{});return next;};
 const parse=(text,type)=>new(Zotero.getMainWindow().DOMParser)().parseFromString(text,type);
 E.arxivMetadata=async id=>{id=P.arxivID(id);if(!id)throw Error('arXiv 编号格式不正确');const html=await request('https://arxiv.org/abs/'+id),doc=parse(html,'text/html'),meta=n=>doc.querySelector(`meta[name="${n}"]`)?.content||'';
  if(!meta('citation_title'))throw Error('元数据读取失败：arXiv 未返回论文页面');
  return {source:'arXiv',id,title:meta('citation_title'),abstract:doc.querySelector('blockquote.abstract')?.textContent.replace(/^\s*Abstract:\s*/,'').trim()||meta('description'),date:meta('citation_date'),doi:meta('citation_doi'),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...doc.querySelectorAll('meta[name="citation_author"]')].map(m=>({lastName:m.content,firstName:'',fieldMode:1}))};
 };
 E.arxivSearchPage=async(query,{page=1,limit=20}={})=>{const terms=query.replace(/["\\]/g,' ').split(/\s+/).filter(Boolean).map(t=>'all:"'+t+'"').join(' AND '),doc=parse(await request('https://export.arxiv.org/api/query?search_query='+encodeURIComponent(terms)+'&start='+((page-1)*limit)+'&max_results='+limit),'application/xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='feed')throw Error('arXiv 返回非文献数据');const records=[...doc.getElementsByTagNameNS('http://www.w3.org/2005/Atom','entry')].map(entry=>{const text=name=>entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom',name)[0]?.textContent?.trim()||'',id=P.arxivID(text('id'));return id?{id,source:'arXiv',title:text('title'),abstract:text('summary'),date:text('published').slice(0,10),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom','author')].map(a=>({lastName:a.textContent.trim(),fieldMode:1}))}:null;}).filter(Boolean);return {records,hasMore:page*limit<Number(doc.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/','totalResults')[0]?.textContent||0)};};
 const legacy=E.searchAcademic;
 E.searchAcademic=async(query,source='pubmed')=>{if(source!=='arxiv')return legacy(query,source);query=String(query).trim();if(!query||query.length>300)throw Error('请输入论文标题、arXiv 编号或链接');const cache=E.store.get().academicSearch?.['arxiv:'+query];if(cache&&Date.now()-cache.at<86400000)return cache.results;
  const id=P.arxivID(query);let results;if(id)results=[await E.arxivMetadata(id)];else{
   const terms=query.replace(/["\\]/g,' ').split(/\s+/).filter(Boolean).map(t=>'all:"'+t+'"').join(' AND '),doc=parse(await request('https://export.arxiv.org/api/query?search_query='+encodeURIComponent(terms)+'&start=0&max_results=10'),'application/xml');
   if(doc.querySelector('parsererror')||doc.documentElement.localName!=='feed')throw Error('检索返回非 Atom 文献数据');
   results=[...doc.getElementsByTagNameNS('http://www.w3.org/2005/Atom','entry')].map(entry=>{const text=name=>entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom',name)[0]?.textContent?.trim()||'',id=P.arxivID(text('id'));if(!id)return null;return {source:'arXiv',id,title:text('title'),abstract:text('summary'),date:text('published').slice(0,10),url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[...entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom','author')].map(a=>({lastName:a.textContent.trim(),firstName:'',fieldMode:1}))};}).filter(Boolean);
  }
  await E.store.update(s=>{s.academicSearch||={};s.academicSearch['arxiv:'+query]={at:Date.now(),results};});return results;
 };
 E.importAcademicPDF=async (record,{open=true}={})=>{const id=P.arxivID(record.id)||P.arxivID(record.url)||P.arxivID(record.pdf);if(!id)throw Error('无法识别 arXiv PDF 编号');const libraryID=Zotero.getActiveZoteroPane().getSelectedLibraryIDs()[0]||Zotero.Libraries.userLibraryID,key=libraryID+':'+id;if(downloads.has(key)){const result=await downloads.get(key);if(open)await Zotero.Reader.open(result.attachmentID);return {...result,reused:true};}
  const task=(async()=>{const normalized={...record,source:'arXiv',url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id},saved=await E.importAcademic(normalized,{select:false}),item=await Zotero.Items.getAsync(saved.id);let attachment=null;for(const aid of item.getAttachments()){const a=await Zotero.Items.getAsync(aid),version=P.arxivID(a.getField('url'));if(a.isPDFAttachment()&&version===id&&await a.getFilePathAsync()&&await IOUtils.exists(await a.getFilePathAsync())){attachment=a;break;}}let transferred=false;
   if(!attachment?.isPDFAttachment()||!await attachment.getFilePathAsync()||!await IOUtils.exists(await attachment.getFilePathAsync())){
    const bytes=await request(normalized.pdf,true);P.assertPDF(bytes);transferred=true;const dir=Zotero.getTempDirectory().path,path=PathUtils.join(dir,'easysch-arxiv-'+Zotero.Utilities.randomString(12)+'.pdf');
    try{await IOUtils.write(path,bytes);attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:item.id,title:record.title,contentType:'application/pdf'});attachment.setField('url',normalized.pdf);await attachment.saveTx({skipSelect:true});}catch(e){throw Error('附件保存失败：'+e.message+'；题录已保留，可重试下载');}finally{await IOUtils.remove(path,{ignoreAbsent:true});}
   }
   if(open)await Zotero.Reader.open(attachment.id);E.manuscripts.queueArticle(attachment.id);return {itemID:item.id,attachmentID:attachment.id,downloaded:transferred,reused:!transferred,path:await attachment.getFilePathAsync()};
  })();downloads.set(key,task);try{return await task;}finally{downloads.delete(key);}
 };
 const obtain=E.obtainPaper;E.obtainPaper=(record,options)=>P.arxivID(record.id)||P.arxivID(record.url)||P.arxivID(record.pdf)?E.importAcademicPDF(record,options):obtain(record,options);
})(Zotero.Research);
