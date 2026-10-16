import test from 'node:test';
import assert from 'node:assert/strict';
import {installMessageDrag,RESEARCH_MESSAGE_MIME} from '../../chrome/content/zotero/research/shared/message-transfer.mjs';
import {installAssemblyMessageDrop} from '../../chrome/content/zotero/research/manuscript/message-drop.mjs';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

function dragFixture(){
 const handlers=new Map(),rect={left:10,right:300,top:20,bottom:200},text={nodeType:3,textContent:'可以选中复制的回答'},body={contains:target=>[text,body].includes(target),getBoundingClientRect:()=>rect,closest:()=>null};
 text.parentElement=body;
 const doc={createRange:()=>({selectNodeContents(){},getClientRects:()=>[{left:20,right:180,top:40,bottom:60}]}),caretPositionFromPoint:()=>({offsetNode:text}),createTreeWalker:()=>{let read=false;return{nextNode:()=>read?null:(read=true,text)};}};
 const card={ownerDocument:doc,dataset:{},offsetWidth:300,addEventListener:(type,listener)=>handlers.set(type,listener),removeEventListener:type=>handlers.delete(type)},grip={contains:target=>target===grip,closest:()=>grip};
 const sent=[],dispose=installMessageDrag({card,grip,textRoots:[body],sessionID:'one-paper',messageID:'answer',onDrag:event=>sent.push(event.type)});
 const transfer={data:new Map(),clearData(type){this.data.delete(type);},setData(type,value){this.data.set(type,value);},getData(type){return this.data.get(type)||'';},setDragImage(){}};
 const emit=(type,target=body,point={x:50,y:50})=>{const event={type,target,button:0,clientX:point.x,clientY:point.y,dataTransfer:transfer,stopPropagation(){this.stopped=true;},preventDefault(){this.defaultPrevented=true;}};handlers.get(type)?.(event);return event;};
 return{card,grip,body,transfer,emit,sent,dispose,handlers};
}

test('first text-selection gesture and native selected-text drag do not become answer-card drags',()=>{
 const f=dragFixture();assert.equal(f.card.draggable,false);f.emit('pointerdown');assert.equal(f.card.draggable,false);
 f.transfer.setData('text/plain','选中的短语');const event=f.emit('dragstart');assert.equal(f.transfer.getData('text/plain'),'选中的短语');assert.equal(f.transfer.getData(RESEARCH_MESSAGE_MIME),'');assert.equal(event.defaultPrevented,undefined);assert.deepEqual(f.sent,[]);
});

test('blank answer padding and its grip drag only stable message identities, then restore native text selection',()=>{
 const f=dragFixture();f.emit('pointerdown',f.body,{x:250,y:100});assert.equal(f.card.draggable,true);f.emit('dragstart',f.body,{x:250,y:100});assert.deepEqual(JSON.parse(f.transfer.getData(RESEARCH_MESSAGE_MIME)),{sessionID:'one-paper',messageID:'answer'});assert.equal(f.card.dataset.dragging,'true');f.emit('dragend');assert.equal(f.card.draggable,false);assert.equal(f.card.dataset.dragging,undefined);assert.deepEqual(f.sent,['dragstart','dragend']);
 f.emit('dragstart',f.grip);assert.equal(f.card.dataset.dragging,'true');f.emit('dragend',f.grip);f.dispose();assert.equal(f.handlers.size,0);
});

