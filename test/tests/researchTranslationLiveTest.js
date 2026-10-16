/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Whole PDF translation with real services', function () {
 this.timeout(600000);
 const E=Zotero.Research;
 let win,attachment,reader,folder,originalTranslate,originalRequestProvider,probeSource,originalZoom,originalPanelSettings;
 const report={type:'真实本地 PDF 与程序触发的 Zotero DOM；全文缓存复用和单段真实翻译端点分别记录',verification:{cacheConsumption:'待执行',realAPI:'待执行',nativeDOM:'待执行',humanMouse:'未验证；本套件不模拟或代替真人鼠标验收'},checks:[],requests:0,translationCalls:0,translationResults:[],providers:[],endpointTypes:[],providerCalls:[],limitations:[]};
 const persist=()=>IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
 const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('真实译文界面等待超时');};
 const tokens=text=>String(text||'').match(/\bZXQMATH[A-Z0-9]*ZXQ\b/g)||[];
 const readable=(block,text)=>String(text||'').replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,token=>block.inlineMath?.find(run=>run.placeholder===token)?.sourceText||token);
 const displayText=block=>block.translatable===false?block.sourceText:block.translatedText;
 const sourcePages=()=>Array.from({length:report.pages?.length||1},(_,i)=>E.manuscripts.translationPage(attachment.id,i));
 const safeError=error=>String(error?.message||error||'').replace(/https?:\/\/\S+/g,'〔已隐藏端点地址〕').replace(/\bsk-[A-Za-z0-9_-]+/g,'〔已隐藏凭据〕').replace(/Bearer\s+\S+/gi,'Bearer 〔已隐藏凭据〕');
 const liveTest=(title,run)=>it(title,async()=>{try{await run();}catch(error){report.failures||={};report.failures[title]=safeError(error);if(folder)await persist();throw error;}});
 before(async function () {
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();
  win=await loadZoteroPane();await E.attachWindow(win);
  folder=PathUtils.join(E.dataDir,'translation-live-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const path=Zotero.Prefs.get('extensions.easysch.testPDF',true);
  for(const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID))if(item.isPDFAttachment()&&!item.deleted&&await item.fileExists()&&/C-AMC/.test(item.getField('title'))){attachment=item;break;}
  if(!attachment){assert.isOk(path,'真实验收需要通过 -PDF 指定公开论文');const paper=await createDataObject('item',{itemType:'journalArticle',title:'C-AMC: Towards Complete Automatic Modulation Classification'});attachment=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:paper.id});}
  originalTranslate=E.quickTranslate;
  E.quickTranslate=async(...args)=>{report.translationCalls++;try{const value=await originalTranslate.apply(E,args);report.translationResults.push({valid:true,provider:value.provider,cacheHit:!!value.cacheHit});if(!report.providers.includes(value.provider))report.providers.push(value.provider);return value;}catch(error){report.translationResults.push({valid:false,error:safeError(error)});throw error;}};
  originalRequestProvider=E.requestProvider;
  E.requestProvider=async(...args)=>{
   // Record transport invocation and classification, never headers, tokens,
   // credentials, full settings, or an endpoint URL that could contain them.
   const type=/\/chat\/completions(?:[?#]|$)/.test(String(args[0]))?'OpenAI 兼容 Chat Completions':'其他已配置端点';
   let probe=false;try{const body=JSON.parse(args[1]?.body||'{}');probe=!!probeSource&&body.messages?.some(message=>message.role==='user'&&message.content===probeSource);}catch(_){}
   const call={endpointType:type,probe,completed:false};report.providerCalls.push(call);report.requests++;
   if(!report.endpointTypes.includes(type))report.endpointTypes.push(type);
   try{const value=await originalRequestProvider.apply(E,args);call.completed=true;return value;}catch(error){call.failed=true;throw error;}
  };
  report.attachmentID=attachment.id;report.sourceFile=await attachment.getFilePathAsync();await persist();
 });
 after(async()=>{if(originalTranslate)E.quickTranslate=originalTranslate;if(originalRequestProvider)E.requestProvider=originalRequestProvider;
  if(reader){const doc=reader._iframeWindow.document;doc.querySelector('.easysch-page-translation')?.querySelector('button[aria-label="关闭译文"]')?.click();if(originalZoom!==undefined)Cu.waiveXrays(reader._internalReader._primaryView._iframeWindow.PDFViewerApplication.pdfViewer).currentScaleValue=originalZoom;}
  if(originalPanelSettings)await E.store.update(s=>{for(const [key,value]of Object.entries(originalPanelSettings)){if(value===undefined)delete s.settings[key];else s.settings[key]=value;}});
  if(folder)await persist();await E.store.flush();win?.close();});
 afterEach(async function(){
  const test=this.currentTest;report.checks.push({name:test.title,state:test.state,error:report.failures?.[test.title]||(test.err?safeError(test.err):undefined)});
  if(test.state==='failed'){
   if(test.title.startsWith('prepares'))report.verification.cacheConsumption='未通过；见该项错误';
   if(test.title.startsWith('calls'))report.verification.realAPI='未通过；没有将受控回复或旧缓存计为真实调用';
   if(test.title.startsWith('renders'))report.verification.nativeDOM='未通过；没有将不可见 DOM 或截图计为前台验收';
  }
  if(folder)await persist();
 });
 liveTest('prepares and translates every page before opening the translation panel',async()=>{
  const start=Date.now(),requestsBefore=report.requests,callsBefore=report.translationCalls,resultsBefore=report.translationResults.length,prepared=await E.manuscripts.prepareTranslation(attachment.id);
  assert.isAbove(prepared.pageCount,1);assert.lengthOf(prepared.pages,prepared.pageCount);
  report.prepareMs=Date.now()-start;report.documentKey=prepared.documentKey;report.pdfHash=prepared.pdfHash;report.layoutVersion=prepared.layoutVersion;
  assert.equal(prepared.layoutVersion,'pymupdf-translation-layout-v5','本轮必须使用新角色和数学定位的提取版本');
  await E.manuscripts.queueTranslation(attachment.id,{retry:true});
  report.pages=Array.from({length:prepared.pageCount},(_,i)=>{const page=E.manuscripts.translationPage(attachment.id,i);return {pageIndex:i,status:page.status,error:page.error?safeError(page.error):null,blocks:page.blocks.length,text:page.blocks.filter(b=>b.kind==='text').length,protectedText:page.blocks.filter(b=>b.kind==='text'&&b.translatable===false).map(b=>({id:b.id,sourceRole:b.sourceRole,originalText:b.originalText})),visual:page.blocks.filter(b=>['formula','image','table'].includes(b.kind)).length,inlineMath:page.blocks.reduce((count,b)=>count+(b.inlineMath?.length||0),0),failed:page.blocks.filter(b=>b.status==='failed'&&b.translatable!==false).map(b=>({id:b.id,error:safeError(b.error),source:b.originalText||readable(b,b.sourceText)}))};});
  const results=report.translationResults.slice(resultsBefore);
  report.wholeDocument={type:'全文持久缓存准备与消费',providerCallCount:report.requests-requestsBefore,translationCalls:report.translationCalls-callsBefore,validReplies:results.filter(result=>result.valid).length,rejectedTranslations:results.filter(result=>!result.valid).length,cacheHits:results.filter(result=>result.valid&&result.cacheHit).length,uncachedReplies:results.filter(result=>result.valid&&!result.cacheHit).length,modelInvocationVerified:results.some(result=>result.valid&&!result.cacheHit)&&report.requests>requestsBefore};
  if(!report.wholeDocument.modelInvocationVerified)report.limitations.push('本轮整篇译文没有本轮模型端点调用证明，不作为本轮整篇真实模型生成验收；缓存消费与单段真实 API 分开记录');
  report.totalMs=Date.now()-start;await persist();
  assert.isTrue(report.pages.every(p=>p.status==='complete'),'全文应完成；失败详情见 translation-live-acceptance/report.json');
  const requests=report.requests;await E.manuscripts.queueTranslation(attachment.id);
  assert.equal(report.requests,requests,'再次准备复用全文缓存，不请求翻译');
  report.verification.cacheConsumption='已通过；同一来源第二次准备没有新增翻译请求';
 });
 liveTest('retains every real inline math crop and its PDF baseline before rendering',async()=>{
  const pages=sourcePages(),runs=pages.flatMap(page=>page.blocks.flatMap(block=>(block.inlineMath||[]).map(run=>({pageIndex:page.pageIndex,block,run}))));
  const layoutFile=PathUtils.join(E.dataDir,'translation-cache',E.assets.key([report.documentKey,'pymupdf-translation-layout-v5'])+'.layout.json'),layout=JSON.parse(await IOUtils.readUTF8(layoutFile));
  assert.equal(layout.extractorVersion,'pymupdf-translation-layout-v5');assert.equal(layout.pdfHash,report.pdfHash);
  const extractedCount=layout.pages.reduce((count,page)=>count+page.blocks.reduce((sum,block)=>sum+(block.inlineMath?.length||0),0),0);
  report.inlineMath={type:'真实 PDF 确定性提取及持久缓存；不是模型重绘公式',count:runs.length,extractedCount,layoutVersion:layout.extractorVersion,assetChecks:[],legacyUserEditedBlocks:[]};
  assert.isAbove(runs.length,0,'真实论文必须包含受保护的行内数学');
  assert.equal(runs.length,extractedCount,'本版真实提取的全部数学对象均进入当前页数据，不按旧版错误提取数量验收');
  for(const {pageIndex,block,run}of runs){
   assert.isTrue(Number.isFinite(run.width)&&run.width>0);assert.isTrue(Number.isFinite(run.height)&&run.height>0);assert.isTrue(Number.isFinite(run.baselineOffset),'数学原图保留 PDF 基线偏移');
   assert.isAtLeast(run.visualAsset?.dpi||0,288,'行内公式至少 288dpi，不能用正文低分辨率截图');
   const exists=await IOUtils.exists(run.visualAsset.path);assert.isTrue(exists,'每个公式原图必须已在缓存文件中存在');
   assert.equal(tokens(block.sourceText).filter(token=>token===run.placeholder).length,1,'原文公式位置唯一');
   if(!block.legacyInlinePlaintext)assert.equal(tokens(displayText(block)).filter(token=>token===run.placeholder).length,1,'正文或原文题录须保留每个公式位置，禁止压成普通字符');
   report.inlineMath.assetChecks.push({pageIndex,blockID:block.id,placeholder:run.placeholder,sourceText:run.sourceText,dpi:run.visualAsset.dpi,width:run.width,height:run.height,baselineOffset:run.baselineOffset,exists});
  }
  for(const page of pages)for(const block of page.blocks)if(block.legacyInlinePlaintext)report.inlineMath.legacyUserEditedBlocks.push({pageIndex:page.pageIndex,blockID:block.id});
  if(report.inlineMath.legacyUserEditedBlocks.length)report.limitations.push('旧版用户手改的纯文本译文原样保留；本轮不将其静默替换为带公式的生成结果');
  await persist();
 });
 liveTest('calls the configured academic translator once with a real C-AMC passage without changing the existing cache',async()=>{
  const candidates=[];for(let pageIndex=0;pageIndex<(report.pages?.length||1);pageIndex++){
   for(const block of E.manuscripts.translationPage(attachment.id,pageIndex).blocks||[]){
    const text=String(block.sourceText||'').trim();
    if(block.kind==='text'&&block.translatable!==false&&text.length<=1600&&(text.match(/[A-Za-z]/g)||[]).length>=100)candidates.push({pageIndex,block,text});
   }
  }
  const source=candidates.find(candidate=>candidate.pageIndex===5&&candidate.block.inlineMath?.length)||candidates.find(candidate=>candidate.block.inlineMath?.length)||candidates.find(candidate=>/^abstract\b|C-AMC/i.test(candidate.text))||candidates[0];
  assert.exists(source,'必须从已提取的真实 C-AMC PDF 摘要或正文取得原段，不构造验收文本');
  const before=E.store.get('translationCache')||{},start=Date.now(),callsBefore=report.requests;
  const api={type:'单段真实 Zotero 进程内 API 调用',sourceType:/^abstract\b/i.test(source.text)?'PDF 摘要原段':'PDF 正文原段',attachmentID:attachment.id,pageIndex:source.pageIndex,blockID:source.block.id,position:source.block.position,sourceText:source.block.originalText||readable(source.block,source.text),inlineMathCount:source.block.inlineMath?.length||0,persist:false,forceAcademic:true,requestCount:0,completed:false};
  report.realAPI=api;probeSource=source.text;
  try{
   const result=await E.quickTranslate(source.text,undefined,{persist:false,forceAcademic:true});
   const calls=report.providerCalls.filter(call=>call.probe);
   Object.assign(api,{elapsedMs:Date.now()-start,provider:result.provider,cacheHit:result.cacheHit,requestCount:calls.length,totalProviderCalls:report.requests-callsBefore,endpointTypes:[...new Set(calls.map(call=>call.endpointType))],translation:readable(source.block,result.text),completed:true});
   assert.isAbove(calls.length,0,'forceAcademic 必须实际进入配置端点，不能用旧缓存代替本轮真实 API');
   assert.isTrue(calls.some(call=>call.completed),'真实端点应返回并被正常解析');
   assert.isFalse(result.cacheHit,'本次检验主动绕过读取缓存');assert.include(result.provider,'GPT-6 Luna');assert.match(result.text,/[\u3400-\u9fff]/);
   assert.isNull(E.manuscripts.translationQualityIssue(source.text,result.text),'真实正文翻译须保留数学对象、引用、数值与中文学术表达');
   const after=E.store.get('translationCache')||{};for(const [key,value]of Object.entries(before))assert.deepEqual(after[key],value,'persist:false 保留已有翻译缓存');
   report.verification.realAPI='已通过；配置端点返回真实单段译文并保留公式标记，不改已有缓存';
  }finally{probeSource=null;api.requestCount=report.providerCalls.filter(call=>call.probe).length;api.elapsedMs=Date.now()-start;await persist();}
 });
 liveTest('renders cached figures, tables, complete formulas and Chinese paragraphs in the actual reader',async()=>{
  win.focus();
  reader=await E.openReaderReady(attachment.id);await reader._internalReader._primaryView.initializedPromise;
  const captureWin=reader._window;assert.exists(captureWin?.Zotero_Tabs,'原生阅读器必须属于可截图的中央标签页窗口');assert.isOk(reader.tabID);
  captureWin.restore();captureWin.focus();captureWin.resizeTo(1600,1040);captureWin.Zotero_Tabs.select(reader.tabID,false,{keepTabFocused:false});
  await wait(()=>captureWin.Zotero_Tabs.selectedID===reader.tabID);assert.equal(captureWin.Zotero_Tabs.selectedType,'reader');
  const doc=reader._iframeWindow.document,sourceView=reader._internalReader._primaryView,app=sourceView._iframeWindow.PDFViewerApplication,viewer=Cu.waiveXrays(app.pdfViewer);
  originalZoom=viewer.currentScaleValue;originalPanelSettings={readerTranslationZoom:E.store.get('settings','readerTranslationZoom'),readerTranslationWidth:E.store.get('settings','readerTranslationWidth')};
  doc.querySelector('.easysch-page-translation')?.querySelector('button[aria-label="关闭译文"]')?.click();viewer.currentScaleValue='page-width';
  const assetIndex=await E.assets.index(attachment.id),excluded=assetIndex.excludedAssets||[];
  report.researchAssets={type:'真实 Zotero 进程内确定性资产索引；未请求图片模型',count:assetIndex.assets.length,excludedAssets:excluded.map(asset=>({researchRole:asset.researchRole,page:asset.page})),manualExceptions:assetIndex.assets.filter(asset=>asset.userModified&&asset.evidenceEligible===false).map(asset=>({researchRole:asset.researchRole,page:asset.page}))};
  if(report.pdfHash==='249155d7ccd34c25ecd01d600d40257dbdf2c3c57dbdd9cdcf7cb3d5fa34f4f3'){
   assert.isTrue(excluded.some(asset=>asset.page===11&&asset.researchRole==='author-portrait'),'原生资产索引确实排除作者肖像');
   assert.isAtLeast(excluded.filter(asset=>asset.page===1&&asset.researchRole==='publisher-cover').length,2,'封面出版标志不作研究图片');
   assert.isFalse(assetIndex.assets.some(asset=>!asset.userModified&&['author-portrait','publisher-cover'].includes(asset.researchRole)),'排除的肖像与封面不进入普通证据资产，用户手动素材保留');
  }
  doc.querySelector('.easysch-translation-open').click();
  await wait(()=>doc.querySelector('.easysch-page-translation [data-page-index="4"] .translation-box p'));
  const panel=doc.querySelector('.easysch-page-translation');
  await wait(()=>panel.querySelectorAll('.translation-visual img').length>0);
  const visual=[...panel.querySelectorAll('.translation-visual img')];
  await wait(()=>visual.every(image=>image.complete&&image.naturalWidth>0));
  const formulas=panel.querySelectorAll('.translation-formula img').length;
  assert.isAbove(visual.length,formulas,'图表与公式均保留');assert.isAbove(formulas,0,'公式原生图像保留');
  const source=sourcePages(),expectedInline=source.reduce((count,page)=>count+page.blocks.reduce((sum,block)=>sum+(block.kind==='text'?tokens(displayText(block)).length:0),0),0),inline=[...panel.querySelectorAll('.translation-inline-math')];
  assert.equal(inline.length,expectedInline,'每个译文公式占位符对应一个原生行内图，不缺对象');
  await wait(()=>inline.every(node=>{const image=node.querySelector('img');return image.dataset.mathReady==='true'&&image.complete&&image.naturalWidth>0&&!image.hidden;}));
  for(const node of inline){
   const sheet=node.closest('.translation-sheet'),page=source[Number(sheet.dataset.pageIndex)],block=page.blocks.find(block=>block.id===node.closest('.translation-box').dataset.blockId),run=block.inlineMath.find(run=>run.placeholder===node.dataset.mathPlaceholder),scale=parseFloat(sheet.style.width)/page.width,image=node.querySelector('img');
   assert.equal(image.alt,run.sourceText);assert.isTrue(node.querySelector('.math-fallback').hidden,'成功读取原图后隐藏纯文本替代');
   assert.closeTo(parseFloat(node.style.width),run.width*scale,.5);assert.closeTo(parseFloat(node.style.height),run.height*scale,.5);assert.closeTo(parseFloat(node.style.verticalAlign),-run.baselineOffset*scale,.5,'上标、下标和分数仍按 PDF 基线定位');
   assert.closeTo(image.naturalWidth,run.visualAsset.width,1);assert.closeTo(image.naturalHeight,run.visualAsset.height,1,'完整原始裁剪尺寸已实际加载');
  }
  assert.notMatch(panel.querySelector('.translation-scroller').textContent,/ZXQMATH\d+ZXQ/,'可见正文不泄漏内部公式占位符');
  const intersects=(rect,clip)=>Math.min(rect.bottom,clip.bottom)-Math.max(rect.top,clip.top)>20&&Math.min(rect.right,clip.right)-Math.max(rect.left,clip.left)>20;
  report.render={type:'真实 PDF 缓存，程序操作的原生 DOM；截图视觉质量需另行人工检查',visual:visual.length,formulas,inlineMath:inline.length,sheets:panel.querySelectorAll('.translation-sheet').length,text:panel.querySelectorAll('.translation-box p').length,captures:[],visualReview:'未验证；生成截图本身不等于视觉验收'};
  for(const pageIndex of [4,5]){
   // sourceView belongs to the outer reader iframe. Its nested PDF iframe
   // owns the canvas, but navigate arguments must belong to the outer view.
   captureWin.Zotero_Tabs.select(reader.tabID,false,{keepTabFocused:false});captureWin.focus();
   await sourceView.navigate(Cu.cloneInto({pageIndex},reader._iframeWindow));
   await wait(()=>app.pdfViewer.currentPageNumber===pageIndex+1&&new RegExp('^'+(pageIndex+1)+'\\s*\\/').test(panel.querySelector('header span').textContent));
   await wait(()=>{const page=Cu.waiveXrays(viewer.getPageView(pageIndex));return viewer.currentScaleValue==='page-width'&&page.renderingState===3&&page.div.querySelector('canvas')?.width>0;});await Zotero.Promise.delay(300);
   assert.equal(captureWin.Zotero_Tabs.selectedID,reader.tabID,'截图前仍选中真实 PDF 阅读标签');assert.equal(captureWin.Zotero_Tabs.selectedType,'reader');
   assert.equal(app.pdfViewer.currentPageNumber,pageIndex+1,'截图前原文确实是指定页');
   const frameBounds=reader._iframe.getBoundingClientRect(),bounds=panel.getBoundingClientRect(),sheet=panel.querySelector('[data-page-index="'+pageIndex+'"]'),sheetBounds=sheet.getBoundingClientRect();
   assert.isAbove(frameBounds.width,400,'当前阅读器 frame 可见');assert.isAbove(frameBounds.height,200);
   assert.isAbove(bounds.width,200,'译文面板可见而非后台标签 DOM');assert.isAbove(bounds.height,200);
   assert.isAtLeast(bounds.left+frameBounds.left,-1);assert.isAtMost(bounds.right+frameBounds.left,captureWin.innerWidth+1);
   assert.isAtLeast(bounds.top+frameBounds.top,-1);assert.isAtMost(bounds.bottom+frameBounds.top,captureWin.innerHeight+1);
   assert.isTrue(intersects(sheetBounds,bounds),'指定页译文纸张实际处于可视区域');
   const visibleParagraphs=[...sheet.querySelectorAll('.translation-box:not(.translation-visual) p')].filter(node=>/[\u3400-\u9fff]/.test(node.textContent)&&intersects(node.getBoundingClientRect(),bounds)),visibleMath=[...sheet.querySelectorAll('.translation-inline-math')].filter(node=>{const rect=node.getBoundingClientRect();return Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top)>1&&Math.min(rect.right,bounds.right)-Math.max(rect.left,bounds.left)>1;});
   assert.isAbove(visibleParagraphs.length,0,'截图包含实际可见的指定页中文译文');
   const sourcePage=Cu.waiveXrays(app.pdfViewer.getPageView(pageIndex)).div,sourceContainer=sourceView._iframeWindow.document.getElementById('viewerContainer');
   assert.isTrue(intersects(sourcePage.getBoundingClientRect(),sourceContainer.getBoundingClientRect()),'指定页原文必须实际可见');
   assert.notEqual(captureWin.windowState,captureWin.STATE_MINIMIZED,'不能用最小化窗口的快照作为前台可见证据');
   const filename='real-page-'+(pageIndex+1)+'.png',capture={sourcePageNumber:app.pdfViewer.currentPageNumber,selectedTabID:captureWin.Zotero_Tabs.selectedID,translationPageLabel:panel.querySelector('header span').textContent,visibleParagraphs:visibleParagraphs.length,visibleInlineMath:visibleMath.length,panelBounds:{left:bounds.left+frameBounds.left,top:bounds.top+frameBounds.top,width:bounds.width,height:bounds.height},screenshot:filename};
   const snapshot=await captureWin.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
   try{const canvas=captureWin.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;canvas.getContext('2d').drawImage(snapshot,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));assert.exists(blob,'选中的原生窗口成功截图');await IOUtils.write(PathUtils.join(folder,filename),new Uint8Array(await blob.arrayBuffer()));capture.width=canvas.width;capture.height=canvas.height;report.render.captures.push(capture);await persist();}finally{snapshot.close();}
  }
  report.verification.nativeDOM='已通过；所有缓存公式图已读取，原生双栏第 5/6 页均可见并生成截图';await persist();
 });
});
