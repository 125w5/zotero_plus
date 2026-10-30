/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Explicit opt-in only: -test researchDownloadLive with -LiveServices.
// Uses a new isolated native profile; never reads the daily library or models.
describe('Live public PDF download into the native project library',function(){
 this.timeout(180000);
 const E=Zotero.Research,DOI='10.1371/journal.pone.0300457';
 const Journals=ChromeUtils.importESModule('chrome://zotero/content/research/shared/discovery-journals.mjs');
 let win,output,collection,record,first,original,modelCalls=0;
 const report={type:'真实公开题录、原生后台传输、Zotero 附件及文件夹、已下载列表；不调用模型',doi:DOI,tests:[],transport:[],suppressedBackgroundPreparation:[]};
 const write=async()=>{if(output)await IOUtils.writeUTF8(PathUtils.join(output,'report.json'),JSON.stringify(report,null,2));};
 before(async function(){
  const requested=typeof TestOptions!=='undefined'&&String(TestOptions.tests||'').split(',').some(name=>name.replace(/^.*[/\\]/,'').replace(/(?:Test)?(?:\.js)?$/,'')==='researchDownloadLive');
  if(!requested||!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  assert.isTrue(Zotero.Prefs.get('extensions.easysch.testProfile',true),'真实下载验收只允许隔离测试文库');
  win=await loadZoteroPane();await E.attachWindow(win);
  output=PathUtils.join(Zotero.DataDirectory.dir,'research-download-live-acceptance');await IOUtils.makeDirectory(output,{ignoreExisting:true});
  original={request:E.studio.request,fetch:E.fetchDiscoveryPDF,queue:E.manuscripts.queueArticle,images:E.assets.queueImages,translation:E.manuscripts.prepareTranslation,reader:E.queueReaderPreparation};
  E.studio.request=async()=>{modelCalls++;throw Error('真实下载验收禁止调用模型');};
  const suppress=kind=>async id=>{report.suppressedBackgroundPreparation.push({kind,attachmentID:id});};
  E.manuscripts.queueArticle=suppress('article');E.assets.queueImages=suppress('images');E.manuscripts.prepareTranslation=suppress('translation');E.queueReaderPreparation=suppress('reader');
  E.fetchDiscoveryPDF=async(url,options)=>{const started=Date.now(),address=new URL(url);try{const response=await original.fetch(url,options);report.transport.push({host:address.host,path:address.pathname,status:response.status,contentType:response.headers.get('content-type'),headersAfterMs:Date.now()-started});return response;}catch(error){report.transport.push({host:address.host,path:address.pathname,error:error.message,afterMs:Date.now()-started});throw error;}};
  collection=await E.createDiscoveryCollection('真实公开 PDF 下载验收 '+Date.now(),{libraryID:Zotero.Libraries.userLibraryID,parentID:null});report.collection=collection;
  await write();
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});report.modelCalls=modelCalls;await write();});
 after(async()=>{
  if(original){
   // Item notifications schedule preparation 1.5 seconds after attachment
   // creation. Let them reach the suppressed queues before restoring services.
   await Zotero.Promise.delay(1800);
   E.studio.request=original.request;E.fetchDiscoveryPDF=original.fetch;E.manuscripts.queueArticle=original.queue;E.assets.queueImages=original.images;E.manuscripts.prepareTranslation=original.translation;E.queueReaderPreparation=original.reader;
  }
  await E.store.flush();report.modelCalls=modelCalls;await write();win?.close();
 });
 it('reads real Crossref metadata and confirms the public PLOS license',async()=>{
  const started=Date.now(),data=JSON.parse(await E.requestProvider('https://api.crossref.org/works/'+encodeURIComponent(DOI),{},20000)).message;
  assert.equal(String(data.DOI).toLowerCase(),DOI);assert.isAbove(data.title?.[0]?.length||0,0);
  const license=data.license?.find(row=>/^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/by\//i.test(row.URL||''));assert.exists(license,'真实出版者题录应提供 CC BY 许可');
  const metadata=Journals.journalMetadataRecord(data);assert.exists(metadata);assert.equal(metadata.doi,DOI);
  // Crossref currently supplies a similarity-checking landing link, not a PDF
  // link. PLOS's documented article/file endpoint is explicit here; its bytes
  // still pass through the real production downloader and PDF validation.
  record={...metadata,pdf:'https://journals.plos.org/plosone/article/file?id='+DOI+'&type=printable',oa:true,metadataOnly:false};
  report.metadata={doi:data.DOI,title:record.title,journal:record.journal,license:license.URL,provider:'Crossref',afterMs:Date.now()-started,pdfResolution:'PLOS article/file endpoint for the confirmed DOI; Crossref link is a landing page'};
  assert.equal(modelCalls,0);
 });
 it('downloads actual PDF bytes, saves a native attachment into the chosen folder and registers the output',async()=>{
  assert.exists(record,'先取得真实论文题录');const stages=[],started=Date.now();
  try{first=await E.obtainPaper(record,{collectionID:collection.id,libraryID:collection.libraryID,open:false,onProgress:value=>stages.push({stage:value.stage,text:value.text,loaded:value.loaded,total:value.total})});}
  catch(error){report.downloadFailure={message:error.message,afterMs:Date.now()-started,transport:report.transport};throw error;}
  assert.isTrue(first.downloaded,'请使用新的 TestRunID，首轮验收必须实际传输 PDF');assert.isAbove(first.attachmentID,0);assert.isTrue(await IOUtils.exists(first.path));
  const attachment=await Zotero.Items.getAsync(first.attachmentID),paper=await Zotero.Items.getAsync(first.itemID),bytes=await IOUtils.read(first.path),prefix=String.fromCharCode(...bytes.subarray(0,16));
  assert.isTrue(attachment.isPDFAttachment());assert.equal(attachment.parentID,paper.id);assert.equal(paper.getField('DOI').toLowerCase(),DOI);assert.include(paper.getCollections(),collection.id);assert.include(prefix,'%PDF-');assert.isAbove(bytes.length,100000);
  const hash=Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);hash.init(hash.SHA256);hash.update(bytes,bytes.length);const sha256=Array.from(hash.finish(false),character=>character.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  const outputs=await E.workspaceOutputs.listDownloads({collectionID:collection.id,libraryID:collection.libraryID});assert.exists(outputs.rows.find(row=>row.attachmentID===attachment.id),'真实附件必须进入所选文件夹的已下载列表');assert.equal(outputs.folder,collection.name);
  report.download={...first,bytes:bytes.length,sha256,pdfHeader:prefix,afterMs:Date.now()-started,stages,outputCount:outputs.rows.length,folder:outputs.folder};assert.equal(modelCalls,0);
 });
 it('reuses the same saved attachment on another click without transferring it again',async()=>{
  assert.exists(first);const before=report.transport.length,second=await E.obtainPaper(record,{collectionID:collection.id,libraryID:collection.libraryID,open:false});
  assert.equal(second.attachmentID,first.attachmentID);assert.equal(second.itemID,first.itemID);assert.isTrue(second.reused);assert.equal(report.transport.length,before,'再次点击不能重新传输已保存 PDF');assert.equal(modelCalls,0);
  report.reuse={itemID:second.itemID,attachmentID:second.attachmentID,reused:true,extraPDFTransfers:report.transport.length-before};
 });
});
