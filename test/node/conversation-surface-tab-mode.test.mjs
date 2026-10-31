/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Tab in the shared conversation input steps to the next research task. The
// task menu only shows the choice: the caret stays in the input, so repeated
// Tab keeps stepping and Enter sends, and a polite status line names the new
// task for screen readers. Opening the menu from its button still moves focus
// into the menu for the arrow keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { WORKBENCH_MODES } from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';

let source=fs.readFileSync(new URL('../../chrome/content/zotero/research/shared/conversation-surface.mjs',import.meta.url),'utf8');
let lines=source.split(/\r?\n/),line=prefix=>{let hits=lines.filter(value=>value.startsWith(prefix));assert.equal(hits.length,1,'one line starts with '+prefix);return hits[0];};
let syncStart=lines.findIndex(value=>value.startsWith(' const syncPreferences=()=>{')),syncEnd=lines.indexOf(' };',syncStart);
assert.ok(syncStart>=0&&syncEnd>syncStart,'syncPreferences is still a block');
// The status line that names the task chosen by Tab; the tests below check that it exists.
let announcementLines=lines.filter(value=>value.startsWith(' const taskAnnouncement='));
// The menu and key handling of installConversationSurface, in source order.
let script=[...announcementLines,line(' const label=(control,text)=>'),line(' const closeAnchoredPreferences='),line(' const hideControls='),line(' const showMenu='),...lines.slice(syncStart,syncEnd+1),
	line(' const savePreferences='),line(' for(const task of WORKBENCH_MODES)'),line(' const showModes='),line(' modeButton.onclick='),line(" input.addEventListener('keydown'"),line(' for(const menu of [sessionMenu,modeMenu,more,executionMenu])'),
	announcementLines.length?'__surface.taskAnnouncement=taskAnnouncement;':''].join('\n');

class FakeElement {
	constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};this.listeners={};this.className='';this.textContent='';this.title='';this.id='';}
	setAttribute(name,value){this.attributes[name]=String(value);}
	getAttribute(name){return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}
	addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
	append(...nodes){for(let child of nodes){child.parentElement?.children.splice(child.parentElement.children.indexOf(child),1);child.parentElement=this;this.children.push(child);}}
	replaceWith(next){let parent=this.parentElement,index=parent.children.indexOf(this);next.parentElement?.children.splice(next.parentElement.children.indexOf(next),1);parent.children[index]=next;next.parentElement=parent;this.parentElement=null;}
	contains(node){for(let value=node;value;value=value.parentElement)if(value===this)return true;return false;}
	matches(selector){
		if(selector==='[hidden]')return this.hidden;
		if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
		let data=/^\[data-([a-z]+)(?:="([^"]*)")?\]$/.exec(selector);
		if(data)return Object.hasOwn(this.dataset,data[1])&&(data[2]===undefined||this.dataset[data[1]]===data[2]);
		return this.tagName===selector.toUpperCase();
	}
	closest(selector){if(this.matches(selector))return this;return this.parentElement?.closest(selector)||null;}
	querySelectorAll(selector){let found=[],walk=node=>{for(let child of node.children){if(child.matches(selector))found.push(child);walk(child);}};walk(this);return found;}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	focus(){this.ownerDocument.activeElement=this;}
	click(){this.onclick?.({target:this});}
}

