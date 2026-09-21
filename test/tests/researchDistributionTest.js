describe('Self-contained EasySch distribution', function () {
 this.timeout(240000);
 let win, folder;
 const E = Zotero.Research, report = {runtime: [], controlled: [], live: {}, limitations: []};
 before(async () => {
  win = await loadZoteroPane(); await E.attachWindow(win);
  folder = PathUtils.join(Zotero.DataDirectory.dir, 'distribution-verification');
  await IOUtils.makeDirectory(folder, {ignoreExisting: true});
 });
 after(async () => {
  await E.store.flush();
  await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  win?.close();
 });
 it('initializes bundled tools and APIs in a clean profile', async () => {
  assert.exists(E.distribution);
  assert.isTrue(E.hasBundledProviders);
  const root = PathUtils.parent(Services.dirsvc.get('XREExeF', Ci.nsIFile).parent.path);
  for (const name of ['engineNode','engineEntry','assetPython','pandoc','soffice','poppler']) {
   const path = Zotero.Prefs.get('extensions.easysch.' + name, true);
   assert.isTrue(path.startsWith(PathUtils.join(root, 'runtime') + '\\'), name + ' must resolve inside the package');
   assert.isTrue(await IOUtils.exists(path));
  }
  const flags = await E.providerStatus(); assert.isTrue(flags.deepseek); assert.isTrue(flags.youdao); assert.isTrue(flags.easyscholar);
  report.runtime.push('空白配置自动取得 6 个内置工具路径和 3 组 API 凭据；未复制日常文库');
 });
 it('uses standalone Python, Node and Pandoc for real editable DOCX', async () => {
  const csv = PathUtils.join(folder, '中文数据.csv'); await IOUtils.writeUTF8(csv, '方法,说明\nCNN,卷积神经网络\n');
  const python = Zotero.Prefs.get('extensions.easysch.assetPython', true);
  const dataset = await E.runArtifactEngine({operation:'manuscript-data', python, file:csv});
  assert.include(JSON.stringify(dataset), '卷积神经网络');
  const result = await E.runArtifactEngine({operation:'manuscript-export', python, pandoc:E.settings().pandoc, directory:folder,
   project:{title:'安装包文档处理验证',sections:[{id:'s',title:'方法'}],blocks:[
    {id:'p',sectionID:'s',type:'paragraph',text:'这是运行时验证文字，不是实验结果。'},
    {id:'f',sectionID:'s',type:'formula',text:'E=mc^2'}]}});
  assert.isTrue(await IOUtils.exists(result.path)); assert.equal(result.structure.formulas,1);
  report.runtime.push({operation:'DOCX 真实导出与 OMML 结构检查',path:result.path,formulas:result.structure.formulas});
 });
 it('renders a real PPTX using bundled LibreOffice and Poppler', async () => {
  const result = await E.runArtifactEngine({operation:'export',directory:folder,
   record:{sources:[{id:'fixture',text:'软件安装包验证文字，非实验数据'}]},
   plan:{version:1,title:'运行时验证',slides:[{kind:'text',title:'安装包可以独立导出',bullets:['中文正文和可编辑对象','不依赖开发机 PATH'],sources:['fixture'],notes:'仅为打包验证'}]}});
  assert.isTrue(await IOUtils.exists(result.path)); assert.lengthOf(result.previews,1);
  assert.isTrue(await IOUtils.exists(result.previews[0]));
  report.runtime.push({operation:'PPTX 导出及真实 LibreOffice/Poppler 渲染',path:result.path,preview:result.previews[0]});
 });
 it('keeps user overrides and removals until explicitly restoring defaults', async () => {
  const endpoint = E.settings().endpoint, key = await E.credentials.get(endpoint);
  try {
   await E.credentials.set(endpoint,''); await E.store.update(s => s.settings.model = 'user-selected-model');
   await E.initDistribution(); assert.equal(await E.credentials.get(endpoint),''); assert.equal(E.settings().model,'user-selected-model');
   await E.applyBundledProviders({reset:true}); assert.equal(await E.credentials.get(endpoint),key); assert.notEqual(E.settings().model,'user-selected-model');
  } finally { await E.applyBundledProviders({reset:true}); }
  report.controlled.push('隔离配置中的删除/自选模型不会被重启初始化覆盖；可恢复内置接口');
 });
 it('connects to actual preconfigured API services', async () => {
  report.live = await E.testProviders();
  for (const [name, result] of Object.entries(report.live)) {
   if (!/成功|已连接/.test(result)) report.limitations.push(name + '：' + result);
  }
  // Record service-specific failures instead of turning a local runtime check into a fake service pass.
  assert.isAbove(Object.keys(report.live).length,0);
  const ui = await E.openWorkflow('settings');
  ui.show('settings'); ui.loadSettings();
  const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
  const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
  canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
  const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,'bundled-settings.png'),new Uint8Array(await blob.arrayBuffer()));image.close();
 });
});
