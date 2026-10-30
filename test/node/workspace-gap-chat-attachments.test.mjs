/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-08: every entry of a drop is tried and the report names each failure.
// WA-10: a dragged existing paper keeps its folders; only new imports are filed.
// WA-13: reusing an earlier import never walks every item in the library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as H from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

let source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/chat-attachments.js',import.meta.url),'utf8');
let pdfHeader=Uint8Array.from('%PDF-',char=>char.charCodeAt(0));
function fixture({session={id:'s',libraryScopeKey:'L1-C20',libraryCollectionID:20,libraryLibraryID:1},files={}}={}){
	let calls={attach:[],getAll:0,stat:[],md5:[],imported:[],queries:[],saved:[]},state={chatFileSources:{},settings:{}},byID=new Map();
	let methods=(item,collections)=>Object.assign(item,{libraryID:1,deleted:false,collections:[...collections],inCollection(id){return this.collections.includes(id);},addToCollection(id){this.collections.push(id);},async saveTx(){calls.saved.push(this.id);}});
	let attachment=({id,path,parentID=null,collections=[]})=>{let item=methods({id,parentID,attachmentFilename:path.split('/').pop(),isAttachment:()=>true,isRegularItem:()=>false,getFilePath:()=>path,getFilePathAsync:async()=>path,getField:()=>path.split('/').pop()},collections);byID.set(id,item);return item;};
	let paper=({id,collections=[]})=>{let item=methods({id,isAttachment:()=>false,isRegularItem:()=>true,getField:()=>'已有论文'},collections);byID.set(id,item);return item;};
	let S={get:id=>id===session.id?structuredClone(session):null,getAttachments:()=>[],attach:async(id,rows)=>{calls.attach.push([id,rows]);return rows;}};
	let E={workbenchConversations:S,store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},manuscripts:{get:()=>null}};
	let Zotero={Research:E,isWin:false,logError(){},getActiveZoteroPane:()=>null,
		Items:{getAll:async()=>{calls.getAll++;throw Error('whole-library scan');},getAsync:async ids=>Array.isArray(ids)?ids.map(id=>byID.get(id)).filter(Boolean):byID.get(ids)||null,get:id=>byID.get(id)||null},
		Collections:{get:id=>({id,libraryID:1,deleted:false})},Libraries:{get:()=>({editable:true}),userLibraryID:1},
		DB:{columnQueryAsync:async(sql,params)=>{calls.queries.push({sql,params});return [...byID.values()].filter(item=>item.isAttachment()).map(item=>item.id);}},
		Attachments:{LINK_MODE_IMPORTED_FILE:0,LINK_MODE_IMPORTED_URL:1,LINK_MODE_LINKED_FILE:2,importFromFile:async({file,title})=>{calls.imported.push(title);let path='/lib/storage/'+title;files[path]=files[file.path];return attachment({id:30,path});}},
		File:{pathToFileURI:path=>'file://'+path,pathToFile:path=>({path})},Utilities:{randomString:()=>'r',Internal:{md5Async:async path=>{calls.md5.push(path);return files[path]?.hash;}}}};
	let IOUtils={stat:async path=>{calls.stat.push(path);if(!files[path])throw Error('missing');return {size:files[path].size};},exists:async path=>!!files[path],read:async path=>files[path]?.header||new Uint8Array(),remove:async()=>{},write:async()=>{}};
	vm.runInNewContext(source,{Zotero,IOUtils,PathUtils:{filename:path=>path.split('/').pop(),join:(...parts)=>parts.join('/')},ChromeUtils:{importESModule:()=>H}});
	return {A:E.chatAttachments,calls,state,files,attachment,paper};
}
let titles=rows=>Array.from(rows,row=>row.title);
let fakeImport=f=>{let tried=[];f.A.importFile=async file=>{tried.push(file);if(file.endsWith('b.pdf'))throw Error('文件不是有效的 PDF，未导入。');if(file.endsWith('.zip'))H.chatAttachmentFileKind(file);let name=file.split('/').pop();return {id:'attachment:'+name,attachmentID:tried.length,title:name,kind:'pdf'};};return tried;};

