/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingSnapshotHash} from '../shared/writing-source-snapshot.mjs';
import {protectEdit,safeNumbers,protectedTokens} from '../shared/writing-protection.mjs';
import {writingPreviewDiff,writingPreviewRuns,shortenRequest} from '../shared/assembly-writing-preview.mjs';
import {createMaterialHighlightGroup} from '../shared/material-highlights.mjs';
import {chapterRule,writingPreparation} from '../shared/writing-framework.mjs';
import {writingWorkflowContext} from '../shared/paper-writing-workflow.mjs';
import {threadContext,readNodeText,readSelectionBudget} from '../shared/research-thread.mjs';
// The output budget of a selection rewrite follows the selection: every variant
// may be as long as the selection, so a long passage asks for fewer variants
// instead of stopping at a fixed cap. A request to shorten gets one variant.
export function selectionBudget(text,instruction=''){
 const budget=readSelectionBudget(text,'rewrite'),shorten=shortenRequest(instruction);
 const maxVariants=shorten?1:budget.maxVariants;
 return {maxTokens:budget.maxTokens,maxVariants,minVariants:maxVariants<3?1:2};
}
const clone=value=>JSON.parse(JSON.stringify(value));
// 'read-node' is a point of a chapter read in projectReadings; its text is
// resolved through the readings passed by the caller, never the project.
const targetKinds=new Set(['block','digest','comment','summary','source-note','read-node']);
const materialFor=(project,target)=>project.materials?.find(row=>row.id===target.materialID);
let readNodeOf=(target,readings)=>readings?.chapters?.[target.sectionID]?.nodes?.find(row=>row.id===target.nodeID);
let readEditOf=(target,readings)=>readings?.edits?.[target.sectionID]?.[target.nodeID]||null;
export function selectionTargetValue(project,target,{readings}={}){
 if(target.kind==='block')return project.blocks?.find(row=>row.id===target.blockID)?.text;
 if(target.kind==='digest'){const node=project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);return node?.narrative||node?.claim;}
 if(target.kind==='read-node'){let node=readNodeOf(target,readings);return node?readNodeText(node,readEditOf(target,readings)):undefined;}
 const material=materialFor(project,target);if(!material)return undefined;
 if(target.kind==='comment')return material.highlights?.find(row=>row.id===target.highlightID)?.comment;
 if(target.kind==='summary')return target.displayText??material.summary;
 if(target.kind==='source-note')return target.displayText;
 return undefined;
}
function sourceVersion(project,target,{readings}={}){
 const block=project.blocks?.find(row=>row.id===target.blockID),node=target.kind==='read-node'?readNodeOf(target,readings):project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);
 const ids=target.materialID?[target.materialID]:target.kind==='digest'||target.kind==='read-node'?[...new Set((node?.evidence||[]).map(row=>row.materialID||row.sourceID).filter(id=>id&&!id.startsWith('author:')))]:block?.materials?.map(row=>row.id)||[];
 return ids.map(id=>{const material=project.materials?.find(row=>row.id===id);if(!material)return {id,missing:true};return {id,revision:material.revision,sourceHash:writingSnapshotHash(String(material.fullSourceText||material.sourceText||material.anchor?.sourceText||'')),anchorHash:writingSnapshotHash(JSON.stringify({anchor:material.anchor,anchors:material.anchors,sourceAnchors:material.sourceAnchors,sourceBlocks:material.sourceBlocks}))};});
}
// Shape 2 (new captures) adds the chapter slice and direction choices. Targets
// captured before it keep the legacy shape, so their previews stay current.
let chapterSlice=(project,sectionID)=>{
 let thread;try{thread=threadContext(project,undefined);}catch{return {chapter:null,directionChoices:[]};}
 let chapter=thread.chapters.find(row=>row.sectionID===sectionID);
 return {chapter:chapter?{sectionID,task:chapter.task,taskSource:chapter.taskSource,hypotheses:chapter.hypotheses,experiments:chapter.experiments,evidenceNeeds:chapter.evidenceNeeds,route:chapter.route}:null,directionChoices:thread.decisions.filter(row=>row.origin==='direction'&&(!row.sectionIDs?.length||row.sectionIDs.includes(sectionID))).map(({id,question,choice,detail,effects})=>({id,question,choice,detail,effects}))};
};
function writingContext(project,target,options={}){
 const section=project.sections?.find(row=>row.id===target.sectionID),block=project.blocks?.find(row=>row.id===target.blockID),node=project.writingFrameworks?.[target.sectionID]?.nodes?.find(row=>row.id===target.unitID);
 const value={title:project.title,section:section?.title,rule:{...chapterRule(section?.title||''),userPurpose:section?.writingPurpose||'',unitPurpose:node?.purpose||''},requirements:block?.requirements||'',
  preparation:writingPreparation(project),writingWorkflow:project.writingWorkflow?writingWorkflowContext(project,target.sectionID,{materialIDs:sourceVersion(project,target,options).map(row=>row.id)}):undefined};
 if((target.contextShape||1)<2)return value;
 return {...value,...chapterSlice(project,target.sectionID)};
}
// The hash that decides whether a selection preview still matches its chapter context.
export function selectionContextVersion(project,target,options={}){return writingSnapshotHash(JSON.stringify(writingContext(project,target,options)));}
export function captureSelectionTarget(project,{kind,sectionID,blockID='',materialID='',unitID='',nodeID='',highlightID='',start,end,displayText,selectionGroup}={},options={}){
 if(!targetKinds.has(kind))throw Error('请选择正文、速读、素材说明或批注中的文字');
 const target={kind,projectID:project.id,sectionID:sectionID||project.blocks?.find(row=>row.id===blockID)?.sectionID||project.ui?.sectionID,blockID,materialID,unitID,highlightID,contextShape:2,...(kind==='read-node'?{nodeID}:{})};
 if(kind==='source-note'){target.displayText=String(displayText||'');target.selectionGroup=clone(selectionGroup||[]);createMaterialHighlightGroup(materialFor(project,target),target.selectionGroup);}
 if(kind==='summary'&&displayText!==undefined){target.displayText=String(displayText);target.summaryBefore=materialFor(project,target)?.summary;}
 const full=selectionTargetValue(project,target,options);if(typeof full!=='string')throw Error('选中的内容已经变化，请重新选择');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>full.length||end-start>4000)throw Error('请选择同一段内的文字，最多 4000 字符');
 target.start=start;target.end=end;target.text=full.slice(start,end);target.before=full;target.sourceVersions=sourceVersion(project,target,options);target.contextVersion=selectionContextVersion(project,target,options);
 if(!target.text.trim())throw Error('请选择要修改的文字');assertSelectionTargetCurrent(project,target,options);return target;
}
export function assertSelectionTargetCurrent(project,target,options={}){
 if(!targetKinds.has(target?.kind))throw Error('选区类型无效，请重新选择');
 if(project?.id!==target?.projectID||!project.sections?.some(row=>row.id===target.sectionID))throw Error('选区所属论文或章节已经变化，请重新选择');
 if(selectionTargetValue(project,target,options)!==target.before||target.before.slice(target.start,target.end)!==target.text)throw Error('选中文字已有修改，请重新选择；已有内容保留');
 if(target.kind==='summary'&&target.displayText!==undefined&&materialFor(project,target)?.summary!==target.summaryBefore)throw Error('素材说明已经修改，请重新选择');
 const block=project.blocks?.find(row=>row.id===target.blockID);if(block&&(block.locked||block.sectionID!==target.sectionID))throw Error('选区已锁定或移到其他章节，请重新选择');
 if(JSON.stringify(sourceVersion(project,target,options))!==JSON.stringify(target.sourceVersions))throw Error('选区关联的来源已经变化，请重新选择');
 if(target.contextVersion!==selectionContextVersion(project,target,options))throw Error('选区所属章节的写作计划或要求已经变化，请重新选择');
 if(target.kind==='source-note')createMaterialHighlightGroup(materialFor(project,target),target.selectionGroup);
 return target;
}
export function selectionRequestContext(project,target,options={}){
 assertSelectionTargetCurrent(project,target,options);
 if(target.kind==='read-node'){
  let node=readNodeOf(target,options.readings);
  return {...writingContext(project,target,options),targetKind:target.kind,selectedText:target.text,readText:target.before,beforeContext:target.before.slice(Math.max(0,target.start-800),target.start),afterContext:target.before.slice(target.end,target.end+800),
   readNode:{role:node.role,status:node.status,claim:node.claim,planRefs:node.planRefs||[],decisionRefs:node.decisionRefs||[]},evidence:(node.evidence||[]).map(row=>({quoteID:row.quoteID,materialID:row.materialID,quote:row.quote,pageIndex:row.pageIndex??null,...(row.manual?{manual:true}:{})})),
   sources:target.sourceVersions.map(row=>{const material=project.materials.find(item=>item.id===row.id),text=String(material?.fullSourceText||material?.sourceText||material?.anchor?.sourceText||'');return {id:row.id,title:material?.title||'',text:text.slice(0,10000),truncated:text.length>10000,kind:material?.kind||'',coverage:material?.coverage||''};})};
 }
 return {...writingContext(project,target,options),targetKind:target.kind,selectedText:target.kind==='source-note'?'':target.text,selectedSource:target.kind==='source-note'?target.text:undefined,
  beforeContext:target.before.slice(Math.max(0,target.start-800),target.start),afterContext:target.before.slice(target.end,target.end+800),
  sources:target.sourceVersions.map(row=>{const material=project.materials.find(item=>item.id===row.id),text=String(material?.fullSourceText||material?.sourceText||material?.anchor?.sourceText||'');return {id:row.id,title:material?.title||'',text:text.slice(0,10000),truncated:text.length>10000,kind:material?.kind||'',coverage:material?.coverage||''};})};
}
export function validateSelectionPreview(target,value,{id='selection-'+Date.now(),model='',minVariants=2}={}){
 if(!Array.isArray(value?.variants)||value.variants.length<minVariants||value.variants.length>3)throw Error(minVariants<2?'请返回一至三个局部修改方案':'请返回两个或三个可比较的局部修改方案');
 const seen=new Set(),variants=value.variants.map((row,index)=>{const text=typeof row?.text==='string'?row.text.trim():'';if(!text||text.length>6000||seen.has(text))throw Error('局部候选为空、过长或重复');seen.add(text);
  if(target.kind!=='source-note'){protectEdit(target.text,text);safeNumbers(target.text,text);const known=new Set(protectedTokens(target.text));if(protectedTokens(text).some(token=>!known.has(token)))throw Error('候选引入了未核对的公式，已保留原文');const citations=value=>(value.match(/\[\d+(?:[\d\s,，;；–-]*\d)?\]|\([A-Z][^()\n]{0,90}\b(?:19|20)\d{2}[a-z]?[^()\n]{0,20}\)/gu)||[]).sort();if(JSON.stringify(citations(target.text))!==JSON.stringify(citations(text)))throw Error('候选改变了选区引用，已保留原文');}
  else {const allowed=new Set((target.text.match(/[-+]?\d+(?:\.\d+)?%?/gu)||[]));if((text.match(/[-+]?\d+(?:\.\d+)?%?/gu)||[]).some(number=>!allowed.has(number)))throw Error('批注引入了选段没有的数值，未保存');}
  return {id:id+'-'+index,label:String(row.label||'方案 '+(index+1)).slice(0,60),text,diff:writingPreviewDiff(target.kind==='source-note'?'':target.text,text)};});
 return {id,kind:'assembly-selection-preview',target:clone(target),variants,selectedVariantID:variants[0].id,status:'pending',model,createdAt:new Date().toISOString()};
}
// The reader's protected parts: math, numbers, comparisons and subscripted symbols.
export function readProtectedParts(value){
 const math=/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu,plain=String(value||'').replace(math,'');
 return [String(value||'').match(math)||[],plain.match(/[-+]?\d+(?:[.,]\d+)*(?:%|‰)?/gu)||[],(plain.match(/[A-Za-z\u0370-\u03ff0-9_^{}()[\].+\-\u00b2\u00b3\u00b9\u2070-\u209f]+(?:\s*(?:<=|>=|!=|[=<>≤≥≠≈≃±×÷→↔])\s*[A-Za-z\u0370-\u03ff0-9_^{}()[\].+\-\u00b2\u00b3\u00b9\u2070-\u209f]+)+/gu)||[]).map(formula=>formula.replace(/\s+/gu,'')),plain.match(/[A-Za-z\u0370-\u03ff][A-Za-z\u0370-\u03ff0-9]*(?:[_^][A-Za-z\u0370-\u03ff0-9{}]+|[\u00b2\u00b3\u00b9\u2070-\u209f]+)/gu)||[]];
}
// A faithful rewrite of a read point: one to three variants, each keeping the
// selection's numbers, units, formulas and citations; preview before accept.
export function validateReadSelectionPreview(target,value,{id='read-selection-'+Date.now(),model=''}={}){
 if(target?.kind!=='read-node')throw Error('请在装配速读中选择文字');
 const rows=Array.isArray(value?.variants)?value.variants:typeof value?.text==='string'?[{label:'忠实改写',text:value.text}]:[];
 if(!rows.length||rows.length>3)throw Error('请返回一至三个忠实改写方案');
 const seen=new Set(),variants=rows.map((row,index)=>{const text=typeof row?.text==='string'?row.text.trim():'';if(!text||text.length>3000||seen.has(text)||text===target.text)throw Error('改写为空、过长、重复或与原文相同');seen.add(text);
  protectEdit(target.text,text);safeNumbers(target.text,text);if(JSON.stringify(readProtectedParts(target.text))!==JSON.stringify(readProtectedParts(text)))throw Error('改写未完整保留选段的数值或公式，未采用');
  return {id:id+'-'+index,label:String(row.label||'方案 '+(index+1)).slice(0,60),text,diff:writingPreviewDiff(target.text,text)};});
 return {id,kind:'assembly-selection-preview',target:clone(target),variants,selectedVariantID:variants[0].id,status:'pending',model,createdAt:new Date().toISOString()};
}
export function selectionPreviewReplacement(preview,variantID){const variant=preview.variants.find(row=>row.id===variantID);if(!variant)throw Error('请选择一个修改方案');const target=preview.target;return {variant,value:target.before.slice(0,target.start)+variant.text+target.before.slice(target.end)};}
// A read-node result is an overlay op ({type:'edit'}) that the caller saves in
// projectReadings; the project itself is not changed.
export function applySelectionPreview(project,preview,variantID,{confirmed=false,readings}={}){
 if(!confirmed||preview.status!=='pending')throw Error('请确认采用尚未处理的方案');const target=preview.target;assertSelectionTargetCurrent(project,target,{readings});const {variant,value}=selectionPreviewReplacement(preview,variantID);
 if(target.kind==='read-node'){preview.beforeApplied={edit:clone(readEditOf(target,readings))};preview.appliedContent={text:value};preview.status='accepted';preview.selectedVariantID=variantID;return {value,variant,readEdit:{type:'edit',sectionID:target.sectionID,nodeID:target.nodeID,text:value,origin:'rewrite'}};}
 if(['comment','summary','source-note'].includes(target.kind))return {material:materialFor(project,target),value,variant};
 if(target.kind==='block'){const block=project.blocks.find(row=>row.id===target.blockID);preview.beforeApplied=clone(block);block.text=value;const runs=writingPreviewRuns(preview.beforeApplied,{text:value});if(runs)block.runs=runs;block.revision=(block.revision||0)+1;block.review='missing';preview.appliedContent=clone(block);}
 else {const node=project.writingFrameworks[target.sectionID].nodes.find(row=>row.id===target.unitID);preview.beforeApplied={narrative:node.narrative,claim:node.claim,userEdited:node.userEdited};node.narrative=value;node.userEdited=true;preview.appliedContent={narrative:node.narrative,claim:node.claim,userEdited:node.userEdited};}
 preview.status='accepted';preview.selectedVariantID=variantID;return {value,variant};
}
export function revertSelectionPreview(project,preview,{confirmed=false,readings}={}){
 if(!confirmed||preview.status!=='accepted')throw Error('请选择已采用的修改进行撤回');const target=preview.target;if(project.id!==target.projectID)throw Error('论文已切换，不能撤回其他论文的修改');
 if(target.kind==='read-node'){const node=readNodeOf(target,readings);if(!node||readNodeText(node,readEditOf(target,readings))!==preview.appliedContent?.text)throw Error('采用后速读已有修改，请手动调整或恢复 AI 解析');preview.status='reverted';return {readEdit:{type:'restore',sectionID:target.sectionID,nodeID:target.nodeID,edit:preview.beforeApplied?.edit||null}};}
 if(target.kind==='block'){const block=project.blocks.find(row=>row.id===target.blockID);if(!block||block.locked||JSON.stringify(block)!==JSON.stringify(preview.appliedContent))throw Error('采用后已有人工修改，请使用编辑器撤销或手动调整');for(const key of Object.keys(block))delete block[key];Object.assign(block,clone(preview.beforeApplied));}
 else if(target.kind==='digest'){const node=project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);if(!node||JSON.stringify({narrative:node.narrative,claim:node.claim,userEdited:node.userEdited})!==JSON.stringify(preview.appliedContent))throw Error('采用后速读已有人工修改，请手动调整');for(const key of ['narrative','claim','userEdited']){if(preview.beforeApplied[key]===undefined)delete node[key];else node[key]=preview.beforeApplied[key];}}
 else throw Error('请通过素材修改记录撤回');preview.status='reverted';return project;
}
