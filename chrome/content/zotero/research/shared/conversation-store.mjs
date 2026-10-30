/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {workbenchSessions} from './agent-workbench.mjs';
import {normalizeChatAttachments,mergeChatAttachments} from './chat-attachments.mjs';
export const cloneConversationValue = value => JSON.parse(JSON.stringify(value));
const clone = cloneConversationValue;
function hash(text) {let value=2166136261;for(const char of text){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}return (value>>>0).toString(36);}
export function normalizeMessages(messages=[],prefix='message') {
 const seen=new Set();return messages.filter(value=>value&&typeof value==='object').map((value,index)=>{
  const message=clone(value);message.id=typeof message.id==='string'&&message.id?message.id:`${prefix}-${index}-${hash(JSON.stringify([message.role,message.text,message.at]))}`;
  while(seen.has(message.id))message.id+='-duplicate';seen.add(message.id);return message;
 });
}
export function normalizeConversations(value={}) {
 const source=clone(value||{}),state=workbenchSessions(source,0);
 if(!source.sessions?.length&&state.sessions.length)for(const key of ['modelID','thinkingLevel','executionMode','sourceID','contextID'])if(source[key]!==undefined)state.sessions[0][key]=source[key];
 for(const session of state.sessions){session.messages=normalizeMessages(session.messages||[],session.id);session.attachments=normalizeChatAttachments(session.attachments);session.mode||='auto';session.draft??='';session.origin||='workbench';}
 state.migrations=source.migrations||{};return state;
}
export function conversationScope(value={}) {
 if(typeof value==='string')return value;
 if(value.libraryScopeKey)return (value.pptDraftID?'ppt:'+value.pptDraftID+':':'')+'library:'+value.libraryScopeKey;
 const paperID=value.paperID||value.paperItemID||value.selectedSource?.paperItemID||value.selectedSource?.paperID;
 if(paperID)return 'paper:'+paperID;
 if(value.pptDraftID)return 'ppt:'+value.pptDraftID;
 if(value.projectID)return 'project:'+value.projectID;
 return 'workbench';
}
export function conversationForScope(state,scope) {
 const key=conversationScope(scope),selected=state.sessions.find(session=>session.id===state.scopeSessions?.[key]);
 if(selected)return selected;
 return state.sessions.filter(session=>conversationScope(session)===key).at(-1)||null;
}
// Merge stable message IDs against the latest store instead of replacing a
// transcript from another surface's older snapshot. Old messages and anchors stay.
export function mergeConversationMessages(current,incoming) {
 const messages=normalizeMessages(current),indexes=new Map(messages.map((message,index)=>[message.id,index]));
 for(const message of normalizeMessages(incoming)){
  const index=indexes.get(message.id);if(index===undefined){indexes.set(message.id,messages.length);messages.push(message);}
  else messages[index]={...messages[index],...message};
 }return messages;
}
export function patchConversation(state,id,patch,now=new Date().toISOString()) {
 const session=state.sessions.find(value=>value.id===id);if(!session)throw Error('研究对话不存在，请重新选择。');
 const {id:ignoredID,messages,attachments,detachedAttachments:ignoredDetached,attachmentRevision:ignoredRevision,...fields}=patch||{};Object.assign(session,clone(fields));
 if(attachments){
  const current=new Map(session.attachments.map(item=>[item.id,item]));
  session.attachments=mergeChatAttachments(session.attachments,attachments.filter(item=>!session.detachedAttachments?.includes(item.id)).map(item=>{
   const prior=current.get(item.id);if(!prior)return item;
   const next={...item};for(const key of ['selected','featured','sheet','ranges','stateVersion']){if(Object.hasOwn(prior,key))next[key]=prior[key];else delete next[key];}return next;
  }));
 }
 if(messages)session.messages=mergeConversationMessages(session.messages,messages);
 session.updatedAt=now;
 if(!session.titleManuallySet&&['研究对话','新研究对话'].includes(session.title)&&session.messages.length)session.title=session.messages.find(message=>message.role==='user')?.text?.replace(/\s+/g,' ').slice(0,28)||session.title;
 return session;
}
