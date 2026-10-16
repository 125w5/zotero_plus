/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const C=ChromeUtils.importESModule('chrome://zotero/content/research/shared/conversation-store.mjs');
 const A=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-attachments.mjs');
 const listeners=new Set(),drafts=new Map(),baselines=new Map();let queue=Promise.resolve(),activeID='',scopeSelections={};const clone=value=>JSON.parse(JSON.stringify(value));
 const createDraft=fields=>{
  const id=fields.id||'conversation-'+Zotero.Utilities.randomString(16),session={title:'新研究对话',messages:[],attachments:[],mode:'auto',selectedID:'',draft:'',projectID:'',origin:'workbench',createdAt:new Date().toISOString(),...clone(fields),id,isDraft:true};
  session.messages=C.normalizeMessages(session.messages,id);session.attachments=A.normalizeChatAttachments(session.attachments);drafts.set(id,session);baselines.set(id,new Set(session.messages.map(message=>message.id)));return session;
 };
 const snapshot=()=>{
  const state=C.normalizeConversations(E.store.get('researchWorkbench')||{}),savedIDs=new Set(state.sessions.map(session=>session.id));state.sessions.push(...clone([...drafts.values()].filter(session=>!savedIDs.has(session.id))));state.scopeSessions={...state.scopeSessions,...scopeSelections};
  if(!state.sessions.length){const session=createDraft({});state.sessions.push(clone(session));scopeSelections.workbench=session.id;state.scopeSessions.workbench=session.id;}
  state.activeSessionID=state.sessions.some(session=>session.id===activeID)?activeID:state.sessions.some(session=>session.id===state.activeSessionID)?state.activeSessionID:state.sessions[0].id;
  return state;
 };
 const emit=(state,meta)=>{for(const listener of listeners)try{listener(clone(state),meta);}catch(error){Zotero.logError(error);}};
 const change=(mutate,meta={})=>{const next=queue.then(async()=>{
  const state=snapshot(),before=C.normalizeConversations(E.store.get('researchWorkbench')||{}),result=mutate(state);
  const saved={...state,sessions:state.sessions.filter(session=>!session.isDraft).map(session=>{const value={...session};delete value.isDraft;return value;})};
  const ids=new Set(saved.sessions.map(session=>session.id));saved.scopeSessions=Object.fromEntries(Object.entries(state.scopeSessions||{}).filter(([,id])=>ids.has(id)));
  saved.activeSessionID=ids.has(state.activeSessionID)?state.activeSessionID:ids.has(before.activeSessionID)?before.activeSessionID:saved.sessions[0]?.id||'';
  if(JSON.stringify(saved)!==JSON.stringify(before))await E.store.update(data=>{data.researchWorkbench=saved;});
  drafts.clear();for(const session of state.sessions.filter(session=>session.isDraft))drafts.set(session.id,clone(session));
  for(const id of [...baselines.keys()])if(!drafts.has(id))baselines.delete(id);
  activeID=state.activeSessionID;scopeSelections={...state.scopeSessions};emit(state,meta);return clone(result===undefined?state:result);
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
  snapshot,list:({includeDrafts=false}={})=>snapshot().sessions.filter(session=>includeDrafts||!session.isDraft),get:id=>snapshot().sessions.find(session=>session.id===id)||null,
  getActive:(state=snapshot())=>state.sessions.find(session=>session.id===state.activeSessionID),
  getForScope:(scope,state=snapshot())=>C.conversationForScope(state,scope),
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  create(fields={},options={}){return change(state=>newSession(state,fields,options),{origin:fields.origin||'workbench',action:'create-draft'});},
  open(fields={},options={}){return change(state=>{
   const scope=C.conversationScope(fields),current=!options.fresh&&C.conversationForScope(state,scope);
   if(current){if(options.activate!==false)state.activeSessionID=current.id;state.scopeSessions[scope]=current.id;return current;}
   return newSession(state,fields,options);
  },{origin:fields.origin||'workbench',action:'open'});},
  async inherit(id,fields={}){const prior=S.get(id);if(!prior||prior.isDraft)throw Error('请先选择一段已有对话。');return S.create({title:'延续 · '+(fields.title||prior.title||'研究对话').slice(0,24),mode:prior.mode,modelID:prior.modelID,thinkingLevel:prior.thinkingLevel,executionMode:prior.executionMode||'auto',projectID:prior.projectID||'',...clone(fields),messages:clone(prior.messages),attachments:clone(prior.attachments||[]),inheritedFrom:prior.id,draft:''});},
  update(id,patch,meta={}){return change(state=>{const session=sessionIn(state,id),messages=C.normalizeMessages(patch?.messages||[],id);promote(session,messages);return C.patchConversation(state,id,{...patch,...(patch?.messages?{messages}:{})});},{sessionID:id,action:'update',...meta,fields:Object.keys(patch||{})});},
  attach(id,items,meta={}){return change(state=>{const session=sessionIn(state,id);session.attachments=A.mergeChatAttachments(session.attachments,items);const added=new Set(items.map(item=>item.id));session.detachedAttachments=(session.detachedAttachments||[]).filter(key=>!added.has(key));session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();return session.attachments;},{sessionID:id,action:'attach',...meta});},
  detach(id,attachmentID,meta={}){return change(state=>{const session=sessionIn(state,id);session.attachments=session.attachments.filter(value=>value.id!==attachmentID);session.detachedAttachments=[...new Set([...(session.detachedAttachments||[]),attachmentID])];session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();return session.attachments;},{sessionID:id,action:'detach',...meta});},
  updateAttachment(id,attachmentID,patch={},meta={}){return change(state=>{
   const session=sessionIn(state,id),row=session.attachments.find(value=>value.id===attachmentID);if(!row)throw Error('这份资料已从当前对话移除，请重新选择。');
   for(const key of ['selected','featured'])if(Object.hasOwn(patch,key))row[key]=patch[key]===true;
   if(Object.hasOwn(patch,'sheet')){if(typeof patch.sheet!=='string'||patch.sheet.length>200)throw Error('工作表名称无效。');if(patch.sheet)row.sheet=patch.sheet;else delete row.sheet;}
   if(Object.hasOwn(patch,'ranges')){if(!Array.isArray(patch.ranges)||patch.ranges.length>3||patch.ranges.some(value=>typeof value!=='string'||!/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/i.test(value)))throw Error('请输入单元格范围，例如 A1:F50，最多 3 处。');if(patch.ranges.length)row.ranges=patch.ranges.map(value=>value.toUpperCase());else delete row.ranges;}
   row.stateVersion=(row.stateVersion||0)+1;session.attachmentRevision=(session.attachmentRevision||0)+1;session.updatedAt=new Date().toISOString();return session.attachments;
  },{sessionID:id,attachmentID,action:'attachment-state',...meta});},
  append(id,message,meta={}){const next={at:new Date().toISOString(),...clone(message),id:message.id||'message-'+Zotero.Utilities.randomString(16)};return S.update(id,{messages:[next]},meta).then(()=>next);},
  select(id,{scope}={}){return change(state=>{const session=sessionIn(state,id);state.activeSessionID=id;state.scopeSessions[C.conversationScope(scope||session)]=id;return state;},{sessionID:id,action:'select'});},
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
