/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const EXPERIMENT_FIELDS=['hypothesisID','data','controls','comparison','metrics','support','refute','cost','outputs','preprocessing','leakage','baselines','ablations','robustness','reliability','failureAnalysis','reproducibility'];
export const CONDITIONAL_EXPERIMENT_FIELDS=Object.freeze(['leakage','baselines','ablations']);
// The labels a presented plan shows for its fields, also in its 待补 rows.
export const PLAN_FIELD_LABELS=Object.freeze({hypothesisID:'绑定假设',data:'数据',controls:'控制条件',comparison:'比较方法',metrics:'评价指标',support:'支持判据',refute:'否定判据',cost:'资源成本',outputs:'交付结果',preprocessing:'预处理',leakage:'数据泄漏检查',baselines:'公平比较',ablations:'组件检验',robustness:'稳健性',reliability:'可靠性',failureAnalysis:'失败分析',reproducibility:'复现材料',novelty:'创新点',significance:'研究价值',feasibility:'可行性',minimumValidation:'最小验证'});
const researchTypes=new Set(['field','laboratory','observational','simulation','machine-learning','other']);
const text=v=>typeof v==='string'?v.trim():'';
export function applicableExperimentChecks(experiment,plan={}){
 const selected=experiment.applicableChecks??plan.applicableChecks??[];
 if(!Array.isArray(selected)||selected.some(key=>!CONDITIONAL_EXPERIMENT_FIELDS.includes(key)))throw Error('实验适用检查项无效');
 const type=experiment.researchType||plan.researchType;
 if(type&&!researchTypes.has(type))throw Error('实验研究类型无效');
 // Training, model baselines and component ablations are relevant defaults
 // for ML. Other designs explicitly opt into checks that fit their protocol.
 return [...new Set([...(type==='machine-learning'?CONDITIONAL_EXPERIMENT_FIELDS:[]),...selected])];
}
const chapterTitle=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// Chapter tasks are bound to the user's structure: a row naming an unknown
// chapter, hypothesis or experiment is dropped with a pending note, never guessed.
function planChapters(plan,structure,{hypothesisIDs,experimentIDs,sourceIDs}){
 if(structure===undefined)return [];
 const titles=parseWritingStructure(structure).map(row=>row.title),byTitle=new Map(titles.map(title=>[chapterTitle(title),title])),used=new Set(),rows=[];
 for(const row of Array.isArray(plan.chapters)?plan.chapters:[]){
  const title=byTitle.get(chapterTitle(row?.title)),task=text(row?.task);
  if(!title){if(text(row?.title))plan.validationNotes.push('章节任务「'+text(row.title).slice(0,60)+'」不在你的章节结构中，已忽略');continue;}
  if(used.has(title)||!task)continue;
  const list=values=>[...new Set((Array.isArray(values)?values:[]).filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()))];
  const hIDs=list(row.hypothesisIDs),eIDs=list(row.experimentIDs);
  if(hIDs.some(id=>!hypothesisIDs.has(id))||eIDs.some(id=>!experimentIDs.has(id))){plan.validationNotes.push('章节任务「'+title+'」引用了不存在的假设或实验，已忽略');continue;}
  used.add(title);rows.push({title,task:task.slice(0,1200),hypothesisIDs:hIDs.slice(0,12),experimentIDs:eIDs.slice(0,12),evidenceNeeds:(Array.isArray(row.evidenceNeeds)?row.evidenceNeeds:[]).filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim().slice(0,400)).slice(0,8),closestSourceIDs:list(row.closestSourceIDs).filter(id=>sourceIDs.has(id)).slice(0,6)});
 }
 return rows.sort((a,b)=>titles.indexOf(a.title)-titles.indexOf(b.title));
}
// Without a structure (older callers) chapters is empty; the plan still validates.
export function validatePlan(value,sources,structure){
 const plan=JSON.parse(JSON.stringify(value||{})),known=new Map(sources.map(s=>[s.id,s]));plan.pending=Array.isArray(plan.pending)?plan.pending.map(String):[];plan.validationNotes=Array.isArray(plan.validationNotes)?plan.validationNotes.map(String):[];
 plan.hypotheses=Array.isArray(plan.hypotheses)?plan.hypotheses:[];
 if(!plan.hypotheses.length)throw Error('评估缺少可证伪假设，请重试。');
 const ids=new Set();for(const h of plan.hypotheses){if(!text(h.id)||ids.has(h.id)||!text(h.claim)||!text(h.falsification))throw Error('假设缺少稳定 ID、陈述或否定条件');ids.add(h.id);h.status='hypothesis';}
 plan.closest=Array.isArray(plan.closest)?plan.closest:[];
 for(const work of plan.closest){const s=known.get(work.sourceID);if(!s)throw Error('评估引用了未检索到的文献');const quote=text(work.quote),normalize=s=>String(s).replace(/\s+/g,' ').trim();if(!quote||!normalize(s.text).includes(normalize(quote)))throw Error('最接近文献的摘录未匹配原文');work.coverage=s.coverage;work.status='inference';}
 plan.experiments=Array.isArray(plan.experiments)?plan.experiments:[];if(!plan.experiments.length)throw Error('评估未返回实验方案');
 const experimentIDs=new Set();for(const e of plan.experiments){if(!text(e.id)||experimentIDs.has(e.id))throw Error('实验 ID 缺失或重复');experimentIDs.add(e.id);if(!ids.has(e.hypothesisID))throw Error('实验未绑定有效假设');e.status='planned';delete e.results;const applicable=applicableExperimentChecks(e,plan);e.applicableChecks=applicable;for(const key of EXPERIMENT_FIELDS)if(!text(e[key])){if(CONDITIONAL_EXPERIMENT_FIELDS.includes(key)&&!applicable.includes(key)){delete e[key];continue;}e[key]='待补';plan.pending.push(`${e.title||e.id}：${key} 待补`);}}
 for(const key of ['novelty','significance','feasibility','minimumValidation'])if(!text(plan[key])){plan[key]='待补';plan.pending.push(key+' 待补');}
 if(!plan.closest.length)plan.pending.push('未找到可比较的最接近工作；创新性尚未核实');
 plan.chapters=planChapters(plan,structure,{hypothesisIDs:ids,experimentIDs,sourceIDs:new Set(plan.closest.map(work=>work.sourceID))});
 delete plan.noveltyScore;delete plan.acceptanceProbability;plan.pending=[...new Set(plan.pending)];plan.validationNotes=[...new Set(plan.validationNotes)];if(!plan.validationNotes.length)delete plan.validationNotes;plan.status='proposal';return plan;
}
// Plan chapter rows keyed by the user's section: a section keeps its row across
// a rename through the previous sectionID; unmatched rows stay with sectionID null.
export function assignPlanChapters(chapters=[],sections=[],previous=[]){
 const prior=new Map((Array.isArray(previous)?previous:[]).filter(row=>row?.sectionID).map(row=>[chapterTitle(row.title),row.sectionID])),known=new Set(sections.map(row=>row.id)),taken=new Set();
 return (Array.isArray(chapters)?chapters:[]).filter(row=>row&&typeof row==='object').map(row=>{
  const key=chapterTitle(row.title),kept=prior.get(key),byTitle=sections.find(section=>!taken.has(section.id)&&chapterTitle(section.title)===key)?.id,sectionID=kept&&known.has(kept)&&!taken.has(kept)?kept:byTitle||null;
  if(sectionID)taken.add(sectionID);
  return {sectionID,title:text(row.title),task:text(row.task),hypothesisIDs:[...(row.hypothesisIDs||[])],experimentIDs:[...(row.experimentIDs||[])],evidenceNeeds:[...(row.evidenceNeeds||[])],closestSourceIDs:[...(row.closestSourceIDs||[])]};
 });
}
// Confirmed direction answers replace their own rows by ID and supersede the
// direction rows of earlier discussions. Plan decisions are left untouched.
export function mergeDirectionDecisions(decisions=[],rows=[],discussionID){
 const replaced=new Set(rows.map(row=>row.id));
 return [...decisions.filter(row=>!replaced.has(row?.id)).map(row=>row?.origin==='direction'&&row.discussionID!==discussionID&&!['revoked','rejected','superseded','deleted'].includes(row.status)?{...row,status:'superseded'}:row),...rows];
}
export function changedHypotheses(before,after){const old=new Map((before?.hypotheses||[]).map(h=>[h.id,h]));return [...new Set([...after.hypotheses.filter(h=>JSON.stringify(h)!==JSON.stringify(old.get(h.id))).map(h=>h.id),...(before?.hypotheses||[]).filter(h=>!after.hypotheses.some(x=>x.id===h.id)).map(h=>h.id)])];}
export function affectedExperiments(plan,ids){return plan.experiments.filter(e=>ids.includes(e.hypothesisID)).map(e=>e.id);}

