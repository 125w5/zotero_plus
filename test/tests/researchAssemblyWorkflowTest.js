/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Native assembly four-stage workflow and manuscript assessment',function(){
 this.timeout(180000);
 const E=Zotero.Research,T=ChromeUtils.importESModule('chrome://zotero/content/research/shared/manuscript-assessment.mjs');
 let win,frame,U,projectID,folder,baseline,prior,requests=[];
 const report={type:'真实 Zotero 控件与 assessWhole/exportBundle；受控模型、检索和导出引擎，不调用用户 API；实际 DOCX 另由 Pandoc 测试验收',checks:[]};
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(await fn())return;await Zotero.Promise.delay(50);}throw Error('等待'+label+'超时');};
 const doc=()=>frame.contentDocument;
 const snapshot=async name=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}};
 const prose=()=>JSON.stringify({sections:U.p.sections,blocks:U.p.blocks,materials:U.p.materials});
 const result=()=>({summary:'当前稿件已记录独立采集条件，缺少重复验证与误差分析。',completeness:{percent:45,basis:'正文已有采集条件和变量定义，但尚无独立测量结果。',completed:['记录了独立采集条件'],gaps:['补充独立批次验证'],evidenceIDs:[U.p.blocks[0].id]},remainingHours:{min:3,max:7,basis:'整理批次记录、独立测量和误差分析需要三项工作。',assumptions:['原始数据与设备已经可用']},journal:{tier:'可先考虑领域应用型期刊',basis:'受控实际检索记录给出了同领域应用研究的对照。',conditions:['完成独立验证后再比较实验设计'],evidenceIDs:['benchmark-1']},plan:[{title:'核对数据划分',action:'在当前方法段补充独立采集批次的划分原则。',deliverable:'方法段包含批次划分与重叠检查。',check:'训练与验证批次不重叠。',hours:{min:3,max:7},tool:'manual_write',blockIDs:[U.p.blocks[0].id],materialIDs:[U.p.materials[0].id],evidenceIDs:[U.p.blocks[0].id,U.p.materials[0].id]}]});
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1500,1000);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'assembly-workflow-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const p=await E.manuscripts.create('全文评估与导出受控验收 '+Date.now());projectID=p.id;await E.manuscripts.open(projectID);
  await wait(()=>{frame=win.document.getElementById('manuscript-'+projectID);U=frame?.contentWindow.ManuscriptUI;return U?.ready;},'装配页面');
  U.p.sections=U.p.sections.slice(0,1);const m=U.M.material({title:'人工采集记录',sourceText:'训练与验证来自独立采集批次。',summary:'记录采集批次与数据划分。',kind:'experiment'});U.p.materials=[m];
  U.p.blocks=[U.M.block('paragraph',U.p.sections[0].id,{text:'人工正文保留：训练与验证来自独立采集批次。变量 \\(x_i\\) 表示采集结果。',materials:[{id:m.id,role:'primary',revision:m.revision}]})];U.p.ui.blockID=U.p.blocks[0].id;U.p.ui.sectionID=U.p.sections[0].id;U.changed({editor:true});await U.persist({flush:true});baseline=U.M.clone(U.p);
  prior={request:E.studio.request,search:E.searchPaperPage,engine:E.runArtifactEngine,pick:E.pick,send:U.sendResearchMessage};
 });
 beforeEach(async()=>{
  requests=[];U.lastExport=null;U.p=U.M.clone(baseline);U.changed({editor:true});await U.persist({flush:true});
  await E.store.update(s=>{delete s.manuscriptAssessments?.[projectID];});
  E.searchPaperPage=async(query,options)=>{requests.push({operation:'search',query,options});return {records:[{title:'Independent batch validation in measurement systems',doi:'10.1000/controlled-benchmark',journal:'Controlled Research Journal',year:'2024',abstract:'The study evaluates batch-independent measurements.'}]};};
  E.studio.request=async(system,input,status,signal,options)=>{requests.push({operation:'assessment',input,options});return {value:result(),model:options.modelConfig.model};};
  E.runArtifactEngine=async request=>{requests.push({operation:request.operation,request:U.M.clone(request)});const plan=request.operation==='manuscript-plan-export';return {path:PathUtils.join(folder,plan?'execution-plan.docx':'manuscript.docx'),directory:folder};};
  E.pick=async()=>folder;U.sendResearchMessage=async text=>{requests.push({operation:'prepare-writing',text});};
  await U.workflow.setStep(0,{focus:false});
 });
 afterEach(async function(){
  E.studio.request=prior.request;E.searchPaperPage=prior.search;E.runArtifactEngine=prior.engine;E.pick=prior.pick;U.sendResearchMessage=prior.send;
  report.checks.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
 });
 after(async()=>{await E.store.flush();win?.close();});
 it('connects the four actual header controls to materials, writing candidates, insertion and verification',async()=>{
  const before=prose(),steps=U.$('steps');assert.deepEqual(Array.from(steps.children,b=>b.textContent.slice(1)),['素材选择','装配正文','插入图表','验证导出']);
  steps.children[1].click();await wait(()=>requests.some(r=>r.operation==='prepare-writing'),'写作速读请求');assert.include(requests.find(r=>r.operation==='prepare-writing').text,'写作速读');assert.equal(U.p.ui.left,'structure');assert.equal(prose(),before);
  steps.children[2].click();await wait(()=>U.p.ui.step===2&&!U.$('workflow-panel').hidden,'插入工具');assert.lengthOf(U.$('workflow-panel').querySelectorAll('[data-insert-type]'),3);await snapshot('workflow-four-stages-and-insertion');
  steps.children[3].click();await wait(()=>U.p.ui.step===3&&Array.isArray(U.workflow.issues),'全文检查');assert.exists(U.$('workflow-panel').querySelector('.workflow-assess'));
  steps.children[0].click();await wait(()=>U.p.ui.step===0,'选择素材');assert.equal(U.p.ui.left,'materials');assert.isTrue(U.$('workflow-panel').hidden);assert.equal(prose(),before);
 });
 it('inserts an editable formula through its actual control and reveals the formula inspector',async()=>{
  await U.workflow.setStep(2,{focus:false});U.$('workflow-panel').querySelector('[data-insert-type=formula]').click();
  await wait(()=>U.p.blocks.some(b=>b.type==='formula'),'公式插入');assert.isTrue(U.$('workflow-panel').hidden);assert.isFalse(U.$('details').hidden);
  const b=U.p.blocks.find(b=>b.type==='formula');assert.equal(b.type,'formula');assert.notProperty(b,'imagePath');assert.equal(U.p.blocks.find(row=>row.id===baseline.blocks[0].id).text,baseline.blocks[0].text);
 });
 it('keeps a real remote failure visible without creating a fake assessment or changing authored prose',async()=>{
  const before=prose();E.studio.request=async()=>{throw Error('HTTP 400 受控远程失败');};await U.workflow.setStep(3,{focus:false});U.$('workflow-panel').querySelector('.workflow-assess').click();
  await wait(()=>U.$('workflow-panel').textContent.includes('HTTP 400'),'真实错误显示');assert.isNull(U.A.assessment(projectID));assert.isTrue(U.$('workflow-panel').querySelector('.workflow-export-bundle').disabled);assert.equal(prose(),before);
 });
 it('assesses the full current source snapshot with the selected model and opens an executable plan step',async()=>{
  const before=prose(),session=U.conversationSession;await U.conversations.update(session.id,{modelID:'controlled-selected-model',thinkingLevel:'high'},{origin:'assembly'});
  await U.workflow.setStep(3,{focus:false});U.$('workflow-panel').querySelector('.workflow-assess').click();await wait(()=>T.isCurrentAssessment(U.p,U.A.assessment(projectID)),'保存评估');
  const call=requests.find(r=>r.operation==='assessment');assert.equal(call.options.modelConfig.model,'controlled-selected-model');assert.equal(call.options.modelConfig.thinkingLevel,'high');assert.equal(call.input.manuscript.blocks[0].text,baseline.blocks[0].text);assert.equal(call.input.sources[0].text,baseline.materials[0].sourceText);assert.equal(U.A.assessment(projectID).benchmarks[0].doi,'10.1000/controlled-benchmark');await snapshot('workflow-whole-assessment-and-execution-plan');
  U.$('workflow-panel').querySelector('[data-plan-task]').click();await wait(()=>U.$('workflow-panel').hidden,'执行手动写作步骤');assert.equal(U.p.ui.blockID,baseline.blocks[0].id);assert.exists(doc().querySelector('.block.selected'));assert.equal(prose(),before);
 });
 it('exports both Word documents from the actual verification action without replacing the manuscript with the plan',async()=>{
  const before=prose();await U.workflow.setStep(3,{focus:false});await U.workflow.assessWhole();U.$('workflow-panel').querySelector('.workflow-export-bundle').click();
  await wait(()=>U.lastExport?.planPath,'双文档导出');assert.match(U.lastExport.path,/manuscript\.docx$/);assert.match(U.lastExport.planPath,/execution-plan\.docx$/);assert.notEqual(U.lastExport.path,U.lastExport.planPath);
  const manuscript=requests.find(r=>r.operation==='manuscript-export'),plan=requests.find(r=>r.operation==='manuscript-plan-export');assert.equal(manuscript.request.project.blocks[0].text,baseline.blocks[0].text);assert.include(plan.request.project.title,'执行方案');assert.ok(plan.request.project.blocks.some(b=>b.text.includes('训练与验证批次不重叠')));assert.equal(prose(),before);
  U.p.blocks[0].text+=' 人工新增';U.changed({editor:true});await U.persist({flush:true});U.workflow.render();assert.isTrue(U.$('workflow-panel').querySelector('.workflow-export-bundle').disabled);assert.isFalse(T.isCurrentAssessment(U.p,U.A.assessment(projectID)));
 });
 it('rejects a late assessment when the saved manuscript changes during the request',async()=>{
  E.studio.request=async()=>{await E.store.update(s=>{s.manuscripts[projectID].blocks[0].text+=' 并发人工修改';});return {value:result()};};
  await U.workflow.setStep(3,{focus:false});await U.workflow.assessWhole();assert.isNull(U.A.assessment(projectID));assert.include(U.$('workflow-panel').textContent,'已改变');assert.isTrue(U.$('workflow-panel').querySelector('.workflow-export-bundle').disabled);
 });
});