function assemblyFixture(){
 const handlers=new Map(),project=M.createProject('用户论文'),sectionID=project.sections[0].id;
 project.blocks=[M.block('paragraph',sectionID,{text:'已有人工正文。'}),M.block('paragraph',sectionID,{text:'另一段人工正文。'})];
 const source={stableID:'material:original',paperItemID:51,attachmentID:52,pageIndex:3,position:{rects:[[10,20,100,60]]}},messages=[{id:'question',role:'user',text:'这个公式为什么有该条件？'},{id:'answer',role:'assistant',text:'条件来自原文式(3)。 $x_i^2$ [material:original]',sources:[source]}];
 const material=M.material({id:'saved-answer',kind:'note',title:'公式条件讨论',sourceText:'问题与回答',sourceRefs:[source]}),assets={[material.id]:material},saved=[],statuses=[];
 const docHandlers=new Map(),doc={defaultView:{innerWidth:1200,innerHeight:900},body:{append(){}},createElement:()=>({dataset:{},style:{},setAttribute(){},remove(){}}),addEventListener:(type,listener)=>docHandlers.set(type,listener),removeEventListener:type=>docHandlers.delete(type)};
 const canvas={ownerDocument:doc,dataset:{},querySelectorAll:()=>[],querySelector:()=>null,contains:()=>true,addEventListener:(type,listener)=>handlers.set(type,listener),removeEventListener:type=>handlers.delete(type)};
 const U={p:project,M,A:{assetLibrary:()=>assets},conversations:{get:id=>id==='reader-paper'?{id,messages}:null},saveResearchMessage:async(message,options)=>{saved.push({message,options});return{noteID:99,materialID:material.id};}};
 let snapshots=0,changes=0;const dispose=installAssemblyMessageDrop({U,canvas,paperPosition:()=>({index:1,spaceBefore:14}),snapshot:()=>snapshots++,attachMaterial:(block,id)=>{if(!project.materials.some(value=>value.id===id))project.materials.push(M.clone(assets[id]));block.materials.push({id,role:'primary',revision:assets[id].revision});},changed:()=>changes++,persist:async()=>{},status:(text,error)=>statuses.push({text,error})});
 const page={dataset:{section:sectionID}},target={closest:selector=>selector==='.paper'?page:null};
 const event=(payload={sessionID:'reader-paper',messageID:'answer',text:'伪造外部正文'})=>({target,clientY:100,dataTransfer:{types:[RESEARCH_MESSAGE_MIME],getData:()=>JSON.stringify(payload)},preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},stopPropagation(){}});
 return{U,canvas,handlers,event,source,saved,statuses,dispose,get snapshots(){return snapshots;},get changes(){return changes;}};
}

test('a cross-view answer drop inserts a sourced research material at the chosen position and never writes manuscript prose',async()=>{
 const f=assemblyFixture(),original=f.U.p.blocks.map(value=>value.text),e=f.event();await f.handlers.get('drop')(e);
 assert.equal(e.defaultPrevented,true);assert.equal(e.stopped,true);assert.equal(f.saved[0].options.sessionID,'reader-paper');assert.equal(f.saved[0].message.question,'这个公式为什么有该条件？');assert.deepEqual(f.saved[0].message.sources,[f.source]);
 const inserted=f.U.p.blocks[1];assert.equal(inserted.text,'');assert.equal(inserted.assembly,true);assert.equal(inserted.researchMessageID,'answer');assert.equal(inserted.conversationID,'reader-paper');assert.equal(inserted.spaceBefore,14);assert.equal(inserted.materials[0].id,'saved-answer');assert.deepEqual(f.U.p.materials[0].sourceRefs,[f.source]);assert.deepEqual([f.U.p.blocks[0].text,f.U.p.blocks[2].text],original);assert.equal(f.snapshots,1);assert.equal(f.changes,1);assert.equal(f.canvas.dataset.messageDropBusy,undefined);f.dispose();assert.equal(f.handlers.size,0);
});

test('unknown and user-message references cannot insert external text into assembly',async()=>{
 for(const payload of [{sessionID:'reader-paper',messageID:'missing',text:'外部文字'},{sessionID:'reader-paper',messageID:'question'}]){
  const f=assemblyFixture(),before=M.clone(f.U.p);await f.handlers.get('drop')(f.event(payload));assert.deepEqual(f.U.p,before);assert.equal(f.saved.length,0);assert.equal(f.snapshots,0);assert.equal(f.statuses.at(-1).error,true);f.dispose();
 }
});

test('a failed save leaves the user manuscript and existing material relationships intact',async()=>{
 const f=assemblyFixture(),before=M.clone(f.U.p);f.U.saveResearchMessage=async()=>{throw Error('磁盘保存失败');};await f.handlers.get('drop')(f.event());assert.deepEqual(f.U.p,before);assert.equal(f.snapshots,0);assert.equal(f.changes,0);assert.equal(f.statuses.at(-1).text,'磁盘保存失败');assert.equal(f.canvas.dataset.messageDropBusy,undefined);
});
