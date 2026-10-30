/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingSnapshotHash} from './writing-source-snapshot.mjs';
import {articleSectionType,materialSection} from './article-section-materials.mjs';
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?Object.values(value).map(text).join(' '):'';
const terms=value=>new Set((text(value).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/gu)||[]).flatMap(word=>/[\u4e00-\u9fff]/u.test(word)?Array.from({length:word.length-1},(_,index)=>word.slice(index,index+2)):[word]).filter(word=>!['研究','方法','结果','本文','论文','分析','进行','相关','通过','实验','the','and','with','from','this','that','were','are','for','was','has'].includes(word)));
export const matchTerms=terms;
const preparation=project=>project.researchPreparation||{};
// chapterPlan joins the signature only when present, so projects without chapter
// tasks keep their saved placement state.
const planSignature=project=>writingSnapshotHash(JSON.stringify([preparation(project).plan||preparation(project).currentPlan||null,preparation(project).structure||[],preparation(project).materialRecommendations||[],project.readingSelection||preparation(project).readingSelection||{},project.sections.map(row=>[row.id,row.title,row.writingPurpose||row.purpose||'',project.writingWorkflow?.sections?.[row.id]?.purpose||'',project.writingWorkflow?.sections?.[row.id]?.structure||'']),...(preparation(project).chapterPlan?.length?[preparation(project).chapterPlan]:[])]));
// The chapter's task row and the linked hypothesis and experiment records.
const chapterTask=(prep,section)=>{
 const row=(prep.chapterPlan||[]).find(item=>item?.sectionID===section.id);if(!row)return null;
 const plan=prep.plan||prep.currentPlan||{},hypotheses=(plan.hypotheses||[]).filter(item=>(row.hypothesisIDs||[]).includes(item.id)),experiments=(plan.experiments||[]).filter(item=>(row.experimentIDs||[]).includes(item.id));
 return {row,refs:[...hypotheses.map(item=>item.id),...experiments.map(item=>item.id)],text:[row.task,row.evidenceNeeds,hypotheses.map(item=>item.claim),experiments.map(item=>[item.title,item.data,item.metrics,item.comparison,item.outputs])]};
};
const materialSignature=material=>writingSnapshotHash(JSON.stringify([material.revision,material.title,material.summary,material.sectionType,material.section,material.tags,material.category,material.sourceVersion,material.sourceText?.length,String(material.sourceText||material.anchor?.sourceText||'').slice(0,3000)]));

/** Writing use and source chapter are different concepts. A concrete project
 * recommendation wins; an unknown source stays available for manual placement. */
export function matchMaterialSection(project,material,{recommendation}={}){
 if(!material||material.kind==='idea')return null;
 const prep=preparation(project),suggestion=recommendation||(prep.materialRecommendations||[]).find(row=>row.materialID===material.id);
 if(suggestion&&(!suggestion.sourceRevision||suggestion.sourceRevision===material.revision)&&project.sections.some(row=>row.id===suggestion.sectionID))return {sectionID:suggestion.sectionID,reason:suggestion.reason||'按已确认方案中的素材用途匹配'};
 const selection=project.readingSelection||prep.readingSelection||{},paperID=material.paperItemID||material.anchor?.paperItemID||material.sourceItemID;
 if(paperID&&String(selection.structurePaperID)===String(paperID)&&!(selection.closeReadingPaperIDs||[]).some(id=>String(id)===String(paperID)))return null;
 if(project.sections.some(row=>row.id===material.targetSectionID))return {sectionID:material.targetSectionID,reason:'保留素材指定的写作章节'};
 const haystack=terms([material.title,material.summary,material.category,material.tags,String(material.sourceText||material.anchor?.sourceText||'').slice(0,3000)]),scored=[];
 for(const section of project.sections){const structure=(prep.structure||[]).find(row=>row.id===section.id||row.title===section.title),task=chapterTask(prep,section),purpose=[section.writingPurpose||section.purpose||'',structure?.purpose||'',project.writingWorkflow?.sections?.[section.id]?.purpose||'',project.writingWorkflow?.sections?.[section.id]?.structure||'',...(task?[task.text]:[])],needles=terms(purpose),hits=[...needles].filter(word=>haystack.has(word)).length;if(hits>=2)scored.push({sectionID:section.id,hits,score:hits/Math.sqrt(needles.size||1),reason:task?'对应 '+section.title+' · '+String(task.row.task||'').slice(0,40)+(task.refs.length?' · 验证 '+task.refs.join('/'):''):'素材内容对应本章已制定的写作任务'});}
 scored.sort((a,b)=>b.score-a.score);if(scored[0]&&(!scored[1]||scored[0].score>=scored[1].score*1.3))return scored[0];
 const type=materialSection(material);if(type==='正文')return null;
 const sections=project.sections.filter(row=>articleSectionType(row.title)===type);
 return sections.length===1?{sectionID:sections[0].id,reason:'按素材原章节匹配同类写作章节；用途可继续调整'}:null;
}

