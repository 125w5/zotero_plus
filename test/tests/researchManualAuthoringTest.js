/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Manual manuscript authoring and restricted research assistance', function () {
 this.timeout(180000);
 const R=Zotero.Research;let win,frame,ui,folder,projectID,disposeFocusDiagnostics,savedModels;
 const report={type:'真实 Zotero DOM；顺序建议、模型列表、回复、键盘与拖动事件受控，未调用真实模型，不代表真人鼠标操作',checks:[]};
 const wait=async(fn,label='装配界面')=>{for(let i=0;i<600;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待'+label+'超时');};
 const doc=()=>frame.contentDocument;
 const event=(node,name,options={})=>node.dispatchEvent(new frame.contentWindow.Event(name,{bubbles:true,cancelable:true,...options}));
 const key=(node,name,options={})=>{const event=new frame.contentWindow.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...options});node.dispatchEvent(event);return event;};
 const documentData=()=>JSON.stringify({sections:ui.p.sections,blocks:ui.p.blocks,materials:ui.p.materials});
 const prose=()=>JSON.stringify(ui.p.blocks.map(b=>({id:b.id,text:b.text,runs:b.runs,sectionID:b.sectionID,materials:b.materials,table:b.table,imagePath:b.imagePath})).sort((a,b)=>a.id.localeCompare(b.id)));
 const dragSharedHeaderOut=async surface=>{
  const root=surface.root,fw=frame.contentWindow,captures=new Set(),prior={set:root.setPointerCapture,has:root.hasPointerCapture,release:root.releasePointerCapture};root.setPointerCapture=id=>captures.add(id);root.hasPointerCapture=id=>captures.has(id);root.releasePointerCapture=id=>captures.delete(id);
  const pointer=(target,type,x,y)=>target.dispatchEvent(new fw.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:81,button:0,clientX:x,clientY:y}));
  try{const r=surface.header.getBoundingClientRect(),x=fw.innerWidth/2,y=r.top+100;pointer(surface.header,'pointerdown',r.left+r.width/2,r.top+12);pointer(root,'pointermove',x,y);assert.equal(root.dataset.dragging,'true');pointer(root,'pointerup',x,y);await wait(()=>surface.docked===null&&!ui.aiOrb.button.hidden,'受控标题拖出后恢复Logo');assert.equal(root.dataset.dock,'floating');assert.equal(ui.aiOrb.button.dataset.conversationDocked,'false');}
  finally{root.setPointerCapture=prior.set;root.hasPointerCapture=prior.has;root.releasePointerCapture=prior.release;}
 };
 const proposal=()=>({kind:'layout',id:'layout-controlled-'+Date.now(),projectID:ui.p.id,baseRevision:ui.p.revision,documentSnapshot:documentData(),sectionOrder:ui.p.sections.map(s=>s.id).reverse(),blockOrder:ui.p.blocks.map(b=>b.id).reverse(),materialOrder:ui.p.materials.map(m=>m.id).reverse(),reasons:[{targetID:ui.p.sections[0].id,reason:'将研究问题放在验证条件之前；不增加正文。'}],status:'pending'});
 before(async()=>{
  savedModels=R.workbenchModels;R.workbenchModels=async()=>[{id:'controlled-model',label:'受控模型'}];
  win=await loadZoteroPane();win.Zotero_Tabs.closeAll();await R.attachWindow(win);win.resizeTo(1450,1000);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'manual-authoring-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const p=await R.manuscripts.create('手工写作与顺序整理验收 '+Date.now());projectID=p.id;await R.manuscripts.open(p.id);
  await wait(()=>{frame=win.document.getElementById('manuscript-'+p.id);ui=frame?.contentWindow.ManuscriptUI;return ui?.ready;});
  ui.p.sections=ui.p.sections.slice(0,2);const material=ui.M.material({title:'卷积神经网络验证记录',kind:'experiment',sourceText:'用户记录：检查 CNN 在跨域数据上的验证条件。',summary:'检查卷积神经网络的跨域验证条件。'});
  const second=ui.M.material({title:'第二份人工笔记',kind:'note',sourceText:'用户记录：检查数据划分与泄漏。',summary:'记录数据划分与防泄漏检查。'});ui.p.materials=[material,second];ui.p.blocks=[ui.M.block('paragraph',ui.p.sections[0].id,{text:'用户正文：CNN 的验证条件。',runs:[{text:'用户正文：',bold:true},{text:'CNN 的验证条件。'}],materials:[{id:material.id,role:'primary',revision:material.revision}]}),ui.M.block('paragraph',ui.p.sections[0].id,{text:'第二段保留原来的数字 95%。'}),ui.M.block('formula',ui.p.sections[1].id,{text:'x_{i}^{2} = 1'})];
  ui.p.ui.sectionID=ui.p.sections[0].id;ui.p.ui.blockID=ui.p.blocks[0].id;ui.p.ui.catalog={topic:'',type:'',sort:'relevance',selection:[]};ui.changed({editor:true});await ui.persist();
 });
 beforeEach(async()=>{
  // A failed key test must not leave subsequent focus tests in a hidden tab.
  // These are real deck/DOM checks rather than fabricated activeElement state.
  win.Zotero_Tabs.select(frame.parentElement.id);win.focus();frame.contentWindow.focus();await Zotero.Promise.delay(150);
  assert.equal(win.Zotero_Tabs.selectedType,'manuscript');assert.strictEqual(win.Zotero_Tabs.deck.selectedPanel,frame.parentElement);
  assert.isAbove(frame.getBoundingClientRect().height,300,'装配 iframe 必须在实际前台可见');
  report.focusContexts||=[];report.focusContexts.push({at:Date.now(),outerHasFocus:win.document.hasFocus(),frameHasFocus:doc().hasFocus(),outerActive:win.document.activeElement?.id,frameActive:doc().activeElement?.id,aiOpen:ui.p.ui.aiOpen,collapsingAI:!!ui.collapsingAI});
  assert.isTrue(doc().hasFocus(),'装配文档须真正获得窗口焦点；activeElement 单独变化不代表 focus/blur 已派发');
 });
 afterEach(async function(){disposeFocusDiagnostics?.();disposeFocusDiagnostics=null;report.tests||=[];report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{await R.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();R.workbenchModels=savedModels;});
 it('keeps manual rich text and removes manuscript-writing/image-generation controls',async()=>{
  const text=doc().getElementById('details').textContent;
  for(const label of ['补全当前段落','润色','扩写','精简','翻译'])assert.notInclude(text,label);
  const modes=[...doc().getElementById('ai-mode').options].map(o=>o.value);assert.notInclude(modes,'write');assert.include(modes,'organize');
  const editor=doc().querySelector('.editable');assert.exists(editor.querySelector('strong'));assert.include(editor.textContent,'CNN');
  await R.notebook.open(projectID);await wait(()=>win.document.getElementById('research-notebook-'+projectID)?.contentWindow.NotebookUI?.ready);
  const notebook=win.document.getElementById('research-notebook-'+projectID);assert.notExists(notebook.contentDocument.getElementById('generate-image'));
  assert.notInclude([...notebook.contentDocument.getElementById('ai-mode').options].map(o=>o.value),'write');
  win.Zotero_Tabs.select(frame.parentElement.id);report.checks.push('保留人工正文与富文本；装配及素材库不提供 AI 写作或生图入口');
 });
 it('Ctrl+Tab looks up local evidence without a manuscript model call or text mutation',async()=>{
  const originalCoauthor=ui.A.coauthor,originalRewrite=ui.A.rewrite;let calls=0;ui.A.coauthor=ui.A.rewrite=()=>{calls++;throw Error('不应调用正文模型');};
  try{
   const before=prose(),editor=doc().querySelector('.editable');editor.focus();assert.strictEqual(doc().activeElement,editor);key(editor,'Tab',{ctrlKey:true});assert.equal(win.Zotero_Tabs.selectedType,'manuscript','编辑器 Ctrl+Tab 不允许切换 Zotero 标签');await wait(()=>doc().getElementById('material-search')?.value.includes('CNN'),'Ctrl+Tab 素材查询');
   assert.equal(calls,0);assert.equal(prose(),before);assert.equal(ui.p.ui.left,'materials');assert.isFalse(ui.$('left').hidden);
   const query=ui.materialQuery;editor.focus();key(editor,'Tab',{ctrlKey:true,isComposing:true});await Zotero.Promise.delay(200);assert.equal(ui.materialQuery,query);assert.equal(prose(),before);
   report.checks.push('Ctrl+Tab 实际检索当前正文相关素材；中文组词不触发；正文模型调用 0 次');
  }finally{ui.A.coauthor=originalCoauthor;ui.A.rewrite=originalRewrite;}
 });
 it('previews a controlled layout proposal and applies one undo transaction preserving every text/source',async()=>{
  const original=ui.A.organize,order=ui.p.blocks.map(b=>b.id),sections=ui.p.sections.map(s=>s.id),before=prose();let requested=0;
  ui.A.organize=async()=>{requested++;return proposal();};
  try{
   const sessionID=ui.conversationSession.id,legacyChat=JSON.stringify(ui.p.chat),messageCount=ui.conversationSession.messages.length;
   await ui.organizeLayout('检查现有章节与段落顺序');assert.equal(requested,1);assert.equal(prose(),before);assert.deepEqual(JSON.parse(JSON.stringify(ui.p.blocks.map(b=>b.id))),order);
   const messages=R.workbenchConversations.get(sessionID).messages;assert.equal(messages.length,messageCount+2);assert.equal(messages.at(-2).role,'user');assert.equal(messages.at(-2).text,'检查现有章节与段落顺序');assert.equal(messages.at(-1).role,'assistant');assert.equal(messages.at(-1).layoutProposalID,ui.p.proposals.at(-1).id);assert.equal(JSON.stringify(ui.p.chat),legacyChat,'顺序整理只向共享会话写消息，不分叉到历史p.chat');
   const apply=[...ui.$('diff').querySelectorAll('button')].find(b=>b.textContent==='应用顺序');assert.exists(apply);apply.click();
   await wait(()=>ui.p.sections[0].id===sections.at(-1));assert.equal(ui.p.ui.catalog.sort,'manual');assert.deepEqual(JSON.parse(JSON.stringify(ui.p.materialCatalog.orders[ui.p.id+'|'].filter(id=>ui.p.materials.some(m=>m.id===id)))),ui.p.materials.map(m=>m.id));assert.equal(prose(),before);assert.notDeepEqual(JSON.parse(JSON.stringify(ui.p.blocks.map(b=>b.id))),order);
   const editor=doc().querySelector('.editable');editor.focus();key(editor,'z',{ctrlKey:true});await wait(()=>ui.p.sections[0].id===sections[0]);
   assert.deepEqual(JSON.parse(JSON.stringify(ui.p.blocks.map(b=>b.id))),order);assert.equal(prose(),before);
   report.checks.push('受控顺序建议先预览后确认；单次 Ctrl+Z 恢复；文字、公式、格式、素材 ID 与归属不变');
  }finally{ui.A.organize=original;}
 });
 it('keeps Enter inside a material and lets a blank paper double click create the following paragraph',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),fw=frame.contentWindow,material=ui.p.materials[0],b=ui.M.block('paragraph',ui.p.sections[0].id,{text:'人工记录的第一行',assembly:true,materials:[{id:material.id,role:'primary',revision:material.revision}]});
  try{
   ui.p.blocks=[b];ui.previewMaterialID=null;ui.p.ui.blockID=b.id;ui.changed({editor:true});const node=doc().querySelector(`[data-id="${b.id}"] .editable`),source=JSON.stringify(ui.p.materials);node.focus();const range=doc().createRange();range.selectNodeContents(node);range.collapse(false);fw.getSelection().removeAllRanges();fw.getSelection().addRange(range);
   assert.notExists(doc().querySelector('.after-material'),'素材下面不新增专用写正文按钮');const entered=key(node,'Enter');assert.isTrue(entered.defaultPrevented);assert.lengthOf(ui.p.blocks,1);assert.equal(ui.p.blocks[0].id,b.id);assert.include(b.text,'\n');assert.equal(JSON.stringify(ui.p.materials),source);assert.equal(b.materials[0].id,material.id);
   const paper=node.closest('.paper'),rect=node.closest('.block').getBoundingClientRect();paper.dispatchEvent(new fw.MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:rect.left+20,clientY:rect.bottom+36}));assert.lengthOf(ui.p.blocks,2);assert.equal(ui.p.blocks[0].id,b.id);assert.equal(ui.p.blocks[1].type,'paragraph');assert.equal(ui.p.blocks[1].text,'');assert.isEmpty(ui.p.blocks[1].materials);assert.equal(JSON.stringify(ui.p.materials),source);assert.strictEqual(doc().activeElement,doc().querySelector(`[data-id="${ui.p.blocks[1].id}"] .editable`));
   report.checks.push('真实编辑DOM/受控Enter与纸面双击：素材内换行不新建框，卡片下面空白双击新正文；来源ID与素材文本不变');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('removes only empty instances with Delete or Backspace and never deletes a nonempty paragraph at its end',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),fw=frame.contentWindow,material=ui.p.materials[0];
  try{
   for(const name of ['Delete','Backspace'])for(const assembly of [false,true]){
    const b=ui.M.block('paragraph',ui.p.sections[0].id,{assembly,materials:assembly?[{id:material.id,role:'primary',revision:material.revision}]:[]});ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.previewMaterialID=null;ui.changed({editor:true});const source=JSON.stringify(ui.p.materials),node=doc().querySelector(`[data-id="${b.id}"] .editable`);node.focus();assert.isTrue(key(node,name).defaultPrevented);assert.isEmpty(ui.p.blocks,'空章节不在渲染时再造一个已删除的框');assert.equal(JSON.stringify(ui.p.materials),source);key(ui.$('canvas'),'z',{ctrlKey:true});assert.lengthOf(ui.p.blocks,1);assert.equal(ui.p.blocks[0].id,b.id);assert.equal(JSON.stringify(ui.p.materials),source);
   }
   const b=ui.M.block('paragraph',ui.p.sections[0].id,{text:'内容仍在，末尾 Delete 不删除内容框',assembly:true,materials:[{id:material.id,role:'primary',revision:material.revision}]});ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.changed({editor:true});const node=doc().querySelector(`[data-id="${b.id}"] .editable`);node.focus();const range=doc().createRange();range.selectNodeContents(node);range.collapse(false);fw.getSelection().removeAllRanges();fw.getSelection().addRange(range);assert.isFalse(key(node,'Delete').defaultPrevented);assert.equal(ui.p.blocks[0].id,b.id);assert.equal(ui.p.blocks[0].text,b.text);assert.lengthOf(ui.p.blocks,1);
   report.checks.push('真实DOM/受控Delete与Backspace：空正文/素材实例删除与单次撤销，不删除原素材；非空末尾Delete留给文字编辑');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('uses the manual toolbar on preserved selections and persists font, marks, scripts and color',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),fw=frame.contentWindow,b=ui.M.block('paragraph',ui.p.sections[0].id,{text:'人工格式验证'});
  try{
   ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.previewMaterialID=null;ui.undo=[];ui.redo=[];ui.changed({editor:true});const toolbar=doc().querySelector('.manual-writing-toolbar'),node=doc().querySelector(`[data-id="${b.id}"] .editable`);assert.exists(toolbar);assert.equal(toolbar.getAttribute('role'),'toolbar');assert.lengthOf(toolbar.querySelectorAll('.writing-format-group'),4);for(const control of toolbar.querySelectorAll('button')){assert.exists(control.querySelector('svg'));assert.isNotEmpty(control.getAttribute('aria-label'));assert.equal(control.querySelector('svg').getAttribute('aria-hidden'),'true');}assert.exists(toolbar.querySelector('[data-writing-command="fontSize"]'),'字号支持编辑、保存和 DOCX 导出');
   const choose=()=>{node.focus();const range=doc().createRange();range.selectNodeContents(node);fw.getSelection().removeAllRanges();fw.getSelection().addRange(range);event(doc(),'selectionchange');};const control=name=>toolbar.querySelector(`[data-writing-command="${name}"]`);
   for(const [name,mark]of [['bold','bold'],['italic','italic'],['underline','underline']]){choose();assert.equal(toolbar.dataset.selection,'text');assert.isFalse(control(name).disabled);assert.isNotEmpty(control(name).title);control(name).click();assert.isTrue(b.runs.some(run=>run[mark]&&run.text.includes('人工')));assert.equal(control(name).getAttribute('aria-pressed'),'true');}
   choose();control('superscript').click();assert.isTrue(b.runs.some(run=>run.sup));choose();control('subscript').click();assert.isTrue(b.runs.some(run=>run.sub));
   choose();const font=control('fontName');font.focus();font.value='Arial';event(font,'change');assert.isTrue(b.runs.some(run=>run.fontFamily==='Arial'));
   choose();const color=control('foreColor');color.focus();color.value='#225588';event(color,'change');assert.isTrue(b.runs.some(run=>['#225588','rgb(34, 85, 136)'].includes(run.color)));assert.equal(b.text,'人工格式验证');
   const formatted=JSON.stringify(b.runs);control('undo').click();assert.notEqual(JSON.stringify(ui.p.blocks[0].runs),formatted);control('redo').click();assert.equal(JSON.stringify(ui.p.blocks[0].runs),formatted);await ui.persist();assert.equal(JSON.stringify(R.manuscripts.get(projectID).blocks[0].runs),formatted);
   ui.renderEditor();const restored=doc().querySelector(`[data-id="${b.id}"] .editable`);assert.exists(restored.querySelector('strong'));assert.exists(restored.querySelector('em'));assert.exists(restored.querySelector('u'));assert.exists(restored.querySelector('sub'));assert.include(restored.textContent,'人工格式验证');
   report.checks.push('真实execCommand与控件焦点：工具栏恢复所选正文，B/I/U/上下标/字体/颜色写入runs并持久化、重绘、撤销重做；无模型调用');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('persists paragraph alignment and inherits it through Enter and an explicit page break',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),fw=frame.contentWindow,b=ui.M.block('paragraph',ui.p.sections[0].id,{text:'对齐仍保留原来的证据',runs:[{text:'对齐仍保留原来的证据',bold:true}],materials:[{id:ui.p.materials[0].id,revision:ui.p.materials[0].revision}]});
  try{
   ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.previewMaterialID=null;ui.changed({editor:true});let node=doc().querySelector(`[data-id="${b.id}"] .editable`);const source=JSON.stringify(b.materials),text=b.text;
   const choose=(editable,offset)=>{editable.focus();const range=doc().createRange();range.selectNodeContents(editable);if(offset!==undefined){const walker=doc().createTreeWalker(editable,fw.NodeFilter.SHOW_TEXT),leaf=walker.nextNode();range.setStart(leaf,offset);range.collapse(true);}fw.getSelection().removeAllRanges();fw.getSelection().addRange(range);event(doc(),'selectionchange');};
   for(const alignment of ['left','center','right','justify']){choose(node);const control=doc().querySelector(`[data-writing-command="align-${alignment}"]`);assert.isFalse(control.disabled);control.click();assert.equal(b.textAlign,alignment);assert.equal(fw.getComputedStyle(node).textAlign,alignment);assert.equal(control.getAttribute('aria-pressed'),'true');assert.equal(b.text,text);assert.equal(JSON.stringify(b.materials),source);assert.exists(node.querySelector('strong'));}
   choose(node);assert.isTrue(key(node,'e',{ctrlKey:true}).defaultPrevented);assert.equal(b.textAlign,'center');assert.isFalse(key(node,'j',{ctrlKey:true,isComposing:true}).defaultPrevented);assert.equal(b.textAlign,'center','输入法组词不触发段落快捷键');assert.isTrue(key(node,'j',{ctrlKey:true}).defaultPrevented);assert.equal(b.textAlign,'justify');
   await ui.persist();assert.equal(R.manuscripts.get(projectID).blocks[0].textAlign,'justify');ui.renderEditor();node=doc().querySelector(`[data-id="${b.id}"] .editable`);assert.equal(fw.getComputedStyle(node).textAlign,'justify');
   choose(node,4);key(node,'Enter');assert.lengthOf(ui.p.blocks,2);assert.isTrue(ui.p.blocks.every(block=>block.textAlign==='justify'));assert.equal(ui.p.blocks[0].text+ui.p.blocks[1].text,text);assert.equal(JSON.stringify(ui.p.blocks[0].materials),source);
   const tail=ui.p.blocks[1],editor=doc().querySelector(`[data-id="${tail.id}"] .editable`);choose(editor,2);const button=doc().querySelector('[data-writing-command="pageBreak"]');button.click();assert.lengthOf(ui.p.blocks,3);assert.isTrue(ui.p.blocks[2].pageBreakBefore);assert.isTrue(ui.p.blocks.every(block=>block.textAlign==='justify'));assert.equal(ui.p.blocks.map(block=>block.text).join(''),text);key(ui.$('canvas'),'z',{ctrlKey:true});assert.lengthOf(ui.p.blocks,2);assert.isTrue(ui.p.blocks.every(block=>block.textAlign==='justify'));
   report.checks.push('真实段落控件/受控点击与Enter：四种对齐写入模型和实际CSS，重绘保持，普通拆段/手工分页继承，正文runs及源关联不改；分页可撤销');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('opens an editable formula on insertion and double click without rebuilding the focused input',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),fw=frame.contentWindow;
  try{
   ui.previewMaterialID=null;ui.p.ui.rightOpen=false;ui.applyPanels();await ui.insertBlock('formula');const b=ui.p.blocks.find(block=>block.id===ui.p.ui.blockID),input=doc().querySelector(`[data-id="${b.id}"] .formula-inline-input`),sideInput=doc().querySelector('#details .formula-latex-input');assert.exists(input);assert.exists(sideInput,'侧栏仍保留对应的可编辑公式控件');assert.isFalse(sideInput.disabled);assert.isTrue(ui.$('right').hidden,'插入公式不强制展开右栏');assert.isFalse(input.hidden);assert.strictEqual(doc().activeElement,input);assert.notExists(doc().querySelector('.formula-empty .katex'),'空公式不伪装成方框数学式');
   input.value='x_{i}^{2}=\\frac{1}{2}';event(input,'input');await wait(()=>b.text===input.value&&doc().querySelector(`[data-id="${b.id}"] .manuscript-formula-preview .katex`),'公式原位保存与实时预览');assert.strictEqual(doc().querySelector(`[data-id="${b.id}"] .formula-inline-input`),input);assert.strictEqual(doc().activeElement,input);assert.strictEqual(doc().querySelector('#details .formula-latex-input'),sideInput);assert.equal(sideInput.value,input.value);
   input.value='E=mc^{2}';event(input,'input');assert.equal(b.text,'E=mc^{2}');assert.equal(sideInput.value,b.text);key(input,'Enter',{ctrlKey:true});assert.isTrue(input.hidden);const view=doc().querySelector(`[data-id="${b.id}"] .formula-typeset`);view.dispatchEvent(new fw.MouseEvent('dblclick',{bubbles:true,cancelable:true}));await wait(()=>doc().activeElement===input&&!input.hidden,'双击纸面公式原位编辑');assert.equal(input.value,'E=mc^{2}');assert.isTrue(ui.$('right').hidden);assert.strictEqual(doc().querySelector(`[data-id="${b.id}"] .formula-inline-input`),input);
   await ui.persist();assert.equal(R.manuscripts.get(projectID).blocks.find(block=>block.id===b.id).text,'E=mc^{2}');
   report.checks.push('真实公式组件/KaTeX与受控输入、双击：插入和双击在纸面原位编辑，实时保存预览不重建输入，隐藏侧栏控件同步LaTeX且不强制展开；未做OCR编造');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('keeps table cells directly editable and saves actual rows rather than a picture of a table',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),b=ui.M.block('table',ui.p.sections[0].id,{table:ui.M.makeTable(2,2)});
  try{
   ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.previewMaterialID=null;ui.changed({editor:true});const cell=doc().querySelector(`[data-id="${b.id}"] [data-row="1"][data-col="0"] .cell-editor`);cell.click();cell.focus();assert.equal(cell.contentEditable,'true');event(cell,'beforeinput');cell.textContent='独立设备测试集';event(cell,'input');assert.equal(b.table.rows[1][0].text,'独立设备测试集');await ui.persist();assert.equal(R.manuscripts.get(projectID).blocks[0].table.rows[1][0].text,'独立设备测试集');key(cell,'z',{ctrlKey:true});assert.equal(ui.p.blocks[0].table.rows[1][0].text,'');key(ui.$('canvas'),'y',{ctrlKey:true});assert.equal(ui.p.blocks[0].table.rows[1][0].text,'独立设备测试集');
   report.checks.push('真实表格DOM/受控文本：直接编辑单元格、持久化结构化行列、Ctrl+Z/Y恢复；保留可编辑表格而非截图');
  }finally{ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('keeps edited, merged and deleted table run text synchronized with the actual cell and preserves undo',async()=>{
  const previous=ui.M.clone(ui.p),undo=ui.undo.slice(),redo=ui.redo.slice(),b=ui.M.block('table',ui.p.sections[0].id,{table:ui.M.makeTable(2,2)}),tex='$E_{\\mathrm{F}}=x_i^2$';
  b.table.rows[1][0].text='准确率 91%';b.table.rows[1][0].runs=[{text:'准确率 91%',bold:true}];b.table.rows[1][1].text=tex;b.table.rows[1][1].runs=[{text:tex,italic:true}];
  const cellAt=(r,c)=>doc().querySelector(`[data-id="${b.id}"] [data-row="${r}"][data-col="${c}"] .cell-editor`),same=cell=>assert.equal((cell.runs||[]).map(run=>run.text).join(''),cell.text);
  try{ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.previewMaterialID=null;ui.p.ui.rightOpen=true;ui.applyPanels();ui.changed({editor:true});const input=cellAt(1,0);assert.exists(input.querySelector('strong'),'原单元格格式实际显示');assert.exists(cellAt(1,1).querySelector('em'));input.focus();event(input,'beforeinput');input.querySelector('strong span').textContent='准确率 93%';event(input,'input');same(b.table.rows[1][0]);assert.equal(b.table.rows[1][0].text,'准确率 93%');assert.isTrue(b.table.rows[1][0].runs[0].bold);await ui.persist();same(R.manuscripts.get(projectID).blocks[0].table.rows[1][0]);
   ui.selectedCells=[{r:1,c:0},{r:1,c:1}];const merge=[...ui.$('details').querySelectorAll('button')].find(button=>button.textContent==='合并单元格');assert.exists(merge);merge.click();assert.equal(b.table.rows[1][0].text,'准确率 93% '+tex);same(b.table.rows[1][0]);assert.isTrue(b.table.rows[1][0].runs.some(run=>run.bold));assert.isTrue(b.table.rows[1][0].runs.some(run=>run.italic&&run.text===tex));key(ui.$('canvas'),'z',{ctrlKey:true});assert.equal(ui.p.blocks[0].table.rows[1][0].text,'准确率 93%');assert.equal(ui.p.blocks[0].table.rows[1][1].text,tex);
   ui.selectedCells=[{r:1,c:0},{r:1,c:1}];key(cellAt(1,0),'Delete');for(const cell of ui.p.blocks[0].table.rows[1]){assert.equal(cell.text,'');assert.deepEqual(JSON.parse(JSON.stringify(cell.runs)),[]);}await ui.persist();for(const cell of R.manuscripts.get(projectID).blocks[0].table.rows[1])same(cell);key(ui.$('canvas'),'z',{ctrlKey:true});for(const cell of ui.p.blocks[0].table.rows[1])same(cell);assert.equal(ui.p.blocks[0].table.rows[1][1].text,tex);report.checks.push('真实表格DOM：富文本输入、合并与Delete同步实际cell.text/runs；持久化和撤销保留正确文本、格式和LaTeX');
  }finally{ui.selectedCells=[];ui.p=previous;ui.undo=undo;ui.redo=redo;ui.changed({editor:true});await ui.persist();}
 });
 it('rejects stale layout and cannot accept old prose proposals or copy AI plans into body',async()=>{
  const plan=proposal();ui.showLayoutProposal(plan);const block=ui.p.blocks.find(b=>b.type==='paragraph'),editor=doc().querySelector(`[data-id="${block.id}"] .editable`);
  event(editor,'beforeinput');editor.textContent+=' 用户新修改';event(editor,'input');const after=prose(),order=ui.p.blocks.map(b=>b.id);
  [...ui.$('diff').querySelectorAll('button')].find(b=>b.textContent==='应用顺序').click();await wait(()=>ui.$('status').classList.contains('error'));
  assert.equal(prose(),after);assert.deepEqual(JSON.parse(JSON.stringify(ui.p.blocks.map(b=>b.id))),order);
  const old={id:'old-prose',blockID:block.id,before:block.text,after:'旧 AI 自动撰写正文',status:'pending',evidence:[]};ui.showDiff(old);
  assert.notInclude(ui.$('diff').textContent,'确认应用');assert.equal(prose(),after);
  const artifact=ui.M.material({title:'已确认的实验方案',kind:'idea',artifactID:'artifact-controlled',sourceText:'这是 AI 生成的实验计划，不是论文正文。'});ui.p.materials.push(artifact);ui.insertMaterial(artifact);
  const inserted=ui.p.blocks.find(b=>b.id===ui.p.ui.blockID);assert.equal(inserted.text,'');assert.equal(inserted.materials[0].id,artifact.id);assert.equal(inserted.artifactID,artifact.artifactID);
  report.checks.push('继续编辑后拒绝旧顺序响应；历史 AI 正文仅保留记录；实验方案拖入仅建立来源关联');
 });
 it('keeps one composer attached to the viewport bottom while expanding upward without losing its draft',async()=>{
  const fw=frame.contentWindow,input=ui.$('ai-prompt'),form=ui.$('ai-form'),footer=form.closest('footer'),history=ui.$('ai'),surface=ui.$('assembly-clui-surface'),reveal=surface.querySelector('.clui-native-reveal');
  report.composerFocus||=[];const recordFocus=event=>{if(event.target===input||event.target===reveal||event.target===ui.$('canvas'))report.composerFocus.push({type:event.type,target:event.target.id||event.target.className,at:Date.now(),frameHasFocus:doc().hasFocus(),active:doc().activeElement?.id,aiOpen:ui.p.ui.aiOpen,collapsingAI:!!ui.collapsingAI});};for(const type of ['focus','focusin','blur','focusout','pointerdown'])doc().addEventListener(type,recordFocus,true);disposeFocusDiagnostics=()=>{for(const type of ['focus','focusin','blur','focusout','pointerdown'])doc().removeEventListener(type,recordFocus,true);};
  try{
   // Retracted, the transcript, input and attachments sink together and only the 30px reveal strip stays (docs/ui-detail-polish-2026-10-24.md:39).
   ui.closeCoauthor();await wait(()=>history.hidden&&surface.dataset.cluiRetracted==='true','对话收起为底部唤起条');await Zotero.Promise.delay(260);
   assert.equal(fw.getComputedStyle(form).display,'none');assert.isTrue(form.inert);assert.isFalse(reveal.hidden);assert.closeTo(reveal.getBoundingClientRect().height,30,1,'收起后只留30px唤起条');assert.isFalse(footer.inert,'收起不禁用非聊天的底栏');assert.isNull(ui.$('footer-actions').closest('[inert]'));assert.closeTo(footer.getBoundingClientRect().bottom,fw.innerHeight,1);
   ui.$('canvas').focus();assert.strictEqual(doc().activeElement,ui.$('canvas'),'收起后先完成真实焦点离开，再从唤起条展开');
   reveal.click();await wait(()=>ui.p.ui.aiOpen&&surface.dataset.cluiRetracted==='false','点击唤起条展开');assert.strictEqual(doc().activeElement,input,'唤起后焦点进入同一输入框');await Zotero.Promise.delay(260);
   assert.isTrue(reveal.hidden);assert.isFalse(form.inert);assert.isFalse(history.inert);
   // Measure the empty 44px input, then a three-line draft (20px lines) that clearly exceeds it.
   input.value='';event(input,'input');await Zotero.Promise.delay(260);
   const closedBottom=form.getBoundingClientRect().bottom,sendBottom=ui.$('ask-ai').getBoundingClientRect().bottom,closedTop=form.getBoundingClientRect().top;
   const draft='检查防泄漏条件\n以及消融的控制变量\n并记录独立采集批次';input.value=draft;event(input,'input');input.setSelectionRange(2,6,'backward');await Zotero.Promise.delay(260);
   assert.strictEqual(form.parentElement,footer);assert.strictEqual(ui.$('ai-prompt'),input);assert.lengthOf(doc().querySelectorAll('#ai-form'),1);
   assert.closeTo(footer.getBoundingClientRect().bottom,fw.innerHeight,1);assert.closeTo(form.getBoundingClientRect().bottom,closedBottom,1);assert.closeTo(ui.$('ask-ai').getBoundingClientRect().bottom,sendBottom,1);
   assert.isBelow(form.getBoundingClientRect().top,closedTop-10,'只能向上增加输入高度');assert.isAbove(history.getBoundingClientRect().height,150);
   assert.equal(input.value,draft);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(input.selectionDirection,'backward');
   const templates=form.querySelector('.prompt-templates');templates.hidden=true;key(input,'Escape');await wait(()=>history.hidden);assert.isTrue(history.inert);assert.equal(history.getAttribute('aria-hidden'),'true');
   assert.equal(surface.dataset.cluiRetracted,'true');assert.equal(fw.getComputedStyle(form).display,'none');assert.strictEqual(doc().activeElement,reveal,'Esc 收起后焦点留在唤起条');assert.equal(input.value,draft);assert.closeTo(footer.getBoundingClientRect().bottom,fw.innerHeight,1);
   reveal.click();await wait(()=>ui.p.ui.aiOpen&&!history.hidden,'唤起条再次展开');assert.strictEqual(doc().activeElement,input);assert.equal(input.value,draft);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(input.selectionDirection,'backward','收起再展开保留草稿与选区');
   const mediaRules=[...doc().styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule.conditionText?.includes('prefers-reduced-motion')).flatMap(rule=>[...rule.cssRules]);
   assert.isTrue(mediaRules.some(rule=>rule.selectorText?.includes('#ai')&&rule.style.transition==='none'),'对话提供减少动效规则');
   assert.isTrue(mediaRules.some(rule=>rule.selectorText?.includes('#ai-prompt')&&rule.style.transition==='none'),'输入提供减少动效规则');
   if(!fw.matchMedia('(prefers-reduced-motion:reduce)').matches)assert.notEqual(fw.getComputedStyle(input).transitionDuration,'0s');
   report.checks.push('真实窗口焦点/几何：收起时对话与输入一起下沉，只留30px唤起条且底栏工具可用；点击唤起条回到同一输入栏，向上变高时发送与底部位置不移；Esc 收起焦点回到唤起条，草稿、选区与减少动效规则保留');
  }finally{ui.closeCoauthor();input.value='';event(input,'input');await wait(()=>history.hidden,'恢复收起');}
 });
 it('keeps external material queries out of a focused or composing search input and synchronizes after leaving it',async()=>{
  ui.p.ui.left='materials';ui.renderLibrary();const input=ui.$('material-search');input.focus();input.value='正在输入的中文';input.setSelectionRange(2,4);
  ui.materialQuery='外部资料查询';ui.renderLibrary();assert.equal(input.value,'正在输入的中文');assert.equal(input.selectionStart,2);
  ui.$('canvas').focus();await wait(()=>input.value==='外部资料查询');
  event(input,'compositionstart');ui.materialQuery='卷积神经网络 CNN';ui.renderLibrary();assert.equal(input.value,'外部资料查询');
  event(input,'compositionend');await Zotero.Promise.delay(220);ui.materialQuery='卷积神经网络 CNN';ui.renderLibrary();assert.equal(input.value,'卷积神经网络 CNN');
  report.checks.push('复用搜索输入；外部查询不打断中文组词或选区，离开后同步显示');
 });
 it('keeps templates in a small composer popup and conversation within a readable column',async()=>{
  const fw=frame.contentWindow,input=ui.$('ai-prompt'),form=ui.$('ai-form'),templates=form.querySelector('.prompt-templates'),toggle=ui.$('ai-template-toggle'),priorSession=ui.conversationSession.id,before=prose();
  try{
   await R.workbenchConversations.create({title:'受控对话排版',messages:[{role:'user',text:'请核对数据划分和防泄漏条件。'},{role:'assistant',text:'使用独立采集批次划分训练与测试集；相关证据尚待核对。'}]});ui.renderChat();ui.openCoauthor();input.focus();toggle.click();assert.isFalse(templates.hidden);await Zotero.Promise.delay(280);
   const fr=form.getBoundingClientRect(),tr=templates.getBoundingClientRect(),chat=ui.$('chat'),cr=chat.getBoundingClientRect();assert.equal(fw.getComputedStyle(form).position,'relative');assert.equal(fw.getComputedStyle(templates).position,'absolute');assert.isAbove(tr.width,200);assert.isAtMost(tr.width,560);assert.isBelow(tr.width,fr.width,'任务模板不能占满底栏或独立成第二行');assert.closeTo(tr.left,fr.left+1,2);assert.isAtMost(tr.bottom,fr.top-5);assert.strictEqual(toggle.closest('form'),form);
   const article=ui.$('workspace').querySelector('main').getBoundingClientRect();assert.isAtMost(cr.width,860);assert.closeTo((cr.left+cr.right)/2,(article.left+article.right)/2,2,'对话以文章栏为中心，两侧原栏不被覆盖');assert.equal(fw.getComputedStyle(chat).maxHeight,'none');assert.equal(fw.getComputedStyle(chat).overflowY,'visible','仅历史区域滚动，不产生第二层聊天滚动条');assert.isAtLeast(parseFloat(fw.getComputedStyle(chat.lastElementChild).fontSize),14);assert.exists(chat.lastElementChild.querySelector('.message-meta .easysch-symbol'));
   assert.isAtMost(chat.querySelector('.from-user:last-of-type')?.getBoundingClientRect().width||chat.querySelector('.from-user').getBoundingClientRect().width,cr.width*.73);
   key(input,'Tab');assert.equal(doc().activeElement.dataset.template,'search');key(doc().activeElement,'Escape');assert.isTrue(templates.hidden);toggle.click();assert.isFalse(templates.hidden);toggle.click();assert.isTrue(templates.hidden);assert.equal(prose(),before);
   report.checks.push('真实几何：底栏任务入口与≤560px浮层；Tab/鼠标/Esc；对话≤860px居中单层滚动与14px文字，用户稿件不变');
  }finally{await R.workbenchConversations.select(priorSession);ui.renderChat();await ui.persist();}
 });
 it('keeps existing empty blocks editable at paragraph height without repeated help text',async()=>{
  const fw=frame.contentWindow,previous=ui.M.clone(ui.p.blocks),before=prose(),count=previous.length,blank=[ui.M.block('paragraph',ui.p.sections[0].id),ui.M.block('paragraph',ui.p.sections[0].id)];
  try{
   ui.p.blocks.push(...blank);ui.renderEditor();assert.equal(ui.p.blocks.length,count+2,'渲染不能删除空段落');
   for(const b of blank){const block=doc().querySelector(`[data-id="${b.id}"]`),node=block.querySelector('.editable'),style=fw.getComputedStyle(node),zoom=Number(ui.p.ui.paperZoom)||1;assert.equal(node.contentEditable,'true');assert.isEmpty(node.textContent);assert.equal(fw.getComputedStyle(node,'::before').content,'none');assert.notExists(block.querySelector('.badge'),'空段落不生成重复提示');assert.isAtMost(block.getBoundingClientRect().height/zoom,parseFloat(style.lineHeight)+3,'空段落只保留一行真实编辑基线');node.focus();assert.strictEqual(doc().activeElement,node);assert.equal(b.text,'');}
   report.checks.push('真实空段落保留稳定ID和可编辑焦点，隐藏重复帮助且只占一行；不删除或填充用户稿件');
  }finally{ui.p.blocks=previous;ui.renderEditor();assert.equal(prose(),before);await ui.persist();}
 });
 it('drags the original AI logo across both panes into the bottom row without submitting, and reuses one conversation',async()=>{
  const fw=frame.contentWindow,orb=ui.aiOrb,button=orb.button,layer=orb.layer,form=ui.$('ai-form'),input=ui.$('ai-prompt');let submits=0;
  const submitted=e=>{e.preventDefault();e.stopImmediatePropagation();submits++;};form.addEventListener('submit',submitted,true);
  const captures=new Set(),capture={set:button.setPointerCapture,has:button.hasPointerCapture,release:button.releasePointerCapture};
  button.setPointerCapture=id=>captures.add(id);button.hasPointerCapture=id=>captures.has(id);button.releasePointerCapture=id=>captures.delete(id);
  const pointer=(type,p)=>button.dispatchEvent(new fw.PointerEvent(type,{bubbles:true,pointerId:42,button:0,clientX:p.x,clientY:p.y}));
  const move=async(x,y)=>{const r=button.getBoundingClientRect();pointer('pointerdown',{x:r.left+18,y:r.top+18});pointer('pointermove',{x,y});pointer('pointerup',{x,y});button.dispatchEvent(new fw.MouseEvent('click',{bubbles:true,detail:1}));await ui.persist();};
  try{
   ui.closeCoauthor();await wait(()=>ui.$('ai').hidden);assert.strictEqual(layer.parentElement,doc().documentElement);assert.equal(fw.getComputedStyle(layer).pointerEvents,'none');assert.isAbove(Number(fw.getComputedStyle(layer).zIndex),10000);
   for(const x of [-100,fw.innerWidth+100]){await move(x,fw.innerHeight+100);const r=button.getBoundingClientRect();assert.isAtLeast(r.left,0);assert.isAtMost(r.right,fw.innerWidth);assert.isAtMost(r.bottom,fw.innerHeight);assert.isAtLeast(r.top,form.closest('footer').getBoundingClientRect().top);assert.strictEqual(doc().elementFromPoint(r.left+18,r.top+18),button,'页侧及底栏均不能挡住 Logo');}
   assert.equal(submits,0);assert.isFalse(ui.p.ui.aiOpen);const saved=R.manuscripts.get(projectID).ui.aiOrbPosition;assert.closeTo(saved.x,1,.001);assert.closeTo(saved.y,1,.001);
   button.dispatchEvent(new fw.PointerEvent('pointerenter'));await wait(()=>!doc().getElementById('assembly-ai-orb-hint').hidden,'Logo 功能提示');const hint=doc().getElementById('assembly-ai-orb-hint'),hr=hint.getBoundingClientRect();assert.include(hint.textContent,'点击对话');assert.include(hint.textContent,'拖动移动');assert.isAtLeast(hr.left,0);assert.isAtMost(hr.right,fw.innerWidth);assert.isAtLeast(hr.top,0);assert.isAtMost(hr.bottom,fw.innerHeight);assert.equal(button.getAttribute('aria-controls'),ui.conversationSurface.root.id);button.dispatchEvent(new fw.PointerEvent('pointerleave'));assert.isTrue(hint.hidden);
   assert.include(fw.getComputedStyle(button).borderRadius,'50%','原鸟Logo外框为圆形');
   const before=prose();button.click();await wait(()=>ui.conversationSurface.isOpen);assert.strictEqual(doc().activeElement,ui.conversationSurface.input);assert.isFalse(ui.p.ui.aiOpen,'Logo在旁边打开浮层，不把原底栏往上挪');button.click();assert.lengthOf(doc().querySelectorAll('.conversation-surface'),1);assert.equal(prose(),before);assert.equal(submits,0);
   const module=await fw.eval("import('chrome://zotero/content/research/manuscript/assembly-orb.mjs')"),callbacks={open:()=>ui.conversationSurface.show({nearLogo:true}),close:()=>ui.conversationSurface.hide()};
   module.installAssemblyAIOrb(ui,callbacks);assert.lengthOf(doc().querySelectorAll('#assembly-ai-orb'),1,'重复安装复用同一 Logo');
   const prior={...orb.position};orb.dispose();assert.notExists(doc().getElementById('assembly-ai-layer'));ui.aiOrb=module.installAssemblyAIOrb(ui,callbacks);ui.conversationSurface.setOrb(ui.aiOrb.button);ui.aiOrb.button.setAttribute('aria-controls',ui.conversationSurface.root.id);assert.closeTo(ui.aiOrb.position.x,prior.x,1);assert.closeTo(ui.aiOrb.position.y,prior.y,1);
   fw.dispatchEvent(new fw.Event('resize'));await Zotero.Promise.delay(80);const restored=ui.aiOrb.button.getBoundingClientRect();assert.isAtMost(restored.right,fw.innerWidth);assert.isAtMost(restored.bottom,fw.innerHeight);
   report.checks.push('原始 AI Logo 根层显示、左右跨栏和底栏拖动不遮挡；拖动零提交、点击复用对话；位置保存与重建恢复');
  }finally{form.removeEventListener('submit',submitted,true);button.setPointerCapture=capture.set;button.hasPointerCapture=capture.has;button.releasePointerCapture=capture.release;}
 });
 it('docks AI into closed left/right panes, switches original content and restores every original DOM node',async()=>{
  const surface=ui.conversationSurface,fw=frame.contentWindow,left=ui.$('left'),right=ui.$('right'),library=ui.$('library'),details=ui.$('details'),before=prose();
  ui.p.ui.leftOpen=false;ui.p.ui.rightOpen=false;ui.applyPanels();surface.hide();
  for(const [id,target,content]of [['left',left,library],['right',right,details]]){
   const parent=content.parentElement;assert.isTrue(surface.dock(id));await Zotero.Promise.delay(240);assert.isFalse(target.hidden);assert.isTrue(target.inert);assert.equal(surface.root.dataset.dock,id);assert.isTrue(ui.aiOrb.button.hidden,'停靠时隐藏悬浮Logo');assert.strictEqual(content.parentElement,parent,'覆盖AI不移动原栏内容');
   const rect=surface.root.getBoundingClientRect(),bounds=target.getBoundingClientRect();assert.closeTo(rect.left,bounds.left,1);assert.closeTo(rect.width,bounds.width,1);assert.closeTo(rect.top,bounds.top,1);assert.closeTo(rect.height,bounds.height,1);
   surface.root.querySelector('.conversation-surface-tabs button:first-child').click();await Zotero.Promise.delay(240);assert.isFalse(target.inert);assert.equal(surface.root.dataset.tab,'original');
   const visual=()=>{const style=fw.getComputedStyle(surface.root),r=surface.root.getBoundingClientRect(),bounds=target.getBoundingClientRect();return {dock:id,at:Date.now(),tab:surface.root.dataset.tab,inlineHeight:surface.root.style.height,computedHeight:style.height,minHeight:style.minHeight,actualHeight:r.height,visibility:doc().visibilityState,hasFocus:doc().hasFocus(),animations:surface.root.getAnimations().map(animation=>({property:animation.transitionProperty,name:animation.animationName,state:animation.playState,currentTime:animation.currentTime,startTime:animation.startTime,duration:animation.effect?.getComputedTiming().duration,progress:animation.effect?.getComputedTiming().progress})),target:{left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height}};};
   report.dockReturnGeometry||=[];report.dockReturnGeometry.push({stage:'after-240ms',...visual()});for(let i=0;i<20&&surface.root.getBoundingClientRect().height>44;i++)await Zotero.Promise.delay(100);const settled=visual();report.dockReturnGeometry.push({stage:'after-visual-wait',...settled});assert.isAtMost(settled.actualHeight,44,'原内容必须实际只留下顶部切换栏 '+JSON.stringify(settled));assert.isTrue(ui.aiOrb.button.hidden);assert.strictEqual(content.parentElement,parent);
   surface.root.querySelector('.conversation-surface-tabs button:last-child').click();assert.isTrue(target.inert);surface.hide();await Zotero.Promise.delay(200);assert.isFalse(target.inert);assert.isFalse(ui.aiOrb.button.hidden);assert.strictEqual(content.parentElement,parent);
  }assert.equal(prose(),before);report.checks.push('真实几何：关闭侧栏自动展开、左右AI覆盖、顶部切原内容/AI、关闭恢复原节点与焦点范围；论文正文未改');
 });
 it('hides the docked logo and restores it by dragging the header out before dragging to the other pane',async()=>{
  const surface=ui.conversationSurface,button=ui.aiOrb.button,fw=frame.contentWindow,before=prose(),captures=new Set(),prior={set:button.setPointerCapture,has:button.hasPointerCapture,release:button.releasePointerCapture};button.setPointerCapture=id=>captures.add(id);button.hasPointerCapture=id=>captures.has(id);button.releasePointerCapture=id=>captures.delete(id);
  const pointer=(type,x,y)=>button.dispatchEvent(new fw.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:82,button:0,clientX:x,clientY:y}));surface.hide();ui.p.ui.leftOpen=ui.p.ui.rightOpen=true;ui.applyPanels();
  try{for(const [index,id] of ['left','right'].entries()){
   if(index)await dragSharedHeaderOut(surface);assert.isFalse(button.hidden,'仅从恢复的Logo开始拖动');const r=button.getBoundingClientRect(),target=ui.$(id).getBoundingClientRect(),x=target.left+target.width/2,y=target.top+100;
   pointer('pointerdown',r.left+18,r.top+18);pointer('pointermove',x,y);pointer('pointerup',x,y);await wait(()=>surface.docked===id,'Logo拖入'+id+'栏');assert.isTrue(button.hidden);assert.equal(button.dataset.conversationDocked,'true');assert.equal(fw.getComputedStyle(button).visibility,'hidden');assert.isFalse(surface.root.hidden);assert.equal(surface.root.dataset.dock,id);assert.equal(prose(),before);
  }report.checks.push('真实装配DOM/受控pointer：Logo进左栏后隐藏，从标题拖出恢复，再拖入右栏；不对隐藏Logo执行命中或contained检查，正文不变');}
  finally{surface.hide();button.setPointerCapture=prior.set;button.hasPointerCapture=prior.has;button.releasePointerCapture=prior.release;}
 });
 it('drags a docked title out to floating mode while input and message selection never drag the card',async()=>{
  const surface=ui.conversationSurface,root=surface.root,fw=frame.contentWindow,captured=new Set(),prior={set:root.setPointerCapture,has:root.hasPointerCapture,release:root.releasePointerCapture};
  root.setPointerCapture=id=>captured.add(id);root.hasPointerCapture=id=>captured.has(id);root.releasePointerCapture=id=>captured.delete(id);
  const pointer=(target,type,x,y)=>target.dispatchEvent(new fw.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:78,button:0,clientX:x,clientY:y}));
  try{
   surface.dock('left');await Zotero.Promise.delay(240);const rect=surface.header.getBoundingClientRect(),x=fw.innerWidth/2,y=rect.top+90;pointer(surface.header,'pointerdown',rect.left+100,rect.top+10);pointer(root,'pointermove',x,y);assert.equal(root.dataset.dragging,'true');pointer(root,'pointerup',x,y);await ui.persist();
   assert.isNull(surface.docked);assert.equal(root.dataset.dock,'floating');assert.isFalse(ui.aiOrb.button.hidden,'拖出标题恢复悬浮Logo');assert.isFalse(ui.$('left').inert);assert.isUndefined(root.dataset.dragging);const free=root.getBoundingClientRect();assert.isAtLeast(free.left,0);assert.isAtMost(free.right,fw.innerWidth);assert.isAtMost(free.bottom,fw.innerHeight);
   pointer(surface.input,'pointerdown',free.left+40,free.bottom-30);pointer(root,'pointermove',10,200);pointer(root,'pointerup',10,200);assert.isNull(surface.docked,'输入不触发卡片拖动');
   const message=surface.log.querySelector('.conversation-surface-message');if(message){pointer(message,'pointerdown',free.left+40,free.top+60);pointer(root,'pointermove',10,200);pointer(root,'pointerup',10,200);assert.isNull(surface.docked,'正文选区不触发卡片拖动');}
   const mediaRules=[...doc().styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule.conditionText?.includes('prefers-reduced-motion')).flatMap(rule=>[...rule.cssRules]);assert.isTrue(mediaRules.some(rule=>rule.selectorText?.includes('.conversation-surface')&&rule.style.transition.includes('none')));surface.hide();
   report.checks.push('真实原生DOM与受控pointer：停靠栏标题可拖出、输入和消息不拖卡片、卡片反馈/减少动效规则有效');
  }finally{root.setPointerCapture=prior.set;root.hasPointerCapture=prior.has;root.releasePointerCapture=prior.release;}
 });
 it('keeps task/model controls inside the shared input and forwards the persisted choice without writing prose',async()=>{
  const S=R.workbenchConversations,priorSession=S.getActive().id,before=prose(),oldModels=R.workbenchModels,oldRun=R.runWorkbenchTask,surface=ui.conversationSurface,root=surface.root,input=surface.input,fw=frame.contentWindow;let request;
  R.workbenchModels=async()=>[{id:'controlled-model',label:'受控模型'}];R.runWorkbenchTask=async value=>{request=value;return {text:'受控检索结果：资料尚待核验。',sources:[]};};
  try{
   const session=await S.create({title:'共享输入控件验收',origin:'assembly',projectID,mode:'auto'});surface.undock({nearLogo:true});input.focus();await Zotero.Promise.delay(240);
   const menu=root.querySelector('.conversation-surface-mode-menu'),composer=root.querySelector('.conversation-surface-composer'),footer=root.querySelector('.conversation-surface-footer'),modeButton=root.querySelector('.conversation-surface-mode');assert.isTrue(menu.hidden,'聚焦只显示输入，不堆出整排任务');assert.equal(fw.getComputedStyle(menu).position,'absolute');assert.strictEqual(modeButton.closest('.conversation-surface-composer'),composer);assert.exists(modeButton.querySelector('svg'));const row=root.querySelector('.conversation-surface-input-row'),gap=parseFloat(fw.getComputedStyle(row).marginBottom)||0;assert.strictEqual(footer.parentElement,row);assert.closeTo(footer.getBoundingClientRect().bottom,row.getBoundingClientRect().bottom,2);assert.isAtMost(gap,10,'胶囊下只留底边台阶的间距');assert.closeTo(row.getBoundingClientRect().bottom+gap,root.getBoundingClientRect().bottom,2,'输入胶囊位于卡片底部，下方没有其他内容');
   key(input,'Tab',{isComposing:true});assert.equal(S.get(session.id).mode,'auto','组词不切模式');assert.isTrue(menu.hidden);key(input,'Tab');await wait(()=>S.get(session.id).mode==='search');assert.equal(input,doc().activeElement,'输入框内按 Tab 只切换任务并显示菜单，焦点留在输入框以便继续按 Tab');assert.isFalse(menu.hidden);assert.strictEqual(menu.parentElement,doc().getElementById('easysch-conversation-preferences'),'任务菜单显示在文档级共享浮层');assert.equal(modeButton.querySelector('.conversation-control-label').textContent,'查找文献');menu.querySelector('[data-mode="organize"]').click();await wait(()=>S.get(session.id).mode==='organize');assert.isTrue(menu.hidden);
   // The model and strength options open in the same document-level popover, outside the card root.
   const more=root.querySelector('.conversation-surface-more-menu');root.querySelector('.conversation-surface-model-button').click();await wait(()=>more.querySelector('[data-model="controlled-model"]'),'共享浮层模型菜单');assert.isFalse(more.hidden);assert.strictEqual(more.parentElement,doc().getElementById('easysch-conversation-preferences'));assert.isFalse(more.querySelector('.conversation-surface-model-options').hidden);assert.isTrue(more.querySelector('.conversation-surface-strength-options').hidden);more.querySelector('[data-model="controlled-model"]').click();await wait(()=>S.get(session.id).modelID==='controlled-model');assert.isTrue(more.hidden);root.querySelector('.conversation-surface-strength-button').click();assert.isFalse(more.querySelector('.conversation-surface-strength-options').hidden);more.querySelector('[data-strength="medium"]').click();await wait(()=>S.get(session.id).thinkingLevel==='medium');assert.isTrue(more.hidden);
   input.focus();input.value='请按研究主题整理已有素材';event(input,'input');assert.isTrue(menu.hidden);key(input,'Enter');await wait(()=>S.get(session.id).messages.some(message=>message.role==='assistant'),'受控共享发送');assert.equal(request.mode,'organize');assert.equal(request.modelID,'controlled-model');assert.equal(request.thinkingLevel,'medium');assert.equal(request.projectID,projectID);assert.equal(prose(),before);
   report.checks.push('真实DOM/受控模型列表、回复与点击：输入内任务/模型/思考强度图标菜单，Tab/鼠标与IME排除，共享偏好传入同一研究任务；正文未改，未调用真实模型');
  }finally{R.workbenchModels=oldModels;R.runWorkbenchTask=oldRun;surface.hide();await S.select(priorSession);}
 });
 it('shares live sessions and messages with the actual workbench page and preserves them after assembly reopen',async()=>{
  const S=R.workbenchConversations,before=prose(),session=await S.create({title:'跨页面共享验收',origin:'assembly',projectID});
  await S.append(session.id,{id:'assembly-live-message',role:'assistant',text:'受控证据：先划分独立设备，再计算归一化参数。',sources:[{id:'source-stable',label:'保留的来源',attachmentID:77,pageIndex:2}]});
  R.open();let workbench;await wait(()=>{const page=win.document.getElementById('easysch-workspace-frame');workbench=page?.contentWindow.EasySchUI;return workbench?.ready;},'真实工作台页面');
  assert.equal(workbench.agentData.activeSessionID,session.id);assert.isTrue(workbench.agentData.messages.some(message=>message.id==='assembly-live-message'));
  workbench.agentData.messages.push({id:'workbench-live-message',role:'user',text:'工作台新增的研究问题'});await workbench.saveAgentState();assert.isTrue(ui.conversationSession.messages.some(message=>message.id==='workbench-live-message'));assert.equal(S.get(session.id).messages.find(message=>message.id==='assembly-live-message').sources[0].attachmentID,77);assert.equal(prose(),before);
  ui.conversationSurface.dock('right');await ui.persist();await R.store.flush();win.Zotero_Tabs.close(frame.parentElement.id);await R.manuscripts.open(projectID);await wait(()=>{frame=win.document.getElementById('manuscript-'+projectID);ui=frame?.contentWindow.ManuscriptUI;return ui?.ready;});
  assert.equal(ui.conversationSession.id,session.id);assert.isTrue(ui.conversationSession.messages.some(message=>message.id==='workbench-live-message'));assert.equal(ui.conversationSurface.docked,'right');assert.equal(prose(),before);ui.conversationSurface.hide();
  report.checks.push('真实工作台与装配互见稳定会话/消息/来源；实际装配tab关闭重开恢复右侧停靠与共享对话；无模型调用');
 });
});
