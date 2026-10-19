/* SPDX-License-Identifier: MIT
 * Adapted from CLUI CC, Copyright (c) 2025-2026 Lucas Couto.
 * Sources: src/renderer/App.tsx (shell, dimensions, transition),
 * ConversationView.tsx (groupMessages, paging, near-bottom scrolling),
 * InputBar.tsx (autosize), index.css (stacked action buttons).
 * See ../vendor/CLUI-CC-LICENSE.txt. Electron IPC is deliberately supplied
 * by callers; this module is the native Gecko renderer of the same shell.
 */
const HTML='http://www.w3.org/1999/xhtml';
export function installCLUIStyles(doc){if(doc.querySelector('[data-clui-native-style]'))return;const css=doc.createElementNS(HTML,'link');css.rel='stylesheet';css.href=new URL('./clui-surface.css',import.meta.url).href;css.dataset.cluiNativeStyle='true';(doc.head||doc.documentElement).append(css);}
export const CLUI_TRANSITION=Object.freeze({duration:260,easing:'cubic-bezier(0.4, 0, 0.1, 1)'});
export const CLUI_LAYOUT=Object.freeze({contentWidth:460,expandedContentWidth:700,collapsedInset:15,collapsedOverlap:-14,expandedGap:10,bodyMaxHeight:400,expandedBodyMaxHeight:720,initialRenderCap:100,pageSize:100,nearBottom:60});

// CLUI's expandedUI changes both dimensions. Keep the ordinary reply height,
// but give content inspection a real height even when the message is short.
// A saved preference is clamped at display time, not overwritten on resize.
export function cluiDetailHeight({viewportHeight=900,availableHeight,preferredHeight}={}){
 const viewport=Math.max(160,Number(viewportHeight)||900),available=Number(availableHeight),max=Math.max(80,Math.floor(Math.min(viewport-120,Number.isFinite(available)&&available>0?available:viewport-180))),min=Math.min(220,max),preferred=Number(preferredHeight);
 return {min,max,height:Math.round(Math.max(min,Math.min(max,Number.isFinite(preferred)&&preferred>0?preferred:Math.min(CLUI_LAYOUT.expandedBodyMaxHeight,viewport*.62))))};
}

// CLUI ConversationView.tsx: consecutive tools are one functional group.
export function groupCLUIMessages(messages){
 const result=[];let toolBuf=[];
 const flushTools=()=>{if(toolBuf.length>0){result.push({kind:'tool-group',messages:[...toolBuf]});toolBuf=[];}};
 for(const msg of messages){if(msg.role==='tool')toolBuf.push(msg);else{flushTools();if(msg.role==='user')result.push({kind:'user',message:msg});else if(msg.role==='assistant')result.push({kind:'assistant',message:msg});else result.push({kind:'system',message:msg});}}
 flushTools();return result;
}
export function cluiVisibleMessages(messages,renderOffset=0){const start=Math.max(0,messages.length-CLUI_LAYOUT.initialRenderCap-renderOffset*CLUI_LAYOUT.pageSize);return {start,hasOlder:start>0,messages:start?messages.slice(start):messages};}

/** Can also decorate an existing reader/assembly root without replacing DOM.
 * compact = retained tabs + pill; conversation = normal reply size;
 * detail = enlarged content inspection. Outside click dims, double click
 * collapses unless pinned. There is intentionally no focusout collapse. */
