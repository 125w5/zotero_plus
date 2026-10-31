/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A same-folder rescan (for example after Zotero indexes a newly imported PDF)
// rebuilds a conversation's libraryFiles in scan order. A read of the selected
// files that is still running must not treat that new order as a changed
// selection; unchecking a file or changing its range during the read still stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as C from '../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as H from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as L from '../../chrome/content/zotero/research/shared/library-scope.mjs';

let conversations=await readFile(new URL('../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8');
let attachments=await readFile(new URL('../../chrome/content/zotero/xpcom/research/chat-attachments.js',import.meta.url),'utf8');
let names=['甲.txt','乙.txt','丙.txt','丁.txt'];

function fixture(){
	let data={},revision=0,index=0,gate=null;
	let items=new Map(names.map((name,offset)=>[101+offset,{id:101+offset,parentID:null,isAttachment:()=>true,getFilePathAsync:async()=>'/lib/'+name,getField:()=>name,attachmentFilename:name}]));
	let E={store:{get:key=>structuredClone(data[key]),branchRevision:()=>revision,async replaceBranch(key,value){data[key]=structuredClone(value);revision++;}},library:{uri:item=>'zotero://select/library/items/'+item.id}};
	let Zotero={Research:E,isWin:false,logError:(error)=>{throw error;},getActiveZoteroPane:()=>null,Utilities:{randomString:()=>String(++index)},Items:{getAsync:async id=>items.get(Number(id))||null},File:{pathToFileURI:path=>'file://'+path},Libraries:{userLibraryID:1}};
	let IOUtils={exists:async path=>names.some(name=>path==='/lib/'+name),readUTF8:async (path)=>{if(gate&&path===gate.path){let {release}=gate;gate=null;release.reached();await release.promise;}return 'Text of '+path;}};
	let context=vm.createContext({Zotero,IOUtils,PathUtils:{filename:path=>path.split('/').pop()},ChromeUtils:{importESModule:uri=>(uri.endsWith('conversation-store.mjs')?C:uri.endsWith('library-scope.mjs')?L:H)}});
	vm.runInContext(conversations,context);vm.runInContext(attachments,context);
	// Holds the first file read open until the test changes the conversation.
	let pause=(path)=>{let release={};release.promise=new Promise((resolve)=>{release.open=resolve;});let reached=new Promise((resolve)=>{release.reached=resolve;});gate={path,release};return {reached,open:()=>release.open()};};
	return {E,S:E.workbenchConversations,A:E.chatAttachments,pause};
}
let scope=order=>({key:'L1',folder:'我的文库',collectionID:null,libraryID:1,files:order.map(position=>({id:'attachment:'+(101+position),attachmentID:101+position,paperItemID:101+position,title:names[position],kind:'text',selected:false}))});
// Arrays built inside the vm context have that context's prototype.
let ids=rows=>Array.from(rows,row=>row.id);

test('a same-folder rescan that only reorders the files does not stop a running read of the selected files',async()=>{
	let f=fixture(),session=await L.syncLibraryScopeSession(f.E,scope([0,1,2]),{pptDraftID:'d1',origin:'ppt',activate:false});
	let refs=f.A.selected(session.id);assert.deepEqual(ids(refs),['attachment:101','attachment:102','attachment:103']);
	let held=f.pause('/lib/甲.txt'),reading=f.A.read(refs,{sessionID:session.id,query:'调整结构'});await held.reached;
	await L.syncLibraryScopeSession(f.E,scope([2,0,1]),{pptDraftID:'d1',origin:'ppt',activate:false,sessionID:session.id});
	assert.deepEqual(ids(f.A.selected(session.id)),['attachment:103','attachment:101','attachment:102'],'the rescan rewrote libraryFiles in its own order');
	held.open();let read=await reading;
	assert.deepEqual(Array.from(read.rows,row=>row.referenceID),['attachment:101','attachment:102','attachment:103'],'every selected file was read');
	assert.equal(read.rows[0].text,'Text of /lib/甲.txt');
});

test('a file a rescan adds to the selection during the read does not stop it; the next read includes it',async()=>{
	let f=fixture(),session=await L.syncLibraryScopeSession(f.E,scope([0,1,2]),{pptDraftID:'d1',origin:'ppt',activate:false});
	let held=f.pause('/lib/甲.txt'),reading=f.A.read(f.A.selected(session.id),{sessionID:session.id});await held.reached;
	// For example a PDF just dragged into the folder, once Zotero has indexed it.
	await L.syncLibraryScopeSession(f.E,scope([0,1,2,3]),{pptDraftID:'d1',origin:'ppt',activate:false,sessionID:session.id});
	assert.deepEqual(ids(f.A.selected(session.id)),['attachment:101','attachment:102','attachment:103','attachment:104'],'the new file is selected');
	held.open();let read=await reading;
	assert.deepEqual(Array.from(read.rows,row=>row.referenceID),['attachment:101','attachment:102','attachment:103'],'the running read keeps the files it started with');
	let next=await f.A.read(f.A.selected(session.id),{sessionID:session.id});
	assert.ok(Array.from(next.rows,row=>row.referenceID).includes('attachment:104'),'the next question reads the new file');
});

test('unchecking a file during the read still stops the read',async()=>{
	let f=fixture(),session=await L.syncLibraryScopeSession(f.E,scope([0,1,2]),{pptDraftID:'d1',origin:'ppt',activate:false});
	let held=f.pause('/lib/甲.txt'),reading=f.A.read(f.A.selected(session.id),{sessionID:session.id});await held.reached;
	await f.S.updateAttachment(session.id,'attachment:102',{selected:false});held.open();
	await assert.rejects(reading,/读取时当前对话的资料选择已变化/);
});

test('changing a selected file during the read still stops the read',async()=>{
	let f=fixture(),session=await L.syncLibraryScopeSession(f.E,scope([0,1,2]),{pptDraftID:'d1',origin:'ppt',activate:false});
	let held=f.pause('/lib/甲.txt'),reading=f.A.read(f.A.selected(session.id),{sessionID:session.id});await held.reached;
	await f.S.updateAttachment(session.id,'attachment:103',{featured:true});held.open();
	await assert.rejects(reading,/读取时当前对话的资料选择已变化/,'the same files in a new state are a changed selection');
});
