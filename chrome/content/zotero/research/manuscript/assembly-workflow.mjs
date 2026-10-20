/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {ASSESSMENT_VERSION,assessmentSignature,isCurrentAssessment} from '../shared/manuscript-assessment.mjs';
import {ASSEMBLY_FLOW_STAGES,migrateAssemblyFlow} from '../shared/assembly-direction.mjs';
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
 function renderSteps(snapshot){
  const nav=U.$('steps');nav.hidden=false;nav.setAttribute('aria-label','论文装配流程');doc.body.dataset.assemblyStage=String(state());
  if(!nav.children.length)ASSEMBLY_STAGES.forEach((label,index)=>{const control=button('',()=>setStep(index),nav,'assembly-step');control.dataset.step=String(index);control.append(el('span',String(index+1),'assembly-step-number'),el('span',label));control.title=['导入语料与论文，按章节关联素材','结合可行性方案逐个确认方向，再生成初稿候选','选段与右侧 AI 对话微调，也可整篇修改','核验全文，按期刊样式导出正文与执行方案'][index];});
  const done=[U.p.materials.length>0,!!U.p.directionDiscussion&&Object.keys(U.p.directionDiscussion.answers||{}).length===U.p.directionDiscussion.questions.length,hasContent(),snapshot?.current===true];
  for(const control of nav.children){const index=Number(control.dataset.step);control.classList.toggle('active',index===state());control.classList.toggle('done',done[index]);control.setAttribute('aria-current',index===state()?'step':'false');}
 }
 const paragraph=(host,text,cls)=>{const node=el('p',undefined,cls);if(U.E.renderContent)U.E.renderContent(node,text);else node.textContent=text;host.append(node);};
 function renderPanel(snapshot){
  const current=state(),visible=current===3;panel.hidden=!visible;U.$('details').hidden=visible;if(!visible)return;panel.replaceChildren();
  const heading=el('div',undefined,'workflow-heading');heading.append(el('h3',ASSEMBLY_STAGES[current]));button('返回细调',()=>setStep(2),heading,'quiet-action');panel.append(heading);
  const summary=el('div',checking?'正在检查结构与文件…':issues===null?'尚未检查':issues.length?issues.length+' 项需要处理':'结构与文件检查通过','workflow-check-summary');summary.setAttribute('role','status');panel.append(summary);
  const verify=button('重新检查',()=>refresh(true),summary,'quiet-action');verify.disabled=checking;
  if(issues?.length){const list=el('div',undefined,'workflow-issues');for(const issue of issues){const control=button(issue.message,()=>{if(issue.blockID){closePanel();selectBlock(issue.blockID,{scroll:true});}else U.$('canvas').focus();},list,'workflow-issue');control.dataset.blockId=issue.blockID||'';}panel.append(list);}
  const selected=U.p.blocks.find(b=>b.id===U.p.ui.blockID);if(selected?.materials?.length)button('对照来源核验',()=>verifyBlock(selected),panel,'quiet-action');
  const assess=button(assessing?'正在评估全文…':snapshot.current?'重新评估全文':'一键评估全文',()=>assessWhole(),panel,'workflow-assess');assess.disabled=assessing||U.busy||!hasContent();assess.setAttribute('aria-busy',String(assessing));
  if(error)paragraph(panel,error,'workflow-error');
  const saved=snapshot.saved;if(saved&&!snapshot.current)paragraph(panel,'正文或素材已改变，请重新评估当前版本。','workflow-stale');
  if(snapshot.current){
   const result=saved.result,metrics=el('div',undefined,'workflow-assessment-metrics');for(const [label,value]of [['完成度估计',result.completeness.percent+'%'],['剩余工时',result.remainingHours.min+'–'+result.remainingHours.max+' 小时']]){const metric=el('div');metric.append(el('small',label),el('strong',value));metrics.append(metric);}panel.append(metrics);
   paragraph(panel,result.summary,'workflow-assessment-summary');const basis=el('details',undefined,'workflow-assessment-basis');basis.append(el('summary','判断依据与前提'));paragraph(basis,result.completeness.basis);paragraph(basis,result.remainingHours.basis);for(const assumption of result.remainingHours.assumptions)paragraph(basis,assumption,'muted');panel.append(basis);
   const journal=el('section',undefined,'workflow-journal');journal.append(el('h4',result.journal.tier));paragraph(journal,result.journal.basis);for(const condition of result.journal.conditions)paragraph(journal,condition,'muted');panel.append(journal);
   const plan=el('div',undefined,'workflow-execution-plan');plan.append(el('h4','执行方案'));
   for(const step of result.plan){const card=el('section',undefined,'workflow-plan-step');card.append(el('strong',step.title),el('small',step.hours.min+'–'+step.hours.max+' 小时'));paragraph(card,step.action);const details=el('details');details.append(el('summary','交付物与验收'));paragraph(details,step.deliverable);paragraph(details,step.check);card.append(details);const action=button('开始这一步',()=>executePlanStep(step),card,'quiet-action');action.dataset.planTask=step.id;plan.append(card);}panel.append(plan);
   if(saved.benchmarks?.length){const refs=el('details',undefined,'workflow-benchmarks');refs.append(el('summary','实际对照文献'));for(const paper of saved.benchmarks){const control=button(paper.title,()=>U.E.library.openSource({url:paper.url||'https://doi.org/'+paper.doi}),refs,'quiet-action');control.title=[paper.journal,paper.date].filter(Boolean).join(' · ');}panel.append(refs);}
  }
  const format=el('details',undefined,'workflow-format');format.append(el('summary','Word 样式'));paragraph(format,U.p.template.referenceDoc?'已使用自定义 Word 样式':'使用当前论文模板','muted');button('选择 reference.docx',async()=>{const file=await U.E.pick(doc.defaultView,'选择 Word 样式参考文档','file','docx');if(file){U.p.template.referenceDoc=file;await persist();render();}},format);panel.append(format);
  const output=button('导出正文与执行方案 Word',()=>exportDocuments?.(),panel,'workflow-export-bundle');output.disabled=!snapshot.current||checking||!!issues?.length||U.busy||assessing;
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
 async function setStep(value,{focus=true}={}){
  if(!Number.isInteger(value)||value<0||value>3)return;const previous=state();U.p.ui.step=value;U.p.ui.leftOpen=true;
  U.p.ui.left=value===0?'materials':'structure';if(value>=2)U.p.ui.rightOpen=true;applyPanels();updatingNavigation=true;try{renderNavigation();}finally{updatingNavigation=false;}
  if(previous!==value){U.renderEditor?.();U.selectionAssistant?.sync();}
  if(previous!==value&&!doc.defaultView.matchMedia('(prefers-reduced-motion:reduce)').matches)U.$('workspace').animate?.([{opacity:.86,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:170,easing:'cubic-bezier(.2,.7,.3,1)'});
  await refresh();await persist();if(focus){const target=value===0?U.$('material-search'):value===1?U.$('direction-workspace'):value===2?U.$('selection-assistant'):panel;target?.focus?.({preventScroll:true});}
 }
 const render=()=>{if(updatingNavigation)return;if(state()===3)refresh().catch(failure=>status(failure.message,true));else renderView();};
 const closePanel=()=>{if(state()===3)void setStep(2,{focus:false}).catch(failure=>status(failure.message,true));};
 installDirectionWorkspace(U,{el,button,persist,snapshot,changed,status,setStep});
 return {render,setStep,refresh,assessWhole,executePlanStep,closePanel,get issues(){return issues;}};
}
