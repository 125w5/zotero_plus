/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {paragraphAlignment,carryParagraphFormat,setParagraphAlignment} from '../../chrome/content/zotero/research/shared/paragraph-format.mjs';
import {block,clone} from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

test('alignment changes keep rich text and source relationships exactly',()=>{
 for(const textAlign of ['left','center','right','justify']){
  const b=block('paragraph','chapter',{text:'实际正文 xᵢ',runs:[{text:'实际正文 ',bold:true},{text:'x',italic:true},{text:'i',sub:true}],materials:[{id:'source-1',revision:3}],sourceAnchors:[{attachmentID:17,pageIndex:2}]});
  const before=clone(b);assert.equal(setParagraphAlignment(b,textAlign),true);assert.equal(b.textAlign,textAlign);assert.equal(b.revision,before.revision+1);
  for(const key of ['id','text','runs','materials','sourceAnchors','sectionID'])assert.deepEqual(b[key],before[key]);assert.equal(paragraphAlignment(clone(b)),textAlign);
 }
});
test('repeated alignment is a no-op rather than another revision',()=>{const b=block('paragraph','chapter',{textAlign:'center'}),before=clone(b);assert.equal(setParagraphAlignment(b,'center'),false);assert.deepEqual(b,before);});
test('ordinary splitting and page breaking may carry alignment without copying the source text',()=>{const b=block('paragraph','chapter',{text:'private paragraph',textAlign:'right',materials:[{id:'source-1'}]});const next=block('paragraph','chapter',{text:'remaining paragraph',...carryParagraphFormat(b)});assert.equal(next.textAlign,'right');assert.notEqual(next.id,b.id);assert.equal(next.text,'remaining paragraph');assert.deepEqual(next.materials,[]);});
test('old blocks retain the default and do not gain new persisted fields during rendering',()=>{const old={type:'paragraph',text:'older manuscript'},before=clone(old);assert.equal(paragraphAlignment(old),'left');assert.deepEqual(carryParagraphFormat(old),{});assert.deepEqual(old,before);});
test('locked and unsupported blocks reject formatting without modifying content',()=>{for(const b of [block('paragraph','chapter',{text:'locked',locked:true}),block('table','chapter',{text:'data'}),block('formula','chapter',{text:'x_i'})]){const before=clone(b);assert.throws(()=>setParagraphAlignment(b,'center'));assert.deepEqual(b,before);}});
test('invalid persisted values cannot become CSS or exported alignments',()=>{const b=block('paragraph','chapter',{text:'body',textAlign:'center; color:red'}),before=clone(b);assert.equal(paragraphAlignment(b),'left');assert.deepEqual(carryParagraphFormat(b),{});assert.throws(()=>setParagraphAlignment(b,'start'));assert.deepEqual(b,before);});
