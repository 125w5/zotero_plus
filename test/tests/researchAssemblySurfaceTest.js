/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Assembly workflow and compact conversation surface',function(){
 this.timeout(180000);
 const E=Zotero.Research;let win,frame,U,folder,projectID,priorSession;
 const report={type:'真实 Zotero DOM / 受控事件与检查数据；不是真人前台操作，不调用模型',checks:[]};
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(await fn())return;await Zotero.Promise.delay(80);}throw Error('等待'+label+'超时');};
 const doc=()=>frame.contentDocument;
 const content=()=>JSON.stringify({sections:U.p.sections,materials:U.p.materials,blocks:U.p.blocks});
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1600,1000);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'assembly-surface-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const p=await E.manuscripts.create('装配界面受控验收 '+Date.now());projectID=p.id;await E.manuscripts.open(projectID);
  await wait(()=>{frame=win.document.getElementById('manuscript-'+projectID);U=frame?.contentWindow.ManuscriptUI;return U?.ready;},'装配页面');
  U.p.sections=U.p.sections.slice(0,1);const material=U.M.material({title:'人工实验记录',summary:'核对独立采集批次与数据划分。',sourceText:'人工记录：训练与测试来自独立批次。',kind:'experiment'});U.p.materials=[material];
  U.p.blocks=[U.M.block('paragraph',U.p.sections[0].id,{text:'人工正文：训练与测试来自独立批次。',materials:[{id:material.id,role:'primary',revision:material.revision}],runs:[{text:'人工正文：',bold:true},{text:'训练与测试来自独立批次。'}]})];U.p.ui.blockID=U.p.blocks[0].id;U.p.ui.sectionID=U.p.sections[0].id;
  U.changed({editor:true});U.applyPanels();await U.persist();priorSession=U.conversationSession.id;
 });
 afterEach(async function(){report.checks.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{if(priorSession)await E.workbenchConversations.select(priorSession);await E.store.flush();win?.close();});
 it('makes each stage change actual tools while preserving all prose and source relationships',async()=>{
  const before=content(),oldCheck=U.A.check;let checkCount=0;
  U.A.check=async()=>{checkCount++;return [{blockID:U.p.blocks[0].id,message:'受控待核验项',severity:'error'}];};
  try{
   await U.workflow.setStep(0,{focus:false});assert.equal(U.p.ui.left,'materials');assert.isFalse(U.$('left').hidden);assert.isTrue(U.$('workflow-panel').hidden);assert.isFalse(U.$('details').hidden);assert.exists(U.$('material-search'));
   await U.workflow.setStep(1,{focus:false});assert.equal(U.p.ui.left,'structure');assert.exists(doc().querySelector('[data-outline-block]'));assert.isTrue(U.$('workflow-panel').hidden);
   await U.workflow.setStep(2,{focus:false});assert.isFalse(U.$('workflow-panel').hidden);assert.lengthOf(U.$('workflow-panel').querySelectorAll('[data-insert-type]'),3);assert.include(U.$('workflow-panel').textContent,'插入图表');
   await U.workflow.setStep(3,{focus:false});await wait(()=>U.workflow.issues?.length===1,'实际检查结果');assert.equal(U.p.ui.left,'structure');assert.isFalse(U.$('workflow-panel').hidden);assert.isTrue(U.$('details').hidden);assert.include(U.$('workflow-panel').textContent,'受控待核验项');assert.include(U.$('workflow-panel').textContent,'对照来源核验');
   U.$('workflow-panel').querySelector('.workflow-issue').click();assert.equal(U.p.ui.blockID,U.p.blocks[0].id);assert.exists(doc().querySelector('.block.selected'));
   await U.workflow.setStep(3,{focus:false});assert.include(U.$('workflow-panel').textContent,'验证导出');assert.exists(U.$('workflow-panel').querySelector('.workflow-format'));assert.isAbove(checkCount,0);
   assert.isFalse(U.$('steps').hidden);assert.lengthOf(U.$('steps').children,4);assert.equal(content(),before);
   await U.workflow.setStep(1,{focus:false});assert.isFalse(U.$('details').hidden);assert.equal(content(),before);
  }finally{U.A.check=oldCheck;await U.workflow.setStep(0,{focus:false});}
 });
 it('aligns process and insertion tools with the canvas centre and gives controls a real hover state',async()=>{
  U.applyPanels();U.$('tools').dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter',{pointerType:'mouse'}));U.$('tools').querySelector('[data-ribbon-tab="insert"]').click();await wait(()=>!U.$('writing-ribbon-drawer').hidden&&U.$('insert-tools').getBoundingClientRect().width>0,'真实插入工具展开');const fw=frame.contentWindow,main=U.$('workspace').querySelector('main').getBoundingClientRect(),steps=U.$('steps').getBoundingClientRect(),tools=U.$('insert-tools').getBoundingClientRect();
  assert.isFalse(U.$('steps').hidden);assert.closeTo((steps.left+steps.right)/2,(main.left+main.right)/2,2);assert.closeTo((tools.left+tools.right)/2,(main.left+main.right)/2,2);
  for(const button of U.$('insert-tools').querySelectorAll(':scope > button')){const style=fw.getComputedStyle(button),range=doc().createRange();range.selectNodeContents(button);const label=range.getBoundingClientRect(),bounds=button.getBoundingClientRect();assert.equal(style.alignItems,'center');assert.equal(style.justifyContent,'center');assert.closeTo((label.left+label.right)/2,(bounds.left+bounds.right)/2,1,'插入文字水平居中');assert.closeTo((label.top+label.bottom)/2,(bounds.top+bounds.bottom)/2,2,'插入文字垂直居中');assert.isNotEmpty(button.title);}
  const card=U.$('library').querySelector('.material');assert.exists(card);assert.isNotEmpty(card.title);assert.isAtLeast(parseFloat(fw.getComputedStyle(card).borderRadius),8);assert.notEqual(fw.getComputedStyle(card).boxShadow,'none');
 });
 it('keeps the composer and conversation at the same reading width while save status changes and canvas scrolls',async()=>{
  await E.workbenchConversations.create({title:'排版受控会话',origin:'assembly',projectID,messages:[{role:'user',text:'请核对来源。'},{role:'assistant',text:'人工记录中已有独立批次的来源。'}]});U.openCoauthor();await Zotero.Promise.delay(260);
  const form=U.$('ai-form'),chat=U.$('chat'),before=form.getBoundingClientRect(),cr=chat.getBoundingClientRect(),status=U.$('save-status');
  assert.isAtMost(before.width,860);assert.closeTo(before.left,cr.left,2);assert.closeTo(before.width,cr.width,2);
  for(const text of ['核验中…','已保存到本机','保存失败']){status.textContent=text;U.$('canvas').scrollTop+=20;U.$('canvas').dispatchEvent(new frame.contentWindow.Event('scroll'));await Zotero.Promise.delay(250);const after=form.getBoundingClientRect();assert.closeTo(after.left,before.left,1);assert.closeTo(after.width,before.width,1);assert.closeTo(after.bottom,before.bottom,1);}
  assert.equal(frame.contentWindow.getComputedStyle(status).width,'70px');assert.strictEqual(U.$('ai-options').closest('form'),form);assert.strictEqual(U.$('ai-attach').closest('form'),form);
 });
 it('uses a short empty history and closes every template and attachment row when collapsed',async()=>{
  await E.workbenchConversations.create({title:'空会话受控验收',origin:'assembly',projectID,messages:[]});U.$('diff').replaceChildren();U.openCoauthor();await Zotero.Promise.delay(260);assert.isAtMost(U.$('ai').getBoundingClientRect().height,113);
  const panel=U.$('ai-form').querySelector('.prompt-templates');panel.hidden=false;U.$('ai-attachments').hidden=false;U.$('ai-attachments').textContent='受控附件';U.closeCoauthor();await wait(()=>U.$('ai').hidden,'收起历史');assert.isTrue(panel.hidden);assert.equal(frame.contentWindow.getComputedStyle(U.$('ai-attachments')).display,'none');assert.isTrue(U.$('ai').inert);assert.isFalse(U.$('ai-form').hidden);assert.lengthOf(doc().querySelectorAll('#ai-prompt'),1);U.$('ai-attachments').replaceChildren();U.$('ai-attachments').hidden=true;
 });
 it('anchors the shared model and reasoning controls to the bottom input without opening or moving the chat card',async()=>{
  const before=content(),surface=U.conversationSurface,oldModels=E.workbenchModels;E.workbenchModels=async()=>[{id:'controlled-bottom-model',label:'受控底栏模型'}];surface.hide();const geometry=JSON.stringify(surface.state),anchor=U.$('ai-options');
  try{
   anchor.click();const popup=doc().getElementById('easysch-conversation-preferences');await wait(()=>!popup.hidden&&popup.querySelector('[data-model="controlled-bottom-model"]'),'底栏模型菜单');assert.isFalse(surface.isOpen);assert.equal(JSON.stringify(surface.state),geometry);assert.isFalse(popup.querySelector('.conversation-surface-model-options').hidden);assert.isFalse(popup.querySelector('.conversation-surface-strength-options').hidden);
   const bounds=popup.getBoundingClientRect(),ar=anchor.getBoundingClientRect();assert.isAtMost(bounds.bottom,ar.top-5);assert.isAtLeast(bounds.left,0);assert.isAtMost(bounds.right,frame.contentWindow.innerWidth);assert.lengthOf(doc().querySelectorAll('.conversation-surface'),1);
   popup.querySelector('[data-model="controlled-bottom-model"]').click();await wait(()=>U.conversationSession.modelID==='controlled-bottom-model','共享模型偏好');assert.isTrue(popup.hidden);assert.isFalse(surface.isOpen);
   anchor.click();popup.querySelector('[data-strength="medium"]').click();await wait(()=>U.conversationSession.thinkingLevel==='medium','共享推理强度');assert.isFalse(surface.isOpen);assert.isTrue(popup.hidden);
   anchor.click();const focused=popup.querySelector('button');focused.focus();focused.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.isTrue(popup.hidden);assert.strictEqual(doc().activeElement,U.$('ai-prompt'));
   anchor.click();U.$('canvas').dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown',{bubbles:true,button:0}));assert.isTrue(popup.hidden);assert.equal(content(),before);
  }finally{E.workbenchModels=oldModels;surface.hideOptions();}
 });
});
