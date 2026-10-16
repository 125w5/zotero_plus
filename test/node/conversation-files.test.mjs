/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mountConversationFiles,mountConversationFileDetail,receiveConversationDrop} from '../../chrome/content/zotero/research/shared/conversation-files.mjs';
import {RESEARCH_MESSAGE_MIME} from '../../chrome/content/zotero/research/shared/message-transfer.mjs';
import {CHAT_ATTACHMENT_MIME} from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

class Node extends EventTarget{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this._text='';this.className='';this.value='';}
 get isConnected(){return this.root||!!this.parentElement?.isConnected;}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value??'');}
 get classList(){return {add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].filter(Boolean).join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');}};}
 append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
 matches(selector){return selector==='*'||selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1))||selector===this.tagName;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function fixture(){
 const win=new EventTarget();Object.assign(win,{AbortController,setTimeout,clearTimeout});
 const doc={defaultView:win,createElementNS:(_ns,tag)=>new Node(doc,tag)};doc.documentElement=new Node(doc,'html');doc.documentElement.root=true;doc.head=new Node(doc,'head');doc.body=new Node(doc,'body');doc.documentElement.append(doc.head,doc.body);doc.querySelector=selector=>doc.documentElement.querySelector(selector);const host=new Node(doc,'aside');doc.body.append(host);
 const listeners=new Set(),file={id:'attachment:7',title:'实验数据.xlsx',kind:'spreadsheet',ranges:['B2:C3']};let sessionID='s1';
 const E={chatAttachments:{get:()=>[file]},workbenchConversations:{subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},renderContent:(node,text)=>node.textContent=text};
 const errors=[],view=mountConversationFileDetail({host,E,getSessionID:()=>sessionID,onError:error=>errors.push(error.message)});
 return {doc,host,E,file,view,errors,setSession(id){sessionID=id;for(const fn of [...listeners])fn();}};
}
const flush=async()=>{for(let index=0;index<15;index++)await Promise.resolve();};

test('unchanged source rails retain their DOM and custom file adapters keep selection scope',async()=>{
 const f=fixture();f.view.destroy();const refs=[{id:'virtual:8',kind:'pdf',title:'范文',selected:true}],updates=[],drags=[],rail=mountConversationFiles({host:f.host,E:f.E,getSessionID:()=> 's1',getFiles:()=>refs,getSessions:()=>[{id:'s1',title:'当前讨论'}],onFileState:async(...args)=>{updates.push(args);refs[0].selected=false;},onFileDrag:(...args)=>drags.push(args)});
 const first=rail.root.querySelector('.conversation-file');rail.render();assert.strictEqual(rail.root.querySelector('.conversation-file'),first,'unrelated updates must not replace focused controls');
 const check=first.querySelector('input');check.checked=false;check.onchange();await flush();assert.equal(updates[0][2],'s1');assert.deepEqual(updates[0][1],{selected:false});
 const grip=rail.root.querySelector('.conversation-file-grip');grip.ondragstart({stopPropagation(){}});assert.equal(drags[0][1].id,'virtual:8');rail.destroy();
});

test('history updates retain file controls and file selection retains history without redundant selection writes',async()=>{
 const f=fixture();f.view.destroy();const refs=[{id:'attachment:8',kind:'pdf',title:'研究论文',selected:true}],sessions=[{id:'s1',title:'当前讨论'}];let selections=0;
 const rail=mountConversationFiles({host:f.host,E:f.E,getSessionID:()=> 's1',getFiles:()=>refs,getSessions:()=>sessions,onSession:()=>selections++});
 const file=rail.root.querySelector('.conversation-file');const history=rail.root.querySelector('.conversation-files-history');history.scrollTop=80;
 sessions[0].title='更新讨论名称';rail.render();assert.strictEqual(rail.root.querySelector('.conversation-file'),file,'renaming a conversation must not interrupt a file control');assert.equal(history.scrollTop,80);
 const current=history.children[0];refs[0].selected=false;rail.render();assert.strictEqual(history.children[0],current,'changing source scope must not replace conversation controls');assert.equal(rail.root.querySelector('.conversation-file-check').checked,false);
 current.onclick();await flush();assert.equal(selections,0,'clicking the active conversation must not persist an identical selection');rail.destroy();
});

