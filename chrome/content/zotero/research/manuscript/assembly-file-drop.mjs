/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {CHAT_ATTACHMENT_MIME} from '../shared/chat-attachments.mjs';
import {sectionInsertionAnchor,sectionInsertionIndex} from './section-insertion.mjs';
import {libraryAsset} from '../shared/material-access.mjs';
import {placedBlock} from './assembly-placement.mjs';

export function assemblyFileDropReference(dataTransfer,conversations){
 try{const value=JSON.parse(dataTransfer.getData(CHAT_ATTACHMENT_MIME));if(!value?.sessionID||!value?.attachmentID)return null;const reference=(conversations.getAttachments?.(value.sessionID)||conversations.get(value.sessionID)?.attachments||[]).find(row=>row.id===value.attachmentID);return reference?{sessionID:value.sessionID,reference}:null;}catch(_){return null;}
}
export function assemblyFileDropMaterial(reference,rows,model){
 const usable=(rows||[]).filter(row=>String(row.text||row.sourceText||'').trim());if(!usable.length)throw Error('文件中没有可插入的已读取内容，请先打开文件详情选择资料。');
 const sourceText=usable.map(row=>String(row.text||row.sourceText)).join('\n\n'),first=usable[0];
 return model.material({kind:reference.kind==='spreadsheet'?'experiment':'reference',title:reference.title||'对话文件',category:'资料',summary:reference.kind==='spreadsheet'?'当前工作表及所选单元格的实际内容。':'对话文件中的已读取资料；保留原文件与摘录定位。',sourceText,sourceRecordID:'chat-file:'+reference.id,sourceVersion:String(reference.fingerprint||reference.stateVersion||''),chatAttachmentID:reference.id,...(first.imagePath?{imagePath:first.imagePath}:{}),sourceAnchors:usable.map(row=>({...row.anchor,attachmentID:row.attachmentID||reference.attachmentID,paperItemID:row.paperItemID||reference.paperItemID,pageIndex:row.pageIndex??row.anchor?.pageIndex??null,sourceRecordID:row.sourceRecordID||row.stableID||row.id,sourceText:row.text||row.sourceText})),anchor:{...first.anchor,attachmentID:reference.attachmentID||first.attachmentID,paperItemID:reference.paperItemID||first.paperItemID,pageIndex:first.pageIndex??first.anchor?.pageIndex??null,sourceText}});
}
export function createAssemblyDropFeedback(canvas){
 const doc=canvas.ownerDocument,hint=doc.createElement('div');hint.className='assembly-drop-feedback';hint.setAttribute('role','status');hint.hidden=true;doc.body.append(hint);
 return {show(event,text,{rejected=false}={}){if(hint.textContent!==text)hint.textContent=text;hint.dataset.rejected=String(rejected);hint.hidden=false;hint.style.left=Math.max(8,Math.min(event.clientX+14,doc.defaultView.innerWidth-286))+'px';hint.style.top=Math.max(8,Math.min(event.clientY+18,doc.defaultView.innerHeight-70))+'px';},clear(){hint.hidden=true;},destroy(){hint.remove();}};
}
/** Attach the real source to the exact page/chapter captured at drop time.
 * File reading may yield; later focus or chapter changes cannot retarget it. */
