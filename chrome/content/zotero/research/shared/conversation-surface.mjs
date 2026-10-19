/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {WORKBENCH_MODES} from './agent-workbench.mjs';
import {installMediaPreview,disposeMediaPreviews} from './media-preview.mjs';
import {citedSources,answerWithQuestion} from './chat-evidence.mjs';
import {installMessageDrag} from './message-transfer.mjs';
import {installConversationInteractions} from './conversation-interactions.mjs';
import {createCLUIChatSurface,CLUI_LAYOUT,cluiVisibleMessages} from './clui-surface.mjs';
const HTML='http://www.w3.org/1999/xhtml',SVG='http://www.w3.org/2000/svg';
const clamp=(value,low,high)=>Math.max(low,Math.min(value,Math.max(low,high)));
const ICONS={
 auto:['M12 3v4m0 10v4M3 12h4m10 0h4','m7 7 10 10M7 17 17 7','m12 7 5 5-5 5-5-5Z'],
 search:['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15','m16 16 5 5'],
 evaluate:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','m8 12 3 3 5-6'],
 organize:['M3 7V5h7l2 2h9v13H3Z','M3 10h18'],
 layout:['M8 4H4v16h4M12 6h8m-8 6h8m-8 6h8'],
 chevron:['m8 10 4 4 4-4'],close:['m6 6 12 12M6 18 18 6'],
 pin:['m9 3 6 0-1 6 4 4H6l4-4Z','M12 13v8'],grip:['M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01'],
 chat:['M4 4h16v12H9l-5 4Z'],plus:['M12 5v14M5 12h14'],
 model:['m12 3 9 5v8l-9 5-9-5V8Z','m3 8 9 5 9-5M12 13v8'],
 strength:['M12 3v18M5 7h14M5 17h14','M8 4v6M16 14v6'],
 send:['M12 19V5m-6 6 6-6 6 6'],stop:['M6 6h12v12H6Z'],
 file:['M5 3h9l5 5v13H5Z','M14 3v6h5'],image:['M3 4h18v16H3Z','m3 16 6-6 4 4 3-3 5 5','M15 7h.01'],
 check:['m5 12 4 4 10-10'],shield:['m12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6Z','m8 12 3 3 5-6'],inherit:['M5 8h10a5 5 0 0 1 0 10h-3','m9 4-4 4 4 4']
};
function icon(doc,name){const svg=doc.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');for(const d of ICONS[name]||ICONS.chat){const path=doc.createElementNS(SVG,'path');path.setAttribute('d',d);svg.append(path);}return svg;}
function button(doc,text,title,kind){const value=doc.createElementNS(HTML,'button');value.type='button';value.title=title||text;value.setAttribute('aria-label',value.title);if(kind)value.append(icon(doc,kind));if(text){const label=doc.createElementNS(HTML,'span');label.className='conversation-control-label';label.textContent=text;value.append(label);}return value;}
const taskIcon=id=>ICONS[id]?id:'auto';

// Shared UI only. Attachments, conversations and saved annotations stay in the
// existing services; opening, moving or fading the panel never requests an AI.
export function installConversationSurface({doc,orb,dockTargets=()=>[],state={},onState=()=>{},
 renderContent,onSend,onSave,onSource,onDragMessage,onSelectSession,getModels=()=>[],onError=()=>{},
 onAttach,getAttachments=session=>session?.attachments||[],onRemoveAttachment,onDragAttachment,
 presentation='floating',getWorkArea=()=>null}){
 const win=doc.defaultView,node=(tag,cls,parent)=>{const value=doc.createElementNS(HTML,tag);value.className=cls||'';parent?.append(value);return value;};
 if(!doc.querySelector('[data-easysch-conversation-style]')){const style=node('link');style.rel='stylesheet';style.href='chrome://zotero/content/research/shared/conversation-surface.css';style.dataset.easyschConversationStyle='true';(doc.head||doc.documentElement).append(style);}
 const clui=createCLUIChatSurface({doc,label:'研究助手'}),root=clui.root,header=clui.tabs,log=clui.scroll,footer=clui.pill;
 root.classList.add('conversation-surface');header.classList.add('conversation-surface-header');log.classList.add('conversation-surface-log');footer.classList.add('conversation-surface-footer');clui.inputRow.classList.add('conversation-surface-input-row');
 root.dataset.presentation=presentation;
 root.id='easysch-conversation-surface';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','false');
 const tabs=node('div','conversation-surface-tabs',header);tabs.setAttribute('role','tablist');tabs.dataset.cluiIgnoreExpand='true';
 const original=button(doc,'原内容','显示原来的侧栏内容'),ai=button(doc,'AI','显示研究对话');original.setAttribute('role','tab');ai.setAttribute('role','tab');tabs.append(original,ai);
 const title=button(doc,'研究助手','展开研究对话','chat');title.className='conversation-surface-title';title.dataset.cluiToggle='true';title.setAttribute('aria-expanded','false');header.append(title);
 const choices=button(doc,'研究对话','切换或新建研究对话','chat');choices.className='conversation-surface-sessions';choices.setAttribute('aria-haspopup','menu');choices.setAttribute('aria-expanded','false');choices.append(icon(doc,'chevron'));header.append(choices);
 const collapse=button(doc,'','收起为输入栏','chevron');collapse.className='conversation-surface-collapse';collapse.dataset.cluiCollapse='true';header.append(collapse);
 const close=button(doc,'','关闭对话，恢复原栏','close');close.className='conversation-surface-close';close.dataset.cluiIgnoreExpand='true';header.append(close);
 const sessionMenu=node('div','conversation-surface-session-menu',root);sessionMenu.hidden=true;sessionMenu.setAttribute('role','menu');sessionMenu.setAttribute('aria-label','研究对话');
 log.setAttribute('role','log');log.setAttribute('aria-label','研究对话消息');
 const empty=node('div','conversation-surface-empty',log);empty.append(icon(doc,'chat'));const emptyText=node('span','',empty);emptyText.textContent='讨论当前论文，或拖入资料作为依据';
 const status=node('div','conversation-surface-status',footer);status.setAttribute('role','status');status.hidden=true;
 const attachmentList=node('div','conversation-surface-attachments',footer);attachmentList.hidden=true;attachmentList.setAttribute('aria-label','本次对话资料');
 const composer=node('div','conversation-surface-composer',footer),input=node('textarea','conversation-surface-input',composer);input.rows=1;input.placeholder='讨论研究、查找证据或整理资料…';input.setAttribute('aria-label','研究问题');
 const toolbar=node('div','conversation-surface-toolbar',composer);
 const moveButton=button(doc,'','拖到左侧或右侧，收为对话图标','grip');moveButton.className='conversation-surface-move';moveButton.dataset.conversationMove='true';moveButton.hidden=presentation!=='reader-bottom';toolbar.append(moveButton);
 const actionStack=node('div','clui-native-btn-stack conversation-surface-action-stack',toolbar);
 const attachButton=button(doc,'','添加论文、表格、图片或已有素材','plus');attachButton.className='conversation-surface-attach clui-native-stack-btn clui-native-stack-btn-1 clui-native-glass';attachButton.hidden=!onAttach;actionStack.append(attachButton);
 const fileInput=node('input','',footer);fileInput.type='file';fileInput.multiple=true;fileInput.accept='.pdf,.docx,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp';fileInput.hidden=true;
 const modeButton=button(doc,'自动','选择研究任务 · 在输入框按 Tab 切换','auto');modeButton.className='conversation-surface-mode';modeButton.setAttribute('aria-haspopup','menu');modeButton.setAttribute('aria-expanded','false');modeButton.append(icon(doc,'chevron'));toolbar.append(modeButton);
 const executionButton=button(doc,'Auto','应用操作权限：执行本轮明确要求的操作','shield');executionButton.className='conversation-surface-execution clui-native-stack-btn clui-native-stack-btn-2 clui-native-glass';actionStack.append(executionButton);
 const preferences=node('div','conversation-surface-preferences',toolbar);
 const modelButton=button(doc,'模型','选择已配置模型','model');modelButton.className='conversation-surface-model-button';modelButton.setAttribute('aria-haspopup','menu');modelButton.setAttribute('aria-expanded','false');preferences.append(modelButton);
 const strengthButton=button(doc,'标准','调整思考强度','strength');strengthButton.className='conversation-surface-strength-button clui-native-stack-btn clui-native-stack-btn-3 clui-native-glass';strengthButton.setAttribute('aria-haspopup','menu');strengthButton.setAttribute('aria-expanded','false');actionStack.append(strengthButton);
 const pin=button(doc,'','固定对话，不自动收起','pin');pin.className='conversation-surface-pin';pin.dataset.cluiIgnoreExpand='true';pin.setAttribute('aria-pressed','false');toolbar.append(pin);
 const send=button(doc,'','发送研究问题 · Enter','send');send.type='submit';send.className='conversation-surface-send';send.dataset.cluiIgnoreExpand='true';toolbar.append(send);
 const modeMenu=node('div','conversation-surface-mode-menu conversation-surface-controls',footer);modeMenu.hidden=true;modeMenu.setAttribute('role','menu');modeMenu.setAttribute('aria-label','研究任务');
 const more=node('div','conversation-surface-more-menu conversation-surface-controls',footer);more.hidden=true;more.setAttribute('role','menu');more.setAttribute('aria-label','模型与思考强度');
 const modelOptions=node('div','conversation-surface-model-options',more),strengthOptions=node('div','conversation-surface-strength-options',more);
 const executionMenu=node('div','conversation-surface-execution-menu conversation-surface-controls',footer);executionMenu.hidden=true;executionMenu.setAttribute('role','menu');executionMenu.setAttribute('aria-label','应用操作权限');
 const modelStatus=node('span','conversation-surface-model-status',modelOptions);modelStatus.textContent='正在读取已配置模型…';modelStatus.setAttribute('role','status');
 const strengths=[['off','标准'],['low','轻量'],['medium','深入'],['high','充分']];
 const measure=node('div','conversation-surface-measure',root);measure.setAttribute('aria-hidden','true');
 const resize=node('div','conversation-surface-resize',root);resize.setAttribute('role','separator');resize.setAttribute('aria-label','调整对话高度');resize.tabIndex=0;
 const dropHint=node('div','conversation-surface-drop-hint',root);dropHint.textContent='松开，添加到当前对话';dropHint.setAttribute('aria-hidden','true');
 const highlight=node('div','conversation-surface-dock-target');highlight.hidden=true;
 // CLUI's PopoverLayer: all menus share a document-level layer, outside both
 // the glass pill's stacking context and the transcript's overflow boundary.
 const preferencePopover=node('section','conversation-preferences-popover');preferencePopover.id='easysch-conversation-preferences';preferencePopover.dataset.cluiOwner=root.id;preferencePopover.dataset.cluiIgnoreExpand='true';preferencePopover.hidden=true;preferencePopover.setAttribute('role','menu');preferencePopover.setAttribute('aria-label','研究对话选项');doc.documentElement.append(root,highlight,preferencePopover);
 let disposed=false,visible=false,busy=false,session=null,drag=null,docked=null,restoreDock=state.dock,panePrevious=null,embedded=null,locked=false,
  geometry={x:state.x,y:state.y,width:state.width||CLUI_LAYOUT.contentWidth,height:state.height||420},tab=state.tab||'ai',hideTimer,draftTimer,pendingDraft,composing=false,lastRender='',lastPreferences='',lastSessions='',lastAttachments='',modelRequest=null,modelValues=[],modelsLoaded=false,positionFrame=null,dragFrame=null,inputFrame=null,inputWidth=0,latestDragPoint=null,attachments=[],attachBusy=false,renderOffset=0,messageDragOffs=[];
 const outsideDocuments=new Set(),placementLeases=[];let preferenceAnchor=null,preferenceReturnFocus=null,idleTimer=null,iconDock=state.iconDock||null,bottomBounds=null;
 const interactions=installConversationInteractions({doc,host:log,renderContent,onSource,onError,onOpen:()=>{if(!visible)show();setExpanded(true);clui.afterRender(true);wake();}});
 const label=(control,text)=>{control.querySelector('.conversation-control-label').textContent=text;};
 const emitState=(extra={})=>{root.dataset.iconDock=iconDock||'';if(orb){const hidden=visible&&!!(docked||embedded||presentation==='reader-bottom');orb.hidden=hidden;orb.dataset.conversationDocked=String(hidden);orb.setAttribute('aria-expanded',String(visible));}root.dispatchEvent(new win.CustomEvent('easysch-conversation-statechange',{bubbles:true,composed:true,detail:{open:visible,dock:docked?.id||null,iconDock,embedded:!!embedded,locked,tab,size:root.dataset.cluiSize,pinned:root.dataset.pinned==='true',unfocused:root.dataset.unfocused==='true',...extra}}));};
 // Both reader and assembly place their Logo outside this surface. Notify the
 // owning document during movement, without persisting a preference per frame.
 const moveOrb=(phase,point={x:geometry.x+(drag?.width||geometry.width)-44,y:geometry.y+8})=>emitState({orbPosition:point,movement:phase,persistOrb:phase!=='move'});
 const queueIdle=()=>{win.clearTimeout(idleTimer);if(presentation!=='reader-bottom'||!visible||docked||embedded||busy||root.dataset.expanded==='true'||root.dataset.pinned==='true'||root.contains(doc.activeElement)||input.value.trim()||!preferencePopover.hidden)return;idleTimer=win.setTimeout(()=>{if(!disposed&&!root.matches(':hover')&&!root.contains(doc.activeElement)&&root.dataset.expanded!=='true'){root.dataset.idle='true';}},1800);};
 const wake=()=>{win.clearTimeout(idleTimer);root.dataset.idle='false';root.dataset.dimmed='false';if(root.dataset.unfocused==='true'){root.dataset.unfocused='false';emitState();}};
 const syncCLUI=()=>{title.setAttribute('aria-expanded',String(root.dataset.expanded==='true'));collapse.hidden=root.dataset.expanded!=='true';pin.setAttribute('aria-pressed',root.dataset.pinned||'false');pin.title=root.dataset.pinned==='true'?'取消固定对话':'固定对话，不自动收起';root.dataset.unfocused=root.dataset.dimmed||'false';position();emitState();};
 const setExpanded=(value,options={})=>{clui.setExpanded(value,options);syncCLUI();if(value)clui.afterRender();else queueIdle();};
 const setPinned=value=>{clui.setPinned(value);syncCLUI();};
 title.onclick=()=>setExpanded(root.dataset.expanded!=='true');collapse.onclick=()=>setExpanded(false);pin.onclick=()=>setPinned(root.dataset.pinned!=='true');
 const closeAnchoredPreferences=()=>{preferencePopover.hidden=true;for(const menu of [more,modeMenu,executionMenu,sessionMenu])if(menu.parentElement===preferencePopover)(menu===sessionMenu?root:footer).append(menu);preferenceAnchor?.setAttribute('aria-expanded','false');preferenceAnchor=null;};
 const hideControls=()=>{modeMenu.hidden=more.hidden=executionMenu.hidden=sessionMenu.hidden=true;closeAnchoredPreferences();for(const control of [modeButton,modelButton,strengthButton,executionButton,choices])control.setAttribute('aria-expanded','false');};
 const focusPreferencesInput=()=>{const target=preferenceReturnFocus?.isConnected?preferenceReturnFocus:input;target.focus({preventScroll:true});};
 const positionAnchoredPreferences=()=>{if(!preferenceAnchor||preferencePopover.hidden)return;if(!preferenceAnchor.isConnected){hideControls();return;}const rect=preferenceAnchor.getBoundingClientRect(),width=Math.min(330,win.innerWidth-16);preferencePopover.style.width=width+'px';const above=rect.top-16,below=win.innerHeight-rect.bottom-16;preferencePopover.style.maxHeight=Math.max(80,Math.max(above,below))+'px';const height=preferencePopover.offsetHeight;preferencePopover.style.left=clamp(rect.right-width,8,win.innerWidth-width-8)+'px';preferencePopover.style.top=clamp(above>=height||above>=below?rect.top-height-8:rect.bottom+8,8,win.innerHeight-height-8)+'px';};
 const showMenu=(menu,anchor,{focus=true}={})=>{hideControls();wake();preferenceAnchor=anchor;preferenceReturnFocus=anchor.closest('form')?.querySelector('textarea')||anchor;anchor.setAttribute('aria-haspopup','menu');anchor.setAttribute('aria-controls',preferencePopover.id);anchor.setAttribute('aria-expanded','true');preferencePopover.append(menu);menu.hidden=false;preferencePopover.hidden=false;positionAnchoredPreferences();if(focus)[...menu.querySelectorAll('button')].find(control=>!control.disabled&&!control.closest('[hidden]'))?.focus({preventScroll:true});};
 const syncPreferences=()=>{
  const signature=JSON.stringify([session?.mode,session?.modelID,session?.thinkingLevel,session?.executionMode,modelValues.map(item=>[item.id,item.label])]);if(signature===lastPreferences)return;lastPreferences=signature;
  const task=WORKBENCH_MODES.find(item=>item.id===session?.mode)||WORKBENCH_MODES[0];label(modeButton,task.label);const old=modeButton.querySelector('svg');old.replaceWith(icon(doc,taskIcon(task.id)));modeButton.title=task.hint+' · Tab 切换';
  for(const control of modeMenu.children)control.setAttribute('aria-checked',String(control.dataset.mode===task.id));
  const selectedModel=modelValues.find(item=>item.id===session?.modelID)||modelValues[0];label(modelButton,selectedModel?.label||session?.modelID||'模型');modelButton.title='模型：'+(selectedModel?.label||session?.modelID||'选择已配置模型');
  const level=session?.thinkingLevel||'off';label(strengthButton,strengths.find(item=>item[0]===level)?.[1]||'标准');strengthButton.title='思考强度：'+(strengths.find(item=>item[0]===level)?.[1]||'标准');
  for(const control of modelOptions.querySelectorAll('[data-model]'))control.setAttribute('aria-checked',String(control.dataset.model===(session?.modelID||modelValues[0]?.id)));
  for(const control of strengthOptions.children)control.setAttribute('aria-checked',String(control.dataset.strength===level));
  const ask=session?.executionMode==='ask';label(executionButton,ask?'询问':'Auto');executionButton.setAttribute('aria-pressed',String(ask));executionButton.title=ask?'应用操作权限：写入前询问，读取资料直接执行':'应用操作权限：执行本轮明确要求的操作';
 };
 const savePreferences=patch=>{if(!session)return;session={...session,...patch};syncPreferences();onState({sessionID:session.id,mode:session.mode||'auto',modelID:session.modelID||modelValues[0]?.id||'',thinkingLevel:session.thinkingLevel||'off',executionMode:session.executionMode||'auto'});};
 for(const [id,text,hint]of [['auto','Auto','执行本轮明确要求的操作'],['ask','询问','写入前询问，读取资料直接执行']]){const control=button(doc,text+' · '+hint,hint,'shield');control.dataset.execution=id;control.setAttribute('role','menuitemradio');control.onclick=()=>{savePreferences({executionMode:id});hideControls();input.focus({preventScroll:true});};executionMenu.append(control);}
 executionButton.onclick=()=>{const open=executionMenu.hidden;hideControls();if(open){for(const control of executionMenu.children)control.setAttribute('aria-checked',String(control.dataset.execution===(session?.executionMode||'auto')));showMenu(executionMenu,executionButton);}};
 for(const task of WORKBENCH_MODES){const control=button(doc,task.label,task.hint,taskIcon(task.id));control.dataset.mode=task.id;control.setAttribute('role','menuitemradio');control.setAttribute('aria-checked','false');control.onclick=()=>{savePreferences({mode:task.id});hideControls();input.focus({preventScroll:true});};modeMenu.append(control);}
 for(const [id,text]of strengths){const control=button(doc,text,'思考强度：'+text);control.dataset.strength=id;control.setAttribute('role','menuitemradio');control.onclick=()=>{savePreferences({thinkingLevel:id});hideControls();focusPreferencesInput();};strengthOptions.append(control);}
 const showModes=()=>{syncPreferences();showMenu(modeMenu,modeButton);};
 const loadModels=()=>{
  if(modelsLoaded)return Promise.resolve();if(modelRequest)return modelRequest;
  modelRequest=Promise.resolve().then(getModels).then(values=>{if(disposed)return;modelValues=[...new Map((values||[]).filter(item=>item.id||item.model).map(item=>[item.id||item.model,{...item,id:item.id||item.model}])).values()];modelOptions.replaceChildren();for(const item of modelValues){const control=button(doc,item.label||item.id,item.label||item.id,'model');control.dataset.model=item.id;control.setAttribute('role','menuitemradio');control.onclick=()=>{savePreferences({modelID:item.id});hideControls();focusPreferencesInput();};modelOptions.append(control);}modelsLoaded=true;if(!modelValues.length){modelStatus.textContent='请先在设置中配置模型';modelOptions.append(modelStatus);}syncPreferences();positionAnchoredPreferences();}).catch(error=>{modelStatus.textContent=error.message||'读取模型失败，再次点击可重试';modelOptions.replaceChildren(modelStatus);positionAnchoredPreferences();}).finally(()=>{modelRequest=null;});return modelRequest;
 };
 const showAnchoredPreferences=(kind,anchor)=>{if(disposed||!anchor?.isConnected)return;if(preferenceAnchor===anchor&&!preferencePopover.hidden){hideControls();return;}more.dataset.kind=kind;modelOptions.hidden=kind==='strength';strengthOptions.hidden=kind==='model';syncPreferences();showMenu(more,anchor,{focus:kind==='strength'});if(kind!=='strength')loadModels().then(()=>{if(preferenceAnchor===anchor&&!preferencePopover.hidden){positionAnchoredPreferences();more.querySelector('button')?.focus({preventScroll:true});}});};
 const showPreferences=kind=>showAnchoredPreferences(kind,kind==='model'?modelButton:strengthButton);
 modeButton.onclick=()=>modeMenu.hidden?showModes():hideControls();modelButton.onclick=()=>showPreferences('model');strengthButton.onclick=()=>showPreferences('strength');
 const flushDraft=()=>{win.clearTimeout(draftTimer);draftTimer=null;if(pendingDraft){const value=pendingDraft;pendingDraft=null;onState(value);}};
 const setStatus=text=>{status.textContent=text||'';status.hidden=!text;};
 const attach=async(payload,source)=>{if(!onAttach||!session||attachBusy)return;const id=session.id;attachBusy=true;root.dataset.attaching='true';try{const result=await onAttach(payload,{sessionID:id,source});if(session?.id===id&&Array.isArray(result))renderAttachments(result);setStatus('');}catch(error){setStatus(error.message||'资料添加失败');onError(error);}finally{attachBusy=false;delete root.dataset.attaching;}};
 attachButton.onclick=()=>fileInput.click();fileInput.onchange=()=>{if(fileInput.files?.length)attach({files:Array.from(fileInput.files)},'picker');fileInput.value='';};
 const renderAttachments=items=>{
  attachments=Array.isArray(items)?items:[];const signature=JSON.stringify([session?.id,attachments]);if(signature===lastAttachments)return;lastAttachments=signature;attachmentList.replaceChildren();attachmentList.hidden=!attachments.length;
  for(const item of attachments){const card=node('div','conversation-surface-attachment',attachmentList);card.dataset.attachmentId=item.id;card.title=item.title||item.name||'对话资料';card.draggable=false;
   if(onDragAttachment){const grip=button(doc,'','拖动这份资料','grip');grip.className='conversation-surface-attachment-grip';grip.draggable=true;grip.dataset.cluiIgnoreExpand='true';card.append(grip);grip.ondragstart=event=>{onDragAttachment(item,event);if(event.defaultPrevented)return;card.dataset.dragging='true';event.stopPropagation();};grip.ondragend=()=>delete card.dataset.dragging;}
   card.append(icon(doc,/image|图片/i.test(item.kind||item.type||'')?'image':'file'));const name=node('span','conversation-surface-attachment-name',card);name.textContent=item.title||item.name||'对话资料';
   if(onRemoveAttachment){const remove=button(doc,'','从本次对话移除，不删除源文件','close');remove.className='conversation-surface-attachment-remove';remove.onclick=async()=>{const id=session.id;remove.disabled=true;try{const result=await onRemoveAttachment(item.id,{sessionID:id});if(session?.id===id&&Array.isArray(result))renderAttachments(result);}catch(error){setStatus(error.message);onError(error);}finally{remove.disabled=false;}};card.append(remove);}
  }
 };
 const attachmentMimes=['Files','application/x-easysch-material','application/x-manuscript-material','application/x-easysch-chat-attachment','text/x-zotero-item','zotero/item'];
 const acceptsDrop=event=>onAttach&&!event.dataTransfer?.types?.includes('application/x-easysch-research-message')&&attachmentMimes.some(type=>event.dataTransfer?.types?.includes(type));
 root.addEventListener('dragover',event=>{if(!acceptsDrop(event)){delete root.dataset.attachmentDrop;return;}event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';root.dataset.attachmentDrop='true';});
 root.addEventListener('dragleave',event=>{if(!root.contains(event.relatedTarget))delete root.dataset.attachmentDrop;});
 root.addEventListener('drop',event=>{delete root.dataset.attachmentDrop;if(!acceptsDrop(event))return;event.preventDefault();event.stopPropagation();const data=event.dataTransfer,payload={files:Array.from(data.files||[]),items:[],materialIDs:[]};
  for(const mime of ['application/x-easysch-material','application/x-manuscript-material']){const raw=data.getData(mime);if(!raw)continue;let value;try{value=JSON.parse(raw);}catch(_){value=raw;}for(const item of Array.isArray(value)?value:[value]){if(typeof item==='string'||typeof item==='number')payload.materialIDs.push(String(item));else if(item?.id)payload.materialIDs.push(String(item.id));}}
  const zotero=data.getData('text/x-zotero-item')||data.getData('zotero/item');if(zotero){let values;try{values=JSON.parse(zotero);}catch(_){values=zotero.split(/[\s,]+/).filter(Boolean);}payload.items=(Array.isArray(values)?values:[values]).map(value=>typeof value==='object'?value:{id:Number(value)}).filter(item=>Number.isInteger(item.id)&&item.id>0);}
  const linked=data.getData('application/x-easysch-chat-attachment');if(linked)try{const value=JSON.parse(linked);if(value?.sessionID&&value?.attachmentID)payload.items.push(value);}catch(_){/* Invalid external payload is ignored. */}attach(payload,'drop');
 });
 const targets=()=>typeof dockTargets==='function'?dockTargets():dockTargets;
 const rectFor=target=>target.getRect?.()||target.element?.getBoundingClientRect();
 const paneRect=target=>{const cached=drag?.targetRects?.get(target.id);if(cached)return cached;const rect=rectFor(target);if(rect?.width>10&&rect.height>10)return rect;const width=Math.min(300,win.innerWidth*.32);return {left:target.id==='left'?0:win.innerWidth-width,right:target.id==='left'?width:win.innerWidth,top:48,bottom:win.innerHeight-42,width,height:Math.max(1,win.innerHeight-90)};};
 // Evidence and focused reader modes borrow this same component. Their local
 // geometry must never overwrite the user's floating/docked preferences.
 const save=()=>{if(!placementLeases.length)onState({...geometry,dock:docked?.id||null,iconDock,tab,open:visible});};
 // The reader's right pane is a XUL box: assigning an `inert` expando does
 // not stop its focus or keyboard handlers. Scope the fallback to this pane,
 // including its nested editors, while the sibling AI surface stays usable.
 const paneEvents=['pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu','keydown','keypress','keyup','beforeinput','focusin'];
 const deadDOM=value=>typeof Components!=='undefined'&&Components.utils.isDeadWrapper?.(value);
 const withLiveDOM=(value,operation)=>{if(deadDOM(value))return;try{return operation();}catch(error){if(deadDOM(value)||error?.message==="can't access dead object")return;throw error;}};
 const restorePaneStyle=(element,name,value,priority)=>{if(value)element.style.setProperty(name,value,priority);else element.style.removeProperty(name);};
 const restorePaneInteraction=previous=>{
  const {element}=previous;if(previous.nativeInert)element.inert=previous.inert;
  if(previous.inertAttribute===null)element.removeAttribute('inert');else element.setAttribute('inert',previous.inertAttribute);
  restorePaneStyle(element,'pointer-events',previous.pointerEvents,previous.pointerPriority);
  restorePaneStyle(element,'visibility',previous.visibility,previous.visibilityPriority);
 };
 const paneDocuments=previous=>{
  const watch=(value,nested=false)=>{if(!value||previous.documents.has(value))return;previous.documents.add(value);
   const guard=event=>{
    if(panePrevious!==previous||!previous.blocked)return;
    const inside=nested||previous.element.contains(event.target)||event.composedPath?.().some(value=>value===previous.element);
    if(!inside)return;event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='focusin'&&visible&&tab==='ai')input.focus({preventScroll:true});
   };
   const loaded=event=>{if(!['iframe','browser'].includes(event.target?.localName))return;if(!nested&&!previous.element.contains(event.target))return;try{watch(event.target.contentDocument,true);}catch(_){}};
   for(const type of paneEvents)value.addEventListener(type,guard,true);value.addEventListener('load',loaded,true);
   previous.cleanup.push(()=>withLiveDOM(value,()=>{for(const type of paneEvents)value.removeEventListener(type,guard,true);value.removeEventListener('load',loaded,true);}));
   const parent=nested?value:previous.element;for(const frame of parent.querySelectorAll('iframe,browser'))try{watch(frame.contentDocument,true);}catch(_){}
  };watch(previous.element.ownerDocument);
 };
 const setPaneInteraction=blocked=>{
  const previous=panePrevious;if(!previous)return;previous.blocked=blocked;
  if(blocked){if(previous.nativeInert)previous.element.inert=true;else previous.element.setAttribute('inert','');previous.element.style.setProperty('pointer-events','none','important');previous.element.style.setProperty('visibility','hidden','important');paneDocuments(previous);}
  else restorePaneInteraction(previous);
 };
 const restorePane=()=>{
  if(!panePrevious)return;const previous=panePrevious;panePrevious=null;previous.blocked=false;let failure;
  // Saving a note replaces its editor iframe. Dead documents have no remaining
  // listeners to remove; still release every live pane guard and restore state.
  const cleanup=[()=>withLiveDOM(previous.element,()=>restorePaneInteraction(previous)),()=>withLiveDOM(previous.element,()=>restorePaneStyle(previous.element,'padding-top',previous.padding,previous.paddingPriority)),...previous.cleanup];
  for(const operation of cleanup)try{operation();}catch(error){failure||=error;}if(failure)throw failure;
 };
 const reservePane=()=>{if(!docked?.element||panePrevious)return;const element=docked.element;panePrevious={element,nativeInert:typeof element.inert==='boolean',inert:element.inert,inertAttribute:element.getAttribute('inert'),padding:element.style.getPropertyValue('padding-top'),paddingPriority:element.style.getPropertyPriority('padding-top'),pointerEvents:element.style.getPropertyValue('pointer-events'),pointerPriority:element.style.getPropertyPriority('pointer-events'),visibility:element.style.getPropertyValue('visibility'),visibilityPriority:element.style.getPropertyPriority('visibility'),blocked:false,documents:new Set(),cleanup:[]};element.style.paddingTop=(parseFloat(win.getComputedStyle(element).paddingTop)||0)+43+'px';};
 const position=()=>{
  if(disposed||!visible||drag)return;const bounds=docked?paneRect(docked):null,expanded=root.dataset.expanded==='true',detail=root.dataset.cluiSize==='detail';
  if(embedded){restorePane();root.style.left='0';root.style.top='0';root.style.width='100%';root.style.height='100%';}
  else if(bounds){if(expanded||tab==='original')reservePane();else restorePane();setPaneInteraction(tab==='ai'&&expanded);root.style.left=bounds.left+'px';root.style.top=bounds.top+'px';root.style.width=bounds.width+'px';root.style.height=(tab==='original'?43:expanded?bounds.height:'auto')+(tab==='original'||expanded?'px':'');}
  else{restorePane();geometry.width=clamp(Number(geometry.width)||CLUI_LAYOUT.contentWidth,Math.min(300,win.innerWidth-16),win.innerWidth-16);geometry.height=clamp(Number(geometry.height)||420,Math.min(220,win.innerHeight-16),win.innerHeight-16);let width=detail?Math.min(Math.max(CLUI_LAYOUT.expandedContentWidth,geometry.width),win.innerWidth-16):geometry.width,height=expanded?(detail?Math.min(Math.max(geometry.height,640),win.innerHeight-16):geometry.height):Math.min(root.getBoundingClientRect().height||142,win.innerHeight-16);
   if(presentation==='reader-bottom'&&!drag){const work=getWorkArea()||{left:0,top:48,right:win.innerWidth,bottom:win.innerHeight};bottomBounds=work;width=Math.max(180,Math.min(detail?980:700,work.right-work.left-24));height=Math.min(height,work.bottom-work.top-24);geometry.x=work.left+(work.right-work.left-width)/2;geometry.y=work.bottom-height-12;}
   geometry.x=clamp(Number(geometry.x)||0,8,win.innerWidth-width-8);geometry.y=clamp(Number(geometry.y)||0,8,win.innerHeight-height-8);root.style.left=geometry.x+'px';root.style.top=geometry.y+'px';root.style.width=width+'px';root.style.height=expanded?height+'px':'auto';}
  root.dataset.dock=embedded?'embedded':docked?.id||'floating';root.dataset.tab=tab;root.dataset.embedded=String(!!embedded);root.dataset.locked=String(locked);tabs.hidden=!docked||locked;close.hidden=locked;original.querySelector('span').textContent=docked?.label||'原内容';original.setAttribute('aria-selected',String(tab==='original'));ai.setAttribute('aria-selected',String(tab==='ai'));resize.hidden=!!docked||!!embedded||locked||tab!=='ai'||!expanded;
 };
 const pickTarget=(x,y)=>targets().find(target=>{const rect=paneRect(target);return y>=rect.top&&y<=rect.bottom&&(x>=rect.left&&x<=rect.right||target.id==='left'&&x<60||target.id==='right'&&x>win.innerWidth-60);});
 const clearHighlight=()=>{highlight.hidden=true;delete root.dataset.dropTarget;};
 const previewDock=(x,y)=>{const target=pickTarget(x,y);if(!target){clearHighlight();return null;}const rect=paneRect(target);highlight.style.left=rect.left+3+'px';highlight.style.top=rect.top+3+'px';highlight.style.width=Math.max(1,rect.width-6)+'px';highlight.style.height=Math.max(1,rect.height-6)+'px';highlight.textContent='放开后在'+(target.label||'侧栏')+'显示 AI';highlight.hidden=false;root.dataset.dropTarget=target.id;return target.id;};
 const dock=id=>{if(locked)return false;const target=targets().find(target=>target.id===id);if(!target)return false;iconDock=null;restorePane();docked=target;target.ensureOpen?.();tab='ai';visible=true;root.hidden=false;root.dataset.open='true';wake();setExpanded(true);position();save();clearHighlight();emitState();return true;};
 const dockAt=(x,y)=>{const target=pickTarget(x,y);clearHighlight();return target?dock(target.id):false;};
 const anchor=()=>{const rect=orb?.getBoundingClientRect()||{left:win.innerWidth-52,right:win.innerWidth-12,top:win.innerHeight-70},width=clamp(Number(geometry.width)||CLUI_LAYOUT.contentWidth,Math.min(300,win.innerWidth-16),win.innerWidth-16);geometry.x=rect.right+width+16<win.innerWidth?rect.right+10:rect.left-width-10;geometry.y=rect.top-Math.min(120,geometry.height*.3);};
 const outsideClick=event=>{if(!visible||locked||drag||root.contains(event.target)||preferencePopover.contains(event.target)||preferenceAnchor?.contains(event.target)||orb?.contains(event.target)||event.button&&event.button!==0)return;if(event.target.closest?.('.easysch-ai-pdf-drop-hint,[data-easysch-ignore-chat-dismiss]'))return;hideControls();root.dataset.unfocused='true';root.dataset.dimmed='true';emitState();};
 const outsideDoubleClick=event=>{if(!visible||locked||drag||root.dataset.pinned==='true'||root.contains(event.target)||preferencePopover.contains(event.target)||preferenceAnchor?.contains(event.target)||orb?.contains(event.target))return;if(event.target.closest?.('.easysch-ai-pdf-drop-hint,[data-easysch-ignore-chat-dismiss]'))return;hideControls();setExpanded(false);};
 const watchDocument=value=>{if(!value||outsideDocuments.has(value))return;outsideDocuments.add(value);value.addEventListener('click',outsideClick,true);value.addEventListener('dblclick',outsideDoubleClick,true);for(const iframe of value.querySelectorAll('iframe'))try{watchDocument(iframe.contentDocument);}catch(_){/* Cross-origin pages cannot be observed. */}};
 const scanDocuments=()=>watchDocument(doc);
 const iframeLoaded=event=>{if(event.target.localName==='iframe')try{watchDocument(event.target.contentDocument);}catch(_){}};doc.addEventListener('load',iframeLoaded,true);
 const show=({nearLogo=false,restore=false,focus=true}={})=>{if(disposed)return;win.clearTimeout(hideTimer);if(nearLogo||!Number.isFinite(geometry.x)||!Number.isFinite(geometry.y))anchor();visible=true;root.hidden=false;wake();hideControls();const previousTab=tab;tab='ai';if((iconDock||restoreDock)&&!docked){const target=iconDock||restoreDock;iconDock=null;dock(target);restoreDock=null;}if(restore)tab=previousTab;position();win.requestAnimationFrame(()=>{if(visible){root.dataset.open='true';sizeInput();position();queueIdle();}});save();emitState();scanDocuments();if(focus&&tab==='ai')input.focus({preventScroll:true});loadModels();};
 const undock=({nearLogo=true}={})=>{if(locked)return false;restoreDock=null;iconDock=null;restorePane();docked=null;tab='ai';emitState();show({nearLogo});return true;};
 const hide=()=>{flushDraft();hideControls();win.clearTimeout(idleTimer);visible=false;root.dataset.open='false';root.dataset.unfocused='false';root.dataset.idle='false';clui.setExpanded(false);restorePane();clearHighlight();save();emitState();win.clearTimeout(hideTimer);hideTimer=win.setTimeout(()=>{if(!visible)root.hidden=true;},win.matchMedia('(prefers-reduced-motion:reduce)').matches?0:180);};
 const showBottom=()=>{if(disposed||presentation!=='reader-bottom'||iconDock||locked||embedded)return;restoreDock=null;restorePane();docked=null;tab='ai';setExpanded(false);show({focus:false});queueIdle();};
 const parkAt=(x,y)=>{if(presentation!=='reader-bottom'||locked)return false;const target=pickTarget(x,y);if(!target){if(iconDock){iconDock=null;save();emitState();}return false;}const rect=paneRect(target),point=target.getIconPosition?.({y,size:40})||{x:target.id==='left'?rect.right-40:rect.left,y:clamp(y-20,rect.top+8,rect.bottom-48)};restorePane();docked=null;restoreDock=null;iconDock=target.id;hide();moveOrb('end',point);return true;};
 original.onclick=()=>{if(locked)return;tab='original';position();save();emitState();};ai.onclick=()=>{tab='ai';setExpanded(true);position();save();emitState();input.focus({preventScroll:true});};close.onclick=()=>{if(locked)return;hide();orb?.focus({preventScroll:true});};
 choices.onclick=()=>{const open=sessionMenu.hidden;hideControls();if(open)showMenu(sessionMenu,choices);};
 const chooseSession=id=>{flushDraft();hideControls();Promise.resolve(onSelectSession?.(id)).catch(onError);};
 const measureInput=()=>{inputFrame=null;if(disposed||!input.clientWidth)return;const width=input.clientWidth;if(width!==inputWidth){inputWidth=width;const style=win.getComputedStyle(input);for(const property of ['font','lineHeight','letterSpacing','wordSpacing','paddingTop','paddingBottom','paddingLeft','paddingRight'])measure.style[property]=style[property];measure.style.width=width+'px';}measure.textContent=input.value+'\u200b';const height=Math.min(116,Math.max(38,measure.scrollHeight))+'px';if(input.style.height!==height)input.style.height=height;};
 const sizeInput=()=>{if(inputFrame===null&&!disposed)inputFrame=win.requestAnimationFrame(measureInput);};
 input.addEventListener('focus',wake);input.addEventListener('compositionstart',()=>{composing=true;hideControls();});input.addEventListener('compositionend',()=>{composing=false;sizeInput();});input.addEventListener('input',()=>{hideControls();sizeInput();win.clearTimeout(draftTimer);pendingDraft={draft:input.value,sessionID:session?.id};draftTimer=win.setTimeout(flushDraft,160);});
 root.addEventListener('pointerenter',wake);root.addEventListener('pointerleave',queueIdle);input.addEventListener('blur',queueIdle);
 const revealBottom=event=>{if(presentation==='reader-bottom'&&visible&&!docked&&!embedded&&root.dataset.idle==='true'&&bottomBounds&&event.clientY>=bottomBounds.bottom-40&&event.clientX>=bottomBounds.left&&event.clientX<=bottomBounds.right){wake();queueIdle();}};doc.addEventListener('pointermove',revealBottom,{passive:true});
 input.addEventListener('keydown',event=>{if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();const index=WORKBENCH_MODES.findIndex(item=>item.id===session?.mode);savePreferences({mode:WORKBENCH_MODES[(index+1)%WORKBENCH_MODES.length].id});showModes();}else if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();footer.requestSubmit();}});
 const onEscape=event=>{if(event.key!=='Escape'||event.isComposing||composing||event.keyCode===229)return;event.preventDefault();event.stopPropagation();if(drag){finishDrag({pointerId:drag.id},true);return;}if(!modeMenu.hidden||!more.hidden||!executionMenu.hidden||!sessionMenu.hidden){const anchored=!!preferenceAnchor;hideControls();if(anchored)focusPreferencesInput();return;}if(busy)onSend?.(null,{stop:true});else if(locked)root.dispatchEvent(new win.CustomEvent('easysch-conversation-close-request',{bubbles:true,composed:true}));else if(presentation==='reader-bottom'){restorePane();docked=null;iconDock=null;restoreDock=null;setExpanded(false);save();}else hide();};root.addEventListener('keydown',onEscape);preferencePopover.addEventListener('keydown',onEscape);
 const dismissControls=event=>{if(!footer.contains(event.target)&&!preferencePopover.contains(event.target)&&!preferenceAnchor?.contains(event.target)&&!sessionMenu.contains(event.target)&&!choices.contains(event.target))hideControls();if(root.contains(event.target))wake();};doc.addEventListener('pointerdown',dismissControls,true);
 for(const menu of [sessionMenu,modeMenu,more,executionMenu])menu.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const controls=[...menu.querySelectorAll('button')].filter(value=>!value.disabled&&!value.closest('[hidden]'));if(!controls.length)return;event.preventDefault();const index=controls.indexOf(doc.activeElement);controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowDown'?1:controls.length-1)+controls.length)%controls.length].focus();});
 footer.onsubmit=async event=>{event.preventDefault();if(composing||attachBusy)return;if(busy){onSend?.(null,{stop:true});return;}const prompt=input.value;if(!prompt.trim())return;setExpanded(true,{detail:false});const request={sessionID:session?.id,mode:session?.mode||'auto',modelID:session?.modelID||modelValues[0]?.id||'',thinkingLevel:session?.thinkingLevel||'off',executionMode:session?.executionMode||'auto',onToolPermission:value=>interactions.requestToolPermission({...value,sessionID:request.sessionID}),onResearchQuestion:value=>interactions.requestResearchQuestion({...value,sessionID:request.sessionID}),attachments:[...attachments],onProgress:setStatus};flushDraft();hideControls();busy=true;send.replaceChildren(icon(doc,'stop'));send.title='停止当前研究任务';send.setAttribute('aria-label',send.title);input.value='';sizeInput();try{await onSend?.(prompt,request);setStatus('');}catch(error){if(session?.id===request.sessionID&&!input.value){input.value=prompt;sizeInput();}setStatus(error.message||'研究任务未完成');onError(error);}finally{busy=false;interactions.cancel();send.replaceChildren(icon(doc,'send'));send.title='发送研究问题 · Enter';send.setAttribute('aria-label',send.title);if(visible&&session?.id===request.sessionID&&[input,send].includes(doc.activeElement))input.focus({preventScroll:true});}};
 const render=(value,sessions=[],meta={})=>{
  const switched=session?.id!==value?.id;interactions.setSession(value?.id);session=value;syncPreferences();if(switched){hideControls();renderOffset=0;}label(title,onSelectSession?'研究助手':value?.title||'研究助手');label(choices,value?.title||'研究对话');choices.title=value?.title||'切换或新建研究对话';choices.hidden=!onSelectSession;
  const savedSessions=sessions.filter(item=>!item.isDraft),sessionSignature=JSON.stringify([value?.id,savedSessions.map(item=>[item.id,item.title])]);if(sessionSignature!==lastSessions){lastSessions=sessionSignature;sessionMenu.replaceChildren();for(const item of savedSessions){const control=button(doc,item.title||'研究对话',item.title||'研究对话','chat');control.dataset.sessionId=item.id;control.setAttribute('role','menuitemradio');control.setAttribute('aria-checked',String(item.id===value?.id));if(item.id===value?.id)control.append(icon(doc,'check'));control.onclick=()=>chooseSession(item.id);sessionMenu.append(control);}const divider=node('hr','',sessionMenu);divider.setAttribute('role','separator');const newControl=button(doc,'新建对话','新建对话','plus');newControl.setAttribute('role','menuitem');newControl.onclick=()=>chooseSession('__new__');sessionMenu.append(newControl);}
  const draftOnly=!switched&&meta.sessionID===value?.id&&meta.action==='update'&&meta.fields?.length&&meta.fields.every(field=>field==='draft');
  if(!draftOnly)renderAttachments(getAttachments(value));if((switched||!busy&&doc.activeElement!==input)&&input.value!==(value?.draft||'')){input.value=value?.draft||'';sizeInput();}if(draftOnly)return;
  const signature=JSON.stringify([value?.id,value?.messages||[],renderOffset]);if(signature===lastRender)return;lastRender=signature;clui.beforeRender(value?.id);for(const off of messageDragOffs.splice(0))off();interactions.root.remove();disposeMediaPreviews(log);log.replaceChildren();if(!value?.messages?.length){log.append(empty);interactions.restore();clui.afterRender(switched);return;}
  const rows=cluiVisibleMessages(value.messages,renderOffset);if(rows.hasOlder){const older=button(doc,'查看更早的消息','加载前面的研究对话');older.className='conversation-surface-older';older.dataset.cluiIgnoreExpand='true';older.onclick=()=>{renderOffset++;render(value,sessions);};log.append(older);}
  for(const message of rows.messages){const article=node('article','conversation-surface-message '+(message.role==='user'?'from-user':'from-assistant'),log);article.dataset.messageId=message.id;
   if(message.role!=='user'){const meta=node('div','conversation-surface-message-meta',article),mark=node('span','conversation-assistant-mark',meta),name=node('span','',meta);mark.setAttribute('aria-hidden','true');name.textContent='EasySch';}
   const body=node('div','conversation-surface-text',article);if(message.role==='user')body.textContent=message.text||'';else if(renderContent)renderContent(body,message.text||'',{sources:message.sources||[],onSource});else body.textContent=message.text||'';
   for(const media of body.querySelectorAll('img,.katex-display,table'))installMediaPreview(media,{alt:media.localName==='img'?'回答图片':media.localName==='table'?'回答表格':'回答公式',...(media.localName==='img'?{}:{content:()=>media.cloneNode(true)}),onError});
   const citations=citedSources(message);if(citations.length){const details=node('details','conversation-surface-sources',article),summary=node('summary','',details);summary.textContent=citations.length+' 项引用依据';for(const source of citations){const control=button(doc,source.title||source.label||'查看来源');control.onclick=()=>Promise.resolve(onSource?.(source)).catch(onError);details.append(control);}}
   if(message.role!=='user'){const saving=answerWithQuestion(value.messages,message),grip=button(doc,'拖动','拖动回答；在支持资料的区域松开以添加','grip');grip.className='conversation-surface-message-grip';grip.dataset.cluiIgnoreExpand='true';article.append(grip);
    messageDragOffs.push(installMessageDrag({card:article,grip,textRoots:[body,article.querySelector('.conversation-surface-message-meta')].filter(Boolean),sessionID:value.id,messageID:message.id,onDrag:event=>onDragMessage?.(event,saving)}));
    if(onSave){const saveButton=button(doc,'保存笔记','保存回答与问题为研究笔记');saveButton.className='conversation-surface-save';saveButton.onclick=async()=>{saveButton.disabled=true;try{await onSave(saving,{sessionID:value.id});setStatus('研究笔记已保存');}catch(error){setStatus(error.message);onError(error);}finally{saveButton.disabled=false;}};article.append(saveButton);}
   }
  }interactions.restore();clui.afterRender(switched);
 };
 const startDrag=event=>{
  const handle=event.target.closest('[data-conversation-move]');if(locked||embedded||event.button!==0||!handle&&event.target.closest('button,input,textarea,select,a,.conversation-surface-message,.conversation-interaction-host,.conversation-surface-attachment,.conversation-surface-resize,.conversation-surface-controls,.conversation-surface-session-menu,.clui-native-height-grip,summary,details')||event.target===log&&event.clientX>log.getBoundingClientRect().right-15)return;
  const rect=root.getBoundingClientRect(),orbRect=orb&&!orb.hidden?orb.getBoundingClientRect():null,targetRects=new Map(targets().map(target=>[target.id,paneRect(target)]));drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:rect.left,y:rect.top,width:rect.width,height:rect.height,targetRects,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,oldDock:docked?.id||null,oldGeometry:{...geometry},oldOrb:orbRect?{x:orbRect.left,y:orbRect.top}:null,moved:false};root.setPointerCapture(event.pointerId);wake();hideControls();event.preventDefault();
 };
 root.addEventListener('pointerdown',startDrag);
 const drawDrag=()=>{dragFrame=null;if(!drag||!latestDragPoint)return;const point=latestDragPoint;geometry.x=clamp(drag.x+point.x-drag.startX,8,win.innerWidth-drag.width-8);geometry.y=clamp(drag.y+point.y-drag.startY,8,win.innerHeight-drag.height-8);root.style.transform=`translate3d(${geometry.x-drag.x}px,${geometry.y-drag.y}px,0)`;previewDock(point.x,point.y);moveOrb('move');};
 root.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;if(!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<5)return;
  if(!drag.moved){drag.moved=true;restorePane();docked=null;tab='ai';root.dataset.dragging='true';root.style.left=drag.x+'px';root.style.top=drag.y+'px';root.style.width=drag.width+'px';root.style.height=drag.height+'px';emitState();}
  latestDragPoint={x:event.clientX,y:event.clientY};if(dragFrame===null)dragFrame=win.requestAnimationFrame(drawDrag);event.preventDefault();
 });
 const finishDrag=(event,cancelled=false)=>{if(!drag||event.pointerId!==drag.id)return;if(dragFrame!==null){win.cancelAnimationFrame(dragFrame);dragFrame=null;drawDrag();}const previous=drag;drag=null;latestDragPoint=null;root.style.removeProperty('transform');if(root.hasPointerCapture?.(event.pointerId))root.releasePointerCapture(event.pointerId);clearHighlight();if(!previous.moved)return;
  if(cancelled){geometry=previous.oldGeometry;if(previous.oldDock)dock(previous.oldDock);else{position();previous.oldOrb?moveOrb('cancel',previous.oldOrb):emitState();}}else if(!(presentation==='reader-bottom'?parkAt(event.clientX,event.clientY):dockAt(event.clientX,event.clientY))){position();save();moveOrb('end');}delete root.dataset.dragging;
 };
 root.addEventListener('pointerup',event=>finishDrag(event));root.addEventListener('pointercancel',event=>finishDrag(event,true));
 resize.onpointerdown=event=>{if(event.button!==0)return;event.stopPropagation();const y=event.clientY,height=geometry.height;resize.setPointerCapture(event.pointerId);root.dataset.resizing='true';const move=event=>{geometry.height=height+event.clientY-y;scheduleRefresh();};const finish=()=>{resize.removeEventListener('pointermove',move);resize.removeEventListener('pointerup',finish);resize.removeEventListener('pointercancel',finish);delete root.dataset.resizing;position();save();};resize.addEventListener('pointermove',move);resize.addEventListener('pointerup',finish,{once:true});resize.addEventListener('pointercancel',finish,{once:true});};
 resize.onkeydown=event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();geometry.height+=(event.key==='ArrowUp'?-1:1)*(event.shiftKey?40:16);position();save();}};
 const refresh=()=>{if(drag)return;position();positionAnchoredPreferences();sizeInput();};
 const scheduleRefresh=()=>{if(positionFrame!==null||disposed)return;positionFrame=win.requestAnimationFrame(()=>{positionFrame=null;refresh();});};
 const onScroll=()=>{if((docked||preferenceAnchor)&&!drag)scheduleRefresh();};win.addEventListener('resize',scheduleRefresh);doc.addEventListener('scroll',onScroll,{capture:true,passive:true});
 const observer=new win.ResizeObserver(()=>{if((docked||embedded)&&!drag)scheduleRefresh();});for(const target of targets())if(target.element)observer.observe(target.element);
 const surfaceObserver=new win.MutationObserver(()=>{if(!disposed)syncCLUI();});surfaceObserver.observe(root,{attributes:true,attributeFilter:['data-clui-size','data-pinned','data-dimmed']});
 const borrowPlacement=({host,dockID,lock=true}={})=>{
  if(disposed)throw Error('对话面板已关闭');if(host&&host.ownerDocument!==doc)throw Error('共享对话必须嵌入当前阅读器窗口');
  const target=dockID?targets().find(value=>value.id===dockID):null;if(dockID&&!target)throw Error('阅读器侧栏尚未就绪');
  if(drag)finishDrag({pointerId:drag.id},true);flushDraft();hideControls();win.clearTimeout(hideTimer);
  const lease={released:false,host,previous:{embedded,locked,docked,restoreDock,tab,visible,size:root.dataset.cluiSize,pinned:root.dataset.pinned==='true',geometry:{...geometry},parent:root.parentNode,next:root.nextSibling}};placementLeases.push(lease);
  restorePane();embedded=host||null;docked=target;restoreDock=null;locked=!!lock;tab='ai';visible=true;root.hidden=false;root.dataset.open='true';wake();clearHighlight();
  if(host){host.append(root);observer.observe(host);}else{doc.documentElement.append(root);target?.ensureOpen?.();}clui.setPinned(!!lock);clui.setExpanded(true);syncCLUI();position();emitState();loadModels();sizeInput();
  const release=()=>{
   if(lease.released)return;lease.released=true;if(disposed)return;
   // A figure viewer may temporarily sit above a locked reader mode. Releasing
   // either host out of order must not detach the active inner conversation.
   while(placementLeases.at(-1)?.released){const value=placementLeases.pop(),previous=value.previous;restorePane();if(value.host)observer.unobserve(value.host);embedded=previous.embedded;locked=previous.locked;docked=previous.docked;restoreDock=previous.restoreDock;tab=previous.tab;visible=previous.visible;geometry=previous.geometry;clui.setPinned(previous.pinned);clui.setExpanded(previous.size!=='compact',{detail:previous.size==='detail'});
    const parent=previous.parent?.isConnected?previous.parent:doc.documentElement;if(previous.next?.parentNode===parent)parent.insertBefore(root,previous.next);else parent.append(root);
   }
   win.clearTimeout(hideTimer);root.hidden=!visible;root.dataset.open=String(visible);if(visible)position();else{root.dataset.embedded=String(!!embedded);root.dataset.locked=String(locked);root.dataset.dock=embedded?'embedded':docked?.id||'floating';}emitState();if(!placementLeases.length)save();
  };
  return {root,input,dispose:release};
 };
 const onPageHide=event=>{if(event.target===doc)destroy();};
 const destroy=()=>{if(disposed)return;interactions.destroy();for(const off of messageDragOffs.splice(0))off();disposeMediaPreviews(log);flushDraft();hideControls();disposed=true;visible=false;emitState();win.clearTimeout(hideTimer);win.clearTimeout(idleTimer);if(positionFrame!==null)win.cancelAnimationFrame(positionFrame);if(dragFrame!==null)win.cancelAnimationFrame(dragFrame);if(inputFrame!==null)win.cancelAnimationFrame(inputFrame);restorePane();observer.disconnect();surfaceObserver.disconnect();win.removeEventListener('resize',scheduleRefresh);doc.removeEventListener('scroll',onScroll,true);doc.removeEventListener('pointerdown',dismissControls,true);doc.removeEventListener('pointermove',revealBottom);doc.removeEventListener('load',iframeLoaded,true);for(const value of outsideDocuments)withLiveDOM(value,()=>{value.removeEventListener('click',outsideClick,true);value.removeEventListener('dblclick',outsideDoubleClick,true);});outsideDocuments.clear();win.removeEventListener('pagehide',onPageHide);clui.destroy();highlight.remove();preferencePopover.remove();};win.addEventListener('pagehide',onPageHide);
 syncCLUI();
 return {root,input,header,log,render,renderAttachments,show,showBottom,hide,setExpanded,setPinned,dock,undock,dockAt,parkAt,previewDock,clearHighlight,refresh,setStatus,mount(host,{locked=true}={}){return borrowPlacement({host,lock:locked});},lockDock(id='right',{locked=true}={}){return borrowPlacement({dockID:id,lock:locked});},hideOptions:hideControls,showOptions(kind='model',{anchor}={}){if(anchor){showAnchoredPreferences(kind,anchor);return;}if(!visible)show();showPreferences(kind==='strength'?'strength':'model');},destroy,setOrb(value){if(orb){orb.hidden=false;orb.dataset.conversationDocked='false';}orb=value;emitState();},get isOpen(){return visible;},get docked(){return docked?.id||null;},get state(){return {...geometry,dock:docked?.id||null,iconDock,tab,open:visible,size:root.dataset.cluiSize,pinned:root.dataset.pinned==='true',embedded:!!embedded,locked};}};
}
