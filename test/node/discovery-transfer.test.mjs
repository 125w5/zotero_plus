/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_PAPER_MIME,setDiscoveryPaperDragData,discoveryPaperDrop,receiveDiscoveryPaper} from '../../chrome/content/zotero/research/shared/discovery-transfer.mjs';
const transfer=()=>{const data=new Map();return {get types(){return [...data.keys()];},setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''};};
test('a recommendation drag advertises a structured paper while leaving its text available',()=>{
 const dataTransfer=transfer();setDiscoveryPaperDragData({dataTransfer},{id:'a',title:'研究论文',pdf:'https://example.org/a.pdf',secret:'excluded'},{destination:{collectionID:7,projectID:'p'}});
 assert.equal(dataTransfer.effectAllowed,'copy');assert.equal(dataTransfer.getData('text/plain'),'研究论文');const value=discoveryPaperDrop(dataTransfer);assert.equal(value.paper.secret,undefined);assert.equal(value.destination.collectionID,7);
 assert.deepEqual(discoveryPaperDrop({types:[DISCOVERY_PAPER_MIME],getData:()=>''}),{pending:true});
});
test('dropping a remote paper downloads into the target project and associates the original target conversation',async()=>{
 const calls=[],progress=[],E={workbenchConversations:{get:id=>id==='first'?{projectID:'p'}:null},manuscripts:{get:()=>({paperCollectionID:17})},store:{get:()=>({settings:{discoveryDestination:{collectionID:3,libraryID:1}}})},obtainPaper:async(record,options)=>{calls.push([record,options]);options.onProgress({text:'下载中'});return {attachmentID:22};},chatAttachments:{attach:async(...args)=>calls.push(args)}};
 const result=await receiveDiscoveryPaper({E,sessionID:'first',drop:{paper:{id:'a',title:'A',pdf:'https://example.org/a.pdf'},destination:{collectionID:8}},onProgress:text=>progress.push(text)});
 assert.equal(calls[0][1].collectionID,17);assert.equal(calls[0][1].open,false);assert.deepEqual(calls[1],['first',{items:[22]},{source:'drop'}]);assert.match(result,/PDF 已保存/);assert.ok(progress.includes('下载中'));
 await assert.rejects(()=>receiveDiscoveryPaper({E,sessionID:'deleted',drop:{paper:{id:'a'}}}),/选择目标对话/);assert.equal(calls.length,2);
});
test('a new download folder is retained and a failed link never claims the PDF was lost',async()=>{
 let target,attached=0;const state={settings:{}},E={workbenchConversations:{get:()=>({})},store:{get:()=>state,update:async fn=>fn(state)},createDiscoveryCollection:async()=>({id:30,libraryID:1}),obtainPaper:async(_r,options)=>{target=options;return {attachmentID:7};},chatAttachments:{attach:async()=>{attached++;throw Error('对话已移除');}}};
 await assert.rejects(()=>receiveDiscoveryPaper({E,sessionID:'s',drop:{paper:{id:'x'},destination:{}}}),/PDF 已保存在所选文件夹/);assert.equal(target.collectionID,30);assert.equal(state.settings.discoveryDestination.collectionID,30);assert.equal(attached,1);
});
test('a downloaded paper is reused without another network request',async()=>{
 let attached;const E={workbenchConversations:{get:()=>({})},chatAttachments:{attach:async(...args)=>attached=args}};await receiveDiscoveryPaper({E,sessionID:'s',drop:{paper:{attachmentID:8}}});assert.deepEqual(attached,['s',{items:[8]},{source:'drop'}]);
});
test('the drop receipt contains only the downloaded attachment even with a concurrent unrelated import',async()=>{
 let receipt;const E={workbenchConversations:{get:()=>({})},chatAttachments:{attach:async()=>[{id:'attachment:8',attachmentID:8},{id:'attachment:9',attachmentID:9}]}};
 await receiveDiscoveryPaper({E,sessionID:'s',drop:{paper:{attachmentID:8}},onReferences:rows=>receipt=rows});assert.deepEqual(receipt,[{id:'attachment:8',attachmentID:8}]);
});
