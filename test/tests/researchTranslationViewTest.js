/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Continuous cached translation view',function(){
 this.timeout(90000);
 const E=Zotero.Research;let win,sourceReader,sourceView,pdf,doc,app,reader,panel,notify,pages,prior,calls,folder,originalPrepare,originalIndex,originalImages,originalPreparationQueue;
 const report={type:'真实 Zotero 原生 DOM + 受控版式、译文与图片回复',limitations:['不等同真人操作、真实模型、实际图像提取或网络验收'],tests:[]};
 const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await Zotero.Promise.delay(50);}throw Error('等待译文界面超时');};
 const click=(node,type='click',options={})=>node.dispatchEvent(new doc.defaultView.MouseEvent(type,{bubbles:true,cancelable:true,...options}));
 const firstBox=()=>panel.querySelector('[data-page-index="0"] .translation-box:not(.translation-visual)');
 const fixture=(i,width,height)=>({pageIndex:i,width,height,status:'complete',documentKey:'controlled-translation-document',blocks:[{
  id:'text-'+i,kind:'text',sourceText:'A controlled paragraph with a citation [1].',translatedText:'第'+(i+1)+'页受控中文段落 [1]。',revision:0,
  fontFamily:'Times New Roman',fontSize:10,fontWeight:400,serif:true,
  position:{pageIndex:i,rects:[[40,height-120,240,height-80]]}
 }]});
 before(async()=>{
  originalPrepare=E.manuscripts.prepareTranslation;E.manuscripts.prepareTranslation=async()=>null;
  // The fixture is imported locally. Keep unrelated import/open preparation
  // from starting real indexing, image or model work beside controlled pages.
  originalIndex=E.manuscripts.indexArticle;E.manuscripts.indexArticle=async()=>null;
  originalImages=E.assets.queueImages;E.assets.queueImages=async()=>null;
  originalPreparationQueue=E.queueReaderPreparation;E.queueReaderPreparation=()=>Promise.resolve();
  win=await loadZoteroPane();await E.attachWindow(win);
  const file=getTestDataDirectory();file.append('test.pdf');pdf=await Zotero.Attachments.importFromFile({file});
  assert.exists(pdf,'从随测试分发的 PDF 建立原生阅读器，不依赖已有文库');report.pdfFixture={file:file.leafName,attachmentID:pdf.id,importedBySuite:true};
  sourceReader=await E.openReaderReady(pdf.id);sourceView=sourceReader._internalReader._primaryView;await sourceView.initializedPromise;
  doc=sourceReader._iframeWindow.document;app=sourceView._iframeWindow.PDFViewerApplication;
  folder=PathUtils.join(Zotero.DataDirectory.dir,'translation-view-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
 });
 beforeEach(async()=>{
  doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
  prior={prepare:E.manuscripts.prepareTranslation,page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,edit:E.manuscripts.saveTranslationEdit,preview:E.previewImage,note:E.saveSelectionTranslation,annotate:E.annotateSelection,quick:E.quickTranslate,drafts:E.store.get('translationDrafts'),zoom:E.store.get('settings','readerTranslationZoom'),width:E.store.get('settings','readerTranslationWidth'),layout:E.store.get('settings','readerTranslationLayout')};
  await E.store.update(s=>{s.settings.readerTranslationLayout='compare';});
  calls={prepare:0,reads:[],preview:[],navigation:[],notes:[],annotations:[],updates:[],edits:[]};pages=[];
  for(let i=0;i<app.pdfDocument.numPages;i++){const page=Cu.waiveXrays(await app.pdfDocument.getPage(i+1)),vp=page.getViewport(Cu.cloneInto({scale:1},sourceView._iframeWindow));pages.push(fixture(i,vp.width,vp.height));}
  reader={type:'pdf',itemID:pdf.id,_window:sourceReader._window,_iframeWindow:sourceReader._iframeWindow,_internalReader:{
   _primaryView:{_iframeWindow:sourceView._iframeWindow,navigate:position=>calls.navigation.push(position),getAnnotationMeta:()=>({sortIndex:'00000|000084|00040'})},
   _annotationManager:{updateAnnotations:updates=>calls.updates.push(JSON.parse(JSON.stringify(updates)))}
  }};
  E.manuscripts.prepareTranslation=async()=>{calls.prepare++;return {documentKey:'controlled-translation-document',pageCount:pages.length,pages:JSON.parse(JSON.stringify(pages))};};
  E.manuscripts.translationPage=async(id,i)=>{calls.reads.push(i);return JSON.parse(JSON.stringify(pages[i]));};
  E.manuscripts.queueTranslation=async()=>{};E.manuscripts.observeTranslation=(id,callback)=>{notify=callback;return()=>{notify=null;};};
  E.manuscripts.saveTranslationEdit=async(id,i,blockID,text,version)=>{calls.edits.push({id,i,blockID,text,version});const block=pages[i].blocks.find(b=>b.id===blockID);if(version.expectedRevision!==block.revision)throw Error('来源或译文已更新，保留当前编辑内容，请核对后再保存');block.translatedText=text;block.revision++;return {...block};};
  E.previewImage=async path=>{calls.preview.push(path);return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1836" height="2376"><rect width="100%" height="100%" fill="white"/><text x="30" y="50">controlled native visual</text></svg>');};
  E.saveSelectionTranslation=async(selection,translation)=>{calls.notes.push({selection,translation});return {noteID:123};};
  E.annotateSelection=(target,selection,type)=>{calls.annotations.push({selection,type});return [{id:'controlled-annotation'}];};
 });
 afterEach(async function(){
  report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});
  panel?.querySelector('button[aria-label="关闭译文"]')?.click();panel=null;
  Object.assign(E.manuscripts,{prepareTranslation:prior.prepare,translationPage:prior.page,queueTranslation:prior.queue,observeTranslation:prior.observe,saveTranslationEdit:prior.edit});
  E.previewImage=prior.preview;E.saveSelectionTranslation=prior.note;E.annotateSelection=prior.annotate;E.quickTranslate=prior.quick;
  await E.store.update(s=>{if(prior.drafts)s.translationDrafts=prior.drafts;else delete s.translationDrafts;for(const [key,value]of [['readerTranslationZoom',prior.zoom],['readerTranslationWidth',prior.width],['readerTranslationLayout',prior.layout]]){if(value===undefined)delete s.settings[key];else s.settings[key]=value;}});
  await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
 });
 after(async()=>{E.manuscripts.prepareTranslation=originalPrepare;E.manuscripts.indexArticle=originalIndex;E.assets.queueImages=originalImages;E.queueReaderPreparation=originalPreparationQueue;await E.store.flush();});
 const open=async()=>{panel=E.openReaderTranslation(reader);await wait(()=>calls.reads.length>=pages.length&&firstBox());return panel;};
 it('prepares on document open and reads every cached page before scrolling',async()=>{
  const toolbar=[];E.readerTranslationToolbar({reader,doc,append:button=>toolbar.push(button)});await wait(()=>calls.prepare===1);
  await open();assert.equal(calls.prepare,1,'工具栏预热与显示译文共用一次准备任务');
  assert.sameMembers([...new Set(calls.reads)],pages.map(p=>p.pageIndex),'包括视口外末页都已读取');
  assert.exists(panel.querySelector(`[data-page-index="${pages.length-1}"] [data-block-id="text-${pages.length-1}"]`));
  const sheet=panel.querySelector('[data-page-index="0"]'),box=firstBox(),scale=parseFloat(sheet.style.width)/pages[0].width;
  assert.closeTo(parseFloat(box.style.left),40*scale,.5);assert.closeTo(parseFloat(box.style.top),80*scale,.5);
  assert.closeTo(parseFloat(box.style.width),200*scale,.5);assert.closeTo(parseFloat(box.style.height),40*scale,.5);
  assert.closeTo(parseFloat(box.style.fontSize),10*scale,.2,'字号由原始 PDF 点尺寸统一缩放');
  assert.equal(doc.defaultView.getComputedStyle(box).overflowY,'auto');assert.include(box.style.fontFamily,'Noto Serif CJK SC');
  assert.notInclude(E.openReaderTranslation.toString(),'canvasWrapper','不读取当前屏幕 PDF canvas');assert.notInclude(E.openReaderTranslation.toString(),'getTextContent','不在翻页时提取字符');
 });
 it('shows native page, complete formula, table and image assets without rendered PDF canvases',async()=>{
  const p=pages[0],position=y=>({pageIndex:0,rects:[[40,y,260,y+30]]});p.visualAsset={path:'controlled-page.png',width:p.width*3,height:p.height*3,dpi:216};
  for(const [index,kind]of ['formula','table','image'].entries())p.blocks.push({id:kind,kind,translatable:false,sourceText:'',position:position(p.height-200-index*80),visualAsset:{path:'controlled-'+kind+'.png',width:660,height:90,dpi:216}});
  await open();await wait(()=>panel.querySelectorAll('.translation-visual img[src]').length===3&&panel.querySelector('.translation-page-image[src]'));
  assert.includeMembers(calls.preview,['controlled-page.png','controlled-formula.png','controlled-table.png','controlled-image.png']);
  assert.lengthOf(panel.querySelectorAll('.translation-formula'),1);assert.lengthOf(panel.querySelectorAll('.translation-visual'),3);
  assert.exists(firstBox(),'保留公式旁的普通中文段落');
  for(const visual of panel.querySelectorAll('.translation-visual')){assert.isAbove(parseFloat(visual.style.width),0);assert.isAbove(parseFloat(visual.style.height),0);assert.equal(doc.defaultView.getComputedStyle(visual.querySelector('img')).objectFit,'fill');}
 });
 it('updates offscreen pages by stable block ID and keeps existing nodes while scrolling',async()=>{
  await open();const box=firstBox(),last=pages.length-1,lastNode=panel.querySelector(`[data-block-id="text-${last}"]`);
  pages[last].blocks[0].translatedText='视口外新增中文译文 [1]。';notify({pageIndex:last,status:'complete'});
  await wait(()=>lastNode.textContent.includes('视口外新增'));assert.strictEqual(firstBox(),box);assert.strictEqual(panel.querySelector(`[data-block-id="text-${last}"]`),lastNode);
  const scroller=panel.querySelector('.translation-scroller');scroller.scrollTop=scroller.scrollHeight;scroller.dispatchEvent(new doc.defaultView.Event('scroll'));await Zotero.Promise.delay(100);scroller.scrollTop=0;scroller.dispatchEvent(new doc.defaultView.Event('scroll'));await Zotero.Promise.delay(100);
  assert.strictEqual(firstBox(),box,'回访没有删除并重建正文节点');
 });
 it('locates by a single click and saves an editable translation in place with its revision',async()=>{
  await open();const box=firstBox();click(box);await wait(()=>calls.navigation.length===1);assert.deepEqual(calls.navigation.at(-1),{position:pages[0].blocks[0].position});
  const beforeDouble=calls.navigation.length;click(box,'click',{detail:1});click(box,'click',{detail:2});click(box,'dblclick',{detail:2});const body=box.querySelector('p');assert.equal(body.contentEditable,'true');
  await Zotero.Promise.delay(300);assert.equal(calls.navigation.length,beforeDouble,'双击取消首击的延迟导航，正文框不被同步滚动移走');body.textContent='用户修改后的精简中文译文 [1]。';
  const save=[...box.querySelectorAll('button')].find(b=>b.textContent==='保存');save.click();await wait(()=>!box.classList.contains('is-editing'));
  assert.equal(body.textContent,'用户修改后的精简中文译文 [1]。');assert.equal(calls.edits[0].blockID,'text-0');assert.equal(calls.edits[0].version.documentKey,'controlled-translation-document');assert.equal(calls.edits[0].version.expectedRevision,0);
 });
 it('preserves IME input and a draft when a background update conflicts with saving',async()=>{
  await open();const box=firstBox();click(box,'dblclick',{detail:2});const body=box.querySelector('p');body.textContent='尚未保存的中文候选 [1]。';
  body.dispatchEvent(new doc.defaultView.CompositionEvent('compositionstart',{bubbles:true}));
  body.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true}));assert.isTrue(box.classList.contains('is-editing'));assert.isTrue(panel.isConnected);
  body.dispatchEvent(new doc.defaultView.CompositionEvent('compositionend',{bubbles:true}));
  pages[0].blocks[0].translatedText='后台新的中文译文 [1]。';pages[0].blocks[0].revision=1;notify({pageIndex:0,status:'complete'});await Zotero.Promise.delay(100);
  assert.equal(body.textContent,'尚未保存的中文候选 [1]。','后台通知不能覆盖编辑内容');
  [...box.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await wait(()=>panel.querySelector('.translation-status').textContent.includes('保留当前编辑'));
  assert.isTrue(box.classList.contains('is-editing'));assert.equal(body.textContent,'尚未保存的中文候选 [1]。');
  [...box.querySelectorAll('button')].find(b=>b.textContent==='取消').click();assert.equal(body.textContent,'后台新的中文译文 [1]。');assert.isTrue(panel.isConnected);
 });
 it('saves notes and annotations with the source paragraph position from the inline menu',async()=>{
  await open();const box=firstBox();click(box,'contextmenu',{clientX:panel.getBoundingClientRect().left+20,clientY:100});
  [...panel.querySelectorAll('.translation-menu button')].find(b=>b.textContent==='保存为笔记').click();await wait(()=>calls.notes.length===1);
  assert.deepEqual(calls.notes[0].selection.position,pages[0].blocks[0].position);assert.equal(calls.notes[0].translation.text,pages[0].blocks[0].translatedText);
  assert.equal(calls.notes[0].selection.sortIndex,'00000|000084|00040','优先采用 PDF 阅读器原文位置的精确排序');
  click(box,'contextmenu',{clientX:panel.getBoundingClientRect().left+20,clientY:100});[...panel.querySelectorAll('.translation-menu button')].find(b=>b.textContent==='保存为批注').click();await wait(()=>calls.updates.length===1);
  assert.deepEqual(calls.annotations[0].selection.position,pages[0].blocks[0].position);assert.include(calls.updates[0][0].comment,'中文段落');assert.include(calls.updates[0][0].comment,'\n');
 });
 it('durably saves an unfinished draft on close, restores editing on reopen, and discards it explicitly',async()=>{
  await open();click(firstBox(),'dblclick',{detail:2});const body=firstBox().querySelector('p');body.textContent='关闭前未保存的中文草稿 [1]。';
  const composingKey={key:'Enter',ctrlKey:true,keyCode:229,preventDefault(){},stopPropagation(){}};body.onkeydown(composingKey);assert.lengthOf(calls.edits,0,'输入法兼容按键229不能触发保存');
  panel.querySelector('button[aria-label="关闭译文"]').click();await E.store.flush();
  const key=[reader.itemID,'controlled-translation-document','text-0'].join('|'),saved=E.store.get('translationDrafts',key);
  assert.equal(saved.text,'关闭前未保存的中文草稿 [1]。');assert.equal(saved.expectedRevision,0);assert.equal(saved.sourceText,pages[0].blocks[0].sourceText);
  panel=E.openReaderTranslation(reader);await wait(()=>firstBox()?.classList.contains('is-editing'));assert.equal(firstBox().querySelector('p').textContent,saved.text,'从独立持久化草稿分支恢复到原编辑框');
  const editBody=firstBox().querySelector('p');editBody.onkeydown({key:'Escape',keyCode:27,preventDefault(){},stopPropagation(){}});await E.store.flush();
  assert.isUndefined(E.store.get('translationDrafts',key));assert.isFalse(firstBox().classList.contains('is-editing'));assert.isTrue(panel.isConnected,'Esc明确取消草稿，仍保留译文视图');
 });
 it('exposes unbound preserved translations only when present and allows copying them',async()=>{
  const copy=Zotero.Utilities.Internal.copyTextToClipboard;let copied;
  Zotero.Utilities.Internal.copyTextToClipboard=text=>{copied=text;};
  try{
   pages[0].recoveryEdits=[{id:'old-layout-id',revision:2,sourceText:'Original source from an earlier layout.',translatedText:'版式变化前用户保存的中文译文。',recoveryReason:'原文版式或位置已变化，用户译文已保留，请核对后恢复'}];
   await open();const recover=panel.querySelector('.translation-recover');assert.isFalse(recover.hidden);recover.click();
   const drawer=panel.querySelector('.translation-recovery');assert.exists(drawer);assert.include(drawer.textContent,'未自动写回');assert.include(drawer.textContent,'版式变化前用户保存的中文译文');assert.notInclude(drawer.textContent,'已恢复');
   [...drawer.querySelectorAll('button')].find(b=>b.textContent==='复制译文').click();assert.equal(copied,pages[0].recoveryEdits[0].translatedText);
   pages[0].recoveryEdits=[];notify({pageIndex:0,status:'complete'});await wait(()=>recover.hidden);assert.notExists(panel.querySelector('.translation-recovery'));
  }finally{Zotero.Utilities.Internal.copyTextToClipboard=copy;}
 });
 const inlineFixture=()=>{const block=pages[0].blocks[0];block.sourceText='We compute ZXQMATH0ZXQ and compare results [1].';block.originalText='We compute xᵢ² and compare results [1].';block.translatedText='计算 ZXQMATH0ZXQ 并比较结果 [1]。';block.inlineMath=[{
  id:'native-math-0',sourceText:'xᵢ²',placeholder:'ZXQMATH0ZXQ',visualAsset:{path:'controlled-inline-sup-sub.png',dpi:216,width:84,height:42},width:28,height:14,baselineOffset:4
 }];return block;};
 it('renders protected author text and affiliation superscripts without waiting for a Chinese translation',async()=>{
  const block=inlineFixture();Object.assign(block,{sourceText:'Hunmin Lee ZXQMATH0ZXQ',originalText:'Hunmin Lee1',sourceRole:'author',translatable:false,translatedText:undefined,status:'source'});Object.assign(block.inlineMath[0],{sourceText:'1',baselineOffset:-3});
  await open();await wait(()=>firstBox().querySelector('.translation-inline-math img')?.dataset.mathReady==='true');const box=firstBox(),body=box.querySelector('p');
  assert.isFalse(box.classList.contains('translation-visual'));assert.isFalse(box.classList.contains('is-pending'));assert.include(body.textContent,'Hunmin Lee');assert.notInclude(body.textContent,'正在翻译');assert.notInclude(body.textContent,'ZXQMATH');assert.isAbove(parseFloat(body.querySelector('.translation-inline-math').style.verticalAlign),0,'作者上标保留相对正文基线的位置');
  click(box,'contextmenu',{clientX:panel.getBoundingClientRect().left+20,clientY:100});assert.notExists([...panel.querySelectorAll('.translation-menu button')].find(button=>button.textContent==='编辑译文'),'原始作者题录不提供无效的译文编辑');
  [...panel.querySelectorAll('.translation-menu button')].find(button=>button.textContent==='保存为笔记').click();await wait(()=>calls.notes.length===1);assert.equal(calls.notes[0].selection.text,'Hunmin Lee1');assert.match(calls.notes[0].translation.text,/Hunmin Lee\s*1/);assert.equal(calls.notes[0].translation.provider,'原文题录');
 });
 it('renders native inline superscripts and subscripts at the original baseline and copies source symbols',async()=>{
  const block=inlineFixture();E.previewImage=async path=>{calls.preview.push(path);return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="42"><text x="2" y="25" font-size="23">x<tspan dy="7" font-size="12">i</tspan><tspan dy="-17">2</tspan></text></svg>');};
  await open();await wait(()=>firstBox().querySelector('.translation-inline-math img')?.dataset.mathReady==='true');const box=firstBox(),body=box.querySelector('p'),inline=body.querySelector('.translation-inline-math'),sheet=panel.querySelector('[data-page-index="0"]'),scale=parseFloat(sheet.style.width)/pages[0].width;
  assert.equal(inline.contentEditable,'false');assert.closeTo(parseFloat(inline.style.width),28*scale,.3);assert.closeTo(parseFloat(inline.style.height),14*scale,.3);assert.closeTo(parseFloat(inline.style.verticalAlign),-4*scale,.3);
  assert.equal(inline.querySelector('img').alt,'xᵢ²');assert.equal(doc.defaultView.getComputedStyle(inline.querySelector('.math-fallback')).display,'none');assert.notInclude(body.textContent,'ZXQMATH');
  const range=doc.createRange();range.selectNodeContents(body);const selection=doc.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);
  // Gecko ClipboardEventInit has data/dataType, not clipboardData. Read the
  // event-owned native transfer; an independently constructed transfer is
  // ignored by its constructor and never receives the copy handler's data.
  const copy=new doc.defaultView.ClipboardEvent('copy',{bubbles:true,cancelable:true}),clipboard=copy.clipboardData;body.dispatchEvent(copy);
  assert.isTrue(copy.defaultPrevented);assert.include(clipboard.getData('text/plain'),'xᵢ²');assert.notInclude(clipboard.getData('text/plain'),'ZXQMATH');selection.removeAllRanges();
  const initialWidth=parseFloat(inline.style.width),scroller=panel.querySelector('.translation-scroller'),bounds=scroller.getBoundingClientRect();scroller.dispatchEvent(new doc.defaultView.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120,clientX:bounds.left+50,clientY:bounds.top+90}));assert.isBelow(parseFloat(inline.style.width),initialWidth,'数学图随独立译文缩放，而非只缩周围中文');
  click(box,'contextmenu',{clientX:panel.getBoundingClientRect().left+20,clientY:100});[...panel.querySelectorAll('.translation-menu button')].find(b=>b.textContent==='保存为笔记').click();await wait(()=>calls.notes.length===1);
  assert.equal(calls.notes[0].selection.text,block.originalText);assert.include(calls.notes[0].translation.text,'xᵢ²');assert.notInclude(calls.notes[0].translation.text,'ZXQMATH');
  assert.equal(calls.preview.filter(path=>path==='controlled-inline-sup-sub.png').length,1,'准备数据与新页缓存更新共用同路径图片');
 });
 it('keeps locked inline formulas through editing, saving and unfinished-draft close/reopen',async()=>{
  inlineFixture();await open();click(firstBox(),'dblclick',{detail:2});let body=firstBox().querySelector('p'),inline=body.querySelector('.translation-inline-math');
  const range=doc.createRange();range.selectNode(inline);const selection=doc.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);const deletion=new doc.defaultView.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward'});body.dispatchEvent(deletion);assert.isTrue(deletion.defaultPrevented,'公式节点禁止由删除或选区替换破坏');selection.removeAllRanges();
  body.firstChild.data='更精简的中文 ';body.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));[...firstBox().querySelectorAll('button')].find(b=>b.textContent==='保存').click();await wait(()=>!firstBox().classList.contains('is-editing'));
  assert.include(calls.edits[0].text,'ZXQMATH0ZXQ');assert.notInclude(calls.edits[0].text,'xᵢ²','写入用稳定token，原生数学不会被压平');
  click(firstBox(),'dblclick',{detail:2});body=firstBox().querySelector('p');body.firstChild.data='未完成的中文草稿 ';body.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));panel.querySelector('button[aria-label="关闭译文"]').click();await E.store.flush();
  const key=[reader.itemID,'controlled-translation-document','text-0'].join('|'),draft=E.store.get('translationDrafts',key);assert.include(draft.text,'ZXQMATH0ZXQ');assert.equal(draft.inlineMath[0].sourceText,'xᵢ²');
  panel=E.openReaderTranslation(reader);await wait(()=>firstBox()?.classList.contains('is-editing'));body=firstBox().querySelector('p');assert.include(body.textContent,'未完成的中文草稿');assert.exists(body.querySelector('.translation-inline-math'));assert.notInclude(body.textContent,'ZXQMATH');
  [...firstBox().querySelectorAll('button')].find(b=>b.textContent==='取消').click();
 });
 it('shows original inline math symbols when its native image has not loaded or failed',async()=>{
  inlineFixture();let rejectImage;E.previewImage=path=>{calls.preview.push(path);return new Promise((resolve,reject)=>{rejectImage=reject;});};
  await open();await wait(()=>typeof rejectImage==='function');const inline=firstBox().querySelector('.translation-inline-math');assert.include(inline.textContent,'xᵢ²');assert.isTrue(inline.querySelector('img').hidden);assert.equal(inline.style.width,'','未加载的图不留空白框');
  rejectImage(Error('受控图像读取失败'));await Zotero.Promise.delay(100);assert.include(inline.textContent,'xᵢ²');assert.isFalse(inline.querySelector('.math-fallback').hidden);assert.isTrue(inline.querySelector('img').hidden);
 });
 it('zooms both equally sized papers using Ctrl+wheel and restores the original inset on close',async()=>{
  const split=doc.getElementById('split-view'),inset=split.style.insetInlineEnd;await open();const scroller=panel.querySelector('.translation-scroller'),sheet=panel.querySelector('.translation-sheet'),before=parseFloat(sheet.style.width),left=sourceView._iframeWindow.document.getElementById('viewerContainer'),oldLeft=left.scrollTop,leftScale=app.pdfViewer.currentScaleValue;
  const bounds=scroller.getBoundingClientRect(),wheel=new doc.defaultView.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120,clientX:bounds.left+60,clientY:bounds.top+90});scroller.dispatchEvent(wheel);
  assert.isTrue(wheel.defaultPrevented);assert.isBelow(parseFloat(sheet.style.width),before);assert.notEqual(app.pdfViewer.currentScaleValue,leftScale);
  assert.closeTo(parseFloat(sheet.style.width),app.pdfViewer.getPageView(0).viewport.width,1,'原文和译文共用一个实际CSS倍率');
  panel.querySelector('button[aria-label="关闭译文"]').click();assert.equal(split.style.insetInlineEnd,inset);assert.isFalse(panel.isConnected);
 });
 it('fits both papers after entering compare mode and restores a manually chosen source zoom on close',async()=>{
  const viewer=Cu.waiveXrays(app.pdfViewer),original=viewer.currentScaleValue;try{viewer.currentScaleValue=1.13;const fixed=viewer.currentScaleValue;await open();await Zotero.Promise.delay(100);assert.closeTo(parseFloat(panel.querySelector('.translation-sheet').style.width),viewer.getPageView(0).viewport.width,1);panel.querySelector('button[aria-label="关闭译文"]').click();assert.equal(viewer.currentScaleValue,fixed);}finally{viewer.currentScaleValue=original;}
 });
 it('equally divides the article area with the thumbnail sidebar open and switches directly to a single translation',async()=>{
  const internal=sourceReader._internalReader,sidebar=internal._state.sidebarOpen,split=doc.getElementById('split-view'),visibility=split.style.visibility;
  try{internal.toggleSidebar(true);await Zotero.Promise.delay(80);await open();await Zotero.Promise.delay(100);
   assert.isAbove(split.getBoundingClientRect().left,0);assert.closeTo(panel.getBoundingClientRect().width,split.getBoundingClientRect().width,1,'扣除缩略图栏之后等分两个区域');
   const width=panel.getBoundingClientRect().width,toggle=panel.querySelector('.translation-layout-toggle');toggle.click();
   assert.equal(panel.dataset.layout,'translation');assert.equal(split.style.visibility,'hidden');assert.isAbove(panel.getBoundingClientRect().width,width*1.9);
   toggle.click();assert.equal(panel.dataset.layout,'compare');assert.equal(split.style.visibility,visibility);assert.closeTo(panel.getBoundingClientRect().width,split.getBoundingClientRect().width,1);
  }finally{internal.toggleSidebar(sidebar);}
 });
 it('cleans dismissed machine translation cards and cancels stale requests',async()=>{
  let resolve,signal;E.quickTranslate=(text,currentSignal)=>{signal=currentSignal;return new Promise(done=>{resolve=done;});};
  const popup=doc.createElement('div');popup.className='selection-popup';doc.body.append(popup);
  try{E.renderQuickTranslation({reader,doc,selection:{text:'Controlled sentence'},append:node=>popup.append(node)});await wait(()=>typeof resolve==='function');const card=popup.querySelector('.easysch-quick-translation');assert.exists(card);assert.isFalse(card.querySelector('.quick-translation-cancel').hidden,'等待期间可以取消');assert.isTrue(card.querySelector('.quick-translation-retry').hidden);
   doc.body.dispatchEvent(new doc.defaultView.PointerEvent('pointerdown',{bubbles:true}));assert.isTrue(signal.aborted);assert.isFalse(card.isConnected);resolve({text:'已经过期的译文'});await Zotero.Promise.delay(50);assert.notInclude(doc.body.textContent,'已经过期的译文');
  }finally{popup.remove();}
 });
 it('cancels and retries a pending selection translation without accepting its stale response',async()=>{
  const requests=[];E.quickTranslate=(text,signal,options)=>new Promise(resolve=>requests.push({text,signal,options,resolve}));const popup=doc.createElement('div');popup.className='selection-popup';doc.body.append(popup);
  try{E.renderQuickTranslation({reader,doc,selection:{text:'Cancellation sentence'},append:node=>popup.append(node)});await wait(()=>requests.length===1);const card=popup.querySelector('.easysch-quick-translation');card.querySelector('.quick-translation-cancel').click();await wait(()=>card.dataset.state==='cancelled');assert.isTrue(requests[0].signal.aborted);card.querySelector('.quick-translation-retry').click();await wait(()=>requests.length===2);assert.isFalse(requests[1].options.allowModelFallback);requests[1].resolve({text:'重试后的机器译文'});await wait(()=>card.dataset.state==='complete');requests[0].resolve({text:'过期机器译文'});await Zotero.Promise.delay(40);assert.equal(card.querySelector('.quick-translation-output').textContent,'重试后的机器译文');assert.equal(card.getAttribute('aria-busy'),'false');
  }finally{popup.remove();}
 });
 it('shows compact translation recovery with a collapsed original reason and retries in machine mode',async()=>{
  const core=sourceReader._internalReader,requests=[],reason='快速机翻失败：译文改变或遗漏数学关系：~N；GPT-6 Luna后备失败：译文改变或遗漏数学关系：~N，请重试';
  E.quickTranslate=(text,signal,options)=>new Promise((resolve,reject)=>requests.push({text,signal,options,resolve,reject}));
  try{
   core._updateState(Cu.cloneInto({primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text:'The noise follows ϵ ∼N (0, I).',position:{pageIndex:0,rects:[[20,20,300,36]]},sortIndex:'00000|000001|00000'}}},sourceReader._iframeWindow));
   await wait(()=>requests.length===1);assert.isFalse(requests[0].options.allowModelFallback,'机翻失败不自动改用模型');requests[0].reject(Error(reason));
   await wait(()=>doc.querySelector('.selection-popup .easysch-quick-translation')?.dataset.state==='error');
   const card=doc.querySelector('.selection-popup .easysch-quick-translation'),output=card.querySelector('.quick-translation-output'),feedback=output.querySelector('.translation-feedback'),title=feedback.querySelector('.translation-feedback-title'),message=feedback.querySelector('.translation-feedback-message'),details=feedback.querySelector('details.translation-feedback-details'),retry=card.querySelector('.quick-translation-retry'),translate=card.querySelector('.quick-translation-run');
   assert.equal(title.textContent,'译文未通过核对');assert.isBelow(title.textContent.length,24);assert.include(message.textContent,'重试');assert.notInclude(title.textContent,'~N');assert.notInclude(message.textContent,'GPT-6');assert.equal(feedback.dataset.kind,'quality');
   await wait(()=>doc.defaultView.getComputedStyle(feedback).borderTopLeftRadius==='10px');
   assert.isFalse(details.open,'原始技术原因默认收起');assert.equal(details.querySelector('summary').textContent,'查看原因');assert.include(details.textContent,reason,'保留可展开的原始原因供核查');assert.isAbove(title.getBoundingClientRect().height,0);assert.isAbove(message.getBoundingClientRect().height,0);assert.isFalse(retry.hidden);assert.equal(retry.style.display,'inline-flex');assert.include(['flex','inline-flex'],doc.defaultView.getComputedStyle(retry).display,'flex 子项允许将 inline-flex 块化');assert.isAbove(retry.getBoundingClientRect().width,0);assert.isAbove(retry.getBoundingClientRect().height,0);assert.equal(translate.textContent,'机翻');assert.equal(translate.dataset.translationMode,'machine');assert.equal(card.getAttribute('aria-busy'),'false');
   const feedbackBounds=feedback.getBoundingClientRect(),outputBounds=output.getBoundingClientRect();assert.isAtLeast(feedbackBounds.left,outputBounds.left-1);assert.isAtMost(feedbackBounds.right,outputBounds.right+1);assert.isAtLeast(feedbackBounds.top,outputBounds.top-1);assert.isAtMost(feedbackBounds.bottom,outputBounds.bottom+1,'折叠错误卡片完整位于译文区域内');
   const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(PathUtils.join(folder,'selected-text-translation-recovery.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}
   details.querySelector('summary').click();assert.isTrue(details.open,'可以主动查看完整错误原因');retry.click();await wait(()=>requests.length===2);assert.isFalse(requests[1].options.allowModelFallback);assert.notExists(output.querySelector('.translation-feedback'),'重试开始时清除旧错误卡片');assert.equal(card.dataset.state,'pending');assert.isTrue(retry.hidden);assert.equal(translate.textContent,'机翻');
   requests[1].resolve({text:'噪声服从 ϵ ∼N (0, I)。',provider:'controlled machine translator'});await wait(()=>card.dataset.state==='complete');assert.equal(output.textContent,'噪声服从 ϵ ∼N (0, I)。');assert.notExists(output.querySelector('.translation-feedback'));assert.isTrue(retry.hidden);assert.isFalse(translate.disabled);assert.equal(translate.textContent,'机翻');assert.equal(translate.dataset.translationMode,'machine');assert.equal(card.getAttribute('aria-busy'),'false');assert.lengthOf(requests,2,'选择展开原因不会额外请求翻译');
  }finally{core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},sourceReader._iframeWindow));}
 });
 it('keeps native selected-text translation readable and applies a chosen color and style immediately',async()=>{
  const core=sourceReader._internalReader,manager=core._annotationManager,add=manager.addAnnotation,oldMode=core._state.textSelectionAnnotationMode,added=[];let translations=0;
  E.quickTranslate=async(text,signal,options)=>{translations++;assert.isFalse(options.allowModelFallback);assert.include(text,'selected paragraph');return{text:'选中段落的受控中文译文，保留指标 24% 和变量。',provider:'controlled machine translator'};};
  manager.addAnnotation=annotation=>{added.push(JSON.parse(JSON.stringify(annotation)));return{...annotation,id:'controlled-color-style'};};
  try{
   core._updateState(Cu.cloneInto({primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text:'A selected paragraph reports a measured 24% result.',position:{pageIndex:0,rects:[[20,20,300,36]]},sortIndex:'00000|000001|00000'}}},sourceReader._iframeWindow));
   await wait(()=>doc.querySelector('.selection-popup .easysch-quick-translation')?.dataset.state==='complete');const popup=doc.querySelector('.selection-popup'),card=popup.querySelector('.easysch-quick-translation'),output=card.querySelector('.quick-translation-output'),translate=card.querySelector('.quick-translation-run');
   assert.include(output.textContent,'受控中文译文');assert.equal(doc.defaultView.getComputedStyle(output).display,'block');assert.isAbove(output.getBoundingClientRect().height,18);assert.notEqual(doc.defaultView.getComputedStyle(output).color,'rgba(0, 0, 0, 0)');assert.equal(translate.textContent,'机翻');assert.isFalse(translate.disabled);
   for(const selector of ['.quick-translation-cancel','.quick-translation-retry'])assert.equal(doc.defaultView.getComputedStyle(card.querySelector(selector)).display,'none','隐藏状态以实际计算样式验收');
   popup.querySelector('[data-annotation-color="#5fb236"]').click();await Zotero.Promise.delay(30);assert.lengthOf(added,0,'选择颜色不提前创建批注');assert.equal(popup.querySelector('[data-annotation-color="#5fb236"]').getAttribute('aria-pressed'),'true');
   const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(PathUtils.join(folder,'selected-text-translation-and-colors.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}
   assert.equal(translations,1,'颜色选择不重复触发机翻');translate.click();assert.equal(translate.textContent,'机翻','点击执行时名称不切换成 AI 翻译');await wait(()=>translations===2&&card.dataset.state==='complete');assert.equal(translate.textContent,'机翻');assert.equal(translate.dataset.translationMode,'machine');
   const note=popup.querySelector('.easysch-reader-note'),strike=popup.querySelector('.easysch-reader-strikeout');assert.equal(note.textContent,'保存为笔记');assert.equal(strike.textContent,'划掉文字');assert.isFalse(note.disabled);assert.isFalse(strike.disabled);note.click();await wait(()=>calls.notes?.length===1);assert.equal(calls.notes[0].selection.position.pageIndex,0);assert.include(calls.notes[0].translation.text,'受控中文译文');strike.click();await wait(()=>calls.annotations?.length===1);assert.equal(calls.annotations[0].type,'strikeout');assert.equal(calls.annotations[0].selection.position.pageIndex,0);
   popup.querySelector('[data-annotation-mode="underline"]').click();await wait(()=>added.length===1);assert.equal(added[0].type,'underline');assert.equal(added[0].color,'#5fb236');assert.equal(added[0].position.pageIndex,0);assert.include(added[0].text,'24%');assert.equal(translations,2,'选区工具不重复触发机翻');
  }finally{manager.addAnnotation=add;core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},sourceReader._iframeWindow));core.setTextSelectionAnnotationMode(oldMode);}
 });
 it('dispatches Gecko mouse hit tests through the selection popup without losing the selected source before saving',async()=>{
  const core=sourceReader._internalReader,manager=core._annotationManager,add=manager.addAnnotation,oldMode=core._state.textSelectionAnnotationMode,added=[],events=[];
  E.quickTranslate=async()=>({text:'受控选区译文，不调用外部服务'});manager.addAnnotation=annotation=>{added.push(JSON.parse(JSON.stringify(annotation)));return{...annotation,id:'controlled-pointer-annotation'};};
  const nativeClick=async(node)=>{
   const rect=node.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,hit=doc.elementFromPoint(x,y);assert.strictEqual(hit.closest('button'),node,'实际鼠标命中目标按钮，没有透明层遮盖');
   const down=event=>events.push({type:event.type,prevented:event.defaultPrevented,text:core._state.primaryViewSelectionPopup?.annotation?.text}),up=event=>events.push({type:event.type}),clicked=event=>events.push({type:event.type});
   node.addEventListener('pointerdown',down);node.addEventListener('pointerup',up);node.addEventListener('click',clicked);
   try{
    // Current Gecko exposes synthesis on Window, not the retired
    // nsIDOMWindowUtils.sendMouseEvent. This still uses browser hit testing
    // at coordinates; it is not a target-only dispatch or a hardware click.
    const contentWindow=Cu.unwaiveXrays(sourceReader._iframeWindow),options=Cu.cloneInto({button:0,inputSource:1},contentWindow),synthesis=Cu.cloneInto({isDOMEventSynthesized:true},contentWindow);
    assert.isFunction(contentWindow.synthesizeMouseEvent,'测试环境需提供Gecko坐标事件合成入口');
    contentWindow.synthesizeMouseEvent('mousemove',x,y,options,synthesis);contentWindow.synthesizeMouseEvent('mousedown',x,y,options,synthesis);contentWindow.synthesizeMouseEvent('mouseup',x,y,options,synthesis);await Zotero.Promise.delay(40);
   }
   finally{node.removeEventListener('pointerdown',down);node.removeEventListener('pointerup',up);node.removeEventListener('click',clicked);}
  };
  try{for(const type of ['underline','highlight']){
   core._updateState(Cu.cloneInto({primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text:'The full source selection for '+type+'.',position:{pageIndex:0,rects:[[20,20,300,36],[20,40,250,56]]},sortIndex:'00000|000001|00000'}}},sourceReader._iframeWindow));
   await wait(()=>doc.querySelector('.selection-popup .easysch-quick-translation')?.dataset.state==='complete');const popup=doc.querySelector('.selection-popup');
   await nativeClick(popup.querySelector('[data-annotation-color="#5fb236"]'));assert.equal(core._state.primaryViewSelectionPopup.annotation.text,'The full source selection for '+type+'.','颜色pointerdown/up不丢失完整选区');
   const before=added.length;await nativeClick(popup.querySelector('[data-annotation-mode="'+type+'"]'));await wait(()=>added.length===before+1);const actual=added[before];assert.equal(actual.type,type);assert.equal(actual.color,'#5fb236');assert.equal(actual.text,'The full source selection for '+type+'.');assert.lengthOf(actual.position.rects,2,'跨行选区完整保留');
   popup.querySelector('.selection-annotation-save').click();assert.equal(added.length,before+1,'模式点击后再按保存不会创建重复批注');core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},sourceReader._iframeWindow));await wait(()=>!doc.querySelector('.selection-popup'));
  }
  assert.isAtLeast(events.filter(event=>event.type==='pointerdown').length,4);assert.isAtLeast(events.filter(event=>event.type==='pointerup').length,4);assert.isAtLeast(events.filter(event=>event.type==='click').length,4);assert.isTrue(events.filter(event=>event.type==='pointerdown').every(event=>event.text?.startsWith('The full source selection')),'所有实际鼠标按下时仍保存当前完整选区');
  }finally{manager.addAnnotation=add;core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},sourceReader._iframeWindow));core.setTextSelectionAnnotationMode(oldMode);}
 });
});