export function installCLUIChatBehavior({root,body,onChange=()=>{},persistent=false}){
 const doc=root.ownerDocument,win=doc.defaultView;installCLUIStyles(doc);root.dataset.cluiNative='true';root.dataset.cluiPersistent=String(persistent);let mode='compact',pinned=false,disposed=false,pointer,drag,preferredHeight=null,detailSize=cluiDetailHeight();
 const storageKey='research.clui.detail-height.v1:'+(root.id||root.getAttribute?.('aria-label')||'shared');
 try{const saved=Number(win?.localStorage?.getItem(storageKey));if(saved>0)preferredHeight=saved;}catch{/* Chrome documents may disable web storage. */}
 const shell=body?.closest?.('.clui-native-shell')||root.querySelector?.('.clui-native-shell');
 const grip=!persistent&&shell?doc.createElementNS(HTML,'div'):null;
 if(grip){grip.className='clui-native-height-grip';grip.dataset.cluiIgnoreExpand='true';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','horizontal');grip.setAttribute('aria-label','调整对话高度');grip.title='向上拖动增高，向下拖动缩短 · ↑ ↓ 调整 · 双击恢复自动高度';shell.prepend(grip);}
 const notify=()=>onChange({mode,expanded:mode!=='compact',pinned,detailHeight:detailSize.height});
 const measure=()=>{
  const viewportHeight=win?.innerHeight||doc.documentElement?.clientHeight||900,rect=body?.getBoundingClientRect?.(),parent=root.offsetParent||root.parentElement,parentTop=parent?.getBoundingClientRect?.().top||0,shellChrome=Math.max(0,(shell?.getBoundingClientRect?.().height||0)-(rect?.height||0));
  detailSize=cluiDetailHeight({viewportHeight,availableHeight:rect?.bottom>0?rect.bottom-Math.max(16,parentTop+16)-shellChrome-2:undefined,preferredHeight});
  root.style?.setProperty('--clui-detail-height',detailSize.height+'px');root.style?.setProperty('--clui-detail-max-height',detailSize.max+'px');
  if(grip){grip.setAttribute('aria-valuemin',String(detailSize.min));grip.setAttribute('aria-valuemax',String(detailSize.max));grip.setAttribute('aria-valuenow',String(detailSize.height));grip.setAttribute('aria-valuetext',detailSize.height+' 像素');}
 };
 const saveHeight=()=>{try{if(preferredHeight===null)win?.localStorage?.removeItem(storageKey);else win?.localStorage?.setItem(storageKey,String(preferredHeight));}catch{/* The in-memory choice still lasts for this surface. */}};
 const apply=next=>{if(disposed)return;mode=persistent?'conversation':next;root.dataset.cluiSize=mode;root.dataset.expanded=String(mode!=='compact');root.dataset.dimmed='false';if(body){body.inert=mode==='compact';body.setAttribute('aria-hidden',String(mode==='compact'));}if(mode==='detail')measure();notify();};
 const setDetailHeight=(height,{save=true}={})=>{if(disposed)return;preferredHeight=Number.isFinite(Number(height))&&Number(height)>0?Number(height):null;if(mode!=='detail')apply('detail');else{measure();root.dataset.dimmed='false';notify();}if(save)saveHeight();};
 const finishDrag=(event,cancel=false)=>{if(!drag||event&&event.pointerId!==undefined&&event.pointerId!==drag.id)return;const previous=drag;drag=null;delete root.dataset.cluiResizing;if(cancel)setDetailHeight(previous.preferred,{save:false});else saveHeight();try{grip?.releasePointerCapture?.(previous.id);}catch{/* Capture can end before pointerup is dispatched. */}doc.removeEventListener('pointermove',resizeMove,true);doc.removeEventListener('pointerup',resizeEnd,true);doc.removeEventListener('pointercancel',resizeCancel,true);};
 const resizeMove=event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();setDetailHeight(Math.max(detailSize.min,Math.min(detailSize.max,drag.height+drag.y-event.clientY)),{save:false});};
 const resizeEnd=event=>finishDrag(event),resizeCancel=event=>finishDrag(event,true);
 const resizeStart=event=>{if(event.button!==0||drag)return;event.preventDefault();event.stopPropagation();measure();const height=mode==='detail'?detailSize.height:body?.getBoundingClientRect?.().height||detailSize.height;drag={id:event.pointerId,y:event.clientY,height,preferred:preferredHeight};setDetailHeight(height,{save:false});root.dataset.cluiResizing='true';grip.focus?.({preventScroll:true});try{grip.setPointerCapture?.(event.pointerId);}catch{/* Document listeners also cover unsupported capture. */}doc.addEventListener('pointermove',resizeMove,true);doc.addEventListener('pointerup',resizeEnd,true);doc.addEventListener('pointercancel',resizeCancel,true);};
 const resizeKeys=event=>{if(event.key==='Escape'&&drag){event.preventDefault();finishDrag(null,true);return;}const delta={ArrowUp:32,ArrowDown:-32,PageUp:96,PageDown:-96}[event.key];if(delta===undefined&&!['Home','End'].includes(event.key))return;event.preventDefault();measure();setDetailHeight(event.key==='Home'?detailSize.min:event.key==='End'?detailSize.max:detailSize.height+delta);};
 const resetHeight=event=>{event?.preventDefault();event?.stopPropagation();setDetailHeight(null);};
 if(grip){grip.addEventListener('pointerdown',resizeStart);grip.addEventListener('keydown',resizeKeys);grip.addEventListener('dblclick',resetHeight);}
 const resizeViewport=()=>{if(mode==='detail'&&!disposed){measure();notify();}};
 win?.addEventListener?.('resize',resizeViewport);
 const contains=event=>root.contains(event.target)||event.composedPath?.().includes(root)||!!root.id&&event.target.closest?.('[data-clui-owner]')?.dataset.cluiOwner===root.id;
 const pointerDown=event=>{pointer=contains(event)?{x:event.clientX,y:event.clientY}:null;};
 const click=event=>{if(contains(event)){root.dataset.dimmed='false';const start=pointer;pointer=null;if(event.defaultPrevented||event.target.closest?.('[data-clui-collapse],[data-clui-toggle],[data-clui-ignore-expand],button,a,summary,select,[role=button]'))return;const selection=doc.defaultView?.getSelection?.();if(selection&&!selection.isCollapsed&&root.contains(selection.anchorNode))return;if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;apply('detail');}else{pointer=null;if(mode!=='compact')root.dataset.dimmed='true';}};
 const doubleClick=event=>{if(!contains(event)&&!pinned)apply('compact');};
 if(!persistent){doc.addEventListener('pointerdown',pointerDown,true);doc.addEventListener('click',click);doc.addEventListener('dblclick',doubleClick);}root.dataset.pinned='false';apply('compact');
 return {get mode(){return mode;},get pinned(){return pinned;},get detailHeight(){return detailSize.height;},heightGrip:grip,setDetailHeight,resetDetailHeight:()=>resetHeight(),setExpanded(value,{detail=false}={}){apply(value?detail?'detail':'conversation':'compact');},setConversation(){apply('conversation');},setDetail(){apply('detail');},setPinned(value){pinned=!!value;root.dataset.pinned=String(pinned);if(pinned&&mode==='compact')apply('conversation');else notify();},destroy(){finishDrag(null,true);disposed=true;grip?.remove();win?.removeEventListener?.('resize',resizeViewport);doc.removeEventListener('pointerdown',pointerDown,true);doc.removeEventListener('click',click);doc.removeEventListener('dblclick',doubleClick);}};
}

