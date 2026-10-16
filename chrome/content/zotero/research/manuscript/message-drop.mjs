/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {RESEARCH_MESSAGE_MIME,resolveDroppedAnswer} from '../shared/message-transfer.mjs';
import {sectionInsertionAnchor,sectionInsertionIndex} from './section-insertion.mjs';
import {createAssemblyDropFeedback} from './assembly-file-drop.mjs';

// The paper receives a research-note material, not generated manuscript prose.
// This uses the same published note and source links as every other chat view.
export function installAssemblyMessageDrop({U,canvas,paperPosition,snapshot,attachMaterial,changed,persist,status}){
 let disposed=false,busy=false;const feedback=createAssemblyDropFeedback(canvas);
 const advertised=event=>Array.from(event.dataTransfer?.types||[]).includes(RESEARCH_MESSAGE_MIME);
 const pageFor=event=>{const page=event.target.closest?.('.paper');return page&&canvas.contains(page)&&U.p.sections.some(row=>row.id===page.dataset.section)?page:null;};
 const clear=()=>{feedback.clear();delete canvas.dataset.messageDrop;for(const node of canvas.querySelectorAll('.block-drop-before,.block-drop-after'))node.classList.remove('block-drop-before','block-drop-after');};
 const over=event=>{
  if(disposed||!advertised(event))return;clear();const page=pageFor(event);if(busy||!page){event.dataTransfer.dropEffect='none';feedback.show(event,busy?'正在保存研究笔记，请稍候。':'请放到论文页面中的具体位置；左右卡片可固定回答。',{rejected:true});return;}
  event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';canvas.dataset.messageDrop='true';
  feedback.show(event,'在“'+U.p.sections.find(row=>row.id===page.dataset.section).title+'”此处插入回答，保留问题与证据。');
  const block=event.target.closest('.block');if(block){const rect=block.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;block.classList.toggle('block-drop-before',!after);block.classList.toggle('block-drop-after',after);}
 };
 const drop=async event=>{
  const page=pageFor(event);clear();if(disposed||!advertised(event)||!page)return;
  event.preventDefault();event.stopImmediatePropagation();if(busy)return;
  const answer=resolveDroppedAnswer(event.dataTransfer,U.conversations);if(!answer){status('研究消息已不可用，请重新拖动。',true);return;}
  const projectID=U.p.id,sectionID=page.dataset.section,pos=paperPosition(page,event.clientY),anchor=sectionInsertionAnchor(U.p.blocks,U.p.sections,sectionID,pos.index);
  busy=true;canvas.dataset.messageDropBusy='true';
  try{
   await persist();if(U.saveError)throw U.saveError;
   if(!U.saveResearchMessage)throw Error('研究笔记保存尚未就绪，请稍后重新拖动。');
   const saved=await U.saveResearchMessage(answer.message,{sessionID:answer.sessionID});
   if(disposed||U.p.id!==projectID)return;
   const material=U.p.materials.find(value=>value.id===saved.materialID)||U.A.assetLibrary()[saved.materialID];
   if(!material)throw Error('笔记已保存；素材尚未入库，请重新拖动。');
   if(!U.p.sections.some(value=>value.id===sectionID))throw Error('笔记已保存；原章节已移除，请从素材库拖入新的位置。');
   snapshot();const block=U.M.block('paragraph',sectionID,{assembly:true,title:material.title,spaceBefore:pos.spaceBefore,conversationID:answer.sessionID,researchMessageID:answer.message.id});
   attachMaterial(block,material.id);
   const index=sectionInsertionIndex(U.p.blocks,U.p.sections,sectionID,anchor);U.p.blocks.splice(index,0,block);U.p.ui.blockID=block.id;U.p.ui.sectionID=sectionID;U.p.ui.caret=0;
   changed({editor:true});canvas.querySelector('[data-id="'+block.id+'"]')?.scrollIntoView({block:'nearest'});
   status('已插入研究笔记素材，保留问题、回答和来源 · Ctrl+Z 撤销');
  }catch(error){if(!disposed)status(error.message,true);}finally{busy=false;delete canvas.dataset.messageDropBusy;}
 };
 const leave=event=>{if(!canvas.contains(event.relatedTarget))clear();};
 canvas.addEventListener('dragover',over,true);canvas.addEventListener('drop',drop,true);canvas.addEventListener('dragleave',leave);canvas.ownerDocument.addEventListener('dragend',clear);
 return ()=>{disposed=true;clear();feedback.destroy();canvas.removeEventListener('dragover',over,true);canvas.removeEventListener('drop',drop,true);canvas.removeEventListener('dragleave',leave);canvas.ownerDocument.removeEventListener('dragend',clear);};
}
