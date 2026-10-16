import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePaperOutline} from '../../chrome/content/zotero/research/shared/paper-outline.mjs';
const row = (title, page) => ({title, location:{pageIndex:page}, items:[]});
test('flat numbered papers become expandable sections without losing destinations',()=>{
 const source=[row('World Model-Based Learning for Wireless Networks',0),row('I. INTRODUCTION',0),row('II. SYSTEM MODEL',1),row('A. Transmission Model',1),row('B. CAoI Metric',2),row('III. RESULTS',5),row('REFERENCES',6)];
 const grouped=normalizePaperOutline(source);
 assert.equal(grouped.length,1);assert.equal(grouped[0].items.length,4);
 assert.deepEqual(grouped[0].items[1].items.map(x=>x.title),['A. Transmission Model','B. CAoI Metric']);
 assert.deepEqual(grouped[0].items[1].items[1].location,source[4].location);assert.equal(source[2].items.length,0);
 assert.equal(grouped[0].items[1].expanded,true);
});
test('two articles stay distinct and decimal subsections retain their own parent',()=>{
 const grouped=normalizePaperOutline([row('A sufficiently long title for the first article',0),row('1. Introduction',0),row('2. Methods',1),row('2.1 Architecture',2),row('2.1.1 Encoder',2),row('REFERENCES',3),row('A sufficiently long title for a second article',4),row('I. INTRODUCTION',4),row('II. SYSTEM',5),row('A. Model',5)]);
 assert.equal(grouped.length,2);assert.equal(grouped[0].items[1].items[0].items[0].title,'2.1.1 Encoder');assert.equal(grouped[1].items[1].items[0].title,'A. Model');
});
test('unnumbered and already hierarchical PDF bookmarks are preserved',()=>{
 const source=[{...row('Methods',1),items:[row('Analysis',2)]},row('Results',3),row('Discussion',4)];
 assert.equal(normalizePaperOutline(source),source);
});
