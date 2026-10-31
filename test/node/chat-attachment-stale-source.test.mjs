/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A dropped file's remembered library source (chatFileSources) keeps an item ID.
// Zotero reuses the IDs of erased items after a restart, so that ID can later
// belong to a manuscript or a web link. Dropping the same file again must reuse
// or re-import it instead of reading a path from the unrelated item, and a
// conversation source that pointed at the erased attachment must say it is gone
// instead of failing on, or borrowing, the other item's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as H from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

let source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/chat-attachments.js',import.meta.url),'utf8');
let STALE=/原附件已删除，资料关联已失效/;

function fixture({files={},references=[],importError=null}={}){
	let calls={imported:[],paths:[]},state={chatFileSources:{}},byID=new Map();
	let attachment=({id,path,linkMode='imported',deleted=false})=>{let link=linkMode==='linked_url',item={id,libraryID:1,parentID:null,deleted,attachmentFilename:path.split('/').pop(),isAttachment:()=>true,isFileAttachment:()=>!link,isRegularItem:()=>false,getFilePath:()=>!link&&path,getFilePathAsync:async()=>!link&&path,getField:()=>path.split('/').pop()};byID.set(id,item);return item;};
	// A regular item that took over an erased attachment's ID. Like Zotero.Item,
	// it throws when asked for a file path.
	let manuscript=({id,best=null})=>{let item={id,libraryID:1,deleted:false,isAttachment:()=>false,isFileAttachment:()=>false,isRegularItem:()=>true,getFilePathAsync:async()=>{calls.paths.push(id);throw Error('getFilePathAsync() can only be called on attachment items');},getBestAttachment:async()=>best&&byID.get(best),getField:()=>'无关的稿件'};byID.set(id,item);return item;};
	let S={get:id=>id==='s'?{id:'s'}:null,getAttachments:()=>structuredClone(references),attach:async(id,rows)=>rows};
	let E={workbenchConversations:S,store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},manuscripts:{get:()=>null},library:{localPDF:async()=>null,uri:item=>'zotero://select/library/items/'+item.id},runArtifactEngine:async()=>({sheets:[],warnings:[]})};
	let Zotero={Research:E,isWin:false,logError(){},getActiveZoteroPane:()=>null,
		Items:{getAsync:async ids=>Array.isArray(ids)?ids.map(id=>byID.get(id)).filter(Boolean):byID.get(ids)||null,get:id=>byID.get(id)||null},
		Libraries:{get:()=>({editable:true}),userLibraryID:1},
		DB:{columnQueryAsync:async()=>[...byID.values()].filter(item=>item.isAttachment()).map(item=>item.id)},
		Attachments:{LINK_MODE_IMPORTED_FILE:0,LINK_MODE_IMPORTED_URL:1,LINK_MODE_LINKED_FILE:2,importFromFile:async({file,title})=>{calls.imported.push(title);if(importError)throw Error(importError);let path='/lib/storage/'+title;files[path]=files[file.path];return attachment({id:30,path});}},
		File:{pathToFileURI:path=>'file://'+path,pathToFile:path=>({path})},Utilities:{randomString:()=>'r',Internal:{md5Async:async path=>files[path]?.hash}}};
	let IOUtils={stat:async path=>{if(!files[path])throw Error('missing');return {size:files[path].size};},exists:async path=>!!files[path],read:async()=>new Uint8Array(),remove:async()=>{},write:async()=>{}};
	vm.runInNewContext(source,{Zotero,IOUtils,PathUtils:{filename:path=>path.split('/').pop(),join:(...parts)=>parts.join('/')},ChromeUtils:{importESModule:()=>H}});
	return {A:E.chatAttachments,calls,state,files,attachment,manuscript};
}

test('dropping a file again after its remembered attachment ID went to a manuscript imports it afresh',async()=>{
	let f=fixture({files:{'/drop/data.csv':{size:30,hash:'h1'}}});f.manuscript({id:7});f.state.chatFileSources['1:h1']={itemID:7,fingerprint:'h1'};
	let reference=await f.A.importFile('/drop/data.csv');
	assert.equal(reference.attachmentID,30);assert.equal(reference.kind,'spreadsheet');assert.deepEqual(f.calls.imported,['data.csv']);
	assert.deepEqual(f.calls.paths,[],'no file path is read from the manuscript');
	assert.equal(f.state.chatFileSources['1:h1'].itemID,30,'the remembered source now points at the new attachment');
	let again=await f.A.importFile('/drop/data.csv');
	assert.equal(again.attachmentID,30);assert.deepEqual(f.calls.imported,['data.csv'],'the next drop reuses the new attachment');
});

test('a stale remembered source falls back to an existing attachment of the same file',async()=>{
	let f=fixture({files:{'/drop/data.csv':{size:30,hash:'h1'},'/lib/storage/data.csv':{size:30,hash:'h1'}}});f.manuscript({id:7});f.attachment({id:50,path:'/lib/storage/data.csv'});f.state.chatFileSources['1:h1']={itemID:7,fingerprint:'h1'};
	let reference=await f.A.importFile('/drop/data.csv');
	assert.equal(reference.attachmentID,50);assert.deepEqual(f.calls.imported,[]);assert.equal(f.state.chatFileSources['1:h1'].itemID,50);
});

test('an import that fails after a stale remembered source does not keep the stale entry',async()=>{
	let f=fixture({files:{'/drop/data.csv':{size:30,hash:'h1'}},importError:'磁盘空间不足。'});f.manuscript({id:7});f.state.chatFileSources['1:h1']={itemID:7,fingerprint:'h1'};
	await assert.rejects(()=>f.A.importFile('/drop/data.csv'),/磁盘空间不足/);
	assert.equal(f.state.chatFileSources['1:h1'],undefined,'the next drop does not stop at the same entry');assert.deepEqual(f.calls.paths,[]);
});

test('a conversation source whose attachment ID now belongs to another item reports the source as gone',async()=>{
	let stale={id:'attachment:7',attachmentID:7,paperItemID:7,title:'data.csv',kind:'spreadsheet',selected:true};
	let f=fixture({files:{'/lib/storage/other.pdf':{size:9,hash:'h9'}},references:[stale]});f.attachment({id:8,path:'/lib/storage/other.pdf'});f.manuscript({id:7,best:8});
	await assert.rejects(()=>f.A.resolve(stale),STALE,'the manuscript\'s own PDF is not substituted for the erased file');
	await assert.rejects(()=>f.A.read([stale]),STALE);
	await assert.rejects(()=>f.A.preview('s','attachment:7'),STALE);
	await assert.rejects(()=>f.A.location('s','attachment:7'),STALE);
	assert.deepEqual(f.calls.paths,[]);
	let g=fixture({references:[stale]});g.attachment({id:7,path:'https://example.org/page',linkMode:'linked_url'});
	await assert.rejects(()=>g.A.resolve(stale),STALE,'a web link that took the ID has no file either');
	let h=fixture();h.attachment({id:7,path:'/lib/storage/data.csv',deleted:true});
	await assert.rejects(()=>h.A.resolve(stale),/所选文件已不存在/,'an attachment in the trash keeps its own message');
	let k=fixture({files:{'/lib/storage/data.csv':{size:30,hash:'h1'}}});k.attachment({id:7,path:'/lib/storage/data.csv'});
	assert.equal((await k.A.resolve(stale)).attachmentID,7,'a live attachment still resolves');
});
