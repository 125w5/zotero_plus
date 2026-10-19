/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingSnapshotHash} from '../shared/writing-source-snapshot.mjs';
import {protectEdit,safeNumbers,protectedTokens} from '../shared/writing-protection.mjs';
import {writingPreviewDiff,writingPreviewRuns} from '../shared/assembly-writing-preview.mjs';
import {createMaterialHighlightGroup} from '../shared/material-highlights.mjs';
import {chapterRule,writingPreparation} from '../shared/writing-framework.mjs';
import {writingWorkflowContext} from '../shared/paper-writing-workflow.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const targetKinds=new Set(['block','digest','comment','summary','source-note']);
const materialFor=(project,target)=>project.materials?.find(row=>row.id===target.materialID);
export function selectionTargetValue(project,target){
 if(target.kind==='block')return project.blocks?.find(row=>row.id===target.blockID)?.text;
 if(target.kind==='digest'){const node=project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);return node?.narrative||node?.claim;}
 const material=materialFor(project,target);if(!material)return undefined;
 if(target.kind==='comment')return material.highlights?.find(row=>row.id===target.highlightID)?.comment;
 if(target.kind==='summary')return target.displayText??material.summary;
 if(target.kind==='source-note')return target.displayText;
 return undefined;
}
function sourceVersion(project,target){
 const block=project.blocks?.find(row=>row.id===target.blockID),node=project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);
 const ids=target.materialID?[target.materialID]:target.kind==='digest'?[...new Set((node?.evidence||[]).map(row=>row.sourceID).filter(id=>!id.startsWith('author:')))]:block?.materials?.map(row=>row.id)||[];
 return ids.map(id=>{const material=project.materials?.find(row=>row.id===id);if(!material)return {id,missing:true};return {id,revision:material.revision,sourceHash:writingSnapshotHash(String(material.fullSourceText||material.sourceText||material.anchor?.sourceText||'')),anchorHash:writingSnapshotHash(JSON.stringify({anchor:material.anchor,anchors:material.anchors,sourceAnchors:material.sourceAnchors,sourceBlocks:material.sourceBlocks}))};});
}
function writingContext(project,target){
 const section=project.sections?.find(row=>row.id===target.sectionID),block=project.blocks?.find(row=>row.id===target.blockID),node=project.writingFrameworks?.[target.sectionID]?.nodes?.find(row=>row.id===target.unitID);
 return {title:project.title,section:section?.title,rule:{...chapterRule(section?.title||''),userPurpose:section?.writingPurpose||'',unitPurpose:node?.purpose||''},requirements:block?.requirements||'',
  preparation:writingPreparation(project),writingWorkflow:project.writingWorkflow?writingWorkflowContext(project,target.sectionID,{materialIDs:sourceVersion(project,target).map(row=>row.id)}):undefined};
}
export function captureSelectionTarget(project,{kind,sectionID,blockID='',materialID='',unitID='',highlightID='',start,end,displayText,selectionGroup}={}){
 if(!targetKinds.has(kind))throw Error('请选择正文、速读、素材说明或批注中的文字');
 const target={kind,projectID:project.id,sectionID:sectionID||project.blocks?.find(row=>row.id===blockID)?.sectionID||project.ui?.sectionID,blockID,materialID,unitID,highlightID};
 if(kind==='source-note'){target.displayText=String(displayText||'');target.selectionGroup=clone(selectionGroup||[]);createMaterialHighlightGroup(materialFor(project,target),target.selectionGroup);}
 if(kind==='summary'&&displayText!==undefined){target.displayText=String(displayText);target.summaryBefore=materialFor(project,target)?.summary;}
 const full=selectionTargetValue(project,target);if(typeof full!=='string')throw Error('选中的内容已经变化，请重新选择');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>full.length||end-start>4000)throw Error('请选择同一段内的文字，最多 4000 字符');
 target.start=start;target.end=end;target.text=full.slice(start,end);target.before=full;target.sourceVersions=sourceVersion(project,target);target.contextVersion=writingSnapshotHash(JSON.stringify(writingContext(project,target)));
 if(!target.text.trim())throw Error('请选择要修改的文字');assertSelectionTargetCurrent(project,target);return target;
}
export function assertSelectionTargetCurrent(project,target){
 if(!targetKinds.has(target?.kind))throw Error('选区类型无效，请重新选择');
 if(project?.id!==target?.projectID||!project.sections?.some(row=>row.id===target.sectionID))throw Error('选区所属论文或章节已经变化，请重新选择');
 if(selectionTargetValue(project,target)!==target.before||target.before.slice(target.start,target.end)!==target.text)throw Error('选中文字已有修改，请重新选择；已有内容保留');
 if(target.kind==='summary'&&target.displayText!==undefined&&materialFor(project,target)?.summary!==target.summaryBefore)throw Error('素材说明已经修改，请重新选择');
 const block=project.blocks?.find(row=>row.id===target.blockID);if(block&&(block.locked||block.sectionID!==target.sectionID))throw Error('选区已锁定或移到其他章节，请重新选择');
 if(JSON.stringify(sourceVersion(project,target))!==JSON.stringify(target.sourceVersions))throw Error('选区关联的来源已经变化，请重新选择');
 if(target.contextVersion!==writingSnapshotHash(JSON.stringify(writingContext(project,target))))throw Error('选区所属章节的写作计划或要求已经变化，请重新选择');
 if(target.kind==='source-note')createMaterialHighlightGroup(materialFor(project,target),target.selectionGroup);
 return target;
}
export function selectionRequestContext(project,target){
 assertSelectionTargetCurrent(project,target);
 return {...writingContext(project,target),targetKind:target.kind,selectedText:target.kind==='source-note'?'':target.text,selectedSource:target.kind==='source-note'?target.text:undefined,
  beforeContext:target.before.slice(Math.max(0,target.start-800),target.start),afterContext:target.before.slice(target.end,target.end+800),
  sources:target.sourceVersions.map(row=>{const material=project.materials.find(item=>item.id===row.id),text=String(material?.fullSourceText||material?.sourceText||material?.anchor?.sourceText||'');return {id:row.id,title:material?.title||'',text:text.slice(0,10000),truncated:text.length>10000,kind:material?.kind||'',coverage:material?.coverage||''};})};
}
export function validateSelectionPreview(target,value,{id='selection-'+Date.now(),model=''}={}){
 if(!Array.isArray(value?.variants)||value.variants.length<2||value.variants.length>3)throw Error('请返回两个或三个可比较的局部修改方案');
 const seen=new Set(),variants=value.variants.map((row,index)=>{const text=typeof row?.text==='string'?row.text.trim():'';if(!text||text.length>6000||seen.has(text))throw Error('局部候选为空、过长或重复');seen.add(text);
  if(target.kind!=='source-note'){protectEdit(target.text,text);safeNumbers(target.text,text);const known=new Set(protectedTokens(target.text));if(protectedTokens(text).some(token=>!known.has(token)))throw Error('候选引入了未核对的公式，已保留原文');const citations=value=>(value.match(/\[\d+(?:[\d\s,，;；–-]*\d)?\]|\([A-Z][^()\n]{0,90}\b(?:19|20)\d{2}[a-z]?[^()\n]{0,20}\)/gu)||[]).sort();if(JSON.stringify(citations(target.text))!==JSON.stringify(citations(text)))throw Error('候选改变了选区引用，已保留原文');}
  else {const allowed=new Set((target.text.match(/[-+]?\d+(?:\.\d+)?%?/gu)||[]));if((text.match(/[-+]?\d+(?:\.\d+)?%?/gu)||[]).some(number=>!allowed.has(number)))throw Error('批注引入了选段没有的数值，未保存');}
  return {id:id+'-'+index,label:String(row.label||'方案 '+(index+1)).slice(0,60),text,diff:writingPreviewDiff(target.kind==='source-note'?'':target.text,text)};});
 return {id,kind:'assembly-selection-preview',target:clone(target),variants,selectedVariantID:variants[0].id,status:'pending',model,createdAt:new Date().toISOString()};
}
export function selectionPreviewReplacement(preview,variantID){const variant=preview.variants.find(row=>row.id===variantID);if(!variant)throw Error('请选择一个修改方案');const target=preview.target;return {variant,value:target.before.slice(0,target.start)+variant.text+target.before.slice(target.end)};}
export function applySelectionPreview(project,preview,variantID,{confirmed=false}={}){
 if(!confirmed||preview.status!=='pending')throw Error('请确认采用尚未处理的方案');const target=preview.target;assertSelectionTargetCurrent(project,target);const {variant,value}=selectionPreviewReplacement(preview,variantID);
 if(['comment','summary','source-note'].includes(target.kind))return {material:materialFor(project,target),value,variant};
 if(target.kind==='block'){const block=project.blocks.find(row=>row.id===target.blockID);preview.beforeApplied=clone(block);block.text=value;const runs=writingPreviewRuns(preview.beforeApplied,{text:value});if(runs)block.runs=runs;block.revision=(block.revision||0)+1;block.review='missing';preview.appliedContent=clone(block);}
 else {const node=project.writingFrameworks[target.sectionID].nodes.find(row=>row.id===target.unitID);preview.beforeApplied={narrative:node.narrative,claim:node.claim,userEdited:node.userEdited};node.narrative=value;node.userEdited=true;preview.appliedContent={narrative:node.narrative,claim:node.claim,userEdited:node.userEdited};}
 preview.status='accepted';preview.selectedVariantID=variantID;return {value,variant};
}
export function revertSelectionPreview(project,preview,{confirmed=false}={}){
 if(!confirmed||preview.status!=='accepted')throw Error('请选择已采用的修改进行撤回');const target=preview.target;if(project.id!==target.projectID)throw Error('论文已切换，不能撤回其他论文的修改');
 if(target.kind==='block'){const block=project.blocks.find(row=>row.id===target.blockID);if(!block||block.locked||JSON.stringify(block)!==JSON.stringify(preview.appliedContent))throw Error('采用后已有人工修改，请使用编辑器撤销或手动调整');for(const key of Object.keys(block))delete block[key];Object.assign(block,clone(preview.beforeApplied));}
 else if(target.kind==='digest'){const node=project.writingFrameworks?.[target.sectionID]?.nodes.find(row=>row.id===target.unitID);if(!node||JSON.stringify({narrative:node.narrative,claim:node.claim,userEdited:node.userEdited})!==JSON.stringify(preview.appliedContent))throw Error('采用后速读已有人工修改，请手动调整');for(const key of ['narrative','claim','userEdited']){if(preview.beforeApplied[key]===undefined)delete node[key];else node[key]=preview.beforeApplied[key];}}
 else throw Error('请通过素材修改记录撤回');preview.status='reverted';return project;
}
