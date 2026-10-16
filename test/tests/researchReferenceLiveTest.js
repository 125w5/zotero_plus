/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Live reference metadata and native pane',function(){
 this.timeout(600000);
 const E=Zotero.Research,Ref=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs');
 let win,pdf,paper,folder,originalRequest,originalArxiv,result,local,pane,body;
 const requests={started:0,completed:0,failed:0},arxivCalls={started:0,completed:0,failed:0};
 const report={type:'实际 PDF、Zotero 进程内真实联网；前台事件由 DOM 触发，不等同真人鼠标操作',tests:[],limitations:[]};
 const wait=async(fn,timeout=120000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待参考文献界面超时');};
 const write=async()=>{if(folder)await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));};
 before(async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1450,960);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'reference-live-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const supplied=Zotero.Prefs.get('extensions.easysch.testPDF',true),filename=supplied?PathUtils.filename(supplied):'';
  const fingerprint=async path=>{const bytes=await IOUtils.read(path),hash=Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);hash.init(hash.SHA256);hash.update(bytes,bytes.length);return hash.finish(false);};
  const expected=supplied&&await IOUtils.exists(supplied)?await fingerprint(supplied):null;
  for(const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)){
   if(!item.isPDFAttachment()||item.deleted||!await item.fileExists())continue;
   const path=await item.getFilePathAsync();
   if(PathUtils.filename(path)===filename||/C-AMC/i.test(item.getField('title')+' '+PathUtils.filename(path))){if(expected&&await fingerprint(path)!==expected)continue;pdf=item;break;}
  }
  assert.exists(pdf,'隔离文库需要已导入的真实 C-AMC PDF；本套件不另建附件或批量下载');
  paper=E.library.describe(pdf.parentItem||pdf);
  originalRequest=E.requestProvider;E.requestProvider=async(...args)=>{
   // Deliberately keep only counts: no request URLs, headers, credentials,
   // raw API responses or endpoint configuration enter the report.
   requests.started++;try{const response=await originalRequest(...args);requests.completed++;return response;}catch(error){requests.failed++;throw error;}
  };
  originalArxiv=E.arxivMetadata;E.arxivMetadata=async(...args)=>{arxivCalls.started++;try{const response=await originalArxiv(...args);arxivCalls.completed++;return response;}catch(error){arxivCalls.failed++;throw error;}};
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await write();});
 after(async()=>{
  if(originalRequest)E.requestProvider=originalRequest;if(originalArxiv)E.arxivMetadata=originalArxiv;
  body?._referenceDispose?.();await E.store.flush();await write();win?.close();
 });
 it('reads every actual bibliography entry, matches reliably and reuses shared tasks and saved metadata',async()=>{
  local=await E.referencesFromPDF({id:pdf.id});assert.isAbove(local.records.length,0);
  const before={...requests},progress=[];
  const [first,second]=await Promise.all([
   E.collectReferences(paper,{refresh:true,onProgress:p=>progress.push({done:p.done,total:p.total,found:p.found})}),
   E.collectReferences(paper,{refresh:true})
  ]);result=first;
  assert.equal(result.references.length,local.records.length,'可靠匹配不能丢弃未找到的原题录');
  assert.deepEqual(result.records.map(p=>p.doi||p.id),second.records.map(p=>p.doi||p.id));
  for(const record of result.records){assert.isAbove(record.citationOrigins.length,0);for(const origin of record.citationOrigins)assert.isTrue(Ref.matchesReference(origin,record),'引用关系必须满足严格来源匹配');}
  const matchedOrigins=new Set(result.records.flatMap(p=>p.citationOrigins.map(o=>String(o.id))));
  report.collection={rawTotal:local.records.length,strictlyMatchedPapers:result.records.length,matchedBibliographyEntries:matchedOrigins.size,retainedUnmatchedEntries:result.references.filter(r=>!matchedOrigins.has(String(r.id))).length,actualAbstracts:result.records.filter(p=>p.abstract?.trim()).length,actualTags:result.records.filter(p=>Ref.referenceTags(p).length).length,requests:{started:requests.started-before.started,completed:requests.completed-before.completed,failed:requests.failed-before.failed},arxivMetadataCalls:{...arxivCalls},sameSharedResultObject:first===second,progress:first.cacheHit?[]:progress.slice(0,3).concat(progress.slice(-1)),skipped:result.skipped.map(s=>({referenceID:s.referenceID,reason:s.reason}))};
  if(first!==second)report.limitations.push('两次收集结果一致，但本次完成时机没有确认同一个在途结果对象；任务共享由独立本地测试验证。');
  const count=requests.started,arxivCount=arxivCalls.started,cached=await E.collectReferences(paper);
  assert.isTrue(cached.cacheHit);assert.equal(requests.started,count);assert.equal(arxivCalls.started,arxivCount);
  report.cache={cacheHit:true,extraProviderRequests:requests.started-count,extraArxivCalls:arxivCalls.started-arxivCount};
  // Positive metadata caches are intentionally preserved. If collection reused
  // all of them, make one read-only public DOI check and report it separately.
  if(!report.collection.requests.started&&!arxivCalls.started){
   report.limitations.push('本轮整篇匹配复用了已获取元数据，未新增逐条题录请求；以下单条端点核实与整篇缓存验收分别报告。');
   const candidate=result.records.find(p=>p.doi);assert.exists(candidate,'缓存中没有可单独核实的已匹配 DOI');
   const prior=requests.started,data=JSON.parse(await E.requestProvider('https://api.crossref.org/works/'+encodeURIComponent(Ref.cleanDOI(candidate.doi)),{},12000)).message;
   assert.equal(Ref.cleanDOI(data.DOI),Ref.cleanDOI(candidate.doi));report.readOnlyProbe={provider:'Crossref',newRequest:requests.started-prior,exactDOIVerified:true,titlePresent:!!data.title?.[0]};
  }
 });
 it('shows all original references in the actual native pane without repeated process labels',async()=>{
  assert.exists(result,'先完成实际题录收集');const reader=await E.openReaderReady(pdf.id);
  win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  await wait(()=>{pane=[...win.document.querySelectorAll('item-pane-custom-section')].find(n=>n.dataset.pane?.includes('research-references')&&n.closest('item-details')?.tabID===reader.tabID);return pane;});
  pane.open=true;body=pane._body;assert.exists(body);await E.renderReferencePane(body,pane.item||pdf);
  await pane.closest('item-details').scrollToPane(pane.dataset.pane,'instant');await wait(()=>body.querySelectorAll('.reference-row').length===local.records.length&&body.querySelector('.reference-actions')?.getAttribute('aria-busy')==='false');
  assert.isAbove(body.getBoundingClientRect().width,0);assert.isAbove(body.getBoundingClientRect().height,0);
  for(const text of ['尚未匹配','保留原始题录','全文未获取：','匹配题录'])assert.notInclude(body.textContent,text);
  const rows=[...body.querySelectorAll('.reference-row')];
  for(const row of rows){const ref=result.references.find(r=>String(r.id)===row.dataset.referenceId),record=result.records.find(p=>p.citationOrigins.some(o=>o.id===ref.id));if(!record)assert.isTrue(row.querySelector('.reference-download').hidden);if(!Ref.referenceTags(record||{}).length)assert.isTrue(row.querySelector('.reference-tags').hidden);}
  const titleBounds=rows.map(row=>{const title=row.querySelector('.reference-title'),rect=row.getBoundingClientRect(),titleRect=title.getBoundingClientRect(),style=win.getComputedStyle(title);assert.notExists(row.querySelector('.reference-details'),'实际题录保持紧凑行，摘要使用整个右栏');assert.isAtLeast(rect.height,32);assert.isAtMost(rect.height,44);assert.equal(style.whiteSpace,'nowrap');assert.equal(style.textOverflow,'ellipsis');assert.equal(style.overflowX,'hidden');assert.isAtLeast(titleRect.width,1,'真实标题仍有可见宽度');assert.isAtMost(titleRect.right,rect.right+1,'题名容器不得横向溢出');assert.isAtMost(titleRect.bottom,rect.bottom+1,'题名容器不得溢出本行');assert.isAtLeast(title.clientHeight+1,title.scrollHeight,'紧凑行不得纵向裁切文字');return {top:rect.top,bottom:rect.bottom,height:rect.height,titleHeight:titleRect.height,ellipsized:title.scrollWidth>title.clientWidth+1};});
  for(let i=1;i<titleBounds.length;i++)assert.isAtLeast(titleBounds[i].top+1,titleBounds[i-1].bottom,'相邻参考题录的紧凑行不能重叠');
  const longRow=rows.reduce((longest,row)=>row.querySelector('.reference-title').textContent.length>longest.querySelector('.reference-title').textContent.length?row:longest,rows[0]),list=body.querySelector('.reference-list');
  longRow.querySelector('.reference-title').click();const detail=body.querySelector('.reader-reference-detail'),fullTitle=detail.querySelector('.reader-reference-heading');assert.isTrue(list.hidden);assert.equal(fullTitle.textContent,longRow.querySelector('.reference-title').textContent);const range=win.document.createRange();range.selectNodeContents(fullTitle);const fullText=range.getBoundingClientRect();assert.isAtLeast(fullTitle.getBoundingClientRect().bottom+1,fullText.bottom);assert.isAtLeast(fullTitle.clientWidth+1,fullTitle.scrollWidth);assert.closeTo(detail.getBoundingClientRect().width,body.getBoundingClientRect().width,1);detail.querySelector('.reader-reference-back').click();assert.isFalse(list.hidden);assert.deepEqual([...body.querySelectorAll('.reference-row')],rows,'返回保留所有原题录节点和顺序');
  report.nativePane={visible:true,totalRows:rows.length,rowsWithRealTags:rows.filter(r=>!r.querySelector('.reference-tags').hidden).length,unmatchedPreserved:true,processLabelsRemoved:true,titleContainerOverflow:0,adjacentRowOverlap:0,minRowHeight:Math.min(...titleBounds.map(b=>b.height)),maxRowHeight:Math.max(...titleBounds.map(b=>b.height)),ellipsizedRows:titleBounds.filter(b=>b.ellipsized).length,expandedActualTitleComplete:true,expandedTitleHeight:fullText.height};
  // Reader initialization precedes asynchronous PDF painting. A blank canvas
  // is not an acceptable visual capture of the native reader.
  const view=reader._internalReader._primaryView;await view.initializedPromise;await reader.navigate({pageIndex:0});
  await wait(()=>{const app=view._iframeWindow.PDFViewerApplication,page=app?.pdfViewer?.getPageView(0),unwrapped=page&&Cu.waiveXrays(page),canvas=unwrapped?.div?.querySelector('canvas');return unwrapped?.renderingState===3&&canvas?.width>0&&canvas?.getBoundingClientRect().height>0;});
  await Zotero.Promise.delay(250);report.nativePane.originalPDFPainted=true;
  const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'references-live.png'),new Uint8Array(await blob.arrayBuffer()));image.close();
  report.limitations.push('本套件不发起附件下载；公开全文下载失败的同行提示本次真实调用未验证，另有受控 DOM 验收。');
 });
 it('previews only a genuinely retrieved abstract through native keyboard focus',async function(){
  const record=result.records.find(p=>p.abstract?.trim());if(!record){report.limitations.push('实际已匹配题录未提供摘要，因此真实摘要浮层与摘要机翻未验证；没有生成虚构摘要。');this.skip();return;}
  const id=String(record.citationOrigins[0].id),row=[...body.querySelectorAll('.reference-row')].find(r=>r.dataset.referenceId===id);assert.exists(row);
  const initialHeight=row.getBoundingClientRect().height;row.querySelector('.reference-title').focus();await wait(()=>win.document.querySelector('.reference-preview p')?.textContent.trim());
  const preview=win.document.querySelector('.reference-preview');assert.include(preview.textContent,record.title);assert.isAbove(preview.getBoundingClientRect().width,0);
  assert.closeTo(row.getBoundingClientRect().height,initialHeight,1,'真实摘要浮层不能改变紧凑行高');assert.notExists(row.querySelector('.reference-details'));row.querySelector('.reference-title').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.notExists(win.document.querySelector('.reference-preview'),'Esc可关闭真实摘要浮层');assert.closeTo(row.getBoundingClientRect().height,initialHeight,1);
  report.abstractPreview={sourceAbstractExists:true,visible:true,containsPaperTitle:true,preservesCompactLayout:true,escapeClosesPreview:true,initialDisplay:'真实摘要直接展示，英文摘要机翻异步进行；本断言不将异步完成当作已验证'};
  body._referenceDispose?.();
 });
});
