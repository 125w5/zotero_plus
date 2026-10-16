/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Native library paper organization and unified sidebar',function(){
 this.timeout(90000);const E=Zotero.Research;let win,workspace,paper,note,orphan,attachment,collection,projectItem,prior;
 const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时');};
 const tree=()=>win.ZoteroPane.itemsView;
 const ids=()=>tree().rowProvider.rows.filter(row=>row.isObjectRow&&row.type==='item').map(row=>row.ref.id);
 before(async()=>{
  prior={rapid:E.queueReaderRapidReading,images:E.assets.queueImages,metadata:E.completePaperMetadata,metrics:E.ensurePaperMetrics,summaries:E.manuscripts.ensureChineseSummaries,syncLibrary:E.manuscripts.syncLibrary};E.queueReaderRapidReading=()=>{};E.assets.queueImages=async()=>{};E.completePaperMetadata=async()=>{};E.ensurePaperMetrics=async()=>null;E.manuscripts.ensureChineseSummaries=async()=>{};
  // The persistent research fixture has projects from earlier suites whose
  // native item IDs belong to a discarded test DB. Test only the real project
  // created below, without starting unrelated full-library migration jobs.
  E.manuscripts.syncLibrary=async()=>{};
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1280,880);workspace=win._researchLibraryWorkspace;
  paper=await createDataObject('item',{itemType:'journalArticle',title:'论文视图受控验收'});
  note=new Zotero.Item('note');note.parentID=paper.id;note.setNote('<p>归属论文的人工笔记</p>');await note.saveTx();
  orphan=new Zotero.Item('note');orphan.setNote('<p>未关联笔记保留原样</p>');await orphan.saveTx();
  attachment=await Zotero.Attachments.importFromFile({file:PathUtils.join(getTestDataDirectory().path,'test.pdf')});
  const project=await E.manuscripts.create('真实装配项目视图验收');projectItem=Zotero.Items.get(await E.manuscripts.ensureLibraryItem(project.id));
  await win.ZoteroPane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID);await workspace.showItemScope('papers');
 });
 after(async()=>{workspace?.dispose();win?.close();if(prior){E.queueReaderRapidReading=prior.rapid;E.assets.queueImages=prior.images;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;E.manuscripts.ensureChineseSummaries=prior.summaries;E.manuscripts.syncLibrary=prior.syncLibrary;}});
 it('shows papers in the main list and preserves real child notes and attachment relationships',async()=>{
  await workspace.showItemScope('papers');assert.include(ids(),paper.id);assert.notInclude(ids(),orphan.id);assert.notInclude(ids(),attachment.id);assert.notInclude(ids(),projectItem.id);assert.equal(Zotero.Items.get(note.id).parentID,paper.id);
  await tree().selectItem(paper.id);await tree().expandSelectedRows();await wait(()=>ids().includes(note.id),'论文下的真实笔记');assert.include(ids(),note.id);
 });
 it('provides the unlinked-material view without reparenting, deleting or duplicating any item',async()=>{
  const before=orphan.getNote(),parent=attachment.parentID;const original=tree();await workspace.showItemScope('unlinked');assert.strictEqual(tree(),original);assert.include(ids(),orphan.id);assert.include(ids(),attachment.id);assert.include(ids(),projectItem.id);assert.isNotNull(E.manuscripts.projectForItem(projectItem));assert.notInclude(ids(),paper.id);
  assert.equal(Zotero.Items.get(orphan.id).getNote(),before);assert.equal(Zotero.Items.get(attachment.id).parentID,parent);assert.isFalse(orphan.deleted);await workspace.showItemScope('papers');assert.include(ids(),paper.id);assert.notInclude(ids(),orphan.id);
 });
 it('re-evaluates item notifications so newly added notes stay out of the paper list and become available in their own view',async()=>{
  const added=new Zotero.Item('note');added.setNote('<p>通知添加笔记</p>');await added.saveTx();await Zotero.Promise.delay(100);assert.notInclude(ids(),added.id);
  await workspace.showItemScope('unlinked');assert.include(ids(),added.id);added.parentID=paper.id;await added.saveTx();await wait(()=>!ids().includes(added.id),'重新归属后的资料视图');assert.equal(Zotero.Items.get(added.id).parentID,paper.id);
  await workspace.showItemScope('papers');await tree().selectItem(paper.id);await tree().expandSelectedRows();await wait(()=>ids().includes(added.id),'论文下的归属笔记');
  const project=await E.manuscripts.create('通知后关联装配项目'),itemID=await E.manuscripts.ensureLibraryItem(project.id);await wait(()=>!ids().includes(itemID),'延迟项目关联不会泄露到论文列表');await workspace.showItemScope('unlinked');assert.include(ids(),itemID);await workspace.showItemScope('papers');
 });
 it('centres the five unique research routes, keeps folders beneath the library and puts search above the daily panel',async()=>{
  const doc=win.document,buttons=doc.querySelectorAll('#easysch-home-navigation .native-workbench [data-page]');assert.deepEqual(Array.from(buttons,b=>b.dataset.page),['agent','search','discovery','writing','ppt']);
  for(const b of buttons){const style=win.getComputedStyle(b);assert.equal(style.textAlign,'center');assert.equal(style.display,'grid');assert.isAtLeast(b.getBoundingClientRect().height,34);}
  const toolbar=doc.getElementById('zotero-toolbar-collection-tree'),bottom=doc.getElementById('easysch-library-bottom');assert.strictEqual(toolbar.nextElementSibling,bottom);assert.equal(win.getComputedStyle(toolbar).backgroundColor,win.getComputedStyle(doc.getElementById('zotero-collections-pane')).backgroundColor);
  collection=await createDataObject('collection',{name:'直接位于文库下的研究文件夹'});const view=win.ZoteroPane.collectionsView;await view.selectCollection(collection.id);const root=view.getRowIndexByID('L'+Zotero.Libraries.userLibraryID),folder=view.getRowIndexByID('C'+collection.id),recent=view._rows.findIndex(row=>row.isRecentlyRead?.()&&row.ref.libraryID===Zotero.Libraries.userLibraryID);assert.isAbove(folder,root);if(recent>=0)assert.isBelow(folder,recent);
  await workspace.showItemScope('papers');assert.lengthOf(doc.querySelectorAll('.library-workspace-tabs [data-library-mode=discovery]'),0,'论文推荐仅有侧栏一个入口');
 });
});
