/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {orbBounds,clampOrb,normalizeOrb,positionFromNormalized,isOrbDrag,contentOrbArea,snapOrb} from '../shared/reader-ai-orb.mjs';
const installations=new WeakMap();

// A viewport layer spans all assembly panes and the bottom composer. It never
// inherits the clipping or scrolling of the material list or manuscript paper.
export function installAssemblyAIOrb(U,{open,close}){
 const doc=document,installed=installations.get(doc);if(installed&&!installed.disposed){installed.refresh();return installed;}
 const layer=doc.createElement('div'),button=doc.createElement('button'),logo=doc.createElement('span'),hint=doc.createElement('span');
 const hintText='点击打开研究助手；按住拖动，可移到侧栏或底部';
 layer.id='assembly-ai-layer';button.id='assembly-ai-orb';button.type='button';button.title=hintText;button.setAttribute('aria-label',hintText);button.setAttribute('aria-controls','ai');
 hint.id='assembly-ai-orb-hint';hint.className='assembly-ai-orb-hint';hint.hidden=true;hint.setAttribute('role','tooltip');hint.append(doc.createTextNode('研究助手'));const help=doc.createElement('small');help.textContent='点击对话 · 拖动移动';hint.append(help);button.setAttribute('aria-describedby',hint.id);
 logo.className='easysch-symbol';logo.setAttribute('aria-hidden','true');button.append(logo);layer.append(button,hint);doc.documentElement.append(layer);
 let position,bounds,contentBounds,drag,suppressClick=false,disposed=false,frame,hintTimer,dragFrame=null,dragPoint;
 const placeHint=()=>{if(hint.hidden||!position)return;const r=hint.getBoundingClientRect(),right=position.x+bounds.size+9,left=right+r.width<innerWidth-5?right:position.x-r.width-9;hint.style.left=Math.max(5,Math.min(left,innerWidth-r.width-5))+'px';hint.style.top=Math.max(5,Math.min(position.y+(bounds.size-r.height)/2,innerHeight-r.height-5))+'px';};
 const hideHint=()=>{clearTimeout(hintTimer);hintTimer=null;hint.hidden=true;button.title=hintText;};
 const showHint=()=>{clearTimeout(hintTimer);hintTimer=setTimeout(()=>{if(disposed||drag)return;hint.hidden=false;button.removeAttribute('title');placeHint();},260);};
 button.addEventListener('pointerenter',showHint);button.addEventListener('pointerleave',hideHint);button.addEventListener('focus',showHint);button.addEventListener('blur',hideHint);
 const draw=()=>{button.style.left=position.x+'px';button.style.top=position.y+'px';};
 const refresh=()=>{
  frame=null;if(disposed)return;
  const header=doc.querySelector('body>header').getBoundingClientRect();
  bounds=orbBounds({width:innerWidth,height:innerHeight},{top:header.bottom,right:innerWidth,bottom:innerHeight},{size:36,padding:4,toolbar:0});
  const area=contentOrbArea({left:0,right:innerWidth,top:header.bottom,bottom:innerHeight},{leftPane:U.$('left').hidden?null:U.$('left').getBoundingClientRect(),rightPane:U.$('right').hidden?null:U.$('right').getBoundingClientRect()});
  contentBounds=orbBounds({width:innerWidth,height:innerHeight},area,{size:36,padding:4,toolbar:0});
  if(drag||U.conversationSurface?.root?.dataset.dragging==='true')position=clampOrb(position,bounds);else{const snapped=snapOrb(positionFromNormalized(U.p.ui.aiOrbPosition||{x:.98,y:.84},contentBounds),contentBounds);position=snapped;if(snapped.edge)button.dataset.edge=snapped.edge;else delete button.dataset.edge;}
  button.style.width=button.style.height=bounds.size+'px';button.setAttribute('aria-expanded',String(!!U.p.ui.aiOpen));draw();placeHint();
 };
 const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(refresh);};
 const save=()=>{U.p.ui.aiOrbPosition=normalizeOrb(position,contentBounds);U.persist();};
 const flushDrag=()=>{dragFrame=null;if(!drag||!dragPoint)return;position=clampOrb({x:drag.original.x+dragPoint.x-drag.start.x,y:drag.original.y+dragPoint.y-drag.start.y},bounds);draw();U.conversationSurface?.previewDock(dragPoint.x,dragPoint.y);};
 const cancel=()=>{
  if(dragFrame!==null)cancelAnimationFrame(dragFrame);dragFrame=null;dragPoint=null;
  if(!drag)return;position=clampOrb(drag.original,bounds);const pointerID=drag.id;drag=null;suppressClick=true;button.dataset.dragging='false';U.conversationSurface?.clearHighlight();
  if(button.hasPointerCapture?.(pointerID))button.releasePointerCapture(pointerID);draw();
 };
 button.onpointerdown=event=>{
  if(event.button!==0||!bounds||disposed)return;
  drag={id:event.pointerId,start:{x:event.clientX,y:event.clientY},original:{...position},moved:false};suppressClick=false;
  delete button.dataset.edge;button.focus({preventScroll:true});hideHint();button.setPointerCapture(event.pointerId);event.preventDefault();
 };
 button.onpointermove=event=>{
  if(!drag||drag.id!==event.pointerId)return;const current={x:event.clientX,y:event.clientY};drag.moved||=isOrbDrag(drag.start,current);
  if(!drag.moved)return;dragPoint=current;button.dataset.dragging='true';if(dragFrame===null)dragFrame=requestAnimationFrame(flushDrag);event.preventDefault();
 };
 button.onpointerup=event=>{
  if(!drag||event.pointerId!==drag.id)return;if(dragFrame!==null){cancelAnimationFrame(dragFrame);flushDrag();}dragPoint=null;const moved=drag.moved;drag=null;suppressClick=moved;button.dataset.dragging='false';
  if(button.hasPointerCapture?.(event.pointerId))button.releasePointerCapture(event.pointerId);if(moved){const docked=U.conversationSurface?.dockAt(event.clientX,event.clientY);if(!docked){const snapped=snapOrb(position,contentBounds);position=snapped;if(snapped.edge)button.dataset.edge=snapped.edge;else delete button.dataset.edge;draw();if(U.conversationSurface?.isOpen)U.conversationSurface.undock({nearLogo:true});}save();}U.conversationSurface?.clearHighlight();
 };
 button.onpointercancel=cancel;button.onlostpointercapture=cancel;
 button.onclick=event=>{if(suppressClick){suppressClick=false;event.preventDefault();return;}if(!disposed)open();};
 button.onkeydown=event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hideHint();cancel();U.conversationSurface?.clearHighlight();close();button.focus({preventScroll:true});return;}
  if(['Enter',' '].includes(event.key))suppressClick=false;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();const step=event.shiftKey?20:8;position=clampOrb({x:position.x+({ArrowLeft:-step,ArrowRight:step}[event.key]||0),y:position.y+({ArrowUp:-step,ArrowDown:step}[event.key]||0)},bounds);draw();placeHint();save();}
 };
 const movedSurface=event=>{const detail=event.detail,point=detail?.orbPosition;if(!point||drag||!contentBounds)return;position=detail.movement==='move'?clampOrb(point,bounds):snapOrb(point,contentBounds);if(position.edge)button.dataset.edge=position.edge;else delete button.dataset.edge;draw();U.p.ui.aiOrbPosition=normalizeOrb(position,contentBounds);if(detail.persistOrb!==false)save();};doc.addEventListener('easysch-conversation-statechange',movedSurface);
 const observer=new ResizeObserver(schedule);observer.observe(doc.body);window.addEventListener('resize',schedule);
 const onPageHide=event=>{if(event.target===doc)dispose();};
 const dispose=()=>{if(disposed)return;disposed=true;hideHint();if(frame)cancelAnimationFrame(frame);cancel();observer.disconnect();doc.removeEventListener('easysch-conversation-statechange',movedSurface);window.removeEventListener('resize',schedule);window.removeEventListener('pagehide',onPageHide);installations.delete(doc);layer.remove();};
 window.addEventListener('pagehide',onPageHide);refresh();
 const controller={button,layer,refresh,dispose,get position(){return {...position};},get bounds(){return {...bounds};},get disposed(){return disposed;}};installations.set(doc,controller);return controller;
}
