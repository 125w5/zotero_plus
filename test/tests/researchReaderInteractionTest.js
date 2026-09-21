/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Reader interaction repairs 2026-09-19',function(){
 this.timeout(180000);const E=Zotero.Research;let win,pdf,reader,view,folder,selection,noteSave;const report={native:[],live:[],limitations:['原生 DOM 触发不等同真人鼠标验收；选区坐标为测试构造']};
 const wait=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待原生界面超时');};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'reader-interaction-2026-09-19');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  for(const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID))if(item.isPDFAttachment()&&!item.deleted&&await item.fileExists()){pdf=item;break;}
  assert.exists(pdf,'隔离文库需要一个真实 PDF');reader=await E.openReaderReady(pdf.id);view=reader._internalReader._primaryView;await view.initializedPromise;
  selection={paperID:pdf.parentID||pdf.id,attachmentID:pdf.id,text:'Interaction validation, not an experimental result.',pageIndex:0,position:{pageIndex:0,rects:[[60,600,220,612],[60,582,260,594]]},sortIndex:'00000|000003|00000'};
 });
 after(async()=>{await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 afterEach(async function(){report.tests||=[];report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 it('keeps formula superscripts together and separates lines and columns',()=>{
  const G=ChromeUtils.importESModule('chrome://zotero/content/research/shared/annotation-geometry.mjs');
  const rects=G.lineRects([[10,100,50,112],[50,108,57,116],[58,100,80,112],[300,100,360,112],[10,80,80,92]]);assert.lengthOf(rects,3);
  const strikes=G.strikePositions({pageIndex:0,rects,nextPageRects:[[10,40,80,52]]});assert.lengthOf(strikes,2);assert.lengthOf(strikes[0].paths,3);assert.deepEqual(strikes[1].paths[0],[10,46,80,46]);report.native.push('公式上下标合并，多行/多栏删除线几何与跨页定位');
 });
 it('applies toolbar underline to a selection and converts an existing annotation',async()=>{
  const core=reader._internalReader;view._selectionRanges=Cu.cloneInto([{collapsed:false,text:selection.text,sortIndex:selection.sortIndex,pageIndex:0,position:JSON.parse(JSON.stringify(selection.position))}],reader._iframeWindow);
  const before=new Set(core._state.annotations.map(a=>a.id));core.setTool(Cu.cloneInto({type:'underline'},reader._iframeWindow));await wait(()=>core._state.annotations.some(a=>!before.has(a.id)));const a=core._state.annotations.find(a=>!before.has(a.id));assert.equal(a.type,'underline');
  core.setSelectedAnnotations(Cu.cloneInto([a.id],reader._iframeWindow));core.setTool(Cu.cloneInto({type:'highlight'},reader._iframeWindow));assert.equal(core._state.annotations.find(x=>x.id===a.id).type,'highlight');
  report.native.push('真实 Reader 实例：工具栏下划线立即应用当前选区，已有标注可切为高亮');
 });
 it('writes red strikeout through Delete without intercepting inputs or IME',async()=>{
  await E.attachReaderInteractions(reader);const core=reader._internalReader,doc=view._iframeWindow.document;
  const setSelection=()=>{view._selectionRanges=Cu.cloneInto([{collapsed:false,text:selection.text,sortIndex:selection.sortIndex,pageIndex:0,position:JSON.parse(JSON.stringify(selection.position))}],reader._iframeWindow);};
  // Gecko excludes chrome-created untrusted keyboard events from the content
  // listener. Exercise the native handler here; real keyboard input is checked
  // separately through the foreground application.
  const keyEvent=(target,isComposing=false)=>{const e=Cu.cloneInto({key:'Delete',isComposing,preventDefault(){},stopImmediatePropagation(){}},reader._iframeWindow,{cloneFunctions:true});e.target=target;return e;};
  setSelection();const before=core._state.annotations.length;view._handleKeyDown(keyEvent(doc.body,true));assert.equal(core._state.annotations.length,before);
  const input=doc.createElement('textarea');doc.body.append(input);view._handleKeyDown(keyEvent(input));assert.equal(core._state.annotations.length,before);input.remove();
  view._handleKeyDown(keyEvent(doc.body));await wait(()=>core._state.annotations.length>before);const a=core._state.annotations.find(x=>x.type==='ink'&&x.text===selection.text);assert.equal(a.type,'ink');assert.equal(a.color,'#e33b46');assert.lengthOf(a.position.paths,2);
  core._annotationManager.undo();assert.isFalse(core._state.annotations.some(x=>x.id===a.id));
  core._annotationManager.updateAnnotations(Cu.cloneInto([{id:a.id,image:'late-image-result'}],reader._iframeWindow));assert.isFalse(core._state.annotations.some(x=>x.id===a.id));
  report.native.push('Delete 创建多行红色删除线，IME 期间忽略；撤销后迟到的图片更新不恢复标记');
 });
 it('opens the newly saved note and keeps one editor per reader tab',async()=>{
  noteSave=await E.saveSelectionTranslation(selection,{text:'中文交互验收笔记。'});const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);await wait(()=>context._getCurrentEditor()?.item?.id===noteSave.noteID);
  const second=await E.saveSelectionTranslation(selection,{text:'第二条笔记应成为当前笔记。'});await wait(()=>context._getCurrentEditor()?.item?.id===second.noteID);
  assert.lengthOf(context.tabNotesDeck.querySelectorAll(`[data-tab-id="${reader.tabID}"]`),1);context.switchToTab(reader.tabID);assert.equal(context._getCurrentEditor().item.id,second.noteID);
  const editor=context._getCurrentEditor();await editor._initPromise;assert.exists(editor.querySelector('.easysch-note-insert button'));
  report.native.push('连续保存两条笔记后聚焦最新笔记；切换标签后保持；插入菜单可用');
 });
 it('migrates old note links and synchronizes trash and restore without touching the PDF',async()=>{
  const note=await Zotero.Items.getAsync(noteSave.noteID),annotation=await Zotero.Items.getAsync(noteSave.annotationID);
  await E.store.update(s=>{for(const [k,v]of Object.entries(s.readerNoteLinks))if(v.noteID===note.id)delete s.readerNoteLinks[k];});await E.discoverNoteLinks(note);assert.exists(E.noteLinkForAnnotation(pdf.id,annotation.key));
  await Zotero.Items.trashTx(note.id);await wait(()=>annotation.deleted);note.deleted=false;await note.saveTx();await wait(()=>!annotation.deleted);assert.isTrue(await pdf.fileExists());
  report.native.push('旧回源链接迁移；笔记回收/恢复同步关联标记；源 PDF 保留');
 });
 it('preserves TeX in the native note schema and imports a real CSV and image',async()=>{
  const html=E.noteContentHTML('公式 $x^2$\n\n$$E=mc^2$$');assert.include(html,'class="math"');assert.notInclude(html,'katex-html');
  const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID),editor=context._getCurrentEditor();await editor._initPromise;
  const csv=PathUtils.join(folder,'实验数据.csv');await IOUtils.writeUTF8(csv,'方法,数值\nCNN,待验证\nTransformer,待补\n');const inserted=await E.insertNoteFile(editor,csv,'data');assert.include(inserted,'CNN');assert.include(inserted,'<table');
  const indexed=await E.assets.index(pdf.id,()=>{}),asset=indexed.assets.find(a=>a.thumbnail);assert.exists(asset);const imageHTML=await E.insertNoteFile(editor,asset.thumbnail,'image');assert.include(imageHTML,'data-attachment-key');
  const inner=editor.getCurrentInstance()._iframeWindow.document;await wait(()=>inner.querySelector('.primary-editor table'));await wait(()=>inner.querySelector('.primary-editor img'));
  const tables=inner.querySelectorAll('.primary-editor table').length;await E.insertNoteStructure(editor,'table');await wait(()=>inner.querySelectorAll('.primary-editor table').length>tables);
  report.native.push('TeX 转原生公式节点；实际 UTF-8 CSV 与图片插入原生笔记编辑器');
 });
 it('embeds image evidence in the existing right pane and retains all bibliography rows',async()=>{
  win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  let details,pane;await wait(()=>{pane=[...win.document.querySelectorAll('item-pane-custom-section')].find(p=>p.dataset.pane.includes('research-images')&&p.closest('item-details')?.tabID===reader.tabID);details=pane?.closest('item-details');return pane;});
  assert.strictEqual(pane.parentElement,details._paneParent,'证据栏不能进入隐藏附件笔记');
  await wait(()=>pane.querySelector('collapsible-section .head')?.getBoundingClientRect().height>0);
  assert.isAbove(pane.querySelector('collapsible-section .head')?.getBoundingClientRect().height||0,0,'图片证据标题可见');
  pane.open=false;
  const icon=details.sidenav.querySelector(`[data-pane="${pane.dataset.pane}"]`);
  await details.sidenav.handleButtonClick({target:icon,button:0,detail:1});
  await wait(()=>pane.querySelector('#easysch-asset-panel')?.dataset.ready==='true');
  assert.isTrue(pane.open,'侧栏图标展开图片证据');
  const panel=await E.openImageEvidence(pdf.id);await wait(()=>panel.dataset.ready==='true');assert.isTrue(panel.classList.contains('embedded-evidence'));assert.exists(panel.closest('item-pane-custom-section'));assert.isAbove(panel.querySelectorAll('article img').length,0);
  const refs=await E.referencesFromPDF({id:pdf.id});assert.isAbove(refs.records.length,0);const host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');win.document.documentElement.append(host);await E.renderReferencePane(host,pdf);assert.lengthOf(host.querySelectorAll('.reference-row'),refs.records.length);host.remove();
  const position=await E.locateReference(pdf.id,refs.records[0]);assert.isNumber(position.pageIndex);report.native.push('侧栏图标实际处理路径展开图片证据；参考文献全部保留且定位本篇 PDF');
 });
 it('saves a complete extracted image and its explanation into a linked native note',async()=>{
  const indexed=await E.assets.index(pdf.id,()=>{}),asset=indexed.assets.find(a=>a.kind==='figure'&&a.thumbnail);assert.exists(asset);
  const saved=await E.saveAssetNote(asset),note=Zotero.Items.get(saved.noteID),annotation=Zotero.Items.get(saved.annotationID);
  assert.deepEqual(JSON.parse(annotation.annotationPosition).rects,E.assets.position(asset).rects);
  assert.include(note.getNote(),'data-attachment-key');assert.exists(E.noteLinkForAnnotation(pdf.id,annotation.key));
  const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);await wait(()=>context._getCurrentEditor()?.item?.id===note.id);
  const editor=context._getCurrentEditor();await editor._initPromise;await wait(()=>editor.getCurrentInstance()._iframeWindow.document.querySelector('.primary-editor img'));
  report.native.push('提取的完整原图与已有解读保存为原生笔记，原图矩形和来源关联保留');
 });
 it('keeps the calendar open and shows inline daily tasks with persisted colors',async()=>{
  win.Zotero_Tabs.select('zotero-pane');const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/compact-ui.mjs'),day=M.dateKey(new Date());
  const id='reader-calendar-'+Date.now();await E.store.update(s=>{s.tasks||=[];s.tasks.push({id,title:id,due:day+'T18:00',done:false});});const root=win.document.querySelector('#easysch-library-bottom .calendar-inline');assert.exists(root);const date=root.querySelector(`[data-date="${day}"]`);assert.equal(date.dataset.tone,'pending');const tab=win.Zotero_Tabs.selectedID;date.click();assert.equal(win.Zotero_Tabs.selectedID,tab);const row=[...root.querySelectorAll('.calendar-tasks label')].find(n=>n.textContent.includes(id));assert.exists(row);row.querySelector('input').click();await wait(()=>E.store.get('tasks').find(t=>t.id===id).done);assert.isFalse(root.querySelector('.calendar-drawer').hidden);report.native.push('月历默认展开，点击在原位显示待办，勾选保存不跳页');
 });
 it('uses a real translation endpoint only when enabled',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){report.limitations.push('本轮未调用真实模型或机翻 API');this.skip();}
  const r=await E.quickTranslate('Attention Is All You Need');assert.match(r.text,/[\u3400-\u9fff]/);report.live.push({type:'真实机翻 API',text:r.text,cacheHit:r.cacheHit});
 });
});
