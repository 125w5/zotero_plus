describe('Writing interaction acceptance',function(){
 this.timeout(300000);const R=Zotero.Research;let win,ui,p,frame,U,doc,note,folder;const report={dom:[],live:[],limitations:[]};
 const wait=async fn=>{for(let i=0;i<1600;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待前台超时');};
 const key=(node,value,extra={})=>node.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));
 const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 async function shot(name){const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();}
 before(async()=>{win=await loadZoteroPane();win.Zotero_Tabs.closeAll();await R.attachWindow(win);win.resizeTo(1560,1020);folder=PathUtils.join(Zotero.DataDirectory.dir,'writing-interaction');await IOUtils.makeDirectory(folder,{ignoreExisting:true});ui=await R.openWorkflow('writing');await R.preparePassageSearch();});
 after(async()=>{await R.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('creates by name, opens feasibility first, enters assembly explicitly',async()=>{
  ui.show('writing');ui.$('new-manuscript').click();assert.notExists(ui.$('project-idea'));ui.$('manuscript-name').value='交互与科研流程验收 '+Date.now();const title=ui.$('manuscript-name').value;ui.$('manuscript-name').closest('form').requestSubmit();await wait(()=>{p=Object.values(R.manuscripts.all()).find(p=>p.title===title);return p&&win.document.getElementById('research-notebook-'+p.id)?.contentWindow.NotebookUI?.ready;});note=win.document.getElementById('research-notebook-'+p.id);assert.notExists(win.document.getElementById('manuscript-'+p.id));assert.isFalse(note.contentDocument.getElementById('evaluation').hidden);await shot('01-feasibility-stage.png');note.contentDocument.getElementById('back').click();await wait(()=>{frame=win.document.getElementById('manuscript-'+p.id);return frame?.contentWindow.ManuscriptUI?.ready;});U=frame.contentWindow.ManuscriptUI;doc=frame.contentDocument;assert.equal(win.Zotero_Tabs.selectedType,'manuscript');report.dom.push('名称 → 可行性 → 用户进入装配');
 });
 it('shows real materials, removable filters, folded fulltext and correct active navigation',async()=>{
  const nav=doc.getElementById('left-tabs');nav.children[1].click();assert.equal(nav.querySelector('[aria-selected=true]').textContent,'☷ 论文结构');assert.lengthOf(nav.querySelectorAll('.active'),1);nav.children[0].click();assert.isAbove(doc.querySelectorAll('#material-results .material').length,0);assert.isAtLeast(parseInt(doc.getElementById('left').style.width),380);assert.notMatch(doc.getElementById('material-results').textContent,/无期刊 IF|年份未标明/);const card=doc.querySelector('.material');assert.include(card.title,R.manuscripts.summaryFor(R.notebook.materials(p.id).find(m=>m.id===card.dataset.material)));
  await R.notebook.update(p.id,{query:'实验设置'});await wait(()=>doc.querySelector('.fulltext-matches'));assert.isFalse(doc.querySelector('.fulltext-matches').open);button(doc,'清除筛选').click();await wait(()=>!R.notebook.query(p.id));assert.isAbove(doc.querySelectorAll('#material-results .material').length,0);await shot('02-material-library.png');report.dom.push('既有真实素材、分类状态、悬停说明、清除查询、折叠全文');
 });
 it('formats selected prose with Ctrl+B, undoes it and guards IME',async()=>{
  const b=U.p.blocks[0];b.text='基线比较需要使用相同的数据划分。';b.emptyStarter=false;U.selectBlock(b.id);U.renderEditor();let node=doc.querySelector(`[data-id="${b.id}"] .editable`);node.focus();const range=doc.createRange();range.selectNodeContents(node);const selection=frame.contentWindow.getSelection();selection.removeAllRanges();selection.addRange(range);key(node,'b',{ctrlKey:true});assert.isTrue(U.p.blocks[0].runs.some(r=>r.bold));key(node,'z',{ctrlKey:true});assert.isFalse(U.p.blocks[0].runs?.some(r=>r.bold)||false);node=doc.querySelector(`[data-id="${b.id}"] .editable`);const count=U.p.blocks.length;key(node,'Enter',{ctrlKey:true,isComposing:true});assert.equal(U.p.blocks.length,count);report.dom.push('实际 Gecko 编辑选区 Ctrl+B/撤销；受控组合输入事件');
 });
 it('inserts by whitespace location, splits pages and zooms paper only',async()=>{
  const paper=doc.querySelector('.paper'),r=paper.getBoundingClientRect(),count=U.p.blocks.length;paper.dispatchEvent(new frame.contentWindow.MouseEvent('dblclick',{bubbles:true,clientX:r.left+100,clientY:r.top+330}));assert.equal(U.p.blocks.length,count+1);let b=U.p.blocks.find(b=>b.id===U.p.ui.blockID);assert.isAtLeast(b.spaceBefore,14);let node=doc.querySelector(`[data-id="${b.id}"] .editable`);node.focus();key(node,'Enter',{ctrlKey:true});assert.isTrue(U.p.blocks.some(b=>b.pageBreakBefore));assert.isAbove(doc.querySelectorAll('.paper').length,U.p.sections.length);doc.getElementById('canvas').dispatchEvent(new frame.contentWindow.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:100}));assert.equal(U.p.ui.paperZoom,.95);assert.equal(doc.getElementById('paper-zoom').textContent,'95%');report.dom.push('空白处双击、光标分页、Ctrl+滚轮局部缩放');
 });
 it('keeps one composer row collapsed, restores draft and shows formula/table previews',async()=>{
  if(U.p.ui.aiOpen)doc.getElementById('toggle-ai').click();assert.isTrue(doc.getElementById('ai-history').hidden);assert.isFalse(doc.getElementById('ai').hidden);const input=doc.getElementById('ai-prompt');input.focus();input.dispatchEvent(new frame.contentWindow.FocusEvent('focus'));assert.isTrue(U.p.ui.aiOpen);input.value='核对当前实验设计的可证伪性';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await U.persist();assert.equal(R.manuscripts.get(p.id).ui.aiDraft,input.value);await U.insertBlock('formula',{text:'E=mc^2'});assert.exists(doc.querySelector('#details .katex-display'));button(doc.getElementById('insert-tools'),'表格').click();doc.querySelector('#grid button[data-row="3"][data-col="3"]').click();assert.exists(doc.querySelector('#details .object-preview table'));await shot('03-editor-chat-preview.png');report.dom.push('固定底部输入、收起/聚焦展开、草稿持久化、公式表格实际预览');
 });
 it('keeps the coauthor composer aligned, supports newlines and preserves draft while choosing templates',async()=>{
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form'),history=doc.getElementById('ai-history');
  input.focus();assert.equal(input.localName,'textarea');
  const formRect=form.getBoundingClientRect(),historyRect=history.getBoundingClientRect();
  assert.closeTo(formRect.width,historyRect.width,2);assert.isAtMost(formRect.width,1020);
  assert.isBelow(historyRect.bottom,formRect.bottom);
  let submissions=0;const intercept=e=>{e.preventDefault();e.stopImmediatePropagation();submissions++;};form.addEventListener('submit',intercept,true);
  try{key(input,'Enter',{shiftKey:true});key(input,'Enter',{isComposing:true});assert.equal(submissions,0);key(input,'Enter');assert.equal(submissions,1);}finally{form.removeEventListener('submit',intercept,true);}
  key(input,'Tab');assert.equal(doc.activeElement.dataset.template,'search');
  key(doc.activeElement,'Escape');assert.equal(doc.activeElement,input);assert.isTrue(form.querySelector('.prompt-templates').hidden);
  const draft=input.value;doc.getElementById('collapse-chat').click();assert.isTrue(history.hidden);assert.isAtMost(doc.getElementById('ai').getBoundingClientRect().height,66);assert.equal(input.value,draft);
  input.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown'));input.focus();assert.isFalse(history.hidden);assert.equal(input.value,draft);
  await shot('06-coauthor-dock.png');report.dom.push('共创输入与消息同宽、Enter 发送/Shift+Enter 换行/组词保护、Tab 模板、Esc 收起、草稿保留');
 });
 it('keeps the branded heading and input fixed while conversation scrolls in both themes',async()=>{
  const fw=frame.contentWindow,appearance=fw.ResearchAppearance,previous=doc.getElementById('writing-appearance').value;
  const history=doc.getElementById('ai-history'),heading=doc.querySelector('.ai-heading'),form=doc.getElementById('ai-form');
  assert.equal(doc.querySelector('.easysch-wordmark').textContent,'EasySch');
  const logo=new fw.Image();logo.src='chrome://zotero/content/research/brand/easysch-symbol-white.png';await logo.decode();assert.isAbove(logo.naturalWidth,200);
  try{
   for(const mode of ['light','dark']){
    appearance.set(mode);await Zotero.Promise.delay(250);assert.equal(fw.getComputedStyle(doc.querySelector('.easysch-symbol')).backgroundColor,mode==='light'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
    assert.equal(win.document.documentElement.dataset.easyschAppearance,mode);
    const top=heading.getBoundingClientRect().top,bottom=form.getBoundingClientRect().bottom,spacer=doc.createElement('div');spacer.style.height='800px';history.append(spacer);history.scrollTop=history.scrollHeight;
    assert.isAbove(history.scrollTop,0);assert.closeTo(heading.getBoundingClientRect().top,top,1);assert.closeTo(form.getBoundingClientRect().bottom,bottom,1);spacer.remove();
   }
  }finally{appearance.set(previous);}
  report.dom.push('EasySch 图形资源加载、日间黑/夜间白、对话滚动时标题和输入固定');
 });
 it('shows a pending conversation, prevents double send and keeps a newer draft',async()=>{
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form'),ask=R.notebook.ask;let resolveAnswer,calls=0;
  R.notebook.ask=async()=>{calls++;return new Promise(resolve=>resolveAnswer=resolve);};
  try{
   doc.getElementById('ai-mode').value='source';input.value='请检查实验设计中是否存在数据泄漏。';form.requestSubmit();await wait(()=>resolveAnswer);
   assert.isTrue(doc.getElementById('ask-ai').disabled);assert.exists(doc.querySelector('.coauthor-activity'));assert.include(doc.getElementById('chat').textContent,input.value);form.requestSubmit();assert.equal(calls,1);
   input.value='下一步核对消融实验。';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
   resolveAnswer({text:'**受控界面验证示例**：按独立采集批次划分数据。\n\n| 检查项 | 待核对内容 |\n| --- | --- |\n| 数据划分 | 同源片段是否跨集合 |\n\n误差度量可写作：\n\n$$E=mc^2$$',sources:[]});await wait(()=>!U.aiSending);
   assert.equal(input.value,'下一步核对消融实验。');assert.isFalse(doc.getElementById('ask-ai').disabled);assert.notExists(doc.querySelector('.coauthor-activity'));assert.exists(doc.querySelector('#chat table'));assert.exists(doc.querySelector('#chat .katex-display'));
   assert.isBelow(doc.querySelector('.coauthor-message.from-user').getBoundingClientRect().width,doc.getElementById('chat').getBoundingClientRect().width*.7);
   doc.getElementById('collapse-chat').focus();await shot('07-coauthor-controlled-reply.png');
   const appearance=frame.contentWindow.ResearchAppearance,previous=doc.getElementById('writing-appearance').value;try{appearance.set('dark');await Zotero.Promise.delay(350);await shot('08-coauthor-dark.png');}finally{appearance.set(previous);}
   report.controlled||=[];report.controlled.push('受控回复：等待提示、重复发送防护、保留新草稿、中文 Markdown/表格/公式渲染');
  }finally{R.notebook.ask=ask;}
 });
 it('returns details to the selected editor object after previewing a material',async()=>{
  const card=doc.querySelector('#material-results .material');card.click();await wait(()=>U.previewMaterialID===card.dataset.material);
  const formula=U.p.blocks.find(b=>b.type==='formula');U.selectBlock(formula.id);assert.isNull(U.previewMaterialID);await wait(()=>R.notebook.state(p.id).selectedMaterial===null);assert.exists(doc.querySelector('#details .katex-display'));
  report.dom.push('素材预览之后选正文对象恢复右侧详情');
 });
 it('uses real network for distinct open paper pages and the visible search dialog',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();
  const q='automatic modulation classification',a=await R.searchPaperPage(q,{limit:20}),b=await R.searchPaperPage(q,{limit:20,provider:a.provider,page:2});assert.isAbove(a.records.length,5);assert.isAbove(b.records.length,0);assert.isTrue(a.records.every(r=>r.oa));assert.isTrue(b.records.some(r=>!a.records.some(x=>x.id===r.id)));report.live.push({kind:'真实 Zotero 进程联网分页',provider:a.provider,first:a.records.length,second:b.records.length,cache:[a.cacheHit,b.cacheHit],titles:a.records.slice(0,3).map(r=>r.title),limitations:a.limitations});
  await R.notebook.update(p.id,{query:q,view:'read'});await R.notebook.open(p.id);await note.contentWindow.NotebookUI.browser.findOnline();assert.isAbove(note.contentDocument.querySelectorAll('.online-paper').length,5);await shot('04-open-paper-search.png');note.contentDocument.getElementById('paper-search-dialog').close();
 });
 it('runs the configured model and live closest-work retrieval for feasibility',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();const nd=note.contentDocument;nd.getElementById('plan-tab').click();nd.getElementById('idea').value='评估少样本跨信道调制识别的可行性：比较域适应与域泛化，防止同一信号片段跨训练测试集泄漏，考虑噪声、信道偏移、基线公平性。尚无实测结果，数据、算力和周期都待补。';await note.contentWindow.NotebookUI.startAssessment();const v=R.notebook.state(p.id).versions.at(-1);assert.exists(v,nd.getElementById('status').textContent);assert.isAbove(v.sources.filter(s=>s.url).length,0);assert.isAbove(v.plan.closest.length,0);for(const e of v.plan.experiments)for(const k of ['preprocessing','leakage','baselines','ablations','robustness','reliability'])assert.isNotEmpty(e[k]);assert.isAbove(v.plan.pending.length,0);await shot('05-real-feasibility.png');report.live.push({kind:'真实模型和联网评估',model:v.model,version:v.id,cacheHit:v.cacheHit,sources:v.sources.map(s=>({title:s.title,url:s.url,coverage:s.coverage,metric:s.metric})),retrieval:v.retrieval});
 });
});
