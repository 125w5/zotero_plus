/* SPDX-License-Identifier: AGPL-3.0-or-later */
const HTML='http://www.w3.org/1999/xhtml';

// Option data is presentation and an answer only. In particular, a tool name,
// action or an arbitrary option value can never become an application command.
export function researchQuestionOptions(options) {
 const seen=new Set();
 return (Array.isArray(options)?options:[]).flatMap(option=>{
  const label=(typeof option==='string'?option:typeof option?.label==='string'?option.label:'').trim();
  if(!label||seen.has(label))return [];seen.add(label);
  return [{label,description:typeof option?.description==='string'?option.description.trim():''}];
 });
}

// Both the reader/research surface and the assembly console use these actual
// handlers. Choosing a card is a local draft; only Confirm or custom Enter
// returns an answer. There is deliberately no preselected/default answer.
export function mountConversationQuestionChoices({doc,host,options,sources=[],onSource=()=>{},onError=()=>{},onAnswer,onRegenerate,onCancel,isCurrent=()=>true,classes={}}) {
 const node=(tag,cls,text)=>{const n=doc.createElementNS(HTML,tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
 if(!doc.querySelector('[data-easysch-question-style]')){const style=node('link');style.rel='stylesheet';style.href='chrome://zotero/content/research/shared/conversation-question-choices.css';style.dataset.easyschQuestionStyle='true';(doc.head||doc.documentElement).append(style);}
 const root=node('div','conversation-question-controls');host.append(root);
 const list=node('div','conversation-question-options');list.setAttribute('role','group');list.setAttribute('aria-label','研究选项');root.append(list);
 let selected='',disposed=false;
 const current=()=>{if(disposed)return false;if(!isCurrent()){onCancel();return false;}return true;};
 const buttons=[];
 const custom=node('input','conversation-question-custom '+(classes.custom||''));custom.type='text';custom.placeholder='也可以输入你的想法';custom.setAttribute('aria-label','自定义研究选择');
 const footer=node('div','conversation-question-footer'),submit=node('button','conversation-question-submit '+(classes.submit||''),'确认选择');submit.type='button';submit.disabled=true;
 const sync=()=>{for(const [button,label]of buttons)button.setAttribute('aria-pressed',String(label===selected));submit.disabled=!(custom.value?.trim()||selected);};
 for(const option of researchQuestionOptions(options)){
  const button=node('button','conversation-question-option '+(classes.option||''));button.type='button';button.setAttribute('aria-pressed','false');button.append(node('span','conversation-question-label',option.label));if(option.description)button.append(node('small','conversation-question-description',option.description));
  button.onclick=()=>{if(!current())return;selected=option.label;custom.value='';sync();};list.append(button);buttons.push([button,option.label]);
 }
 const answer=()=>{if(!current())return;const value=custom.value?.trim()||selected;if(value)onAnswer({answer:value});};
 custom.oninput=()=>{if(!current())return;selected='';sync();};
 custom.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing&&custom.value?.trim()){event.preventDefault();answer();}};
 submit.onclick=answer;
 const regenerate=node('button','conversation-question-regenerate '+(classes.regenerate||''),'重新生成选项');regenerate.type='button';regenerate.onclick=()=>{if(current())onRegenerate({action:'regenerate'});};
 const cancel=node('button','conversation-question-cancel '+(classes.cancel||''),'取消');cancel.type='button';cancel.onclick=()=>{if(current())onCancel();};
 root.append(custom,footer);footer.append(regenerate,cancel,submit);
 if(Array.isArray(sources)&&sources.length){const refs=node('div','conversation-question-sources');refs.setAttribute('aria-label','本次选择的依据');for(const source of sources.filter(value=>value&&typeof value==='object')){const button=node('button','conversation-question-source',source.title||source.label||'查看依据');button.type='button';button.title=source.title||source.label||'查看依据';button.onclick=()=>{if(current())Promise.resolve().then(()=>current()?onSource(source):undefined).catch(onError);};refs.append(button);}root.append(refs);}
 return {root,destroy(){disposed=true;submit.disabled=true;for(const [button]of buttons)button.disabled=true;}};
}
