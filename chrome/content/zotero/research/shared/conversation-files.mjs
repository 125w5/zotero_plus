/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {installMediaPreview,disposeMediaPreviews} from './media-preview.mjs';
import {chatAttachmentDropPayload} from './chat-attachments.mjs';
import {RESEARCH_MESSAGE_MIME,resolveDroppedAnswer} from './message-transfer.mjs';
import {DISCOVERY_PAPER_MIME,discoveryPaperDrop,receiveDiscoveryPaper} from './discovery-transfer.mjs';
export {setDiscoveryPaperDragData} from './discovery-transfer.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export function conversationFileMatches(file,query='',filter='all') {
 if(filter==='featured'&&!file.featured||filter==='selected'&&file.selected===false||filter==='papers'&&!['pdf','paper'].includes(file.kind)||filter==='tables'&&file.kind!=='spreadsheet')return false;
 const haystack=[file.title,file.kind,file.sheet,...(file.tags||[])].join(' ').normalize('NFKC').toLocaleLowerCase();
 return query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).every(word=>haystack.includes(word));
}
const node=(doc,tag,cls,text)=>{const value=doc.createElementNS(HTML,tag);if(cls)value.className=cls;if(text!==undefined)value.textContent=text;return value;};
const ICONS={plus:['M12 5v14','M5 12h14'],search:['M21 21l-4.35-4.35','M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],chat:['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5'],folder:['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],file:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','M14 2v6h6','M8 13h8','M8 17h5'],image:['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M3 16l5-5 4 4 3-3 6 6','M8 7h.01'],table:['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M3 9h18','M3 15h18','M9 3v18','M15 3v18'],star:['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],close:['m6 6 12 12','M18 6 6 18'],back:['m15 18-6-6 6-6'],import:['M12 3v12','m7 10 5 5 5-5','M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4']};
function icon(doc,name,cls=''){const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');if(cls)svg.setAttribute('class',cls);for(const d of ICONS[name]||ICONS.file){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;}
const fileIcon=file=>file.kind==='spreadsheet'?'table':file.kind==='image'?'image':'file';
function styles(doc){if(doc.querySelector('[data-conversation-files-style]'))return;const link=node(doc,'link');link.rel='stylesheet';link.href=new URL('./conversation-files.css',import.meta.url).href;link.dataset.conversationFilesStyle='true';(doc.head||doc.documentElement).append(link);}
export const conversationFileLabel=file=>({pdf:'论文',paper:'论文',spreadsheet:'表格',docx:'文档',text:'文本',image:'图片',material:'素材'}[file.kind]||'文件');

export async function receiveConversationDrop({dataTransfer,E,sessionID,onProgress,onReferences}){
 const paper=discoveryPaperDrop(dataTransfer);if(paper)return receiveDiscoveryPaper({E,sessionID,drop:paper,onProgress,onReferences});
 const answer=resolveDroppedAnswer(dataTransfer,E.workbenchConversations),payload=chatAttachmentDropPayload(dataTransfer);if(!answer&&!payload)return null;
 if(!sessionID||!E.workbenchConversations?.get(sessionID))throw Error('请先选择目标对话。');
 if(answer){if(answer.sessionID===sessionID)return '这条回答已在当前对话中。';if(!E.workbenchConversations.append)throw Error('当前对话暂不支持接收回答。');
  await E.workbenchConversations.append(sessionID,{role:'user',text:'引用的历史讨论（作为资料）：\n\n'+(answer.message.question?'原问题：'+answer.message.question+'\n\n':'')+answer.message.text,sources:answer.message.sources||[],importedFrom:{sessionID:answer.sessionID,messageID:answer.message.id}},{origin:'message-drop'});
  return '已复制问题、回答和来源到目标对话；尚未提交新任务。';
 }
 await E.chatAttachments.attach(sessionID,payload,{source:'drop'});return E.workbenchConversations.getAttachmentNotice?.(sessionID)||'已保存到本次资料。';
}

/** Files belong to a conversation. Previewing, selecting and starring are three
 * independent operations; opening a preview never changes the model's scope. */
export function mountConversationFiles({host,E,getSessionID,getSessions=()=>[],getFiles=id=>E.chatAttachments?.get(id)||[],getContext=()=>null,getRevision=()=>0,onSession=()=>{},onNew=()=>{},onRemoveSession,onPreview=()=>{},onFileState=(file,patch,id)=>E.chatAttachments.setState(id,file.id,patch),onFileDrag=(event,file,id)=>E.chatAttachments.setDragData(event,file,id),onChange=()=>{},onError=()=>{},title='研究空间',sessions=true,fileFilters=[['all','全部'],['selected','已选'],['featured','精选'],['papers','论文'],['tables','表格']],matchesFile=conversationFileMatches}) {
 const doc=host.ownerDocument;styles(doc);const root=node(doc,'aside','conversation-files');root.setAttribute('aria-label','对话与文件');host.append(root);
 const head=node(doc,'header','conversation-files-heading'),label=node(doc,'strong','',title),add=node(doc,'button','conversation-files-new');add.append(icon(doc,'plus'),node(doc,'span','','新对话'));add.type='button';add.title='在当前研究空间新建对话';add.setAttribute('aria-label',add.title);head.append(label,add);root.append(head);
 const search=node(doc,'div','conversation-files-search-wrap'),query=node(doc,'input','conversation-files-search');query.type='search';query.placeholder='搜索对话、论文或文件';query.setAttribute('aria-label',query.placeholder);search.append(icon(doc,'search'),query);root.append(search);
 const historyHead=node(doc,'div','conversation-files-history-heading','对话');historyHead.hidden=!sessions;root.append(historyHead);
 const history=node(doc,'nav','conversation-files-history');history.setAttribute('aria-label','对话');history.hidden=!sessions;root.append(history);
 const fileHead=node(doc,'div','conversation-files-subheading'),count=node(doc,'span','conversation-files-count','本次资料'),importer=node(doc,'button','conversation-files-import');importer.append(icon(doc,'plus'),node(doc,'span','','导入'));importer.type='button';importer.title='导入论文、Excel、文档或图片';fileHead.append(count,importer);root.append(fileHead);
 const context=node(doc,'div','conversation-files-context');root.append(context);
 const filters=node(doc,'div','conversation-files-filters'),list=node(doc,'div','conversation-files-list'),status=node(doc,'p','conversation-files-status');status.setAttribute('role','status');
 let filter='all',busy=false,creating=false,disposed=false,historySignature='',listSignature='',contextSignature='',selectionRevision=0;const filterButtons=[];
 const fail=error=>{if(!disposed){status.textContent=error.message||String(error);onError(error);}};
 const action=fn=>()=>Promise.resolve().then(fn).catch(fail);
 for(const [value,text]of fileFilters){const button=node(doc,'button','',text);button.type='button';button.dataset.fileFilter=value;button.onclick=()=>{filter=value;render();};filters.append(button);filterButtons.push(button);}
 const hint=node(doc,'small','conversation-files-drag-hint','拖入文件 · 拖出用于装配或 PPT');hint.title='拖入论文会下载并加入本次资料。使用文件左侧的拖动手柄，可添加到其他对话、装配或 PPT。';
 root.append(filters,list,hint,status);add.onclick=action(async()=>{if(creating)return;creating=true;add.disabled=true;add.setAttribute('aria-busy','true');try{await onNew();}finally{creating=false;if(!disposed){add.disabled=false;add.removeAttribute?.('aria-busy');render();}}});
 const droppedOn=async(event,id)=>{
  const answer=resolveDroppedAnswer(event.dataTransfer,E.workbenchConversations),payload=chatAttachmentDropPayload(event.dataTransfer),paper=discoveryPaperDrop(event.dataTransfer);if(!answer&&!payload&&!paper)return;
  event.preventDefault();event.stopPropagation();delete root.dataset.drop;for(const row of history.children)delete row.dataset.drop;
  status.textContent=paper?'正在获取论文…':'正在关联资料…';
  const message=await receiveConversationDrop({dataTransfer:event.dataTransfer,E,sessionID:id,onProgress:text=>{if(!disposed&&id===getSessionID())status.textContent=text;}});if(!disposed&&id===getSessionID())status.textContent=(!answer&&E.workbenchConversations?.getAttachmentNotice?.(id))||message||'';
  if(!disposed){render();onChange(id);}
 };
 const over=(event,target,id)=>{if(!id||!chatAttachmentDropPayload(event.dataTransfer)&&!Array.from(event.dataTransfer?.types||[]).some(type=>[RESEARCH_MESSAGE_MIME,DISCOVERY_PAPER_MIME].includes(type)))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';target.dataset.drop='true';};
 root.ondragover=event=>over(event,root,getSessionID());root.ondragleave=event=>{if(!root.contains(event.relatedTarget))delete root.dataset.drop;};root.ondrop=event=>{droppedOn(event,getSessionID()).catch(fail);};
 importer.onclick=action(async()=>{if(busy)return;const id=getSessionID();if(!id)return;busy=true;importer.disabled=true;status.textContent='';try{await E.chatAttachments.attach(id);if(!disposed&&id===getSessionID()){status.textContent=E.workbenchConversations?.getAttachmentNotice?.(id)||'';render();onChange(id);}}catch(error){if(!disposed&&id===getSessionID())throw error;}finally{busy=false;if(!disposed)importer.disabled=false;}});
	query.oninput=event=>{if(!event.isComposing)render();};query.oncompositionend=render;
 function render(){
  if(disposed)return;const id=getSessionID(),files=getFiles(id),words=query.value.trim(),scope=getContext()||{},sessionRows=getSessions();
  // Draft/message notifications must not rebuild unrelated file controls or
  // conversation buttons. Keep their focus, scroll position and drag targets.
  count.replaceChildren(node(doc,'span','','本次资料'),node(doc,'span','conversation-files-count-value',files.filter(file=>file.selected!==false).length+'/'+files.length));
  const nextContext=JSON.stringify([scope.project,scope.folder]);if(nextContext!==contextSignature){contextSignature=nextContext;const parts=[scope.project,scope.folder].filter((value,index,all)=>value&&all.indexOf(value)===index),text=parts.join(' / ');context.replaceChildren();if(text)context.append(icon(doc,'folder'),node(doc,'span','',text));context.title=text;context.hidden=!text;}
  importer.disabled=busy||!id||!E.chatAttachments;
  const nextHistory=JSON.stringify([id,words,sessionRows.map(row=>[row.id,row.title])]);if(nextHistory!==historySignature){historySignature=nextHistory;const historyScroll=history.scrollTop;history.replaceChildren();
  for(const session of sessionRows.filter(value=>!words||value.title?.toLocaleLowerCase().includes(words.toLocaleLowerCase())).slice().reverse()){
   const button=node(doc,'button','conversation-files-session');button.append(icon(doc,'chat'),node(doc,'span','',session.title||'新对话'));button.type='button';button.dataset.sessionID=session.id;button.setAttribute('aria-current',String(session.id===id));button.title=session.title||'新对话';button.onclick=action(async()=>{if(session.id===getSessionID())return;const token=++selectionRevision;button.setAttribute('aria-busy','true');try{await onSession(session.id);}finally{if(!disposed){button.removeAttribute?.('aria-busy');if(token===selectionRevision)render();}}});history.append(button);
   if(onRemoveSession){const row=node(doc,'div','conversation-files-session-row'),remove=node(doc,'button','conversation-files-session-remove');remove.append(icon(doc,'close'));remove.type='button';remove.title='删除对话';remove.setAttribute('aria-label','删除对话 '+(session.title||'新对话'));remove.onclick=action(async()=>{remove.disabled=true;try{await onRemoveSession(session);render();}finally{if(!disposed)remove.disabled=false;}});row.append(button,remove);history.append(row);}
   button.ondragover=event=>over(event,button,session.id);button.ondragleave=()=>delete button.dataset.drop;button.ondrop=event=>{droppedOn(event,session.id).catch(fail);};
  }
  history.scrollTop=historyScroll;}
  for(const button of filterButtons)button.setAttribute('aria-pressed',String(button.dataset.fileFilter===filter));
  const nextList=JSON.stringify([id,files,words,filter,getRevision()]);if(nextList===listSignature)return;listSignature=nextList;
  const scroll=list.scrollTop;list.replaceChildren();
  for(const file of files.filter(value=>matchesFile(value,words,filter))){
   const row=node(doc,'article','conversation-file');row.dataset.fileId=file.id;row.dataset.selected=String(file.selected!==false);
   const grip=node(doc,'span','conversation-file-grip','⠿');grip.draggable=true;grip.title='拖到对话选用资料，或拖到装配位置、PPT 页添加证据';grip.setAttribute('aria-label',grip.title);
   grip.ondragstart=event=>{if(disposed||id!==getSessionID()){event.preventDefault();return;}onFileDrag(event,file,id);row.dataset.dragging='true';event.stopPropagation();};grip.ondragend=()=>delete row.dataset.dragging;
   const select=node(doc,'input','conversation-file-check');select.type='checkbox';select.checked=file.selected!==false;select.setAttribute('aria-label','本次回答使用 '+file.title);
   const update=async patch=>{if(disposed||id!==getSessionID())return;select.disabled=true;try{await onFileState(file,patch,id);if(!disposed&&id===getSessionID()){render();onChange(id);}}catch(error){if(!disposed&&id===getSessionID())throw error;}finally{if(!disposed)select.disabled=false;}};
   select.onchange=action(()=>update({selected:select.checked}));
   const preview=node(doc,'button','conversation-file-preview');preview.type='button';preview.append(icon(doc,fileIcon(file),'conversation-file-icon'),node(doc,'span','conversation-file-name',file.title));preview.title=file.title;preview.onclick=action(()=>{if(!disposed&&id===getSessionID())return onPreview(file,id);});
   const star=node(doc,'button','conversation-file-star');star.append(icon(doc,'star'));star.type='button';star.title=file.featured?'取消精选':'设为精选';star.setAttribute('aria-label',star.title+' '+file.title);star.setAttribute('aria-pressed',String(!!file.featured));star.onclick=action(()=>update({featured:!file.featured}));
   const meta=node(doc,'small','conversation-file-meta',conversationFileLabel(file)+(file.sheet?' · '+file.sheet:''));
   row.append(grip,select,preview,star,meta);list.append(row);
  }
  if(!list.children.length){const empty=node(doc,'div','conversation-files-empty');empty.append(icon(doc,files.length?'search':'import'),node(doc,'span','',files.length?'没有匹配的资料':'拖入论文、图片或表格'));list.append(empty);}
  list.scrollTop=scroll;
 }
 render();return {root,render,setFilter(value){if(!fileFilters.some(([key])=>key===value))return false;filter=value;render();return true;},destroy(){disposed=true;root.remove();}};
}

/** A lightweight detail surface, never a second PDF reader. Generation guards
 * discard work from a previously selected file or conversation. */
export function mountConversationFileDetail({host,E,getSessionID,onBack=()=>{},onError=()=>{}}){
 const doc=host.ownerDocument;styles(doc);let generation=0,paneGeneration=0,controller,paneController,off=[],disposed=false,openedFile,openedSession;
 const abortController=()=>new (doc.defaultView?.AbortController||AbortController)();
 const cleanNodes=target=>{disposeMediaPreviews(target);for(const child of [target,...target.querySelectorAll('*')]){child._overviewOff?.();child._overviewHoverCleanup?.();child._materialSourceOff?.();}};
 function clearPane(){paneGeneration++;paneController?.abort();for(const cleanup of off.splice(0))if(typeof cleanup==='function')cleanup();cleanNodes(host);}
 function clear(){generation++;controller?.abort();clearPane();openedFile=openedSession=null;host.replaceChildren();}
 function back(){clear();host.hidden=true;onBack();}
 async function open(file,sessionID=getSessionID()){
  if(disposed||!file||sessionID!==getSessionID())return;clear();openedFile=file.id;openedSession=sessionID;host.hidden=false;const token=generation;controller=abortController();const signal=controller.signal,current=()=>!disposed&&!signal.aborted&&generation===token&&getSessionID()===sessionID&&host.isConnected;
  host.classList.add('conversation-file-detail');const header=node(doc,'header','conversation-file-detail-header'),backButton=node(doc,'button','conversation-file-back');backButton.append(icon(doc,'back'));backButton.type='button';backButton.title='返回资料';backButton.setAttribute('aria-label',backButton.title);backButton.onclick=back;const heading=node(doc,'div','conversation-file-detail-title');heading.append(node(doc,'small','',conversationFileLabel(file)),node(doc,'h3','',file.title));header.append(backButton,heading);host.append(header);
  const body=node(doc,'div','conversation-file-detail-body'),state=node(doc,'p','conversation-files-status','正在读取资料…');body.append(state);host.append(body);
  if(E.chatAttachments?.location){const location=node(doc,'details','conversation-file-location'),summary=node(doc,'summary','','保存位置');location.append(summary);header.after(location);Promise.resolve().then(()=>E.chatAttachments.location(sessionID,file.id)).then(value=>{if(!current())return;summary.textContent=(value.folders?.length?'文件夹 · '+value.folders.join(' / '):value.library||'本地资料');if(value.path){location.append(node(doc,'code','',value.path));const reveal=node(doc,'button','','在系统文件夹中显示');reveal.type='button';reveal.onclick=()=>{if(current())E.chatAttachments.reveal(sessionID,file.id).catch(onError);};location.append(reveal);}}).catch(error=>{if(current()){summary.textContent='保存位置暂不可用';location.append(node(doc,'span','',error.message));}});}
  try{
   if(file.kind==='pdf'&&E.getItem&&E.renderPaperOverview){const item=await E.getItem(file.paperItemID||file.attachmentID);if(!current())return;if(item?.getField){
    const tabs=node(doc,'nav','conversation-file-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','论文资料');header.append(tabs);const buttons=[];
    const show=async tab=>{if(!current())return;clearPane();const paneToken=paneGeneration;paneController=abortController();const paneSignal=paneController.signal,valid=()=>current()&&!paneSignal.aborted&&paneToken===paneGeneration;
     for(const button of buttons)button.setAttribute('aria-selected',String(button.dataset.filePane===tab));
     const pane=node(doc,'section','conversation-file-pane');body.replaceChildren(pane);
     try{if(tab==='info'){await E.renderPaperOverview(pane,item,{abstract:true});if(!valid())cleanNodes(pane);}
      else{pane.append(node(doc,'p','conversation-files-status','正在读取…'));const cleanup=await E.mountWorkbenchSourcePane(pane,{...file,kind:'paper'},tab,{signal:paneSignal});if(valid()){if(typeof cleanup==='function')off.push(cleanup);}else if(typeof cleanup==='function')cleanup();}
     }catch(error){if(valid()){pane.replaceChildren(node(doc,'p','conversation-files-status',error.message));onError(error);}}
    };
    for(const [tab,label]of [['info','摘要'],...(E.mountWorkbenchSourcePane?[['images','图片'],['annotations','批注'],['references','线索']]:[])]){const button=node(doc,'button','',label);button.type='button';button.dataset.filePane=tab;button.setAttribute('role','tab');button.onclick=()=>show(tab);tabs.append(button);buttons.push(button);}await show('info');
    return;
   }}
   const preview=await E.chatAttachments.preview(sessionID,file.id,{signal});if(!current())return;body.replaceChildren();
   if(preview.workbook){const book=preview.workbook,controls=node(doc,'form','conversation-sheet-controls'),sheets=node(doc,'select');sheets.setAttribute('aria-label','工作表');for(const sheet of book.sheets){const option=node(doc,'option','',sheet.name+(sheet.hidden?'（隐藏）':''));option.value=sheet.name;sheets.append(option);}sheets.value=book.selectedSheet;
    const ranges=node(doc,'input');ranges.placeholder='范围，例如 A1:F30';ranges.value=(preview.reference?.ranges||file.ranges||[]).join(', ');ranges.setAttribute('aria-label','本次问答的单元格范围');const save=node(doc,'button','','应用范围');save.type='submit';controls.append(sheets,ranges,save);body.append(controls);const feedback=node(doc,'p','conversation-files-status');feedback.setAttribute('role','status');body.append(feedback);
    controls.onsubmit=event=>{event.preventDefault();if(save.disabled||!current())return;save.disabled=true;feedback.textContent='';Promise.resolve().then(()=>E.chatAttachments.setState(sessionID,file.id,{sheet:sheets.value,ranges:ranges.value.split(/[,，]/u).map(value=>value.trim()).filter(Boolean)})).then(()=>{if(current()){const latest=E.chatAttachments.get(sessionID).find(value=>value.id===file.id);if(latest)return open(latest,sessionID);back();}}).catch(error=>{if(current()){save.disabled=false;feedback.textContent=error.message;onError(error);}});};
    const columnName=index=>{let text='';while(index>0){index--;text=String.fromCharCode(65+index%26)+text;index=Math.floor(index/26);}return text;};
    for(const section of book.sections||[]){body.append(node(doc,'small','conversation-sheet-range',section.range));const wrap=node(doc,'div','conversation-sheet-scroll'),table=node(doc,'table','conversation-sheet-table'),columns=Math.max(0,...(section.cells||[]).map(cell=>cell.values.length)),columnsHead=node(doc,'tr');columnsHead.append(node(doc,'th','',''));for(let index=0;index<columns;index++)columnsHead.append(node(doc,'th','',columnName((section.startColumn||1)+index)));table.append(columnsHead);for(const cell of section.cells||[]){const tr=node(doc,'tr');tr.append(node(doc,'th','',String(cell.row)));for(const value of cell.values)tr.append(node(doc,'td','',value==null?'':String(value)));table.append(tr);}wrap.append(table);body.append(wrap);}
   }else if(file.kind==='image'){
    const image=node(doc,'img','conversation-file-image');image.alt=file.title;image.src=file.previewURL||file.thumbnailURL||await E.previewImage(preview.rows.find(row=>row.imagePath)?.imagePath);if(!current())return;body.append(image);off.push(installMediaPreview(image,{src:image.src,alt:file.title,onError}));
   }else for(const row of preview.rows||[]){const section=node(doc,'section','conversation-file-excerpt');if(row.coverage)section.append(node(doc,'small','',row.coverage));const text=node(doc,'div');E.renderContent(text,row.text||row.sourceText||'');section.append(text);body.append(section);}
   for(const warning of preview.warnings||[])body.append(node(doc,'p','conversation-files-status',warning));
  }catch(error){if(current()){body.replaceChildren(node(doc,'p','conversation-files-status',error.message));onError(error);}}
 }
 const unsubscribe=E.workbenchConversations?.subscribe((_state,meta)=>{if(!openedFile)return;if(getSessionID()!==openedSession){back();return;}if(meta?.sessionID&&meta.sessionID!==openedSession)return;if(!E.chatAttachments.get(openedSession).some(file=>file.id===openedFile))back();},{summary:true});
 return {open,back,clear,destroy(){disposed=true;unsubscribe?.();clear();host.classList.remove('conversation-file-detail');}};
}
