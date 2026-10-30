/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as geometry from '../../../chrome/content/zotero/research/shared/reader-ai-orb.mjs';
import * as Evidence from '../../../chrome/content/zotero/research/shared/chat-evidence.mjs';
const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/reader-ai-orb.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const items=new Map(),calls=[],attachment={id:9,parentID:4,libraryID:1,getCollections:()=>[5]},E={core:{escapeHTML:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))},library:{uri:(_item,page)=>'zotero://open-pdf/library/items/TEST?page='+(page+1)},noteContentHTML:text=>'<p>'+E.core.escapeHTML(text)+'</p>',openReaderNote:async id=>calls.push(['open',id]),noteFromAnnotation:async(_reader,key)=>({noteID:60,annotationKey:key}),
  openSavedReaderNote:async id=>{calls.push(['open-saved',id]);return openWarning;},rememberNoteLink:async(annotation,note)=>{calls.push(['link',annotation.id,note.id]);return {noteID:note.id,annotationID:annotation.id};}};
 items.set(9,attachment);let editable=true,nextID=20,openWarning='';
 class Item{constructor(type){this.type=type;this.id=nextID++;this.key='KEY'+this.id;}setNote(text){this.content=text;}getNote(){return this.content||'';}setCollections(values){this.collections=values;}async saveTx(){items.set(this.id,this);calls.push(['save',this.type]);}}
 const Zotero={Research:E,Item,Items:{getAsync:async id=>items.get(id),get:id=>items.get(id)},Libraries:{get:()=>({editable})}};
 vm.runInContext(source,vm.createContext({Zotero,ChromeUtils:{importESModule:uri=>uri.endsWith('reader-ai-orb.mjs')?geometry:uri.endsWith('chat-evidence.mjs')?Evidence:{}},Components:{utils:{unwaiveXrays:value=>value.canonicalDocument||value}},Map,Number,JSON}));
 const reader={itemID:9,_internalReader:{_state:{readOnly:false},_primaryView:{_iframeWindow:{PDFViewerApplication:{pdfDocument:{numPages:2},pdfViewer:{_pages:[{viewport:{viewBox:[0,0,600,800]}}]}}}}},setAnnotations:async annotations=>calls.push(['annotations',annotations.map(a=>a.id)])};
 return {E,Item,reader,items,calls,setEditable:value=>editable=value,setOpenWarning:value=>openWarning=value};
}
test('answer saved as a point annotation retains position and omits the original excerpt',async()=>{
 const f=fixture(),position={pageIndex:0,rects:[[20,400,42,422]]},message={text:'简洁学术讨论。',sources:[{text:'原文不可重复'}]};
 const result=await f.E.saveReaderAIMessage(f.reader,message,{position}),annotation=f.items.get(result.annotationID);
 assert.equal(annotation.parentID,9);assert.equal(annotation.annotationType,'note');assert.equal(annotation.annotationComment,message.text);assert.equal(annotation.annotationText,undefined);
 assert.deepEqual(JSON.parse(annotation.annotationPosition),position);assert.equal(annotation.annotationSortIndex,'00000|000000|00378');assert.deepEqual(plain(f.calls),[['save','annotation'],['annotations',[20]]]);
});
test('note conversion preserves the same PDF anchor and linked note key',async()=>{
 const f=fixture(),position={pageIndex:0,rects:[[20,400,42,422]]},result=await f.E.saveReaderAIMessage(f.reader,{text:'待验证假设'},{position,asNote:true});
 assert.equal(result.noteID,60);assert.equal(result.annotationKey,'KEY20');assert.deepEqual(plain(result.position),position);
});
test('plain note is actual rendered answer with clickable sources, without source text',async()=>{
 const f=fixture(),result=await f.E.saveReaderAIMessage(f.reader,{text:'比较 <A> 和 B。',sources:[{label:'全文证据',text:'原文不可重复',attachmentID:9,pageIndex:1}]},{asNote:true}),note=f.items.get(result.noteID);
 assert.equal(note.type,'note');assert.equal(note.parentID,4);assert.match(note.content,/比较 &lt;A&gt; 和 B/);assert.match(note.content,/zotero:\/\/open-pdf\/library\/items\/TEST\?page=2/);assert.doesNotMatch(note.content,/原文不可重复/);assert.deepEqual(f.calls,[['save','note'],['open',20]]);
 await f.E.saveReaderAIMessage(f.reader,{text:'比较',savedNoteID:note.id},{asNote:true});assert.equal(f.calls.filter(c=>c[0]==='save').length,1,'repeated save reopens its existing note');
});

