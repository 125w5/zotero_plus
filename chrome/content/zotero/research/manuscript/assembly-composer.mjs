/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {ASSEMBLY_COMMANDS,assemblyCommandsFor,assemblyRegionRect} from './assembly-command-menu.mjs';
import {assemblyChatIcon} from './assembly-chat-context.mjs';
import {mountConversationQuestionChoices} from '../shared/conversation-question-choices.mjs';
import {installCLUIChatBehavior} from '../shared/clui-surface.mjs';
import {pendingPlanEditMessage} from '../shared/plan-edit-proposal.mjs';
import {libraryView} from '../shared/material-access.mjs';

const EXTRA_ICONS={camera:['M3 7h5l2-3h4l2 3h5v13H3Z','M16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0'],shield:['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z','m8 12 3 3 5-6'],tools:['M4 5h16M4 12h16M4 19h16','M8 3v4m8 3v4M9 17v4'],paper:['M5 3h14v18H5Z','M8 7h8m-8 4h8m-8 4h5'],slides:['M3 4h18v13H3Z','M12 17v4m-4 0h8M7 8h10m-10 4h5'],trash:['M5 6h14M9 6V3h6v3M7 6l1 15h8l1-15','M10 10v7m4-7v7']};
function icon(doc,name){
 if(!EXTRA_ICONS[name])return assemblyChatIcon(doc,name);
 const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
 for(const d of EXTRA_ICONS[name]){const path=doc.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}

export function installAssemblyComposer(U,{status,persist}){
 const doc=U.$('ai-form').ownerDocument,win=doc.defaultView,form=U.$('ai-form'),input=U.$('ai-prompt'),S=U.conversations,scope={projectID:U.p.id},pending=new Set();
 const node=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const run=fn=>Promise.resolve().then(fn).catch(error=>status(error.message,true));
 const control=(label,name,action,cls='assembly-compose-control')=>{const b=node('button',cls);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.append(icon(doc,name));b.onclick=()=>run(action);return b;};
 const closePopups=()=>{for(const popup of form.querySelectorAll('[data-composer-popup],.prompt-templates'))popup.hidden=true;U.$('assembly-command-toggle')?.setAttribute('aria-expanded','false');};
 const taskbar=node('nav','assembly-taskbar');taskbar.id='assembly-taskbar';taskbar.setAttribute('aria-label','当前任务与对话');
 const tabs=node('div','assembly-task-tabs');tabs.setAttribute('role','tablist');taskbar.append(tabs);
 const taskActions=node('div','assembly-task-actions');taskbar.append(taskActions);
 taskActions.append(control('新建对话','plus',()=>{const session=U.conversationSession;return S.create({title:'新研究对话',origin:'assembly',projectID:U.p.id,modelID:session.modelID||'',thinkingLevel:session.thinkingLevel||'off',executionMode:session.executionMode||'auto',mode:session.mode||'auto'});}),control('固定当前任务到左栏','pin',async()=>{const m=U.conversationSession.messages?.at(-1);if(m)await U.pinResearchMessage({sessionID:U.conversationSession.id,messageID:m.id},'left');else U.openChatRail('left');}),control('显示回答依据','link',()=>U.openChatRail('right')));
 U.$('ai').querySelector('.ai-heading').after(taskbar);
 const master=U.ensureChatMasterShell?.();
 // Keep the existing fixed transcript and footer in one real CLUI surface.
 // display:contents preserves the workspace rows and the fixed input baseline.
 const surface=node('section','assembly-clui-surface');surface.id='assembly-clui-surface';surface.setAttribute('aria-label','装配研究对话');const ai=U.$('ai'),footer=form.closest('footer');ai.before(surface);surface.append(ai,footer);
 master?.classList.add('clui-native-shell','clui-native-glass');taskbar.classList.add('clui-native-tab-strip');taskbar.dataset.cluiIgnoreExpand='true';
 const transcript=U.$('ai-history').parentElement;transcript.classList.add('clui-native-body');U.$('ai-history').classList.add('clui-native-conversation');form.classList.add('clui-native-input-pill','clui-native-glass');form.dataset.cluiIgnoreExpand='true';
 for(const frame of ai.querySelectorAll('.ai-side-frame'))frame.classList.add('clui-native-shell','clui-native-glass');
 const collapse=U.$('collapse-chat');collapse.dataset.cluiCollapse='true';U.$('toggle-ai').dataset.cluiToggle='true';
 const pin=control('固定对话，不随外部双击收起','pin',()=>clui.setPinned(!clui.pinned),'assembly-clui-pin');pin.id='assembly-clui-pin';pin.dataset.cluiIgnoreExpand='true';pin.setAttribute('aria-pressed','false');taskActions.append(pin);
 let cluiApplying=false;
 const clui=installCLUIChatBehavior({root:surface,body:transcript,onChange:({mode,expanded,pinned,detailHeight})=>{
  if(cluiApplying)return;cluiApplying=true;try{U.cluiMode=mode;U.chatExpanded=expanded;const chromeHeight=Math.max(104,ai.getBoundingClientRect().height-transcript.getBoundingClientRect().height);U.chatReadingHeight=mode==='detail'?detailHeight+chromeHeight:0;U.chatReadingSessionID=mode==='detail'?U.conversationSession.id:'';U.p.ui.aiOpen=expanded;pin.setAttribute('aria-pressed',String(pinned));pin.title=pinned?'取消固定，双击外部可收起':'固定对话，不随外部双击收起';U.applyPanels();}finally{cluiApplying=false;}
  // Opening the bottom strip is the real user entry too. A pending content
  // change needs space for both versions and its adoption controls.
  if(mode==='conversation'&&pendingPlanEditMessage(U.conversationSession?.messages))win.queueMicrotask(()=>{if(U.assemblyCLUI?.mode==='conversation')U.openCoauthor();});
 }});
 U.assemblyCLUI=clui;
 const execution=node('button','assembly-execution-mode');execution.type='button';execution.id='assembly-execution-mode';execution.title='Auto 执行已授权的应用操作；询问模式逐次确认写入';execution.setAttribute('aria-haspopup','menu');form.querySelector('.ai-compose-actions').insertBefore(execution,U.$('ai-options'));
 const executionMenu=node('div','assembly-composer-popup assembly-execution-menu');executionMenu.dataset.composerPopup='execution';executionMenu.hidden=true;executionMenu.setAttribute('role','menu');form.append(executionMenu);
 for(const [value,label,description]of [['auto','Auto','执行你在本轮要求的应用操作'],['ask','询问','应用操作写入前逐次确认']]){const b=node('button','assembly-menu-choice');b.type='button';b.setAttribute('role','menuitemradio');b.dataset.value=value;b.append(icon(doc,'shield'),node('span','',label),node('small','',description));b.onclick=()=>run(async()=>{await S.update(U.conversationSession.id,{executionMode:value},{origin:'assembly'});closePopups();});executionMenu.append(b);}
 execution.onclick=()=>{const open=executionMenu.hidden;closePopups();executionMenu.hidden=!open;};
 const commandMenu=node('div','assembly-composer-popup assembly-command-menu');commandMenu.id='assembly-command-menu';commandMenu.dataset.composerPopup='commands';commandMenu.hidden=true;commandMenu.setAttribute('role','listbox');commandMenu.setAttribute('aria-label','应用功能');form.append(commandMenu);
 let commandIndex=0,commandRows=[],slashOpen=false;
 const composePrompt=text=>{closePopups();input.value=text;input.dispatchEvent(new win.Event('input',{bubbles:true}));input.focus({preventScroll:true});};
 const picker=node('section','assembly-composer-popup assembly-source-picker');picker.id='assembly-source-picker';picker.dataset.composerPopup='sources';picker.hidden=true;picker.setAttribute('aria-label','选择对话资料');form.append(picker);let pickGeneration=0;
 const openSources=async(kind='all')=>{
  closePopups();picker.hidden=false;picker.replaceChildren();const generation=++pickGeneration;
  const head=node('header','assembly-picker-heading');head.append(node('strong','',kind==='papers'?'选择论文':kind==='materials'?'选择素材':'添加对话资料'),control('关闭','close',()=>{picker.hidden=true;}));picker.append(head);
  const search=node('input','assembly-picker-search');search.type='search';search.placeholder='搜索论文标题、素材内容';search.setAttribute('aria-label','查找论文或素材');picker.append(search);const list=node('div','assembly-picker-list');picker.append(list);
  const file=control('从本机添加 PDF、DOCX、Excel、图片或文本','file',async()=>{picker.hidden=true;await U.attachResearchFiles();});file.append(node('span','','本机文件'));head.insertBefore(file,head.lastChild);
  const papers=kind==='materials'?[]:await U.A.papers();if(generation!==pickGeneration)return;
  const materials=kind==='papers'?[]:[...new Map([...U.p.materials,...Object.values(libraryView(U.A))].map(m=>[m.id,m])).values()];
  const render=()=>{list.replaceChildren();const query=search.value.normalize('NFKC').toLowerCase();let count=0;
   const add=(title,label,payload,reference)=>{const row=node('button','assembly-picker-row');row.type='button';row.dataset.sourceId=reference;row.append(icon(doc,label==='论文'?'paper':'file'),node('span','',title),node('small','',label));row.setAttribute('aria-pressed',String((U.conversationSession.attachments||[]).some(item=>item.id===reference||item.paperItemID===payload.items?.[0])));row.onclick=()=>run(async()=>{row.disabled=true;try{await persist({flush:true});await U.attachResearchFiles(payload,{source:'picker'});row.setAttribute('aria-pressed','true');}finally{row.disabled=false;}});list.append(row);count++;};
   for(const paper of papers.filter(p=>String(p.title).normalize('NFKC').toLowerCase().includes(query)).slice(0,60))add(paper.title,'论文',{items:[paper.id]},'paper:'+paper.id);
   for(const m of materials.filter(m=>[m.title,m.summary,m.sourceText].join(' ').normalize('NFKC').toLowerCase().includes(query)).slice(0,80))add(U.A.titleFor(m),'素材',{materialIDs:[m.id]},'material:'+m.id);
   if(!count)list.append(node('p','assembly-picker-empty','没有匹配的论文或素材。'));
  };search.oninput=render;render();search.focus({preventScroll:true});
 };
 U.openAssemblySources=openSources;
 const capture=()=>new Promise((resolve,reject)=>{
  closePopups();U.closeCoauthor();const sessionID=U.conversationSession.id,controller=new win.AbortController(),bounds=U.$('canvas').getBoundingClientRect(),overlay=node('div','assembly-region-picker'),box=node('div','assembly-region-box'),hint=node('span','assembly-region-hint','拖动框选文章区域 · Esc 取消');overlay.append(box,hint);doc.body.append(overlay);overlay.style.cssText=`left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`;
  let start,rect,settled=false;const dispose=()=>{overlay.remove();doc.removeEventListener('keydown',cancel,true);},finish=(value,error)=>{if(settled)return;settled=true;pending.delete(cancelCapture);dispose();if(error)reject(error);else resolve(value);},cancelCapture=()=>{controller.abort();finish(null);},cancel=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancelCapture();}};pending.add(cancelCapture);doc.addEventListener('keydown',cancel,true);
  overlay.onpointerdown=event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};try{overlay.setPointerCapture(event.pointerId);}catch(error){if(error.name!=='NotFoundError')finish(null,error);}};
  overlay.onpointermove=event=>{if(!start)return;rect=assemblyRegionRect(start,{x:event.clientX,y:event.clientY},bounds);box.style.cssText=`left:${rect.x-bounds.left}px;top:${rect.y-bounds.top}px;width:${rect.width}px;height:${rect.height}px`;};
  overlay.onpointercancel=cancelCapture;overlay.onpointerup=async event=>{if(!start)return;rect=assemblyRegionRect(start,{x:event.clientX,y:event.clientY},bounds);start=null;dispose();if(rect.width<12||rect.height<12){finish(null);return;}try{const frame=win.frameElement,host=frame?.ownerGlobal||win.parent,offset=frame?.getBoundingClientRect()||{left:0,top:0};for(let i=0;i<20&&!U.$('ai').hidden;i++)await new Promise(r=>win.setTimeout(r,20));await new Promise(r=>win.requestAnimationFrame(()=>win.requestAnimationFrame(r)));if(settled)return;if(sessionID!==U.conversationSession.id){cancelCapture();return;}const result=await U.E.chatAttachments.captureRegion(sessionID,{hostWindow:host,signal:controller.signal,rect:{...rect,x:rect.x+offset.left,y:rect.y+offset.top}});if(!controller.signal.aborted)U.openCoauthor();finish(result);}catch(error){finish(null,controller.signal.aborted?undefined:error);}};
 });
 const activate=async command=>{const draft=input.value.trim().startsWith('/')?'':input.value.trim();slashOpen=false;closePopups();if(input.value.trim().startsWith('/'))composePrompt('');
  if(command.prompt){composePrompt(draft?draft+'\n\n'+command.prompt:command.prompt);form.requestSubmit();return;}
  if(command.action==='materials')return openSources('materials');if(command.action==='papers')return openSources('papers');if(command.action==='file')return U.attachResearchFiles();if(command.action==='capture')return capture();
  if(command.action==='check'){const issues=await U.A.check(U.p),host=node('article','assembly-interaction-card assembly-check-card');host.append(node('strong','','装配证据检查'));if(!issues.length)host.append(node('p','','未发现结构检查项。'));for(const issue of issues){const b=node('button','assembly-check-issue',issue.message);b.type='button';b.onclick=()=>U.selectBlock(issue.blockID,{scroll:true});host.append(b);}interactionHost.append(host);U.openCoauthor();return issues;}
  if(command.action==='ppt')return U.E.studio.open({papers:await U.A.papers().then(rows=>rows.filter(p=>(U.p.materialPaperIDs||[]).includes(p.id)))});
 };
 const renderCommands=(value='')=>{commandRows=assemblyCommandsFor(value);commandIndex=Math.min(commandIndex,Math.max(0,commandRows.length-1));commandMenu.replaceChildren();for(const [i,command]of commandRows.entries()){const row=node('button','assembly-command-row');row.type='button';row.dataset.command=command.id;row.id='assembly-command-'+command.id;row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===commandIndex));row.append(icon(doc,command.icon),node('code','','/'+command.id),node('span','',command.label),node('small','',command.description));row.onpointerenter=()=>{commandIndex=i;for(const [j,r]of [...commandMenu.children].entries())r.setAttribute('aria-selected',String(i===j));};row.onclick=()=>run(()=>activate(command));commandMenu.append(row);}if(!commandRows.length)commandMenu.append(node('p','assembly-picker-empty','没有匹配的应用功能。'));};
 const stack=node('div','assembly-compose-stack clui-native-btn-stack');stack.setAttribute('role','group');stack.setAttribute('aria-label','添加资料与应用功能');const commandToggle=control('应用功能 · 输入 /','tools',()=>{const open=commandMenu.hidden;closePopups();slashOpen=false;renderCommands();commandMenu.hidden=!open;commandToggle.setAttribute('aria-expanded',String(open));});commandToggle.id='assembly-command-toggle';commandToggle.setAttribute('aria-controls',commandMenu.id);commandToggle.setAttribute('aria-expanded','false');stack.append(commandToggle,control('框选文章截图','camera',capture));const attach=U.$('ai-attach');attach.title='选择论文、素材或本机文件';attach.setAttribute('aria-label',attach.title);attach.replaceChildren(icon(doc,'paper'));attach.onclick=()=>run(()=>openSources());stack.append(attach);for(const [index,button]of [...stack.children].entries())button.classList.add('clui-native-stack-btn','clui-native-stack-btn-'+(3-index));form.querySelector('.ai-compose-actions').insertBefore(stack,U.$('ai-template-toggle'));
 // Expand actual hit targets together with pointer or keyboard focus.
 let stackPointer=false;const syncStack=()=>{stack.dataset.expanded=String(stackPointer||stack.contains(doc.activeElement));},stackEnter=()=>{stackPointer=true;syncStack();},stackLeave=()=>{stackPointer=false;syncStack();},stackFocusOut=()=>win.queueMicrotask(syncStack);
 stack.addEventListener('pointerenter',stackEnter);stack.addEventListener('pointerleave',stackLeave);stack.addEventListener('focusin',syncStack);stack.addEventListener('focusout',stackFocusOut);syncStack();
 const interactionHost=node('div','assembly-interaction-cards');interactionHost.id='assembly-interaction-cards';U.$('chat').after(interactionHost);
 // A pending decision needs enough temporary transcript space even when this
 // empty conversation normally uses the compact input view. Never persist
 // that task-specific height over the user's preferred conversation size.
 const syncInteractionHeight=()=>{const active=[...interactionHost.querySelectorAll('.assembly-question-card,.assembly-permission-card')].filter(card=>card.dataset.state!=='resolved').at(-1),height=active?Math.max(300,Math.ceil(active.scrollHeight)+140):0;if(U.chatInteractionHeight!==height){U.chatInteractionHeight=height;U.applyPanels();}};
 const interaction=(request,type)=>new Promise(resolve=>{
  if(request.signal?.aborted||(request.sessionID&&request.sessionID!==U.conversationSession.id)){resolve(type==='permission'?false:{answer:''});return;}const owner=U.conversationSession.id;clui.setConversation();U.openCoauthor();const card=node('article','assembly-interaction-card assembly-'+type+'-card');card.dataset.sessionId=owner;card.setAttribute('role','group');card.setAttribute('aria-label',type==='permission'?'确认应用操作':'研究选择');
  const heading=node('div','assembly-interaction-heading');heading.append(icon(doc,type==='permission'?'shield':'chat'),node('strong','',type==='permission'?'确认应用操作':'选择下一步'));card.append(heading);const text=node('div','assembly-interaction-text');U.E.renderContent(text,type==='permission'?(request.description||request.label):request.question);card.append(text);
  if(type==='question'&&request.basis){const basis=node('div','assembly-question-basis');U.E.renderContent(basis,request.basis);card.append(basis);}
  const actions=node('div','assembly-interaction-actions');card.append(actions);interactionHost.append(card);
  const history=U.$('ai-history');let settled=false,revealFrame,questionControls;
  // The console may still be growing from its collapsed height when the card
  // arrives. Follow that layout growth so its real choices remain clickable;
  // ordinary user scrolling does not trigger this observer.
  const reveal=()=>{if(!settled&&card.isConnected){syncInteractionHeight();history.scrollTop=history.scrollHeight;}},visibleResize=new win.ResizeObserver(reveal);visibleResize.observe(history);visibleResize.observe(card);
  const finish=value=>{if(settled)return;settled=true;questionControls?.destroy();visibleResize.disconnect();if(revealFrame)win.cancelAnimationFrame(revealFrame);pending.delete(cancel);request.signal?.removeEventListener('abort',cancel);card.dataset.state='resolved';const label=type==='permission'?(value?'已允许':'已取消'):value.action==='regenerate'?'重新生成选项':value.answer||'已取消';actions.replaceChildren(node('span','assembly-interaction-result',label));syncInteractionHeight();resolve(value);},cancel=()=>finish(type==='permission'?false:{answer:''});pending.add(cancel);request.signal?.addEventListener('abort',cancel,{once:true});
  if(type==='permission'){for(const [label,value]of [['允许一次',true],['取消',false]]){const b=node('button',value?'primary':'',label);b.type='button';b.onclick=()=>owner===U.conversationSession.id?finish(value):cancel();actions.append(b);}}
  else questionControls=mountConversationQuestionChoices({doc,host:actions,options:request.options,sources:request.sources,onSource:source=>U.openResearchCitation(source),onError:error=>status(error.message,true),onAnswer:finish,onRegenerate:finish,onCancel:cancel,isCurrent:()=>!settled&&owner===U.conversationSession.id,classes:{option:'assembly-question-choice',custom:'assembly-question-custom',regenerate:'assembly-question-regenerate',cancel:'assembly-question-cancel',submit:'assembly-question-submit'}});
  reveal();revealFrame=win.requestAnimationFrame(reveal);
 });
 U.requestToolPermission=request=>interaction(request,'permission');U.requestResearchQuestion=request=>interaction(request,'question');
 const inputChanged=()=>{const value=input.value.trim();if(/^\/\S*$/u.test(value)){closePopups();slashOpen=true;commandIndex=0;renderCommands(value);commandMenu.hidden=false;}else if(slashOpen){slashOpen=false;commandMenu.hidden=true;}};input.addEventListener('input',inputChanged);
 const onKey=event=>{if(commandMenu.hidden||event.isComposing||!(event.target===input||event.target===commandToggle||commandMenu.contains(event.target)))return;const focused=event.target.closest('[data-command]'),focusedIndex=focused?commandRows.findIndex(row=>row.id===focused.dataset.command):-1;if(focusedIndex>=0)commandIndex=focusedIndex;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePopups();slashOpen=false;}else if(['ArrowDown','ArrowUp'].includes(event.key)&&commandRows.length){event.preventDefault();event.stopImmediatePropagation();const inMenu=commandMenu.contains(event.target);commandIndex=(commandIndex+(event.key==='ArrowDown'?1:-1)+commandRows.length)%commandRows.length;renderCommands(slashOpen?input.value:'');commandMenu.children[commandIndex]?.scrollIntoView({block:'nearest'});if(inMenu)commandMenu.children[commandIndex]?.focus({preventScroll:true});}else if(event.key==='Enter'&&!event.shiftKey&&commandRows[commandIndex]){event.preventDefault();event.stopImmediatePropagation();run(()=>activate(commandRows[commandIndex]));}};form.addEventListener('keydown',onKey,true);
 // Keep real task positions stable while answers stream and while an existing
 // tab is selected. Recreating every tab on each token drops keyboard focus.
 const taskNodes=new Map(),taskStates=new Map();let taskOrder=[],lastSessionID=U.conversationSession.id;
 const paintTaskStates=()=>{for(const [id,tab]of taskNodes)tab.dataset.state=taskStates.get(id)||'idle';taskbar.dataset.state=taskStates.get(U.conversationSession?.id)||'idle';};
 const removeTask=async id=>{if(U.activeResearchSessionID===id)throw Error('请先停止这条对话的任务。');await S.remove(id);taskStates.delete(id);if(!S.getForScope(scope))await S.open({...scope,origin:'assembly',title:'新研究对话'});tabs.querySelector('[aria-selected=true]')?.focus({preventScroll:true});};
 const taskKey=event=>{const target=event.target.closest('.assembly-task-select');if(!target||event.isComposing)return;const controls=[...tabs.querySelectorAll('.assembly-task-select')],index=controls.indexOf(target);let next;
  if(event.key==='ArrowRight')next=(index+1)%controls.length;else if(event.key==='ArrowLeft')next=(index-1+controls.length)%controls.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=controls.length-1;else if(event.key==='Delete'){event.preventDefault();event.stopPropagation();run(()=>removeTask(target.dataset.sessionId));return;}else return;
  event.preventDefault();event.stopPropagation();const id=controls[next].dataset.sessionId;run(async()=>{await S.select(id,{scope,summary:true});taskNodes.get(id)?.querySelector('.assembly-task-select').focus({preventScroll:true});taskNodes.get(id)?.scrollIntoView({block:'nearest',inline:'nearest'});});
 };taskbar.addEventListener('keydown',taskKey);
 const update=value=>{const session=U.conversationSession;if(!session)return;const selectionChanged=lastSessionID!==session.id;if(selectionChanged){for(const cancel of [...pending])cancel();interactionHost.replaceChildren();lastSessionID=session.id;closePopups();if(clui.mode==='detail')clui.setConversation();}
  execution.replaceChildren(icon(doc,'shield'),node('span','',session.executionMode==='ask'?'询问':'Auto'));for(const row of executionMenu.children)row.setAttribute('aria-checked',String(row.dataset.value===(session.executionMode||'auto')));
  const snapshot=value?.sessions?value:S.snapshot({summary:true}),sessions=snapshot.sessions.filter(item=>!item.isDraft),running=U.activeResearchSessionID&&snapshot.sessions.find(item=>item.id===U.activeResearchSessionID),available=new Map([...sessions,...(running?[running]:[]),session].map(item=>[item.id,item]));if(!taskOrder.length)taskOrder=sessions.slice(-4).map(item=>item.id);taskOrder=taskOrder.filter(id=>available.has(id));if(running&&!taskOrder.includes(running.id))taskOrder.push(running.id);if(!taskOrder.includes(session.id))taskOrder.push(session.id);while(taskOrder.length>4)taskOrder.splice(taskOrder.findIndex(id=>id!==session.id&&id!==U.activeResearchSessionID),1);
  for(const id of taskStates.keys())if(!available.has(id)&&id!==U.activeResearchSessionID)taskStates.delete(id);
  for(const [id,tab]of taskNodes)if(!taskOrder.includes(id)){tab.remove();taskNodes.delete(id);}
  for(const [index,id]of taskOrder.entries()){const item=available.get(id),active=id===session.id;let tab=taskNodes.get(id);
   if(!tab){tab=node('div','assembly-task-tab');tab.setAttribute('role','presentation');const select=node('button','assembly-task-select');select.type='button';select.setAttribute('role','tab');select.dataset.sessionId=id;select.append(node('i','assembly-task-dot'),node('span'));select.onclick=()=>run(()=>S.select(id,{scope,summary:true}));tab.append(select,control('删除这条对话，素材和笔记保留','close',()=>removeTask(id),'assembly-task-remove'));taskNodes.set(id,tab);}
   tab.dataset.active=String(active);const select=tab.querySelector('.assembly-task-select'),label=item.currentTask||item.title||'新研究对话';select.setAttribute('aria-selected',String(active));select.tabIndex=active?0:-1;select.title=label;const title=select.querySelector('span');if(title.textContent!==label)title.textContent=label;if(tabs.children[index]!==tab)tabs.insertBefore(tab,tabs.children[index]||null);
  }
  // Reveal a newly chosen task within this strip only; never scroll the paper
  // or reposition the conversation while its reply is streaming.
  if(selectionChanged){const tab=taskNodes.get(session.id),rect=tab?.getBoundingClientRect(),view=tabs.getBoundingClientRect();if(rect&&view.width){if(rect.right>view.right-24)tabs.scrollLeft+=rect.right-view.right+24;else if(rect.left<view.left)tabs.scrollLeft-=view.left-rect.left;}}
  paintTaskStates();
 };const unsubscribe=S.subscribe(update,{summary:true});update();U.updateAssemblyTaskState=(state,sessionID=U.conversationSession?.id)=>{if(!sessionID)return;taskStates.set(sessionID,state);paintTaskStates();};
 const outside=event=>{if(!form.contains(event.target))closePopups();};doc.addEventListener('pointerdown',outside);
 U.assemblyComposer={openSources,capture,activate,commands:ASSEMBLY_COMMANDS,refresh:update,clui};
 win.addEventListener('pagehide',()=>{clui.destroy();for(const cancel of [...pending])cancel();unsubscribe();input.removeEventListener('input',inputChanged);form.removeEventListener('keydown',onKey,true);taskbar.removeEventListener('keydown',taskKey);doc.removeEventListener('pointerdown',outside);stack.removeEventListener('pointerenter',stackEnter);stack.removeEventListener('pointerleave',stackLeave);stack.removeEventListener('focusin',syncStack);stack.removeEventListener('focusout',stackFocusOut);taskNodes.clear();taskStates.clear();},{once:true});
 return U.assemblyComposer;
}
