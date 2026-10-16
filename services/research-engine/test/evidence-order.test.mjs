import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvidenceOrder,sortEvidence} from '../../../chrome/content/zotero/research/shared/evidence-order.mjs';
const assets=[{id:'formula',kind:'formula',pageIndex:0,bbox:[30,40,80,80]},
 {id:'image-b',kind:'figure',pageIndex:1,bbox:[10,40,80,80]},
 {id:'table',kind:'table',pageIndex:1,bbox:[10,20,80,80]},
 {id:'image-a',kind:'figure',pageIndex:0,bbox:[10,40,80,80]}];
test('evidence order follows pages and positions, reverses without altering the source array',()=>{
 const original=[...assets];assert.deepEqual(sortEvidence(assets).map(a=>a.id),['image-a','formula','table','image-b']);
 assert.deepEqual(sortEvidence(assets,{direction:'desc'}).map(a=>a.id),['image-b','table','formula','image-a']);assert.deepEqual(assets,original);
});
test('type grouping keeps original PDF anchors and reverses within each type',()=>{
 const grouped=sortEvidence(assets,{group:'type',direction:'desc'});assert.deepEqual(grouped.map(a=>a.id),['image-b','image-a','table','formula']);
 assert.strictEqual(grouped[0],assets[1]);assert.deepEqual(grouped[0].bbox,[10,40,80,80]);
});
test('invalid persisted ordering falls back to original order',()=>{
 assert.deepEqual(normalizeEvidenceOrder(null),{direction:'asc',group:'none'});assert.deepEqual(normalizeEvidenceOrder({direction:'garbage',group:'garbage'}),{direction:'asc',group:'none'});
});
