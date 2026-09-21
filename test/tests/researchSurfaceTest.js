describe('Research surfaces and real academic services',function(){
 this.timeout(240000);const R=Zotero.Research;let win,ui,folder,paper,attachment,project;const report={controlled:[],network:[],limitations:[]};
 const wait=async fn=>{for(let i=0;i<1400;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待前台超时');};
 async function shot(name){const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();}
 before(async()=>{win=await loadZoteroPane();win.Zotero_Tabs.closeAll();await R.attachWindow(win);win.resizeTo(1480,980);folder=PathUtils.join(Zotero.DataDirectory.dir,'surface-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});ui=await R.openWorkflow('research');await R.preparePassageSearch();const hits=R.findPaperPassages('实验设置');assert.isAbove(hits.length,0,'已有真实 PDF 全文实验检索');attachment=await Zotero.Items.getAsync(hits[0].m.attachmentID);paper=attachment.parentItem||attachment;});
 after(async()=>{await R.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('groups home workbench and settings, with no graph navigation',async()=>{
  assert.sameMembers([...win.document.querySelectorAll('#easysch-home-navigation button')].map(n=>n.textContent),['文献阅读','文献搜集','论文装配','组会 PPT','日程','设置']);
  const doc=ui.$('view-writing').ownerDocument;assert.notExists(doc.querySelector('.rail [data-tab=graph]'));assert.notExists(doc.querySelector('.rail [data-tab=journal]'));assert.lengthOf(doc.querySelectorAll('.workbench-group > button'),4);ui.show('settings');assert.include(ui.$('view-settings').textContent,'期刊与论文模板');await shot('01-home-settings.png');report.controlled.push('实际 Gecko DOM：主页入口、工作台分组、设置内配置导航');
 });
 it('creates by name and opens the separate feasibility stage before assembly',async()=>{
  ui.show('writing');ui.$('new-manuscript').click();ui.$('manuscript-name').value='界面与正文流程验收';assert.notExists(ui.$('project-idea'));ui.$('manuscript-name').closest('form').requestSubmit();await wait(()=>{project=Object.values(R.manuscripts.all()).filter(p=>p.title==='界面与正文流程验收').sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];return project&&win.document.getElementById('research-notebook-'+project.id)?.contentWindow.NotebookUI?.ready;});const note=win.document.getElementById('research-notebook-'+project.id);assert.isFalse(note.contentDocument.getElementById('evaluation').hidden);assert.notExists(win.document.getElementById('manuscript-'+project.id));note.contentDocument.getElementById('back').click();await wait(()=>win.document.getElementById('manuscript-'+project.id)?.contentWindow.ManuscriptUI?.ready);assert.equal(win.Zotero_Tabs.selectedType,'manuscript');await shot('02-project-assembly.png');report.controlled.push('创建表单先进入可行性，用户明确进入装配');
 });
 it('previews fulltext methods in the standalone material library without duplicating assets or opening papers',async()=>{
  await R.notebook.update(project.id,{query:'实验设置',view:'read'});await R.notebook.open(project.id);const frame=win.document.getElementById('research-notebook-'+project.id);await wait(()=>frame.contentWindow.NotebookUI?.ready);const doc=frame.contentDocument;await wait(()=>doc.querySelector('.passage-result'));const before=Object.keys(R.manuscripts.assetLibrary()).length,tabs=win.Zotero_Tabs.getState().length;doc.querySelector('.passage-result').click();await wait(()=>doc.getElementById('detail').textContent.includes('论文全文命中'));assert.equal(Object.keys(R.manuscripts.assetLibrary()).length,before);assert.equal(win.Zotero_Tabs.getState().length,tabs);assert.include(doc.getElementById('detail').textContent,'保存到素材库');await shot('03-fulltext-experiments.png');report.controlled.push('真实既有 PDF 解析正文 + DOM 中文查询：命中实验段落，单击预览，没有新增素材或阅读标签');
 });
 it('switches Chinese summaries and source/type view across both material surfaces',async()=>{
  const frame=win.document.getElementById('research-notebook-'+project.id),doc=frame.contentDocument;
  await R.notebook.update(project.id,{materialView:'summary'});await wait(()=>doc.querySelector('.material-excerpt'));
  assert.notInclude(doc.getElementById('topic-navigation').textContent,'素材还没有按研究主题归组');assert.include(doc.getElementById('organize').title,'研究主题');
  doc.querySelector('.material-view-switch [data-mode=source]').click();await wait(()=>R.notebook.state(project.id).materialView==='source');
  assert.notExists(doc.querySelector('.material-display > .material-excerpt'));assert.exists(doc.querySelector('.material-category'));
  const compact=win.document.getElementById('manuscript-'+project.id).contentDocument;
  await wait(()=>compact.querySelector('.material-view-switch [data-mode=source][aria-pressed=true]'));
  await R.store.flush();assert.equal(R.notebook.state(project.id).materialView,'source');
  doc.querySelector('.material-view-switch [data-mode=summary]').click();await wait(()=>doc.querySelector('.material-excerpt'));await shot('07-material-view-modes.png');
  report.controlled.push('Gecko DOM：中文简述与题目/分类切换，两个素材视图即时一致；说明只在整理按钮 title 中');
 });
 it('translates an existing fulltext passage into a separate Chinese description using the configured model',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();
  const m=R.findPaperPassages('实验设置')[0].m,before=JSON.stringify(m);await R.manuscripts.ensureChineseSummaries([m],{retry:true});
  const summary=R.manuscripts.summaryFor(m);assert.notMatch(summary,/正在整理|暂未完成/);assert.match(summary,/[\u3400-\u9fff]/);assert.equal(JSON.stringify(m),before);
  await R.notebook.select(project.id,m.id);
  const frame=win.document.getElementById('research-notebook-'+project.id),doc=frame.contentDocument;
  await wait(()=>doc.querySelector('#detail h2')?.textContent===R.manuscripts.titleFor(m));
  assert.match(doc.querySelector('#detail h2').textContent,/[\u3400-\u9fff]/);
  assert.include(doc.getElementById('detail').textContent,summary);
  const evidence=doc.querySelector('#detail details');assert.exists(evidence);assert.isFalse(evidence.open);assert.equal(evidence.querySelector('blockquote').textContent,m.sourceText);
  const compact=win.document.getElementById('manuscript-'+project.id).contentDocument;
  const hit=[...compact.querySelectorAll('.passage-result')].find(row=>row.querySelector('.material-heading')?.textContent===R.manuscripts.titleFor(m));assert.exists(hit);hit.click();
  assert.equal(compact.querySelector('#details h3').textContent,R.manuscripts.titleFor(m));
  const retry=[...compact.querySelectorAll('#details button')].find(b=>b.textContent==='重新整理中文说明');assert.exists(retry.closest('details'));assert.isFalse(retry.closest('details').open);
  await shot('08-chinese-passage-detail.png');
  report.network.push({type:'实际论文全文中文说明；配置模型或已有请求缓存',materialID:m.id,summary});
 });
 it('resolves the journal printed on submission covers without claiming publication',async function(){
  if(!(await R.providerStatus()).easyscholar)this.skip();
  const indexed=await Zotero.Items.getAsync(Object.keys(R.store.get().manuscriptIndex).map(Number));const sample=indexed.find(x=>R.journalContext(x).kind==='submitted');assert.exists(sample,'已有投稿 PDF 封面');
  const context=R.journalContext(sample);assert.include(context.sourceText,context.journal);const metric=await R.ensurePaperMetrics(sample,{retry:true});assert.isAbove(metric?.impact_factor||0,0);
  const info=R.materialSourceInfo({attachmentID:sample.id});assert.include(info.impact,'投稿期刊 IF');assert.notEqual(info.title,'来源论文未录入');
  report.network.push({type:'真实 easyScholar；实际投稿封面期刊，无 ISSN 也可查询',context,metric});
 });
 it('automatically translates an actual reader selection with the real machine service, then reuses cache',async function(){
  if(!(await R.providerStatus()).youdao){report.limitations.push('真实机翻：未配置有道');this.skip();}
  const reader=await Zotero.Reader.open(attachment.id);await reader._initPromise;await wait(()=>reader._internalReader?._primaryView);assert.notExists(reader._iframeWindow.document.querySelector('.easysch-ppt-reader,.easysch-assets-open'));const doc=reader._iframeWindow.document,text='The experimental results should be compared with a baseline under the same data split.';let modelCalls=0;const original=R.ai.run;R.ai.run=async()=>{modelCalls++;throw Error('机翻不能调用大模型');};
  try{const start=Date.now();reader._internalReader._updateState(Components.utils.cloneInto({primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text,position:{pageIndex:0,rects:[[20,20,300,36]]},sortIndex:'00000|000001|00000'}}},reader._iframeWindow));await wait(()=>doc.querySelector('.easysch-quick-translation [role=status]')?.textContent!=='正在翻译…'&&doc.querySelector('.easysch-quick-translation [role=status]'));const output=doc.querySelector('.easysch-quick-translation [role=status]');assert.notInclude(output.textContent,'不可用');assert.match(output.textContent,/[\u3400-\u9fff]/);assert.lengthOf(doc.querySelectorAll('.easysch-quick-translation button'),1);assert.equal(doc.querySelector('.easysch-reader-note').textContent,'记为笔记');assert.equal(modelCalls,0);const duration=Date.now()-start,cache=await R.quickTranslate(text);assert.isTrue(cache.cacheHit);await shot('04-reader-machine-translation.png');report.network.push({type:output.title.includes('缓存')?'读取机翻缓存；选区由测试构造':'真实有道请求；Reader 选区状态由测试构造',durationMs:duration,text:output.textContent,cacheHit:cache.cacheHit,noModelCalls:true});}finally{R.ai.run=original;}
 });
 it('retrieves a real impact factor without inventing a metric year',async function(){
  if(!(await R.providerStatus()).easyscholar){report.limitations.push('真实影响因子查询未配置');this.skip();}const sample=new Zotero.Item('journalArticle');sample.setField('publicationTitle','Nature');sample.setField('ISSN','0028-0836');const metric=await R.ensurePaperMetrics(sample,{retry:true});assert.isAbove(metric?.impact_factor||0,0);assert.equal(metric.metric_year,null);report.network.push({type:'真实 easyScholar 查询；Nature 标准期刊参数，未新增论文条目',metric});
 });
 it('shows native academic chat and persists one real model discussion with sources',async function(){
  win.Zotero_Tabs.select('zotero-pane');await win.ZoteroPane.selectItem(paper.id);await wait(()=>win.document.querySelector('.academic-chat'));const chat=win.document.querySelector('.academic-chat'),input=chat.querySelector('textarea');input.focus();assert.isTrue(chat.classList.contains('focused'));assert.isTrue(chat.closest('item-details').classList.contains('academic-focus'));const sibling=chat.closest('item-details').querySelector('info-box');assert.equal(win.getComputedStyle(sibling).display,'none');assert.exists(win.document.querySelector('.research-paper-metric'));const info=win.document.querySelector('info-box');assert.isTrue(info.hideEmptyFields);assert.exists(info.querySelector('.research-fields-toggle'));await shot('05-academic-chat.png');
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){report.limitations.push('真实模型讨论未启用');this.skip();}
  input.value='请结合这篇论文的原文，提出一个关于实验基线公平性或数据泄漏的具体核验问题。不要推测已完成的实验。用简短中文回答并引用原文。';const before=R.paperConversation(paper.id).turns.length;input.closest('form').requestSubmit();await wait(()=>!chat.querySelector('button.primary').disabled);const turns=R.paperConversation(paper.id).turns;assert.equal(turns.length,before+1,chat.querySelector('[role=status]').textContent);const t=turns.at(-1);assert.isAbove(t.record.sources.length,0);assert.isAbove(t.record.result.sections.length,0);await shot('06-live-academic-answer.png');report.network.push({type:'真实模型调用；原生侧栏表单由 DOM 提交',model:t.record.model,paperID:paper.id,turnID:t.id,sources:t.record.sources.length,answer:R.core.resultMarkdown(t.record)});
 });
});
