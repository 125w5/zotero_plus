/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeWritingWorkflow,updateWritingWorkflow,diagnoseWritingWorkflow} from '../shared/paper-writing-workflow.mjs';
import {chapterMaterials,chapterRule} from '../shared/writing-framework.mjs';

// One saved plan, edited inside the continuous writing digest. Source text and
// manuscript paragraphs remain separate from the user's planning notes.
export function openPaperWritingWorkflow(U){
 if(!U.p.blocks.some(row=>row.id===U.p.ui.blockID&&row.sectionID===U.p.ui.sectionID))U.selectBlock?.(U.p.blocks.find(row=>row.sectionID===U.p.ui.sectionID)?.id||null);
 U.p.ui.canvasDisplay='digest';U.p.ui.writingPlanOpen=true;U.changed({editor:true});
 U.$('canvas').scrollTop=0;U.$('paper-writing-workflow')?.querySelector('summary')?.focus({preventScroll:true});
}
export function renderPaperWritingWorkflow(U,host,{el,button,persist,status,generate}){
 const project=U.p,doc=host.ownerDocument;
 if(!doc.getElementById('paper-writing-workflow-styles')){const link=el('link');link.id='paper-writing-workflow-styles';link.rel='stylesheet';link.href=new URL('./paper-writing-workflow.css',import.meta.url).href;doc.head.append(link);}
 const root=el('details',undefined,'paper-writing-workflow');root.id='paper-writing-workflow';root.open=!!project.ui.writingPlanOpen;
 const summary=el('summary');summary.append(el('span','研究与写作计划'),el('small','问题 → 方法 → 结果 → 讨论'));root.append(summary);host.append(root);
 root.ontoggle=()=>{if(U.p!==project)return;project.ui.writingPlanOpen=root.open;persist();};
 const content=el('div',undefined,'paper-workflow-content');root.append(content);
 let sectionID=project.ui.sectionID||project.sections[0]?.id;
 const current=()=>U.p===project&&root.isConnected;
 const plan=()=>normalizeWritingWorkflow(project.writingWorkflow,project);
 const issues=el('div',undefined,'paper-workflow-issues');issues.setAttribute('role','status');
 const renderIssues=()=>{issues.replaceChildren();const rows=diagnoseWritingWorkflow(project,{sectionID});
  if(!rows.length){issues.append(el('p','本地计划检查完成。证据内容可继续通过写作速读核对。'));return;}
  const list=el('ul');for(const row of rows)list.append(el('li',row.message));issues.append(list);
 };
 const save=(field,value,section=false)=>{if(!current())return;try{updateWritingWorkflow(project,{[field]:value},section?{sectionID}:{});persist();renderIssues();}catch(error){status(error.message,true);}};
 const editor=(parent,key,label,value,placeholder,section=false)=>{const row=el('label',undefined,'paper-workflow-field');row.append(el('span',label));const input=el('textarea');input.rows=key==='structure'||key==='findings'||key==='comparisons'?4:3;input.value=value||'';input.placeholder=placeholder;input.dataset.workflowField=key;input.setAttribute('aria-label',label);input.oninput=()=>save(key,input.value,section);row.append(input);parent.append(row);return input;};
 const global=el('details',undefined,'paper-workflow-global');global.open=!plan().question;global.append(el('summary','研究问题与共同约束'));content.append(global);
 const globals=el('div',undefined,'paper-workflow-grid');global.append(globals);
 for(const [key,label,hint]of [
  ['question','研究问题','研究对象、适用条件，以及准备解决的具体问题。'],
  ['hypotheses','科学假设与验证条件','希望观察到什么？怎样的结果会否定这一假设？'],
  ['resourceNotes','资料与实验计划','已有数据、原稿、实验记录和待完成的工作。保留版本及位置。'],
  ['terminology','术语与指标口径','同一对象的中英文名称、符号、单位与定义。'],
  ['reviewerNotes','审稿意见与待办','意见对应章节、原稿位置、已有回应和剩余动作。']
 ])editor(globals,key,label,plan()[key],hint);
 const chapter=el('section',undefined,'paper-workflow-chapter');content.append(chapter);
 function renderChapter(){
  chapter.replaceChildren();const value=plan(),section=project.sections.find(row=>row.id===sectionID);if(!section)return;
  const saved=value.sections?.[sectionID]||{},rule=chapterRule(section.title),heading=el('div',undefined,'paper-workflow-chapter-heading'),choice=el('select');choice.dataset.workflowSection='true';choice.setAttribute('aria-label','写作计划所属章节');
  for(const row of project.sections){const option=el('option',row.title);option.value=row.id;choice.append(option);}choice.value=sectionID;
  choice.onchange=()=>{if(!current())return;sectionID=choice.value;project.ui.sectionID=sectionID;U.selectBlock?.(project.blocks.find(row=>row.sectionID===sectionID)?.id||null);persist();renderChapter();renderIssues();U.renderLibrary?.();};
  heading.append(el('h3','章节计划'),choice);chapter.append(heading,el('p',rule.purpose,'paper-workflow-purpose'));
  const fields=el('div',undefined,'paper-workflow-grid');chapter.append(fields);
  editor(fields,'purpose','本章论证任务',saved.purpose,'说明本章要回答什么，以及与研究问题的关系。',true);
  editor(fields,'structure','论证与段落顺序',saved.structure,'按小节或连续段落规划：每一部分写什么、用什么支撑、怎样衔接。',true);
  if(rule.type==='方法'||rule.type==='实验')editor(fields,'methods','实际操作与指标链条',saved.methods,'按真实执行顺序记录对象、输入、处理、参数、公式、指标含义及方法来源。',true);
  if(['结果','讨论','结论'].includes(rule.type))editor(fields,'findings','主要发现与核心结果',saved.findings,'每条发现对应哪些实际观察、数值、条件及图表？保留负结果和未完成实验。',true);
  if(rule.type==='讨论'||rule.type==='相关工作')editor(fields,'comparisons','文献比较与解释链条',saved.comparisons,'对齐具体对象、行为和实验条件；写清相同或不同之处、可能原因及证据允许的解释。',true);
  editor(fields,'revisionNotes','本章修改与验收要求',saved.revisionNotes,'原稿哪些部分保留或调整？怎样检查逻辑、结构、表达和引用？',true);
  const sources=el('details',undefined,'paper-workflow-source-settings');sources.append(el('summary','结构范文与证据对应'));chapter.append(sources);
  const materials=chapterMaterials(project,sectionID);
  if(!materials.length)sources.append(el('p','先将完整素材关联到本章，再指定范文、方法来源、结果依据或讨论对照。','muted'));
  else{
   sources.append(el('p','只选择本章已关联的素材。范文用于学习结构和表达，结果依据仍需核对实际数据。','muted'));
   const table=el('table',undefined,'paper-workflow-source-map'),head=el('tr');head.append(el('th','完整素材'));const roles=[['referenceMaterialIDs','结构'],['methodSourceMaterialIDs','方法'],['findingSourceMaterialIDs','结果'],['comparisonSourceMaterialIDs','对照']];for(const [,label]of roles)head.append(el('th',label));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');table.append(body);
   for(const material of materials){const tr=el('tr'),name=el('td'),title=button(material.title||'完整素材',()=>U.materialDetails?.(material),name,'paper-workflow-material');title.title=material.summary||material.sourceText||'';tr.append(name);
    for(const [key,label]of roles){const td=el('td'),box=el('input');box.type='checkbox';box.checked=(saved[key]||[]).includes(material.id);box.dataset.workflowRole=key;box.dataset.workflowMaterial=material.id;box.setAttribute('aria-label',`${material.title||'完整素材'} · ${label}`);box.onchange=()=>{const ids=new Set(plan().sections?.[sectionID]?.[key]||[]);box.checked?ids.add(material.id):ids.delete(material.id);save(key,[...ids],true);};td.append(box);tr.append(td);}body.append(tr);
   }sources.append(table);
  }
  const figures=project.blocks.filter(row=>row.sectionID===sectionID&&['image','table','formula'].includes(row.type));
  if(figures.length){const list=el('div',undefined,'paper-workflow-figures');list.append(el('strong','本章图表与公式'));for(const block of figures){const label=el('label'),box=el('input');box.type='checkbox';box.checked=(saved.figureBlockIDs||[]).includes(block.id);box.dataset.workflowFigure=block.id;box.onchange=()=>{const ids=new Set(plan().sections?.[sectionID]?.figureBlockIDs||[]);box.checked?ids.add(block.id):ids.delete(block.id);save('figureBlockIDs',[...ids],true);};label.append(box,el('span',block.title||block.table?.caption||block.text?.slice(0,70)||({image:'图片',table:'表格',formula:'公式'})[block.type]));list.append(label);}sources.append(list);}
  const actions=el('div',undefined,'paper-workflow-actions');chapter.append(actions);
  const run=button('按计划整理本章速读',async()=>{if(!current())return;run.disabled=true;try{await generate(sectionID);status('已按本章计划整理写作速读');}finally{if(run.isConnected)run.disabled=false;}},actions);run.dataset.action='workflow-generate-section';run.disabled=!!U.busy||!!U.frameworkBusy;
  button('查找支撑素材',()=>U.findEvidence?.([plan().question,plan().sections?.[sectionID]?.purpose||section.title].filter(Boolean).join(' ')),actions,'quiet-action');
 }
 renderChapter();const footer=el('div',undefined,'paper-workflow-check');button('检查计划缺口',renderIssues,footer,'quiet-action').dataset.action='check-writing-plan';footer.append(el('small','自动保存在本项目 · 正文修改仍需确认'));content.append(footer,issues);renderIssues();return root;
}