function surface(){
	let doc={activeElement:null},node=(tag,cls,parent)=>{let value=new FakeElement(doc,tag);value.className=cls||'';parent?.append(value);return value;};
	let icon=(_doc,name)=>{let value=new FakeElement(doc,'svg');value.dataset.icon=name;return value;};
	let button=(_doc,text,title,kind)=>{let value=new FakeElement(doc,'button');value.title=title||text;if(kind)value.append(icon(doc,kind));if(text){let label=node('span','conversation-control-label',value);label.textContent=text;}return value;};
	let root=node('div','conversation-surface'),footer=node('form','conversation-surface-footer',root),composer=node('div','conversation-surface-composer',footer),input=node('textarea','conversation-surface-input',composer),toolbar=node('div','conversation-surface-toolbar',composer);
	let modeButton=button(doc,'自动','选择研究任务 · 在输入框按 Tab 切换','auto'),executionButton=button(doc,'Auto','应用操作权限','shield'),modelButton=button(doc,'模型','选择已配置模型','model'),strengthButton=button(doc,'标准','调整思考强度','strength');
	toolbar.append(modeButton,executionButton,modelButton,strengthButton);
	let modeMenu=node('div','conversation-surface-mode-menu',footer),more=node('div','conversation-surface-more-menu',footer),executionMenu=node('div','conversation-surface-execution-menu',footer),sessionMenu=node('div','conversation-surface-session-menu',root);
	modeMenu.hidden=more.hidden=executionMenu.hidden=sessionMenu.hidden=true;
	let modelOptions=node('div','conversation-surface-model-options',more),strengthOptions=node('div','conversation-surface-strength-options',more);
	let preferencePopover=node('section','conversation-preferences-popover');preferencePopover.id='easysch-conversation-preferences';preferencePopover.hidden=true;
	let choices=button(doc,'研究对话','切换或新建研究对话','chat'),states=[],submits=0;
	footer.requestSubmit=()=>{submits++;};
	let exposed={};
	let context={doc,WORKBENCH_MODES,button,icon,node,__surface:exposed,taskIcon:id=>id,wake(){},positionAnchoredPreferences(){},showPreferences(){},onState:value=>states.push(value),
		session:{id:'s1',mode:'auto',messages:[]},composing:false,lastPreferences:'',preferenceAnchor:null,preferenceReturnFocus:null,modelValues:[],strengths:[['off','标准'],['low','轻量'],['medium','深入']],
		root,footer,input,modeButton,executionButton,modelButton,strengthButton,choices,modeMenu,more,executionMenu,sessionMenu,modelOptions,strengthOptions,preferencePopover};
	vm.runInNewContext(script,context);
	// Dispatch to the focused control and bubble, as a keyboard does. Enter on a
	// focused button that nothing handled activates it.
	let key=(name,options={})=>{let target=doc.activeElement,event={key:name,keyCode:0,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,isComposing:false,...options,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
		for(let value=target;value;value=value.parentElement)for(let fn of value.listeners.keydown||[])fn(event);
		if(name==='Enter'&&!event.defaultPrevented&&target?.tagName==='BUTTON')target.click();};
	let item=mode=>modeMenu.querySelector(`[data-mode="${mode}"]`);
	// A short name for the focused control keeps failure messages readable.
	let focused=()=>{let value=doc.activeElement;return value===input?'input':value?.dataset.mode?'task:'+value.dataset.mode:value?value.tagName.toLowerCase():'nothing';};
	return {context,doc,input,modeButton,modeMenu,footer,preferencePopover,states,key,item,get announcement(){return exposed.taskAnnouncement;},get focused(){return focused();},get session(){return context.session;},get submits(){return submits;}};
}

test('Tab in the input steps through every research task and the caret stays in the input',()=>{
	let f=surface();f.input.focus();
	f.key('Tab',{isComposing:true});
	assert.equal(f.session.mode,'auto','Tab during IME composition does not switch tasks');assert.equal(f.modeMenu.hidden,true);
	for(let step=1;step<=WORKBENCH_MODES.length;step++){
		let expected=WORKBENCH_MODES[step%WORKBENCH_MODES.length];
		f.key('Tab');
		assert.equal(f.session.mode,expected.id,'Tab '+step+' selects '+expected.id);
		assert.equal(f.focused,'input','Tab '+step+' leaves focus in the input');
		assert.equal(f.modeMenu.hidden,false,'the task menu shows the choice');
		assert.ok(f.modeMenu.parentElement===f.preferencePopover,'the menu opens in the shared popover');
		assert.equal(f.modeButton.getAttribute('aria-expanded'),'true');
		assert.equal(f.modeButton.querySelector('.conversation-control-label').textContent,expected.label);
		assert.deepEqual(f.modeMenu.children.filter(control=>control.getAttribute('aria-checked')==='true').map(control=>control.dataset.mode),[expected.id],'the menu marks the current task');
		assert.equal(f.announcement?.textContent,'研究任务：'+expected.label,'Tab '+step+' announces '+expected.label+' while focus stays in the input');
	}
	assert.equal(f.states.at(-1).mode,'auto','the last choice is saved');
});

test('the task announced after Tab is a polite status line that stays present and adds nothing to the layout',()=>{
	let f=surface();
	assert.ok(f.announcement,'installConversationSurface creates the announcement line');
	assert.equal(f.announcement.getAttribute('role'),'status');assert.equal(f.announcement.getAttribute('aria-live'),'polite');
	assert.equal(f.announcement.hidden,false,'the line is never hidden, so a change of its text is read');
	assert.ok(f.footer.contains(f.announcement),'the line belongs to the input form');
	assert.ok(f.announcement.className.split(' ').includes('conversation-surface-announcement'),'its class keeps it visually hidden');
	assert.equal(f.announcement.textContent,'','nothing is announced before a task changes');
	f.input.focus();f.key('Tab',{isComposing:true});
	assert.equal(f.announcement.textContent,'','Tab during IME composition announces nothing');
	f.key('Tab');f.key('Enter');
	assert.equal(f.announcement.textContent,'研究任务：查找文献','Enter sends with the task that was announced');assert.equal(f.submits,1);
});

test('Enter after Tab sends the question with the task chosen by Tab',()=>{
	let f=surface();f.input.focus();
	f.key('Tab');f.key('Enter');
	assert.equal(f.submits,1,'Enter in the input sends');
	assert.equal(f.session.mode,'search','Enter does not reset the task chosen by Tab');
	assert.equal(f.focused,'input');
});

test('the task button opens the menu for the arrow keys, and clicking a task selects it',()=>{
	let f=surface();f.input.focus();
	f.modeButton.click();
	assert.equal(f.modeMenu.hidden,false);assert.equal(f.focused,'task:auto','the button moves focus into the menu');
	f.key('ArrowDown');assert.equal(f.focused,'task:search');
	f.key('ArrowUp');f.key('ArrowUp');assert.equal(f.focused,'task:layout','the arrow keys wrap around');
	f.key('Enter');
	assert.equal(f.session.mode,'layout');assert.equal(f.modeMenu.hidden,true);assert.equal(f.focused,'input','choosing returns to the input');assert.equal(f.submits,0,'choosing a task does not send');
	f.modeButton.click();f.modeButton.click();
	assert.equal(f.modeMenu.hidden,true,'a second click closes the menu');
	f.input.focus();f.key('Tab');assert.equal(f.session.mode,'auto');
	f.item('organize').click();
	assert.equal(f.session.mode,'organize','a click on a task after Tab selects it');assert.equal(f.modeMenu.hidden,true);assert.ok(f.modeMenu.parentElement===f.footer,'the menu leaves the popover');assert.equal(f.focused,'input');
});
