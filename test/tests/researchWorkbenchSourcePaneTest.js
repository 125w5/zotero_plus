/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Workbench native source panes', function () {
 this.timeout(90000);
 const E=Zotero.Research;let win,host,pdf,paper,prior,cleanup,annotation,folder,downloads=0;
 const report={type:'真实 Zotero DOM 与批注存储；图片、引用和下载回复受控，不代表模型、联网或真人鼠标验收',tests:[]};
 const wait=async(fn,label)=>{for(let i=0;i<240;i++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时');};
 const read=tab=>E.mountWorkbenchSourcePane(host,{id:pdf.parentID||pdf.id,attachmentID:pdf.id,anchor:{attachmentID:pdf.id,pageIndex:0}},tab);
 before(async()=>{
  prior={prepare:E.manuscripts.prepareTranslation,index:E.assets.index,queue:E.assets.queueImages,request:E.studio.request,obtain:E.obtainPaper,local:E.library.localPDF,images:E.openAssetPanel,references:E.renderReferencePane,open:E.library.openSource};
  E.manuscripts.prepareTranslation=async()=>null;E.assets.index=async()=>({assets:[],cacheHit:true});E.assets.queueImages=async()=>({status:'complete'});E.studio.request=async()=>{throw Error('本验收不调用模型');};E.obtainPaper=async()=>{downloads++;return{attachmentID:pdf.id};};
  win=await loadZoteroPane();await E.attachWindow(win);
  paper=await createDataObject('item',{itemType:'journalArticle',title:'来源预览的独立 PDF 夹具'});const fixture=getTestDataDirectory();fixture.append('test.pdf');pdf=await Zotero.Attachments.importFromFile({file:fixture,parentItemID:paper.id});
  assert.exists(pdf);host=win.document.createElementNS('http://www.w3.org/1999/xhtml','section');host.style.cssText='position:fixed;left:160px;top:80px;width:750px;height:600px;background:white;z-index:9000;display:flex;flex-direction:column';win.document.documentElement.append(host);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'workbench-source-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});report.downloadRequests=downloads;await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));cleanup?.();cleanup=null;E.openAssetPanel=prior.images;E.renderReferencePane=prior.references;E.library.localPDF=prior.local;E.library.openSource=prior.open;});
 after(async()=>{cleanup?.();host?.remove();if(annotation)await Zotero.Items.erase(annotation.id);E.manuscripts.prepareTranslation=prior.prepare;E.assets.index=prior.index;E.assets.queueImages=prior.queue;E.studio.request=prior.request;E.obtainPaper=prior.obtain;E.library.localPDF=prior.local;E.openAssetPanel=prior.images;E.renderReferencePane=prior.references;E.library.openSource=prior.open;win?.close();if(paper)await paper.eraseTx();});
 it('rejects PDF embedding and keeps workbench previews separate from the native reader',async()=>{
  const tabs=win.Zotero_Tabs._tabs.length,readers=Zotero.Reader._readers.length;let error;try{await read('read');}catch(value){error=value;}
  assert.include(error.message,'PDF 阅读器');assert.lengthOf(host.querySelectorAll('browser,iframe'),0);assert.equal(Zotero.Reader._readers.length,readers);assert.equal(win.Zotero_Tabs._tabs.length,tabs);
 });
 it('shows native annotations as synchronized cards without a second PDF or toolbar',async()=>{
  const tabs=win.Zotero_Tabs._tabs.length,readers=Zotero.Reader._readers.length;cleanup=await read('annotations');
  annotation=new Zotero.Item('annotation');annotation.libraryID=pdf.libraryID;annotation.parentID=pdf.id;annotation.annotationType='highlight';annotation.annotationText='受控公式 $x_i^2$';annotation.annotationComment='保存在原始附件';annotation.annotationColor='#ffd400';annotation.annotationPosition=JSON.stringify({pageIndex:0,rects:[[60,60,140,75]]});annotation.annotationPageLabel='1';annotation.annotationSortIndex='00000|000060|00000';await annotation.saveTx();
  await wait(()=>host.querySelector('[data-annotation-id="'+annotation.key+'"]'),'新增批注卡片');const card=()=>host.querySelector('[data-annotation-id="'+annotation.key+'"]');assert.exists(card().querySelector('.katex'));
  annotation.annotationComment='修改后的批注';await annotation.saveTx();await wait(()=>card()?.textContent.includes('修改后的批注'),'批注修改同步');
  let opened;E.library.openSource=async anchor=>{opened=anchor;};card().querySelector('button').click();await wait(()=>opened,'明确定位');assert.equal(opened.attachmentID,pdf.id);assert.equal(opened.annotationID,annotation.key);
  assert.lengthOf(host.querySelectorAll('browser,iframe,.toolbar'),0);assert.equal(Zotero.Reader._readers.length,readers);assert.equal(win.Zotero_Tabs._tabs.length,tabs);
  await Zotero.Items.trashTx([annotation.id]);await wait(()=>!card(),'移除批注同步');
 });
 it('binds image and reference previews to the explicit attachment and releases them on switching',async()=>{
  let imageDisposals=0,referenceDisposals=0,late,referenceBody,imageReader;
  E.openAssetPanel=(reader,_focus,body)=>{imageReader=reader;assert.isTrue(reader.researchPreviewOnly,'来源栏图片为预览模式');const panel=body.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml','div');panel.textContent='受控图片';panel.dispose=()=>imageDisposals++;body.append(panel);return panel;};
  E.renderReferencePane=async(body,item)=>{assert.equal(item.id,pdf.id);referenceBody=body;body._referenceDispose=()=>referenceDisposals++;await new Promise(resolve=>late=resolve);body.textContent='过期引用回复';};
  cleanup=await read('images');assert.equal(imageReader.itemID,pdf.id);const controller=new win.AbortController(),pending=E.mountWorkbenchSourcePane(host,{attachmentID:pdf.id},'references',{signal:controller.signal});await wait(()=>late,'引用整理');assert.equal(imageDisposals,1);controller.abort();late();await pending;
  assert.equal(referenceDisposals,1);assert.isFalse(referenceBody.isConnected);assert.equal(host.childElementCount,0);cleanup=await read('images');assert.equal(host.querySelector('.workbench-source-pane').dataset.attachmentId,String(pdf.id));
 });
 it('discards stale attachment lookups and aborts previews without stale writes',async()=>{
  let release,entered=false;E.library.localPDF=async item=>{if(!entered){entered=true;return new Promise(resolve=>release=()=>resolve(pdf));}return prior.local(item);};
  const old=read('annotations');await wait(()=>release,'过期附件查询');E.openAssetPanel=(_reader,_focus,body)=>{const panel=body.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml','div');panel.textContent='当前图片';panel.dispose=()=>{};body.append(panel);return panel;};cleanup=await read('images');release();await old;assert.include(host.textContent,'当前图片');assert.lengthOf(host.querySelectorAll('browser'),0);
  const controller=new win.AbortController();controller.abort();await E.mountWorkbenchSourcePane(host,{attachmentID:pdf.id},'annotations',{signal:controller.signal});assert.equal(host.childElementCount,0);
 });
 it('preserves missing references and only obtains full text after explicit action',async()=>{
  const before=downloads;E.renderReferencePane=async(body,item)=>{body.textContent='受控引用';};cleanup=await E.mountWorkbenchSourcePane(host,{id:'web-only',doi:'10.1000/controlled',title:'受控远程题录'},'references');assert.include(host.textContent,'暂无本地 PDF');assert.equal(downloads,before);host.querySelector('button').click();await wait(()=>host.textContent.includes('受控引用'),'手动获取后引用');assert.equal(downloads,before+1);assert.lengthOf(host.querySelectorAll('browser'),0);
 });
});
