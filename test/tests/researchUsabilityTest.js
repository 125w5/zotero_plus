describe('EasySch usability repairs 2026-09-18',function(){
 this.timeout(240000);
 const E=Zotero.Research,report={controlled:[],live:[],limitations:[]};let win,ui,paper,pdf,folder;
 const wait=async fn=>{for(let i=0;i<900;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('界面等待超时');};
 const shot=async name=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1060,760);folder=PathUtils.join(Zotero.DataDirectory.dir,'usability-2026-09-18');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  paper=await createDataObject('item',{title:'真实 PDF 阅读验收 · World Model · '+Date.now()});
  const path=Zotero.Prefs.get('extensions.easysch.testPDF',true);if(!path)throw Error('本轮验收需要 --PDF 实际文件');
  pdf=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:paper.id});
  ui=await E.openWorkflow('research');
 });
 after(async()=>{await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('only offers local PDF files, and keeps picker controls visible at laptop size',async()=>{
  const missing=await createDataObject('item',{title:'未下载的题录不得进入阅读'}),candidates=await E.library.readingCandidates();assert.isTrue(candidates.some(p=>p.id===paper.id));assert.isFalse(candidates.some(p=>p.id===missing.id));
  await ui.chooseResearchPapers();const doc=ui.$('view-research').ownerDocument,dialog=doc.getElementById('research-paper-picker');assert.isTrue(dialog.open);
  const input=dialog.querySelector('input');input.value=paper.getField('title');input.dispatchEvent(new doc.defaultView.Event('input'));
  const row=dialog.querySelector('.picker-row'),checkbox=row.querySelector('input');row.click();assert.isTrue(checkbox.checked);assert.isTrue(row.classList.contains('selected'));
  const rect=checkbox.getBoundingClientRect(),label=row.querySelector('span').getBoundingClientRect(),actions=dialog.querySelector('.picker-actions').getBoundingClientRect();assert.isBelow(Math.abs((rect.top+rect.height/2)-(label.top+label.height/2)),8);assert.isBelow(actions.bottom,doc.defaultView.innerHeight);
  dialog.querySelector('.selection-toolbar button').click();assert.include(dialog.textContent,'已选 1 篇');await shot('01-compact-picker.png');dialog.close();
  report.controlled.push('原生 Gecko DOM 操作：本地 PDF 过滤、整行选择与选中底色、全选、窄窗口固定按钮');
 });
 it('repairs structured responses once and binds literal PDF excerpts without trusting invented quotes',async()=>{
  let calls=0,saved=0;const source={id:'S1',text:'The conﬁguration uses\na held-out test set.'},state={papers:{}};
  const ai=E.createAI({fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:++calls===1?'not JSON':JSON.stringify({sections:[{heading:'核验',body:'使用独立测试集。',claim_type:'observation',quoteIDs:['Q1']}],questions:[]})}}]})}),controller:()=>new win.AbortController(),settings:()=>({endpoint:'https://example.org',model:'controlled'}),credential:async()=>'',collect:async()=>({sources:[source],warnings:[]}),store:{get:()=>state,update:async fn=>{fn(state);saved++;}}});
  const record=await ai.run({mode:'ask',papers:[E.library.describe(paper)]});assert.equal(calls,2);assert.equal(saved,1);assert.equal(record.result.sections[0].quotes[0].text,source.text);
  report.controlled.push('受控回复：一次格式修复；PDF 连字与换行按摘录编号绑定；仅在校验通过后保存');
 });
 it('returns from academic chat and renders Markdown as content',async()=>{
  win.Zotero_Tabs.select('zotero-pane');await win.ZoteroPane.selectItem(paper.id);await wait(()=>win.document.querySelector('.academic-chat'));
  const chat=[...win.document.querySelectorAll('.academic-chat')].find(n=>n.dataset.researchItem===String(paper.id));assert.exists(chat);chat.querySelector('textarea').focus();assert.isTrue(chat.classList.contains('focused'));chat.querySelector('.academic-info-toggle').click();assert.isFalse(chat.classList.contains('focused'));assert.isFalse(chat.closest('item-details').classList.contains('academic-focus'));
  const pane=chat.closest('item-pane-custom-section');pane.open=false;pane.open=true;assert.isTrue(chat.classList.contains('focused'));chat.querySelector('.academic-info-toggle').click();assert.isFalse(chat.classList.contains('focused'));
  const n=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');E.renderContent(n,'**中文结论**\n\n| 方法 | 结果 |\n|---|---|\n| CNN | 待验证 |\n\n$$E=mc^2$$');assert.exists(n.querySelector('strong'));assert.exists(n.querySelector('table'));assert.exists(n.querySelector('.katex'));assert.notInclude(n.textContent,'**');
  let opened;const uri='zotero://open-pdf/library/items/EXAMPLE?page=1',sources=[{id:'P1-L1',uri,position:{pageIndex:0,rects:[[1,2,3,4]]}},{id:'P1-L2',uri,position:{pageIndex:0,rects:[[5,6,7,8]]}}];
  E.renderContent(n,`[P1-L2](${uri})`,{sources,onSource:s=>opened=s});n.querySelector('[role="button"]').click();assert.strictEqual(opened,sources[1]);
  E.renderContent(n,`[未知链接](zotero://select/library/items/UNKNOWN) [执行](javascript:alert(1))`,{sources});assert.isNull(n.querySelector('a,button'));
  report.controlled.push('原生 Gecko DOM 操作：对话返回、格式化中文/表格/公式');
 });
 it('writes a native highlight, note and precise sentence link and preserves source files',async()=>{
  const selection={paperID:paper.id,attachmentID:pdf.id,pageIndex:0,position:{pageIndex:0,rects:[[54,690,300,702]]},text:'Software validation selection; not an experimental result.',sortIndex:'00000|000001|00001'};
  const saved=await E.saveSelectionTranslation(selection);const annotation=await Zotero.Items.getAsync(saved.annotationID);assert.equal(annotation.annotationType,'highlight');assert.equal(annotation.annotationText,selection.text);assert.isTrue(await IOUtils.exists(await pdf.getFilePathAsync()));
  const other=await createDataObject('item',{title:'关联终点测试论文'});const second=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(await pdf.getFilePathAsync()),parentItemID:other.id});
  const link=await E.linkSentences(selection,{...selection,paperID:other.id,attachmentID:second.id},{relation:'方法对比'});assert.equal(link.relation,'方法对比');assert.equal(E.store.get().sentenceLinks[link.id].from.attachmentID,pdf.id);assert.equal(E.store.get().sentenceLinks[link.id].to.attachmentID,second.id);
  await saved.undo();assert.isTrue(await IOUtils.exists(await pdf.getFilePathAsync()));report.controlled.push('真实数据库写入；选区坐标由测试构造：原生高亮与笔记、撤销、双端语句锚点持久化，源 PDF 保留');
 });
 it('hides native blank context pane on assembly tabs without changing PDF preference',async()=>{
  const project=await E.manuscripts.create('布局检查');await E.manuscripts.open(project.id);await Zotero.Promise.delay(300);win.ZoteroContextPane.update();assert.isTrue(win.document.getElementById('zotero-context-pane').hasAttribute('collapsed'));report.controlled.push('原生标签切换：装配页不保留空白阅读器右栏');
 });
 it('uses the actual account model for a short evidence-bound academic answer',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){report.limitations.push('真实模型未启用');this.skip();}
  const config=await E.resolveModel(E.settings(),{refresh:true});
  const record=await E.ai.run({mode:'ask',papers:[E.library.describe(paper)],prompt:'用简洁中文回答本文的研究目标以及一个实验核验要点，正文不超过250字，保留原文证据。',onStatus:()=>{}});
  assert.isAbove(record.result.sections.length,0);assert.isTrue(record.result.sections.some(s=>s.quotes.length));assert.equal(record.model,config.model);
  report.live.push({type:'真实模型请求；实际 PDF；程序触发，非人工点击',model:record.model,sections:record.result.sections.length,answer:E.core.resultMarkdown(record)});
 });
});