test('a PDF note includes the associated user question while the margin annotation keeps the concise answer',async()=>{
 const f=fixture(),message={question:'式(3)中的 $x_i$ 是什么？',text:'$x_i$ 表示第 $i$ 个输入。',sources:[{text:'ORIGINAL-SHOULD-NOT-BE-DUPLICATED'}]},position={pageIndex:0,rects:[[20,400,42,422]]};
 const noteResult=await f.E.saveReaderAIMessage(f.reader,message,{asNote:true}),note=f.items.get(noteResult.noteID);assert.ok(note.content.includes(message.question));assert.ok(note.content.includes(message.text));assert.doesNotMatch(note.content,/ORIGINAL-SHOULD/);
 const annotationResult=await f.E.saveReaderAIMessage(f.reader,message,{position}),annotation=f.items.get(annotationResult.annotationID);assert.equal(annotation.annotationComment,message.text);assert.ok(!annotation.annotationComment.includes(message.question));
});
test('read-only sources and invalid PDF anchors do not create research assets',async()=>{
 const f=fixture();f.setEditable(false);await assert.rejects(f.E.saveReaderAIMessage(f.reader,{text:'讨论'},{asNote:true}),/不可编辑/);f.setEditable(true);
 for(const position of [{pageIndex:2,rects:[[0,0,20,20]]},{pageIndex:0,rects:[[0,0,NaN,20]]},{pageIndex:0,rects:[[20,20,0,0]]}])await assert.rejects(f.E.saveReaderAIMessage(f.reader,{text:'讨论'},{position}),/有效的 PDF 位置/);
 await assert.rejects(f.E.saveReaderAIMessage(f.reader,{text:' '}),/没有可保存/);assert.deepEqual(f.calls,[]);
});
test('native Xray and waived wrappers resolve only to the same actual PDF Document',()=>{
 const f=fixture(),canonical={},raw={canonicalDocument:canonical},xray={canonicalDocument:canonical},foreign={canonicalDocument:{}},rect={left:10,top:20,width:600,height:800},page={dataset:{pageNumber:'1'},querySelector:()=>({getBoundingClientRect:()=>rect})},target={ownerDocument:xray,closest:()=>page},view=f.reader._internalReader._primaryView;
 view._iframeWindow.document=raw;view._iframeWindow.PDFViewerApplication.pdfViewer._pages[0].viewport={width:600,height:800,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[x,800-y]};
 const event={target,view:{document:xray},clientX:200,clientY:250};assert.notEqual(raw,xray);assert.deepEqual(plain(f.E.readerAIMessagePosition(f.reader,event)),{pageIndex:0,rects:[[179,559,201,581]]});
 assert.equal(f.E.readerAIMessagePosition(f.reader,{...event,target:{...target,ownerDocument:foreign},view:{document:foreign}}),null,'equal-looking wrappers for another document cannot create an anchor');
 for(const clientX of [-1,611])assert.equal(f.E.readerAIMessagePosition(f.reader,{...event,clientX}),null,'document normalization does not permit coordinates outside the paper');
});

test('native paragraph and cached formula geometry provide nearby anchors without any source read',()=>{
 const f=fixture(),document={},rect={left:10,top:20,width:600,height:800},page={dataset:{pageNumber:'1'},querySelector:()=>({getBoundingClientRect:()=>rect})},target={ownerDocument:document,closest:()=>page},view=f.reader._internalReader._primaryView;
 view._iframeWindow.document=document;view._iframeWindow.PDFViewerApplication.pdfViewer._pages[0].viewport={width:600,height:800,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[x,800-y]};
 view._pdfPages=[{chars:[{rect:[100,550,300,580],lineBreakAfter:true},{rect:[100,520,300,550],lineBreakAfter:true,paragraphBreakAfter:true}]}];
 const event={target,view:{document},clientX:200,clientY:250},nearby=f.E.readerAIMessageTarget(f.reader,event);assert.equal(nearby.sourceKind,'paragraph');assert.deepEqual(plain(nearby.sourcePosition),{pageIndex:0,rects:[[100,550,300,580],[100,520,300,550]]});
 f.E.manuscripts={translationPage:()=>({blocks:[{kind:'formula',position:{pageIndex:0,rects:[[180,560,220,580]]}}]})};const formula=f.E.readerAIMessageTarget(f.reader,event);assert.equal(formula.sourceKind,'formula');assert.deepEqual(plain(formula.sourcePosition.rects),[[180,560,220,580]]);
});

