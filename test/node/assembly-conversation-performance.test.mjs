/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {assemblyConversationRefresh,createAssemblyDraftSaver} from '../../chrome/content/zotero/research/manuscript/assembly-conversation.mjs';

test('draft keystrokes and unrelated task replies do not inspect or repaint the selected transcript',()=>{
 const messages={toJSON(){throw Error('must not serialize an unchanged transcript');}},prior={id:'a',messages,draft:'old',attachments:[],mode:'auto'},next={...prior,draft:'typing'};
 const draft=assemblyConversationRefresh(prior,next,{sessionID:'a',action:'update',fields:['draft']});assert.equal(draft.transcript,false);assert.equal(draft.context,false);assert.equal(draft.attachments,false);assert.equal(draft.draft,true);assert.equal(draft.surface,true);
 const other=assemblyConversationRefresh(prior,next,{sessionID:'b',action:'update',fields:['messages']});assert.equal(other.transcript,false);assert.equal(other.surface,false);assert.equal(other.context,false);
 const renamed=assemblyConversationRefresh(prior,next,{sessionID:'b',action:'update',fields:['title']},true);assert.equal(renamed.context,true);assert.equal(renamed.surface,true);assert.equal(renamed.transcript,false);
});

test('switching tasks refreshes their draft even when the old editor retains keyboard focus',()=>{
 const refresh=assemblyConversationRefresh({id:'a',draft:'unsent first'},{id:'b',draft:'second',messages:[]},{sessionID:'b',action:'select'});assert.equal(refresh.switched,true);assert.equal(refresh.draft,true);assert.equal(refresh.transcript,true);
 const answer=assemblyConversationRefresh({id:'b'},{id:'b'},{sessionID:'b',action:'update',fields:['messages']});assert.equal(answer.transcript,true);assert.equal(answer.draft,false);
});

test('draft saves are scoped, coalesced and flushed before a send clears its draft',async()=>{
 let timer=0;const timers=new Map(),writes=[],saver=createAssemblyDraftSaver({save:async(id,draft)=>writes.push([id,draft]),setTimer:fn=>{timers.set(++timer,fn);return timer;},clearTimer:id=>timers.delete(id)});
 saver.queue('a','first');saver.queue('a','latest');assert.equal(timers.size,1);saver.queue('b','second');await Promise.resolve();assert.deepEqual(writes,[['a','latest']]);await saver.flush();writes.push(['b','']);assert.deepEqual(writes,[['a','latest'],['b','second'],['b','']]);assert.equal(timers.size,0);
 saver.queue('c','last edit');await saver.dispose();assert.deepEqual(writes.at(-1),['c','last edit']);saver.queue('c','closed');assert.equal(timers.size,0);
});

async function transcriptFixture(){
 const calls={render:0,dispose:0,dragDispose:0},nodes={};
 const node=(tag,text='',className='')=>({tag,textContent:text,className,dataset:{},children:[],setAttribute(){},querySelectorAll(){return [];},append(...values){for(const value of values){value.remove?.();this.children.push(value);value.parent=this;}},replaceChildren(...values){for(const child of this.children)child.parent=null;this.children=[];this.append(...values);this.replacements=(this.replacements||0)+1;},insertBefore(value,before){value.remove?.();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,value);value.parent=this;},remove(){if(this.parent){this.parent.children=this.parent.children.filter(value=>value!==this);this.parent=null;}}});
 const U={p:{id:'project',ui:{aiOpen:false},chat:[]},conversationSession:{id:'a',messages:[{id:'q',role:'user',text:'Question'},{id:'a1',role:'assistant',text:'First answer'}]},E:{renderContent:(host,text)=>{calls.render++;host.textContent=text;}}};
 nodes['ai-context']=node('div');nodes.chat=node('div');nodes['ai-history']={scrollTop:700,scrollHeight:1000,clientHeight:300,isConnected:true};
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),start=source.indexOf('export function renderChat(){'),end=source.indexOf('export function showDiff(',start),scope=vm.createContext({U,$:id=>nodes[id],el:node,button:(text,fn,host,cls)=>{const value=node('button',text,cls);host.append(value);return value;},disposeMediaPreviews:()=>calls.dispose++,installMediaPreview:()=>{},applyPanels:()=>{},status:()=>{},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame:()=>{}});
 vm.runInContext(source.slice(start,end).replaceAll('export function ','function ')+'\nthis.renderChat=renderChat;this.disposeChatTranscripts=disposeChatTranscripts;',scope);
 return {U,nodes,calls,render:scope.renderChat,dispose:scope.disposeChatTranscripts};
}

test('appending an answer retains existing message nodes and returning to a task restores its scroll',async()=>{
 const {U,nodes,calls,render,dispose}=await transcriptFixture();render();assert.equal(calls.render,2);const first=nodes.chat.children[1];first.expanded=true;first.disposeResearchDrag=()=>calls.dragDispose++;nodes['ai-history'].scrollTop=170;
 U.conversationSession.messages=JSON.parse(JSON.stringify(U.conversationSession.messages));render();assert.equal(calls.render,2);assert.equal(nodes.chat.replacements,1);
 U.conversationSession.messages.push({id:'a2',role:'assistant',text:'New answer'});render();assert.equal(calls.render,3);assert.equal(nodes.chat.children[1],first);assert.equal(first.expanded,true);assert.equal(nodes['ai-history'].scrollTop,170);
 const messages=U.conversationSession.messages;U.conversationSession={id:'b',messages:[{id:'b1',role:'assistant',text:'Another task'}]};render();assert.equal(calls.render,4);
 U.conversationSession={id:'a',messages:JSON.parse(JSON.stringify(messages))};render();assert.equal(calls.render,4);assert.equal(nodes.chat.children[1],first);assert.equal(nodes['ai-history'].scrollTop,170);
 U.conversationSession.messages[2].text='Corrected answer';render();assert.equal(calls.render,5);assert.equal(nodes.chat.children[1],first);assert.equal(calls.dispose,1);dispose();assert.equal(calls.dragDispose,1);assert.equal(U.chatTranscriptCaches.size,0);
});

test('recent transcript DOM retention is bounded to four tasks and evicts preview/drag handlers',async()=>{
 const {U,nodes,calls,render}=await transcriptFixture();render();nodes.chat.children[1].disposeResearchDrag=()=>calls.dragDispose++;
 for(const id of ['b','c','d','e']){U.conversationSession={id,messages:[{id:id+'1',role:'assistant',text:id}]};render();}
 assert.equal(U.chatTranscriptCaches.size,4);assert.equal(U.chatTranscriptCaches.has('a'),false);assert.equal(calls.dragDispose,1);assert.equal(calls.dispose,2);
});
