/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {mountConversationQuestionChoices} from './conversation-question-choices.mjs';
const HTML='http://www.w3.org/1999/xhtml';

// Application decisions stay in their owning conversation. Moving or closing
// a surface must resolve any pending interaction, never leave Pi waiting on a
// detached card or let a different conversation approve an older operation.
export function installConversationInteractions({doc,host,renderContent,onSource=()=>{},onOpen=()=>{},onError=()=>{}}) {
 const node=(tag,cls,text)=>{const value=doc.createElementNS(HTML,tag);value.className=cls||'';if(text!==undefined)value.textContent=text;return value;};
 if(!doc.querySelector('[data-easysch-interaction-style]')){const style=node('link');style.rel='stylesheet';style.href='chrome://zotero/content/research/shared/conversation-interactions.css';style.dataset.easyschInteractionStyle='true';(doc.head||doc.documentElement).append(style);}
 const root=node('div','conversation-interaction-host');root.hidden=true;root.setAttribute('aria-live','polite');host.append(root);
 const pending=new Set();let sessionID='',disposed=false;
 const cancelAll=()=>{for(const cancel of [...pending])cancel();};
 const request=(value,type)=>new Promise(resolve=>{
  const cancelled=type==='permission'?false:{action:'cancel'};
  if(disposed||value.signal?.aborted||(value.sessionID!==undefined&&value.sessionID!==sessionID)){resolve(cancelled);return;}
  const owner=sessionID,card=node('article','conversation-interaction-card');card.dataset.sessionId=owner;card.setAttribute('role','group');card.setAttribute('aria-label',type==='permission'?'确认应用操作':'研究选择');
  card.append(node('strong','conversation-interaction-heading',type==='permission'?'确认应用操作':'选择下一步'));
  const text=node('div','conversation-interaction-text');if(renderContent)renderContent(text,type==='permission'?value.description||value.label:value.question);else text.textContent=type==='permission'?value.description||value.label:value.question;card.append(text);
  if(type==='question'&&value.basis){const basis=node('div','conversation-interaction-basis');if(renderContent)renderContent(basis,value.basis);else basis.textContent=value.basis;card.append(basis);}
  const actions=node('div','conversation-interaction-actions');card.append(actions);root.hidden=false;root.append(card);if(!root.isConnected)host.append(root);
  let settled=false,questionControls;const finish=result=>{if(settled)return;settled=true;questionControls?.destroy();pending.delete(cancel);value.signal?.removeEventListener('abort',cancel);card.remove();root.hidden=!pending.size;resolve(result);},cancel=()=>finish(cancelled);pending.add(cancel);value.signal?.addEventListener('abort',cancel,{once:true});
  const choice=(label,result,cls='')=>{const button=node('button',cls,label);button.type='button';button.onclick=()=>{if(owner!==sessionID){cancel();return;}finish(result);};actions.append(button);return button;};
  if(type==='permission'){choice('允许一次',true,'conversation-interaction-primary');choice('取消',false);}
  else questionControls=mountConversationQuestionChoices({doc,host:actions,options:value.options,sources:value.sources,onSource,onError,onAnswer:finish,onRegenerate:finish,onCancel:cancel,isCurrent:()=>!settled&&owner===sessionID,classes:{option:'conversation-interaction-option',custom:'conversation-interaction-custom',regenerate:'conversation-interaction-regenerate'}});
  try{onOpen();}catch(error){onError(error);}doc.defaultView?.requestAnimationFrame?.(()=>{if(!settled&&card.isConnected)card.scrollIntoView?.({block:'nearest',behavior:'smooth'});});
 });
 const destroy=()=>{if(disposed)return;disposed=true;cancelAll();root.remove();doc.defaultView?.removeEventListener('pagehide',destroy);};doc.defaultView?.addEventListener('pagehide',destroy,{once:true});
 return {root,requestToolPermission:value=>request(value,'permission'),requestResearchQuestion:value=>request(value,'question'),cancel:cancelAll,setSession(id){if(id!==sessionID){cancelAll();sessionID=id||'';}},restore(){if(!disposed&&!root.isConnected)host.append(root);},destroy};
}