test('a folder scope change updates a compact source location without rebuilding file or conversation controls',()=>{
 const f=fixture();f.view.destroy();const scope={project:'研究计划',folder:'研究计划'},refs=[{id:'attachment:8',kind:'pdf',title:'研究论文',selected:true}];
 const rail=mountConversationFiles({host:f.host,E:f.E,getSessionID:()=> 's1',getFiles:()=>refs,getSessions:()=>[{id:'s1',title:'当前讨论'}],getContext:()=>scope});
 const context=rail.root.querySelector('.conversation-files-context'),file=rail.root.querySelector('.conversation-file'),session=rail.root.querySelector('.conversation-files-session');
 assert.equal(context.textContent,'研究计划','the same project/folder name is not repeated');assert.equal(context.title,'研究计划');assert.doesNotMatch(context.textContent,/项目 ·|文件夹 ·/);
 scope.folder='方法精选';rail.render();assert.equal(context.textContent,'研究计划 / 方法精选');assert.strictEqual(rail.root.querySelector('.conversation-file'),file);assert.strictEqual(rail.root.querySelector('.conversation-files-session'),session);
 scope.project='';scope.folder='';rail.render();assert.equal(context.hidden,true);assert.equal(context.textContent,'');rail.destroy();
});

test('source scope shortcuts show selected files while keeping selection and the conversation unchanged',()=>{
 const f=fixture();f.view.destroy();const refs=[{id:'attachment:8',kind:'pdf',title:'用于本次问答的论文',selected:true},{id:'attachment:9',kind:'image',title:'暂留的实验图',selected:false}],rail=mountConversationFiles({host:f.host,E:f.E,getSessionID:()=> 's1',getFiles:()=>refs,getSessions:()=>[{id:'s1',title:'当前讨论'}]});
 const session=rail.root.querySelector('.conversation-files-session');assert.equal(rail.root.querySelectorAll('.conversation-file').length,2);
 assert.equal(rail.setFilter('selected'),true);assert.equal(rail.root.querySelectorAll('.conversation-file').length,1);assert.match(rail.root.querySelector('.conversation-file').textContent,/用于本次问答/);assert.equal(refs[1].selected,false);assert.strictEqual(rail.root.querySelector('.conversation-files-session'),session);
 assert.equal(rail.setFilter('unknown'),false);assert.equal(rail.root.querySelectorAll('.conversation-file').length,1);rail.setFilter('all');assert.equal(rail.root.querySelectorAll('.conversation-file').length,2);rail.destroy();
});

test('dragging a retained answer copies its question and evidence to the intended conversation without running a task',async()=>{
 const sessions=new Map([['from',{id:'from',messages:[{id:'q',role:'user',text:'实验怎样划分？'},{id:'a',role:'assistant',text:'按设备划分。',sources:[{stableID:'paper:7',attachmentID:8}]}]}],['to',{id:'to',messages:[]}]]),appended=[];
 const E={workbenchConversations:{get:id=>sessions.get(id),append:async(id,row)=>{appended.push([id,row]);sessions.get(id).messages.push(row);}}},dataTransfer={types:[RESEARCH_MESSAGE_MIME],getData:type=>type===RESEARCH_MESSAGE_MIME?JSON.stringify({sessionID:'from',messageID:'a'}):''};
 assert.match(await receiveConversationDrop({E,dataTransfer,sessionID:'to'}),/尚未提交/);assert.equal(appended.length,1);assert.equal(appended[0][0],'to');assert.match(appended[0][1].text,/实验怎样划分/);assert.equal(appended[0][1].sources[0].attachmentID,8);assert.deepEqual(appended[0][1].importedFrom,{sessionID:'from',messageID:'a'});assert.equal(sessions.get('from').messages.length,2);
 await receiveConversationDrop({E,dataTransfer,sessionID:'from'});assert.equal(appended.length,1);sessions.get('from').messages=[];assert.equal(await receiveConversationDrop({E,dataTransfer,sessionID:'to'}),null,'removed source messages cannot be resurrected');
});

