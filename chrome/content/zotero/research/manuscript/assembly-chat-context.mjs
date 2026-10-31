/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {citedSources,questionForAnswer} from '../shared/chat-evidence.mjs';
import {installMediaPreview,disposeMediaPreviews} from '../shared/media-preview.mjs';
import {explicitFormula} from '../shared/material-content.mjs';
import {libraryAsset} from '../shared/material-access.mjs';
const ICON_PATHS={chat:['M4 4h16v12H9l-5 4Z'],plus:['M12 5v14M5 12h14'],file:['M6 3h8l4 4v14H6Z','M14 3v5h4M9 12h6m-6 4h6'],link:['m9 15 6-6','M8 13 5 16a3 3 0 0 0 4 4l4-4M16 11l3-3a3 3 0 0 0-4-4l-4 4'],save:['M6 3h12v18l-6-4-6 4Z'],pin:['m9 3 6 0-1 6 4 4v2H6v-2l4-4Z','M12 15v6'],close:['m7 7 10 10M17 7 7 17'],grip:['M8 5v0m8 0v0M8 12v0m8 0v0M8 19v0m8 0v0'],send:['M12 19V5m-6 6 6-6 6 6'],settings:['M5 7h14M5 17h14M9 4v6m6 4v6'],chevron:['m7 9 5 5 5-5']};
export function assemblyChatIcon(doc,name){
 const ns='http://www.w3.org/2000/svg',icon=doc.createElementNS(ns,'svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width',name==='grip'?'4':'1.6');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
 for(const data of ICON_PATHS[name]||ICON_PATHS.chat){const path=doc.createElementNS(ns,'path');path.setAttribute('d',data);icon.append(path);}return icon;
}
export function answerEvidence(session){
 const message=[...(session?.messages||[])].reverse().find(m=>m.role==='assistant');
 return citedSources(message);
}
export function installAssemblyChatContext(U,{el,button,status,persist}){
 const sessionHost=U.$('ai-session-tools'),evidenceHost=U.$('ai-evidence'),contextHost=U.$('ai-session-context');
 const report=job=>Promise.resolve(job).catch(error=>status(error.message,true));
 const scope={projectID:U.p.id};
 // The original material/details panes remain visible until a user opens a
 // real card stack. Merely having history, papers or citations does not cover
 // either pane. Drag previews are temporary and never become saved state.
 const requested={left:false,right:false},frames=new Map();let dragSide=null,evidenceCount;
 const syncRails=()=>{
  for(const [side,frame]of frames){const visible=!!U.p.ui.aiOpen&&!!U.p.ui[side==='left'?'leftOpen':'rightOpen']&&(requested[side]||dragSide===side);frame.hidden=!visible;frame.setAttribute('aria-hidden',String(!visible));frame.inert=!visible;frame.dataset.preview=String(!requested[side]&&dragSide===side);}
  choices.setAttribute('aria-expanded',String(U.p.ui.aiOpen?requested.left:!menu.hidden));
  evidenceToggle.hidden=!U.p.ui.aiOpen;evidenceToggle.setAttribute('aria-expanded',String(requested.right));
 };
 const setRail=(side,open=true)=>{
  if(!frames.has(side))return;requested[side]=!!open;
  if(open){U.p.ui[side==='left'?'leftOpen':'rightOpen']=true;U.assemblyCLUI?.setConversation();U.openCoauthor();}
  U.applyPanels();syncRails();
 };
 U.openChatRail=side=>setRail(side,true);U.closeChatRail=side=>setRail(side,false);U.syncChatRails=syncRails;
 // Once the composer installs its task strip, move those existing nodes into
 // one center shell. All three shells then occupy the same CSS grid row; the
 // separate collapse hit rail does not inflate either sidebar's height.
 U.ensureChatMasterShell=()=>{
  const panel=U.$('ai').querySelector('.ai-panel'),taskbar=U.$('assembly-taskbar'),transcript=U.$('ai-history').parentElement;if(!taskbar||!transcript.classList.contains('ai-transcript-frame'))return;
  let master=panel.querySelector('.ai-center-master');if(!master){master=el('div',undefined,'ai-center-master');panel.insertBefore(master,taskbar);}if(taskbar.parentElement!==master)master.append(taskbar);if(transcript.parentElement!==master)master.append(transcript);return master;
 };
 for(const [host,side,label]of [[contextHost,'left','对话与资料'],[evidenceHost,'right','判断依据']]){
  const frame=el('section',undefined,'ai-side-frame');frame.dataset.side=side;frame.hidden=true;frame.setAttribute('aria-label',label);host.before(frame);frame.append(host);host.hidden=false;frames.set(side,frame);
  const controls=el('div',undefined,'chat-side-controls');controls.append(el('span',label,'chat-side-title'));if(side==='right'){evidenceCount=el('small',undefined,'chat-side-count');evidenceCount.hidden=true;evidenceCount.setAttribute('aria-label','当前回答的引用依据数');controls.append(evidenceCount);}else{const create=button('',()=>createSession(),controls,'chat-side-new');create.append(assemblyChatIcon(document,'plus'));create.title='新建研究对话，发送后才保存';create.setAttribute('aria-label','新建研究对话');}const restore=button('',()=>setRail(side,false),controls,'chat-side-close');restore.append(assemblyChatIcon(document,'close'));restore.title=side==='left'?'返回素材与结构':'返回素材详情';restore.setAttribute('aria-label',restore.title);frame.prepend(controls);
 }
 const createSession=()=>report(U.conversations.create({title:'新研究对话',origin:'assembly',projectID:U.p.id}));
 const newSession=button('',createSession,sessionHost,'chat-new-session');newSession.append(assemblyChatIcon(document,'plus'));newSession.title='新建对话，发送后才保存';newSession.setAttribute('aria-label','新建研究对话');
 const choices=el('button',undefined,'chat-session-choice');choices.type='button';choices.title='切换或继承已有对话';choices.setAttribute('aria-haspopup','menu');choices.setAttribute('aria-expanded','false');sessionHost.append(choices);
 const menu=el('div',undefined,'chat-session-menu');menu.hidden=true;menu.setAttribute('role','menu');sessionHost.append(menu);
 const close=()=>{menu.hidden=true;choices.setAttribute('aria-expanded','false');};
 choices.onclick=()=>{if(U.p.ui.aiOpen){close();setRail('left',!requested.left);}else{menu.hidden=!menu.hidden;choices.setAttribute('aria-expanded',String(!menu.hidden));}};
 const evidenceToggle=button('',()=>setRail('right',!requested.right),U.$('footer-actions'),'chat-evidence-toggle');evidenceToggle.id='chat-evidence-toggle';evidenceToggle.append(assemblyChatIcon(document,'link'));evidenceToggle.title='判断依据与论文信息';evidenceToggle.setAttribute('aria-label',evidenceToggle.title);evidenceToggle.setAttribute('aria-controls',evidenceHost.id);
 const outside=e=>{if(!sessionHost.contains(e.target))close();};document.addEventListener('pointerdown',outside);
 sessionHost.onkeydown=e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopPropagation();close();choices.focus();}if(!['ArrowDown','ArrowUp'].includes(e.key)||menu.hidden)return;e.preventDefault();const items=[...menu.querySelectorAll('button')],i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();};
 const pinKey=pin=>pin.sessionID+':'+pin.messageID;
 const expandedPins={left:'',right:''};
 const savedPins=()=>Array.isArray(U.p.ui.aiPinnedMessages)?U.p.ui.aiPinnedMessages:[];
 const savedEvidencePins=()=>Array.isArray(U.p.ui.aiPinnedEvidence)?U.p.ui.aiPinnedEvidence:[];
 const evidencePinKey=pin=>pin.materialID?'material:'+pin.materialID:pin.sessionID+':'+pin.sourceID;
 const resolveEvidencePin=pin=>{
  if(pin.materialID){const material=U.p.materials.find(row=>row.id===pin.materialID)||libraryAsset(U.A,pin.materialID);if(material)return {...material,id:material.id,materialID:material.id,stableID:'material:'+material.id,...material.anchor};return null;}
  return U.conversations.get(pin.sessionID)?.messages.flatMap(row=>row.sources||[]).find(source=>(source.stableID||source.id)===pin.sourceID)||null;
 };
 const pinEvidence=async(reference,side='right')=>{
  const pin={...(reference.materialID?{materialID:reference.materialID}:{sessionID:reference.sessionID,sourceID:reference.sourceID}),side:side==='left'?'left':'right'};
  if(!resolveEvidencePin(pin))throw Error('这份依据已不可用，请重新选择。');
  U.p.ui.aiPinnedEvidence=[...savedEvidencePins().filter(row=>evidencePinKey(row)!==evidencePinKey(pin)),pin].slice(-30);setRail(pin.side,true);update();await persist();
 };
 const pinMessage=async(reference,side='right')=>{
  const session=U.conversations.get(reference.sessionID),message=session?.messages.find(value=>value.id===reference.messageID);
  if(!message?.text?.trim())throw Error('这条消息已不可用，请重新选择。');
  const pin={sessionID:session.id,messageID:message.id,side:side==='left'?'left':'right'},pins=savedPins().filter(value=>pinKey(value)!==pinKey(pin));
  U.p.ui.aiPinnedMessages=[...pins,pin].slice(-30);expandedPins[pin.side]=pinKey(pin);setRail(pin.side,true);update();await persist();
 };
 U.pinResearchMessage=pinMessage;
 const removePin=async pin=>{U.p.ui.aiPinnedMessages=savedPins().filter(value=>pinKey(value)!==pinKey(pin));update();await persist();};
 const renderPins=(host,side)=>{
  const pins=savedPins().filter(pin=>pin.side===side).slice().reverse().map(pin=>({pin,session:U.conversations.get(pin.sessionID)})).filter(value=>value.session?.messages.some(message=>message.id===value.pin.messageID));if(!pins.length)return;
  if(expandedPins[side]!=='__collapsed__'&&!pins.some(({pin})=>pinKey(pin)===expandedPins[side]))expandedPins[side]=pinKey(pins[0].pin);
  const group=el('section',undefined,'chat-pinned-group');group.setAttribute('aria-label','固定对话片段');host.append(group);group.append(el('h3','固定片段'));
  for(const {pin,session}of pins){const message=session.messages.find(value=>value.id===pin.messageID),card=el('article',undefined,'chat-pinned-card');card.dataset.messageId=message.id;card.dataset.sessionId=session.id;card.dataset.expanded=String(expandedPins[side]===pinKey(pin));group.append(card);
   const heading=el('header',undefined,'chat-pinned-heading');card.append(heading);const locate=button('',async()=>{await U.conversations.select(session.id,{scope});U.openCoauthor();const row=[...U.$('chat').children].find(row=>row.dataset.messageID===message.id);row?.scrollIntoView({block:'nearest'});},heading,'chat-pinned-locate');locate.append(assemblyChatIcon(document,'chat'),el('span',session.title||'研究对话'));locate.title='回到这条对话';
   const expand=button('',()=>{const key=pinKey(pin);expandedPins[side]=expandedPins[side]===key?'__collapsed__':key;card.dataset.expanded=String(expandedPins[side]===key);for(const other of group.querySelectorAll('.chat-pinned-card')){const open=other===card&&expandedPins[side]===key;other.dataset.expanded=String(open);other.querySelector('.chat-pin-expand')?.setAttribute('aria-expanded',String(open));const pane=other.querySelector('.chat-pin-body');pane.inert=!open;pane.setAttribute('aria-hidden',String(!open));}},heading,'chat-pin-expand');expand.append(assemblyChatIcon(document,'chevron'));expand.title='展开或收起固定片段';expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-expanded',card.dataset.expanded);
   const remove=button('',()=>removePin(pin),heading,'chat-pin-remove');remove.append(assemblyChatIcon(document,'close'));remove.title='取消固定，原消息保留';remove.setAttribute('aria-label',remove.title);
   const bodyFrame=el('div',undefined,'chat-pin-body'),content=el('div',undefined,'chat-pin-body-content');bodyFrame.inert=card.dataset.expanded!=='true';bodyFrame.setAttribute('aria-hidden',String(bodyFrame.inert));bodyFrame.append(content);card.append(bodyFrame);
   const question=message.role==='assistant'?questionForAnswer(session.messages,message):'';if(question)content.append(el('p',question,'chat-pinned-question'));
   const body=el('div',undefined,'chat-pinned-content');content.append(body);U.E.renderContent(body,message.text,{sources:message.sources||[],onSource:source=>U.openResearchCitation(source)});
   // The source text remains selectable; only the compact heading moves the card.
   locate.draggable=true;locate.ondragstart=event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-easysch-research-message',JSON.stringify({sessionID:session.id,messageID:message.id}));event.dataTransfer.setDragImage?.(card,Math.min(card.offsetWidth/2,100),16);};
  }
 };
 const paperLoads=new Map();
 const paperFor=async source=>{
  const id=source.paperItemID||source.anchor?.paperItemID||source.attachmentID||source.anchor?.attachmentID;if(!id)return source;
  if(!paperLoads.has(id)){const task=(async()=>{const item=await window.parent.Zotero.Items.getAsync(id);if(!item||item.deleted)return source;const paper=item.parentItemID?await window.parent.Zotero.Items.getAsync(item.parentItemID):item;await paper.loadDataType('itemData');return {...source,...U.E.library.describe(paper)};})();paperLoads.set(id,task);task.catch(()=>paperLoads.delete(id));for(const key of [...paperLoads.keys()].slice(0,-40))paperLoads.delete(key);}
  return paperLoads.get(id);
 };
 const renderPapers=(host,linked)=>{
  const papers=[...linked.values()].filter(source=>source.paperItemID||source.anchor?.paperItemID||source.attachmentID||source.paperTitle||source.doi||source.journal);if(!papers.length)return;
  const group=el('section',undefined,'chat-paper-group');host.append(group);group.append(el('h3','相关论文'));
  for(const source of papers.slice(0,8)){const card=el('article',undefined,'chat-paper-card');group.append(card);
   const fill=paper=>{if(!card.isConnected)return;card.replaceChildren(el('strong',paper.paperTitle||paper.title||source.paperTitle||source.label||'论文'));const meta=[paper.authors,paper.journal,paper.year||paper.date].filter(Boolean);if(meta.length)card.append(el('p',meta.join(' · ')));const doi=paper.doi||paper.DOI;if(doi)card.append(el('small','DOI '+doi));};fill(source);paperFor(source).then(fill).catch(()=>{});
  }
 };
 const EVIDENCE_MIME='application/x-easysch-chat-evidence';
 const renderEvidenceCard=(host,source,pin=null)=>{
  const id=source.materialID||(/^(?:material:)/.test(source.stableID||'')?source.stableID.slice(9):source.id),material=U.p.materials.find(m=>m.id===id)||libraryAsset(U.A,id);
  const card=el('article',undefined,'chat-evidence-card');host.append(card);const row=button('',()=>U.previewResearchSource(source),card,'chat-evidence-source'),location=el('small',Number.isInteger(source.pageIndex??source.anchor?.pageIndex)?'第 '+((source.pageIndex??source.anchor?.pageIndex)+1)+' 页':'引用来源');location.prepend(assemblyChatIcon(document,'link'));row.append(location,el('strong',material?.title||source.title||source.label||'来源片段'));row.title='查看依据 · 拖动标题可固定到另一侧';row.dataset.sourceId=source.stableID||String(id||'');row.draggable=true;
  row.ondragstart=event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(EVIDENCE_MIME,JSON.stringify(material?{materialID:material.id}:{sessionID:pin?.sessionID||U.conversationSession.id,sourceID:source.stableID||source.id}));event.dataTransfer.setDragImage?.(card,Math.min(card.offsetWidth/2,100),16);};
  if(pin){card.dataset.pinnedSource=evidencePinKey(pin);const remove=button('',()=>{U.p.ui.aiPinnedEvidence=savedEvidencePins().filter(value=>evidencePinKey(value)!==evidencePinKey(pin));update();return persist();},card,'chat-pin-remove');remove.append(assemblyChatIcon(document,'close'));remove.title='取消固定，原依据保留';remove.setAttribute('aria-label',remove.title);}
  const excerpt=source.quote||source.sourceText||source.text||source.abstract||material?.summary;if(excerpt){const body=el('div',undefined,'chat-evidence-excerpt');card.append(body);U.E.renderContent(body,String(excerpt));}
  const mediaPath=material?.imagePath||source.imagePath,tex=material?explicitFormula(material):'';
  const original=button('查看原文',()=>U.E.notebook.openSource(source),card,'quiet-action');original.dataset.action='open-evidence-source';original.title='明确打开此依据的原始来源';
  if(tex){const formula=el('div',undefined,'chat-evidence-media chat-evidence-formula');card.append(formula);U.E.renderContent(formula,'$$'+tex+'$$');installMediaPreview(formula,{content:()=>formula.cloneNode(true),onLocate:()=>U.E.notebook.openSource(source),onError:e=>status(e.message,true)});}
  else if(mediaPath){const image=el('img');image.alt=material?.title||source.label||'证据图片';image.className='chat-evidence-media';card.append(image);U.E.previewImage(mediaPath).then(url=>{if(image.isConnected)image.src=url;}).catch(()=>{});installMediaPreview(image,{alt:image.alt,onLocate:()=>U.E.notebook.openSource(source),onError:e=>status(e.message,true)});}
 };
 const renderPinnedEvidence=(host,side)=>{
  const pins=savedEvidencePins().filter(pin=>pin.side===side).map(pin=>({pin,source:resolveEvidencePin(pin)})).filter(row=>row.source);if(!pins.length)return;
  const group=el('section',undefined,'chat-pinned-group');group.append(el('h3','固定依据'));host.append(group);for(const {pin,source}of pins)renderEvidenceCard(group,source,pin);
 };
 let contextSignature='',sessionMenuSignature='';
 const update=()=>{
  const session=U.conversationSession;if(!session)return;
  const sessions=U.conversationSessions||U.conversations.list(),menuSignature=JSON.stringify([session.id,session.isDraft,session.title,sessions.map(item=>[item.id,item.title,item.projectID,item.sourceID])]);
  if(menuSignature!==sessionMenuSignature){sessionMenuSignature=menuSignature;choices.replaceChildren(el('span',session.isDraft?'新对话':session.title||'研究对话'),assemblyChatIcon(document,'chevron'));menu.replaceChildren();
   for(const item of sessions){const current=item.id===session.id;const control=button('',()=>{close();return U.conversations.select(item.id,{scope});},menu,'chat-session-item');control.setAttribute('role','menuitemradio');control.setAttribute('aria-checked',String(current));control.append(el('span',item.title),el('small',item.projectID===U.p.id?'本项目':item.sourceID?'论文对话':'已有对话'));}
   if(!sessions.length)menu.append(el('small','发送首条消息后，对话会保留在这里。','muted'));
  }
  const last=session.messages?.at(-1),signature=JSON.stringify([menuSignature,session.messages?.length,last?.id,last?.text,last?.sources,session.selectedSource,session.attachments,savedPins(),savedEvidencePins()]);if(signature===contextSignature){syncRails();return;}contextSignature=signature;
  const linked=new Map();for(const source of [session.selectedSource,...(session.attachments||[]),...(session.messages||[]).flatMap(m=>m.sources||[])].filter(Boolean)){const key=source.paperItemID||source.anchor?.paperItemID||source.attachmentID||source.id;if(key&&!linked.has(key))linked.set(key,source);}
  disposeMediaPreviews(contextHost);contextHost?.replaceChildren();if(contextHost){
   renderPins(contextHost,'left');renderPinnedEvidence(contextHost,'left');
   const list=el('nav',undefined,'chat-context-sessions');list.setAttribute('aria-label','已有研究对话');contextHost.append(list);
   const recent=sessions.slice().reverse();const currentIndex=recent.findIndex(item=>item.id===session.id);if(currentIndex>=30)recent.unshift(recent.splice(currentIndex,1)[0]);
   for(const item of recent.slice(0,30)){const row=button(item.title||'研究对话',()=>report(U.conversations.select(item.id,{scope})),list,'chat-context-session'),icon=assemblyChatIcon(document,'chat');icon.classList.add('chat-context-icon');row.prepend(icon);row.setAttribute('aria-current',String(item.id===session.id));row.title=item.title||'研究对话';}
   if(session.isDraft)list.append(el('small','新对话 · 发送后保留','chat-context-muted'));
   const materials=el('section',undefined,'chat-context-materials');contextHost.append(materials);
   if(linked.size){materials.append(el('h3','本次资料'));for(const source of [...linked.values()].slice(0,20)){const row=button('',()=>report(U.E.notebook.openSource(source)),materials,'chat-context-file'),icon=assemblyChatIcon(document,'file');icon.classList.add('chat-context-icon');row.append(icon,el('span',source.paperTitle||source.title||source.label||source.name||'论文来源'),el('small',source.kind==='image'?'图片':source.filename||source.kind==='file'?'文件':'论文'));row.title=source.paperTitle||source.title||source.label||source.name||'';const attachment=(session.attachments||[]).find(a=>a.id===source.id);if(attachment){const grip=el('span',undefined,'assembly-file-grip');grip.draggable=true;grip.title='拖到论文当前位置，关联此文件';grip.setAttribute('aria-label',grip.title);grip.append(assemblyChatIcon(document,'grip'));grip.ondragstart=e=>U.dragResearchAttachment?.(e,attachment);row.prepend(grip);}}}
  }
  disposeMediaPreviews(evidenceHost);evidenceHost.replaceChildren();renderPins(evidenceHost,'right');renderPinnedEvidence(evidenceHost,'right');const sources=answerEvidence(session);
  evidenceCount.hidden=!sources.length;evidenceCount.textContent=String(sources.length);evidenceCount.title='当前回答引用了 '+sources.length+' 份依据';
  for(const source of sources)renderEvidenceCard(evidenceHost,source);
  renderPapers(evidenceHost,linked);
  // The user opened this card; say why it is empty instead of showing a blank panel.
  if(!evidenceHost.childElementCount)evidenceHost.append(el('p',session.messages?.some(m=>m.role==='assistant')?'当前回答没有引用来源。':'回答引用的来源会显示在这里，也可拖入消息或素材固定。','chat-evidence-empty'));
  syncRails();
 };
 const pinTypes=['application/x-easysch-research-message',EVIDENCE_MIME,'application/x-manuscript-material','application/x-manuscript-evidence'];
 const hasMessage=event=>Array.from(event.dataTransfer?.types||[]).some(type=>pinTypes.includes(type));
 const targetSide=event=>{
  const inside=event.target?.closest?.('.ai-side-frame');if(inside)return inside.dataset.side;
  const bounds=(U.$('ai').querySelector('.ai-center-master')||U.$('ai')).getBoundingClientRect();if(!U.p.ui.aiOpen||event.clientY<bounds.top||event.clientY>bounds.bottom)return null;
  for(const [side,id]of [['left','left'],['right','right']]){const node=U.$(id),rect=node.getBoundingClientRect();if(!node.hidden&&event.clientX>=rect.left&&event.clientX<=rect.right)return side;}return null;
 };
 const showPinTargets=event=>{
  if(!hasMessage(event))return;dragSide=event.type==='dragstart'?null:targetSide(event);
  for(const [side,frame]of frames){if(dragSide===side){frame.dataset.pinDropAvailable='true';frame.dataset.pinDrop='true';}else{delete frame.dataset.pinDropAvailable;delete frame.dataset.pinDrop;}}
  syncRails();if(dragSide){event.preventDefault();event.dataTransfer.dropEffect='copy';}
 };
 const hidePinTargets=()=>{dragSide=null;for(const frame of frames.values()){delete frame.dataset.pinDropAvailable;delete frame.dataset.pinDrop;}syncRails();};
 const dropOnRail=event=>{
  if(!hasMessage(event))return;const side=targetSide(event);if(!side){hidePinTargets();return;}event.preventDefault();event.stopImmediatePropagation();
  try{const data=event.dataTransfer,raw=data.getData('application/x-easysch-research-message'),evidence=data.getData(EVIDENCE_MIME),materialID=data.getData('application/x-manuscript-material'),blockID=data.getData('application/x-manuscript-evidence');
   if(raw)report(pinMessage(JSON.parse(raw),side));
   else if(evidence)report(pinEvidence(JSON.parse(evidence),side));
   else if(materialID)report(pinEvidence({materialID},side));
   else if(blockID){const block=U.p.blocks.find(value=>value.id===blockID);for(const material of block?.materials||[])report(pinEvidence({materialID:material.id},side));}
  }catch(error){status(error.message,true);}hidePinTargets();
 };
 document.addEventListener('dragstart',showPinTargets);document.addEventListener('dragover',showPinTargets,true);document.addEventListener('dragend',hidePinTargets);document.addEventListener('drop',dropOnRail,true);document.addEventListener('drop',hidePinTargets);
 U.updateMessagePinTargets=event=>event.type==='dragstart'?showPinTargets(event):hidePinTargets();
 const onClick=e=>{if(U.assemblyCLUI||!U.p.ui.aiOpen||U.$('ai').contains(e.target)||e.target.closest('#ai-form,#ai-session-tools,#toggle-ai,.conversation-surface,.conversation-surface-preferences,#assembly-ai-layer,#popover'))return;U.$('ai').dataset.unfocused='true';};
 const onDouble=e=>{if(U.assemblyCLUI||!U.p.ui.aiOpen||U.$('ai').contains(e.target)||e.target.closest('#ai-form,#ai-session-tools,#toggle-ai,.conversation-surface,.conversation-surface-preferences,#assembly-ai-layer,#popover'))return;U.closeCoauthor();};
 const wake=()=>delete U.$('ai').dataset.unfocused;
 document.addEventListener('click',onClick,true);document.addEventListener('dblclick',onDouble,true);U.$('ai').addEventListener('pointerdown',wake);U.$('ai-form').addEventListener('pointerdown',wake);
 U.updateChatContext=update;update();
 window.addEventListener('pagehide',event=>{if(event.target!==document)return;document.removeEventListener('pointerdown',outside);document.removeEventListener('click',onClick,true);document.removeEventListener('dblclick',onDouble,true);document.removeEventListener('dragstart',showPinTargets);document.removeEventListener('dragover',showPinTargets,true);document.removeEventListener('dragend',hidePinTargets);document.removeEventListener('drop',dropOnRail,true);document.removeEventListener('drop',hidePinTargets);paperLoads.clear();},{once:true});
 return {update};
}
