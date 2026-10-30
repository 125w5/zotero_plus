/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-11: dragging a search result saves it where clicking it would: the native
// folder the target conversation is bound to wins over the 保存论文到 dropdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveDiscoveryPaper,setDiscoveryPaperDragData,discoveryPaperDrop} from '../../chrome/content/zotero/research/shared/discovery-transfer.mjs';

let pathStore=state=>{let read=path=>path.reduce((value,key)=>value?.[key],state);return {peek:(...path)=>read(path),get:(...path)=>{assert.ok(path.length,'store.get() without a path');return structuredClone(read(path));},update:async fn=>fn(state)};};
function fixture(session,settings={discoveryDestination:{collectionID:3,libraryID:1}}){
	let calls={obtain:[],created:0,ensured:[]},state={settings};
	let E={workbenchConversations:{get:id=>id==='s'?session:null},manuscripts:{get:()=>null},store:pathStore(state),
		createDiscoveryCollection:async()=>{calls.created++;return {id:30,libraryID:1};},
		notebook:{ensureProjectCollection:async id=>{calls.ensured.push(id);return {collectionID:44,libraryID:1};}},
		obtainPaper:async(_record,options)=>{calls.obtain.push(options);return {attachmentID:7};},chatAttachments:{attach:async()=>[]}};
	return {E,calls,state};
}
let drop={paper:{id:'a',title:'A',pdf:'https://example.org/a.pdf'},destination:{collectionID:8,libraryID:1}};

test('a drop on a conversation bound to a native folder saves into that folder, as a click does',async()=>{
	let {E,calls}=fixture({libraryScopeKey:'L1-C12',libraryCollectionID:12,libraryLibraryID:1});
	await receiveDiscoveryPaper({E,sessionID:'s',drop});
	assert.equal(calls.obtain[0].collectionID,12);assert.equal(calls.obtain[0].libraryID,1);assert.equal(calls.created,0);
});

test('a conversation bound to a library root saves to that library without creating 论文搜集',async()=>{
	let {E,calls,state}=fixture({libraryScopeKey:'L1',libraryCollectionID:null,libraryLibraryID:1});
	await receiveDiscoveryPaper({E,sessionID:'s',drop});
	assert.equal(calls.obtain[0].collectionID,undefined);assert.equal(calls.obtain[0].libraryID,1);
	assert.equal(calls.created,0);assert.equal(state.settings.discoveryDestination.collectionID,3,'the dropdown setting is unchanged');
});

test('a native folder sent with the drag wins over the target conversation project folder',async()=>{
	let data=new Map(),dataTransfer={get types(){return [...data.keys()];},setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''};
	setDiscoveryPaperDragData({dataTransfer},{id:'a',title:'A',pdf:'https://example.org/a.pdf'},{destination:{collectionID:12,libraryID:1,native:true}});
	let sent=discoveryPaperDrop(dataTransfer);assert.equal(sent.destination.native,true);
	let {E,calls}=fixture({projectID:'p1'});E.manuscripts.get=()=>({paperCollectionID:17});
	await receiveDiscoveryPaper({E,sessionID:'s',drop:sent});
	assert.equal(calls.obtain[0].collectionID,12);assert.equal(calls.created,0);
	setDiscoveryPaperDragData({dataTransfer},{id:'a',title:'A',pdf:'https://example.org/a.pdf'},{destination:{collectionID:12,libraryID:1}});
	assert.equal(discoveryPaperDrop(dataTransfer).destination.native,undefined,'a dropdown destination is not marked native');
});

test('a stored project-only destination resolves the project folder instead of creating 论文搜集',async()=>{
	let {E,calls}=fixture({},{discoveryDestination:{projectID:'p9'}});
	await receiveDiscoveryPaper({E,sessionID:'s',drop:{paper:drop.paper,destination:{projectID:'p9'}}});
	assert.deepEqual(calls.ensured,['p9']);assert.equal(calls.created,0);assert.equal(calls.obtain[0].collectionID,44);
});
