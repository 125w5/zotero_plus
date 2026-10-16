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
 const items=new Map(),calls=[],attachment={id:9,parentID:4,libraryID:1,getCollections:()=>[5]},E={core:{escapeHTML:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))},library:{uri:(_item,page)=>'zotero://open-pdf/library/items/TEST?page='+(page+1)},noteContentHTML:text=>'<p>'+E.core.escapeHTML(text)+'</p>',openReaderNote:async id=>calls.push(['open',id]),noteFromAnnotation:async(_reader,key)=>({noteID:60,annotationKey:key})};
 items.set(9,attachment);let editable=true,nextID=20;
 class Item{constructor(type){this.type=type;this.id=nextID++;this.key='KEY'+this.id;}setNote(text){this.content=text;}setCollections(values){this.collections=values;}async saveTx(){items.set(this.id,this);calls.push(['save',this.type]);}}
 const Zotero={Research:E,Item,Items:{getAsync:async id=>items.get(id),get:id=>items.get(id)},Libraries:{get:()=>({editable})}};
 vm.runInContext(source,vm.createContext({Zotero,ChromeUtils:{importESModule:uri=>uri.endsWith('reader-ai-orb.mjs')?geometry:uri.endsWith('chat-evidence.mjs')?Evidence:{}},Components:{utils:{unwaiveXrays:value=>value.canonicalDocument||value}},Map,Number,JSON}));
 const reader={itemID:9,_internalReader:{_state:{readOnly:false},_primaryView:{_iframeWindow:{PDFViewerApplication:{pdfDocument:{numPages:2},pdfViewer:{_pages:[{viewport:{viewBox:[0,0,600,800]}}]}}}}},setAnnotations:async annotations=>calls.push(['annotations',annotations.map(a=>a.id)])};
 return {E,reader,items,calls,setEditable:value=>editable=value};
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