export function installAssemblyFileDrop({U,canvas,paperPosition,snapshot,attachMaterial,changed,persist,status}){
 const feedback=createAssemblyDropFeedback(canvas),doc=canvas.ownerDocument;let disposed=false,busy=false;
 const advertised=event=>Array.from(event.dataTransfer?.types||[]).includes(CHAT_ATTACHMENT_MIME),pageFor=event=>{const page=event.target.closest?.('.paper');return page&&canvas.contains(page)&&U.p.sections.some(row=>row.id===page.dataset.section)?page:null;};
 const clear=()=>{feedback.clear();delete canvas.dataset.fileDrop;for(const node of canvas.querySelectorAll('[data-file-drop-position]'))delete node.dataset.fileDropPosition;};
 const over=event=>{if(disposed||!advertised(event))return;clear();const page=pageFor(event);if(!page||busy){event.dataTransfer.dropEffect='none';feedback.show(event,busy?'正在关联资料，请稍候。':'请放到论文页面中的具体位置。',{rejected:true});return;}event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';canvas.dataset.fileDrop='true';const block=event.target.closest('.block');if(block)block.dataset.fileDropPosition=event.clientY>block.getBoundingClientRect().top+block.getBoundingClientRect().height/2?'after':'before';feedback.show(event,'在“'+U.p.sections.find(row=>row.id===page.dataset.section).title+'”此处关联文件，保留原始来源。');};
 const drop=async event=>{if(!advertised(event))return;clear();const page=pageFor(event);if(disposed||!page||busy)return;event.preventDefault();event.stopImmediatePropagation();const payload=assemblyFileDropReference(event.dataTransfer,U.conversations);if(!payload){status('拖动的文件已从对话移除，请重新选择。',true);return;}
  const projectID=U.p.id,sectionID=page.dataset.section,pos=paperPosition(page,event.clientY),anchor=sectionInsertionAnchor(U.p.blocks,U.p.sections,sectionID,pos.index);busy=true;canvas.dataset.fileDropBusy='true';
  const currentReference=()=>(U.conversations.getAttachments?.(payload.sessionID)||U.conversations.get(payload.sessionID)?.attachments||[]).find(row=>row.id===payload.reference.id);
  const validateReference=()=>{const latest=currentReference();if(!latest||JSON.stringify(latest)!==JSON.stringify(payload.reference))throw Error('读取时该文件的工作表或范围已变化，请重新拖动。');};
  try{await persist({flush:true});if(disposed||U.p.id!==projectID)return;if(U.saveError)throw U.saveError;validateReference();let material=U.p.materials.find(row=>row.id===payload.reference.materialID)||libraryAsset(U.A,payload.reference.materialID);
   if(!material){const result=await U.E.chatAttachments.read([{...payload.reference,selected:true}],{images:false});if(disposed||U.p.id!==projectID)return;validateReference();material=assemblyFileDropMaterial(payload.reference,result.rows,U.M);}
   if(!U.p.sections.some(row=>row.id===sectionID))throw Error('原章节已移除，请重新选择插入位置。');
   const existing=placedBlock(U.p,sectionID,{material,chatAttachmentID:payload.reference.id});if(existing){U.p.ui.blockID=existing.id;U.p.ui.sectionID=sectionID;changed({editor:true});canvas.querySelector('[data-id="'+existing.id+'"],[data-read-block="'+existing.id+'"]')?.scrollIntoView({block:'nearest'});status('这份文件资料已在本章，已定位到原卡片；未重复插入');return;}
   snapshot();if(!U.p.materials.some(row=>row.id===material.id))U.p.materials.push(U.M.clone(material));const block=U.M.block('paragraph',sectionID,{assembly:true,title:material.title,spaceBefore:pos.spaceBefore,conversationID:payload.sessionID,chatAttachmentID:payload.reference.id});attachMaterial(block,material.id);U.p.blocks.splice(sectionInsertionIndex(U.p.blocks,U.p.sections,sectionID,anchor),0,block);U.p.ui.blockID=block.id;U.p.ui.sectionID=sectionID;U.p.ui.caret=0;changed({editor:true});canvas.querySelector('[data-id="'+block.id+'"]')?.scrollIntoView({block:'nearest'});status('已在“'+U.p.sections.find(row=>row.id===sectionID).title+'”关联文件资料 · Ctrl+Z 撤销');
  }catch(error){if(!disposed)status(error.message,true);}finally{busy=false;delete canvas.dataset.fileDropBusy;}
 };
 const leave=event=>{if(!canvas.contains(event.relatedTarget))clear();};canvas.addEventListener('dragover',over,true);canvas.addEventListener('drop',drop,true);canvas.addEventListener('dragleave',leave);doc.addEventListener('dragend',clear);
 return ()=>{disposed=true;clear();feedback.destroy();canvas.removeEventListener('dragover',over,true);canvas.removeEventListener('drop',drop,true);canvas.removeEventListener('dragleave',leave);doc.removeEventListener('dragend',clear);};
}
