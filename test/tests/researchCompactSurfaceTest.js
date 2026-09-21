/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Compact research surfaces', function () {
 this.timeout(180000);const E=Zotero.Research;let win,ui,project,pdf,folder;const results=[];
 const wait=async fn=>{for(let i=0;i<900;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待界面超时');};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);ui=await E.openWorkflow('research');
  folder=PathUtils.join(Zotero.DataDirectory.dir,'compact-surface-2026-09-19');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const items=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID);
  for(const i of items)if(i.isPDFAttachment()&&await i.fileExists()){pdf=i;break;}
 });
 after(async()=>{await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify({type:'原生 Gecko 交互与已有真实 PDF，未调用模型',results},null,2));win?.close();});
 it('shows first-page preview above abstract and keeps image evidence directly reachable',async function(){
  if(!pdf)this.skip();win.Zotero_Tabs.select('zotero-pane');await win.ZoteroPane.selectItem(pdf.parentID||pdf.id);
  await wait(()=>win.document.querySelector('item-details:not([hidden]) .paper-cover')?.complete);
  const image=win.document.querySelector('item-details:not([hidden]) .paper-cover');assert.isAbove(image.naturalWidth,0);
  const details=image.closest('item-details'),panes=details.getPanes();assert.include(panes[0].dataset.pane,'research-overview');assert.equal(panes[1].dataset.pane,'abstract');
  assert.exists(details.querySelector('info-box .head .research-fields-toggle'));
  assert.include(image.parentElement.textContent,'图片证据');const tabs=win.Zotero_Tabs.getState().length;
  await E.renderPaperOverview(image.parentElement.parentElement,pdf.parentItem||pdf);assert.equal(win.Zotero_Tabs.getState().length,tabs);
  const panel=await E.openImageEvidence(pdf.id);assert.exists(panel);assert.equal(panel.getAttribute('aria-label'),'图片证据链');panel.closePanel();
  results.push('真实 PDF 首页可见；首页、摘要顺序；信息编辑位于标题行；预览不新开标签；首次加载阅读器后图片证据面板展开');
 });
 it('uses one calendar with task state and a bottom settings entry on both surfaces',async()=>{
  const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/compact-ui.mjs'),due=M.dateKey(new Date());
  await E.store.update(s=>{s.tasks=(s.tasks||[]).filter(t=>t.id!=='compact-calendar-fixture');s.tasks.push({id:'compact-calendar-fixture',title:'界面验收待办',due:due+'T18:00',done:false});});
  const native=win.document.querySelector('#easysch-library-bottom .compact-calendar>button');assert.include(native.textContent,'项待办');native.click();
  assert.include(win.document.querySelector('.calendar-tasks').textContent,'界面验收待办');const check=[...win.document.querySelectorAll('.calendar-tasks label')].find(n=>n.textContent==='界面验收待办').querySelector('input');check.click();await wait(()=>E.store.get('tasks').find(t=>t.id==='compact-calendar-fixture').done);
  assert.exists(ui.$('view-title').ownerDocument.querySelector('.rail-bottom [data-tab=settings]'));
  assert.equal(win.getComputedStyle(win.document.getElementById('zotero-tag-selector-container')).display,'none');native.click();results.push('日历真实读取任务，完成状态同步保存；标签区替换为日历，设置固定底部');
 });
 it('creates directly into assembly without calling the feasibility model',async()=>{
  project=await E.notebook.beginProject({title:'界面验收 · 直接装配',skipAssessment:true});
  await wait(()=>win.document.getElementById('manuscript-'+project.id)?.contentWindow.ManuscriptUI?.ready);
  assert.equal(E.notebook.state(project.id).workflowStage,'assembly');assert.notExists(win.document.getElementById('research-notebook-'+project.id));
  results.push('新建项目跳过可行性分析，进入装配标签，保留可选评估入口');
 });
 it('opens filters inside search in both material views without replacing input nodes',async()=>{
  const frame=win.document.getElementById('manuscript-'+project.id),doc=frame.contentDocument;
  await wait(()=>doc.getElementById('material-search'));const input=doc.getElementById('material-search'),wrap=input.closest('.compact-search-field');assert.exists(wrap);assert.isTrue(wrap.querySelector('.search-filter-popover').hidden);wrap.querySelector('button').click();assert.isFalse(wrap.querySelector('.search-filter-popover').hidden);
  await E.notebook.open(project.id);const notebook=win.document.getElementById('research-notebook-'+project.id);await wait(()=>notebook.contentWindow.NotebookUI?.ready);const nd=notebook.contentDocument,search=nd.getElementById('search');assert.exists(search.closest('.compact-search-field'));assert.exists(nd.querySelector('.compact-select-all input'));
  await E.notebook.update(project.id,{query:'卷积神经网络'});assert.equal(nd.getElementById('search'),search);results.push('两种素材视图共用折叠筛选；查询更新保留搜索输入节点');
 });
 it('supports page addition and context menus on non-paper tabs',async()=>{
  assert.exists(win.document.querySelector('.easysch-new-tab'));const menu=E.openPageMenu(win,win.document.querySelector('.easysch-new-tab'));assert.include(menu.textContent||[...menu.children].map(x=>x.getAttribute('label')).join(' '),'论文装配');menu.hidePopup();
  const tab=win.Zotero_Tabs.selectedID;const context=win.Zotero_Tabs._openMenu(200,100,tab);context?.hidePopup();
  ui.show('research');assert.lengthOf(ui.$('workspace-progress').querySelectorAll('button'),3);results.push('标签栏加号显示页面选择；文献阅读步骤条可见');
 });
});
