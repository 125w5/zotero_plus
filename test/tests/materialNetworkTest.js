describe('Material download reuse with live arXiv',function(){
 this.timeout(240000);let win,R=Zotero.Research;const report={type:'真实联网和真实 Zotero 下载管线，HTTP 仅记录不替换',requests:[]};
 before(async()=>{win=await loadZoteroPane();win.focus();await R.attachWindow(win);});
 after(async()=>{await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'catalog-network-report.json'),JSON.stringify(report,null,2));win?.close();});
 it('shares a running PDF download, reuses saved attachment and keeps background tabs unchanged',async()=>{
  const original=Zotero.HTTP.request;Zotero.HTTP.request=async function(method,url,options){report.requests.push({method,url:String(url)});return original.call(this,method,url,options);};
  try{const record=await R.arxivMetadata('1706.03762v1');assert.include(record.title,'Attention');const tabs=win.Zotero_Tabs.numTabs,values=await Promise.all([R.importAcademicPDF(record,{open:false}),R.importAcademicPDF(record,{open:false}),R.importAcademicPDF(record,{open:false})]);assert.equal(new Set(values.map(v=>v.attachmentID)).size,1);const count=report.requests.filter(x=>x.url==='https://arxiv.org/pdf/1706.03762v1').length;assert.isAtMost(count,1);const again=await R.importAcademicPDF(record,{open:false});assert.equal(again.attachmentID,values[0].attachmentID);assert.isFalse(again.downloaded);assert.equal(report.requests.filter(x=>x.url==='https://arxiv.org/pdf/1706.03762v1').length,count);assert.equal(win.Zotero_Tabs.numTabs,tabs);report.result={attachmentID:again.attachmentID,pdfTransfers:count,reused:true,noBackgroundTabs:true};}catch(e){report.error=e.message;throw e;}finally{Zotero.HTTP.request=original;}
 });
});
