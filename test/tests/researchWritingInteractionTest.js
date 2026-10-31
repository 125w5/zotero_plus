describe('Writing interaction acceptance',function(){
 this.timeout(300000);const R=Zotero.Research;let win,ui,p,frame,U,doc,note,folder;const report={dom:[],live:[],limitations:[]};
 const wait=async(fn,label='前台')=>{for(let i=0;i<1600;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待'+label+'超时');};
 const key=(node,value,extra={})=>node.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));
 const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 // Since 72474a0ab a collapsed conversation hides #ai and #ai-form behind a 30px
 // reveal strip above the footer; opening it restores the same form and textarea.
 const surface=()=>doc.getElementById('assembly-clui-surface'),revealStrip=()=>surface().querySelector('.clui-native-reveal'),footerBar=()=>surface().querySelector(':scope > footer');
 const hit=node=>{const r=node.getBoundingClientRect(),target=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);assert.isAbove(r.width,0);assert.isAbove(r.height,0);assert.isTrue(node===target||node.contains(target),'可见控件没有被遮挡');};
 const activateComposer=input=>{if(surface().dataset.cluiRetracted==='true')revealStrip().click();else input.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown',{bubbles:true}));input.focus();};
 function assertCollapsedComposer(input,form){
  const footer=footerBar(),ai=doc.getElementById('ai'),reveal=revealStrip(),fw=frame.contentWindow;
  assert.isFalse(U.p.ui.aiOpen);assert.equal(U.assemblyCLUI.mode,'compact');assert.isTrue(ai.inert);assert.equal(ai.getAttribute('aria-hidden'),'true');assert.equal(ai.getBoundingClientRect().height,0,'收起对话不占据第二行');
  assert.equal(surface().dataset.cluiRetracted,'true');assert.equal(fw.getComputedStyle(form).display,'none');assert.isTrue(form.inert,'收起后输入框不可聚焦');
  assert.equal(form.parentElement,footer,'输入节点仍在底栏，展开后原样恢复');assert.equal(doc.getElementById('ai-prompt'),input,'保留同一输入节点');
  assert.lengthOf(doc.querySelectorAll('#ai-form'),1);assert.lengthOf(doc.querySelectorAll('#ai-prompt'),1);
  assert.isAtMost(footer.getBoundingClientRect().height,60,'整个底栏只有一行');assert.isFalse(footer.inert,'收起不禁用非对话的底栏控件');
  const strip=reveal.getBoundingClientRect(),main=doc.querySelector('#workspace > main').getBoundingClientRect(),center=(strip.left+strip.right)/2;
  assert.isFalse(reveal.hidden);assert.closeTo(strip.height,30,1,'收起后只留30px唤起条');assert.isAtMost(strip.bottom,footer.getBoundingClientRect().top+1,'唤起条在底栏上方，不压住底栏');assert.isAtLeast(center,main.left);assert.isAtMost(center,main.right,'唤起条位于正文列');hit(reveal);
  assert.equal(fw.getComputedStyle(form.querySelector('.ai-collapsed-name')).display,'none','底栏不重复显示共创名称');
 }
 async function shot(name){const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();}
 before(async()=>{win=await loadZoteroPane();win.Zotero_Tabs.closeAll();await R.attachWindow(win);win.resizeTo(1560,1020);folder=PathUtils.join(Zotero.DataDirectory.dir,'writing-interaction');await IOUtils.makeDirectory(folder,{ignoreExisting:true});ui=await R.openWorkflow('writing');await R.preparePassageSearch();});
 after(async()=>{await R.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('creates by name, opens feasibility first, enters assembly explicitly',async()=>{
  // The create dialog appears after its domain modules load. Typing the name
  // infers the required first keyword. The workflow is embedded in the library,
  // so the feasibility stage opens as its project frame, not a separate tab.
  ui.show('writing');ui.$('new-manuscript').click();await wait(()=>ui.$('manuscript-name'),'新建论文对话框');const name=ui.$('manuscript-name'),form=name.closest('form'),view=name.ownerDocument.defaultView,workspace=win._researchLibraryWorkspace,title='交互与科研流程验收 '+Date.now();assert.notExists(ui.$('project-idea'));name.value=title;name.dispatchEvent(new view.Event('input',{bubbles:true}));assert.isNotEmpty(form.querySelector('[aria-label="新论文第一关键词"]').value,'名称推断出必填的第一关键词');form.requestSubmit([...form.querySelectorAll('button')].find(b=>b.textContent==='选择文献与讨论可行性'));await wait(()=>{p=Object.values(R.manuscripts.all()).find(p=>p.title===title);return p&&workspace.projectFrame?.projectID===p.id&&workspace.projectFrame.contentWindow?.NotebookUI?.ready&&!workspace.projectFrame.inert;},'文库内的可行性页面');note=workspace.projectFrame;assert.notExists(win.document.getElementById('manuscript-'+p.id));assert.isFalse(note.contentDocument.getElementById('evaluation').hidden);await shot('01-feasibility-stage.png');note.contentDocument.getElementById('back').click();await wait(()=>{frame=win.document.getElementById('manuscript-'+p.id);return frame?.contentWindow.ManuscriptUI?.ready;},'论文装配标签页');U=frame.contentWindow.ManuscriptUI;doc=frame.contentDocument;assert.equal(win.Zotero_Tabs.selectedType,'manuscript');report.dom.push('名称 → 可行性 → 用户进入装配');
 });
 it('shows real materials, removable filters, folded fulltext and correct active navigation',async()=>{
  const nav=doc.getElementById('left-tabs');nav.children[1].click();assert.equal(nav.querySelector('[aria-selected=true]').textContent,'论文结构');assert.lengthOf(nav.querySelectorAll('.active'),1);nav.children[0].click();assert.isAbove(doc.querySelectorAll('#material-results .material').length,0,'测试资料目录中需要已有素材');assert.isAtLeast(parseInt(doc.getElementById('left').style.width),380);assert.notMatch(doc.getElementById('material-results').textContent,/无期刊 IF|年份未标明/);
  // The assembly list shows the shared library; N.materials() is limited to the
  // project folder since 72474a0ab. Read the card's record the way the list does.
  const card=doc.querySelector('#material-results .material'),record=U.p.materials.find(m=>m.id===card.dataset.material)||R.manuscripts.asset(card.dataset.material);assert.exists(record,'素材卡对应素材库中的记录');const material=(R.manuscripts.filterAutomaticMaterials?.([record])||[record])[0];assert.include(card.title,R.manuscripts.summaryFor(material));
  // The assembly search box owns its browse query; a notebook query no longer
  // rewrites it (72474a0ab). Search the way a user does.
  assert.isNotEmpty(R.findPaperPassages('实验设置',{limit:30}),'测试资料目录中需要已解析、含“实验设置”的论文全文');const search=doc.getElementById('material-search');search.focus();search.value='实验设置';search.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await wait(()=>doc.querySelector('.fulltext-matches'),'折叠的全文命中');assert.isFalse(doc.querySelector('.fulltext-matches').open);const filters=doc.querySelector('#material-results .active-filters');assert.exists(filters,'搜索后显示可移除的筛选');button(filters,'清空').click();await wait(()=>!R.notebook.query(p.id)&&!U.materialQuery&&!search.value,'清空搜索与筛选');assert.isAbove(doc.querySelectorAll('#material-results .material').length,0);await shot('02-material-library.png');report.dom.push('既有真实素材、分类状态、悬停说明、清空查询、折叠全文');
 });
 it('starts collapsed to one reveal strip above a single footer row with no idle guidance or status strip',async()=>{
  if(U.p.ui.aiOpen)doc.getElementById('toggle-ai').click();await wait(()=>doc.getElementById('ai').hidden,'收起对话');
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form');assertCollapsedComposer(input,form);
  const recommendation=doc.getElementById('recommendation');assert.isTrue(recommendation.hidden);assert.isEmpty(recommendation.textContent);assert.equal(recommendation.getBoundingClientRect().height,0);
  await wait(()=>doc.getElementById('status').hidden,'闲置状态自动隐藏');assert.isTrue(doc.getElementById('ai-notice').hidden);
  report.dom.push('收起对话只留唤起条与一行底栏；无占位引导语或常驻闲置状态栏');
 });
 it('formats selected prose with Ctrl+B, undoes it and guards IME',async()=>{
  // A new project has no starter paragraph since 01213a348; add the first one.
  if(!U.p.blocks.length)await U.insertBlock('paragraph');const b=U.p.blocks[0];b.text='基线比较需要使用相同的数据划分。';b.emptyStarter=false;U.selectBlock(b.id);U.renderEditor();let node=doc.querySelector(`[data-id="${b.id}"] .editable`);node.focus();const range=doc.createRange();range.selectNodeContents(node);const selection=frame.contentWindow.getSelection();selection.removeAllRanges();selection.addRange(range);key(node,'b',{ctrlKey:true});assert.isTrue(U.p.blocks[0].runs.some(r=>r.bold));key(node,'z',{ctrlKey:true});assert.isFalse(U.p.blocks[0].runs?.some(r=>r.bold)||false);node=doc.querySelector(`[data-id="${b.id}"] .editable`);const count=U.p.blocks.length;key(node,'Enter',{ctrlKey:true,isComposing:true});assert.equal(U.p.blocks.length,count);report.dom.push('实际 Gecko 编辑选区 Ctrl+B/撤销；受控组合输入事件');
 });
 it('inserts by whitespace location, splits pages and zooms paper only',async()=>{
  const paper=doc.querySelector('.paper'),r=paper.getBoundingClientRect(),count=U.p.blocks.length;paper.dispatchEvent(new frame.contentWindow.MouseEvent('dblclick',{bubbles:true,clientX:r.left+100,clientY:r.top+330}));assert.equal(U.p.blocks.length,count+1);let b=U.p.blocks.find(b=>b.id===U.p.ui.blockID);assert.isAtLeast(b.spaceBefore,14);let node=doc.querySelector(`[data-id="${b.id}"] .editable`);node.focus();key(node,'Enter',{ctrlKey:true});assert.isTrue(U.p.blocks.some(b=>b.pageBreakBefore));assert.isAbove(doc.querySelectorAll('.paper').length,U.p.sections.length);doc.getElementById('canvas').dispatchEvent(new frame.contentWindow.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:100}));assert.equal(U.p.ui.paperZoom,.95);assert.equal(doc.getElementById('paper-zoom').textContent,'95%');report.dom.push('空白处双击、光标分页、Ctrl+滚轮局部缩放');
 });
 it('retracts the composer to the reveal strip, reopens the same input, restores draft and shows formula/table previews',async()=>{
  if(U.p.ui.aiOpen)doc.getElementById('toggle-ai').click();await wait(()=>doc.getElementById('ai').hidden,'收起对话');const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form');assertCollapsedComposer(input,form);activateComposer(input);assert.isTrue(U.p.ui.aiOpen);assert.isFalse(doc.getElementById('ai').hidden);assert.isTrue(revealStrip().hidden,'展开后隐藏唤起条');assert.isFalse(form.inert);assert.equal(form.parentElement,footerBar(),'展开后仍使用最底部的同一输入框');assert.equal(doc.activeElement,input,'展开后焦点仍在同一输入框');input.value='核对当前实验设计的可证伪性';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await U.persist();assert.equal(R.manuscripts.get(p.id).ui.aiDraft,input.value);await U.insertBlock('formula',{text:'E=mc^2'});assert.exists(doc.querySelector('#details .katex-display'));button(doc.getElementById('insert-tools'),'表格').click();doc.querySelector('#grid button[data-row="3"][data-col="3"]').click();assert.exists(doc.querySelector('#details .object-preview table'));await shot('03-editor-chat-preview.png');report.dom.push('收起为唤起条、展开恢复同一底部输入节点、输入焦点与草稿保留、公式表格实际预览');
 });
 it('keeps the coauthor composer aligned, supports newlines and preserves draft while choosing templates',async()=>{
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form'),history=doc.getElementById('ai-history');
  activateComposer(input);assert.equal(input.localName,'textarea');assert.isTrue(U.p.ui.aiOpen);
  const formRect=form.getBoundingClientRect(),historyRect=history.getBoundingClientRect();
  assert.equal(form.parentElement,footerBar());assert.isAbove(formRect.width,100);assert.isAtMost(formRect.right,frame.contentWindow.innerWidth);
  assert.isBelow(historyRect.bottom,formRect.bottom);
  let submissions=0;const intercept=e=>{e.preventDefault();e.stopImmediatePropagation();submissions++;};form.addEventListener('submit',intercept,true);
  try{key(input,'Enter',{shiftKey:true});key(input,'Enter',{isComposing:true});assert.equal(submissions,0);key(input,'Enter');assert.equal(submissions,1);}finally{form.removeEventListener('submit',intercept,true);}
  key(input,'Tab');assert.equal(doc.activeElement.dataset.template,'search');
  // Esc leaves one layer at a time: on a template it closes only the list and
  // returns focus to the input; the next Esc collapses the conversation. The
  // hidden input cannot keep focus, so focus then moves to the reveal strip.
  const draft=input.value;key(doc.activeElement,'Escape');assert.isTrue(form.querySelector('.prompt-templates').hidden,'Esc 关闭模板列表');assert.equal(doc.activeElement,input,'焦点回到输入框');assert.isTrue(U.p.ui.aiOpen,'同一次 Esc 不收起对话');assert.isTrue(revealStrip().hidden);assert.isFalse(form.inert);
  key(input,'Escape');await wait(()=>doc.getElementById('ai').hidden,'再按 Esc 收起对话');assertCollapsedComposer(input,form);assert.equal(doc.activeElement,revealStrip(),'收起后焦点在唤起条');assert.equal(input.value,draft);
  activateComposer(input);assert.isFalse(doc.getElementById('ai').inert);assert.equal(doc.activeElement,input);assert.equal(doc.getElementById('ai-prompt'),input);assert.equal(input.value,draft);
  input.value=draft+'\n请再核对控制变量。';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await U.persist();assert.equal(R.manuscripts.get(p.id).ui.aiDraft,input.value,'重新展开后仍能继续编辑并保存');
  await shot('06-coauthor-dock.png');report.dom.push('底栏输入不移位、对话向上展开、Enter 发送/Shift+Enter 换行/组词保护、Tab 模板、Esc 先关闭模板列表再收起为唤起条、草稿保留');
 });
 it('keeps the caret, draft and input handlers of the same composer when collapsing to the reveal strip',async()=>{
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form');activateComposer(input);
  const previous=input.value,draft='检查采集批次\n以及训练、验证、测试划分';
  try{
   input.value=draft;input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));input.setSelectionRange(2,6,'backward');
   doc.getElementById('collapse-chat').click();await wait(()=>doc.getElementById('ai').hidden,'收起对话');assertCollapsedComposer(input,form);
   assert.equal(doc.activeElement,revealStrip(),'收起后焦点移到唤起条，不留在隐藏的输入框');
   assert.equal(input.value,draft);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(input.selectionDirection,'backward');
   await Zotero.Promise.delay(50);assert.isFalse(U.p.ui.aiOpen,'收起时的焦点变化不能把对话重新展开');
   activateComposer(input);assert.isTrue(U.p.ui.aiOpen);assert.equal(doc.activeElement,input);assert.equal(input.value,draft);assert.equal(input.selectionStart,2,'从唤起条展开后恢复原选区');assert.equal(input.selectionEnd,6);assert.equal(input.selectionDirection,'backward');
   doc.getElementById('collapse-chat').click();await wait(()=>doc.getElementById('ai').hidden,'再次收起对话');
   input.value=draft+'\n补充独立随机种子。';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await U.persist();
   assert.isFalse(U.p.ui.aiOpen,'程序写入收起的输入框，不自动扩大面板');assertCollapsedComposer(input,form);
   assert.equal(R.manuscripts.get(p.id).ui.aiDraft,input.value,'展开收起后输入和保存监听仍然工作');
   activateComposer(input);assert.isTrue(U.p.ui.aiOpen);assert.equal(doc.activeElement,input);assert.equal(doc.getElementById('ai-form'),form);assert.equal(input.value,draft+'\n补充独立随机种子。');
   report.dom.push('实际DOM同一输入节点：收起为唤起条时保留草稿与选区，焦点移到唤起条且不自行重新展开；展开恢复选区，输入监听继续有效');
  }finally{input.value=previous;input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));await U.persist();}
 });
 it('keeps the reveal strip, footer controls and reopened input row inside one row at a narrower window width',async()=>{
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form'),wasOpen=U.p.ui.aiOpen;
  // Collapsed, only the non-chat footer controls remain beside the reveal strip;
  // the input and send button belong to the reopened row.
  const inRow=(ids,bounds,row=bounds)=>{for(const id of ids){
   const node=doc.getElementById(id),rect=node.getBoundingClientRect();assert.isAbove(rect.width,0,id+'保持可见');
   assert.isAtLeast(rect.left,bounds.left-1,id+'不越过左边界');assert.isAtMost(rect.right,bounds.right+1,id+'不越过右边界');
   assert.isAtLeast(rect.top,bounds.top-1,id+'不增加上方第二行');assert.isAtMost(rect.bottom,bounds.bottom+1,id+'不增加下方第二行');
   assert.isBelow(rect.top,row.bottom,id+'在同一行');assert.isAbove(rect.bottom,row.top,id+'在同一行');
  }};
  try{
   if(wasOpen)doc.getElementById('collapse-chat').click();win.resizeTo(1100,1020);await wait(()=>doc.getElementById('ai').hidden,'收起对话');await Zotero.Promise.delay(250);assertCollapsedComposer(input,form);
   const footer=footerBar();inRow(['check','save-status','paper-zoom'],footer.getBoundingClientRect());
   for(const id of ['toggle-ai','ai-form','ask-ai'])assert.equal(doc.getElementById(id).getBoundingClientRect().width,0,id+'收起时只由唤起条代表');
   assert.isAtMost(footer.scrollWidth,footer.clientWidth+1,'窄窗底栏不横向溢出');
   activateComposer(input);await Zotero.Promise.delay(300);assert.isTrue(U.p.ui.aiOpen);
   inRow(['toggle-ai','ai-form','ask-ai','check','save-status','paper-zoom'],footer.getBoundingClientRect(),form.getBoundingClientRect());
   assert.isAtMost(footer.scrollWidth,footer.clientWidth+1,'展开后窄窗底栏不横向溢出');
   report.dom.push('1100px窗口：收起时唤起条在底栏上方，核验、保存和缩放同排；展开后输入、发送、核验、保存和缩放同排且没有横向溢出');
  }finally{win.resizeTo(1560,1020);await Zotero.Promise.delay(100);if(wasOpen)activateComposer(input);}
 });
 it('keeps the conversation heading and input fixed while it scrolls, with the EasySch mark in both themes',async()=>{
  const fw=frame.contentWindow,appearance=fw.ResearchAppearance,previous=doc.getElementById('writing-appearance').value;
  const history=doc.getElementById('ai-history'),heading=doc.querySelector('.ai-heading'),form=doc.getElementById('ai-form');
  if(!U.p.ui.aiOpen){activateComposer(doc.getElementById('ai-prompt'));await Zotero.Promise.delay(300);}assert.isTrue(U.p.ui.aiOpen);
  // 01213a348 removed the EasySch wordmark from the conversation heading; the
  // assistant orb carries the brand mark.
  assert.notExists(heading.querySelector('.easysch-wordmark'));const mark=()=>doc.querySelector('#assembly-ai-orb .easysch-symbol');assert.exists(mark());
  const logo=new fw.Image();logo.src='chrome://zotero/content/research/brand/easysch-symbol-white.png';await logo.decode();assert.isAbove(logo.naturalWidth,200);
  try{
   for(const mode of ['light','dark']){
    appearance.set(mode);await Zotero.Promise.delay(250);assert.equal(fw.getComputedStyle(mark()).backgroundColor,mode==='light'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
    assert.equal(win.document.documentElement.dataset.easyschAppearance,mode);
    const top=heading.getBoundingClientRect().top,bottom=form.getBoundingClientRect().bottom,spacer=doc.createElement('div');spacer.style.height='800px';history.append(spacer);history.scrollTop=history.scrollHeight;
    assert.isAbove(history.scrollTop,0);assert.closeTo(heading.getBoundingClientRect().top,top,1);assert.closeTo(form.getBoundingClientRect().bottom,bottom,1);spacer.remove();
   }
  }finally{appearance.set(previous);}
  report.dom.push('EasySch 图形资源加载、研究助手标志日间黑/夜间白、对话滚动时标题和输入固定');
 });
 it('shows a pending conversation, prevents double send and keeps a newer draft',async()=>{
  // Since 01213a348 the composer sends through U.sendResearchMessage and
  // E.runWorkbenchTask; notebook.ask is only the fallback without the agent.
  const input=doc.getElementById('ai-prompt'),form=doc.getElementById('ai-form'),ask=R.notebook.ask,task=R.runWorkbenchTask,question='请检查实验设计中是否存在数据泄漏。';let resolveAnswer,calls=0;
  const pending=async()=>{calls++;return new Promise(resolve=>resolveAnswer=resolve);};R.runWorkbenchTask=pending;R.notebook.ask=pending;
  try{
   activateComposer(input);doc.getElementById('ai-mode').value='source';input.value=question;form.requestSubmit();await wait(()=>resolveAnswer&&doc.getElementById('chat').textContent.includes(question),'等待中的研究对话');
   assert.isTrue(doc.getElementById('ask-ai').disabled);assert.exists(doc.querySelector('.coauthor-activity'));assert.include(doc.getElementById('chat').textContent,question);form.requestSubmit();assert.equal(calls,1);
   input.value='下一步核对消融实验。';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
   resolveAnswer({text:'**受控界面验证示例**：按独立采集批次划分数据。\n\n| 检查项 | 待核对内容 |\n| --- | --- |\n| 数据划分 | 同源片段是否跨集合 |\n\n误差度量可写作：\n\n$$E=mc^2$$',sources:[]});await wait(()=>!U.aiSending);
   assert.equal(input.value,'下一步核对消融实验。');assert.isFalse(doc.getElementById('ask-ai').disabled);assert.notExists(doc.querySelector('.coauthor-activity'));assert.exists(doc.querySelector('#chat table'));assert.exists(doc.querySelector('#chat .katex-display'));
   assert.isBelow(doc.querySelector('.coauthor-message.from-user').getBoundingClientRect().width,doc.getElementById('chat').getBoundingClientRect().width*.7);
   doc.getElementById('collapse-chat').focus();await shot('07-coauthor-controlled-reply.png');
   const appearance=frame.contentWindow.ResearchAppearance,previous=doc.getElementById('writing-appearance').value;try{appearance.set('dark');await Zotero.Promise.delay(350);await shot('08-coauthor-dark.png');}finally{appearance.set(previous);}
   report.controlled||=[];report.controlled.push('受控回复：等待提示、重复发送防护、保留新草稿、中文 Markdown/表格/公式渲染');
  }finally{R.notebook.ask=ask;R.runWorkbenchTask=task;}
 });
 it('returns details to the selected editor object after previewing a material',async()=>{
  const card=doc.querySelector('#material-results .material');card.click();await wait(()=>U.previewMaterialID===card.dataset.material);
  const formula=U.p.blocks.find(b=>b.type==='formula');U.selectBlock(formula.id);assert.isNull(U.previewMaterialID);await wait(()=>R.notebook.state(p.id).selectedMaterial===null);assert.exists(doc.querySelector('#details .katex-display'));
  report.dom.push('素材预览之后选正文对象恢复右侧详情');
 });
 it('uses real network for distinct open paper pages and the visible search dialog',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();
  const q='automatic modulation classification',a=await R.searchPaperPage(q,{limit:20}),b=await R.searchPaperPage(q,{limit:20,provider:a.provider,page:2});assert.isAbove(a.records.length,5);assert.isAbove(b.records.length,0);assert.isTrue(a.records.every(r=>r.oa));assert.isTrue(b.records.some(r=>!a.records.some(x=>x.id===r.id)));report.live.push({kind:'真实 Zotero 进程联网分页',provider:a.provider,first:a.records.length,second:b.records.length,cache:[a.cacheHit,b.cacheHit],titles:a.records.slice(0,3).map(r=>r.title),limitations:a.limitations});
  await R.notebook.update(p.id,{query:q,view:'read'});await R.notebook.open(p.id,{host:'library'});await note.contentWindow.NotebookUI.browser.findOnline();assert.isAbove(note.contentDocument.querySelectorAll('.online-paper').length,5);await shot('04-open-paper-search.png');note.contentDocument.getElementById('paper-search-dialog').close();
 });
 it('runs the configured model and live closest-work retrieval for feasibility',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))this.skip();const nd=note.contentDocument;nd.getElementById('plan-tab').click();nd.getElementById('idea').value='评估少样本跨信道调制识别的可行性：比较域适应与域泛化，防止同一信号片段跨训练测试集泄漏，考虑噪声、信道偏移、基线公平性。尚无实测结果，数据、算力和周期都待补。';await note.contentWindow.NotebookUI.startAssessment();const v=R.notebook.state(p.id).versions.at(-1);assert.exists(v,nd.getElementById('status').textContent);assert.isAbove(v.sources.filter(s=>s.url).length,0);assert.isAbove(v.plan.closest.length,0);for(const e of v.plan.experiments)for(const k of ['preprocessing','leakage','baselines','ablations','robustness','reliability'])assert.isNotEmpty(e[k]);assert.isAbove(v.plan.pending.length,0);await shot('05-real-feasibility.png');report.live.push({kind:'真实模型和联网评估',model:v.model,version:v.id,cacheHit:v.cacheHit,sources:v.sources.map(s=>({title:s.title,url:s.url,coverage:s.coverage,metric:s.metric})),retrieval:v.retrieval});
 });
});
