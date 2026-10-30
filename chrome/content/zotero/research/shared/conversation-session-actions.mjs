/* SPDX-License-Identifier: AGPL-3.0-or-later */
const HTML='http://www.w3.org/1999/xhtml';
/** In-place names and a local context menu; neither changes the selected scope. */
export function mountSessionActions({root,history,getSession,onSelect,onRename,onRemove,onError}){
	const doc=root.ownerDocument,win=doc.defaultView;
	let editor,menu,menuCleanups=[],disposed=false;
	const node=(tag,cls,text)=>{const value=doc.createElementNS(HTML,tag);value.className=cls;if(text!==undefined)value.textContent=text;return value;};
	const buttonFor=id=>[...history.querySelectorAll('[data-session-id]')].find(button=>button.dataset.sessionId===id||button.dataset.sessionID===id);
	function closeMenu(restore=false){const prior=menu;menu=null;for(const off of menuCleanups.splice(0))off();prior?.remove();if(restore&&prior?._anchor?.isConnected)prior._anchor.focus();}
	function closeEditor(restore=false){const prior=editor;editor=null;if(!prior)return;prior.form.remove();prior.anchor.hidden=false;if(restore){const button=prior.anchor.isConnected?prior.anchor:buttonFor(prior.id);button?.focus();}}
	function rename(id){
		if(disposed)return;const session=getSession(id),anchor=buttonFor(id);if(!session||!anchor)return;
		closeMenu();closeEditor();const form=node('form','conversation-session-name-form'),input=node('input','conversation-session-name'),save=node('button','conversation-session-name-save','保存'),cancel=node('button','conversation-session-name-cancel','取消'),feedback=node('span','conversation-session-name-error');
		input.value=session.title||'';input.maxLength=120;input.setAttribute('aria-label','对话名称');input.setAttribute('data-l10n-id','conversation-session-name');save.type='submit';save.title='保存名称';save.setAttribute('data-l10n-id','conversation-session-save-name');cancel.type='button';cancel.title='取消重命名';cancel.setAttribute('data-l10n-id','conversation-session-cancel-name');feedback.setAttribute('role','alert');form.append(input,save,cancel,feedback);anchor.hidden=true;anchor.after(form);
		const current=editor={id,anchor,form,input,saving:false,composing:false};cancel.onclick=()=>{if(!current.saving)closeEditor(true);};input.oncompositionstart=()=>{current.composing=true;};input.oncompositionend=()=>{current.composing=false;};input.onkeydown=event=>{if(event.key!=='Escape')return;event.stopPropagation();if(event.isComposing||current.composing||event.keyCode===229||current.saving)return;event.preventDefault();closeEditor(true);};
		form.onsubmit=async event=>{event.preventDefault();if(current.saving||current.composing||editor!==current||disposed)return;const title=input.value.replace(/\s+/gu,' ').trim();if(!title){feedback.textContent='请输入对话名称';input.focus();return;}current.saving=true;input.disabled=save.disabled=cancel.disabled=true;feedback.textContent='';
			try{await onRename(id,title);if(editor===current)closeEditor(true);}catch(error){if(editor===current&&!disposed){current.saving=false;input.disabled=save.disabled=cancel.disabled=false;feedback.textContent=error.message||String(error);input.focus();}onError(error);}
		};input.focus();input.select();return input;
	}
	function context(id,anchor,event){
		if(disposed)return;event.preventDefault();event.stopPropagation();closeMenu();
		const session=getSession(id);if(!session)return;menu=node('div','conversation-session-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','对话操作');menu._anchor=anchor;const activeMenu=menu;
		for(const [label,key,run]of [['打开对话','conversation-session-open',()=>onSelect(id)],['重命名','conversation-session-rename',()=>rename(id)],...(onRemove?[['删除对话','conversation-session-remove',()=>onRemove(session)]]:[])]){
			const action=node('button','conversation-session-menu-action',label);action.type='button';action.setAttribute('role','menuitem');action.setAttribute('data-l10n-id',key);action.onclick=()=>{closeMenu();Promise.resolve().then(run).catch(onError);};activeMenu.append(action);
		}
		doc.body.append(activeMenu);const rect=anchor.getBoundingClientRect(),bounds=activeMenu.getBoundingClientRect(),x=event.clientX||rect.left,y=event.clientY||rect.bottom;activeMenu.style.left=Math.max(8,Math.min(x,win.innerWidth-bounds.width-8))+'px';activeMenu.style.top=Math.max(8,Math.min(y,win.innerHeight-bounds.height-8))+'px';
		const outside=event=>{if(!activeMenu.contains(event.target))closeMenu();},key=event=>{if(event.key==='Escape'){event.stopPropagation();if(event.isComposing||event.keyCode===229)return;event.preventDefault();closeMenu(true);return;}if(event.key==='Tab'||!activeMenu.contains(doc.activeElement)){closeMenu();return;}const buttons=[...activeMenu.querySelectorAll('button')],index=buttons.indexOf(doc.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length].focus();}},scroll=()=>closeMenu();
		for(const [target,type,fn]of [[doc,'pointerdown',outside],[doc,'keydown',key],[win,'resize',scroll],[doc,'scroll',scroll]]){target.addEventListener(type,fn,true);menuCleanups.push(()=>target.removeEventListener(type,fn,true));}activeMenu.firstElementChild.focus();
	}
	return{rename,bind(button,session){button.dataset.sessionId=session.id;button.oncontextmenu=event=>context(session.id,button,event);button.ondblclick=event=>{event.preventDefault();rename(session.id);};button.onkeydown=event=>{if(event.key==='F2'){event.preventDefault();rename(session.id);}else if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)context(session.id,button,event);};},destroy(){disposed=true;closeMenu();closeEditor();}};
}
