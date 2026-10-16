/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleDetailCurrent,moduleWordCount} from '../../chrome/content/zotero/research/manuscript/module-details.mjs';

test('word counts recognize Chinese characters and English terms without counting whitespace or punctuation',()=>{
 assert.equal(moduleWordCount({text:'人工正文，test conditions: x_i.'}),7);
 assert.equal(moduleWordCount({text:'  \n\t ,。'}),0);
 assert.equal(moduleWordCount({type:'table',table:{rows:[[{text:'训练 batch'},{text:'隐藏内容',hidden:true}],[{text:'样本 14'}]]}}),6);
});
test('a detail control belongs to the selected block identity and ignores unrelated pointer regions',()=>{
 const first={id:'first'},second={id:'second'},p={ui:{blockID:first.id},blocks:[first,second]},U={p},root={isConnected:true};
 assert.equal(moduleDetailCurrent(U,first,root,p),true);
 U.pointerRegion=second.id;U.hoveredMaterialID='unrelated-source';assert.equal(moduleDetailCurrent(U,first,root,p),true);
 U.p.ui.blockID=second.id;assert.equal(moduleDetailCurrent(U,first,root,p),false);assert.equal(moduleDetailCurrent(U,second,root,p),true);
});
test('removed roots, intentional source previews, replaced blocks and replaced projects invalidate old controls',()=>{
 const block={id:'retained-id'},p={ui:{blockID:block.id},blocks:[block]},U={p},root={isConnected:true};
 U.previewMaterialID='source';assert.equal(moduleDetailCurrent(U,block,root,p),false);delete U.previewMaterialID;
 root.isConnected=false;assert.equal(moduleDetailCurrent(U,block,root,p),false);root.isConnected=true;
 p.blocks=[{id:block.id}];assert.equal(moduleDetailCurrent(U,block,root,p),false);p.blocks=[block];
 U.p={ui:p.ui,blocks:p.blocks};assert.equal(moduleDetailCurrent(U,block,root,p),false);
});