test('dragging a file uses its stable original identity and captures the target conversation',async()=>{
 const calls=[],E={workbenchConversations:{get:id=>id==='target'?{id}:null},chatAttachments:{attach:async(...args)=>calls.push(args)}},dataTransfer={types:[CHAT_ATTACHMENT_MIME],files:[],getData:()=>JSON.stringify({sessionID:'source',attachmentID:'attachment:9'})};
 await receiveConversationDrop({E,dataTransfer,sessionID:'target'});assert.deepEqual(calls,[['target',{files:[],items:[{sessionID:'source',attachmentID:'attachment:9'}],materialIDs:[]},{source:'drop'}]]);await assert.rejects(()=>receiveConversationDrop({E,dataTransfer,sessionID:'deleted'}),/选择目标对话/);assert.equal(calls.length,1);
});

test('an imported file at the selection limit remains saved and the rail explains how to select it',async()=>{
 const f=fixture();f.view.destroy();const notice='已保存，选用已达 12 份；取消勾选后可选用新文件。';let imports=0;
 f.E.chatAttachments.attach=async()=>{imports++;};f.E.workbenchConversations.getAttachmentNotice=()=>notice;
 const rail=mountConversationFiles({host:f.host,E:f.E,getSessionID:()=> 's1'});await rail.root.querySelector('.conversation-files-import').onclick();assert.equal(imports,1);assert.equal(rail.root.querySelector('.conversation-files-status').textContent,notice);
 const dataTransfer={types:[CHAT_ATTACHMENT_MIME],files:[],getData:()=>JSON.stringify({sessionID:'source',attachmentID:'attachment:9'})};f.E.workbenchConversations.get=id=>({id});
 assert.equal(await receiveConversationDrop({E:f.E,dataTransfer,sessionID:'s1'}),notice);assert.equal(imports,2);rail.destroy();
});

test('PDF detail tabs cancel older work and an old image error cannot replace the newer reference pane',async()=>{
 const f=fixture();let failOld,cleanup=0,disposedOverview=0;f.file.kind='pdf';f.file.attachmentID=7;f.E.getItem=async()=>({getField:()=>''});f.E.renderPaperOverview=async host=>{const node=f.doc.createElementNS('', 'div');node.textContent='真实摘要';node._overviewOff=()=>disposedOverview++;host.append(node);};
 const paneCalls=[];f.E.mountWorkbenchSourcePane=async(host,row,tab,{signal})=>{paneCalls.push({tab,signal});if(tab==='images')return new Promise((_resolve,reject)=>failOld=reject);host.textContent='当前引用线索';return()=>cleanup++;};
 await f.view.open(f.file);const tabs=f.host.querySelectorAll('.conversation-file-detail-tabs')[0].querySelectorAll('button');assert.equal(tabs[0].getAttribute('aria-selected'),'true');const old=tabs[1].onclick();await flush();await tabs[3].onclick();assert.equal(paneCalls[0].signal.aborted,true);assert.match(f.host.textContent,/当前引用线索/);failOld(Error('旧图片任务失败'));await old;assert.doesNotMatch(f.host.textContent,/旧图片任务失败/);assert.equal(tabs[3].getAttribute('aria-selected'),'true');assert.ok(disposedOverview>=1);f.view.destroy();assert.equal(cleanup,1);
});
test('a conversation change aborts a pending file preview and hides the previous conversation detail',async()=>{
 const f=fixture();let release,signal;f.E.chatAttachments.preview=async(_id,_file,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);};const opening=f.view.open(f.file);await flush();f.setSession('s2');assert.equal(signal.aborted,true);assert.equal(f.host.hidden,true);release({rows:[{text:'旧表格内容不能出现'}],warnings:[]});await opening;assert.doesNotMatch(f.host.textContent,/旧表格内容/);f.view.destroy();
});
test('spreadsheet previews show real column addresses and range errors remain visible beside the form',async()=>{
 const f=fixture();f.E.chatAttachments.preview=async()=>({reference:f.file,workbook:{selectedSheet:'实验一',sheets:[{name:'实验一'},{name:'实验二'}],sections:[{range:'B2:C3',startColumn:2,cells:[{row:2,values:['批次A','0.73']},{row:3,values:['批次B','0.81']}]}]},rows:[],warnings:[]});f.E.chatAttachments.setState=()=>{throw Error('无效单元格范围，请使用 A1:B20');};await f.view.open(f.file);const table=f.host.querySelector('table');assert.deepEqual(table.children[0].children.map(node=>node.textContent),['','B','C']);assert.equal(table.children[1].children[0].textContent,'2');const form=f.host.querySelector('form');form.onsubmit({preventDefault(){}});await flush();assert.match(f.host.textContent,/无效单元格范围/);assert.equal(form.querySelector('button').disabled,false);assert.deepEqual(f.errors,['无效单元格范围，请使用 A1:B20']);f.view.destroy();
});
test('rapid attachment clicks respect the getter-backed E service and only the latest saved selection mounts its preview',async()=>{
 const mounted=[],saved=[],E={},ui={agentData:{activeSessionID:'s1'},agentPreviewGeneration:0,agentPreview:{},agentFilesTools:{mountConversationFileDetail:()=>({async open(file,id){mounted.push([file.id,id]);},destroy(){}})},saveAgentState:()=>new Promise(resolve=>saved.push(resolve)),renderAgentSources(){},resetAgentPreview(){return ++this.agentPreviewGeneration;}};Object.defineProperty(ui,'E',{get:()=>E});
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),{EasySchUI:ui});
 // Preserve the small test surfaces after installing the application's methods.
 ui.saveAgentState=()=>new Promise(resolve=>saved.push(resolve));ui.renderAgentSources=()=>{};ui.resetAgentPreview=()=>++ui.agentPreviewGeneration;
 const first=ui.previewAgentAttachment({id:'attachment:1'}),second=ui.previewAgentAttachment({id:'attachment:2'});saved[1]();await second;saved[0]();await first;assert.deepEqual(mounted,[['attachment:2','s1']]);assert.strictEqual(ui.E,E);
});

