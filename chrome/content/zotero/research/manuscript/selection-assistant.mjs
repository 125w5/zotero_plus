/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {captureSelectionTarget,assertSelectionTargetCurrent,applySelectionPreview,revertSelectionPreview} from './selection-target.mjs';
import {captureMaterialSelections,createMaterialHighlightGroup,quoteRange} from '../shared/material-highlights.mjs';
import {installMessageDrag} from '../shared/message-transfer.mjs';
import {assemblyChatIcon} from './assembly-chat-context.mjs';
const labels={block:'正文选段',digest:'写作速读选段',comment:'素材批注',summary:'素材说明', 'source-note':'为素材添加批注'};
const editIntent=prompt=>/(?:改写|重写|润色|修改|精简|扩写|补充|调整|删去|删除|添加|改成|换成|简洁|学术|压缩|规范|组织|写成|翻译|批注)/u.test(prompt)||!/(?:解释|为什么|是什么|分析|依据|是否|能否|请问|怎么理解|[?？])/u.test(prompt);
const nodeElement=node=>node?.nodeType===3?node.parentElement:node;
/** Range boundaries are normalized by the DOM for forward and backward drags. */
export function rangeTextOffsets(host,range){
 if(!host.contains(range.startContainer)||!host.contains(range.endContainer))return null;
 const prefix=range.cloneRange();prefix.selectNodeContents(host);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length,text=range.toString();
 return text.trim()?{start,end:start+text.length,text,full:host.textContent}:null;
}
function modelTextOffset(value,quote,range){
 if(typeof value!=='string')return null;if(value.slice(range.start,range.end)===quote)return {start:range.start,end:range.end};return quoteRange(value,quote);
}
export function installSelectionAssistant(U,{snapshot,persist,changed,status,saveMaterialHighlights}){
 const doc=U.$('canvas').ownerDocument,win=doc.defaultView,right=U.$('right'),details=U.$('details'),create=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const style=create('link');style.rel='stylesheet';style.href=new URL('./selection-assistant.css',import.meta.url).href;doc.head.append(style);
 const root=create('section','selection-assistant');root.id='selection-assistant';root.setAttribute('aria-label','论文编辑对话');right.append(root);
 const head=create('header','selection-assistant-header'),tabs=create('div','selection-assistant-tabs');tabs.setAttribute('role','tablist');head.append(tabs);root.append(head);
 const control=(label,action,parent,cls='selection-assistant-button')=>{const node=create('button',cls,label);node.type='button';node.onclick=()=>Promise.resolve().then(action).catch(error=>status(error.message,true));parent?.append(node);return node;};
 const chatTab=control('编辑对话',()=>setView('chat'),tabs),detailTab=control('详情与来源',()=>setView('details'),tabs);
 for(const tab of [chatTab,detailTab])tab.setAttribute('role','tab');
 const fresh=control('',()=>{const session=U.conversationSession;return U.conversations.create({title:'新研究对话',origin:'assembly',projectID:U.p.id,modelID:session.modelID||'',thinkingLevel:session.thinkingLevel||'off',executionMode:session.executionMode||'auto',mode:session.mode||'auto'});},head,'selection-assistant-new');fresh.append(assemblyChatIcon(doc,'plus'));fresh.title='新建对话';fresh.setAttribute('aria-label',fresh.title);
 const pane=create('div','selection-assistant-pane'),context=create('section','selection-assistant-context'),transcript=create('div','selection-assistant-transcript'),proposal=create('section','selection-assistant-proposal'),form=create('form','selection-assistant-form');root.append(pane);pane.append(context,transcript,proposal,form);transcript.setAttribute('aria-label','当前论文对话');
 const input=create('textarea');input.rows=3;input.setAttribute('aria-label','修改选段或讨论当前论文');input.placeholder='选择文章中的文字，说明希望怎样调整…';input.value=U.conversationSession?.draft||U.p.ui.selectionAssistantDraft||'';form.append(input);
 const actions=create('div','selection-assistant-actions'),scope=create('span','selection-assistant-scope'),send=control('发送',()=>form.requestSubmit(),actions,'selection-assistant-send');actions.prepend(scope);form.append(actions);
 const stop=control('停止',()=>U.abort?.abort(),actions);stop.hidden=true;
 let target=null,preview=null,busy=false,mutating=false,disposed=false,renderSignature='',messageDisposers=[],draftTimer,pendingDraft,draftSessionID=U.conversationSession?.id,viewMode='',savedMode='';
 const flushDraft=()=>{clearTimeout(draftTimer);const pending=pendingDraft;pendingDraft=null;return pending?U.conversations.update(pending.sessionID,{draft:pending.text},{origin:'assembly'}):Promise.resolve();};
 const syncDraft=()=>{const session=U.conversationSession;if(!session)return;if(session.id!==draftSessionID){void flushDraft().catch(error=>status(error.message,true));draftSessionID=session.id;input.value=session.draft||'';}else if(!pendingDraft&&doc.activeElement!==input)input.value=session.draft||'';};
 const selectedMaterial=id=>U.p.materials.find(row=>row.id===id)||U.A.assetLibrary()[id];
 const sync=()=>{
  if(preview){const retained=U.p.proposals?.find(row=>row.id===preview.id);if(retained!==preview){preview=retained||[...(U.p.proposals||[])].reverse().find(row=>row.kind==='assembly-selection-preview')||null;renderProposal();}}
  const mode=U.p.ui.assemblyFlowVersion>=2?'stage-'+U.p.ui.step:U.p.ui.canvasDisplay||'materials';if(mode!==savedMode){savedMode=mode;viewMode=U.p.ui.assemblyFlowVersion>=2?U.p.ui.step===2?'chat':'details':['digest','article'].includes(mode)?'chat':'details';}
  const chat=viewMode==='chat';doc.body.dataset.writingAssistant=String(chat);right.classList.add('has-selection-assistant');root.dataset.view=chat?'chat':'details';chatTab.setAttribute('aria-selected',String(chat));detailTab.setAttribute('aria-selected',String(!chat));pane.hidden=!chat;fresh.hidden=!chat;scope.textContent=U.conversationSession?.modelID||'GPT-6 Luna';
  if(chat){right.hidden=false;U.p.ui.rightOpen=true;}U.syncSelectionAssistantLayout?.();
 };
 function setView(value){viewMode=value;sync();U.applyPanels?.();persist();}
 const showContext=()=>{
  context.replaceChildren();context.hidden=!target;
  if(!target)return;const bar=create('div','selection-assistant-context-heading');bar.append(create('strong','',labels[target.kind]||'选中文字'));context.append(bar);
  const clear=control('×',()=>{target=null;showContext();},bar,'selection-assistant-clear');clear.setAttribute('aria-label','取消本次编辑选区');clear.title='取消选区，继续普通讨论';
  const quote=create('blockquote','',target.text);context.append(quote);input.placeholder=target.kind==='source-note'?'说明这段素材的批注要记录什么…':'说明选中文字要怎样修改；采用前原文保留…';
 };
 const refreshTranscript=()=>{
  const session=U.conversationSession;if(!session)return;const signature=JSON.stringify([session.id,session.messages?.map(row=>[row.id,row.text,row.sources]),busy]);if(signature===renderSignature)return;renderSignature=signature;
  for(const dispose of messageDisposers.splice(0))dispose();const nearBottom=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<60;transcript.replaceChildren();
  const messages=(session.messages||[]).slice(-40);if(!messages.length){const empty=create('div','selection-assistant-empty');empty.append(create('span','easysch-symbol'),create('h3','','围绕文章，逐处推进'),create('p','','选中正文或素材批注，比较修改方案后再采用。也可以要求整篇调整。'));transcript.append(empty);}
  for(const message of messages){const row=create('article','selection-assistant-message');row.dataset.role=message.role;row.dataset.messageId=message.id;const heading=create('div','selection-assistant-message-heading');heading.append(create('small','',message.role==='user'?'你':'研究助手'));row.append(heading);const text=create('div','selection-assistant-message-text');row.append(text);U.E.renderContent(text,message.text,{sources:message.sources||[],onSource:source=>U.openResearchCitation?.(source)});
   if(message.role==='assistant'){const grip=control('',()=>{},heading,'selection-assistant-message-grip');grip.append(assemblyChatIcon(doc,'grip'));grip.title='拖到论文页或素材栏，保留问题和来源';grip.setAttribute('aria-label',grip.title);messageDisposers.push(installMessageDrag({card:row,grip,textRoots:[text],sessionID:session.id,messageID:message.id,onDrag:event=>U.updateMessagePinTargets?.(event)}));}
   transcript.append(row);
  }
  if(nearBottom||messages.length<3)transcript.scrollTop=transcript.scrollHeight;
 };
 const saveMaterial=async(material,patch)=>{
  if(patch.highlights){await saveMaterialHighlights(material,patch.highlights);return selectedMaterial(material.id);}
  if(material.assetID){const next=await U.A.editAsset(material.assetID,patch,material.revision);Object.assign(material,next);U.A.syncAssets(U.p);}else{snapshot();Object.assign(material,patch);material.userEdited=true;material.revision=(material.revision||0)+1;}
  U.M.invalidate(U.p,material.id);await persist({flush:true});if(U.saveError)throw U.saveError;U.renderLibrary();return material;
 };
 const adoptedMaterialValue=material=>({revision:material.revision,summary:material.summary,highlights:U.M.clone(material.highlights||[])});
 const accept=async variant=>{
  if(busy||mutating||preview?.status!=='pending')return;mutating=true;renderProposal();try{const currentPreview=preview;assertSelectionTargetCurrent(U.p,currentPreview.target);snapshot();const result=applySelectionPreview(U.p,currentPreview,variant.id,{confirmed:true});
  if(result.material){const material=result.material,kind=currentPreview.target.kind;currentPreview.materialBefore=adoptedMaterialValue(material);let patch;
   if(kind==='summary')patch={summary:result.value};
   else if(kind==='comment'){const row=material.highlights.find(item=>item.id===currentPreview.target.highlightID),groupID=row.groupID;patch={highlights:(material.highlights||[]).map(item=>item.id===row.id||groupID&&item.groupID===groupID?{...item,comment:result.value}:item)};}
   else {const added=createMaterialHighlightGroup(material,currentPreview.target.selectionGroup,{comment:variant.text,color:'blue',style:'highlight'});patch={highlights:[...(material.highlights||[]),...added]};}
   const saved=await saveMaterial(material,patch);currentPreview.materialApplied=adoptedMaterialValue(saved);currentPreview.status='accepted';currentPreview.selectedVariantID=variant.id;
  }
  target=null;showContext();changed({editor:true});await persist({flush:true});if(U.saveError)throw U.saveError;status('已采用选区修改，可撤回；周围内容与来源保留。');
  }finally{mutating=false;renderProposal();}
 };
 const revert=async()=>{
  if(busy||mutating||preview?.status!=='accepted')return;mutating=true;renderProposal();try{const selected=preview;if(selected.materialApplied){const material=selectedMaterial(selected.target.materialID);if(!material||JSON.stringify(adoptedMaterialValue(material))!==JSON.stringify(selected.materialApplied))throw Error('素材采用后已有新修改，不能覆盖；请手动调整');snapshot();await saveMaterial(material,selected.target.kind==='summary'?{summary:selected.materialBefore.summary}:{highlights:selected.materialBefore.highlights});selected.status='reverted';}
  else {snapshot();revertSelectionPreview(U.p,selected,{confirmed:true});}changed({editor:true});await persist({flush:true});if(U.saveError)throw U.saveError;status('已撤回本次修改。');
  }finally{mutating=false;renderProposal();}
 };
 function renderProposal(){
  root.setAttribute('aria-busy',String(mutating||busy));proposal.replaceChildren();proposal.hidden=!preview;if(!preview)return;const section=U.p.sections.find(row=>row.id===preview.target.sectionID);proposal.append(create('strong','',labels[preview.target.kind]+' · '+(section?.title||'')));
  const selected=preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0],variants=create('div','selection-assistant-variants');variants.setAttribute('role','tablist');proposal.append(variants);
  for(const variant of preview.variants){const tab=control(variant.label,()=>{preview.selectedVariantID=variant.id;renderProposal();persist();},variants);tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(variant.id===selected.id));}
  const diff=create('div','selection-assistant-diff');for(const part of selected.diff){const node=create(part.kind==='insert'?'ins':part.kind==='delete'?'del':'span','',part.text);diff.append(node);}proposal.append(diff);
  const bar=create('div','selection-assistant-proposal-actions');proposal.append(bar);
  if(preview.status==='pending'){control('保留原文',()=>{preview.status='rejected';renderProposal();persist();},bar);const use=control('保留更改',()=>accept(selected),bar,'selection-assistant-accept');use.dataset.action='accept-selection-preview';}
  else if(preview.status==='accepted'){control('撤回修改',revert,bar).dataset.action='revert-selection-preview';}
  else proposal.append(create('small','',preview.status==='reverted'?'已撤回修改':'已保留原文'));
  for(const button of proposal.querySelectorAll('button'))button.disabled=mutating||busy;
 }
 const captureFromRange=selection=>{
  if(!selection?.rangeCount||selection.isCollapsed||!selection.toString().trim())return null;const range=selection.getRangeAt(0).cloneRange(),start=nodeElement(range.startContainer),end=nodeElement(range.endContainer);if(!start||!end||start.closest('#selection-assistant,#ai,#ai-form,button,input,textarea,.katex')||end.closest('.katex'))return null;
  let host,settings,value;
  const editable=start.closest('#canvas .editable');
  if(editable&&editable.contains(end)){host=editable;const block=U.p.blocks.find(row=>row.id===host.closest('.block')?.dataset.id);if(!block||block.locked)return null;settings={kind:'block',blockID:block.id,sectionID:block.sectionID};value=block.text;}
  const narrative=!host&&start.closest('#canvas .framework-narrative');if(narrative&&narrative.contains(end)){host=narrative;const sectionID=host.closest('[data-framework-section]')?.dataset.frameworkSection,unitID=host.closest('[data-framework-node]')?.dataset.frameworkNode,node=U.p.writingFrameworks?.[sectionID]?.nodes.find(row=>row.id===unitID);settings={kind:'digest',sectionID,unitID};value=node?.narrative||node?.claim;}
  const comment=!host&&start.closest('.material-comment-text');if(comment&&comment.contains(end)){host=comment;const row=host.closest('[data-highlight-id]'),material=selectedMaterial(row?.dataset.materialId);if(!material)return null;settings={kind:'comment',materialID:material.id,highlightID:row.dataset.highlightId};value=material.highlights?.find(item=>item.id===settings.highlightID)?.comment;}
  const summary=!host&&start.closest('.material-description');if(summary&&summary.contains(end)){host=summary;const material=selectedMaterial(host.closest('[data-material-id]')?.dataset.materialId);if(!material)return null;settings={kind:'summary',materialID:material.id,displayText:host.textContent};value=host.textContent;}
  const source=!host&&start.closest('.material-inline-source');if(source&&source.contains(end)){host=source;const material=selectedMaterial(source.dataset.materialId);if(!material)return null;const selectionGroup=captureMaterialSelections(source,range,source.materialTranslationContexts||[]),text=selectionGroup.map(row=>row.quote).join('\n');if(!text.trim())return null;settings={kind:'source-note',materialID:material.id,selectionGroup,displayText:text};value=text;return captureSelectionTarget(U.p,{...settings,start:0,end:text.length});}
  if(!host||typeof value!=='string')return null;const offsets=rangeTextOffsets(host,range);if(!offsets)return null;const position=modelTextOffset(value,offsets.text,offsets);if(!position)return null;return captureSelectionTarget(U.p,{...settings,...position});
 };
 const capture=event=>{
  if(event?.target.closest?.('#selection-assistant,#ai,#ai-form,input,textarea,select,button'))return;
  // Capture in the event's capture phase; highlighter preview will replace DOM
  // text nodes and clear Selection later in the same mouseup event.
  let selected;try{selected=captureFromRange(win.getSelection());}catch(error){status(error.message,true);return;}if(!selected)return;
  win.queueMicrotask(()=>{if(disposed)return;target=selected;viewMode='chat';sync();showContext();U.applyPanels?.();});
 };
 const avoidTextDrag=event=>{if(event.target.closest?.('#canvas .editable,#canvas .material-inline-source,#canvas .framework-narrative,.material-comment-text')&&!Array.from(event.dataTransfer?.types||[]).some(type=>type.startsWith('application/x-')))event.preventDefault();};
 doc.addEventListener('mouseup',capture,true);doc.addEventListener('keyup',capture,true);doc.addEventListener('dragstart',avoidTextDrag,true);
 let pointerStart;const down=event=>{if(event.button===0&&event.target.closest?.('#canvas .editable,#canvas .material-inline-source,#canvas .framework-narrative,.material-comment-text'))pointerStart={x:event.clientX,y:event.clientY};};
 const selectionClick=event=>{if(!pointerStart)return;const moved=Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>4;pointerStart=null;if(moved){event.stopPropagation();}};
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('click',selectionClick,true);
 const request=async(captured,instruction,{signal,onProgress=()=>{},modelID,thinkingLevel,executionMode,sessionID,onToolPermission}={})=>{
  assertSelectionTargetCurrent(U.p,captured);if(!U.A.previewSelection)throw Error('选区编辑服务尚未加载，请重启新版');
  if((executionMode||U.conversationSession.executionMode||'auto')!=='auto'){const ask=onToolPermission||U.requestToolPermission;if(!ask||await ask({toolName:'preview_selection_edit',label:'准备选区修改方案',description:'只读取明确选中的文字和其关联素材；采用前原文不变。',sessionID,signal})!==true)throw Error('未执行选区修改，原文保留');}
  await persist({flush:true});if(U.saveError)throw U.saveError;const incoming=await U.A.previewSelection(U.p.id,{target:captured,instruction,modelID:modelID??U.conversationSession.modelID??'',thinkingLevel:thinkingLevel??U.conversationSession.thinkingLevel??'off',signal,onProgress});if(signal?.aborted)throw Error('已停止，原文保留');assertSelectionTargetCurrent(U.p,captured);
  U.p.proposals||=[];U.p.proposals.push(incoming);U.p.proposals=U.p.proposals.slice(-80);preview=incoming;viewMode='chat';sync();renderProposal();await persist({flush:true});if(U.saveError)throw U.saveError;
  const sources=captured.sourceVersions.map(row=>selectedMaterial(row.id)).filter(Boolean).map(row=>({id:row.id,materialID:row.id,title:row.title,sourceText:row.sourceText,anchor:row.anchor}));
  return {text:incoming.variants.map(row=>'**'+row.label+'**\n'+row.text).join('\n\n')+'\n\n修改方案已在右侧列出，选择“保留更改”后应用；也可以保留原文。',sources,selectionPreviewID:incoming.id,model:incoming.model,steps:[{tool:'preview_selection_edit',label:'选区候选已准备',status:'complete'}]};
 };
 form.onsubmit=async event=>{event.preventDefault();if(busy||mutating||!input.value.trim())return;busy=true;send.disabled=true;stop.hidden=false;refreshTranscript();renderProposal();const prompt=input.value,sessionID=draftSessionID;try{await flushDraft();await U.sendResearchMessage(prompt,{sessionID,fromComposer:true,onProgress:value=>{scope.textContent=value;}});if(U.conversationSession?.id===sessionID)input.value='';delete U.p.ui.selectionAssistantDraft;await persist();}catch(error){status(error.message,true);}finally{busy=false;send.disabled=false;stop.hidden=true;scope.textContent=U.conversationSession?.modelID||'GPT-6 Luna';refreshTranscript();renderProposal();}};
 input.oninput=()=>{clearTimeout(draftTimer);pendingDraft={sessionID:draftSessionID,text:input.value};draftTimer=setTimeout(()=>{void flushDraft().catch(error=>status(error.message,true));},240);};input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();form.requestSubmit();}};
 const subscription={summary:true,sessionID:()=>U.conversationSession?.id};let updateTimer;
 const unsubscribe=U.conversations.subscribe(()=>{win.clearTimeout(updateTimer);updateTimer=win.setTimeout(()=>{syncDraft();refreshTranscript();sync();},0);},subscription);
 U.selectionAssistant={sync,captureForPrompt:prompt=>{if(!target||!editIntent(prompt))return null;assertSelectionTargetCurrent(U.p,target);return U.M.clone(target);},request,show:()=>setView('chat'),setTarget:value=>{target=value;viewMode='chat';sync();showContext();},getTarget:()=>target};
 preview=[...(U.p.proposals||[])].reverse().find(row=>row.kind==='assembly-selection-preview')||null;sync();showContext();refreshTranscript();renderProposal();
 return ()=>{disposed=true;void flushDraft().catch(error=>status(error.message,true));clearTimeout(updateTimer);unsubscribe();for(const dispose of messageDisposers)dispose();doc.removeEventListener('mouseup',capture,true);doc.removeEventListener('keyup',capture,true);doc.removeEventListener('dragstart',avoidTextDrag,true);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('click',selectionClick,true);root.remove();style.remove();right.classList.remove('has-selection-assistant');delete doc.body.dataset.writingAssistant;delete U.selectionAssistant;};
}