test('an explicit dragged PDF range uses highlight comment geometry without copying the source excerpt',async()=>{
 const f=fixture(),position={pageIndex:0,rects:[[100,200,300,350]]},result=await f.E.saveReaderAIMessage(f.reader,{text:'范围中的假设需要核验。',sources:[{text:'原文不可重复'}]},{position,sourcePosition:position,sourceKind:'range',range:true}),annotation=f.items.get(result.annotationID);
 assert.equal(annotation.annotationType,'highlight');assert.equal(annotation.annotationComment,'范围中的假设需要核验。');assert.equal(annotation.annotationText,undefined);assert.deepEqual(JSON.parse(annotation.annotationPosition),position);assert.deepEqual(plain(result.sourcePosition),position);
});

test('PDF range conversion follows rotated viewport coordinates and clamps its endpoint to the paper',()=>{
 const viewport={width:800,height:600,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[y,x]},rect={left:10,top:20,width:400,height:300};
 assert.deepEqual(geometry.pdfMessageRangePosition({start:{x:60,y:70},end:{x:260,y:170},rect,viewport,pageIndex:0}),{pageIndex:0,rects:[[100,100,300,500]]});
 assert.deepEqual(geometry.pdfMessageRangePosition({start:{x:60,y:70},end:{x:900,y:900},rect,viewport,pageIndex:0}),{pageIndex:0,rects:[[100,100,600,800]]});
 assert.equal(geometry.pdfMessageRangePosition({start:{x:0,y:0},end:{x:100,y:100},rect,viewport,pageIndex:0}),null);assert.equal(geometry.pdfMessageRangePosition({start:{x:60,y:70},end:{x:61,y:71},rect,viewport,pageIndex:0}),null);
 const before=[{rect:[10,10,40,20],lineBreakAfter:true},{rect:[310,10,340,20],lineBreakAfter:true,paragraphBreakAfter:true}],positions=geometry.pdfParagraphPositions(before,0);assert.equal(positions.length,2,'columns are independent anchors');assert.equal(before.length,2);
});

