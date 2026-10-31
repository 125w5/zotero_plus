/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountConversationFiles} from '../../chrome/content/zotero/research/shared/conversation-files.mjs';

// The history list shows VIEW px; each conversation row is ROW px tall.
const ROW=37,VIEW=150;
class Node extends EventTarget{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this._text='';this.className='';this.value='';this.scrollTop=0;}
 get isConnected(){return this.root||!!this.parentElement?.isConnected;}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value??'');}
 get classList(){return {add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].filter(Boolean).join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');}};}
 append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}removeAttribute(key){delete this.attributes[key];}
 matches(selector){const [,cls,key,value]=selector.match(/^\.([\w-]+)(?:\[([\w-]+)=([\w-]+)\])?$/u)||[];if(!cls)return selector==='*'||selector===this.tagName;return this.className.split(' ').includes(cls)&&(!key||this.attributes[key]===value);}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 get isHistory(){return this.className.split(' ').includes('conversation-files-history');}
 get clientHeight(){return this.isHistory&&!this.hidden&&this.ownerDocument.shown?VIEW:0;}
 getClientRects(){return this.ownerDocument.shown?[{}]:[];}
 getBoundingClientRect(){if(this.isHistory)return {top:0,bottom:VIEW};const list=this.parentElement,top=list.children.indexOf(this)*ROW-list.scrollTop;return {top,bottom:top+ROW};}
}
function fixture({shown=true}={}){
 const observers=[];
 class ResizeObserver{constructor(fn){this.fn=fn;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}}
 const win=new EventTarget();Object.assign(win,{AbortController,setTimeout,clearTimeout,ResizeObserver});
 const doc={defaultView:win,shown,createElementNS:(_ns,tag)=>new Node(doc,tag)};doc.documentElement=new Node(doc,'html');doc.documentElement.root=true;doc.head=new Node(doc,'head');doc.body=new Node(doc,'body');doc.documentElement.append(doc.head,doc.body);doc.querySelector=selector=>doc.documentElement.querySelector(selector);
 const host=new Node(doc,'aside');doc.body.append(host);
 // Twenty-four conversations, newest last in storage; the rail lists newest first.
 const sessions=Array.from({length:24},(_,index)=>({id:'s'+(index+1),title:'对话 '+(index+1)}));let current='s2';
 const E={chatAttachments:{get:()=>[]},workbenchConversations:{get:id=>sessions.find(row=>row.id===id)}};
 const rail=mountConversationFiles({host,E,getSessionID:()=>current,getSessions:()=>sessions,onSession:id=>{current=id;}});
 const history=rail.root.querySelector('.conversation-files-history');
 const currentRow=()=>{const row=history.querySelector('.conversation-files-session[aria-current=true]'),rect=row.getBoundingClientRect();return {id:row.dataset.sessionID,top:rect.top,bottom:rect.bottom};};
 return {doc,rail,history,observers,currentRow,select(id){current=id;rail.render();}};
}

test('the current conversation is scrolled into the history list without moving other scrollers',()=>{
 const f=fixture(),row=f.currentRow();
 assert.equal(row.id,'s2');assert.equal(f.history.scrollTop,23*ROW-VIEW,'an older current conversation is brought to the bottom edge of the list');
 assert.ok(row.top>=0&&row.bottom<=VIEW,'the selected row is fully visible');
 f.history.scrollTop=0;f.rail.render();assert.equal(f.history.scrollTop,0,'later updates keep the position the user scrolled to');
 f.select('s10');assert.equal(f.currentRow().bottom,VIEW,'selecting another conversation reveals it once');
 f.select('s23');assert.equal(f.currentRow().top,0,'a row above the view is revealed at the top edge');
 const before=f.history.scrollTop;f.select('s22');assert.equal(f.history.scrollTop,before,'a visible current row does not move the list');
 f.rail.destroy();assert.equal(f.observers[0].disconnected,true);
});

test('a rail mounted on a hidden page reveals the current conversation when it is shown',()=>{
 const f=fixture({shown:false});
 assert.equal(f.history.scrollTop,0,'a hidden list has no height to scroll');
 f.doc.shown=true;f.observers[0].fn();
 assert.equal(f.history.scrollTop,23*ROW-VIEW);assert.equal(f.observers[0].target,f.history);
 f.history.scrollTop=0;f.observers[0].fn();assert.equal(f.history.scrollTop,0,'resizing afterwards keeps the user position');
 f.rail.destroy();
});
