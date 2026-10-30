/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-panes.js',import.meta.url),'utf8');
function setup(){
 const attachment=id=>({id,parentID:10,isPDFAttachment:()=>true}),pdfA=attachment(11),pdfB=attachment(12),readers={a:{tabID:'a',itemID:11},b:{tabID:'b',itemID:12}},context={tabID:'a',item:{id:10}},win={Zotero_Tabs:{selectedID:'a'}},body={ownerDocument:{defaultView:win},panel:null,clears:0,closest:()=>context,querySelector(){return this.panel;},replaceChildren(){this.panel=null;this.clears++;},setAttribute(){},removeAttribute(){}};
 const opened=[],E={library:{localPDF:async()=>pdfA},openAssetPanel:reader=>{opened.push(reader.itemID);body.panel={dispose(){body.panel=null;}};}};
 const Zotero={Research:E,Reader:{getByTabID:id=>readers[id]},Items:{get:id=>id===11?pdfA:pdfB}};
 vm.runInNewContext(script,{Zotero,ChromeUtils:{importESModule:()=>({})},Map,Set,AbortController,Promise});return {E,body,context,opened,pdfA,pdfB};
}
test('the evidence pane binds to the selected PDF version even when both tabs share a parent paper',async()=>{
 const {E,body,context,opened}=setup(),paper={id:10};await E.renderImagePane(body,paper);assert.deepEqual(opened,[11]);assert.equal(body._paneReader,'a');await E.renderImagePane(body,paper);assert.deepEqual(opened,[11]);
 context.tabID='b';await E.renderImagePane(body,paper);assert.deepEqual(opened,[11,12]);assert.equal(body._paneAttachment,12);assert.equal(body._paneReader,'b');
});
test('a delayed old PDF lookup cannot overwrite the newer selected paper',async()=>{
 const {E,body,context,opened,pdfA}=setup();context.tabID='none';let release;E.library.localPDF=()=>new Promise(resolve=>{release=resolve;});
 const old=E.renderImagePane(body,{id:99});context.tabID='b';await E.renderImagePane(body,{id:10});release(pdfA);await old;assert.deepEqual(opened,[12]);assert.equal(body._paneAttachment,12);
});
