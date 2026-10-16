/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingWorkflowSnapshot} from './paper-writing-workflow.mjs';
export const ASSESSMENT_VERSION=1;
export const JOURNAL_LEVELS=['尚无法判断','可先考虑领域应用型期刊','有条件考虑领域主流期刊','需补充证据后判断更高层级'];
export const PLAN_TOOLS=['evidence_search','source_verify','figure_insert','manual_write','export_check'];
const copy=value=>JSON.parse(JSON.stringify(value));
const content=p=>({id:p.id,title:p.title,researchGoal:p.researchGoal||p.memory?.goal||'',sections:p.sections,blocks:p.blocks,materials:p.materials,citationStyle:p.citationStyle,language:p.language,...(p.writingWorkflow?{writingWorkflow:writingWorkflowSnapshot(p)}:{})});
export function assessmentSignature(project){
 const text=JSON.stringify(content(project));let a=2166136261,b=5381;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
 return 'assessment-v'+ASSESSMENT_VERSION+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16)+':'+text.length;
}
export function isCurrentAssessment(project,assessment){return assessment?.status==='ready'&&assessment.version===ASSESSMENT_VERSION&&assessment.signature===assessmentSignature(project);}
export function assessmentInput(project,{issues=[],benchmarks=[],limitations=[]}={}){
 const manuscript=copy(content(project)),writingWorkflow=manuscript.writingWorkflow;delete manuscript.materials;delete manuscript.writingWorkflow;
 if(JSON.stringify(manuscript).length+(writingWorkflow?JSON.stringify(writingWorkflow).length:0)>220000)throw Error('正文或写作计划超过本次全文评估容量，请按章节检查；未生成不完整的全文评估。');
 const sources=project.materials.map(m=>({id:m.id,title:m.title,kind:m.kind,revision:m.revision,text:String(m.sourceText||'').slice(0,14000),excerpted:String(m.sourceText||'').length>14000,summary:m.summary||'',anchor:{paperItemID:m.anchor?.paperItemID,pageIndex:m.anchor?.pageIndex,citationItemID:m.anchor?.citationItemID}}));
 if(JSON.stringify(sources).length>220000)throw Error('关联素材超过本次评估容量，请缩小来源范围；未生成不完整的全文评估。');
 return {manuscript,sources,...(writingWorkflow?{writingWorkflow}:{}),issues:copy(issues),benchmarks:copy(benchmarks),limitations:[...limitations,'图片只检查路径、标题和来源关系，未进行逐图视觉审稿；工时是有前提的估算，不是工期承诺。']};
}
export function validateAssessment(project,value,{benchmarks=[]}={}){
 if(!value||typeof value!=='object')throw Error('评估未返回有效内容');
 const text=(value,label,limit=2600)=>{if(typeof value!=='string'||!value.trim()||value.length>limit)throw Error(label+'缺失或过长');return value.trim();};
 const strings=(value,label)=>{if(!Array.isArray(value)||value.length>24)throw Error(label+'格式无效');return value.map(v=>text(v,label,1600));};
 const range=(value,label)=>{if(!Number.isFinite(value?.min)||!Number.isFinite(value?.max)||value.min<0||value.max<value.min||value.max>10000)throw Error(label+'范围无效');return{min:value.min,max:value.max};};
 const allowed=new Set([...project.sections,...project.blocks,...project.materials,...benchmarks].map(row=>row.id));
 const refs=(value,label)=>{if(!Array.isArray(value)||value.length>40||value.some(id=>typeof id!=='string'||!allowed.has(id)))throw Error(label+'含不存在的证据标识');return [...new Set(value)];};
 const typedRefs=(value,label,rows)=>{const ids=refs(value,label);if(ids.some(id=>!rows.some(row=>row.id===id)))throw Error(label+'引用了不同类型的证据标识');return ids;};
 const completeness=value.completeness,remaining=value.remainingHours,journal=value.journal;
 if(!Number.isFinite(completeness?.percent)||completeness.percent<0||completeness.percent>100)throw Error('完成度必须为 0–100 的估计');
 if(!JOURNAL_LEVELS.includes(journal?.tier))throw Error('期刊层级应为有条件的建议，不能声称已达到官方分区');
 if(!benchmarks.length&&journal.tier!=='尚无法判断')throw Error('没有实际对照论文，不能推断期刊层级');
 if(!Array.isArray(value.plan)||!value.plan.length||value.plan.length>24)throw Error('执行方案缺失或过长');
 const plan=value.plan.map((step,index)=>({id:'assessment-task-'+(index+1),title:text(step.title,'任务名称',140),action:text(step.action,'执行动作'),deliverable:text(step.deliverable,'交付物'),check:text(step.check,'验收条件'),hours:range(step.hours,'任务工时'),tool:PLAN_TOOLS.includes(step.tool)?step.tool:'manual_write',blockIDs:typedRefs(step.blockIDs||[],'模块定位',project.blocks),materialIDs:typedRefs(step.materialIDs||[],'素材定位',project.materials),evidenceIDs:refs(step.evidenceIDs||[],'任务依据')}));
 const result={summary:text(value.summary,'总体判断'),completeness:{percent:completeness.percent,basis:text(completeness.basis,'完成度依据'),completed:strings(completeness.completed||[],'已完成事项'),gaps:strings(completeness.gaps||[],'待完成事项'),evidenceIDs:refs(completeness.evidenceIDs||[],'完成度依据')},remainingHours:{...range(remaining,'剩余工时'),basis:text(remaining.basis,'工时依据'),assumptions:strings(remaining.assumptions,'工时前提')},journal:{tier:journal.tier,basis:text(journal.basis,'期刊层级依据'),conditions:strings(journal.conditions,'投稿条件'),evidenceIDs:refs(journal.evidenceIDs,'期刊依据')},plan};
 if(benchmarks.length&&journal.tier!=='尚无法判断'&&!result.journal.evidenceIDs.some(id=>benchmarks.some(p=>p.id===id)))throw Error('期刊建议必须引用实际检索的对照论文');
 if(/(?:影响因子|录用率|acceptance rate|\bIF\b)\s*(?:为|是|约|[:：=])?\s*\d|\bQ[1-4]\b|中科院\s*[一二三四1-4]\s*区/iu.test(JSON.stringify(result)))throw Error('未提供已核验期刊指标，不能输出影响因子、录用率或官方分区数值');
 return result;
}
export function assessmentPlanProject(project,assessment){
 if(!isCurrentAssessment(project,assessment))throw Error('正文或素材已改变，请重新评估后导出执行方案');
 const result=assessment.result,sections=[],blocks=[];
 const add=(title,paragraphs)=>{const section={id:'plan-section-'+(sections.length+1),title};sections.push(section);for(const text of paragraphs)blocks.push({id:'plan-block-'+(blocks.length+1),sectionID:section.id,type:'paragraph',text,materials:[],review:'verified'});};
 add('评估概况',[result.summary,'全文完成度估计 '+result.completeness.percent+'%\n'+result.completeness.basis,'剩余工时估计 '+result.remainingHours.min+'–'+result.remainingHours.max+' 小时\n'+result.remainingHours.basis,...result.remainingHours.assumptions.map(v=>'前提 '+v)]);
 add('投稿定位',[result.journal.tier,result.journal.basis,...result.journal.conditions.map(v=>'条件 '+v)]);
 add('已有内容与待完成事项',[...result.completeness.completed.map(v=>'已有 '+v),...result.completeness.gaps.map(v=>'待完成 '+v)]);
 for(const [index,step]of result.plan.entries())add((index+1)+' '+step.title,[step.action,'交付物 '+step.deliverable,'验收条件 '+step.check,'预计 '+step.hours.min+'–'+step.hours.max+' 小时']);
 if(assessment.benchmarks?.length)add('实际对照文献',assessment.benchmarks.map(p=>[p.title,p.journal,p.date,p.doi||p.url].filter(Boolean).join('\n')));
 add('评估范围',assessment.limitations||[]);
 return {schemaVersion:1,id:project.id+'-execution-plan',title:project.title+' 执行方案',sections,blocks,materials:[],chat:[],proposals:[],template:copy(project.template||{}),citationStyle:project.citationStyle,language:project.language,ui:{},revision:0};
}