// Keep an explicit, bounded decision state. The discussion log remains visible
// to the user, but is not replayed as a growing substitute for research memory.
export function activePlanDecisions(decisions=[],versionID){
 const latest=new Map();for(const value of decisions){if(versionID&&value.versionID&&value.versionID!==versionID)continue;const key=text(value.id||value.decision);if(!key)continue;latest.set(key,value);}
 return [...latest.values()].filter(value=>!['revoked','rejected','superseded','deleted'].includes(value.status)).slice(-20).map(value=>({decision:text(value.decision),reason:text(value.reason),objection:text(value.objection),...(value.status?{status:value.status}:{})}));
}

// Model quote labels are temporary; bind generated prose to stable source IDs.
// Preserve verbatim quotes and the saved plan object.
export function bindPlanCitations(plan,sources){
 const visit=(value,key)=>{if(key==='quote')return value;if(typeof value==='string')return value.replace(/\[Q(\d+)\]/g,(token,n)=>sources[Number(n)-1]?'['+sources[Number(n)-1].id+']':'[待核验来源 '+token.slice(1,-1)+']');if(Array.isArray(value))return value.map(v=>visit(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,k)]));return value;};return visit(plan);
}

// The user owns the chapter order and writing purposes. Applying that order must
// never discard an authored block or replace a stable section identifier.
export function parseWritingStructure(value){
 const rows=Array.isArray(value)?value:String(value||'').split(/\r?\n/).map(line=>{const [title,...purpose]=line.split(/[|｜]/);return {title:title.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/,'').trim(),purpose:purpose.join('｜').trim()};});
 const result=rows.filter(row=>String(row?.title||'').trim()).map(row=>({...(row.id?{id:String(row.id)}:{}),title:String(row.title).trim(),purpose:String(row.purpose||'').trim()}));
 if(!result.length||result.length>30||result.some(row=>row.title.length>120||row.purpose.length>1200)||new Set(result.map(row=>row.title)).size!==result.length)throw Error('章节结构需要 1–30 个不重复的章节；每行填写章节名称，可用“｜”补充本章任务');
 return result;
}
export function applyWritingStructure(project,structure,makeID){
 const rows=parseWritingStructure(structure),used=new Set(),previous=project.sections||[];
 const next=rows.map(row=>{const old=previous.find(section=>row.id?section.id===row.id:section.title===row.title);if(row.id&&!old)throw Error('章节已改变，请重新确认结构');const section=old?{...old}:{id:makeID('section'),conclusion:''};if(used.has(section.id))throw Error('章节结构存在重复位置');used.add(section.id);return {...section,title:row.title,writingPurpose:row.purpose};});
 const removed=previous.filter(section=>!used.has(section.id));
 if(removed.some(section=>project.blocks.some(block=>block.sectionID===section.id&&(!block.emptyStarter||block.text?.trim()||block.materials?.length||block.table||block.imagePath||block.formulaSource||block.requirements?.trim()))))throw Error('此结构会移除已有正文或关联素材的章节；请保留该章节，再到装配中手动调整');
 project.blocks=project.blocks.filter(block=>!removed.some(section=>section.id===block.sectionID));project.sections=next;if(!next.some(row=>row.id===project.ui.sectionID))project.ui.sectionID=next[0].id;
 return next.map(({id,title,writingPurpose})=>({id,title,purpose:writingPurpose||''}));
}
