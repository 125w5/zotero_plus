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
export const CLUI_LAYOUT=Object.freeze({contentWidth:460,expandedContentWidth:700,collapsedInset:15,collapsedOverlap:-14,expandedGap:10,bodyMaxHeight:400,expandedBodyMaxHeight:520,initialRenderCap:100,pageSize:100,nearBottom:60});

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
export function installCLUIChatBehavior({root,body,onChange=()=>{}}){
 const doc=root.ownerDocument;installCLUIStyles(doc);root.dataset.cluiNative='true';let mode='compact',pinned=false,disposed=false,pointer;
 const apply=next=>{if(disposed)return;mode=next;root.dataset.cluiSize=mode;root.dataset.expanded=String(mode!=='compact');root.dataset.dimmed='false';if(body){body.inert=mode==='compact';body.setAttribute('aria-hidden',String(mode==='compact'));}onChange({mode,expanded:mode!=='compact',pinned});};
 const contains=event=>root.contains(event.target)||event.composedPath?.().includes(root);
 const pointerDown=event=>{pointer=contains(event)?{x:event.clientX,y:event.clientY}:null;};
 const click=event=>{if(contains(event)){root.dataset.dimmed='false';const start=pointer;pointer=null;if(event.defaultPrevented||event.target.closest?.('[data-clui-collapse],[data-clui-toggle],[data-clui-ignore-expand],button,a,summary,select,[role=button]'))return;const selection=doc.defaultView?.getSelection?.();if(selection&&!selection.isCollapsed&&root.contains(selection.anchorNode))return;if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;apply('detail');}else{pointer=null;if(mode!=='compact')root.dataset.dimmed='true';}};
 const doubleClick=event=>{if(!contains(event)&&!pinned)apply('compact');};
 doc.addEventListener('pointerdown',pointerDown,true);doc.addEventListener('click',click);doc.addEventListener('dblclick',doubleClick);root.dataset.pinned='false';apply('compact');
 return {get mode(){return mode;},get pinned(){return pinned;},setExpanded(value,{detail=false}={}){apply(value?detail?'detail':'conversation':'compact');},setConversation(){apply('conversation');},setDetail(){apply('detail');},setPinned(value){pinned=!!value;root.dataset.pinned=String(pinned);if(pinned&&mode==='compact')apply('conversation');else onChange({mode,expanded:mode!=='compact',pinned});},destroy(){disposed=true;doc.removeEventListener('pointerdown',pointerDown,true);doc.removeEventListener('click',click);doc.removeEventListener('dblclick',doubleClick);}};
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
 return {root,shell,tabs,body,scroll,inputRow,pill,setExpanded:behavior.setExpanded,setPinned:behavior.setPinned,setConversation:behavior.setConversation,setDetail:behavior.setDetail,beforeRender,afterRender,destroy(){disposed=true;behavior.destroy();doc.defaultView.cancelAnimationFrame(frame);scroll.removeEventListener('scroll',onScroll);root.remove();}};
}
