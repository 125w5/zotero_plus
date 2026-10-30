/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/sidebar.js',import.meta.url),'utf8');
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.listeners=new Map();this.style={};this.value='';this.scrollHeight=0;this.scrollTop=0;this.clientHeight=0;this.classList={add(){},remove(){}};}
 get isConnected(){return true;}
 append(...nodes){for(const child of nodes){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...nodes){this.replacements=(this.replacements||0)+1;this.children=[];this.append(...nodes);}
 before(){}
 after(){}
 closest(){return null;}
 querySelector(selector){const match=node=>selector==='.'+node.className;const visit=node=>match(node)?node:node.children.map(visit).find(Boolean);return this.children.map(visit).find(Boolean);}
 setAttribute(key,value){this[key]=value;}
 addEventListener(name,fn){this.listeners.set(name,fn);}
}
async function fixture(){
 const calls={scopedReads:0,sessionReads:0,paperReads:0,linksReads:0,lists:0},timers=new Map();let listener,options,sequence=0;
 const doc={activeElement:null,addEventListener(){},createElementNS:(_ns,tag)=>new Element(tag,doc)},body=new Element('body',doc);
 doc.defaultView={setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}}};
 let current={id:'a',paperID:7,title:'本论文',draft:'',messages:[{id:'m1',role:'user',text:'研究问题'}]},other={id:'b',paperID:8,title:'另一个论文',draft:'',messages:[]};
 const S={getForScope(scope,snapshot){if(!snapshot){calls.scopedReads++;return structuredClone(current);}const id=snapshot.scopeSessions?.['paper:'+scope.paperID];return snapshot.sessions.find(row=>row.id===id)||snapshot.sessions.find(row=>row.paperID===scope.paperID);},list(value){calls.lists++;assert.equal(value.summary,true,'sidebar history never requests all conversations with their transcripts');return [current,other].map(({id,title})=>({id,title}));},get(id){calls.sessionReads++;return structuredClone([current,other].find(row=>row.id===id));},subscribe(fn,value){listener=fn;options=value;return()=>{listener=null;};},update:async()=>{}};
 const peeks=[];calls.paperPeeks=0;
 const R={workbenchConversations:S,store:{branchRevision:()=>1,get(branch,id){assert.ok(branch,'sidebar must never clone the complete workspace');if(branch==='papers'){calls.paperReads++;assert.equal(id,'paper-7');return {records:[]};}if(branch==='sentenceLinks'){calls.linksReads++;return {};}throw Error('unexpected branch '+branch);},
  peek(...path){if(path[0]!=='papers')throw Error('unexpected peek '+path[0]);calls.paperPeeks++;peeks.push(path);return path[2]==='records'?[]:{records:[]};}},library:{describe:()=>({id:7})},core:{paperKey:()=> 'paper-7'},paperConversation:()=>({questions:[]}),materialSourceInfo:()=>({}),completePaperMetadata:async()=>{},ensurePaperMetrics:async()=>{},openPaperConversation:async()=>current,ai:{cancel(){}}};
 const modules={
  'paper-overview.mjs':{installPaperOverview(){}},
  'conversation-interactions.mjs':{installConversationInteractions:()=>({root:new Element('div',doc),setSession(){},cancel(){},destroy(){}})},
  'prompt-templates.mjs':{installPromptTemplates:()=>true}
 };
 vm.runInNewContext(source,{IOUtils:{},Zotero:{Research:R,Reader:{getByTabID:()=>null},logError:error=>{throw error;}},ChromeUtils:{importESModule:url=>modules[url.split('/').at(-1)]}});
 R.renderSidebar(doc,body,{id:7});await new Promise(resolve=>setImmediate(resolve));
 const box=body.querySelector('.academic-chat'),prompt=box.children.find(row=>row.tagName==='form').children.find(row=>row.tagName==='textarea'),messages=body.querySelector('.academic-chat-messages'),select=body.querySelector('.academic-session-select');
 return {R,calls,peeks,options,box,prompt,messages,select,doc,timers,get current(){return current;},setCurrent(value){current=value;},setOther(value){other=value;},emit(meta,selectedID=current.id){listener?.({activeSessionID:selectedID,scopeSessions:{'paper:7':current.id},sessions:[structuredClone(current),structuredClone(other)]},meta);}};
}

test('paper sidebar avoids all-workspace reads, unrelated transcript renders and history option rebuilding',async()=>{
 const f=await fixture(),row=f.messages.children[0],before={...f.calls},replacements=f.select.replacements;
 assert.equal(f.options.summary,true);assert.equal(f.options.sessionID(),'a');
 for(let index=0;index<60;index++)f.emit({sessionID:'b',action:'update',fields:['draft']});
 assert.deepEqual(f.calls,before,'60 draft changes in another paper perform no scoped session, record or history reads');assert.equal(f.messages.children[0],row);assert.equal(f.select.replacements,replacements);
 f.setOther({id:'b',paperID:8,title:'已重命名的论文',messages:[]});f.emit({sessionID:'b',action:'rename',fields:['title']});assert.equal(f.select.replacements,replacements+1);assert.equal(f.messages.children[0],row,'a changed history title does not replace this transcript');assert.equal(f.calls.paperReads,before.paperReads);
 f.box._updateResearch();f.box._updateResearch();assert.equal(f.calls.linksReads,1,'unchanged native pane updates reuse the sentence-link branch');f.box._disposeResearch();
});
test('the paper sidebar reads the kept analysis records in place instead of cloning the paper entry',async()=>{
 const f=await fixture();
 assert.equal(f.calls.paperReads,0,'no copy of the paper entry and all its records');
 assert.deepEqual(f.peeks,[['papers','paper-7','records']]);
 f.box._disposeResearch();
});

test('paper sidebar typing reads the cached session ID while current transcript edits still render',async()=>{
 const f=await fixture(),before=f.calls.scopedReads,row=f.messages.children[0];f.doc.activeElement=f.prompt;
 for(let index=0;index<60;index++){f.prompt.value='继续输入'+index;f.prompt.listeners.get('input')();}
 assert.equal(f.calls.scopedReads,before,'60 keystrokes do not clone the entire conversation');assert.equal(f.timers.size,1,'only the final pending draft save remains');
 f.setCurrent({...f.current,draft:'来自另一处的草稿'});f.emit({sessionID:'a',action:'update',fields:['draft']});assert.equal(f.prompt.value,'继续输入59','a remote draft does not overwrite the focused editor');assert.equal(f.messages.children[0],row);
 f.setCurrent({...f.current,messages:[...f.current.messages,{id:'m2',role:'user',text:'新的论证条件'}]});f.emit({sessionID:'a',action:'update',fields:['messages']});assert.equal(f.messages.children.length,2,'current conversation content changes remain visible');assert.equal(f.calls.scopedReads,before,'the subscription supplies its full current session without another detached read');f.box._disposeResearch();
});