// A dropped answer saved as a note once: the same place reopens that note, a new
// place adds its marker and link to the same note instead of a second copy.
let linkedNote=f=>{
 const note=new f.Item('note');note.libraryID=1;note.parentID=4;note.content='<div data-schema-version="9"><p>回答</p></div>';f.items.set(note.id,note);
 const marker=new f.Item('annotation');marker.parentID=9;f.items.set(marker.id,marker);
 const position={pageIndex:0,rects:[[20,400,42,422]]};
 return {note,marker,position,message:{id:'m1',text:'回答',savedNoteID:note.id,savedAnchors:[{sessionID:'s1',messageID:'m1',annotationID:marker.id,annotationKey:marker.key,attachmentID:9,position,noteID:note.id,at:'2026-10-29T00:00:00Z'}]}};
};
test('dropping a saved answer at the same place reopens its note without a second marker or note',async()=>{
 const f=fixture(),{note,marker,position,message}=linkedNote(f);
 const result=await f.E.saveReaderAIMessage(f.reader,message,{position:plain(position),asNote:true});
 assert.equal(result.reused,true);assert.equal(result.noteID,note.id);assert.equal(result.annotationID,marker.id);assert.equal(result.warning,'');
 assert.equal(result.sessionID,undefined,'only the anchor itself is returned, not the stored row');
 assert.deepEqual(plain(f.calls),[['open-saved',note.id]],'no annotation and no note are created');
});
test('dropping a saved answer at a new place adds the marker and its link to the same note',async()=>{
 const f=fixture(),{note,message}=linkedNote(f),position={pageIndex:0,rects:[[100,300,122,322]]};
 const result=await f.E.saveReaderAIMessage(f.reader,message,{position,asNote:true}),annotation=f.items.get(result.annotationID);
 assert.equal(result.extended,true);assert.equal(result.noteID,note.id);assert.equal(annotation.type,'annotation');assert.deepEqual(JSON.parse(annotation.annotationPosition),position);
 assert.deepEqual(plain(f.calls),[['save','annotation'],['annotations',[annotation.id]],['save','note'],['link',annotation.id,note.id],['open-saved',note.id]]);
 assert.equal(note.content.match(/PDF 第 1 页批注/g).length,1,'one link paragraph for the new place');
 assert.ok(note.content.endsWith('<p><a href="zotero://open-pdf/library/items/TEST?page=1&amp;annotation='+annotation.key+'">PDF 第 1 页批注</a></p></div>'));
});
test('a trashed marker or note is not reused, and a note that cannot be opened is reported as saved',async()=>{
 const f=fixture(),{note,marker,position,message}=linkedNote(f);marker.deleted=true;
 const extended=await f.E.saveReaderAIMessage(f.reader,message,{position:plain(position),asNote:true});
 assert.equal(extended.extended,true,'a trashed marker at the same place gets a new marker on the saved note');assert.equal(extended.noteID,note.id);
 note.deleted=true;const fresh=await f.E.saveReaderAIMessage(f.reader,message,{position:plain(position),asNote:true});
 assert.equal(fresh.noteID,60,'a trashed note is replaced through the ordinary note creation');assert.equal(fresh.reused,undefined);
 const g=fixture(),saved=linkedNote(g);g.setOpenWarning('笔记已保存，但未能打开：窗口已关闭。可在文库中该论文下打开这条笔记');
 const warned=await g.E.saveReaderAIMessage(g.reader,saved.message,{position:plain(saved.position),asNote:true});
 assert.equal(warned.reused,true);assert.match(warned.warning,/笔记已保存，但未能打开/);
});
test('a saved note of another paper is not extended with this PDF\'s marker; this paper gets its own note',async()=>{
 const f=fixture(),other=new f.Item('note');other.libraryID=1;other.parentID=3;other.content='<div data-schema-version="9"><p>回答</p></div>';f.items.set(other.id,other);
 const position={pageIndex:0,rects:[[100,300,122,322]]},result=await f.E.saveReaderAIMessage(f.reader,{id:'m1',text:'回答',savedNoteID:other.id,savedAnchors:[]},{position,asNote:true});
 assert.equal(result.noteID,60,'this paper gets its note through the ordinary note creation');assert.equal(result.extended,undefined);
 assert.equal(other.content,'<div data-schema-version="9"><p>回答</p></div>','the other paper\'s note is unchanged');
 assert.deepEqual(plain(f.calls),[['save','annotation'],['annotations',[result.annotationID]]],'no link entry and no write to the other note');
 const g=fixture(),loose=new g.Item('note');loose.libraryID=1;loose.content='<div><p>回答</p></div>';g.items.set(loose.id,loose);
 const fromWorkbench=await g.E.saveReaderAIMessage(g.reader,{id:'m2',text:'回答',savedNoteID:loose.id},{position,asNote:true});
 assert.equal(fromWorkbench.noteID,60,'a standalone note saved from the workbench is not this paper\'s note either');
});
test('for a standalone PDF only a note that this answer saved from that PDF is extended',async()=>{
 const f=fixture(),{note,message}=linkedNote(f);f.items.get(9).parentID=undefined;note.parentID=undefined;
 const tied=await f.E.saveReaderAIMessage(f.reader,message,{position:{pageIndex:0,rects:[[100,300,122,322]]},asNote:true});
 assert.equal(tied.extended,true,'the note made from this PDF gets the new place');assert.equal(tied.noteID,note.id);
 const fresh=await f.E.saveReaderAIMessage(f.reader,{...message,savedAnchors:[]},{position:{pageIndex:0,rects:[[200,300,222,322]]},asNote:true});
 assert.equal(fresh.noteID,60,'another standalone note of the library is not this PDF\'s note');assert.equal(fresh.extended,undefined);
 const reopened={...message,savedAnchors:[{sessionID:'s1',messageID:'m1',noteID:note.id,attachmentID:9,reused:true}]};
 const own=await f.E.saveReaderAIMessage(f.reader,reopened,{position:{pageIndex:0,rects:[[300,300,322,322]]},asNote:true});
 assert.equal(own.noteID,60,'reopening a note while this PDF was shown does not make it this PDF\'s note');
});
test('a plain annotation at the same place is not taken for the note\'s own marker',async()=>{
 const f=fixture(),{note,position}=linkedNote(f),plainMarker=new f.Item('annotation');plainMarker.parentID=9;f.items.set(plainMarker.id,plainMarker);
 // The answer was saved as a note without a place, then as a plain annotation here.
 const message={id:'m1',text:'回答',savedNoteID:note.id,savedAnchors:[{sessionID:'s1',messageID:'m1',noteID:note.id,attachmentID:9},{sessionID:'s1',messageID:'m1',annotationID:plainMarker.id,annotationKey:plainMarker.key,attachmentID:9,position}]};
 const result=await f.E.saveReaderAIMessage(f.reader,message,{position:plain(position),asNote:true});
 assert.equal(result.reused,undefined,'not reported as reopening a saved note');assert.equal(result.extended,true);assert.notEqual(result.annotationID,plainMarker.id);
 assert.ok(note.content.includes('annotation='+result.annotationKey),'the note links this place');
});
test('a note that cannot be saved keeps no link entry for the new marker',async()=>{
 const f=fixture(),{note,message}=linkedNote(f);note.saveTx=async()=>{throw Error('磁盘已满');};
 await assert.rejects(f.E.saveReaderAIMessage(f.reader,message,{position:{pageIndex:0,rects:[[100,300,122,322]]},asNote:true}),/磁盘已满/);
 assert.ok(!f.calls.some(call=>call[0]==='link'),'readerNoteLinks gets no entry for a note that does not link the marker');
});
test('a dropped answer is saved with the live message, and the status names what happened',async()=>{
 const start=source.indexOf('  const savePending=async'),end=source.indexOf('  dropHint.onclick=');assert.ok(start>0&&end>start);
 const saves=[],results=[{noteID:20,reused:true,warning:''},{noteID:20,extended:true,warning:''},{noteID:20,reused:true,warning:'笔记已保存，但未能打开：窗口已关闭'},{annotationID:30}],anchors=[],statuses=[];let hidden=0;
 const live={id:'m1',role:'assistant',text:'回答',savedNoteID:20,savedAnchors:[{annotationID:21}]};
 const context={pendingMessage:null,clearPending(){context.pendingMessage=null;},surface:{state:{embedded:false,locked:false},setStatus:text=>statuses.push(text),hide:()=>hidden++},
  conversations:{get:id=>id==='s1'?{id,messages:[live]}:null},rememberMessageAnchor:async(...args)=>anchors.push(args),Zotero:{logError(){}},
  E:{saveReaderAIMessage:async(_reader,message)=>{saves.push(message);return results.shift();}}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.savePending=savePending;',context);
 const drop=()=>{context.pendingMessage={reader:{itemID:9},sessionID:'s1',message:{id:'m1',role:'assistant',text:'回答',question:'问题'},position:{pageIndex:0,rects:[[1,2,3,4]]}};};
 drop();await context.savePending(true);
 assert.equal(saves[0].savedNoteID,20,'the drag snapshot predates the earlier save; the live message knows its note');assert.equal(saves[0].question,'问题','the snapshot keeps the question for the note text');
 assert.equal(statuses.at(-1),'已打开已保存的关联笔记');
 drop();await context.savePending(true);assert.equal(statuses.at(-1),'已在已保存的笔记中加入这个位置');
 drop();await context.savePending(true);assert.equal(statuses.at(-1),'笔记已保存，但未能打开：窗口已关闭');
 drop();await context.savePending(false);assert.equal(statuses.at(-1),'已保存为 PDF 批注');
 assert.equal(anchors.length,4,'every save records its anchor');assert.equal(hidden,2,'a warning stays visible instead of closing the chat');
});