export function associateProjectMaterials(project,{createBlock,requirePlan=false}={}){
 if(requirePlan&&!preparation(project).plan&&!preparation(project).currentPlan)return 0;
 const signature=planSignature(project),state=project.materialPlacementState||{version:1,materials:{}},linked=new Set(project.blocks.flatMap(row=>(row.materials||[]).map(link=>link.id)));let count=0;
 state.materials||={};
 for(const material of project.materials||[]){
  const prior=state.materials[material.id];if(linked.has(material.id)){state.materials[material.id]={...prior,placed:true};continue;}
  // Removing an existing link is a user decision. Reopening or typing must not
  // silently restore it. The explicit matching preview can place it again.
  if(prior?.placed)continue;
  const key=signature+':'+materialSignature(material);if(prior?.signature===key)continue;
  const match=matchMaterialSection(project,material);state.materials[material.id]={signature:key,placed:false};if(!match||!createBlock)continue;
  let block=project.blocks.find(row=>row.sectionID===match.sectionID&&!row.locked&&!row.text?.trim()&&!row.materials?.length&&['paragraph','placeholder'].includes(row.type));
  if(!block){block=createBlock('paragraph',match.sectionID,{assembly:true});project.blocks.push(block);}
  block.assembly=true;block.emptyStarter=false;block.materials=[{id:material.id,role:'primary',revision:material.revision||0}];block.materialPlacement={source:'automatic-match',materialID:material.id,reason:match.reason};state.materials[material.id].placed=true;linked.add(material.id);count++;
 }
 project.materialPlacementState=state;return count;
}

export function materialPlacementSuggestions(project){
 const changes=[];for(const material of project.materials||[]){const match=matchMaterialSection(project,material);if(!match)continue;const blocks=project.blocks.filter(row=>(row.materials||[]).some(link=>link.id===material.id));if(blocks.some(row=>row.sectionID===match.sectionID))continue;if(blocks.some(row=>row.locked))continue;changes.push({materialID:material.id,sectionID:match.sectionID,fromBlockIDs:blocks.map(row=>row.id),hasAuthoredContext:blocks.some(row=>row.text?.trim()),reason:match.reason});}return changes;
}
// A match command can use prepared source materials which are visible in the
// project library but have not yet been imported into the manuscript snapshot.
// An explicit preparation selection is authoritative, including an empty one.
// Corpus rows are gated by the corpus choice instead and enter only here, in
// the explicit match dialog, never through automatic association.
export function materialPlacementPool(project,materials=[],{selectedIDs,corpusRows=[]}={}){
 const known=new Set(project.materials.map(row=>row.id)),selected=selectedIDs===undefined?null:new Set(selectedIDs),extra=materials.filter(row=>!known.has(row.id)&&(!selected||selected.has(row.id))&&row.kind!=='idea'&&!['ai-discussion','ai-illustration'].includes(row.sourceType)&&!(row.conversationID&&row.messageID)&&String(row.sourceText||row.anchor?.sourceText||'').trim());
 const present=new Set([...known,...extra.map(row=>row.id)]),entries=new Set(project.materials.map(row=>row.corpusEntryID).filter(Boolean)),corpus=corpusRows.filter(row=>row?.id&&!present.has(row.id)&&!entries.has(row.corpusEntryID)&&!(row.originMaterialID&&present.has(row.originMaterialID))&&String(row.sourceText||'').trim());
 return {...project,materials:[...project.materials,...extra,...corpus]};
}
export function materialPlacementReport(project){
 const linkedIDs=new Set(project.blocks.flatMap(row=>(row.materials||[]).map(link=>link.id))),suggestions=materialPlacementSuggestions(project),suggestedIDs=new Set(suggestions.map(row=>row.materialID));
 return {suggestions,linked:project.materials.filter(row=>linkedIDs.has(row.id)),unresolved:project.materials.filter(row=>!linkedIDs.has(row.id)&&!suggestedIDs.has(row.id)),sections:project.sections.map(section=>({sectionID:section.id,title:section.title,blocks:project.blocks.filter(block=>block.sectionID===section.id&&block.materials?.length)})).filter(row=>row.blocks.length)};
}
export const materialPlacementRevision=project=>writingSnapshotHash(JSON.stringify([planSignature(project),project.materials.map(row=>[row.id,materialSignature(row)]),project.blocks.map(row=>[row.id,row.sectionID,row.text,row.locked,row.materials])]));
export function applyMaterialPlacements(project,changes,{createBlock,revision}={}){
 if(revision&&materialPlacementRevision(project)!==revision)throw Error('素材、章节或方案已变化，请重新匹配');
 const allowed=new Map(materialPlacementSuggestions(project).map(row=>[row.materialID,row]));
 for(const change of changes)if(!allowed.has(change.materialID)||allowed.get(change.materialID).sectionID!==change.sectionID)throw Error('章节匹配已变化，请重新检查');
 for(const change of changes){for(const block of project.blocks)block.materials=(block.materials||[]).filter(link=>link.id!==change.materialID);const material=project.materials.find(row=>row.id===change.materialID);let target=project.blocks.find(row=>row.sectionID===change.sectionID&&!row.locked&&!row.text?.trim()&&!row.materials?.length&&['paragraph','placeholder'].includes(row.type));if(!target){target=createBlock('paragraph',change.sectionID,{assembly:true});project.blocks.push(target);}target.materials=[{id:material.id,role:'primary',revision:material.revision||0}];target.assembly=true;target.emptyStarter=false;target.materialPlacement={source:'confirmed-match',materialID:material.id,reason:change.reason};}
 return changes.length;
}