test('a bad file in a drop does not skip the files after it, and the error names it',async()=>{
	let f=fixture(),tried=fakeImport(f);
	await assert.rejects(()=>f.A.attach('s',{files:['/d/a.pdf','/d/b.pdf','/d/c.pdf','/d/d.docx']},{source:'drop'}),error=>error.message==='b.pdf：文件不是有效的 PDF，未导入。其余 3 份已导入。');
	assert.deepEqual(tried,['/d/a.pdf','/d/b.pdf','/d/c.pdf','/d/d.docx']);
	assert.deepEqual(titles(f.calls.attach[0][1]),['a.pdf','c.pdf','d.docx']);
	let g=fixture();fakeImport(g);
	await assert.rejects(()=>g.A.attach('s',{files:['/d/a.pdf','/d/b.pdf','/d/x.zip']},{source:'drop'}),error=>error.message==='已导入 1 份；以下未导入：b.pdf（文件不是有效的 PDF）、x.zip（格式不支持）。请检查后重新导入这些文件。');
	assert.deepEqual(titles(g.calls.attach[0][1]),['a.pdf']);
});

test('cancelling during a drop still stops at once and adds nothing',async()=>{
	let f=fixture(),controller=new AbortController(),tried=[];
	f.A.importFile=async file=>{tried.push(file);if(file.endsWith('b.pdf')){controller.abort();throw Error('已取消，已有资料保留。');}return {id:'attachment:'+tried.length,attachmentID:tried.length,title:file,kind:'pdf'};};
	await assert.rejects(()=>f.A.attach('s',{files:['/d/a.pdf','/d/b.pdf','/d/c.pdf']},{source:'drop',signal:controller.signal}),/已取消/);
	assert.deepEqual(tried,['/d/a.pdf','/d/b.pdf']);assert.equal(f.calls.attach.length,0);
});

test('dragging an existing paper into a folder-bound conversation leaves its folders unchanged',async()=>{
	let f=fixture({files:{'/lib/storage/a.pdf':{size:10,hash:'ha',header:pdfHeader}}}),parent=f.paper({id:10,collections:[5]});f.attachment({id:11,path:'/lib/storage/a.pdf',parentID:10});
	await f.A.attach('s',{items:[11]},{source:'drop'});
	assert.deepEqual(parent.collections,[5]);assert.deepEqual(f.calls.saved,[]);assert.equal(f.calls.attach[0][1][0].attachmentID,11);
	f.files['/drop/new.pdf']={size:20,hash:'hn',header:pdfHeader};
	await f.A.attach('s',{files:['/drop/new.pdf']});
	assert.deepEqual(f.calls.imported,['new.pdf']);assert.deepEqual(f.calls.saved,[30],'a newly imported file still joins the conversation folder');
});

test('importing a file that is already in the library reuses it without walking every item',async()=>{
	let f=fixture({files:{'/drop/same.pdf':{size:100,hash:'h1',header:pdfHeader},'/lib/storage/same.pdf':{size:100,hash:'h1'},'/lib/storage/other.pdf':{size:200,hash:'h2'}}});
	f.paper({id:40});f.attachment({id:50,path:'/lib/storage/same.pdf'});f.attachment({id:51,path:'/lib/storage/other.pdf'});
	await f.A.attach('s',{files:['/drop/same.pdf']});
	assert.equal(f.calls.getAll,0,'no whole-library item load');
	assert.equal(f.calls.attach[0][1][0].attachmentID,50);assert.deepEqual(f.calls.imported,[]);assert.equal(f.state.chatFileSources['1:h1'].itemID,50);
	assert.equal(f.calls.queries.length,1);assert.equal(f.calls.queries[0].params[0],1);assert.ok(f.calls.queries[0].params.includes('%.pdf'));
	assert.deepEqual(f.calls.md5.filter(path=>path.startsWith('/lib/')),['/lib/storage/same.pdf'],'only the same-size candidate is fingerprinted');
});
