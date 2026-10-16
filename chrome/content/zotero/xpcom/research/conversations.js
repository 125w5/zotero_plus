/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const C=ChromeUtils.importESModule('chrome://zotero/content/research/shared/conversation-store.mjs');
 const A=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-attachments.mjs');
 const L=ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-scope.mjs');
 const listeners=new Map(),drafts=new Map(),baselines=new Map(),fileCache=new Map();let queue=Promise.resolve(),activeID='',scopeSelections={};const clone=C.cloneConversationValue;
 const filesFor=session=>{if(!session)return [];const cached=fileCache.get(session.id);if(cached?.attachments===session.attachments&&cached.libraryFiles===session.libraryFiles)return cached.value;const value=A.conversationFileReferences(session);fileCache.set(session.id,{attachments:session.attachments,libraryFiles:session.libraryFiles,value});return value;};
 let cachedRevision,cachedRawSignature,cachedSignature,cachedState,cachedSessions=new Map();
 const storeRevision=()=>E.store.branchRevision?.('researchWorkbench')??E.store.revision;
 // The store's public reads are detached JSON copies. Reuse our private,
 // normalized branch until a successful store write changes its revision.
 // Alternate/legacy stores without revisions retain a content check.
 const persisted=()=>{
  const revision=storeRevision();if(typeof revision==='number'&&cachedState&&revision===cachedRevision)return cachedState;
  const raw=E.store.get('researchWorkbench')||{},signature=JSON.stringify(raw);
  if(!cachedState||signature!==cachedRawSignature){cachedState=C.normalizeConversations(raw);cachedSessions=new Map(cachedState.sessions.map(session=>[session.id,session]));cachedSignature=JSON.stringify(cachedState);cachedRawSignature=signature;}
  cachedRevision=revision;return cachedState;
 };
 const createDraft=fields=>{
  const id=fields.id||'conversation-'+Zotero.Utilities.randomString(16),session={title:'新研究对话',messages:[],attachments:[],mode:'auto',selectedID:'',draft:'',projectID:'',origin:'workbench',createdAt:new Date().toISOString(),...clone(fields),id,isDraft:true};
  session.messages=C.normalizeMessages(session.messages,id);session.attachments=A.normalizeChatAttachments(session.attachments);drafts.set(id,session);baselines.set(id,new Set(session.messages.map(message=>message.id)));return session;
 };
 const view=()=>{
  const saved=persisted(),state={...saved,sessions:[...saved.sessions,...[...drafts.values()].filter(session=>!cachedSessions.has(session.id))],scopeSessions:{...saved.scopeSessions,...scopeSelections}};
  if(!state.sessions.length){const session=createDraft({});state.sessions.push(clone(session));scopeSelections.workbench=session.id;state.scopeSessions.workbench=session.id;}
  state.activeSessionID=state.sessions.some(session=>session.id===activeID)?activeID:state.sessions.some(session=>session.id===state.activeSessionID)?state.activeSessionID:state.sessions[0].id;
  return state;
 };
 const summarize=session=>({...Object.fromEntries(['id','title','currentTask','sourceID','projectID','paperID','pptDraftID','libraryScopeKey','libraryFolder','libraryCollectionID','libraryLibraryID','origin','isDraft','modelID','thinkingLevel','executionMode','mode','createdAt','updatedAt','inheritedFrom'].filter(key=>session[key]!==undefined).map(key=>[key,session[key]])),messageCount:session.messages?.length||0,attachmentCount:(session.attachments?.length||0)+(session.libraryFiles?.length||0)});
 const projectState=(state,{summary=false,sessionID}={})=>{if(!summary)return state;const id=typeof sessionID==='function'?sessionID():sessionID;return {...state,sessions:state.sessions.map(session=>session.id===state.activeSessionID||session.id===id?session:summarize(session))};};
 const snapshot=(options={})=>clone(projectState(view(),options));
 const emit=(state,meta)=>{for(const [listener,options]of listeners)try{listener(clone(projectState(state,options)),meta);}catch(error){Zotero.logError(error);}};
 const change=(mutate,meta={})=>{const next=queue.then(async()=>{
  const before=persisted(),current=view(),state={...current,sessions:current.sessions.map(session=>session.id===meta.sessionID?{...session}:session),scopeSessions:{...current.scopeSessions},home:{...current.home},migrations:{...current.migrations}},result=mutate(state);
  const saved={...state,sessions:state.sessions.filter(session=>!session.isDraft).map(session=>{const value={...session};delete value.isDraft;return value;})};
  const ids=new Set(saved.sessions.map(session=>session.id));saved.scopeSessions=Object.fromEntries(Object.entries(state.scopeSessions||{}).filter(([,id])=>ids.has(id)));
  saved.activeSessionID=ids.has(state.activeSessionID)?state.activeSessionID:ids.has(before.activeSessionID)?before.activeSessionID:saved.sessions[0]?.id||'';
  const signature=JSON.stringify(saved);if(signature!==cachedSignature){if(E.store.replaceBranch)await E.store.replaceBranch('researchWorkbench',saved);else await E.store.update(data=>{data.researchWorkbench=saved;});cachedState=saved;cachedSessions=new Map(saved.sessions.map(session=>[session.id,session]));cachedSignature=cachedRawSignature=signature;cachedRevision=storeRevision();}
  drafts.clear();for(const session of state.sessions.filter(session=>session.isDraft))drafts.set(session.id,session);
  const liveIDs=new Set(state.sessions.map(session=>session.id));for(const id of fileCache.keys())if(!liveIDs.has(id))fileCache.delete(id);
  for(const id of [...baselines.keys()])if(!drafts.has(id))baselines.delete(id);
  activeID=state.activeSessionID;scopeSelections={...state.scopeSessions};emit(state,meta);return clone(meta.returnSummary?projectState(state,{summary:true}):result===undefined?state:result);
 });queue=next.catch(()=>{});return next;};
 const sessionIn=(state,id)=>{const session=state.sessions.find(value=>value.id===id);if(!session)throw Error('研究对话不存在，请重新选择。');return session;};
 const promote=(session,messages)=>{if(session.isDraft&&messages.some(message=>message.role==='user'&&String(message.text||'').trim()&&!baselines.get(session.id)?.has(message.id)))delete session.isDraft;};
 const newSession=(state,fields,{activate=true}={})=>{
  if(fields.id&&state.sessions.some(session=>session.id===fields.id))throw Error('研究对话编号重复。');
  const prior=C.conversationForScope(state,fields)||state.sessions.find(session=>session.id===state.activeSessionID),preferences=Object.fromEntries(['mode','modelID','thinkingLevel','executionMode'].filter(key=>prior?.[key]!==undefined).map(key=>[key,prior[key]]));
  const id=fields.id||'conversation-'+Zotero.Utilities.randomString(16),session={title:'新研究对话',messages:[],attachments:[],mode:'auto',selectedID:'',draft:'',projectID:'',origin:'workbench',createdAt:new Date().toISOString(),...preferences,...clone(fields),id,isDraft:true};
  session.messages=C.normalizeMessages(session.messages,id);session.attachments=A.normalizeChatAttachments(session.attachments);baselines.set(id,new Set(session.messages.map(message=>message.id)));
  state.sessions.push(session);if(activate)state.activeSessionID=id;state.scopeSessions[C.conversationScope(fields)]=id;return session;
 };
 const S=E.workbenchConversations={
  snapshot,list:({includeDrafts=false,summary=false}={})=>{const rows=view().sessions.filter(session=>includeDrafts||!session.isDraft);return clone(summary?rows.map(summarize):rows);},get:id=>{persisted();return clone(cachedSessions.get(id)||drafts.get(id)||null);},
  getAttachments:(id,{selectedOnly=false}={})=>{persisted();const refs=filesFor(cachedSessions.get(id)||drafts.get(id));return clone(selectedOnly?refs.filter(row=>row.selected!==false):refs);},
  getAttachmentNotice:id=>{persisted();return (cachedSessions.get(id)||drafts.get(id))?.attachmentLimitNotice||'';},
  getActive:state=>state?state.sessions.find(session=>session.id===state.activeSessionID):S.get(view().activeSessionID),
  getForScope:(scope,state)=>state?C.conversationForScope(state,scope):clone(C.conversationForScope(view(),scope)),
  subscribe(listener,options={}){listeners.set(listener,options);return()=>listeners.delete(listener);},
  create(fields={},options={}){return change(state=>newSession(state,fields,options),{origin:fields.origin||'workbench',action:'create-draft'});},
  open(fields={},options={}){return change(state=>{
   const scope=C.conversationScope(fields),current=!options.fresh&&C.conversationForScope(state,scope);
   if(current){if(options.activate!==false)state.activeSessionID=current.id;state.scopeSessions[scope]=current.id;return current;}
   return newSession(state,fields,options);
  },{origin:fields.origin||'workbench',action:'open'});},
  async inherit(id,fields={}){const prior=S.get(id);if(!prior||prior.isDraft)throw Error('请先选择一段已有对话。');return S.create({title:'延续 · '+(fields.title||prior.title||'研究对话').slice(0,24),mode:prior.mode,modelID:prior.modelID,thinkingLevel:prior.thinkingLevel,executionMode:prior.executionMode||'auto',projectID:prior.projectID||'',...clone(fields),messages:clone(prior.messages),attachments:clone(prior.attachments||[]),inheritedFrom:prior.id,draft:''});},
  update(id,patch,meta={}){return change(state=>{const session=sessionIn(state,id),messages=C.normalizeMessages(patch?.messages||[],id);promote(session,messages);if(typeof patch?.draft==='string'&&patch.draft.trim())delete session.isDraft;if(Object.hasOwn(patch||{},'libraryFiles'))session.attachmentRevision=(session.attachmentRevision||0)+1;return C.patchConversation(state,id,{...patch,...(patch?.messages?{messages}:{})});},{sessionID:id,action:'update',...meta,fields:Object.keys(patch||{})});},
  syncLibraryScope(id,scope,{signal}={}){return change(state=>{const session=sessionIn(state,id);if(signal?.aborted)return session;const files=L.libraryScopeReferences(session,scope.files);if(JSON.stringify(files)!==JSON.stringify(session.libraryFiles||[])){session.libraryFiles=files;session.attachmentRevision=(session.attachmentRevision||0)+1;}Object.assign(session,{libraryScopeKey:scope.key,libraryFolder:scope.folder,libraryCollectionID:scope.collectionID||null,libraryLibraryID:scope.libraryID||null});return session;},{sessionID:id,action:'library-scope',origin:'library-scope'});},
  attach(id,items,meta={}){return change(state=>{
   const session=sessionIn(state,id),files=filesFor(session),current=new Map(files.map(row=>[row.id,row]));let selected=files.filter(row=>row.selected!==false).length,unselected=0;
   const incoming=A.normalizeChatAttachments(items).map(row=>{
    const prior=current.get(row.id),next=prior?{...row,...A.chatAttachmentState(prior)}:row;
    if(prior?.selected!==false&&prior)return next;
    if(row.selected===false)return next;
    if(selected>=A.CHAT_ATTACHMENT_LIMIT){unselected++;return {...next,selected:false};}
    selected++;return {...next,selected:true};
   });
   session.attachments=A.mergeChatAttachments(session.attachments,incoming);if(incoming.length)delete session.isDraft;session.attachmentLimitNotice=unselected?'已保存，选用已达 12 份；取消勾选后可选用新文件。':'';const added=new Set(incoming.map(item=>item.id));session.detachedAttachments=(session.detachedAttachments||[]).filter(key=>!added.has(key));session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();return session.attachments;
  },{sessionID:id,action:'attach',...meta});},
  detach(id,attachmentID,meta={}){return change(state=>{const session=sessionIn(state,id);session.attachments=session.attachments.filter(value=>value.id!==attachmentID);if(session.libraryFiles)session.libraryFiles=session.libraryFiles.filter(value=>value.id!==attachmentID);session.detachedAttachments=[...new Set([...(session.detachedAttachments||[]),attachmentID])];session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();delete session.isDraft;return A.conversationFileReferences(session);},{sessionID:id,action:'detach',...meta});},
  updateAttachment(id,attachmentID,patch={},meta={}){return change(state=>{
   const session=sessionIn(state,id),field=session.attachments.some(value=>value.id===attachmentID)?'attachments':'libraryFiles';session[field]=(session[field]||[]).map(value=>value.id===attachmentID?{...value}:value);const row=session[field].find(value=>value.id===attachmentID);if(!row)throw Error('这份资料已从当前对话移除，请重新选择。');
   if(patch.selected===true&&row.selected===false&&filesFor(session).filter(value=>value.selected!==false).length>=A.CHAT_ATTACHMENT_LIMIT)throw Error('本次最多选用 12 份资料，请先取消部分资料，再选择这一份。');
   for(const key of ['selected','featured'])if(Object.hasOwn(patch,key))row[key]=patch[key]===true;
   if(Object.hasOwn(patch,'sheet')){if(typeof patch.sheet!=='string'||patch.sheet.length>200)throw Error('工作表名称无效。');if(patch.sheet)row.sheet=patch.sheet;else delete row.sheet;}
   if(Object.hasOwn(patch,'ranges')){if(!Array.isArray(patch.ranges)||patch.ranges.length>3||patch.ranges.some(value=>typeof value!=='string'||!/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/i.test(value)))throw Error('请输入单元格范围，例如 A1:F50，最多 3 处。');if(patch.ranges.length)row.ranges=patch.ranges.map(value=>value.toUpperCase());else delete row.ranges;}
   row.stateVersion=(row.stateVersion||0)+1;session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();delete session.isDraft;fileCache.delete(id);return session.attachments;
  },{sessionID:id,attachmentID,action:'attachment-state',...meta});},
  append(id,message,meta={}){const next={at:new Date().toISOString(),...clone(message),id:message.id||'message-'+Zotero.Utilities.randomString(16)};return S.update(id,{messages:[next]},meta).then(()=>next);},
  select(id,{scope,signal,summary=false}={}){return change(state=>{if(signal?.aborted)return state;const session=sessionIn(state,id);state.activeSessionID=id;state.scopeSessions[C.conversationScope(scope||session)]=id;return state;},{sessionID:id,action:'select',returnSummary:summary});},
  updateHome(patch){return change(state=>{state.home={...state.home,...clone(patch)};return state;},{action:'home'});},
  remove(id){return change(state=>{state.sessions=state.sessions.filter(session=>session.id!==id);for(const [scope,selected]of Object.entries(state.scopeSessions))if(selected===id)delete state.scopeSessions[scope];if(!state.sessions.some(session=>session.id===state.activeSessionID)){if(!state.sessions.length){const draft=createDraft({});state.sessions.push(clone(draft));state.scopeSessions.workbench=draft.id;}state.activeSessionID=state.sessions[0].id;}return state;},{sessionID:id,action:'remove'});},
  importLegacy(key,messages,fields={}){return change(state=>{
   if(state.migrations[key])return state.sessions.find(session=>session.id===state.migrations[key])||null;
   if(!messages?.length){state.migrations[key]='empty';return null;}
   const id='conversation-legacy-'+Zotero.Utilities.randomString(16),session={title:'研究对话',origin:'legacy',mode:'auto',draft:'',attachments:[],createdAt:new Date().toISOString(),...clone(fields),id,messages:C.normalizeMessages(messages,id)};
   const scope=C.conversationScope(fields),prior=C.conversationForScope(state,scope);state.sessions.push(session);state.migrations[key]=id;if(!prior)state.scopeSessions[scope]=id;return session;
  },{action:'migration',origin:fields.origin||'legacy'});}
 };
})(Zotero.Research);
