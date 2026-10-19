/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-tools.js',import.meta.url),'utf8');
test('annotation typing reuses its link index, invalidates on link commits and checks note deletion live',()=>{
 let revision=1,reads=0;const links={one:{attachmentID:8,annotationKey:'A',noteID:1},two:{attachmentID:8,annotationKey:'A',noteID:2}},notes=new Map([[1,{deleted:false}],[2,{deleted:false}]]);
 const E={store:{branchRevision:()=>revision,get:()=>{reads++;return links;}}};
 vm.runInNewContext(source,{Zotero:{Research:E,Items:{get:id=>notes.get(id)}},ChromeUtils:{importESModule:path=>path.endsWith('reader-rapid-reading.mjs')?{installRapidReading(){}}:{}}});
 for(let n=0;n<100;n++)assert.equal(E.noteLinkForAnnotation(8,'A').noteID,1);assert.equal(reads,1);
 notes.get(1).deleted=true;assert.equal(E.noteLinkForAnnotation(8,'A').noteID,2);assert.equal(reads,1);
 links.three={attachmentID:9,annotationKey:'B',noteID:2};revision++;assert.equal(E.noteLinkForAnnotation(9,'B').noteID,2);assert.equal(reads,2);
});
