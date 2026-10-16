/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';
const HTML='http://www.w3.org/1999/xhtml',URI='chrome://zotero/content/research/';

// Workflow dialogs borrow a persistent application UI over the current shell.
// Hiding the dialog does not unload its forms, editor state or pending tasks.
export function installWorkspaceOverlay(E,win,{Zotero}){
 if(win._researchWorkspaceOverlay)return win._researchWorkspaceOverlay;
 const doc=win.document,node=(tag,cls,text)=>{const value=doc.createElementNS(HTML,tag);if(cls)value.className=cls;if(text!==undefined)value.textContent=text;return value;};
 const root=node('div','workspace-overlay');root.id='easysch-workflow-overlay';root.hidden=true;
 const dialog=node('section','workspace-overlay-dialog'),header=node('header','workspace-overlay-header'),title=node('h2','workspace-overlay-title','论文装配'),closeButton=node('button','workspace-overlay-close');
 title.id='easysch-workflow-overlay-title';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',title.id);dialog.tabIndex=-1;
 closeButton.type='button';closeButton.title='关闭（Esc）';closeButton.setAttribute('aria-label','关闭工作流程');closeButton.textContent='×';
 const content=node('div','workspace-overlay-body'),status=node('p','workspace-overlay-status','正在打开…');status.setAttribute('role','status');
 header.append(title,closeButton);content.append(status);dialog.append(header,content);root.append(dialog);doc.documentElement.append(root);
 let disposed=false,frame,ready,stopLoading,ui,currentPage,request=0,originTab,originFocus,innerFocus,closing,animation;
 const concealFrame=()=>{if(!frame)return;frame.dataset.prepared='false';frame.style.visibility='hidden';frame.inert=true;frame.setAttribute('aria-hidden','true');};
 const revealFrame=()=>{frame.dataset.prepared='true';frame.style.removeProperty('visibility');frame.inert=false;frame.removeAttribute('aria-hidden');};
 const styles=target=>prepareReaderPaneStyles(target,{Zotero,name:'workspace-overlay',url:URI+'shared/workspace-overlay.css'});
 const bounds=()=>{const box=doc.getElementById('zotero-pane-stack')?.getBoundingClientRect();if(!box)return;Object.assign(root.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});};
 const controls=target=>[...target.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(value=>!value.disabled&&!value.closest('[hidden]')&&value.getClientRects().length);
 const keydown=event=>{
  if(root.hidden||disposed)return;
  if(event.key==='Escape'&&!event.isComposing&&!event.defaultPrevented){if(frame?.contentDocument?.querySelector('dialog[open]'))return;event.preventDefault();event.stopPropagation();void close().catch(Zotero.logError);return;}
  if(event.key!=='Tab')return;if(frame?.inert){event.preventDefault();closeButton.focus();return;}const inner=frame?.contentDocument;if(!inner)return;const values=controls(inner),first=values[0],last=values.at(-1),active=event.target;
  if(active===closeButton){event.preventDefault();(event.shiftKey?last:first)?.focus();}
  else if(event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();closeButton.focus();}
 };
 async function load(page){
  if(ready)return ready;
  frame=node('iframe','workspace-overlay-frame');frame.id='easysch-workflow-overlay-frame';frame.title='论文与组会工作流程';frame.researchOverlayMode=page;concealFrame();content.append(frame);
  ready=new Promise((resolve,reject)=>{
   let timer,settled=false;const start=Date.now();
   const stop=()=>{settled=true;win.clearTimeout(timer);frame?.removeEventListener('load',probe,true);stopLoading=null;};
   const fail=error=>{if(settled)return;stop();reject(error);};
   const probe=()=>{
    if(settled)return;win.clearTimeout(timer);if(disposed){fail(Error('工作流程已关闭'));return;}
    let value;try{value=frame.contentWindow?.EasySchUI;}catch{}
    if(value?.ready){stop();resolve(value);return;}
    if(Date.now()-start>20000){fail(Error('工作流程尚未准备好，请重新打开'));return;}
    timer=win.setTimeout(probe,50);
   };
   stopLoading=()=>fail(Error('工作流程已关闭'));frame.addEventListener('load',probe,true);frame.src=URI+'workspace.html';probe();
  }).then(async value=>{ui=value;const inner=frame.contentDocument;await styles(inner);inner.body.classList.add('workflow-overlay-content');inner.addEventListener('keydown',keydown);return value;}).catch(error=>{ready=null;ui=null;frame?.remove();frame=null;throw error;});
  return ready;
 }
 async function show(page,{selection,pptOptions}={}){
  if(disposed)throw Error('工作流程已关闭');if(!['writing','ppt'].includes(page))throw Error('无法识别工作流程');
  if(closing)await closing;const token=++request;await styles(doc);if(disposed||token!==request)return null;
  if(root.hidden){originTab=win.Zotero_Tabs.selectedID;originFocus=doc.activeElement;}
  concealFrame();if(frame)frame.researchOverlayMode=page;
  bounds();root.hidden=false;root.dataset.page=page;root.dataset.state='opening';title.textContent=page==='ppt'?'组会 PPT':'论文装配';dialog.setAttribute('aria-busy','true');status.hidden=false;status.textContent='正在打开…';closeButton.focus({preventScroll:true});
  try{
   const value=await load(page);if(disposed||root.hidden||token!==request)return null;
   if(selection){await value.saveDraft(false);value.selection=selection;const item=await E.getItem(selection.paperID);value.papers=item?[E.library.describe(item)]:[];value.current=value.papers[0]||null;value.loadProject();}
   if(page==='ppt'&&(pptOptions||!value.pptDraft))await value.openPPTStudio(pptOptions||{});
   else if(currentPage!==page||value.activeView!==page)value.show(page);
   if(disposed||root.hidden||token!==request)return null;currentPage=page;revealFrame();status.hidden=true;dialog.setAttribute('aria-busy','false');root.dataset.state='open';
   win.requestAnimationFrame(()=>{
    if(disposed||token!==request||root.hidden||root.dataset.state!=='open')return;
    // Focus supplied by the user or the workflow after show() returned wins
    // over the opening animation's delayed default focus.
    if(doc.activeElement!==closeButton)return;
    if(innerFocus?.isConnected&&innerFocus.getClientRects().length)innerFocus.focus({preventScroll:true});
    else (controls(frame.contentDocument)[0]||closeButton).focus({preventScroll:true});
   });
   return value;
  }catch(error){if(!disposed&&token===request){status.hidden=false;status.textContent=error.message;dialog.setAttribute('aria-busy','false');root.dataset.state='open';}throw error;}
 }
 async function close({restoreFocus=true}={}){
  if(disposed||root.hidden)return;if(closing)return closing;++request;
  closing=(async()=>{
   innerFocus=frame?.contentDocument?.activeElement;innerFocus?.blur?.();
   await ui?.saveDraft?.(false);await ui?.flushAgentDraft?.();await E.store.flush();
   if(disposed)return;root.dataset.state='closing';
   const reduced=win.matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(!reduced){animation=dialog.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.992)'}],{duration:150,easing:'ease-in',fill:'forwards'});await animation.finished.catch(()=>{});animation.cancel();animation=null;}
   root.hidden=true;root.dataset.state='closed';
   if(restoreFocus&&win.Zotero_Tabs.selectedID===originTab&&originFocus?.isConnected)originFocus.focus({preventScroll:true});
  })();try{return await closing;}finally{closing=null;}
 }
 function dispose(){if(disposed)return;disposed=true;++request;stopLoading?.();animation?.cancel();Promise.resolve(ui?.flushAgentDraft?.()).catch(Zotero.logError);frame?.contentDocument?.removeEventListener('keydown',keydown);doc.removeEventListener('keydown',keydown);win.removeEventListener('resize',bounds);win.removeEventListener('unload',dispose);Zotero.Notifier.unregisterObserver(observer);root.remove();if(win._researchWorkspaceOverlay===state)delete win._researchWorkspaceOverlay;}
 closeButton.onclick=()=>close().catch(Zotero.logError);root.onclick=event=>{if(event.target===root)void close().catch(Zotero.logError);};doc.addEventListener('keydown',keydown);win.addEventListener('resize',bounds);win.addEventListener('unload',dispose,{once:true});
 const observer=Zotero.Notifier.registerObserver({notify:()=>{if(!root.hidden&&win.Zotero_Tabs.selectedID!==originTab)void close({restoreFocus:false}).catch(Zotero.logError);}},['tab'],'easysch-workflow-overlay');
 const state={root,dialog,show,close,dispose,get frame(){return frame;},get ui(){return ui;},get page(){return currentPage;},get isOpen(){return !root.hidden;}};win._researchWorkspaceOverlay=state;return state;
}
