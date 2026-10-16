/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {belongsToLibraryScope,libraryItemScopeActive} from '../../chrome/content/zotero/research/shared/library-item-scope.mjs';
const item=(id,type,parentID=null)=>({id,parentItemID:parentID,isRegularItem:()=>type==='paper',isNote:()=>type==='note',isAttachment:()=>type==='pdf'||type==='embedded',isEmbeddedImageAttachment:()=>type==='embedded'});
test('paper scope retains actual descendants while unlinked notes and attachments remain a separate reversible view',()=>{
 const rows=[item(1,'paper'),item(2,'pdf',1),item(3,'note',1),item(4,'annotation',2),item(5,'note'),item(6,'pdf'),item(7,'embedded',5)],map=new Map(rows.map(r=>[r.id,r])),get=id=>map.get(id),before=rows.map(r=>[r.id,r.parentItemID]);
 assert.deepEqual(rows.filter(r=>belongsToLibraryScope(r,'papers',get)).map(r=>r.id),[1,2,3,4]);assert.deepEqual(rows.filter(r=>belongsToLibraryScope(r,'unlinked',get)).map(r=>r.id),[5,6]);assert.deepEqual(rows.map(r=>[r.id,r.parentItemID]),before);
});
test('scope does not hide saved-search, trash or plugin trees unless their normal library view explicitly opts in',()=>{
 assert.equal(libraryItemScopeActive({researchItemScope:'papers',collectionTreeRows:[{isLibrary:()=>true}]}),true);
 assert.equal(libraryItemScopeActive({researchItemScope:'unlinked',collectionTreeRows:[{isCollection:()=>true}]}),true);
 for(const type of ['trash','search','duplicates','feed'])assert.equal(libraryItemScopeActive({researchItemScope:'papers',collectionTreeRows:[{type}]}),false);
 assert.equal(libraryItemScopeActive({collectionTreeRows:[{isLibrary:()=>true}]}),false);
});
test('broken parents and cycles never infer a paper relationship or mutate source data',()=>{
 const a=item(1,'note',2),b=item(2,'pdf',1),rows=new Map([[1,a],[2,b]]);assert.equal(belongsToLibraryScope(a,'papers',id=>rows.get(id)),false);assert.equal(belongsToLibraryScope(item(3,'note',99),'papers',()=>undefined),false);assert.equal(a.parentItemID,2);assert.equal(b.parentItemID,1);
});
test('real assembly project links distinguish manuscript projects from genuine manuscript papers without changing either',()=>{const paper=item(1,'paper'),project=item(2,'paper'),note=item(3,'note',2),map=new Map([[1,paper],[2,project],[3,note]]),get=id=>map.get(id),linked=row=>row.id===2;assert.equal(belongsToLibraryScope(paper,'papers',get,linked),true);assert.equal(belongsToLibraryScope(project,'papers',get,linked),false);assert.equal(belongsToLibraryScope(note,'papers',get,linked),false);assert.equal(belongsToLibraryScope(project,'unlinked',get,linked),true);assert.equal(note.parentItemID,2);});
