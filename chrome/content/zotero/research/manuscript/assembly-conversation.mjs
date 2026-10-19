/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {installConversationSurface} from '../shared/conversation-surface.mjs';
import {chatAttachmentDropPayload} from '../shared/chat-attachments.mjs';
import {answerWithQuestion} from '../shared/chat-evidence.mjs';
import {assemblyChatIcon} from './assembly-chat-context.mjs';
import {installMessageDrag} from '../shared/message-transfer.mjs';
import {assemblyTaskContext} from './assembly-task-context.mjs';
import {captureAssemblyWritingRequest,runAssemblyWritingRequest} from './assembly-writing-request.mjs';
import {assemblyFrameworkIntent,requestAssemblyFramework} from './assembly-framework.mjs';
import {captureFramework} from '../shared/writing-framework.mjs';
import {installMediaPreview,disposeMediaPreviews} from '../shared/media-preview.mjs';

export function assemblySelectedSource(project,context,previewID='',assets={}){
 const bound=context?.materialIDs||[];
 // A module with several sources is read as a group by read_selected_source.
 // A stale hover/preview in another module must not replace those bindings.
 const id=bound.length?(bound.includes(previewID)?previewID:bound.length===1?bound[0]:''):previewID;
 const material=(project.materials||[]).find(row=>row.id===id)||assets[id];
 return material?JSON.parse(JSON.stringify({...material,kind:'material',stableID:'material:'+material.id})):null;
}

// Store notifications include other projects and draft keystrokes. Inspect
// their metadata before touching a rendered transcript or its source previews.
export function assemblyConversationRefresh(previous,session,meta={},menuChanged=false){
 const switched=previous?.id!==session?.id,fields=meta.fields||[],targeted=!meta.sessionID||meta.sessionID===session?.id;
 const knownUpdate=meta.action==='update'&&fields.length>0;
 const changed=key=>switched||targeted&&(knownUpdate?fields.includes(key):JSON.stringify(previous?.[key])!==JSON.stringify(session?.[key]));
 const transcript=changed('messages'),attachments=changed('attachments'),draft=changed('draft');
 const preferences=['mode','modelID','thinkingLevel','executionMode'].some(changed);
 const context=switched||menuChanged||transcript||attachments||['selectedSource','currentTask','assemblyContext'].some(changed);
 return {switched,transcript,attachments,draft,preferences,context,surface:switched||menuChanged||transcript||attachments||draft||preferences};
}

// Capture the owner at the input event, and flush before leaving that owner.
// A delayed old draft must never be written into a newly selected task or
// restored after the send path has cleared its submitted draft.
export function createAssemblyDraftSaver({save,onError=()=>{},delay=160,setTimer=setTimeout,clearTimer=clearTimeout}){
 let pending,timer,disposed=false;
 const flush=()=>{clearTimer(timer);timer=undefined;const value=pending;pending=undefined;if(!value)return Promise.resolve();return Promise.resolve().then(()=>save(value.sessionID,value.draft)).catch(onError);};
 return {
  queue(sessionID,draft){if(disposed)return;if(pending&&pending.sessionID!==sessionID)void flush();pending={sessionID,draft};clearTimer(timer);timer=setTimer(flush,delay);},
  flush,
  dispose(){disposed=true;return flush();}
 };
}

