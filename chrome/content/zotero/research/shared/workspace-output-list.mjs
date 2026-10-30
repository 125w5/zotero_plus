/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {outputMatches} from './workspace-outputs.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export function mountWorkspaceOutputList({host,E,config,getQuery=()=>'',onError=()=>{}}){
 const doc=host.ownerDocument,win=doc.defaultView;
 const node=(tag,cls,text)=>{const value=doc.createElementNS(HTML,tag);if(cls)value.className=cls;if(text!==undefined)value.textContent=text;return value;};
 const root=node('section','workspace-output-section'),header=node('header','workspace-output-heading'),title=node('strong','',config.title),count=node('span','workspace-output-count'),refresh=node('button','workspace-output-refresh','↻'),list=node('div','workspace-output-list'),state=node('p','workspace-output-status');
 root.setAttribute('aria-label',config.title);header.append(title,count,refresh);refresh.type='button';refresh.title='刷新'+config.title;refresh.setAttribute('aria-label',refresh.title);state.setAttribute('role','status');root.append(header,list,state);host.append(root);
 let key,scopeKey,words,rows=[],signature='',generation=0,controller,disposed=false,loading=false,limit=60;
 const fail=error=>{if(disposed)return;state.textContent=error.message||String(error);onError(error);};
 const action=(fn,button)=>async()=>{if(disposed)return;button.disabled=true;try{await fn();}catch(error){fail(error);}finally{if(!disposed)button.disabled=false;}};
 function show(){
  const query=getQuery();if(query!==words)limit=60;const visible=rows.filter(row=>outputMatches(row,query)),next=JSON.stringify([visible,query,limit,config.getCurrentID?.()]);words=query;if(next===signature)return;signature=next;count.textContent=visible.length?String(visible.length):'';const scroll=list.scrollTop;list.replaceChildren();
  for(const row of visible.slice(0,limit)){
   const card=node('article','workspace-output-row'),open=node('button','workspace-output-open'),kind=node('span','workspace-output-kind',row.kind==='pdf'?'PDF':row.kind==='pptx'?'PPTX':'PPT'),name=node('span','workspace-output-name',row.title),meta=node('small','workspace-output-meta',row.subtitle||row.folder||'');
   card.dataset.outputId=row.id;card.dataset.outputKind=row.kind;card.dataset.current=String(config.getCurrentID?.()===row.draftID);open.type='button';open.append(kind,name);open.title=(row.kind==='ppt-project'?'继续编辑：':'打开：')+row.title;open.onclick=action(()=>config.onOpen?config.onOpen(row):E.workspaceOutputs.open(row),open);card.append(open,meta);
   const actions=node('div','workspace-output-actions');
   if(row.canRestore&&row.kind!=='ppt-project'){const restore=node('button','','编辑');restore.type='button';restore.title='恢复这个 PPT 的编辑项目';restore.onclick=action(()=>config.onRestore?config.onRestore(row):E.workspaceOutputs.restore(row),restore);actions.append(restore);}
   if(row.canReveal){const reveal=node('button','','定位');reveal.type='button';reveal.title=row.path||'在文件夹中显示';reveal.onclick=action(()=>E.workspaceOutputs.reveal(row),reveal);actions.append(reveal);}
   if(actions.children.length)card.append(actions);
   if(row.kind==='pdf'){open.draggable=true;open.ondragstart=event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('zotero/item',String(row.attachmentID));event.dataTransfer.setData('text/plain',row.title);};}
   list.append(card);
  }
  if(visible.length>limit){const more=node('button','workspace-output-more','显示更多');more.type='button';more.onclick=()=>{limit+=60;show();};list.append(more);}
  list.scrollTop=scroll;if(!loading)state.textContent=visible.length?'':query?'没有匹配的文件':config.empty||'暂无已保存文件';
 }
 function render({force=false}={}){
  if(disposed)return;let next;try{next=config.getKey?.()||'';}catch(error){fail(error);return;}
  if(!force&&next===key){if(words!==getQuery())show();return;}
  // In the same scope the shown rows stay until the reload replaces them, so an edit does not flicker.
  let nextScope;try{nextScope=config.getScope?.();}catch{nextScope=undefined;}const sameScope=nextScope!==undefined&&nextScope===scopeKey&&rows.length>0;scopeKey=nextScope;
  key=next;const token=++generation;controller?.abort();controller=new (win?.AbortController||AbortController)();const signal=controller.signal;loading=true;refresh.disabled=true;root.setAttribute('aria-busy','true');
  if(!sameScope){limit=60;rows=[];signature='';list.replaceChildren();count.textContent='';state.textContent='正在读取本地文件…';}
  Promise.resolve().then(()=>config.load({signal})).then(result=>{if(disposed||signal.aborted||token!==generation)return;loading=false;rows=result?.rows||[];signature='';show();}).catch(error=>{if(!disposed&&!signal.aborted&&token===generation){loading=false;fail(error);}}).finally(()=>{if(!disposed&&token===generation){refresh.disabled=false;root.removeAttribute?.('aria-busy');}});
 }
 refresh.onclick=()=>render({force:true});render();return {root,render,destroy(){disposed=true;generation++;controller?.abort();root.remove();}};
}
