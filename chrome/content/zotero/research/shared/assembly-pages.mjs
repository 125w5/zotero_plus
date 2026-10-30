/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {sectionInsertionIndex} from '../manuscript/section-insertion.mjs';

function sectionFor(project,sectionID){const section=project.sections.find(row=>row.id===sectionID);if(!section)throw Error('目标章节已经不存在，请重新选择');return section;}
function anchorFor(project,sectionID,anchorID){if(!anchorID)return null;const block=project.blocks.find(row=>row.id===anchorID);if(!block||block.sectionID!==sectionID)throw Error('目标页的位置已变化，请重新选择');return block;}

// A page is an explicit, editable empty paragraph with a stable identity. It
// remains a real layout boundary in both source and manuscript display modes.
// Existing text is never copied into it, and undo owns the whole mutation.
export function insertAssemblyPage(project,M,{sectionID,position='after',anchorID=''}={}){
 sectionFor(project,sectionID);if(!['before','after'].includes(position))throw Error('新增页位置应为 before 或 after');
 const anchor=anchorFor(project,sectionID,anchorID),blocks=project.blocks.filter(row=>row.sectionID===sectionID),first=blocks[0],target=anchor||(position==='before'?first:blocks.at(-1));
 const index=target?sectionInsertionIndex(project.blocks,project.sections,sectionID,position==='before'?{beforeID:target.id}:{afterID:target.id}):sectionInsertionIndex(project.blocks,project.sections,sectionID);
 const marker=M.block('paragraph',sectionID,{explicitPage:true,emptyStarter:true,pageBreakBefore:position==='after'||!!first&&index>project.blocks.indexOf(first)}),following=project.blocks[index];
 if(!blocks.length){const blank=M.block('paragraph',sectionID,{emptyStarter:true,explicitPage:true,pageBreakBefore:position==='before'});project.blocks.splice(index,0,...(position==='before'?[marker,blank]:[blank,marker]));}
 else {project.blocks.splice(index,0,marker);if(following?.sectionID===sectionID)following.pageBreakBefore=true;}
 project.ui||={};project.ui.sectionID=sectionID;project.ui.blockID=marker.id;project.ui.caret=0;
 return {projectID:project.id,sectionID,pageID:marker.id,blockID:marker.id,position};
}

// The block of a section that already shows a material: its card (a card a
// re-extraction linked as support counts), otherwise a block that holds it as
// primary, as the library's 插入正文 does. A paragraph that only cites it
// (support) does not show the table or figure, so it gets its own card.
export function assemblyMaterialBlock(project,sectionID,materialID){
 let rows=(project?.blocks||[]).filter(row=>row.sectionID===sectionID&&row.materials?.some(link=>link.id===materialID));
 let primary=row=>row.materials.some(link=>link.id===materialID&&(link.role||'primary')==='primary');
 return rows.find(row=>row.assembly&&primary(row))||rows.find(row=>row.assembly)||rows.find(primary)||null;
}

export function placeAssemblyMaterial(project,M,material,{sectionID,anchorID='',pageID=''}={}){
 sectionFor(project,sectionID);const anchor=pageID?anchorFor(project,sectionID,pageID):anchorFor(project,sectionID,anchorID);
 if(pageID&&!anchor.explicitPage)throw Error('目标新增页已经变化，请重新创建或选择');
 if(!material?.id||!Number.isInteger(material.revision))throw Error('素材身份或版本不完整，请重新读取');
 let saved=project.materials.find(row=>row.id===material.id);if(saved&&saved.revision!==material.revision)throw Error('素材已变化，请重新读取后再加入装配');
 // Inserting a material into a section that already carries it selects that
 // block: a retry or a repeated request adds no second card.
 const linked=assemblyMaterialBlock(project,sectionID,material.id);
 if(linked){
  if(!saved)project.materials.push(M.clone(material));
  project.ui||={};project.ui.sectionID=sectionID;project.ui.blockID=linked.id;project.ui.caret=0;
  return {projectID:project.id,sectionID,pageID:linked.assemblyPageID||'',blockID:linked.id,materialID:material.id,sourceID:'material:'+material.id,reused:true};
 }
 const addSource=!saved;if(!saved)saved=M.clone(material);
 if(saved.data?.rows?.length&&(!Array.isArray(saved.data.rows)||saved.data.rows.some(row=>!Array.isArray(row)||!row.length||row.length!==saved.data.rows[0]?.length)))throw Error('原素材表格数据不完整，请先修复数据再加入装配');
 let block,index;const reuse=pageID&&anchor.emptyStarter&&!anchor.text?.trim()&&!anchor.materials.length;
 if(reuse)block=M.clone(anchor);
 else {block=M.block('paragraph',sectionID);index=sectionInsertionIndex(project.blocks,project.sections,sectionID,{afterID:anchor?.id});if(pageID){while(index<project.blocks.length&&project.blocks[index].sectionID===sectionID&&!project.blocks[index].pageBreakBefore)index++;}}
 block.assembly=true;block.hideMaterialFrame=false;block.emptyStarter=false;block.materials=[{id:saved.id,role:'primary',revision:saved.revision}];block.review='missing';
 if(pageID)block.assemblyPageID=pageID;
 if(saved.latex?.trim()||saved.kind==='formula'&&saved.formulaSource?.latex){block.type='formula';block.text=saved.latex||saved.formulaSource.latex;block.sourceAnchors=saved.anchor?[M.clone(saved.anchor)]:[];}
 else if(saved.imagePath){block.type='image';block.imagePath=saved.imagePath;block.sourceAnchors=saved.anchor?[M.clone(saved.anchor)]:[];}
 else if(saved.data?.rows?.length){block.type='table';M.bindTable(project,block,saved);}
 if(saved.artifactID)block.artifactID=saved.artifactID;
 // Prepare source conversion before committing either the source card or its
 // page block, so a malformed original cannot leave a half-inserted module.
 if(reuse)Object.assign(anchor,block);else project.blocks.splice(index,0,block);
 if(addSource)project.materials.push(saved);
 project.ui||={};project.ui.sectionID=sectionID;project.ui.blockID=block.id;project.ui.caret=0;
 return {projectID:project.id,sectionID,pageID:pageID||'',blockID:block.id,materialID:saved.id,sourceID:'material:'+saved.id};
}
