/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {ASSESSMENT_VERSION,assessmentSignature,isCurrentAssessment,manuscriptInventoryText,TASK_STATUS_LABELS} from '../shared/manuscript-assessment.mjs';
import {ASSEMBLY_FLOW_STAGES,migrateAssemblyFlow,assemblyStageIssue,assemblyStageDone} from '../shared/assembly-direction.mjs';
import {THREAD_LABELS} from '../shared/research-thread.mjs';
import {installDirectionWorkspace} from './direction-workspace.mjs';
export const ASSEMBLY_STAGES=ASSEMBLY_FLOW_STAGES;
export function installAssemblyWorkflow(U,{el,button,persist,snapshot,changed,applyPanels,renderNavigation,selectBlock,verifyBlock,status,insertFigure,exportDocuments,findEvidence}){
 migrateAssemblyFlow(U.p);
 const doc=U.$('steps').ownerDocument,panel=U.$('workflow-panel');panel.tabIndex=-1;
 let generation=0,lastSignature='',issues=null,checking=false,assessing=false,error='',updatingNavigation=false;
 const state=()=>Number.isInteger(U.p.ui.step)&&U.p.ui.step>=0&&U.p.ui.step<4?U.p.ui.step:0;
 const assessment=()=>U.A.assessment?.(U.p.id),currentAssessment=()=>isCurrentAssessment(U.p,assessment());
 // A verification render shares one source digest. Earlier writing stages do
 // not need export readiness and must not serialize the complete source corpus.
 const assessmentSnapshot=()=>{const saved=assessment(),signature=assessmentSignature(U.p);return {saved,signature,current:saved?.status==='ready'&&saved.version===ASSESSMENT_VERSION&&saved.signature===signature};};
 const hasContent=()=>U.p.blocks.some(b=>b.text?.trim()||b.type==='table'&&b.table?.rows?.length||b.type==='image'&&b.imagePath);
 // Gate counts from the per-entry readings and task-plan views; no hashing.
 const readCounts=()=>({reads:Object.keys(U.chapterReads?.readings()?.chapters||{}).length,tasks:U.chapterReads?.taskPlan()?.items?.length||0});
 function renderSteps(snapshot){
  const nav=U.$('steps');nav.hidden=false;nav.setAttribute('aria-label','论文装配流程');doc.body.dataset.assemblyStage=String(state());
  if(!nav.children.length)ASSEMBLY_STAGES.forEach((label,index)=>{const control=button('',()=>setStep(index),nav,'assembly-step');control.dataset.step=String(index);control.append(el('span',String(index+1),'assembly-step-number'),el('span',label));control.dataset.tip=['导入语料与论文，按章节关联素材，生成装配速读','结合可行性方案逐个确认方向，再按方向更新速读','按章查看与细调装配速读，也可编辑自己的正文','整理任务计划，导出速读与任务计划；已有正文时可评估与导出'][index];control.title=control.dataset.tip;});
  const reads=readCounts(),done=assemblyStageDone(U.p,{readsCurrent:U.chapterReads?.readsCurrent()||false,readExported:U.chapterReads?.exportCurrent()||false,assessmentCurrent:snapshot?.current===true});
  for(const control of nav.children){const index=Number(control.dataset.step);control.classList.toggle('active',index===state());control.classList.toggle('done',done[index]);control.setAttribute('aria-current',index===state()?'step':'false');const issue=assemblyStageIssue(U.p,index,reads);control.setAttribute('aria-disabled',String(!!issue));control.title=issue||control.dataset.tip||'';}
 }
 // DC-11: a blocked stage names its reason next to the step bar, not only in a tooltip.
 let blockedTimer;
 let blockedNote=null;
 const showBlocked=(index,issue)=>{const nav=U.$('steps'),win=doc.defaultView||globalThis;if(!blockedNote){blockedNote=el('p',undefined,'assembly-step-blocked');blockedNote.id='assembly-step-blocked';blockedNote.setAttribute('role','status');nav.after?.(blockedNote);}const note=blockedNote;note.textContent=ASSEMBLY_STAGES[index]+'：'+issue;note.hidden=false;if(win.clearTimeout)win.clearTimeout(blockedTimer);else clearTimeout(blockedTimer);const hide=()=>{note.hidden=true;};blockedTimer=win.setTimeout?win.setTimeout(hide,6000):setTimeout(hide,6000);blockedTimer?.unref?.();};
 const paragraph=(host,text,cls)=>{const node=el('p',undefined,cls);if(U.E.renderContent)U.E.renderContent(node,text);else node.textContent=text;host.append(node);};
 function renderPanel(snapshot){
  const current=state(),visible=current===3;panel.hidden=!visible;U.$('details').hidden=visible;if(!visible)return;panel.replaceChildren();
  const heading=el('div',undefined,'workflow-heading');heading.append(el('h3',ASSEMBLY_STAGES[current]));button('返回细调',()=>setStep(2),heading,'quiet-action');
  // 查看速读 / 查看正文 also at this stage, which has no stage bar on the canvas.
  if(U.chapterReads&&typeof U.renderChapterReads==='function'&&Object.keys(U.chapterReads.readings()?.chapters||{}).length){const reading=U.p.ui.assemblyView==='read',toggle=button(reading?THREAD_LABELS.viewText:THREAD_LABELS.viewRead,()=>{U.chapterReads.setView(reading?'text':'read');renderCurrent();},heading,'quiet-action');toggle.dataset.action='toggle-assembly-view';toggle.setAttribute('aria-pressed',String(reading));}
  panel.append(heading);
  renderTaskPlan();renderReadExports();
  // The manuscript check, assessment and exports concern the user's own text.
  if(!hasContent()){paragraph(panel,'写入自己的正文后，可在这里核对来源、评估正文并导出 Word。','muted');return;}
  const blocking=issues?.filter(issue=>issue.severity!=='warning')||[],warnings=issues?.filter(issue=>issue.severity==='warning')||[];
  const summary=el('div',checking?'正在检查结构与文件…':issues===null?'尚未检查':blocking.length?blocking.length+' 项需要处理':warnings.length?warnings.length+' 项内容待补，可导出已有正文':'结构与文件检查通过','workflow-check-summary');summary.setAttribute('role','status');panel.append(summary);
  const verify=button('重新检查',()=>refresh(true),summary,'quiet-action');verify.disabled=checking;
  if(issues?.length){const list=el('div',undefined,'workflow-issues');for(const issue of issues){const control=button(issue.message,()=>{if(issue.blockID){closePanel();selectBlock(issue.blockID,{scroll:true});}else U.$('canvas').focus();},list,'workflow-issue');control.dataset.blockId=issue.blockID||'';}panel.append(list);}
  const selected=U.p.blocks.find(b=>b.id===U.p.ui.blockID);if(selected?.materials?.length)button('对照来源核验',()=>verifyBlock(selected),panel,'quiet-action');
  const assess=button(assessing?'正在评估全文…':snapshot.current?'重新评估我写的正文':THREAD_LABELS.assessText,()=>assessWhole(),panel,'workflow-assess');assess.disabled=assessing||U.busy||!hasContent();assess.setAttribute('aria-busy',String(assessing));
  if(error)paragraph(panel,error,'workflow-error');
  const saved=snapshot.saved;if(saved&&!snapshot.current)paragraph(panel,'正文或素材已改变，请重新评估当前版本。','workflow-stale');
  if(snapshot.current){
   const result=saved.result,metrics=el('div',undefined,'workflow-assessment-metrics');for(const [label,value]of [['完成度估计',result.completeness.percent+'%'],['剩余工时',result.remainingHours.min+'–'+result.remainingHours.max+' 小时']]){const metric=el('div');metric.append(el('small',label),el('strong',value));metrics.append(metric);}panel.append(metrics);
   paragraph(panel,result.summary,'workflow-assessment-summary');const basis=el('details',undefined,'workflow-assessment-basis');basis.append(el('summary','判断依据与前提'));paragraph(basis,manuscriptInventoryText(U.p));paragraph(basis,result.completeness.basis);for(const row of result.contentCoverage||[]){const block=U.p.blocks.find(block=>block.id===row.blockID);if(!block)continue;const section=U.p.sections.find(section=>section.id===block.sectionID),control=button((section?.title||'正文')+' · 模块 '+(U.p.blocks.indexOf(block)+1),()=>{closePanel();selectBlock(block.id,{scroll:true});},basis,'quiet-action');control.title=block.text?.slice(0,120)||block.title||'定位模块';paragraph(basis,({substantive:'有实质内容',partial:'待补充',empty:'空白'})[row.status]+'：'+row.basis);}paragraph(basis,result.remainingHours.basis);for(const assumption of result.remainingHours.assumptions)paragraph(basis,assumption,'muted');panel.append(basis);
   const journal=el('section',undefined,'workflow-journal');journal.append(el('h4',result.journal.tier));paragraph(journal,result.journal.basis);for(const condition of result.journal.conditions)paragraph(journal,condition,'muted');panel.append(journal);
   const plan=el('div',undefined,'workflow-execution-plan');plan.append(el('h4','执行方案'));
   for(const step of result.plan){const card=el('section',undefined,'workflow-plan-step');card.append(el('strong',step.title),el('small',step.hours.min+'–'+step.hours.max+' 小时'));paragraph(card,step.action);const details=el('details');details.append(el('summary','交付物与验收'));paragraph(details,step.deliverable);paragraph(details,step.check);card.append(details);const action=button('开始这一步',()=>executePlanStep(step),card,'quiet-action');action.dataset.planTask=step.id;plan.append(card);}panel.append(plan);
   if(saved.benchmarks?.length){const refs=el('details',undefined,'workflow-benchmarks');refs.append(el('summary','实际对照文献'));for(const paper of saved.benchmarks){const control=button(paper.title,()=>U.E.library.openSource({url:paper.url||'https://doi.org/'+paper.doi}),refs,'quiet-action');control.title=[paper.journal,paper.date].filter(Boolean).join(' · ');}panel.append(refs);}
  }
  const format=el('details',undefined,'workflow-format');format.append(el('summary','Word 样式'));paragraph(format,U.p.template.referenceDoc?'已使用自定义 Word 样式':'使用当前论文模板','muted');button('选择 reference.docx',async()=>{const file=await U.E.pick(doc.defaultView,'选择 Word 样式参考文档','file','docx');if(file){U.p.template.referenceDoc=file;await persist();render();}},format);panel.append(format);
  const outputBlocked=!hasContent()||checking||issues===null||blocking.length>0||U.busy||assessing;
  const manuscript=button('导出当前正文 Word',()=>exportDocuments?.({includePlan:false}),panel,'workflow-export-manuscript');manuscript.disabled=outputBlocked;manuscript.title='导出已有正文，不要求完成度或 AI 评估；空白待填卡留在项目中。';
  const output=button('导出正文与执行方案 Word',()=>exportDocuments?.({includePlan:true}),panel,'workflow-export-bundle');output.disabled=!snapshot.current||outputBlocked;output.title=snapshot.current?'导出当前正文和这次评估的执行方案':'执行方案需先评估当前版本；当前正文可直接导出。';
 }
 // Optional task plan: numbered cards, 先完成 #i, 开始这一步 and a checkbox.
 function renderTaskPlan(){
  const reads=U.chapterReads;if(!reads)return;const plan=reads.taskPlan(),section=el('section',undefined,'workflow-execution-plan');section.dataset.taskPlan='true';section.append(el('h4','任务计划'));panel.append(section);
  const prepare=button(plan?.items?.length?'重新整理任务计划':THREAD_LABELS.prepareTaskPlan,()=>reads.prepareTaskPlan(),section,'workflow-task-plan-prepare');prepare.dataset.action='prepare-task-plan';prepare.disabled=!!U.busy||reads.running;
  if(!plan?.items?.length){paragraph(section,'按方案、方向选择和各章速读的缺口整理可逐项执行的任务；不会改写正文。','muted');return;}
  const progress=reads.taskProgress();if(progress){section.append(el('small','任务 '+progress.done+'/'+progress.total+(progress.next[0]?' · 下一步：'+progress.next[0].title:''),'workflow-task-progress'));if(progress.next.length>1)section.append(el('small','可以开始：'+progress.next.map(row=>'#'+row.order+' '+row.title).join('；'),'workflow-task-progress'));}
  if(plan.summary)paragraph(section,plan.summary,'workflow-assessment-summary');if(plan.incomplete)paragraph(section,'回复达到输出长度上限：已保留 '+plan.items.filter(row=>row.origin!=='user').length+' 项完整任务，其余种子列在“未安排的事项”；重新整理任务计划可补全。','muted');
  // Numbered cards in plan order; a phase heading opens each run of one phase.
  const sectionTitle=id=>U.p.sections.find(row=>row.id===id)?.title;let phase='';
  for(const task of plan.items){
   if(task.phase!==phase){phase=task.phase;section.append(el('h5',phase||'其他','workflow-task-phase'));}
   const card=el('section',undefined,'workflow-plan-step');card.dataset.taskId=task.id;card.dataset.status=task.status;
   const check=el('input');check.type='checkbox';check.checked=task.status==='done';check.setAttribute('aria-label','标记任务已完成');check.onchange=()=>{try{reads.setTaskStatus(task.id,check.checked?'done':'todo');}catch(failure){status(failure.message,true);}};
   card.append(check,el('strong','#'+task.order+' '+task.title),el('small',[task.phase,task.hours?'预计 '+task.hours.min+'–'+task.hours.max+' 小时':'',TASK_STATUS_LABELS[task.status]||'',task.origin==='user'?'我的任务':''].filter(Boolean).join(' · ')));
   if(task.dependsOn?.length)card.append(el('small','先完成 '+task.dependsOn.map(id=>'#'+(plan.items.find(row=>row.id===id)?.order??'?')).join('、'),'workflow-task-depends'));
   paragraph(card,task.goal);
   const links=[...(task.sectionIDs||[]).map(sectionTitle).filter(Boolean).map(title=>'章节 '+title),...(task.planRefs||[]).filter(ref=>/^[HE]\d+$/.test(ref)),task.gapRefs?.length?task.gapRefs.length+' 个速读缺口':'',task.evidenceRefs?.length?task.evidenceRefs.length+' 份来源':''].filter(Boolean);if(links.length)card.append(el('small','关联：'+links.join(' · '),'workflow-task-links'));
   const details=el('details');details.append(el('summary','步骤、交付物与验收'));for(const [index,step]of (task.steps||[]).entries())paragraph(details,(index+1)+'. '+step);if(task.deliverable)paragraph(details,'交付物：'+task.deliverable);if(task.check)paragraph(details,'验收条件：'+task.check);if(task.hours)paragraph(details,'预计 '+task.hours.min+'–'+task.hours.max+' 小时'+(task.hours.basis?'，依据：'+task.hours.basis:''),'muted');for(const assumption of task.assumptions||[])paragraph(details,'前提：'+assumption,'muted');if(task.note)paragraph(details,'备注：'+task.note,'muted');card.append(details);
   const start=button(THREAD_LABELS.startTask,()=>startTask(task),card,'quiet-action');start.dataset.startTask=task.id;start.disabled=task.status==='done';section.append(card);
  }
  if(plan.retained?.length){const kept=el('details',undefined,'workflow-task-retained');kept.append(el('summary','已完成与保留的任务 · '+plan.retained.length));for(const task of plan.retained)paragraph(kept,(task.status==='done'?'已完成 · ':'')+task.title,'muted');section.append(kept);}
  if(plan.deferred?.length){const deferred=el('details',undefined,'workflow-task-deferred');deferred.append(el('summary','已暂缓 · '+plan.deferred.length));for(const row of plan.deferred)paragraph(deferred,row.title+'：'+row.reason,'muted');section.append(deferred);}
  if(plan.unscheduled?.length){const loose=el('details',undefined,'workflow-task-unscheduled');loose.append(el('summary','未安排的事项 · '+plan.unscheduled.length));for(const row of plan.unscheduled)paragraph(loose,row.title,'muted');section.append(loose);}
 }
 function renderReadExports(){
  const reads=U.chapterReads;if(!reads)return;const host=el('div',undefined,'workflow-read-exports');panel.append(host);
  const empty=!Object.keys(reads.readings()?.chapters||{}).length&&!reads.taskPlan()?.items?.length;
  const read=button(THREAD_LABELS.exportRead,()=>reads.exportRead(),host,'workflow-export-read');read.disabled=empty||!!U.busy;read.title=empty?'先生成装配速读或整理任务计划':reads.exportCurrent()?'已导出当前版本；再次导出会生成新文件':'导出为新的 Word 文件，不覆盖已有文件';
  const more=el('details',undefined,'workflow-citation-export');more.append(el('summary',THREAD_LABELS.exportCitations));for(const [format,label]of [['biblatex','BibLaTeX'],['markdown','Markdown']])button(label,()=>reads.exportCitations(format),more,'quiet-action').dataset.format=format;host.append(more);
  paragraph(host,'Ctrl+Z 只撤销正文编辑；速读的修改用“恢复 AI 解析”或候选的“撤回修改”还原。','muted');
 }
 const renderView=snapshot=>{renderSteps(snapshot);renderPanel(snapshot);U.directionWorkspace?.render();};
 const renderCurrent=()=>renderView(state()===3?assessmentSnapshot():undefined);
 async function refresh(force=false,snapshot){
  if(state()!==3){renderView();return;}
  snapshot||=assessmentSnapshot();const next=snapshot.signature;if(!force&&lastSignature===next){renderView(snapshot);return;}
  lastSignature=next;const token=++generation;checking=true;renderView(snapshot);
  try{const result=await U.A.check(U.p);if(token!==generation)return;if(state()!==3){issues=result;checking=false;renderView();return;}const updated=assessmentSnapshot();if(updated.signature!==next){checking=false;lastSignature='';return refresh(false,updated);}issues=result;checking=false;renderView(updated);}
  catch(failure){if(token!==generation)return;checking=false;lastSignature='';issues=null;error=failure.message;renderCurrent();status(failure.message,true);}
 }
 async function assessWhole(){
  if(assessing||U.busy)return;assessing=true;error='';U.busy=true;U.abort=new doc.defaultView.AbortController();U.$('cancel-task').hidden=false;renderCurrent();
  try{await persist({flush:true});if(U.saveError)throw U.saveError;const session=U.conversationSession||{};await U.A.assessWhole(U.p,status,U.abort.signal,{modelID:session.modelID||'',thinkingLevel:session.thinkingLevel||'off'});if(!currentAssessment())throw Error('正文或素材已改变，请重新评估当前版本');status('全文评估与执行方案已保存');}
  catch(failure){error=failure.message;status(failure.message,true);}
  finally{assessing=false;U.busy=false;U.$('cancel-task').hidden=true;renderCurrent();}
 }
 async function executePlanStep(step){
  if(!currentAssessment())throw Error('评估已过期，请重新评估后继续执行方案');if(step.blockIDs?.length)selectBlock(step.blockIDs[0],{scroll:true});
  if(step.tool==='export_check')return refresh(true);if(step.tool==='figure_insert'){await setStep(2);return insertFigure?.('image');}
  closePanel();if(step.tool==='evidence_search')return findEvidence?.(step.action);
  if(step.tool==='source_verify'){const block=U.p.blocks.find(b=>step.blockIDs.includes(b.id));if(block?.materials?.length)return verifyBlock(block);return findEvidence?.(step.action);}
  doc.querySelector('[data-id="'+U.p.ui.blockID+'"] .editable')?.focus?.();status(step.action);
 }
 // 开始这一步 for task-plan cards: jump to the chapter, the evidence search, the
 // source check or the plan. It needs no assessment. Experiments run outside
 // the app, so their step opens the chapter read (planned method and gaps) or
 // the plan, never a material search.
 async function startTask(task){
  if(task.status==='todo')U.chapterReads?.setTaskStatus(task.id,'doing');
  const sectionID=task.sectionIDs?.find(id=>U.p.sections.some(row=>row.id===id));if(sectionID)U.p.ui.sectionID=sectionID;
  if(task.tool==='export_check'){await setStep(3,{focus:false});await refresh(true);return;}
  if(task.tool==='open_plan'||task.tool==='experiment_run'&&!sectionID){await U.E.notebook.open(U.p.id);return;}
  if(task.tool==='open_read'||task.tool==='experiment_run'){await setStep(2,{focus:false});U.chapterReads?.setView('read');return;}
  if(task.tool==='figure_insert'){await setStep(2,{focus:false});await insertFigure?.('image');return;}
  if(task.tool==='source_verify'){const material=U.p.materials.find(row=>task.evidenceRefs?.includes(row.id)),block=material&&U.p.blocks.find(row=>row.materials?.some(link=>link.id===material.id));closePanel();if(block){await verifyBlock(block);return;}if(material&&U.previewResearchSource){await U.previewResearchSource({materialID:material.id});return;}}
  if(task.tool==='evidence_search'||task.tool==='source_verify'){closePanel();await findEvidence?.(task.goal);return;}
  closePanel();status(task.goal);
 }
 async function setStep(value,{focus=true}={}){
  if(!Number.isInteger(value)||value<0||value>3)return;const issue=assemblyStageIssue(U.p,value,readCounts());if(issue){status(issue,true);showBlocked(value,issue);return false;}const previous=state();if(U.p.ui.canvasDisplay==='digest'){U.p.ui.writingPlanOpen=false;U.p.ui.canvasDisplay=U.p.ui.writingPlanPreviousDisplay||'materials';delete U.p.ui.writingPlanPreviousDisplay;}U.p.ui.step=value;U.p.ui.leftOpen=true;
  U.p.ui.left=value===0?'materials':'structure';if(value>=1)U.p.ui.rightOpen=true;applyPanels();updatingNavigation=true;try{renderNavigation();}finally{updatingNavigation=false;}
  if(previous!==value){U.writingRibbon?.reset();if(value===0)U.reconcileMaterialSections?.();U.renderEditor?.();U.selectionAssistant?.sync();}
  if(previous!==value&&!doc.defaultView.matchMedia('(prefers-reduced-motion:reduce)').matches)U.$('workspace').animate?.([{opacity:.86,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:170,easing:'cubic-bezier(.2,.7,.3,1)'});
  await refresh();await persist();if(focus){const target=value===0?U.$('material-search'):value===1?U.$('direction-workspace'):value===2?U.$('selection-assistant'):panel;target?.focus?.({preventScroll:true});}
 }
 const render=()=>{if(updatingNavigation)return;if(state()===3)refresh().catch(failure=>status(failure.message,true));else renderView();};
 const closePanel=()=>{if(state()===3)void setStep(2,{focus:false}).catch(failure=>status(failure.message,true));};
 installDirectionWorkspace(U,{el,button,persist,snapshot,changed,status,setStep});
 return {render,setStep,refresh,assessWhole,executePlanStep,startTask,closePanel,get issues(){return issues;}};
}
