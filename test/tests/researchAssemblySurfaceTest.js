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
   await U.workflow.setStep(0,{focus:false});assert.equal(U.p.ui.left,'materials');assert.isFalse(U.$('left').hidden);assert.isTrue(U.$('workflow-panel').hidden);assert.isFalse(U.$('details').hidden);assert.exists(U.$('material-search'));assert.isFalse(U.$('canvas').hidden);assert.include(U.$('direction-workspace').textContent,'导入语料库');
   await U.workflow.setStep(1,{focus:false});assert.equal(U.p.ui.left,'structure');assert.exists(doc().querySelector('[data-outline-block]'));assert.isTrue(U.$('workflow-panel').hidden);assert.isTrue(U.$('canvas').hidden);assert.isFalse(U.$('direction-workspace').hidden);assert.include(U.$('direction-workspace').textContent,'开始方向讨论');
   await U.workflow.setStep(2,{focus:false});assert.isTrue(U.$('workflow-panel').hidden);assert.isFalse(U.$('canvas').hidden);assert.isTrue(U.p.ui.rightOpen);assert.equal(U.$('selection-assistant').dataset.view,'chat');assert.isFalse(U.$('selection-assistant').querySelector('.selection-assistant-pane').hidden);assert.include(U.$('direction-workspace').textContent,'内容导出');assert.notInclude(U.$('direction-workspace').textContent,'整篇调整','whole-draft revision is no longer an entry point');
   await U.workflow.setStep(3,{focus:false});await wait(()=>U.workflow.issues?.length===1,'实际检查结果');assert.equal(U.p.ui.left,'structure');assert.isFalse(U.$('workflow-panel').hidden);assert.isTrue(U.$('details').hidden);assert.include(U.$('workflow-panel').textContent,'受控待核验项');assert.include(U.$('workflow-panel').textContent,'对照来源核验');
   U.$('workflow-panel').querySelector('.workflow-issue').click();assert.equal(U.p.ui.blockID,U.p.blocks[0].id);assert.exists(doc().querySelector('.block.selected'));
   await U.workflow.setStep(3,{focus:false});assert.include(U.$('workflow-panel').textContent,'内容导出');assert.exists(U.$('workflow-panel').querySelector('.workflow-format'));assert.isAbove(checkCount,0);
   assert.isFalse(U.$('steps').hidden);assert.deepEqual([...U.$('steps').querySelectorAll('.assembly-step > span:last-child')].map(node=>node.textContent),['素材装配','方向讨论','速读细调','内容导出']);assert.equal(content(),before);
   await U.workflow.setStep(1,{focus:false});assert.isFalse(U.$('details').hidden);assert.equal(content(),before);
  }finally{U.A.check=oldCheck;await U.workflow.setStep(0,{focus:false});}
 });
 it('aligns process and insertion tools with the canvas centre and gives controls a real hover state',async()=>{
  U.applyPanels();U.writingRibbon.toggle.click();U.$('tools').querySelector('[data-ribbon-tab="insert"]').click();await wait(()=>!U.$('writing-ribbon-drawer').hidden&&U.$('insert-tools').getBoundingClientRect().width>0,'真实插入工具展开');const fw=frame.contentWindow,main=U.$('workspace').querySelector('main').getBoundingClientRect(),steps=U.$('steps').getBoundingClientRect(),tools=U.$('insert-tools').getBoundingClientRect();
  assert.isFalse(U.$('steps').hidden);assert.closeTo((steps.left+steps.right)/2,(main.left+main.right)/2,2);assert.closeTo((tools.left+tools.right)/2,(main.left+main.right)/2,2);
  for(const button of U.$('insert-tools').querySelectorAll(':scope > button')){const style=fw.getComputedStyle(button),range=doc().createRange();range.selectNodeContents(button);const label=range.getBoundingClientRect(),bounds=button.getBoundingClientRect();assert.equal(style.alignItems,'center');assert.equal(style.justifyContent,'center');assert.closeTo((label.left+label.right)/2,(bounds.left+bounds.right)/2,1,'插入文字水平居中');assert.closeTo((label.top+label.bottom)/2,(bounds.top+bounds.bottom)/2,2,'插入文字垂直居中');assert.isNotEmpty(button.title);}
  const card=U.$('library').querySelector('.material');assert.exists(card);assert.isNotEmpty(card.title);assert.isAtLeast(parseFloat(fw.getComputedStyle(card).borderRadius),8);assert.notEqual(fw.getComputedStyle(card).boxShadow,'none');
 });
 it('keeps the sticky material search compact and exposes real domain, keyword and clear actions without changing content',async()=>{
  await U.workflow.setStep(0,{focus:false});U.p.ui.left='materials';U.renderLibrary();
  const fw=frame.contentWindow,library=U.$('library'),bar=library.querySelector('.material-library-controls'),input=U.$('material-search'),toggle=library.querySelector('.search-filter-toggle'),popup=library.querySelector('.search-filter-popover'),before=content(),plan=JSON.stringify(U.p.researchPreparation);
  assert.isAtMost(bar.getBoundingClientRect().height,96,'常驻区保留主搜索与一行工具');
  assert.notEqual(fw.getComputedStyle(bar).backdropFilter,'none');assert.notEqual(fw.getComputedStyle(bar).boxShadow,'none');
  assert.strictEqual(library.querySelector('.material-filter-reset').parentNode,U.$('material-view-controls'),'清空保持常驻');
  toggle.click();assert.isFalse(popup.hidden);
  for(const selector of ['select[aria-label="研究领域"]','input[aria-label="第二关键词"]','.material-fuzzy-toggle','select[aria-label="素材类型"]','select[aria-label="素材排序"]','select[aria-label="论文章节"]','select[aria-label="记录类型"]'])assert.exists(popup.querySelector(selector),selector+'功能保留');
  const domain=popup.querySelector('select[aria-label="研究领域"]');domain.value='physics';domain.dispatchEvent(new fw.Event('change',{bubbles:true}));
  assert.equal(U.p.ui.materialResearchScope.domain,'physics');assert.isTrue(toggle.classList.contains('active'));
  Object.assign(U.p.ui.materialResearchScope,{domain:'Spin transport',topicID:'https://openalex.org/T1234',topicTerms:['spintronics']});library.querySelector('.material-research-filters').sync({force:true});
  const secondary=popup.querySelector('input[aria-label="第二关键词"]');secondary.value='未提交的第二关键词';secondary.dispatchEvent(new fw.Event('input',{bubbles:true}));
  library.querySelector('.material-filter-reset').click();await wait(()=>!U.p.ui.materialResearchScope?.domain&&!input.value&&popup.hidden,'真实清空全部筛选');await Zotero.Promise.delay(240);
  assert.equal(U.p.ui.materialResearchScope.secondaryKeyword,'');assert.isUndefined(U.p.ui.materialResearchScope.topicID);assert.isUndefined(U.p.ui.materialResearchScope.topicTerms);assert.isTrue(U.p.ui.materialResearchScope.fuzzy);assert.isFalse(toggle.classList.contains('active'));assert.equal(content(),before);assert.equal(JSON.stringify(U.p.researchPreparation),plan);
  const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'assembly-compact-material-search.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}
 });
 it('keeps the composer and conversation at the same reading width while save status changes and canvas scrolls',async()=>{
  await E.workbenchConversations.create({title:'排版受控会话',origin:'assembly',projectID,messages:[{role:'user',text:'请核对来源。'},{role:'assistant',text:'人工记录中已有独立批次的来源。'}]});U.openCoauthor();await Zotero.Promise.delay(260);
  const form=U.$('ai-form'),chat=U.$('chat'),before=form.getBoundingClientRect(),cr=chat.getBoundingClientRect(),shell=U.$('ai').querySelector('.ai-center-master').getBoundingClientRect(),main=U.$('workspace').querySelector('main').getBoundingClientRect(),status=U.$('save-status');
  assert.isAbove(before.width,0);assert.isAtMost(before.width,main.width+2);assert.closeTo(before.left,shell.left,2);assert.closeTo(before.width,shell.width,2);const startInset=cr.left-shell.left,endInset=shell.right-cr.right;assert.isAtLeast(startInset,12);assert.isAtMost(startInset,48);assert.isAtLeast(endInset,12);assert.isAtMost(endInset,48);assert.closeTo(startInset,endInset,2,'正文在对话外框内保留对称内边距');
  for(const text of ['核验中…','已保存到本机','保存失败']){status.textContent=text;U.$('canvas').scrollTop+=20;U.$('canvas').dispatchEvent(new frame.contentWindow.Event('scroll'));await Zotero.Promise.delay(250);const after=form.getBoundingClientRect();assert.closeTo(after.left,before.left,1);assert.closeTo(after.width,before.width,1);assert.closeTo(after.bottom,before.bottom,1);}
  assert.equal(frame.contentWindow.getComputedStyle(status).width,'70px');assert.strictEqual(U.$('ai-options').closest('form'),form);assert.strictEqual(U.$('ai-attach').closest('form'),form);
 });
 it('retracts the entire composer to a bottom strip while preserving footer actions, templates and attachment references',async()=>{
  const before=content();await E.workbenchConversations.create({title:'空会话受控验收',origin:'assembly',projectID,messages:[]});U.$('diff').replaceChildren();U.closeCoauthor();await wait(()=>U.$('ai').hidden,'默认收起历史');await Zotero.Promise.delay(260);
  const fw=frame.contentWindow,surface=U.$('assembly-clui-surface'),reveal=surface.querySelector('.clui-native-reveal'),form=U.$('ai-form'),footer=form.closest('footer'),panel=form.querySelector('.prompt-templates'),check=U.$('check'),hit=node=>{const r=node.getBoundingClientRect(),target=doc().elementFromPoint(r.left+r.width/2,r.top+r.height/2);assert.isAbove(r.width,0);assert.isAbove(r.height,0);assert.isTrue(node===target||node.contains(target),'可见控件没有被收起的对话覆盖');};
  assert.equal(surface.dataset.cluiRetracted,'true');assert.equal(U.assemblyCLUI.mode,'compact');assert.closeTo(reveal.getBoundingClientRect().height,30,1);hit(reveal);assert.equal(fw.getComputedStyle(form).display,'none');assert.isTrue(form.inert);assert.isTrue(U.$('ai').inert);assert.isFalse(footer.inert);hit(check);assert.isNull(U.$('footer-actions').closest('[inert]'));
  reveal.click();await wait(()=>U.assemblyCLUI.mode==='conversation'&&!U.$('ai').hidden,'底条唤起');await Zotero.Promise.delay(260);assert.isTrue(reveal.hidden);assert.isFalse(form.inert);assert.isAbove(form.getBoundingClientRect().height,0);assert.isTrue(panel.hidden,'唤起不强制打开模板');
  panel.hidden=false;U.$('ai-attachments').hidden=false;U.$('ai-attachments').textContent='受控附件';U.closeCoauthor();await wait(()=>U.$('ai').hidden,'收起历史与输入');assert.isTrue(panel.hidden);assert.equal(fw.getComputedStyle(form).display,'none');assert.isTrue(form.inert);assert.equal(U.$('ai-attachments').getBoundingClientRect().height,0);hit(reveal);hit(check);assert.lengthOf(doc().querySelectorAll('#ai-prompt'),1);assert.equal(U.$('ai-attachments').textContent,'受控附件','显示状态变化不删除附件');assert.equal(content(),before);U.$('ai-attachments').replaceChildren();U.$('ai-attachments').hidden=true;
 });
 it('anchors the shared model and reasoning controls to the bottom input without opening or moving the chat card',async()=>{
  U.openCoauthor();await Zotero.Promise.delay(260);const before=content(),surface=U.conversationSurface,oldModels=E.workbenchModels;E.workbenchModels=async()=>[{id:'controlled-bottom-model',label:'受控底栏模型'}];surface.hide();const geometry=JSON.stringify(surface.state),anchor=U.$('ai-options');
  try{
   anchor.click();const popup=doc().getElementById('easysch-conversation-preferences');await wait(()=>!popup.hidden&&popup.querySelector('[data-model="controlled-bottom-model"]'),'底栏模型菜单');assert.isFalse(surface.isOpen);assert.equal(JSON.stringify(surface.state),geometry);assert.isFalse(popup.querySelector('.conversation-surface-model-options').hidden);assert.isFalse(popup.querySelector('.conversation-surface-strength-options').hidden);
   const bounds=popup.getBoundingClientRect(),ar=anchor.getBoundingClientRect();assert.isAtMost(bounds.bottom,ar.top-5);assert.isAtLeast(bounds.left,0);assert.isAtMost(bounds.right,frame.contentWindow.innerWidth);assert.lengthOf(doc().querySelectorAll('.conversation-surface'),1);
   popup.querySelector('[data-model="controlled-bottom-model"]').click();await wait(()=>U.conversationSession.modelID==='controlled-bottom-model','共享模型偏好');assert.isTrue(popup.hidden);assert.isFalse(surface.isOpen);
   anchor.click();popup.querySelector('[data-strength="medium"]').click();await wait(()=>U.conversationSession.thinkingLevel==='medium','共享推理强度');assert.isFalse(surface.isOpen);assert.isTrue(popup.hidden);
   anchor.click();const focused=popup.querySelector('button');focused.focus();focused.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.isTrue(popup.hidden);assert.strictEqual(doc().activeElement,U.$('ai-prompt'));
   anchor.click();U.$('canvas').dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown',{bubbles:true,button:0}));assert.isTrue(popup.hidden);assert.equal(content(),before);
  }finally{E.workbenchModels=oldModels;surface.hideOptions();}
 });
 it('keeps material assembly as the writing surface without an independent writing-plan entrance',async()=>{
  const before=content();await U.workflow.setStep(0,{focus:false});U.p.ui.left='structure';U.renderLibrary();assert.notExists(doc().querySelector('[data-action=open-writing-plan]'));assert.notExists(doc().querySelector('[data-action=toggle-writing-plan]'));assert.notExists(U.$('paper-writing-workflow'));assert.exists(doc().querySelector('[data-action=match-material-sections]'));assert.equal(content(),before);
 });
 it('pins the actual feasibility plan beside the current chapter and restores the original right panel',async()=>{
  const before=content(),preparation=U.M.clone(U.p.researchPreparation||null);U.p.researchPreparation={researchGoal:'按独立批次验证识别方法',plan:{title:'独立批次验证',feasibility:'已有独立批次记录',novelty:'明确跨批次适用范围',minimumValidation:'先核查来源，再比较基线',experiments:[{id:'E1',title:'独立批次基线比较'}]}};
  try{await U.workflow.setStep(1,{focus:false});const guidance=doc().querySelector('.direction-guidance');for(const text of ['按独立批次验证识别方法','已有独立批次记录','明确跨批次适用范围','先核查来源，再比较基线','E1 独立批次基线比较'])assert.include(guidance.textContent,text,'可行性指导显示实际方案：'+text);const original=U.$('right').getBoundingClientRect();guidance.querySelector('.preparation-guidance-heading button').click();await wait(()=>doc().body.dataset.preparationPinned==='true','固定方案');assert.equal(guidance.dataset.pinned,'true');assert.closeTo(U.$('right').getBoundingClientRect().width,original.width,1);assert.equal(frame.contentWindow.getComputedStyle(U.$('details')).visibility,'hidden');guidance.querySelector('.preparation-guidance-heading button').click();await wait(()=>doc().body.dataset.preparationPinned==='false','取消方案固定');assert.equal(content(),before);}finally{if(preparation)U.p.researchPreparation=preparation;else delete U.p.researchPreparation;U.p.ui.preparationPinned=false;await U.workflow.setStep(0,{focus:false});}
 });
 it('keeps ribbon groups on one horizontal track when the editor narrows',async()=>{
  const tools=U.$('tools'),manual=U.$('manual-writing-tools');U.writingRibbon.setTab('home');const widths=[...manual.querySelectorAll('.writing-format-group')].map(node=>node.getBoundingClientRect().width);
  try{win.resizeTo(1100,1000);await Zotero.Promise.delay(300);U.writingRibbon.setTab('home');const groups=[...manual.querySelectorAll('.writing-format-group')],tops=groups.map(node=>node.getBoundingClientRect().top);assert.isAtMost(Math.max(...tops)-Math.min(...tops),1,'分组不换行');groups.forEach((node,index)=>assert.closeTo(node.getBoundingClientRect().width,widths[index],1,'保持分组宽度'));assert.isAbove(manual.scrollWidth,manual.clientWidth,'窄窗以横向滚动访问全部工具');}finally{win.resizeTo(1600,1000);U.writingRibbon.collapse({force:true});}
 });

});
