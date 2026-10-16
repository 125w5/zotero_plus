/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {answerWithQuestion} from './chat-evidence.mjs';

export const RESEARCH_MESSAGE_MIME='application/x-easysch-research-message';

// A drag transports identities only. Resolve the retained answer, its question
// and evidence from the shared store when it reaches another view or window.
export function resolveDroppedAnswer(dataTransfer,conversations){
 let payload;try{payload=JSON.parse(dataTransfer?.getData(RESEARCH_MESSAGE_MIME));}catch{return null;}
 const session=payload?.sessionID&&conversations?.get(payload.sessionID),message=session?.messages?.find(row=>row.id===payload.messageID&&row.role==='assistant');
 return message&&String(message.text||'').trim()?{sessionID:session.id,message:answerWithQuestion(session.messages,message)}:null;
}

const controls='button,a,summary,details,input,textarea,select,[contenteditable=true]';
const containsPoint=(rect,x,y)=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;

// Native HTML dragging on an answer container otherwise takes precedence over
// the very first text-selection gesture. Only its blank padding or handle arms
// a card drag. Text selection and dragging a selected phrase remain native.
export function isMessageTextPoint(card,event,textRoots){
 const element=event.target?.nodeType===3?event.target.parentElement:event.target;
 const root=textRoots.find(value=>value===element||value?.contains(element));if(!root)return false;
 const x=event.clientX,y=event.clientY,rect=root.getBoundingClientRect();
 if(!Number.isFinite(x)||!Number.isFinite(y)||!containsPoint(rect,x,y))return true;
 if(element?.closest?.('.katex,math'))return true;
 const doc=card.ownerDocument,range=doc.createRange();
 try{
  const position=doc.caretPositionFromPoint?.(x,y),text=position?.offsetNode;
  if(text?.nodeType===3&&root.contains(text)){range.selectNodeContents(text);if([...range.getClientRects()].some(value=>containsPoint(value,x,y)))return true;}
  // A pointer can land on an inline span, a blank line or Markdown table. The
  // rendered text rectangles distinguish actual lines from surrounding space.
  const walker=doc.createTreeWalker(root,4);let value;
  while((value=walker.nextNode())){if(!value.textContent.trim())continue;range.selectNodeContents(value);if([...range.getClientRects()].some(value=>containsPoint(value,x,y)))return true;}
  return false;
 }catch{return true;}finally{range.detach?.();}
}

export function installMessageDrag({card,grip,textRoots=[],sessionID,messageID,onDrag}){
 let armed=false;card.draggable=false;if(grip)grip.draggable=true;
 const isGrip=target=>target===grip||grip?.contains(target);
 const down=event=>{
  const element=event.target?.nodeType===3?event.target.parentElement:event.target;
  armed=event.button===0&&(isGrip(element)||!element?.closest?.(controls)&&!isMessageTextPoint(card,event,textRoots));
  card.draggable=armed;
 };
 const reset=()=>{armed=false;card.draggable=false;};
 const start=event=>{
  if(!isGrip(event.target)&&(!armed||event.target.closest?.(controls)))return;
  const transfer=event.dataTransfer;if(!transfer)return;
  transfer.effectAllowed='copy';transfer.clearData('text/plain');
  transfer.setData(RESEARCH_MESSAGE_MIME,JSON.stringify({sessionID:typeof sessionID==='function'?sessionID():sessionID,messageID}));
  transfer.setDragImage?.(card,Math.min(card.offsetWidth/2,120),20);card.dataset.dragging='true';event.stopPropagation();onDrag?.(event);
 };
 const end=event=>{const active=card.dataset.dragging==='true';delete card.dataset.dragging;reset();if(active)onDrag?.(event);};
 const listeners=[['pointerdown',down],['pointerup',reset],['pointercancel',reset],['dragstart',start],['dragend',end]];
 for(const [type,listener]of listeners)card.addEventListener(type,listener);
 return ()=>{for(const [type,listener]of listeners)card.removeEventListener(type,listener);delete card.dataset.dragging;reset();};
}
