/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {marginCommentLayout} from '../../chrome/content/zotero/research/shared/comment-layout.mjs';
test('margin comments follow actual visible geometry rather than database order',()=>{
 const result=marginCommentLayout([{id:'last',pageIndex:1,anchorY:330,pageRight:810,height:80},{id:'first',pageIndex:0,anchorY:90,pageRight:810,height:60}],{viewportWidth:1020,viewportHeight:600});assert.deepEqual(result.map(value=>value.id),['first','last']);assert.equal(result[0].left,814);assert.equal(result[0].top,90);assert.equal(result[1].top,330);
});
test('nearby comments fit the actual viewport and retain source order without colliding',()=>{
 const result=marginCommentLayout([{id:'a',anchorY:400,pageRight:400,height:90},{id:'b',anchorY:430,pageRight:400,height:90}],{viewportWidth:590,viewportHeight:500,width:148});assert.ok(result[0].top+result[0].height+6<=result[1].top);assert.ok(result[1].top+result[1].height<=492);assert.equal(result[0].left,404);assert.deepEqual(result.map(value=>value.id),['a','b']);
});
test('manual paper zoom clamps the outside card to the available viewport',()=>{
 const [result]=marginCommentLayout([{id:'zoomed',anchorY:80,pageRight:960,height:40}],{viewportWidth:700,viewportHeight:500});assert.equal(result.left,514);assert.equal(result.left+result.width,692);
});
