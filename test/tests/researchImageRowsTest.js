/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Compact image evidence rows',function(){
 this.timeout(120000);
 const E=Zotero.Research;
 let win,host,panel,prior,folder,previewCalls,indexCalls,queueCalls,locations,saved,materials,notify,notifyImages,details,pane,realReader,savedOrder,savedNavigate,paper;
 const report={type:'真实 Zotero PDF 与原生 item-details 布局；图表、说明、笔记保存回复受控；未调用真实模型或联网',tests:[],sizing:[]};
 const assets=[
  {id:'formula-last',kind:'formula',label:'Eq. 2',pageIndex:1,page:2,bbox:[10,220,180,280],pageWidth:600,pageHeight:800,pdfHash:'controlled-images',thumbnail:'formula-thumb',path:'formula-full',width:170,height:60,caption:''},
  {id:'figure-first',kind:'figure',label:'Fig. 1',pageIndex:0,page:1,bbox:[10,40,180,140],pageWidth:600,pageHeight:800,pdfHash:'controlled-images',thumbnail:'figure-thumb',path:'figure-full',width:800,height:80,caption:'Controlled original caption.'},
  {id:'table-middle',kind:'table',label:'Table 1',pageIndex:1,page:2,bbox:[10,20,180,100],pageWidth:600,pageHeight:800,pdfHash:'controlled-images',thumbnail:'table-thumb',path:'table-full',width:80,height:500,caption:'Table 1. zm2 and α. <img src=x onerror=alert(1)>',captionRuns:[{text:'Table 1. '},{text:'z',fontStyle:'italic'},{text:'m',script:'sub'},{text:'2',script:'super'},{text:' and α. '},{text:'<img src=x onerror=alert(1)>',script:'unknown',fontStyle:'unknown'}]}
 ];
 const wait=async(fn,label='图片证据行')=>{for(let i=0;i<200;i++){if(fn())return;await Zotero.Promise.delay(30);}throw Error('等待'+label+'超时');};
 const capture=async name=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}};
 const settledDetail=async assetID=>{
  await wait(()=>{const root=win.document.querySelector('.reader-evidence-backdrop'),image=root?.querySelector('.reader-evidence-original'),chat=root?.querySelector('.reader-evidence-chat .conversation-surface');return root?.dataset.assetId===assetID&&image?.complete&&image.naturalWidth>0&&chat?.dataset.embedded==='true';},'原图解码并完成共享对话挂载');
  let previous,stable=0,last;
  for(let i=0;i<100;i++){
   await new Promise(resolve=>win.requestAnimationFrame(resolve));const root=win.document.querySelector('.reader-evidence-backdrop');if(!root)throw Error('图表详情在布局稳定前关闭');
   const rects=['.reader-evidence-original','.reader-evidence-image-region','.reader-evidence-sidebar','.reader-evidence-reading','.reader-evidence-chat'].map(selector=>root.querySelector(selector).getBoundingClientRect()),values=rects.flatMap(rect=>[rect.left,rect.top,rect.width,rect.height]);
   const active=root.getAnimations({subtree:true}).some(animation=>(animation.playState==='running'||animation.pending)&&animation.effect?.getComputedTiming().iterations!==Infinity);
   stable=!active&&previous&&values.every((value,index)=>Math.abs(value-previous[index])<.1)?stable+1:0;previous=values;last={values,active};if(stable>=3)return root;
  }throw Error('原图、解释栏和共享对话未在连续帧中稳定：'+JSON.stringify(last));
 };
 let reader={itemID:null,navigate:async location=>locations.push(location)};
 const row=id=>panel.querySelector(`[data-asset-id="${id}"]`);
 const image=id=>row(id).querySelector('.asset-preview-trigger');
 const click=(node,detail=1)=>node.dispatchEvent(new win.MouseEvent('click',{detail,bubbles:true,cancelable:true}));
 const openDetail=id=>image(id).dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);
  previewCalls=[];indexCalls=queueCalls=0;locations=[];saved=[];
  folder=PathUtils.join(Zotero.DataDirectory.dir,'image-rows-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  prior={index:E.assets.index,queue:E.assets.queueImages,state:E.assets.imageState,material:E.assets.materialFor,images:E.assets.onImagesChanged,changed:E.manuscripts.onAssetsChanged,hover:E.attachAssetHover,preview:E.previewImage,note:E.saveAssetNote,prepare:E.manuscripts.prepareTranslation,overview:E.renderPaperOverview,metadata:E.completePaperMetadata,metrics:E.ensurePaperMetrics};
  E.manuscripts.prepareTranslation=async()=>null;E.renderPaperOverview=async body=>{body.textContent='受控首页';};E.completePaperMetadata=async()=>{};E.ensurePaperMetrics=async()=>{};
  // Zotero may resume unrelated imports. Only this fixture's requests count.
  E.assets.index=async id=>{if(id===reader.itemID){indexCalls++;return {assets:[...assets],cacheHit:true};}return {assets:[],cacheHit:true};};
  E.assets.queueImages=async id=>{if(id===reader.itemID)queueCalls++;return {status:'complete'};};E.assets.imageState=()=>({status:'complete',total:3,completed:3});
  E.assets.materialFor=asset=>materials?.[asset.id];E.attachAssetHover=async()=>{};
  E.assets.onImagesChanged=fn=>{notifyImages=fn;return()=>{if(notifyImages===fn)notifyImages=null;};};
  E.manuscripts.onAssetsChanged=fn=>{notify=fn;return()=>{if(notify===fn)notify=null;};};
  E.previewImage=async path=>{previewCalls.push(path);const asset=assets.find(a=>[a.thumbnail,a.path].includes(path));const width=asset?.width||170,height=asset?.height||100;return 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><path d="M0 0L${width} ${height}" fill="none" stroke="black"/></svg>`);};
  E.saveAssetNote=async asset=>{saved.push(asset);return {noteID:9988};};
  paper=await createDataObject('item',{itemType:'journalArticle',title:'图片证据的独立 PDF 夹具'});const fixture=getTestDataDirectory();fixture.append('test.pdf');const pdf=await Zotero.Attachments.importFromFile({file:fixture,parentItemID:paper.id});assert.exists(pdf,'隔离文库需要真实 PDF');
  // Controlled responses still belong to the PDF actually bound to item-details.
  // A synthetic attachment ID races the native asynchronous pane renderer, which
  // correctly replaces it with evidence for the selected real reader attachment.
  reader.itemID=pdf.id;savedOrder=Zotero.Prefs.get('research.images.order.'+pdf.id);for(const asset of assets)asset.attachmentID=pdf.id;
  // Each suite owns a fresh actual reader in its own window. A previous suite
  // can still be completing close notifications for the same attachment.
  win.focus();realReader=await Zotero.Reader.open(pdf.id,null,{allowDuplicate:true});await realReader._initPromise;
  assert.strictEqual(Components.utils.unwaiveXrays(realReader._window),Components.utils.unwaiveXrays(win),'原生证据栏必须属于当前测试窗口的阅读器');
  reader=realReader;savedNavigate=realReader.navigate;realReader.navigate=async location=>locations.push(location);win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  await wait(()=>{details=[...win.document.querySelectorAll('item-details')].find(node=>node.tabID===realReader.tabID);pane=details?.getPanes().find(node=>node.dataset.pane.includes('research-images'));return pane?._body;},'真实阅读器图片证据 section');
  await details._renderPromise;
  pane=details.getPanes().find(node=>node.dataset.pane.includes('research-images'));await details.selectResearchPane(pane.dataset.pane);host=pane._body;
  await pane.asyncRender();await E.renderImagePane(host,pane.item||pdf);
  await wait(()=>host.querySelector('#easysch-asset-panel')?.dataset.ready==='true','真实 PDF 图片证据初次异步渲染');
  assert.equal(host.dataset.easyschAttachment,String(pdf.id),'受控素材仍挂在原生当前 PDF 的真实证据栏');
  host.querySelector('#easysch-asset-panel')?.dispose?.();host.replaceChildren();
 });
 beforeEach(async()=>{
  Zotero.Prefs.clear('research.images.order.'+reader.itemID);
  previewCalls=[];indexCalls=queueCalls=0;locations=[];saved=[];
  materials={
   'figure-first':{revision:1,generationStatus:'complete',verification:'unverified',summary:'比较不同方法在相同实验条件下的识别性能，结论仍须核验。',imageExplanation:{readMode:'image',result:{sections:[{heading:'实验含义',body:'图例和坐标轴对应原论文中的实验设置。'}]},sources:[]}},
   'table-middle':{revision:1,generationStatus:'pending',summary:'原图已提取，正在整理中文说明。'}
  };
  win.Zotero_Tabs.select(realReader.tabID);if(details.researchActivePane!==pane.dataset.pane)await details.selectResearchPane(pane.dataset.pane);else pane.open=true;details.style.width='320px';details.style.maxWidth='320px';details.style.minWidth='0';host.replaceChildren();
  panel=E.openAssetPanel(reader,null,host);await wait(()=>panel.dataset.ready==='true');await wait(()=>panel.querySelector('.asset-task-actions>button').hidden,'初次读取任务结束');
  await wait(()=>[...panel.querySelectorAll('.asset-preview-trigger')].every(img=>img.complete&&img.naturalWidth>0),'图表缩略图解码');await Zotero.Promise.delay(80);
 });
 afterEach(async function(){
  win.document.querySelector('.reader-evidence-backdrop button[aria-label="关闭（Esc）"]')?.click();panel?.dispose();panel?.remove();win.document.querySelector('.easysch-image-preview')?.remove();
  report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
 });
 after(async()=>{
  if(savedOrder===undefined)Zotero.Prefs.clear('research.images.order.'+reader.itemID);else Zotero.Prefs.set('research.images.order.'+reader.itemID,savedOrder);
  E.assets.index=prior.index;E.assets.queueImages=prior.queue;E.assets.imageState=prior.state;E.assets.materialFor=prior.material;E.assets.onImagesChanged=prior.images;E.manuscripts.onAssetsChanged=prior.changed;E.attachAssetHover=prior.hover;E.previewImage=prior.preview;E.saveAssetNote=prior.note;E.manuscripts.prepareTranslation=prior.prepare;E.renderPaperOverview=prior.overview;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;
  if(realReader&&savedNavigate)realReader.navigate=savedNavigate;if(win&&!win.closed){win.Zotero_Tabs.closeAll();await wait(()=>!Zotero.Reader.getByTabID(realReader?.tabID),'测试阅读器关闭通知完成');win.close();}
  if(paper)await paper.eraseTx();
 });
 it('shows only figure/table rows with bounded proportional thumbnails and no list summaries or search',()=>{
  const rows=[...panel.querySelectorAll('.asset-evidence-row')];assert.lengthOf(rows,2);assert.strictEqual(panel.closest('item-details'),details);assert.strictEqual(panel.parentElement,pane._body);
  assert.deepEqual(rows.map(n=>n.dataset.assetId),['figure-first','table-middle']);assert.lengthOf(assets,3,'视图筛选不能删掉公式索引');assert.notExists(panel.querySelector('input,.asset-row-summary,.asset-explanation'));assert.deepEqual([...panel.querySelector('select').options].map(option=>option.value),['all','figure','table','manual']);
  assert.deepEqual(previewCalls,['figure-thumb','table-thumb']);assert.equal(indexCalls,1);assert.equal(queueCalls,1);
  for(const card of rows){assert.isTrue(card.querySelector('.asset-row-content').hidden);const thumb=card.querySelector('.asset-row-thumbnail'),img=card.querySelector('img'),label=card.querySelector('.asset-row-label'),rect=card.getBoundingClientRect(),ir=img.getBoundingClientRect(),lr=label.getBoundingClientRect();assert.strictEqual(label.nextElementSibling,thumb);assert.strictEqual(img.parentElement,thumb);
   assert.isAtLeast(rect.height,54);assert.isAtMost(rect.height,59);assert.isAbove(Math.max(ir.width,ir.height),40);assert.isAtMost(ir.width,70.1);assert.isAtMost(ir.height,44.1);assert.closeTo(ir.width/ir.height,img.naturalWidth/img.naturalHeight,.02);assert.closeTo((ir.top+ir.bottom)/2,(lr.top+lr.bottom)/2,1);assert.equal(win.getComputedStyle(img).objectFit,'contain');
   assert.lengthOf(card.querySelectorAll('.asset-row-actions>button'),2);for(const button of card.querySelectorAll('.asset-row-actions>button')){assert.exists(button.querySelector('svg'));assert.isNotEmpty(button.title);assert.isNotEmpty(button.getAttribute('aria-label'));}
  }assert.isTrue(panel.querySelector('.asset-status').hidden);
 });
 it('opens each row in a full original-image and detailed-explanation viewer while preserving native list nodes and width',async()=>{
  const originals=[...panel.querySelectorAll('.asset-evidence-row')];
  for(const asset of assets.filter(a=>a.kind!=='formula')){const card=row(asset.id),thumb=card.querySelector('img'),before=details.getBoundingClientRect().width;openDetail(asset.id);const overlay=await settledDetail(asset.id);
   const original=overlay.querySelector('.reader-evidence-original'),imageRegion=overlay.querySelector('.reader-evidence-image-region').getBoundingClientRect(),right=overlay.querySelector('.reader-evidence-sidebar').getBoundingClientRect(),reading=overlay.querySelector('.reader-evidence-reading').getBoundingClientRect(),chat=overlay.querySelector('.reader-evidence-chat').getBoundingClientRect(),rect=original.getBoundingClientRect();
   assert.equal(overlay.dataset.assetId,asset.id);assert.strictEqual(thumb.parentElement,card.querySelector('.asset-row-thumbnail'));assert.closeTo(rect.width/rect.height,asset.width/asset.height,.02);assert.isAtLeast(rect.left,imageRegion.left);assert.isAtMost(rect.right,imageRegion.right);assert.closeTo(reading.width,right.width,2);assert.closeTo(chat.width,right.width,2);assert.closeTo(reading.bottom,chat.top,2);assert.closeTo(details.getBoundingClientRect().width,before,1);assert.isAtMost(host.scrollWidth,host.clientWidth+1);
   report.sizing.push({assetID:asset.id,originalWidth:rect.width,originalHeight:rect.height,rightWidth:right.width,readingWidth:reading.width,chatWidth:chat.width});overlay.querySelector('[aria-label="关闭（Esc）"]').click();assert.deepEqual([...panel.querySelectorAll('.asset-evidence-row')],originals);assert.isAtMost(card.getBoundingClientRect().height,59);
  }
 });
 it('updates the detailed source explanation without adding a list preview and opens a filtered asset on demand',async()=>{
  const rows=[...panel.querySelectorAll('.asset-evidence-row')],first=rows[0];openDetail(first.dataset.assetId);await wait(()=>win.document.querySelector('.reader-evidence-explanation')?.textContent.includes('实验含义'));
  const explanation=win.document.querySelector('.reader-evidence-explanation');assert.notInclude(explanation.textContent,'依据原图与正文');materials['figure-first'].summary='用户修改后的中文说明，仍保留原图和来源。';materials['figure-first'].revision++;notify();assert.include(explanation.textContent,'用户修改');assert.deepEqual([...panel.querySelectorAll('.asset-evidence-row')],rows);assert.notExists(first.querySelector('.asset-row-summary,.asset-explanation'));
  win.document.querySelector('[aria-label="关闭（Esc）"]').click();const filter=panel.querySelector('select');filter.value='figure';filter.dispatchEvent(new win.Event('change',{bubbles:true}));assert.isTrue(rows[1].hidden);assert.strictEqual(E.openAssetPanel(reader,'table-middle',host),panel);await wait(()=>win.document.querySelector('.reader-evidence-backdrop')?.dataset.assetId==='table-middle');assert.equal(filter.value,'all');assert.isFalse(rows[1].hidden);assert.notInclude(win.document.querySelector('.reader-evidence-explanation').textContent,'原图已提取，正在整理');assert.equal(indexCalls,1);assert.equal(queueCalls,1);
 });
 it('changes order and groups types without rebuilding list nodes or changing PDF anchors',async()=>{
  const originals=new Map([...panel.querySelectorAll('.asset-evidence-row')].map(n=>[n.dataset.assetId,n]));
  const choose=value=>{panel.querySelector('.asset-order-button').click();panel.querySelector(`[data-order-value="${value}"]`).click();};
  choose('desc');assert.deepEqual([...panel.querySelectorAll('.asset-evidence-row')].map(n=>n.dataset.assetId),['table-middle','figure-first']);choose('type');assert.deepEqual([...panel.querySelectorAll('.asset-evidence-row')].map(n=>n.dataset.assetId),['figure-first','table-middle']);for(const [id,node]of originals)assert.strictEqual(row(id),node);assert.deepEqual([...panel.querySelectorAll('[data-group-heading]')].map(n=>n.dataset.groupHeading),['图片','表格']);
  row('table-middle').querySelector('.asset-row-label').dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true,cancelable:true}));await wait(()=>locations.length===1);assert.deepEqual(locations[0].position,E.assets.position(assets[2]));panel.dispose();panel.remove();panel=E.openAssetPanel(reader,null,host);await wait(()=>panel.dataset.ready==='true');assert.equal(panel.dataset.order,'desc');assert.equal(panel.dataset.group,'type');
 });
 it('keeps a late low-resolution thumbnail from replacing the independently opened full original',async()=>{
  const original=E.previewImage;let release;panel.dispose();panel.remove();E.previewImage=path=>path==='figure-thumb'?new Promise(resolve=>{release=resolve;}):original(path);
  try{panel=E.openAssetPanel(reader,null,host);await wait(()=>panel.dataset.ready==='true'&&release);openDetail('figure-first');await wait(()=>win.document.querySelector('.reader-evidence-original')?.naturalWidth===800);release('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="8"/>'));await Zotero.Promise.delay(80);assert.equal(win.document.querySelector('.reader-evidence-original').naturalWidth,800);assert.strictEqual(image('figure-first').parentElement,row('figure-first').querySelector('.asset-row-thumbnail'));}
  finally{release?.('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="8"/>'));E.previewImage=original;}
 });
 it('supports arrow-key browsing, inline expand/collapse and double-click source location',async()=>{
  const rows=[...panel.querySelectorAll('.asset-evidence-row')],first=rows[0].querySelector('.asset-row-toggle');first.focus();first.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.strictEqual(win.document.activeElement,rows[1].querySelector('.asset-row-toggle'));
  const toggle=rows[1].querySelector('.asset-row-toggle');toggle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await wait(()=>rows[1].dataset.expanded==='true'&&rows[1].querySelector('.asset-inline-image')?.naturalWidth>0);assert.notExists(win.document.querySelector('.reader-evidence-backdrop'));assert.equal(toggle.getAttribute('aria-expanded'),'true');toggle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));await wait(()=>rows[1].querySelector('.asset-row-content').hidden);assert.equal(toggle.getAttribute('aria-expanded'),'false');
  click(rows[0].querySelector('.asset-row-label'));await wait(()=>rows[0].dataset.expanded==='true');assert.include(rows[0].querySelector('.asset-inline-explanation').textContent,'实验含义');await wait(()=>!rows[0].getAnimations({subtree:true}).some(animation=>animation.playState==='running'));const height=rows[0].getBoundingClientRect().height;assert.isAbove(height,60);rows[0].querySelector('.asset-row-toggle').click();await wait(()=>rows[0].querySelector('.asset-row-content').hidden);
  for(const card of rows){const text=card.querySelector('.asset-row-label');click(text,1);click(text,2);text.dispatchEvent(new win.MouseEvent('dblclick',{detail:2,bubbles:true,cancelable:true}));}await wait(()=>locations.length===2);await Zotero.Promise.delay(600);assert.notExists(win.document.querySelector('.easysch-image-preview,.reader-evidence-backdrop'));assert.deepEqual(locations.map(location=>location.pageIndex),[0,1]);for(const [i,location]of locations.entries())assert.deepEqual(location.position,E.assets.position(assets.find(a=>a.id===rows[i].dataset.assetId)));
 });
 it('shows a delayed local hover and opens a source detail with the same Logo conversation by click',async()=>{
  await details.scrollToPane(pane.dataset.pane,'instant');await Zotero.Promise.delay(60);
  const img=image('figure-first');img.dispatchEvent(new win.PointerEvent('pointerenter'));await Zotero.Promise.delay(120);assert.notExists(win.document.querySelector('.easysch-image-preview'));img.dispatchEvent(new win.PointerEvent('pointerleave'));await Zotero.Promise.delay(470);assert.notExists(win.document.querySelector('.easysch-image-preview'));
  img.focus();const focus=win.document.activeElement;img.dispatchEvent(new win.PointerEvent('pointerenter'));await wait(()=>{const full=win.document.querySelector('.easysch-image-preview.is-hover-preview img');return full?.complete&&full.naturalWidth>0;},'锚定悬停原图实际解码');
  const hover=win.document.querySelector('.is-hover-preview'),hoverBounds=hover.getBoundingClientRect(),anchorBounds=img.getBoundingClientRect();assert.equal(win.getComputedStyle(hover).pointerEvents,'none');assert.equal(win.getComputedStyle(hover).backdropFilter,'none');assert.equal(hover.getAttribute('role'),'tooltip');assert.isAtMost(hoverBounds.width,360.1,'悬停是锚定小浮层，不能铺满屏幕');assert.isBelow(hoverBounds.height,win.innerHeight*.75);assert.isAtLeast(hoverBounds.left,11);assert.isAtMost(hoverBounds.right,win.innerWidth-11);assert.isAtLeast(hoverBounds.top,11);assert.isAtMost(hoverBounds.bottom,win.innerHeight-11);assert.isBelow(Math.min(Math.abs(hoverBounds.right+10-anchorBounds.left),Math.abs(hoverBounds.left-anchorBounds.right-10)),2,'浮层紧靠当前缩略图的一侧');assert.equal(img.getAttribute('aria-describedby'),hover.id);assert.notExists(hover.querySelector('button'),'悬停不显示模态操作按钮');assert.strictEqual(win.document.activeElement,focus,'悬停不抢输入焦点');host.dispatchEvent(new win.Event('scroll'));assert.notExists(win.document.querySelector('.easysch-image-preview'));assert.isFalse(img.hasAttribute('aria-describedby'));
  const same=await E.openReaderAcademicChat(realReader);same.hide();const messageCount=E.workbenchConversations.getActive()?.messages.length||0;
  click(img);await wait(()=>win.document.querySelector('.reader-evidence-original')?.hasAttribute('src'));await wait(()=>same.root.parentElement?.classList.contains('reader-evidence-chat'),'复用Logo共享对话');const overlay=win.document.querySelector('.reader-evidence-backdrop');assert.equal(overlay.querySelector('.reader-evidence-detail').getAttribute('role'),'dialog');assert.strictEqual(overlay.querySelector('.conversation-surface'),same.root);assert.lengthOf(win.document.querySelectorAll('.conversation-surface'),1);assert.equal(E.workbenchConversations.getActive()?.messages.length||0,messageCount,'打开不请求模型或增添消息');assert.include(overlay.querySelector('.reader-evidence-explanation').textContent,'实验含义');assert.isTrue(same.state.locked);assert.equal(previewCalls.filter(path=>path==='figure-full').length,1,'悬停及单击复用完整原图');click(overlay);assert.notExists(win.document.querySelector('.reader-evidence-backdrop'));assert.isFalse(same.state.embedded);assert.strictEqual(win.document.activeElement,img,'关闭放大预览后恢复原缩略图焦点');
  img.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>win.document.querySelector('.reader-evidence-original')?.hasAttribute('src'));win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.notExists(win.document.querySelector('.reader-evidence-backdrop'));assert.strictEqual(win.document.activeElement,img,'Esc 关闭后可继续键盘浏览原素材');
 });
 it('keeps original caption scripts and symbols in the detail without interpreting source text as HTML or TeX',async()=>{
  openDetail('table-middle');await wait(()=>win.document.querySelector('.reader-evidence-caption'));const original=win.document.querySelector('.reader-evidence-caption');
  assert.equal(original.textContent,assets[2].caption);assert.equal(original.querySelector('sub').textContent,'m');assert.equal(original.querySelector('sup').textContent,'2');assert.equal(original.querySelector('em').textContent,'z');assert.equal(win.getComputedStyle(original.querySelector('sub')).verticalAlign,'sub');assert.equal(win.getComputedStyle(original.querySelector('sup')).verticalAlign,'super');assert.notExists(original.querySelector('img,script,math'));assert.include(original.textContent,'α');assert.include(original.textContent,'<img src=x onerror=alert(1)>');
  win.document.querySelector('[aria-label="关闭（Esc）"]').click();openDetail('figure-first');await wait(()=>win.document.querySelector('.reader-evidence-caption')?.textContent===assets[1].caption);assert.include(win.document.querySelector('.reader-evidence-explanation').textContent,'实验含义');
 });
 it('opens an indexed equation from its source without adding a formula row or requesting an explanation',async()=>{
  const detail=await E.openReaderEvidenceDetail(realReader,assets[0]);await wait(()=>detail.image.naturalWidth>0);assert.equal(detail.root.dataset.assetId,'formula-last');assert.notExists(panel.querySelector('[data-kind="formula"]'));assert.exists(detail.root.querySelector('.reader-evidence-chat .conversation-surface'));assert.exists(detail.root.querySelector('[aria-label="解释公式"]'));detail.close();
 });
 it('lets a slower double click cancel thumbnail zoom and also locates from the full-image modal',async()=>{
  const img=image('figure-first');click(img);await Zotero.Promise.delay(430);assert.notExists(win.document.querySelector('.easysch-image-preview'),'不能在常见双击间隔内抢先覆盖缩略图');click(img,2);img.dispatchEvent(new win.MouseEvent('dblclick',{detail:2,bubbles:true,cancelable:true}));await wait(()=>locations.length===1);await Zotero.Promise.delay(600);assert.notExists(win.document.querySelector('.easysch-image-preview'));
  const priorNavigate=realReader.navigate;realReader.navigate=async position=>locations.push(position);
  try{click(img);await wait(()=>win.document.querySelector('.reader-evidence-original')?.hasAttribute('src'));const full=win.document.querySelector('.reader-evidence-original');click(full);click(full,2);full.dispatchEvent(new win.MouseEvent('dblclick',{detail:2,bubbles:true,cancelable:true}));await wait(()=>locations.length===2);await Zotero.Promise.delay(600);assert.notExists(win.document.querySelector('.reader-evidence-backdrop'));assert.deepEqual(locations[1].position,E.assets.position(assets[1]));}finally{realReader.navigate=priorNavigate;}
 });
 it('saves complete source notes inline or by context menu even while another image-reading task runs',async()=>{
  const first=row('figure-first'),original=E.assets.saveMaterial;let resolveExplanation;
  E.assets.saveMaterial=async()=>new Promise(resolve=>{resolveExplanation=resolve;});
  try{
   first.dispatchEvent(new win.MouseEvent('contextmenu',{clientX:100,clientY:100,bubbles:true,cancelable:true}));const menu=panel.querySelector('.asset-context-menu');[...menu.querySelectorAll('button')].find(button=>button.textContent==='重新解读').click();await wait(()=>resolveExplanation,'受控图片解读任务');
   first.querySelector('.asset-save-note').click();await wait(()=>saved.length===1);assert.strictEqual(saved[0],assets[1]);assert.equal(saved[0].path,'figure-full');await wait(()=>!first.querySelector('.asset-save-note').disabled,'图片笔记任务完成');
   first.dispatchEvent(new win.MouseEvent('contextmenu',{clientX:100,clientY:100,bubbles:true,cancelable:true}));[...panel.querySelectorAll('.asset-context-menu button')].find(button=>button.textContent==='保存为笔记').click();await wait(()=>saved.length===2);assert.strictEqual(saved[1],assets[1]);assert.notExists(panel.querySelector('.asset-context-menu'));assert.notExists(panel.querySelector('.asset-card-actions'));
  }finally{resolveExplanation?.({reused:false});E.assets.saveMaterial=original;await wait(()=>panel.querySelector('.asset-task-actions>button').hidden,'受控解读任务释放');}
 });
 it('keeps the shared detail conversation usable after creating and focusing a real image note',async()=>{
  const save=E.saveAssetNote;let result,surface,draft;
  try{
   // Run the real save through the actual duplicate source reader, including
   // the native editor transition that used to hide its embedded conversation.
   E.saveAssetNote=async(asset,options)=>{assert.strictEqual(options.reader,realReader);result=await prior.note(asset,options);return result;};
   openDetail('figure-first');const overlay=await settledDetail('figure-first');surface=overlay.querySelector('.conversation-surface');
   const input=surface.querySelector('textarea');draft=input.value;const sessionID=E.workbenchConversations.getActive()?.id,messages=JSON.stringify(E.workbenchConversations.getActive()?.messages||[]);
   overlay.querySelector('[aria-label="保存完整原图与解读为笔记"]').click();
   await wait(()=>result?.noteID&&!overlay.querySelector('[aria-label="保存完整原图与解读为笔记"]').disabled,'真实图片笔记保存与原生编辑器聚焦');
   const note=Zotero.Items.get(result.noteID),annotation=Zotero.Items.get(result.annotationID);
   assert.isTrue(note.isNote());assert.isTrue(annotation.isAnnotation());assert.include(note.getNote(),'比较不同方法');
   assert.equal(win.ZoteroContextPane.context.mode,'notes','保存仍打开真实笔记编辑器');
   assert.equal(win.Zotero_Tabs.selectedID,realReader.tabID,'不会跳到同一PDF的另一个标签');
   assert.strictEqual(overlay.querySelector('.reader-evidence-chat .conversation-surface'),surface,'保存沿用同一个共享对话组件');
   assert.equal(E.workbenchConversations.getActive()?.id,sessionID);assert.equal(JSON.stringify(E.workbenchConversations.getActive()?.messages||[]),messages,'保存图片不清空或复制原对话消息');
   assert.isFalse(surface.hidden);assert.equal(surface.dataset.open,'true');assert.isAbove(input.getBoundingClientRect().height,25);
   input.focus();input.value='继续核对图中条件';input.dispatchEvent(new win.Event('input',{bubbles:true}));
   assert.strictEqual(win.document.activeElement,input);assert.equal(input.value,'继续核对图中条件');
   assert.lengthOf(win.document.querySelectorAll('.conversation-surface'),1,'未另建或复制消息栏');
   await capture('evidence-detail-chat-after-real-note-save');
  }finally{
   if(surface){const input=surface.querySelector('textarea');input.value=draft||'';input.dispatchEvent(new win.Event('input',{bubbles:true}));}
   win.document.querySelector('.reader-evidence-backdrop [aria-label="关闭（Esc）"]')?.click();
   E.saveAssetNote=save;
   if(result){await E.store.update(state=>{for(const [key,link]of Object.entries(state.readerNoteLinks||{}))if(link.noteID===result.noteID)delete state.readerNoteLinks[key];});await Zotero.Items.erase([result.noteID,result.annotationID]);}
  }
	});
 it('opens an evidence detail on double click in a research preview without navigating to the paper',async()=>{
  const count=locations.length;reader.researchPreviewOnly=true;
  try{
   image('figure-first').dispatchEvent(new win.MouseEvent('dblclick',{detail:2,bubbles:true,cancelable:true}));
   const detail=await settledDetail('figure-first');assert.equal(locations.length,count,'预览双击不跳原文');assert.exists(detail.querySelector('.reader-evidence-original'));await capture('research-evidence-detail-without-paper-navigation');
  }finally{win.document.querySelector('.reader-evidence-backdrop [aria-label="关闭（Esc）"]')?.click();delete reader.researchPreviewOnly;}
 });
});
