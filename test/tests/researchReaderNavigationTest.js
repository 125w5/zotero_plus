/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Stable paper reader navigation', function () {
 this.timeout(120000);
 const E = Zotero.Research;
 let win, pdf, reader, details, prior, folder;
 const report = {type:'原生 Zotero DOM；书目/页面解释后台受控，不代表真人鼠标验收或真实联网', tests:[]};
 const wait = async (fn, label) => { for (let i=0; i<160; i++) { if (fn()) return; await Zotero.Promise.delay(50); } throw Error('等待'+label+'超时'); };
 const rail = () => [...details.sidenav._enabledWrappers].map(wrapper => wrapper.querySelector('.btn').dataset.pane);
 const content = () => details.getPanes().map(pane => pane.dataset.pane);

 before(async () => {
  prior = {prepare:E.manuscripts.prepareTranslation, overview:E.renderPaperOverview, metadata:E.completePaperMetadata, metrics:E.ensurePaperMetrics};
  E.manuscripts.prepareTranslation = async () => null;
  E.renderPaperOverview = async body => { body.textContent = '受控首页'; };
  E.completePaperMetadata = async () => {};
  E.ensurePaperMetrics = async () => {};
  win = await loadZoteroPane(); await E.attachWindow(win);
  folder = PathUtils.join(Zotero.DataDirectory.dir, 'reader-navigation-acceptance'); await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  // Import the article fixture: Items.getAll() has no ORDER BY, so the first
  // leftover PDF follows random item keys and may be test.pdf, whose single
  // paragraph crops to a strip rather than an article homepage.
  pdf = await importFileAttachment('recognizePDF_test_arXiv.pdf');
  assert.isTrue(pdf.isPDFAttachment() && await pdf.fileExists(),'隔离文库需要真实 PDF');
  reader = await E.openReaderReady(pdf.id);
  win.ZoteroContextPane.collapsed = false; win.ZoteroContextPane.context.mode = 'item';
  await wait(() => { details=[...win.document.querySelectorAll('item-details')].find(node=>node.tabID===reader.tabID);return details?.dataset.easyschNavigation==='paper'; }, '论文阅读侧栏');
 });
 afterEach(async function () { report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2)); });
 after(async () => {
  E.manuscripts.prepareTranslation=prior.prepare;E.renderPaperOverview=prior.overview;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;
  await E.store.flush();
  try{
   if(win&&!win.closed){
    try{
     await win.Zotero_Tabs.closeAll();
     await wait(()=>!Zotero.Reader._readers.some(value=>value._window===win),'原生论文阅读器清理');
    }finally{win.close();}
   }
  }finally{await pdf?.eraseTx();}
 });

 it('keeps one note destination and hides duplicate metadata shortcuts without losing native sections', async () => {
  const order=rail();const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-navigation.mjs');
  const expected=[content().find(id=>M.researchPaneKind(id)==='abstract'),'info','context-notes',...['images','references','workstation'].map(kind=>content().find(id=>M.researchPaneKind(id)===kind))];
  assert.deepEqual(order.slice(0,6),expected);
  assert.notInclude(order,'abstract');assert.notInclude(order,'attachment-info');assert.notInclude(order,'attachments');
  const attachmentPane=details.getPane('attachments');assert.exists(attachmentPane);assert.strictEqual(attachmentPane.parentElement,details._paneParent);assert.equal(attachmentPane.dataset.easyschMetadata,'hidden');assert.isNull(details.getEnabledPane('attachments'));assert.isTrue(await pdf.fileExists(),'隐藏附件入口不删除真实 PDF');
  assert.isFalse(details.sidenav.querySelector('[data-pane="info"]').parentElement.hidden,'PDF 与题录均保留一个首页信息入口');
  assert.notInclude(order,'notes');
  assert.isFalse(details.sidenav.querySelector('[data-pane="context-notes"]').parentElement.hidden);
  assert.isTrue(details.sidenav.querySelector('[data-pane="notes"]').parentElement.hidden);
  for(const id of ['libraries-collections','tags','related']) {
   const pane=details.getPane(id);assert.exists(pane);assert.strictEqual(pane.parentElement,details._paneParent,'原生资料section始终是直子pane');assert.isTrue(details.sidenav.querySelector(`[data-pane="${id}"]`).parentElement.hidden);assert.equal(pane.dataset.easyschMetadata,'hidden');assert.isNull(details.getEnabledPane(id));
  }
  assert.isFalse(details.supportsReorder,'点击或轻微拖移不能改写论文阅读的固定顺序');
  assert.isTrue(details.sidenav.querySelector('[data-action="locate"]').parentElement.hidden,'重复源地址功能不占常用rail');
 });

 it('side icons select one full-height, non-collapsible feature without changing rail order or rendering hidden features', async () => {
  const beforeRail=rail(),beforeContent=content(),sidenav=details.sidenav,M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-navigation.mjs'),seen=[];
  const custom=details.getCustomPanes(),saved=custom.map(pane=>({pane,render:pane.render,asyncRender:pane.asyncRender}));
  for(const pane of custom){pane.render=()=>{};pane.asyncRender=async()=>{seen.push(pane.dataset.pane);};}
  try {
   for(const id of ['info','context-notes',content().find(id=>M.researchPaneKind(id)==='abstract'),'info',content().find(id=>id.includes('research-images')),'info']) {
    const before=seen.length;
    await sidenav.handleButtonClick({target:sidenav.querySelector(`[data-pane="${id}"]`),button:0,detail:1});
    assert.deepEqual(rail(),beforeRail);assert.deepEqual(content(),beforeContent);
    if(id==='context-notes')assert.equal(details.researchActivePane,'context-notes');
    else {
     const selected=M.resolvePaperPaneID(content(),id),pane=details.getPane(selected),section=pane.querySelector('collapsible-section');
     assert.equal(details.researchActivePane,selected);assert.equal(pane.dataset.easyschSelected,'true');
     assert.deepEqual(seen.slice(before),[selected],'选择面板只渲染选中的功能');
     assert.equal(win.getComputedStyle(section.querySelector('.head')).display,'none','功能不再包含第二个折叠标题');
     assert.isTrue(section.open);assert.isFalse(section.collapsible);section.open=false;assert.isTrue(section.open,'面板不能被折叠成卡片');
     const viewport=details._paneParent.getBoundingClientRect(),rect=pane.getBoundingClientRect();
     assert.closeTo(rect.top,viewport.top,1,'选中功能从右栏顶部开始');assert.isAtLeast(rect.height,viewport.height-1,'选中功能占满可用右栏高度');
     assert.equal(details._paneParent.scrollTop,0);
    }
    for(const pane of details.getPanes().filter(pane=>pane.dataset.easyschSelected!=='true'))assert.equal(win.getComputedStyle(pane).display,'none','未选中的功能必须隐藏：'+pane.dataset.pane);
   }
   await sidenav.handlePaneOrderChange([...beforeContent].reverse().join(','));
   assert.deepEqual(rail(),beforeRail);assert.deepEqual(content(),beforeContent);
   const overview=beforeContent.find(id=>id.includes('research-overview'));assert.include(seen,overview,'信息入口显示首页与摘要简述');
   const focus=sidenav.querySelector('[data-pane="info"]');focus.focus();const observer=new win.MutationObserver(()=>{});observer.observe(sidenav._buttonContainer,{childList:true});sidenav.render();assert.lengthOf(observer.takeRecords(),0,'顺序不变时不能重插全部按钮并丢失键盘焦点');observer.disconnect();
  } finally {for(const {pane,render,asyncRender}of saved){pane.render=render;pane.asyncRender=asyncRender;}await details.selectResearchPane('info');}
 });

 it('edits preserved native metadata in one popup without adding a second reading information pane', async () => {
  const info=details.getPane('info'),menu=info.querySelector('.research-metadata-details'),edit=info.querySelector('.research-fields-toggle');
  assert.exists(menu);assert.exists(edit);assert.strictEqual(edit.closest('.research-metadata-menu'),menu.querySelector('.research-metadata-menu'),'复用已有编辑字段功能，不再创建第二个header入口');
  assert.lengthOf(info.querySelectorAll('.research-fields-toggle'),1);
  const priorAttachments=pdf.parentItem?.getAttachments?.()||[pdf.id],paneIDs=content();
  try {
   menu.querySelector('[data-metadata-pane="tags"]').click();await wait(()=>details.getPane('tags').classList.contains('paper-metadata-editor'),'更多信息在同一编辑弹层');
   const tags=details.getPane('tags');assert.equal(tags.dataset.easyschMetadata,'shown');assert.exists(details.getEnabledPane('tags'));assert.isTrue(details.sidenav.querySelector('[data-pane="tags"]').parentElement.hidden);assert.isFalse(menu.open);assert.strictEqual(tags.parentElement,details._paneParent);assert.equal(tags.getAttribute('aria-modal'),'true');assert.lengthOf(win.document.querySelectorAll('.paper-metadata-backdrop'),1);assert.deepEqual(content(),paneIDs,'编辑不重新挂载原生 pane 或改写顺序');
   tags.querySelector('.paper-metadata-close').click();assert.notExists(win.document.querySelector('.paper-metadata-backdrop'));assert.equal(tags.dataset.easyschMetadata,'hidden');assert.isNull(details.getEnabledPane('tags'));
   const target=details.item.isRegularItem()?'info':'attachment-info';await details.showResearchPaperMetadata(target);assert.isTrue(details.getPane(target).classList.contains('paper-metadata-editor'));win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.notExists(win.document.querySelector('.paper-metadata-backdrop'));assert.equal(details.getPane(target).dataset.easyschMetadata,'hidden');
   assert.deepEqual(pdf.parentItem?.getAttachments?.()||[pdf.id],priorAttachments);assert.isTrue(await pdf.fileExists());
  } finally {details._closeResearchMetadataEditor?.();}
 });

 it('renders compact conversation roles and loads preserved older discussion only when requested', async () => {
  const S=E.workbenchConversations,host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div'),paper=pdf.parentItem||pdf,scope={paperID:paper.id},priorScope=S.getForScope(scope),priorActive=S.getActive()?.id;
  const fixture=await S.create({title:'隔离学术对话界面验收',paperID:paper.id,origin:'test'});win.document.documentElement.append(host);
  try {
   E.renderSidebar(win.document,host,paper);let chat=host.querySelector('.academic-chat');assert.exists(chat);
   assert.notInclude(chat.textContent,'论文 · 批注 · 研究记忆');assert.notInclude(chat.textContent,'从论文与批注出发');assert.notInclude(chat.textContent,'图片证据与中文解读');assert.isTrue(chat.querySelector('.academic-chat-heading').hidden);assert.isTrue(chat.querySelector('.academic-related').hidden);
   assert.lengthOf(chat.querySelectorAll('form textarea[data-ai-prompt]'),1,'只有一份对话输入栏');
   assert.exists(chat.querySelector('form .academic-composer-brand .easysch-symbol'),'输入栏同一行保留用户EasySch标志');
   await wait(()=>chat.querySelector('.academic-session-select')?.value===fixture.id,'学术侧栏使用当前论文的共享会话');assert.isFalse(S.list().some(value=>value.id===fixture.id),'只打开侧栏不创建持久对话记录');
   const records=[];for(let i=0;i<14;i++)records.push({id:fixture.id+'-question-'+i,role:'user',text:'受控问题 '+i},{id:fixture.id+'-answer-'+i,role:'assistant',text:'**待验证**的受控学术回答。',sources:[]});
   await S.update(fixture.id,{messages:records},{origin:'test'});await wait(()=>chat.querySelectorAll('.academic-message.assistant').length===12,'共享回答同步到学术侧栏');assert.lengthOf(chat.querySelectorAll('.academic-turn'),24);assert.lengthOf(chat.querySelectorAll('.academic-message.user'),12);assert.lengthOf(chat.querySelectorAll('.academic-message.assistant'),12);assert.exists(chat.querySelector('.academic-message-content strong'),'正文使用统一排版组件');assert.lengthOf(chat.querySelectorAll('.academic-message-actions'),12,'每个回答只有一个紧凑动作菜单');
   assert.lengthOf(chat.querySelectorAll('.academic-message-head .easysch-symbol'),12,'回答角色沿用同一用户标志');
   const older=chat.querySelector('.academic-older');assert.exists(older);assert.isFalse(older.open);assert.lengthOf(older.querySelectorAll('.academic-turn'),0);older.open=true;await wait(()=>older.querySelectorAll('.academic-turn').length===4,'历史讨论按需展开');assert.lengthOf(chat.querySelectorAll('.academic-turn'),28,'旧消息全部保留');assert.equal(S.getForScope(scope).id,fixture.id,'学术侧栏与 Logo 按论文读取同一份会话');
  } finally {host.querySelector('.academic-chat')?._disposeResearch?.();host.remove();await S.remove(fixture.id);if(priorScope&&S.get(priorScope.id))await S.select(priorScope.id,{scope});if(priorActive&&S.get(priorActive))await S.select(priorActive);}
 });

 it('keeps complete native fields and source-sentence highlights, then opens full English and Chinese abstracts in a separate column',async()=>{
  const saved={sourceInfo:E.materialSourceInfo,abstract:E.paperAbstract,translate:E.quickTranslate,localPDF:E.library.localPDF};
  const host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');host.style.cssText='position:fixed;left:100px;top:70px;width:330px;height:530px;overflow:auto;z-index:9000;background:white';win.document.documentElement.append(host);
  const values={title:'受控真实字段保留',publicationTitle:'Controlled Journal',conferenceName:'Controlled Conference',publisher:'Controlled Publisher',volume:'12',issue:'3',pages:'45–60',date:'2026-10-10',DOI:'10.1000/controlled',ISSN:'1234-5678',url:'https://controlled.invalid/paper'};
  const english='Domain adaptation with CNN addresses independent device shifts. '+'The evaluation uses separate recordings with fixed partitions and identical preprocessing. '.repeat(5)+'Experiments show 95.6% accuracy on the held-out recordings.';
  const chinese='CNN 用于设备间的域适应问题。'+'验证使用独立采集的数据，固定划分和预处理，保持比较条件一致。'.repeat(10)+'实验在留出数据上报告 95.6% 准确率。';
  const author=Zotero.CreatorTypes.getID('author'),editor=Zotero.CreatorTypes.getID('editor');
  const fixture={id:pdf.parentID||pdf.id,isRegularItem:()=>true,getField:key=>values[key]||'',getUsedFields:()=>Object.keys(values),getCreators:()=>[{firstName:'Ada',lastName:'Lovelace',creatorTypeID:author},{lastName:'Research Group',fieldMode:1,creatorTypeID:editor}],getTags:()=>[{tag:'CNN'},{tag:'域适应'}]};
  // This field fixture spans several native item types and is not a Zotero.Item.
  // File resolution must use the already verified real PDF, never pass this
  // partial metadata object into the library's real-item attachment traversal.
  E.library.localPDF=item=>item?.id===fixture.id&&item?.getField?.('title')===values.title?Promise.resolve(pdf):saved.localPDF(item);
  E.materialSourceInfo=()=>({metric:{impact_factor:4.2,metric_year:2025,source:'受控原始期刊记录'}});E.paperAbstract=async()=>({text:english,kind:'metadata',keywords:['CNN']});
  let translations=0;E.quickTranslate=async text=>{assert.equal(text,english);translations++;return {text:chinese};};
  try{
   await prior.overview(host,fixture);await wait(()=>host.querySelector('.overview-abstract p')?.textContent.includes('Domain adaptation'),'实际来源摘要简述');
   const information=host.querySelector('.paper-overview-info');
   for(const [key,value]of Object.entries(values).filter(([key])=>key!=='title'))assert.equal(information.querySelector(`[data-field="${key}"]`)?.textContent,value,'原生字段 '+key+' 完整保留');
   assert.equal(information.querySelector('[data-field="creator:'+Zotero.CreatorTypes.getLocalizedString(author)+'"]').textContent,'Ada Lovelace');
   assert.equal(information.querySelector('[data-field="creator:'+Zotero.CreatorTypes.getLocalizedString(editor)+'"]').textContent,'Research Group');
   assert.include(information.querySelector('.overview-metric-source').textContent,'受控原始期刊记录');
   const paragraph=host.querySelector('.overview-abstract p');
   assert.equal(paragraph.dataset.view,'excerpt');assert.isBelow(paragraph.textContent.length,english.length);assert.isAtLeast(paragraph.querySelectorAll('mark').length,1);assert.include(paragraph.textContent,'95.6%','简述保留实际结果句和小数');
   assert.equal(translations,0,'打开概览不调用翻译或总结模型');assert.notExists(host.querySelector('.overview-abstract-mode'));assert.notExists(host.querySelector('.overview-abstract-expand'));
   const full=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');host.append(full);
   await E.renderPaperAbstract(full,fixture);const original=full.querySelector('.paper-abstract-original'),translated=full.querySelector('.paper-abstract-chinese');
   assert.equal(original.querySelector('p').textContent,english);assert.equal(translated.querySelector('p').textContent,chinese);assert.strictEqual(original.nextElementSibling,translated,'英文在上，中文在下');
   assert.equal(win.getComputedStyle(original.querySelector('p')).fontSize,'14px');assert.equal(win.getComputedStyle(translated.querySelector('p')).fontSize,'14px');
   await E.renderPaperAbstract(full,fixture);assert.equal(translations,1,'重开已翻译摘要复用同一缓存');assert.isTrue(await pdf.fileExists(),'信息显示不改变 PDF 原件');
   const abstractPane=details.getPanes().find(pane=>pane.dataset.pane.includes('research-abstract')),overviewPane=details.getPanes().find(pane=>pane.dataset.pane.includes('research-overview'));
   assert.exists(abstractPane);await prior.overview(overviewPane.querySelector('[data-type="body"]'),fixture);
   const open=overviewPane.querySelector('.overview-abstract-open');assert.exists(open);assert.isFalse(open.hidden);open.click();await wait(()=>details.researchActivePane===abstractPane.dataset.pane,'概览摘要点击进入独立全文面板');
   assert.equal(win.getComputedStyle(overviewPane).display,'none');assert.notEqual(win.getComputedStyle(abstractPane).display,'none');await details.selectResearchPane('info');
  }finally{host._overviewOff?.();host._overviewHoverCleanup?.();host.remove();E.materialSourceInfo=saved.sourceInfo;E.paperAbstract=saved.abstract;E.quickTranslate=saved.translate;E.library.localPDF=saved.localPDF;}
 });

 it('uses the cropped article homepage, preserves navigation and bounds the thumbnail inside a narrow native pane', async () => {
  const saved={cover:E.assets.cover,preview:E.previewImage,open:E.library.openSource,pages:E._overviewPages,abstract:E.paperAbstract,translate:E.quickTranslate,sourceInfo:E.materialSourceInfo};
  // Use valid pixels from the isolated library's actual PDF. The controlled
  // path names below exercise task reuse and navigation without fake PNG data.
  const fixtureCover=await saved.cover(pdf.id),thumbnail=await saved.preview(fixtureCover.thumbnail||fixtureCover.path),fullImage=await saved.preview(fixtureCover.path);
  assert.isString(fixtureCover.pdfHash);assert.isAbove(fixtureCover.pdfHash.length,10);
  report.overviewFixture={pdfHash:fixtureCover.pdfHash,path:fixtureCover.path,thumbnail:fixtureCover.thumbnail,pageIndex:fixtureCover.pageIndex,width:fixtureCover.width,height:fixtureCover.height};
  const host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');host.style.cssText='position:fixed;left:100px;top:70px;width:310px;height:520px;overflow:auto;background:white;z-index:9000;contain:layout';win.document.documentElement.append(host);let calls=0;const paths=[],opened=[];
  // Resize events from the embedded reader and other frames bubble to this window and
  // used to cancel the hover the pointer was on; record them next to scrolls.
  const interaction=report.overviewInteraction={enter:0,leave:0,scroll:0,focus:0,blur:0,resize:0,frameResize:0};const countScroll=()=>interaction.scroll++,countResize=event=>{interaction.resize++;if(event.target!==win)interaction.frameResize++;};win.addEventListener('scroll',countScroll,true);win.addEventListener('resize',countResize);
  const overviewPane=details.getPanes().find(pane=>pane.dataset.pane.includes('research-overview'));
  assert.exists(overviewPane);const nativeBody=overviewPane.querySelector('[data-type="body"]'),originalNodes=[...nativeBody.childNodes],priorOpen=overviewPane.open,priorStyle=details.getAttribute('style');
  const cover={pageIndex:2,pageHeight:792,pageWidth:612,bbox:[32,28,580,754],path:'controlled-high-resolution.png',thumbnail:'controlled-thumbnail.png',skippedPages:[{pageIndex:0,reason:'publisher-cover'},{pageIndex:1,reason:'submission-cover'}]};
  let impact=5.1,snapshotBranch;E.materialSourceInfo=()=>({metric:{impact_factor:impact,metric_year:2025,source:'受控 JCR 记录'},journalContext:{journal:'受控期刊'}});
  E.paperAbstract=async()=>({text:'This controlled abstract validates the actual interface without calling any translation model.',kind:'metadata'});
  E.quickTranslate=async(text,signal,options)=>{assert.strictEqual(options.allowModelFallback,false,'打开摘要只能使用机翻，不启动模型');return {text:'受控中文摘要：使用独立验证集核对实际界面。'};};
  E._overviewPages=new Map();E.assets.cover=async attachmentID=>{assert.equal(attachmentID,pdf.id);calls++;return cover;};E.previewImage=async path=>{paths.push(path);return path==='controlled-high-resolution.png'?fullImage:thumbnail;};E.library.openSource=async source=>{opened.push(source);};
  try {
   const [first,again]=await Promise.all([E.firstPage(pdf),E.firstPage(pdf)]);assert.equal(calls,1,'并发预览复用一个本地裁图任务');assert.strictEqual(first,again);assert.equal(first.src,thumbnail);assert.equal(first.pageIndex,2);assert.deepEqual(paths,['controlled-thumbnail.png'],'普通预览仅加载小缩略图');
   await prior.overview(host,pdf);const image=host.querySelector('.paper-cover');report.overview={connected:host.isConnected,text:host.textContent,hasToken:!!host._overviewToken,hasOriginalRenderer:prior.overview.toString().includes('paper-overview')};assert.exists(image,'裁图预览状态：'+JSON.stringify(report.overview));assert.equal(image.dataset.pageIndex,'2');assert.isTrue(host.querySelector('.overview-status').hidden,'已加载的首页不再独占一行状态文字');image.dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true,detail:2}));await wait(()=>opened.length===1,'正文首页双击定位');assert.equal(opened[0].attachmentID,pdf.id);assert.equal(opened[0].pageIndex,2);assert.deepEqual(opened[0].position,{pageIndex:2,rects:[[32,38,580,764]]});
   assert.isTrue(image.classList.contains('research-media-trigger'),'首页使用通用预览事件组件');await image.decode();assert.isAbove(image.naturalWidth,0);assert.isAbove(image.naturalHeight,0);
   for(const [event,key]of [['pointerenter','enter'],['pointerleave','leave'],['focus','focus'],['blur','blur']])image.addEventListener(event,()=>interaction[key]++);
   await wait(()=>host.querySelector('.overview-abstract p')?.textContent.includes('controlled abstract'),'来源摘要');
   const box=host.querySelector('.paper-overview');assert.deepEqual([...box.children].map(node=>node.className),['paper-overview-cover','paper-overview-info','overview-abstract']);
   assert.exists(host.querySelector('.paper-overview-info h3'));assert.include(host.querySelector('.overview-if').textContent,'5.1');assert.include(host.querySelector('.overview-metric-source').textContent,'受控 JCR 记录');
   assert.notExists(host.querySelector('.overview-abstract-mode'),'概览不再有行内语言切换和二次折叠');
   image.focus();await Zotero.Promise.delay(80);assert.strictEqual(win.document.activeElement,image);image.dispatchEvent(new win.PointerEvent('pointerenter'));await wait(()=>{interaction.connected=image.isConnected;interaction.bounds=JSON.stringify(image.getBoundingClientRect().toJSON());interaction.pathReads=paths.length;const large=win.document.querySelector('.research-media-hover img');return paths.includes('controlled-high-resolution.png')&&large?.complete&&large.naturalWidth>0;},'悬停按需加载且解码完整原图');const hoverImage=win.document.querySelector('.research-media-hover img');assert.isAbove(hoverImage.naturalHeight,0);assert.isAtLeast(hoverImage.naturalWidth,image.naturalWidth,'放大预览使用实际高分辨率像素');assert.equal(hoverImage.src,fullImage);image.dispatchEvent(new win.PointerEvent('pointerleave'));assert.notExists(win.document.querySelector('.research-media-hover'));
   image.dispatchEvent(new win.PointerEvent('pointerenter'));await wait(()=>win.document.querySelector('.research-media-hover'),'再次悬停');image.dispatchEvent(new win.PointerEvent('pointerleave'));assert.equal(paths.filter(path=>path==='controlled-high-resolution.png').length,1,'同一预览多次悬停不重读完整 PNG');
   image.click();await wait(()=>win.document.querySelector('.research-media-modal'),'单击放大查看');assert.equal(opened.length,1,'单击大图不新开论文');win.document.querySelector('.research-media-backdrop').click();assert.notExists(win.document.querySelector('.research-media-modal'));
   await prior.overview(host,pdf);assert.strictEqual(host.querySelector('.paper-cover'),image,'相同题录重绘不会重建首页');assert.equal(calls,1);
   // The overview refreshes only for journal metric or index commits; write a
   // controlled metric entry the way metrics-provider.js saves a real one.
   impact=5.4;snapshotBranch=!!E.store.get('journalMetricSnapshots');await E.store.update(s=>{s.journalMetricSnapshots||={};s.journalMetricSnapshots._overviewControlledTick={at:new Date().toISOString(),metric:{impact_factor:impact}};});await wait(()=>host.querySelector('.overview-if').textContent.includes('5.4'),'IF 更新');assert.strictEqual(host.querySelector('.paper-cover'),image,'IF 更新不闪烁重建图片');assert.equal(calls,1);
   // The detached fixture above tests source selection only. Actual sidebars
   // include a native flex column whose intrinsic minimum width is different.
   // Use the real local PDF crop here; no model or network request is involved.
   E.assets.cover=saved.cover;E.previewImage=saved.preview;E._overviewPages=new Map();nativeBody._overviewItem=null;
   await details.selectResearchPane('info');await prior.overview(nativeBody,pdf);const nativeImage=nativeBody.querySelector('.paper-cover');assert.exists(nativeImage);await nativeImage.decode();
   assert.isAbove(nativeImage.naturalWidth,0);assert.isAbove(nativeImage.naturalHeight,0);assert.equal(win.getComputedStyle(nativeBody.querySelector('.overview-status')).display,'none','完成状态不能仍占一行');report.coverSizing=[];
   for(const width of [320,450]){
    details.style.width=width+'px';details.style.maxWidth=width+'px';details.style.minWidth='0';
    await Zotero.Promise.delay(50);
    const paneRect=details.getBoundingClientRect(),bodyRect=nativeBody.getBoundingClientRect(),imageRect=nativeImage.getBoundingClientRect(),column=details.querySelector('.zotero-view-item-main');
    const geometry={requestedWidth:width,paneWidth:paneRect.width,bodyWidth:bodyRect.width,imageWidth:imageRect.width,imageHeight:imageRect.height,naturalWidth:nativeImage.naturalWidth,naturalHeight:nativeImage.naturalHeight,bodyScrollWidth:nativeBody.scrollWidth,bodyClientWidth:nativeBody.clientWidth,columnScrollWidth:column.scrollWidth,columnClientWidth:column.clientWidth};report.coverSizing.push(geometry);
    assert.isAtMost(paneRect.width,width+1,'真实侧栏必须在所设宽度内');assert.isAbove(imageRect.width,60,'不能以零宽或隐藏图片通过尺寸验收');assert.isAbove(imageRect.height,60);
    assert.isAtMost(imageRect.height,361,'较大的首页预览仍保持侧栏尺寸上限');assert.isAtLeast(imageRect.left,bodyRect.left-1);assert.isAtMost(imageRect.right,bodyRect.right+1,'原图不能伸出侧栏');
    assert.closeTo(imageRect.width/imageRect.height,nativeImage.naturalWidth/nativeImage.naturalHeight,.02,'缩略图保持裁剪原图比例，不拉伸或裁掉页面');
    assert.isAtMost(nativeBody.scrollWidth,nativeBody.clientWidth+1,'缩略图不能扩大原生自定义section');assert.isAtMost(column.scrollWidth,column.clientWidth+1,'百分比宽度必须基于实际侧栏，不得被图片固有宽度撑开');
   }
  } finally {
   nativeBody._overviewOff?.();nativeBody._overviewHoverCleanup?.();nativeBody._overviewItem=null;nativeBody._overviewSignature=null;nativeBody.replaceChildren(...originalNodes);overviewPane.open=priorOpen;
   if(priorStyle===null)details.removeAttribute('style');else details.setAttribute('style',priorStyle);
   win.removeEventListener('scroll',countScroll,true);win.removeEventListener('resize',countResize);host._overviewOff?.();host._overviewHoverCleanup?.();host.remove();E.assets.cover=saved.cover;E.previewImage=saved.preview;E.library.openSource=saved.open;E._overviewPages=saved.pages;E.paperAbstract=saved.abstract;E.quickTranslate=saved.translate;E.materialSourceInfo=saved.sourceInfo;
   if(snapshotBranch!==undefined)await E.store.update(s=>{delete s.journalMetricSnapshots?._overviewControlledTick;if(!snapshotBranch&&s.journalMetricSnapshots&&!Object.keys(s.journalMetricSnapshots).length)delete s.journalMetricSnapshots;});
  }
 });
});
