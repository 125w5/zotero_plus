/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {permittedPromptTemplates} from './research-ai-policy.mjs';
export const DEFAULT_PROMPT_TEMPLATES=[
 {id:'search',name:'搜索资料',mode:'search',prompt:'查找与以下问题有关的资料，优先使用本地素材；区分支持与反对证据：\n{内容}'},
 {id:'organize',name:'整理素材与布局',mode:'organize',prompt:'分析现有素材的主题、证据关系和逻辑顺序，提出排序建议，保留所有正文与来源，不代写内容：\n{内容}'},
 {id:'evaluate',name:'评估 Idea',mode:'evaluate',prompt:'评估以下 Idea 的创新性与可行性，查找接近工作和反证，提出最小验证、预处理、防泄漏、基线、消融、鲁棒性及待补项：\n{内容}'},
 {id:'explain',name:'解释所选资料',mode:'source',prompt:'用中文解释所选资料，说明适用条件、局限和证据来源：\n{内容}'}
];
// Keep task instructions separate from the user's editable draft.
export function promptTemplateRequest(input,template,goal=input.value){goal=String(goal||'').trim();return {goal,mode:template.mode,prompt:template.mode==='search'?goal:template.prompt.replaceAll('{内容}',goal)};}
export function installPromptTemplates(doc,E,{selector='[data-ai-prompt],#ai-prompt,#question,#idea,#topic-prompt,#prompt',openOnFocus=true,onSelect=()=>{},onExecute}={}) {
 const create=(tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;};
 const localize=(node,id,fallback,args)=>{node.textContent=fallback;doc.l10n?.setAttributes(node,id,args);};
 if(!doc.querySelector('[data-prompt-style]')){const link=create('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/shared/prompt-templates.css';link.dataset.promptStyle='true';(doc.head||doc.documentElement).append(link);}
 const templates=()=>{const allowed=permittedPromptTemplates((E.store.peek?E.store.peek('promptTemplates'):E.store.get().promptTemplates)||DEFAULT_PROMPT_TEMPLATES);return allowed.length?allowed:DEFAULT_PROMPT_TEMPLATES;};
 const panels=new Set();let running=false;const setBusy=value=>{running=value;for(const panel of panels){panel.setAttribute('aria-busy',String(value));for(const button of panel.querySelectorAll('button'))button.disabled=value;}};
 const bind=input=>{if(input.dataset.promptTemplates)return;input.dataset.promptTemplates='true';const panel=create('div');panel.className='prompt-templates';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','AI 研究操作');doc.l10n?.setAttributes(panel,'prompt-action-group');input.after(panel);panels.add(panel);let closeTimer,composing=false;
  const apply=async t=>{
   if(running)return;const hint=panel.querySelector('[role=status]');
   if(!onExecute){localize(hint,'prompt-action-unavailable','此处暂不能执行研究操作，请使用当前页面的运行按钮。');input.focus();return;}
   setBusy(true);localize(hint,'prompt-action-running','正在执行“'+t.name+'”…',{name:t.name});
   try{const request=promptTemplateRequest(input,t);onSelect(input,t);const result=await onExecute(input,t,request);if(result?.message){hint.removeAttribute('data-l10n-id');hint.removeAttribute('data-l10n-args');hint.textContent=result.message;}else localize(hint,'prompt-action-complete','操作完成，结果已显示。');}
   catch(error){hint.removeAttribute('data-l10n-id');hint.removeAttribute('data-l10n-args');hint.textContent=error.message||String(error);if(!doc.activeElement||panel.contains(doc.activeElement))input.focus();}
   finally{setBusy(false);}
  };
  const edit=()=>{const dialog=create('dialog');dialog.className='prompt-template-editor';dialog.append(create('h3','自定义 AI 模板'));const select=create('select');for(const t of templates()){const o=create('option',t.name);o.value=t.id;select.append(o);}const name=create('input');name.setAttribute('aria-label','模板名称');const prompt=create('textarea');prompt.setAttribute('aria-label','模板提示词，内容占位符为 {内容}');const mode=create('select');for(const [id,label]of [['search','搜索资料'],['organize','整理素材与布局'],['evaluate','Idea 评估'],['source','来源问答']]){const o=create('option',label);o.value=id;mode.append(o);}const fill=()=>{const t=templates().find(t=>t.id===select.value);name.value=t.name;prompt.value=t.prompt;mode.value=t.mode;};select.onchange=fill;fill();dialog.append(select,name,mode,prompt,create('small','{内容} 代表输入框原有文字；确认后才会调用 AI。'));
   const error=create('small');error.setAttribute('role','alert');dialog.append(error);const save=create('button','保存模板');save.type='button';save.onclick=async()=>{if(!name.value.trim()||!prompt.value.trim())return;const candidate={id:select.value,name:name.value.trim(),prompt:prompt.value,mode:mode.value};if(!permittedPromptTemplates([candidate]).length){error.textContent='模板仅支持研究辅助，不能代写正文或生成图片。';return;}await E.store.update(s=>{const stored=s.promptTemplates||DEFAULT_PROMPT_TEMPLATES;if(stored.some(t=>t.id===candidate.id))s.promptTemplates=stored.map(t=>t.id===candidate.id?candidate:t);else s.promptTemplates=[...stored,candidate];});dialog.close();render();};const cancel=create('button','关闭');cancel.type='button';cancel.onclick=()=>dialog.close();dialog.append(save,cancel);(doc.body||doc.documentElement).append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();};
  const render=()=>{panel.replaceChildren();for(const t of templates()){const b=create('button',t.name);b.type='button';b.dataset.template=t.id;b.title=t.prompt;b.onclick=()=>apply(t);panel.append(b);}const custom=create('button');custom.type='button';custom.className='prompt-template-edit';localize(custom,'prompt-action-edit','编辑模板');custom.onclick=edit;panel.append(custom);const hint=create('small');hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');panel.append(hint);setBusy(running);};render();
  const open=()=>{clearTimeout(closeTimer);panel.hidden=false;};if(openOnFocus){input.addEventListener('focus',open);input.addEventListener('pointerdown',open);input.addEventListener('click',open);}panel.addEventListener('focusin',open);
  const close=()=>{closeTimer=setTimeout(()=>{if(doc.activeElement!==input&&!panel.contains(doc.activeElement)&&!running)panel.hidden=true;},150);};input.addEventListener('blur',close);panel.addEventListener('focusout',close);
  input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  // While the list is open, an Esc in the input or the list closes only the list. With it closed, Esc in the input belongs to the page (closing the conversation, stopping a task).
  input.addEventListener('keydown',e=>{if(e.isComposing||composing||e.keyCode===229)return;if(e.key==='Tab'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();e.stopPropagation();open();panel.querySelector('button')?.focus();}else if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopPropagation();panel.hidden=true;}});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.focus();panel.hidden=true;}});
 };
 const scan=()=>doc.querySelectorAll(selector).forEach(bind);scan();const observer=new doc.defaultView.MutationObserver(scan);observer.observe(doc.body||doc.documentElement,{childList:true,subtree:true});const dispose=()=>observer.disconnect();doc.defaultView.addEventListener('pagehide',dispose,{once:true});return {scan,dispose};
}