export function createCLUIChatSurface({doc,label='研究对话'}){
 const node=(tag,cls)=>{const n=doc.createElementNS(HTML,tag);n.className=cls;return n;};
 installCLUIStyles(doc);
 const root=node('section','clui-native-surface');root.dataset.cluiNative='true';root.dataset.expanded='false';root.setAttribute('aria-label',label);
 const shell=node('div','clui-native-shell clui-native-glass'),tabs=node('div','clui-native-tab-strip'),body=node('div','clui-native-body'),scroll=node('div','clui-native-conversation');body.append(scroll);shell.append(tabs,body);
 const inputRow=node('div','clui-native-input-row'),pill=node('form','clui-native-input-pill clui-native-glass');inputRow.append(pill);root.append(shell,inputRow);
 let nearBottom=true,sessionID='',oldTop=0,frame=0,disposed=false;
 const onScroll=()=>{nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<CLUI_LAYOUT.nearBottom;};scroll.addEventListener('scroll',onScroll);
 function beforeRender(id){const switched=sessionID!==id;oldTop=scroll.scrollTop;if(switched){sessionID=id;nearBottom=true;}return switched;}
 function afterRender(force=false){doc.defaultView.cancelAnimationFrame(frame);frame=doc.defaultView.requestAnimationFrame(()=>{if(disposed)return;scroll.scrollTop=force||nearBottom?scroll.scrollHeight:oldTop;});}
 const behavior=installCLUIChatBehavior({root,body});
 return {root,shell,tabs,body,scroll,inputRow,pill,setExpanded:behavior.setExpanded,setPinned:behavior.setPinned,setConversation:behavior.setConversation,setDetail:behavior.setDetail,setDetailHeight:behavior.setDetailHeight,resetDetailHeight:behavior.resetDetailHeight,heightGrip:behavior.heightGrip,beforeRender,afterRender,destroy(){disposed=true;behavior.destroy();doc.defaultView.cancelAnimationFrame(frame);scroll.removeEventListener('scroll',onScroll);root.remove();}};
}
