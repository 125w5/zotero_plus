/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The writing flow as it is now: a project made from writing home with 直接装配
// opens the native assembly tab, and every later test works in that project.
// Model replies are controlled fixtures; the Word files come from the real engine.
describe('Manuscript assembly native frontend',function(){
 this.timeout(360000);
 let win,R=Zotero.Research,ui,frame,projectID,folder,paper,note,prior,sessionID;const created={projects:[],items:[],collections:[]};
 const offline=async()=>{throw Error('受控测试：本套件不调用模型');};
 const wait=async(fn,label='前台',limit=1200)=>{for(let i=0;i<limit;i++){if(await fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时：'+(ui?.$('status')?.textContent||''));};
 const buttons=host=>[...host.querySelectorAll('button')];
 const click=(host,text)=>{const b=buttons(host).find(b=>b.textContent===text);assert.exists(b,text);b.click();};
 const insert=text=>click(ui.$('insert-tools').querySelector('.manuscript-insert-actions'),text);
 const edit=(input,text,event='input')=>{if(input.isContentEditable)input.textContent=text;else input.value=text;input.dispatchEvent(new input.ownerDocument.defaultView.Event(event,{bubbles:true}));};
 const key=(node,value,mods={},focus=true)=>{if(focus)node.focus();const event=new frame.contentWindow.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...mods});node.dispatchEvent(event);return event;};
 // The library search box shows a lookup as research-domain.mjs cleans it (NFKC, collapsed spaces).
 const keyword=text=>String(text).normalize('NFKC').replace(/\s+/g,' ').trim();
 // Runs one action of the material library's 导入与管理素材 menu.
 const manage=label=>{const menu=ui.$('library').querySelector('.material-management');assert.exists(menu,'导入与管理素材');menu.open=true;click(menu,label);};
 const outlineRow=id=>ui.$('library').querySelector(`.outline-content[data-outline-block="${id}"]`);
 const topicBlock=()=>ui.p.blocks.find(b=>b.type==='paragraph'&&b.materials.some(x=>ui.p.materials.find(m=>m.id===x.id)?.title==='温漂复核素材'));
 // WCAG contrast of a node's text against the first visible background at or above it. Computed
 // colors come as rgb()/rgba() (0-255) or, from color-mix(), as color(srgb r g b / a) (0-1).
 const parse=color=>{const text=String(color),values=(text.match(/-?[0-9.]+%?/g)||[]).map(v=>v.endsWith('%')?parseFloat(v)/100:+v),scale=text.startsWith('color(')?255:1;return {rgb:values.slice(0,3).map(v=>v*scale),alpha:text==='transparent'?0:values.length>3?values[3]:1};};
 const luminance=({rgb})=>{const v=rgb.map(n=>{n=n/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
 const surface=node=>{const w=node.ownerDocument.defaultView;for(let n=node;n&&n.nodeType===1;n=n.parentElement){const value=parse(w.getComputedStyle(n).backgroundColor);if(value.alpha>0)return value;}return {rgb:[255,255,255],alpha:1};};
 const contrast=node=>{const a=luminance(parse(node.ownerDocument.defaultView.getComputedStyle(node).color)),b=luminance(surface(node));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
 // A theme switch starts background-color transitions (surface.css buttons, .12s) while text color
 // changes at once, so the first frame pairs the new text with the old background. Measure the
 // colors the transitions settle on; getAnimations() flushes styles, so new transitions are included.
 const settle=doc=>{for(const animation of doc.getAnimations())if('transitionProperty' in animation)animation.finish();};
 async function capture(name){await Zotero.Promise.delay(150);const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();}
 before(async()=>{win=await loadZoteroPane();win.Zotero_Tabs.closeAll();win.focus();win.resizeTo(1550,980);await R.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'manuscript-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});prior={request:R.studio.request,pick:R.pick,launch:Zotero.launchFile,appearance:Zotero.Prefs.get('extensions.easysch.writingAppearance',true),active:R.workbenchConversations.getActive()?.id};R.studio.request=offline;});
 after(async()=>{
  if(prior){R.studio.request=prior.request;R.pick=prior.pick;Zotero.launchFile=prior.launch;}
  const host=projectID&&win?.document.getElementById('manuscript-'+projectID);if(host)win.Zotero_Tabs.close(host.parentElement.id);
  for(const id of created.projects){const ref=R.store.peek('manuscriptLibrary',id);if(ref?.itemID)created.items.push(ref.itemID);if(R.manuscripts.get(id))await R.manuscripts.remove(id);}
  if(sessionID&&R.workbenchConversations.get(sessionID))await R.workbenchConversations.remove(sessionID);if(prior?.active&&R.workbenchConversations.get(prior.active))await R.workbenchConversations.select(prior.active);
  for(const id of created.items){const item=await Zotero.Items.getAsync(id);if(item)await item.eraseTx();}
  for(const id of created.collections){const collection=Zotero.Collections.get(id);if(collection)await collection.eraseTx();}
  await R.store.flush();win?.close();
 });
 it('creates a project from writing home with its required keyword and opens assembly in a native tab',async function(){
  // The create dialog appears after its research-domain modules load (openManuscriptCreate).
  const home=await R.openWorkflow('writing');assert.isTrue(home.$('legacy-writing').hidden);home.$('new-manuscript').click();await wait(()=>home.$('manuscript-name')?.closest('form'),'新建论文对话框');
  const name=home.$('manuscript-name'),form=name.closest('form'),primary=form.querySelector('[aria-label="新论文第一关键词"]'),title='论文装配前台验收 · 实验报告 '+Date.now();
  edit(name,title);edit(primary,'');assert.isFalse(form.checkValidity(),'研究领域第一关键词必填');edit(primary,'实验报告');assert.isTrue(form.checkValidity());
  // 直接装配 skips the feasibility page and opens the native assembly tab.
  form.requestSubmit(buttons(form).find(b=>b.textContent==='直接装配'));
  await wait(()=>{const p=Object.values(R.manuscripts.all()).find(p=>p.title===title);frame=p&&win.document.getElementById('manuscript-'+p.id);ui=frame?.contentWindow.ManuscriptUI;return ui?.ready&&!home.$('manuscript-name');},'论文装配标签页');
  projectID=ui.p.id;created.projects.push(projectID);const saved=R.manuscripts.get(projectID);if(saved.createdPaperCollectionID)created.collections.push(saved.createdPaperCollectionID);sessionID=ui.conversationSession.id;
  assert.equal(win.Zotero_Tabs.selectedType,'manuscript');assert.equal(ui.p.ui.step,0);assert.equal(frame.contentDocument.body.dataset.assemblyStage,'0');
  assert.deepEqual(buttons(ui.$('left-tabs')).map(b=>b.textContent),['素材库','论文结构','来源核查']);assert.equal(ui.$('left-tabs').querySelector('[aria-selected=true]').textContent,'素材库');
  assert.deepEqual(buttons(ui.$('insert-tools').querySelector('.manuscript-insert-actions')).map(b=>b.textContent),['引用','公式','表格','图片','论文模块','新增一页']);
  assert.isFalse(ui.p.ui.aiOpen);assert.equal(ui.$('ai').getAttribute('aria-hidden'),'true');
  assert.equal(saved.researchPreparation.researchScope.primaryKeyword,'实验报告');assert.equal((R.notebook.stateView||R.notebook.state)(projectID).workflowStage,'assembly');await capture('01-project-and-tab.png');
 });
 it('inserts a table from the grid, binds CSV data, edits a cell and marks the bound table for checking',async function(){
  insert('表格');assert.exists(ui.$('grid'));await capture('02-table-grid.png');ui.$('grid').querySelector('[data-row="3"][data-col="3"]').click();await wait(()=>ui.p.blocks.some(b=>b.type==='table'),'插入表格');
  const table=ui.p.blocks.find(b=>b.type==='table');assert.equal(ui.p.ui.blockID,table.id);assert.lengthOf(table.table.rows,3);
  const csv=PathUtils.join(folder,'experiment.csv');await IOUtils.writeUTF8(csv,'模型,准确率,样本量\n基线,91.2%,100\n改进方法,93.4%,100\n');R.pick=async()=>csv;
  try{const binding=[...ui.$('details').querySelectorAll('details')].find(n=>n.querySelector('summary')?.textContent==='绑定 CSV / XLSX 或实验素材');assert.exists(binding,'表格数据绑定');binding.open=true;click(binding,'从文件选择数据');await wait(()=>table.table.binding,'绑定实验数据');}finally{R.pick=prior.pick;}
  assert.deepEqual(table.table.rows.map(r=>r.map(c=>c.text)),[['模型','准确率','样本量'],['基线','91.2%','100'],['改进方法','93.4%','100']]);assert.exists(ui.p.materials.find(m=>m.id===table.table.binding.materialID)?.data,'表格绑定到项目中的数据素材');
  const caption=[...ui.$('details').querySelectorAll('label')].find(n=>n.textContent.startsWith('表题')).querySelector('input');edit(caption,'受控验收数据（非论文实验结果）','change');assert.equal(table.table.caption,'受控验收数据（非论文实验结果）');
  // Editing a bound cell departs from the source data, so the table needs checking again before export.
  const cell=ui.$('canvas').querySelector(`[data-id="${table.id}"] [data-row="1"][data-col="0"] .cell-editor`);cell.click();edit(cell,'基线模型');await ui.persist({flush:true});await capture('03-bound-table.png');
  assert.equal(table.table.rows[1][0].text,'基线模型');assert.equal(table.review,'stale');const stored=R.manuscripts.get(projectID).blocks.find(b=>b.id===table.id);assert.equal(stored.table.rows[1][0].text,'基线模型');assert.equal(stored.table.caption,'受控验收数据（非论文实验结果）');
 });
 it('adds an evidence-linked analysis paragraph, looks up evidence without writing prose and restores the editor and conversation',async function(){
  const table=ui.p.blocks.find(b=>b.type==='table'),binding=[...ui.$('details').querySelectorAll('details')].find(n=>n.querySelector('summary')?.textContent==='已绑定实验数据');assert.exists(binding,'已绑定的表格数据');binding.open=true;click(binding,'在表后添加分析段落');await wait(()=>ui.p.blocks.some(b=>b.type==='paragraph'&&b.dependsOn?.includes(table.id)),'表后分析段落');
  const b=ui.p.blocks.find(b=>b.type==='paragraph'&&b.dependsOn?.includes(table.id)),input=ui.$('canvas').querySelector(`[data-id="${b.id}"] .editable`);assert.isTrue(b.claim);assert.deepEqual(b.materials.map(x=>x.id),table.materials.map(x=>x.id));
  edit(input,'以下数据仅用于软件验收：改进方法准确率为 93.4%，基线为 91.2%，样本量均为 100。不能把本表当作真实论文的实验结论。');assert.include(b.text,'仅用于软件验收');
  // Ctrl+Tab searches the material library with the paragraph; it neither writes nor proposes prose.
  const text=b.text,review=b.review,proposals=JSON.stringify(ui.p.proposals),messages=ui.conversationSession.messages.length;key(input,'Tab',{ctrlKey:true});await wait(()=>ui.$('material-search')?.value===keyword(text),'按段落查找证据');
  assert.equal(b.text,text);assert.equal(b.review,review);assert.equal(JSON.stringify(ui.p.proposals),proposals);assert.equal(ui.conversationSession.messages.length,messages);assert.notInclude(ui.$('details').textContent,'润色');
  click(ui.$('left-tabs'),'来源核查');const card=ui.$('library').querySelector(`.evidence-source-card[data-material="${table.table.binding.materialID}"]`);assert.exists(card,'数据素材的来源核查卡');assert.sameMembers([...card.querySelectorAll('.evidence-use')].map(n=>n.dataset.outlineBlock),[table.id,b.id]);await capture('04-source-check.png');
  await ui.conversations.append(ui.conversationSession.id,{role:'user',text:'核对这个人工记录的来源关联。'},{origin:'assembly'});await ui.conversations.append(ui.conversationSession.id,{role:'assistant',text:'记录与表格通过同一素材 ID 关联；这里只检查软件行为。'},{origin:'assembly'});
  ui.$('toggle-right').click();await ui.persist({flush:true});await R.store.flush();const section=ui.p.ui.sectionID,block=b.id;win.Zotero_Tabs.close(frame.parentElement.id);await Zotero.Promise.delay(200);await R.manuscripts.open(projectID);await wait(()=>{frame=win.document.getElementById('manuscript-'+projectID);ui=frame?.contentWindow.ManuscriptUI;return ui?.ready;},'重新打开论文装配');
  assert.equal(ui.p.ui.sectionID,section);assert.equal(ui.p.ui.blockID,block);assert.equal(ui.p.ui.left,'evidence');assert.isTrue(ui.$('right').hidden);assert.equal(ui.conversationSession.id,sessionID);assert.isTrue(ui.conversationSession.messages.some(m=>m.text==='核对这个人工记录的来源关联。'),'对话随项目恢复');ui.$('toggle-right').click();await capture('05-restored-editor.png');
 });
 it('imports a real Zotero note from its paper as a linked material and continues to direction discussion',async function(){
  paper=await createDataObject('item',{itemType:'journalArticle',title:'论文装配验收来源论文 '+Date.now(),date:'2025'});created.items.push(paper.id);
  note=new Zotero.Item('note');note.libraryID=paper.libraryID;note.parentID=paper.id;note.setNote('<p>我的阅读记录：先核对任务定义，再对照自己的实验。这是一条验收用个人笔记。</p>');await note.saveTx();created.items.push(note.id);
  click(ui.$('left-tabs'),'素材库');manage('导入笔记或实验');const popup=ui.$('popover-content');await wait(()=>popup.querySelector(`[data-paper="${paper.id}"]`),'来源论文列表');popup.querySelector(`[data-paper="${paper.id}"]`).click();
  await wait(()=>popup.querySelector(`[data-source-item="${note.id}"]`),'论文的笔记');popup.querySelector(`[data-source-item="${note.id}"]`).click();await wait(()=>ui.p.materials.some(m=>m.sourceItemID===note.id)&&!popup.querySelector(`[data-source-item="${note.id}"]`).disabled,'加入笔记素材');
  const m=ui.p.materials.find(m=>m.sourceItemID===note.id);assert.equal(m.kind,'note');assert.include(m.sourceText,'这是一条验收用个人笔记');assert.equal(m.anchor.paperItemID,paper.id);assert.include(ui.p.materialPaperIDs,paper.id);await capture('06-note-material.png');
  click(popup,'完成选择，开始装配');await wait(()=>!ui.$('popover').open&&ui.p.ui.step===1,'进入方向讨论');assert.equal(frame.contentDocument.body.dataset.assemblyStage,'1');await ui.workflow.setStep(0,{focus:false});assert.equal(ui.p.ui.step,0);
 });
 it('builds reviewed source-linked topic cards from readable day and night dialogs and keeps the shared card identity in a copy',async function(){
  const w=frame.contentWindow;ui.p.materials.push(ui.M.material({kind:'experiment',title:'温漂复测记录',summary:'复测时记录的晶振温漂。',sourceText:'复测中晶振温漂单独记录，未与正式实验数据混合。'}));ui.changed();await ui.persist({flush:true});
  click(ui.$('left-tabs'),'素材库');manage('按主题建立素材库');await wait(()=>ui.$('popover').open&&ui.$('topic-prompt'),'主题素材库对话框');assert.notInclude(ui.$('topic-prompt').value,'MouseEvent');
  // Contrast failures are collected and asserted after the dialog flow, so an unreadable theme is
  // still reported but does not stop the topic cards that the later tests write in.
  const unreadable=[];
  try{for(const mode of ['light','dark']){w.ResearchAppearance.set(mode);assert.equal(w.document.documentElement.dataset.appearance,mode);settle(w.document);for(const node of [ui.$('build-topic'),ui.$('popover'),ui.$('steps').querySelector('.assembly-step.active')]){const ratio=contrast(node);if(ratio<4.5)unreadable.push(mode+' '+(node.id||node.className)+' 文字对比度 '+ratio.toFixed(2));}await capture('07-topic-'+mode+'.png');}}
  finally{w.ResearchAppearance.set(['light','dark','auto'].includes(prior.appearance)?prior.appearance:'light');}
  // Only the topic request answers; the evidence card must quote the project's real record.
  R.studio.request=async(system,input)=>{if(!String(system).startsWith('按用户主题整理科研素材'))return offline();const source=input.sources.find(x=>x.text?.includes('晶振温漂单独记录'));assert.exists(source,'检索到项目中的实际记录');return {value:{cards:[{kind:'evidence',title:'温漂复核素材',category:'实验条件',summary:'复测时单独记录了晶振温漂，结论仍需核对正式数据。',sourceID:source.id,quote:'晶振温漂单独记录'},{kind:'idea',title:'待验证的温漂补偿',summary:'比较补偿前后的稳定性，需要设计实验验证。'}]},model:'controlled-ui-fixture'};};
  let assetID;
  try{edit(ui.$('topic-prompt'),'晶振温漂 复测');ui.$('build-topic').click();await wait(()=>ui.$('topic-results').querySelectorAll('.theme-card').length===2,'主题候选卡');assert.include(ui.$('topic-results').textContent,'待验证');await capture('08-reviewed-topic-cards.png');click(ui.$('topic-results'),'确认加入主题素材库');await wait(()=>!ui.$('popover').open,'加入主题素材库');
   const m=ui.p.materials.find(m=>m.title==='温漂复核素材');assert.exists(m?.assetID);assetID=m.assetID;assert.equal(m.sourceText,'晶振温漂单独记录');assert.equal(m.verification,'unverified');assert.isTrue(m.aiGenerated);
   manage('按主题建立素材库');await wait(()=>ui.$('popover').open&&ui.$('topic-prompt'),'再次打开主题素材库');edit(ui.$('topic-prompt'),'晶振温漂 复测');ui.$('build-topic').click();await wait(()=>ui.$('topic-results').querySelectorAll('.theme-card').length===2,'再次整理候选卡');click(ui.$('topic-results'),'确认加入主题素材库');await wait(()=>!ui.$('popover').open,'复用主题素材');
   assert.lengthOf(ui.p.materials.filter(m=>m.assetID===assetID),1,'同一来源的卡片复用，不重复加入');
  }finally{R.studio.request=offline;}
  // Dropping the card on a page makes a framed assembly paragraph that keeps the shared card id.
  const data=new w.DataTransfer();data.setData('application/x-manuscript-material',assetID);ui.$('canvas').querySelector('.paper').dispatchEvent(new w.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));await wait(()=>topicBlock(),'放入正文的主题素材');
  const b=topicBlock();assert.isTrue(b.assembly);ui.selectBlock(b.id);edit(ui.$('canvas').querySelector(`[data-id="${b.id}"] .editable`),'素材仅提供研究主题线索，仍须核对原始记录与实验。');await ui.persist({flush:true});
  const copy=await R.manuscripts.copy(projectID);created.projects.push(copy.id);assert.equal(R.manuscripts.get(copy.id).materials.find(m=>m.assetID===assetID).id,assetID);await R.manuscripts.remove(copy.id);
  assert.deepEqual(unreadable,[],'主题素材库对话框在日间和夜间的文字都要可读（对比度至少 4.5）');
 });
 it('preserves manual paragraph edits and keeps text, composer, table, outline and IME keys in their own scope',async function(){
  const b=topicBlock(),original=b.text;ui.selectBlock(b.id);assert.notInclude(ui.$('details').textContent,'润色');await capture('09-manual-paragraph.png');
  const input=ui.$('canvas').querySelector(`[data-id="${b.id}"] .editable`);assert.isFalse(key(input,'Delete').defaultPrevented,'正文中的 Delete 只编辑文字');assert.isFalse(key(ui.$('ai-prompt'),'z',{ctrlKey:true},false).defaultPrevented);assert.isFalse(key(ui.$('ai-prompt'),'Delete',{},false).defaultPrevented);
  input.dispatchEvent(new frame.contentWindow.InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:'补充'}));edit(input,original+'补充');assert.equal(b.text,original+'补充');key(input,'z',{ctrlKey:true});assert.equal(ui.p.blocks.find(x=>x.id===b.id).text,original);assert.isTrue(!!frame.contentDocument.activeElement.closest('.editable'),'撤销后仍在正文中写作');
  const table=ui.p.blocks.find(x=>x.type==='table'),cells=table.table.rows.map(r=>r.map(c=>c.text));ui.selectBlock(table.id);ui.selectedCells=[{r:1,c:0},{r:1,c:1}];key(ui.$('canvas').querySelector(`[data-id="${table.id}"] .cell-editor`),'Delete');
  assert.equal(ui.p.blocks.find(x=>x.id===table.id).table.rows[1][0].text,'');key(ui.$('canvas'),'z',{ctrlKey:true});assert.deepEqual(ui.p.blocks.find(x=>x.id===table.id).table.rows.map(r=>r.map(c=>c.text)),cells);ui.selectedCells=[];
  // A block row of 论文结构 sits inside its chapter group. Delete there removes that module only;
  // the chapter keeps its other modules and the materials and Zotero items stay.
  click(ui.$('left-tabs'),'论文结构');const row=outlineRow(b.id);row.click();const count=ui.p.blocks.length,materials=ui.p.materials.length;
  try{key(row,'Delete',{isComposing:true});assert.equal(ui.p.blocks.length,count,'输入法组字时不删除');key(row,'Delete');assert.isFalse(ui.$('popover').open,'删除段落时不应弹出删除整章的确认');assert.equal(ui.p.blocks.length,count-1);assert.isFalse(ui.p.blocks.some(x=>x.id===b.id));assert.equal(ui.p.materials.length,materials);if(paper)assert.isTrue(!!Zotero.Items.get(paper.id));
   key(ui.$('canvas'),'z',{ctrlKey:true});assert.equal(ui.p.blocks.length,count);await capture('10-outline-undo.png');}
  finally{if(ui.$('popover').open)ui.$('popover').close();}
  await ui.persist({flush:true});
 });
 it('looks up evidence for selected text and keeps outline rename, move, multiselect and chapter removal undoable',async function(){
  const w=frame.contentWindow,b=topicBlock(),before=b.text,title=b.title;ui.selectBlock(b.id);
  const node=ui.$('canvas').querySelector(`[data-id="${b.id}"] .editable`),text=w.document.createTreeWalker(node,w.NodeFilter.SHOW_TEXT).nextNode(),range=w.document.createRange();node.focus();range.setStart(text,0);range.setEnd(text,2);w.getSelection().removeAllRanges();w.getSelection().addRange(range);node.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
  // The selection becomes the editing conversation's target; Ctrl+Tab searches the library with it.
  await wait(()=>ui.selectionAssistant.getTarget()?.blockID===b.id,'选区进入编辑对话');assert.equal(ui.selectionAssistant.getTarget().text,before.slice(0,2));key(node,'Tab',{ctrlKey:true});await wait(()=>ui.$('material-search')?.value===keyword(before.slice(0,2)),'按选中文字查找证据');assert.equal(ui.p.blocks.find(x=>x.id===b.id).text,before);
  click(ui.$('left-tabs'),'论文结构');let row=outlineRow(b.id);row.click();key(row,'F2');assert.isTrue(ui.$('popover').open);edit(ui.$('popover-content').querySelector('input'),'研究主题说明');click(ui.$('popover-content'),'保存名称');assert.equal(ui.p.blocks.find(x=>x.id===b.id).title,'研究主题说明');key(ui.$('canvas'),'z',{ctrlKey:true});assert.equal(ui.p.blocks.find(x=>x.id===b.id).title,title);
  row=outlineRow(b.id);row.click();const order=ui.p.blocks.map(x=>x.id),index=order.indexOf(b.id);key(row,index>0?'ArrowUp':'ArrowDown',{altKey:true});assert.notDeepEqual(ui.p.blocks.map(x=>x.id),order);key(ui.$('canvas'),'z',{ctrlKey:true});assert.deepEqual(ui.p.blocks.map(x=>x.id),order);
  const rows=[...ui.$('library').querySelectorAll('.outline-content[data-outline-block]')],n=ui.p.blocks.length;rows[0].click();rows[1].dispatchEvent(new w.MouseEvent('click',{bubbles:true,ctrlKey:true}));assert.lengthOf(ui.p.ui.selectedBlocks,2);key(rows[1],'c',{ctrlKey:true});key(ui.$('canvas'),'v',{ctrlKey:true});assert.equal(ui.p.blocks.length,n+2);key(ui.$('canvas'),'z',{ctrlKey:true});assert.equal(ui.p.blocks.length,n);
  const sectionID=b.sectionID,inside=ui.p.blocks.filter(x=>x.sectionID===sectionID).map(x=>x.id),sections=ui.p.sections.length,materials=ui.p.materials.length;ui.$('library').querySelector(`.outline-section[data-section="${sectionID}"] .outline-section-name`).click();
  key(ui.$('library').querySelector(`.outline-section[data-section="${sectionID}"] .outline-section-name`),'Delete');assert.include(ui.$('popover-content').textContent,'子模块');click(ui.$('popover-content'),'移除章节及子模块');
  assert.isFalse(ui.p.sections.some(s=>s.id===sectionID));assert.isFalse(ui.p.blocks.some(x=>inside.includes(x.id)));assert.equal(ui.p.materials.length,materials);key(ui.$('canvas'),'z',{ctrlKey:true});assert.equal(ui.p.sections.length,sections);assert.sameMembers(ui.p.blocks.filter(x=>x.sectionID===sectionID).map(x=>x.id),inside);await ui.persist({flush:true});
 });
 it('looks up material-frame evidence with Ctrl+Tab and keeps source-check and canvas context actions undoable',async function(){
  const w=frame.contentWindow,b=topicBlock(),before=b.text;ui.selectBlock(b.id);ui.renderEditor();const card=ui.$('canvas').querySelector(`[data-assembly="${b.id}"]`);assert.exists(card,'素材框');const editor=card.querySelector('.editable');editor.focus();if(w.getSelection().rangeCount)w.getSelection().collapseToStart();
  editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',ctrlKey:true,bubbles:true,cancelable:true}));await wait(()=>ui.$('material-search')?.value===keyword(before),'素材框查找证据');assert.equal(ui.p.blocks.find(x=>x.id===b.id).text,before);assert.equal(win.Zotero_Tabs.selectedType,'manuscript');await capture('11-card-evidence-lookup.png');
  const box=ui.$('canvas').querySelector(`[data-assembly="${b.id}"]`);box.dispatchEvent(new w.PointerEvent('pointerenter'));assert.isTrue(ui.$('canvas').classList.contains('reveal-materials'));box.dispatchEvent(new w.PointerEvent('pointerleave'));ui.$('material-search').focus();await Zotero.Promise.delay(350);assert.isFalse(ui.$('canvas').classList.contains('reveal-materials'));
  // 来源核查 lists each use of a source; its context menu unlinks that use, and Ctrl+Z restores it.
  const materialID=b.materials[0].id;click(ui.$('left-tabs'),'来源核查');const use=ui.$('library').querySelector(`.evidence-source-card[data-material="${materialID}"] .evidence-use[data-outline-block="${b.id}"]`);assert.exists(use,'来源核查中的使用位置');
  use.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:230}));assert.exists(w.document.getElementById('navigation-context'));await capture('12-source-use-context.png');click(w.document.getElementById('navigation-context'),'解除这处来源关联');
  assert.isFalse(ui.p.blocks.find(x=>x.id===b.id).materials.some(x=>x.id===materialID));assert.equal(ui.p.blocks.find(x=>x.id===b.id).review,'missing');key(ui.$('canvas'),'z',{ctrlKey:true});assert.isTrue(ui.p.blocks.find(x=>x.id===b.id).materials.some(x=>x.id===materialID));
  const count=ui.p.blocks.length,block=ui.$('canvas').querySelector(`[data-id="${b.id}"]`);block.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:420,clientY:300}));assert.exists(w.document.getElementById('assembly-context'));await capture('13-block-context.png');click(w.document.getElementById('assembly-context'),'删除模块 · Delete');
  assert.isFalse(ui.p.blocks.some(x=>x.id===b.id));key(ui.$('canvas'),'z',{ctrlKey:true});assert.isTrue(ui.p.blocks.some(x=>x.id===b.id));assert.equal(ui.p.blocks.length,count);await ui.persist({flush:true});
 });
 it('verifies source-linked modules and exports Word with editable OMML and table XML from the visible buttons',async function(){
  ui.selectionAssistant.showDetails();
  for(const id of ui.p.blocks.filter(b=>b.materials.length).map(b=>b.id)){ui.selectBlock(id);const verify=ui.$('details').querySelector('[data-action=verify-module]');assert.exists(verify,'核验依据');assert.isFalse(verify.disabled);verify.click();await wait(()=>ui.$('popover').open,'逐条核对当前模块');click(ui.$('popover-content'),'来源支持当前内容，标记已核验');assert.equal(ui.p.blocks.find(b=>b.id===id).review,'verified');}
  insert('公式');await wait(()=>ui.p.blocks.some(b=>b.type==='formula')&&ui.$('details').querySelector('.formula-latex-input'),'插入公式');edit(ui.$('details').querySelector('.formula-latex-input'),'E=mc^2','change');await wait(()=>ui.p.blocks.find(b=>b.type==='formula').text==='E=mc^2','保存公式');
  R.pick=async()=>PathUtils.join(folder,'03-bound-table.png');try{insert('图片');await wait(()=>ui.p.blocks.some(b=>b.type==='image'),'插入图片');}finally{R.pick=prior.pick;}
  const opened=[];Zotero.launchFile=path=>{opened.push(path);};let output;
  try{
   R.pick=async()=>folder;try{ui.lastExport=null;ui.$('export').click();await wait(()=>ui.busy||ui.lastExport,'开始导出 Word');await wait(()=>!ui.busy,'导出 Word',3000);assert.exists(ui.lastExport,ui.$('status').textContent);output=ui.lastExport.path;}finally{R.pick=prior.pick;}
   assert.match(output,/\.docx$/);assert.isTrue(await IOUtils.exists(output));const zip=Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);zip.open(Zotero.File.pathToFile(output));
   try{const stream=zip.getInputStream('word/document.xml'),xml=await Zotero.File.getContentsAsync(stream);stream.close();assert.include(xml,'m:oMath');assert.include(xml,'w:tbl');assert.include(xml,'w:tcBorders');assert.include(xml,'w:vAlign');assert.include(xml,'受控验收数据');assert.isTrue(zip.hasEntry('word/header1.xml'));}finally{zip.close();}await capture('14-exported.png');
   // 预览 Word writes a separate copy and opens it.
   ui.lastExport=null;ui.$('preview').click();await wait(()=>ui.busy||ui.lastExport,'开始预览 Word');await wait(()=>!ui.busy,'预览 Word',3000);assert.exists(ui.lastExport,ui.$('status').textContent);assert.notEqual(ui.lastExport.path,output);assert.deepEqual(opened,[ui.lastExport.path]);
  }finally{Zotero.launchFile=prior.launch;}
 });
});
