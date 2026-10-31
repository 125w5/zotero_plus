/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The four-stage flow (ui.assemblyFlowVersion 2) replaced the per-section 写作速读 panel of
// the module details with chapter reads (装配速读): 生成装配速读 in 素材装配 builds them and
// the 速读细调 canvas shows and refines them (docs/handoff-2026-10-30/writing-flow-v3-spec.md).
describe('Four-stage chapter reads on the assembly canvas and complete-material highlights',function(){
 this.timeout(150000);const E=Zotero.Research;
 let win,frame,U,id,baseline,folder,prior,calls=[];
 const report={type:'真实 Gecko 界面、持久化及受控 AI 回复；不证明真实模型内容质量',checks:[]};
 const detail=()=>[U?.$('status')?.textContent||'',...(U?.chapterReads?[...U.chapterReads.errors().values()].map(row=>row.message):[])].filter(Boolean).join('；');
 const wait=async(fn,label='装配速读')=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(30);}throw Error('等待'+label+'超时：'+detail());};
 const fw=()=>frame.contentWindow,doc=()=>frame.contentDocument;
 const clickComplete=async node=>{const handler=node.onclick;let task;node.onclick=function(event){task=Promise.resolve(handler.call(this,event));return task;};try{node.click();assert.ok(task,'真实点击调用异步保存处理');let timer;try{await Promise.race([task,new Promise((_,reject)=>{timer=win.setTimeout(()=>reject(Error('保存标注处理超过10秒')),10000);})]);}finally{win.clearTimeout(timer);}}finally{node.onclick=handler;}};
 const screenshot=async name=>{await new Promise(resolve=>fw().requestAnimationFrame(()=>fw().requestAnimationFrame(resolve)));const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}};
 const records=()=>JSON.stringify({blocks:U.p.blocks,materials:U.p.materials});
 const chapters=()=>U.p.sections.map(row=>row.id),saved=()=>U.A.readingsView(id)?.chapters||{};
 const settled=count=>Object.keys(saved()).length===count&&!U.busy&&!U.chapterReads.running;
 const openRead=async()=>{await U.chapterReads.refresh({onlyStale:true});await wait(()=>settled(2),'各章速读');await U.workflow.setStep(2,{focus:false});U.chapterReads.setView('read');await wait(()=>U.$('canvas').querySelector('.assembly-read-article [data-read-node] .framework-narrative'),'速读画布');};
 // A controlled chapter-read reply: one point bound to a real excerpt of a linked project
 // material and one gap. A regenerated point reuses the id of the previous point with its role.
 const readValue=input=>{
  const quote=input.evidenceExcerpts.find(row=>/^digest-source-/.test(row.sourceID)),previous=role=>input.previousNodes?.find(row=>row.role===role)?.id,update=input.previousNodes?.length?'局部更新：':'';
  return {brief:{text:'本章交代已有条件，并指出噪声条件尚待验证。',quoteIDs:quote?[quote.quoteID]:[]},
   nodes:[...(quote?[{id:previous('evidence'),role:'evidence',status:'supported',claim:'已有实验只覆盖干净的输入条件',narrative:update+'已有方法只在干净条件下检验，原文记录了独立批次，但没有评估含噪声的输入。这些材料可以交代已知条件和研究边界；噪声条件下的表现仍待验证，引用时保留原作者的归属，不能写成已经完成的结果。',quoteIDs:[quote.quoteID]}]:[]),
    {id:previous('gap'),role:'gap',status:'missing',claim:'缺少噪声条件下的对照',narrative:update+'目前没有噪声条件下的对照记录，结论只能限定在已检验的干净条件内。',quoteIDs:[]}],
   gaps:[{text:'补充噪声条件下的独立对照记录',kind:'experiment'}]};
 };
 before(async()=>{
  prior={request:E.studio.request,settings:E.settings,sync:E.manuscripts.syncLibrary,translate:E.quickTranslate};
  E.manuscripts.syncLibrary=async()=>{};
  try{win=await loadZoteroPane();await E.attachWindow(win);win.restore?.();win.resizeTo(1600,1000);const project=await E.manuscripts.create('噪声识别的装配速读验收 '+Date.now());id=project.id;await E.manuscripts.open(id);await wait(()=>{frame=win.document.getElementById('manuscript-'+id);U=frame?.contentWindow.ManuscriptUI;return U?.ready&&U.workflow&&U.chapterReads;});}finally{E.manuscripts.syncLibrary=prior.sync;}
  folder=PathUtils.join(Zotero.DataDirectory.dir,'writing-digest-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  U.p.sections=U.p.sections.slice(0,2);U.p.sections[0].title='引言';U.p.sections[1].title='方法';
  U.p.materials=[U.M.material({id:'digest-source-a',kind:'semantic',title:'已有方法的完整条件段',sectionType:'方法',sourceText:'Existing models were tested only under clean conditions. The authors report an independent batch. No noisy input was evaluated.',summary:'已有实验使用干净条件，未验证噪声。'}),U.M.material({id:'digest-source-b',kind:'semantic',title:'数据场景的完整段落',sectionType:'引言',sourceText:'The data were collected from independent batches. The threshold was selected on held-out validation data.',summary:'采集批次和阈值选择条件。'})];
  U.p.blocks=[U.M.block('paragraph',U.p.sections[0].id,{text:'研究背景：识别系统面临不同的输入条件。',materials:[{id:'digest-source-a',role:'primary'}]}),U.M.block('paragraph',U.p.sections[0].id,{text:'研究问题：噪声条件下的表现仍待验证。',materials:[{id:'digest-source-b',role:'support'}]}),U.M.block('paragraph',U.p.sections[1].id,{text:'方法草稿：拟设置独立数据划分。',materials:[{id:'digest-source-b',role:'primary'}]})];
  U.p.ui.sectionID=U.p.sections[0].id;U.p.ui.blockID=U.p.blocks[0].id;U.p.ui.rightOpen=true;U.p.ui.canvasDisplay='materials';U.changed({editor:true});U.applyPanels();await U.persist({flush:true});baseline=U.M.clone(U.p);
 });
 beforeEach(async()=>{
  calls=[];U.readAbort?.abort();await wait(()=>!U.chapterReads.running,'上一项速读结束');await U.chapterReads.flush().catch(()=>{});
  await E.store.update(state=>{delete state.projectReadings?.[id];delete state.projectTaskPlans?.[id];});U.chapterReads.invalidate();
  U.p=U.M.clone(baseline);U.previewMaterialID=null;fw().getSelection().removeAllRanges();await E.notebook.update(id,{selectedMaterial:null,query:''});U.busy=false;U.frameworkBusy=false;U.changed({editor:true});await U.workflow.setStep(0,{focus:false});await U.persist({flush:true});
  E.settings=()=>({...prior.settings(),endpoint:'https://fixture.invalid/v1',model:'writing-digest-fixture'});
  E.quickTranslate=async()=>({text:'受控中文译文。'});
  E.studio.request=async(system,input,progress,signal,options)=>{calls.push({input:U.M.clone(input),options:U.M.clone(options)});return {model:'writing-digest-fixture',value:readValue(input)};};
  await U.conversations.update(U.conversationSession.id,{modelID:'writing-digest-fixture',thinkingLevel:'high',executionMode:'auto'},{origin:'assembly'});
 });
 afterEach(async function(){E.studio.request=prior.request;E.settings=prior.settings;E.quickTranslate=prior.translate;report.checks.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});if(this.currentTest.state==='failed')await screenshot('failure-'+report.checks.length);await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{E.studio.request=prior.request;E.settings=prior.settings;E.quickTranslate=prior.translate;E.manuscripts.syncLibrary=prior.sync;win.Zotero_Tabs.close('manuscript-'+id);await E.manuscripts.remove(id);await E.store.update(state=>{delete state.projectReadings?.[id];delete state.projectTaskPlans?.[id];});await E.store.flush();win.close();});
 it('keeps native item sorting usable before column registration has completed',()=>{const sort=win.ZoteroPane.itemsView.getSortField;assert.equal(sort.call({isFeedsOrFeed:()=>false,_getColumns:()=>[]}), 'title');assert.equal(sort.call({isFeedsOrFeed:()=>false,_getColumns:()=>[{dataKey:'title',hidden:true}]}),'title');assert.equal(sort.call({isFeedsOrFeed:()=>false,_getColumns:()=>[{dataKey:'title',hidden:true},{dataKey:'date',hidden:false}]}),'date');});
 it('builds an evidence-bound read for each chapter from 生成装配速读 in 素材装配 without changing the manuscript',async()=>{
  // Table data counts as the user's written text, never as source evidence.
  const table=U.p.blocks[2];table.type='table';table.text='';table.table=U.M.makeTable(2,2);table.table.rows[0][0].text='Accuracy';table.table.rows[0][1].text='90%';U.changed({editor:true});await U.persist({flush:true});U.directionWorkspace.render();
  const before=records(),[intro,method]=chapters(),entry=doc().querySelector('#direction-workspace [data-action=chapter-read]');assert.exists(entry,'素材装配阶段提供生成入口');assert.equal(entry.textContent,'生成装配速读');
  entry.click();await wait(()=>settled(2)&&U.p.ui.step===1&&U.$('canvas').hidden&&[...doc().querySelectorAll('#direction-workspace button')].some(button=>button.textContent==='开始方向讨论'),'生成各章速读并进入方向讨论');
  assert.equal(records(),before,'生成速读不改正文和素材');assert.lengthOf(calls,2,'每章一次请求');assert.deepEqual(calls.map(call=>call.input.targetSection),['引言','方法']);assert.deepEqual(calls.map(call=>call.input.rule.type),['引言','方法']);
  for(const call of calls){assert.equal(call.options.aiAction,'evidence_organize');assert.equal(call.options.modelPurpose,'framework');assert.equal(call.options.modelConfig.model,'writing-digest-fixture');assert.equal(call.options.modelConfig.thinkingLevel,'high');assert.equal(call.input.task,'按本章任务整理详细、有原文依据的中文装配速读');assert.isAbove(call.input.evidenceExcerpts.length,0);assert.isFalse(call.input.evidenceExcerpts.some(row=>row.sourceID.startsWith('author:')),'已写正文不作为原文摘录');}
  assert.includeMembers(calls[0].input.sources.map(row=>row.id),['digest-source-a','digest-source-b']);assert.include(calls[1].input.sources.map(row=>row.id),'digest-source-b');assert.notInclude(calls[1].input.sources.map(row=>row.id),'digest-source-a','只发送本章关联的素材');
  assert.deepEqual(calls[0].input.authored.map(row=>row.id),[U.p.blocks[0].id,U.p.blocks[1].id]);assert.include(calls[1].input.authored[0].text,'90%','表格数据作为本章已写正文');assert.isFalse(calls[1].input.evidenceExcerpts.some(row=>row.quote.includes('90%')));
  const point=saved()[intro].nodes.find(row=>row.status==='supported');assert.exists(point,'有依据的要点绑定原文');assert.include(['digest-source-a','digest-source-b'],point.evidence[0].materialID);assert.equal(point.narrative,readValue(calls[0].input).nodes[0].narrative,'保存经核对的完整说明');assert.exists(saved()[method]);await screenshot('chapter-read-generated');
 });
 it('shows every chapter on the read canvas and keeps 核对原文 and source clicks inside the material details',async()=>{
  await openRead();const [intro]=chapters(),article=U.$('canvas').querySelector('.assembly-read-article');assert.lengthOf(article.querySelectorAll('.assembly-read-chapter[data-framework-section]'),2,'各章在同一画布中连续显示');assert.equal(U.p.ui.assemblyView,'read');
  const chip=article.querySelector('[data-framework-section="'+intro+'"] .assembly-read-evidence');assert.exists(chip,'有依据的要点显示原文来源');const item=chip.closest('[data-read-node]'),node=saved()[intro].nodes.find(row=>row.id===item.dataset.readNode),source=node.evidence[0];assert.isAbove(item.getBoundingClientRect().width,240);assert.include(item.querySelector('.framework-narrative').textContent,node.narrative);
  chip.click();const menu=doc().querySelector('.assembly-read-menu');assert.exists(menu,'单击来源打开核对原文');assert.include(menu.querySelector('blockquote').textContent,source.quote);assert.lengthOf(calls,2,'核对原文不调用模型');
  [...menu.querySelectorAll('button')].find(row=>row.textContent==='查看素材').click();await wait(()=>U.previewMaterialID===source.materialID&&U.$('details').querySelector('.material-overview'),'素材详情');
  assert.notExists(doc().querySelector('.assembly-read-menu'));assert.equal(U.p.ui.assemblyView,'read');assert.exists(U.$('canvas').querySelector('.assembly-read-article'),'查看素材不离开速读画布');await screenshot('chapter-read-source-detail');
 });
 it('edits a read point by double click as an overlay and shows a regenerated version as a red/green update before adoption',async()=>{
  await openRead();const before=records(),[intro]=chapters(),point=()=>U.$('canvas').querySelector('[data-framework-section="'+intro+'"] [data-read-node]'),nodeID=point().dataset.readNode,mine='我自己的速读：先限定研究问题，再安排噪声条件的对照。';
  point().querySelector('.framework-narrative').dispatchEvent(new (fw().MouseEvent)('dblclick',{bubbles:true,cancelable:true}));const area=point().querySelector('textarea');assert.exists(area,'双击要点原位编辑');area.value=mine;[...point().querySelectorAll('button')].find(row=>row.textContent==='保存').click();await U.chapterReads.flush();
  await wait(()=>U.A.readingsView(id)?.edits?.[intro]?.[nodeID]?.text===mine,'保存人工修改');assert.include(point().querySelector('.framework-narrative').textContent,mine);assert.exists(point().querySelector('[data-action=restore-read-node]'),'可恢复 AI 解析');assert.equal(records(),before,'修改速读不改正文');
  const ai=saved()[intro].nodes.find(row=>row.id===nodeID).narrative;U.$('canvas').querySelector('[data-framework-section="'+intro+'"] [data-action=refresh-chapter-read]').click();
  await wait(()=>saved()[intro]?.nodes.find(row=>row.id===nodeID)?.pendingUpdate&&!U.busy&&!U.chapterReads.running,'重新整理本章');assert.lengthOf(calls,3);assert.equal(calls.at(-1).input.targetSection,'引言');assert.isTrue(calls.at(-1).input.previousNodes.some(row=>row.id===nodeID));
  assert.equal(saved()[intro].nodes.find(row=>row.id===nodeID).narrative,ai,'人工修改所依据的 AI 文本保留');assert.equal(U.A.readingsView(id).edits[intro][nodeID].text,mine,'重新整理不覆盖人工修改');
  await wait(()=>point()?.querySelector('.assembly-read-update'),'更新建议');assert.include(point().querySelector('.framework-narrative').textContent,mine,'采用前仍显示人工版本');assert.exists(point().querySelector('.assembly-read-update del'));assert.exists(point().querySelector('.assembly-read-update ins'));assert.equal(U.$('canvas').querySelector('[data-framework-section="'+intro+'"] .assembly-read-state').dataset.state,'update');await screenshot('chapter-read-update-diff');
  point().querySelector('[data-action=accept-read-update]').click();await U.chapterReads.flush();
  await wait(()=>{const node=saved()[intro]?.nodes.find(row=>row.id===nodeID);return node&&!node.pendingUpdate&&node.narrative.startsWith('局部更新');},'采用更新');assert.isUndefined(U.A.readingsView(id).edits?.[intro]?.[nodeID]);await wait(()=>point()&&!point().querySelector('.assembly-read-update')&&point().textContent.includes('局部更新'),'画布显示采用后的速读');assert.equal(records(),before);
 });
 it('marks only the chapter whose text changed as 待更新 and refreshes that chapter alone',async()=>{
  await U.chapterReads.refresh({onlyStale:true});await wait(()=>settled(2),'各章速读');const [intro,method]=chapters(),introRead=JSON.stringify(saved()[intro]);
  U.p.blocks[2].text+=' 另按独立批次划分验证数据。';U.changed();await U.persist({flush:true});assert.lengthOf(calls,2,'编辑正文不调用模型');
  const states=U.A.chapterReadStates(id);assert.equal(states[intro].state,'current');assert.equal(states[method].state,'stale');assert.include(states[method].changed,'authored');
  await U.workflow.setStep(2,{focus:false});U.chapterReads.setView('read');const chip=section=>U.$('canvas').querySelector('[data-framework-section="'+section+'"] .assembly-read-state');await wait(()=>chip(method)?.dataset.state==='stale','方法章显示待更新');assert.equal(chip(intro).dataset.state,'current');
  const before=records();U.$('canvas').querySelector('.assembly-read-toolbar [data-action=chapter-read]').click();await wait(()=>calls.length===3&&!U.busy&&!U.chapterReads.running,'只更新待更新章节');
  const request=calls.at(-1).input;assert.equal(request.targetSection,'方法');assert.notInclude(request.sources.map(row=>row.id),'digest-source-a','不发送其他章节的素材');assert.include(request.authored.map(row=>row.text).join('\n'),'另按独立批次划分验证数据');
  assert.equal(U.A.chapterReadStates(id)[method].state,'current');assert.equal(JSON.stringify(saved()[intro]),introRead,'其他章节速读不变');assert.equal(records(),before,'更新速读不改正文');
 });
 it('answers a request to write part of the paper with the chapter-read route and refreshes only that chapter from the chat action',async()=>{
  const before=records(),[intro,method]=chapters(),answer=await U.sendResearchMessage('帮我写一下这篇论文的研究问题');
  assert.include(answer.text,'不生成论文正文');assert.lengthOf(calls,0,'对话不直接生成速读或正文');assert.equal(records(),before);assert.deepEqual(answer.assemblyActions.map(row=>row.type),['refresh-read','open-plan','prepare-task-plan']);assert.equal(answer.assemblyActions[0].sectionID,intro,'研究问题对应引言的速读');
  try{
   U.openCoauthor();await wait(()=>U.$('chat').querySelector('.assembly-read-actions [data-action="refresh-read"]'),'对话中的速读操作');U.$('chat').querySelector('.assembly-read-actions [data-action="refresh-read"]').click();
   await wait(()=>saved()[intro]&&!U.busy&&!U.chapterReads.running,'从对话更新本章速读');assert.lengthOf(calls,1,'只更新所指章节');assert.equal(calls[0].input.targetSection,'引言');assert.notExists(saved()[method]);assert.equal(records(),before,'速读操作不改正文');
  }finally{U.closeCoauthor();}
 });
 it('keeps a saved whole-material highlight in the stored project and visible in the reopened original text',async()=>{
  // The highlight host reads the selection one task after mouseup (queueSelect in
  // material-highlights.mjs), so the annotation draft appears asynchronously.
  U.materialDetails(U.p.materials[0]);const disclosure=U.$('details').querySelector('.material-source-disclosure');disclosure.open=true;disclosure.dispatchEvent(new (fw().Event)('toggle'));const original=U.$('details').querySelector('.clue-quote,.clue-local-text'),walker=doc().createTreeWalker(original,fw().NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(text.textContent.includes('clean conditions'))break;}assert.exists(text);const start=text.textContent.indexOf('clean conditions'),range=doc().createRange();range.setStart(text,start);range.setEnd(text,start+'clean conditions'.length);fw().getSelection().removeAllRanges();fw().getSelection().addRange(range);original.dispatchEvent(new (fw().MouseEvent)('mouseup',{bubbles:true,button:0}));await wait(()=>U.$('details').querySelector('.material-highlight-draft'),'选区标注框');const draft=U.$('details').querySelector('.material-highlight-draft');assert.exists(draft.querySelector('textarea'),'选区可以标注：'+draft.textContent);draft.querySelector('textarea').value='仅覆盖干净输入，作为引言问题的边界依据。';
  // The store is updated before original-PDF synchronization finishes. Wait
  // for the actual click handler, including its final details render, before
  // reopening the source; otherwise it replaces the DOM under this assertion.
  await clickComplete([...draft.querySelectorAll('button')].find(row=>row.textContent==='保存标注'));
  await wait(()=>U.p.materials[0].highlights?.length===1&&U.A.get(id).materials[0].highlights?.length===1,'保存整段素材标注');assert.lengthOf(U.p.materials,2);assert.equal(U.p.materials[0].sourceText,baseline.materials[0].sourceText,'标注不改整段原文');assert.equal(U.A.get(id).materials[0].highlights[0].quote,'clean conditions');
  U.materialDetails(U.p.materials[0]);const reopened=U.$('details').querySelector('.material-source-disclosure');reopened.open=true;reopened.dispatchEvent(new (fw().Event)('toggle'));
  await wait(()=>{const mark=U.$('details').querySelector('.material-source-disclosure[open] mark.material-local-highlight');return mark?.isConnected&&mark.getBoundingClientRect().width>10;},'原文内部高亮可见');
  const currentSource=()=>U.$('details').querySelector('.material-source-disclosure[open] .material-source-content');
  await wait(()=>{const source=currentSource();return source?.isConnected&&Number(fw().getComputedStyle(source).opacity)>=0.99&&source.getAnimations({subtree:true}).every(animation=>['finished','idle'].includes(animation.playState));},'展开原文动画完成');
  const source=currentSource();assert.isTrue(source.isConnected,'检查当前已挂载的原文');assert.isAtLeast(Number(fw().getComputedStyle(source).opacity),0.99,'展开原文的动画已结束');assert.isAtLeast(Number(fw().getComputedStyle(source.querySelector('.clue-quote,.clue-local-text')).opacity),0.99,'原文文字可见');await screenshot('whole-material-local-highlight');
 });
});