export async function installAssemblyConversation(U,{renderChat,applyPanels,persist,status}){
 // Edge fades stay fixed to the transcript viewport, so reading or selecting a
 // long answer never turns a moving decoration into a click target.
 const history=U.$('ai-history');if(!history.parentElement.classList.contains('ai-transcript-frame')){const frame=document.createElement('div');frame.className='ai-transcript-frame';history.before(frame);frame.append(history);}
 const E=U.E,S=E.workbenchConversations;if(!S)throw Error('共享研究对话尚未加载，请重启新版 EasySch。');
 await S.importLegacy('assembly:'+U.p.id,U.p.chat||[],{title:'装配 · '+U.p.title,origin:'assembly',projectID:U.p.id,draft:U.p.ui.aiDraft||''});
 U.conversations=S;await S.open({projectID:U.p.id,origin:'assembly',title:U.p.title});U.conversationSession=S.getForScope({projectID:U.p.id});
 const draftSaver=createAssemblyDraftSaver({save:(id,draft)=>S.update(id,{draft},{origin:'assembly'}),onError:error=>status(error.message,true)});U.flushResearchDraft=()=>draftSaver.flush();
 U.previewResearchSource=async source=>{
  const id=source?.materialID||String(source?.stableID||source?.id||'').replace(/^material:/u,''),material=U.p.materials.find(row=>row.id===id)||U.A.assetLibrary()[id];
  if(!material)throw Error('此依据尚未保存为可选素材；请使用“查看原文”打开来源');
  U.p.ui.left='materials';U.p.ui.leftOpen=true;U.p.ui.rightOpen=true;U.closeChatRail?.('left');
  U.p.ui.catalog={...(U.p.ui.catalog||{}),selection:[material.id]};U.materialRevealID=material.id;delete U.materialRevealKey;
  U.applyPanels();U.renderLibrary();U.materialDetails(material);
  const row=[...U.$('library').querySelectorAll('article.material[data-material]')].find(node=>node.dataset.material===material.id);row?.scrollIntoView({block:'center'});await persist();return material;
 };
 U.openResearchCitation=source=>U.previewResearchSource(source).catch(error=>{status(error.message,true);return null;});
 const openSource=source=>U.openResearchCitation(source);
 const saveMessage=async(message,{sessionID=U.conversationSession.id}={})=>{
  if(!E.saveResearchMessageNote)throw Error('研究笔记保存接口尚未加载，请重启新版。');
  const saved=answerWithQuestion(S.get(sessionID)?.messages,message),result=await E.saveResearchMessageNote(saved,{sessionID,projectID:U.p.id});U.A.syncAssets(U.p);U.renderLibrary();return result;
 };
 const send=async(prompt,{sessionID=U.conversationSession.id,onProgress=()=>{},mode,modelID,thinkingLevel,assemblyContext,executionMode,onToolPermission,onResearchQuestion,stop=false,fromComposer=false}={})=>{
  if(stop){U.abort?.abort();return;}if(U.busy||U.frameworkBusy||(U.aiSending&&!fromComposer))throw Error('当前研究任务尚未结束，请等待或停止。');
  await draftSaver.flush();
  if(U.busy||U.frameworkBusy||(U.aiSending&&!fromComposer))throw Error('当前研究任务尚未结束，请等待或停止。');
  const selectionCapture=U.selectionAssistant?.captureForPrompt(prompt);
  const frameworkCapture=!selectionCapture&&assemblyFrameworkIntent(prompt)?captureFramework(U.p,{instruction:prompt,materialIDs:U.p.ui.frameworkSources?.[U.p.ui.sectionID]}):null;
  const writingCapture=frameworkCapture||selectionCapture?null:captureAssemblyWritingRequest(U.p,prompt);if(!writingCapture&&!selectionCapture)E.aiPolicy?.assertResearchPrompt(prompt);const session=S.get(sessionID);if(!session)throw Error('研究对话已不可用，请重新选择。');
  U.busy=true;U.activeResearchSessionID=sessionID;U.updateAssemblyTaskState?.('running',sessionID);U.abort=new AbortController();const signal=U.abort.signal;
  try{
   mode=mode||session.mode||'auto';modelID=modelID??session.modelID??'';thinkingLevel=thinkingLevel??session.thinkingLevel??'off';
   executionMode=executionMode||session.executionMode||'auto';assemblyContext=JSON.parse(JSON.stringify(assemblyContext||assemblyTaskContext(U.p,prompt)));
   const selectedPassage=U.selectionAssistant?.getTarget();if(selectedPassage)assemblyContext.editSelection={kind:selectedPassage.kind,sectionID:selectedPassage.sectionID,blockID:selectedPassage.blockID,materialID:selectedPassage.materialID,unitID:selectedPassage.unitID,start:selectedPassage.start,end:selectedPassage.end,text:selectedPassage.text};
   assemblyContext.pageBounds=U.captureAssemblyPageBounds?.(assemblyContext)||assemblyContext.pageBounds;
   const selectedSource=assemblySelectedSource(U.p,assemblyContext,U.previewMaterialID,U.A.assetLibrary());
   const task=assemblyContext?.currentTask||prompt.replace(/\s+/gu,' ').slice(0,50);
   await S.update(sessionID,{projectID:U.p.id,draft:'',mode,modelID,thinkingLevel,executionMode,currentTask:task,...(assemblyContext?{assemblyContext}:{}),...(session.isDraft?{title:task}:{})},{origin:'assembly'});
   await S.append(sessionID,{role:'user',text:prompt,attachments:session.attachments||[],currentTask:task,...(assemblyContext?{assemblyContext}:{})},{origin:'assembly'});
   let result;
   if(selectionCapture)result=await U.selectionAssistant.request(selectionCapture,prompt,{sessionID,modelID,thinkingLevel,executionMode,signal,onProgress,onToolPermission:request=>(onToolPermission||U.requestToolPermission)?.({...request,sessionID})??false});
   else if(frameworkCapture){const frame=await requestAssemblyFramework(U,{instruction:prompt,sectionID:frameworkCapture.sectionID,capture:frameworkCapture,fromChat:true,sessionID,modelID,thinkingLevel,executionMode,signal,onProgress,onToolPermission:request=>(onToolPermission||U.requestToolPermission)?.({...request,sessionID})??false});const ids=new Set(frame.nodes.flatMap(row=>row.evidence.map(item=>item.sourceID)));result={text:'已按“'+frame.sectionTitle+'”整理 '+frame.nodes.length+' 个段落任务，保存在写作速读中。按论证单元连贯说明已写内容、拟补素材、结构与文字调整；没有生成或覆盖论文正文。',sources:U.p.materials.filter(row=>ids.has(row.id)).map(row=>({id:row.id,materialID:row.id,title:row.title,sourceText:row.sourceText,anchor:row.anchor})),model:frame.model,steps:[{tool:'prepare_writing_framework',label:'章节框架已保存',status:'complete'}]};}
   else if(writingCapture){result=await runAssemblyWritingRequest(U,{prompt,capture:writingCapture,sessionID,modelID,thinkingLevel,executionMode,signal,onProgress,onToolPermission:request=>(onToolPermission||U.requestToolPermission)?.({...request,sessionID})??false},{persist,status});}
   else if(E.runWorkbenchTask){result=await E.runWorkbenchTask({prompt,mode:mode==='source'?'auto':mode,projectID:U.p.id,sessionID,assemblyContext,executionMode,onToolPermission:request=>(onToolPermission||U.requestToolPermission)?.({...request,sessionID})??false,onResearchQuestion:request=>(onResearchQuestion||U.requestResearchQuestion)?.({...request,sessionID})??{answer:''},selectedSource,attachments:session.attachments||[],history:S.get(sessionID).messages,modelID,thinkingLevel,signal,onProgress});}
   else if(mode==='evaluate'){const version=await E.notebook.evaluate(U.p.id,prompt,onProgress,signal);result={text:E.notebook.planMarkdown(version),sources:version.sources||[],planVersionID:version.id,projectID:U.p.id};}
   else result=await E.notebook.ask(U.p.id,prompt,onProgress,signal);
   if(signal.aborted)throw Error('已停止，研究消息与已有素材保留。');
   if(!result?.text?.trim())throw Error('研究任务没有返回实际内容。');
   const answer=await S.append(sessionID,{...result,role:'assistant',text:result.text,sources:result.sources||[],currentTask:task,...(assemblyContext?{assemblyContext}:{})},{origin:'assembly'});U.updateAssemblyTaskState?.('complete',sessionID);return answer;
  }catch(error){U.updateAssemblyTaskState?.('error',sessionID);throw error;}
  finally{U.busy=false;U.abort=null;if(U.activeResearchSessionID===sessionID)U.activeResearchSessionID='';}
 };
 U.sendResearchMessage=send;U.saveResearchMessage=saveMessage;
 U.attachResearchFiles=(payload={},options={})=>E.chatAttachments.attach(U.conversationSession.id,payload,options);
 U.removeResearchAttachment=id=>E.chatAttachments.remove(U.conversationSession.id,id);
 U.dragResearchAttachment=(event,item)=>E.chatAttachments.setDragData(event,item,U.conversationSession.id);
 const surface=installConversationSurface({doc:document,orb:U.aiOrb.button,state:U.p.ui.aiConversation||{},
  dockTargets:()=>[{id:'left',label:'素材 / 结构',element:U.$('left'),ensureOpen(){U.p.ui.leftOpen=true;applyPanels();persist();}},{id:'right',label:'模块详情',element:U.$('right'),ensureOpen(){U.p.ui.rightOpen=true;applyPanels();persist();}}],
  onState(value){if(Object.hasOwn(value,'draft')||Object.hasOwn(value,'mode')){const patch={};for(const key of ['draft','mode','modelID','thinkingLevel','executionMode'])if(Object.hasOwn(value,key))patch[key]=value[key];S.update(value.sessionID||U.conversationSession.id,patch,{origin:'assembly'}).catch(error=>status(error.message,true));return;}U.p.ui.aiConversation=value;persist();},
  renderContent:(...args)=>E.renderContent(...args),onSend:send,onSave:saveMessage,onSource:openSource,onDragMessage:event=>U.updateMessagePinTargets?.(event),getModels:()=>E.workbenchModels?.()||[],
  getAttachments:session=>session?.attachments||[],onAttach:(payload,{sessionID,source})=>E.chatAttachments.attach(sessionID,payload,{source}),onRemoveAttachment:(id,{sessionID})=>E.chatAttachments.remove(sessionID,id),onDragAttachment:(item,event)=>E.chatAttachments.setDragData(event,item,U.conversationSession.id),
  onSelectSession:async id=>{if(id==='__new__'){const s=U.conversationSession;await S.create({title:'新研究对话',origin:'assembly',projectID:U.p.id,modelID:s.modelID||'',thinkingLevel:s.thinkingLevel||'off',executionMode:s.executionMode||'auto',mode:s.mode||'auto'});}else if(id==='__inherit__'){const active=S.getActive();if(active)await S.select(active.id,{scope:{projectID:U.p.id},summary:true});}else await S.select(id,{scope:{projectID:U.p.id},summary:true});},
  onError:error=>status(error.message,true)
 });
 U.conversationSurface=surface;U.aiOrb.button.setAttribute('aria-controls',surface.root.id);
 const decorateTranscript=()=>{
  const session=U.conversationSession;if(!session)return;
  for(const [index,row]of [...U.$('chat').children].entries()){
   const message=session.messages?.[index];if(!message||message.role==='user'||row.dataset.messageID===message.id)continue;
   row.dataset.messageID=message.id;const meta=row.querySelector('.message-meta'),save=meta?.querySelector('.quiet-action');
   if(save){save.replaceChildren(assemblyChatIcon(document,'save'));save.title='保存回答和问题为笔记';save.setAttribute('aria-label',save.title);}
   const pin=document.createElement('button');pin.type='button';pin.className='quiet-action chat-message-pin';pin.title='固定到右侧 · Shift 点击固定到左侧';pin.setAttribute('aria-label','固定对话片段');pin.append(assemblyChatIcon(document,'pin'));pin.onclick=event=>U.pinResearchMessage?.({sessionID:session.id,messageID:message.id},event.shiftKey?'left':'right').catch(error=>status(error.message,true));meta?.append(pin);
   const grip=document.createElement('button');grip.type='button';grip.className='quiet-action chat-message-grip';grip.title='拖动回答到素材库或论文，保留问题和证据';grip.setAttribute('aria-label',grip.title);grip.append(assemblyChatIcon(document,'grip'));meta?.append(grip);
   row.disposeResearchDrag=installMessageDrag({card:row,grip,textRoots:[...row.children],sessionID:session.id,messageID:message.id,onDrag:event=>U.updateMessagePinTargets?.(event)});
  }
 };
 const transcriptObserver=new MutationObserver(decorateTranscript);transcriptObserver.observe(U.$('chat'),{childList:true});
 for(const [id,name]of [['ai-attach','plus'],['ai-options','settings'],['ask-ai','send'],['collapse-chat','chevron']]){const control=U.$(id);if(control)control.replaceChildren(assemblyChatIcon(document,name));}
 // Keep the keyboard affordance paired with the broad rail's actual focus.
 const collapseRail=U.$('collapse-chat'),revealCollapseRail=()=>collapseRail.dataset.focused='true',hideCollapseRail=()=>delete collapseRail.dataset.focused;
 collapseRail.addEventListener('focus',revealCollapseRail);collapseRail.addEventListener('blur',hideCollapseRail);
 let attachmentSignature='';
 const renderAttachments=session=>{
  const host=U.$('ai-attachments');if(!host)return;const items=session.attachments||[],signature=JSON.stringify([session.id,items]);if(signature===attachmentSignature)return;attachmentSignature=signature;const existing=new Map([...host.children].map(node=>[node.dataset.attachmentId,node]));host.hidden=!items.length;
  for(const item of items){let chip=existing.get(item.id);existing.delete(item.id);
   if(!chip){chip=document.createElement('span');chip.className='ai-attachment';chip.dataset.attachmentId=item.id;chip.draggable=false;
    const grip=document.createElement('span');grip.className='assembly-file-grip';grip.draggable=true;grip.title='拖到论文当前位置，关联此文件';grip.setAttribute('aria-label',grip.title);grip.append(assemblyChatIcon(document,'grip'));chip.append(grip);grip.ondragstart=event=>U.dragResearchAttachment(event,chip.attachment);
    const text=document.createElement('span');text.className='ai-attachment-name';text.textContent=item.title;chip.append(text);
    const remove=document.createElement('button');remove.type='button';remove.className='ai-attachment-remove';remove.append(assemblyChatIcon(document,'close'));remove.title='从对话移除，源文件保留';remove.setAttribute('aria-label',remove.title);remove.onclick=()=>U.removeResearchAttachment(item.id).catch(error=>status(error.message,true));chip.append(remove);
   }
   chip.attachment=item;chip.title=item.title;chip.querySelector('.ai-attachment-name').textContent=item.title;
   // Retain the chip while a preview finishes loading or the attachment's
   // metadata changes. The drag uses the current retained identity and values.
   let preview=chip.querySelector(':scope>img,:scope>svg');
   if(item.thumbnailURL){if(preview?.localName!=='img'){preview?.remove();preview=document.createElement('img');chip.prepend(preview);installMediaPreview(preview,{alt:item.title,onError:error=>status(error.message,true)});}if(preview.getAttribute('src')!==item.thumbnailURL)preview.src=item.thumbnailURL;preview.alt=item.title;}
   else if(preview?.localName!=='svg'){preview?.remove();chip.prepend(assemblyChatIcon(document,'file'));}
   host.append(chip);
  }
  for(const node of existing.values()){disposeMediaPreviews(node);node.remove();}
 };
 // The service already delivered an immutable snapshot. Reading it again for
 // the selected session and menu would clone every saved transcript twice on
 // each task switch or draft emission.
 let sessionMenuSignature='';
 const update=(value,meta)=>{const scoped=S.getForScope({projectID:U.p.id},value),session=scoped&&!Array.isArray(scoped.messages)?S.get(scoped.id):scoped;if(!session)return;
  const sessions=value.sessions.filter(item=>!item.isDraft),menuSignature=JSON.stringify(sessions.map(item=>[item.id,item.title,item.projectID,item.sourceID])),refresh=assemblyConversationRefresh(U.conversationSession,session,meta,menuSignature!==sessionMenuSignature);sessionMenuSignature=menuSignature;
  if(refresh.switched)void draftSaver.flush();
  const focused=document.activeElement,preserve=focused?.matches('.assembly-task-select,.assembly-compose-control,#ai-options,#assembly-execution-mode');
  U.conversationSession=session;U.conversationSessions=sessions;if(refresh.surface)surface.render(session,value.sessions,meta);if(refresh.attachments)renderAttachments(session);if(refresh.switched||refresh.preferences){if(U.$('ai-mode'))U.$('ai-mode').value=session.mode||'auto';U.syncComposerMode?.();}if((refresh.switched||refresh.draft)&&(refresh.switched||document.activeElement!==U.$('ai-prompt')))U.$('ai-prompt').value=session.draft||'';if(refresh.transcript){renderChat();decorateTranscript();}else if(refresh.context)U.updateChatContext?.();
  // A synchronous shared-message repaint is not a new user focus request.
  // Retained task/menu controls keep the exact keyboard destination; an
  // intentionally removed control or a separate asynchronous user action does
  // not get refocused here.
  if(preserve&&focused.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
 };
 const subscription={summary:true,sessionID:()=>U.conversationSession?.id},unsubscribe=S.subscribe(update,subscription);const initial=S.snapshot(subscription);U.conversationSession=null;update(initial);if(U.p.ui.aiConversation?.open)surface.show({restore:true});
 // Attachment chips and contextual task controls can change the footer's
 // height. Keep the history stack anchored to its actual input baseline.
 const footerResize=new ResizeObserver(()=>applyPanels());footerResize.observe(document.querySelector('footer'));
 const resize=U.$('ai').querySelector('.ai-grip'),beginResize=()=>U.$('ai').dataset.resizing='true',endResize=()=>delete U.$('ai').dataset.resizing;
 resize.addEventListener('pointerdown',beginResize);resize.addEventListener('pointerup',endResize);resize.addEventListener('pointercancel',endResize);
 const attachmentDrops=[];for(const node of [U.$('ai-history').parentElement,U.$('ai-form')].filter(Boolean)){const over=event=>{if(chatAttachmentDropPayload(event.dataTransfer)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';node.dataset.attachmentDrop='true';}},leave=event=>{if(!node.contains(event.relatedTarget))delete node.dataset.attachmentDrop;},drop=event=>{const payload=chatAttachmentDropPayload(event.dataTransfer);delete node.dataset.attachmentDrop;if(!payload)return;event.preventDefault();event.stopPropagation();U.attachResearchFiles(payload,{source:'drop'}).catch(error=>status(error.message,true));};node.addEventListener('dragover',over);node.addEventListener('dragleave',leave);node.addEventListener('drop',drop);attachmentDrops.push(()=>{node.removeEventListener('dragover',over);node.removeEventListener('dragleave',leave);node.removeEventListener('drop',drop);});}
 const input=U.$('ai-prompt'),saveDraft=()=>draftSaver.queue(U.conversationSession.id,input.value),flushDraft=()=>void draftSaver.flush();input.addEventListener('input',saveDraft);input.addEventListener('blur',flushDraft);
 const target=U.$('left');target.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('application/x-easysch-research-message')){event.preventDefault();event.dataTransfer.dropEffect='copy';target.dataset.researchDrop='true';}});target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))delete target.dataset.researchDrop;});
 target.addEventListener('drop',async event=>{const raw=event.dataTransfer.getData('application/x-easysch-research-message');delete target.dataset.researchDrop;if(!raw)return;event.preventDefault();event.stopImmediatePropagation();try{const reference=JSON.parse(raw),message=S.get(reference.sessionID)?.messages.find(value=>value.id===reference.messageID);if(!message)throw Error('研究消息已不可用，请重新拖动。');await saveMessage(message,{sessionID:reference.sessionID});status('回答已保存为研究笔记与来源素材。');}catch(error){status(error.message,true);}},{capture:true});
 window.addEventListener('pagehide',()=>{void draftSaver.dispose();footerResize.disconnect();resize.removeEventListener('pointerdown',beginResize);resize.removeEventListener('pointerup',endResize);resize.removeEventListener('pointercancel',endResize);collapseRail.removeEventListener('focus',revealCollapseRail);collapseRail.removeEventListener('blur',hideCollapseRail);transcriptObserver.disconnect();unsubscribe();surface.destroy();input.removeEventListener('input',saveDraft);input.removeEventListener('blur',flushDraft);for(const dispose of attachmentDrops)dispose();},{once:true});
 return surface;
}