test('restoring a conversation previews its own selected file and an empty conversation never selects the first library paper',async()=>{
 const chosen=[],file={id:'attachment:8',kind:'spreadsheet',selected:true},ui={E:{chatAttachments:{get:()=>[file]}},agentData:{activeSessionID:'s1',selectedID:'file:attachment:8'},agentVisibleSources:[{id:5,kind:'paper',stableID:'paper:5'}]};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),{EasySchUI:ui});
 ui.agentMaterials=()=>[];ui.previewAgentAttachment=value=>chosen.push(value.id);ui.previewAgentSource=value=>chosen.push(value.stableID);ui.renderEmptyAgentPreview=()=>chosen.push('empty');
 ui.restoreAgentPreview();assert.deepEqual(chosen,['attachment:8']);ui.agentData.selectedID='';ui.E.chatAttachments.get=()=>[];ui.restoreAgentPreview();assert.deepEqual(chosen,['attachment:8','empty']);assert.equal(ui.agentSelected,null);
});

test('a PDF download stays attached to the conversation that started it and a failed file-link does not turn the saved PDF into a download failure',async()=>{
 let release;const links=[],warnings=[],ui={E:{obtainPaper:()=>new Promise(resolve=>release=resolve)},agentData:{activeSessionID:'original'}};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),{EasySchUI:ui});
 ui.agentSourceDownloadKey=()=> 'paper-key';ui.refreshAgentSourceDownloadButtons=()=>{};ui.linkDiscoveryConversationFile=async(result,id)=>{links.push([result.attachmentID,id]);throw Error('已达文件数量上限');};ui.status=text=>warnings.push(text);
 const pending=ui.obtainAgentSource({title:'某篇论文'});await flush();ui.agentData.activeSessionID='new-conversation';release({attachmentID:99});assert.equal((await pending).attachmentID,99);assert.deepEqual(links,[[99,'original']]);assert.equal(ui.agentSourceDownloads.get('paper-key').status,'saved');assert.match(warnings[0],/PDF 已保存/);
});
