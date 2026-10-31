/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A canvas render restores the caret into the paragraph edited last
// (renderEditor). In Gecko that selection change focuses the paragraph, so an
// open material title editor would lose focus and save the half-typed title,
// and the paragraph's focus handler (selectBlock) would close the material.
// While the title editor is open the caret stays in the editor; once it
// closes, a render restores the caret again. Real assembly code and services:
// assembly-details-harness.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key} from './assembly-details-harness.mjs';

const paragraph={id:'b1',type:'paragraph',sectionID:'s1',text:'这是正在写的正文段落。',materials:[],role:'support',targetWords:300,requirements:'',review:'missing',claim:false,revision:1};
const triggers={
	'a canvas render':f=>f.render(),
	'another referenced material changes elsewhere':f=>f.edit('m2',{summary:'第二份的新说明'})
};

test('a canvas render keeps the open title editor, its typed title and the material; the caret returns once the editor closes',async()=>{
	for(const [name,trigger] of Object.entries(triggers)){
		const f=await fixture({blocks:[paragraph],ui:{blockID:'b1',caret:3}});
		f.render();
		assert.equal(f.doc.activeElement,f.paragraph(),name+': the first render restores the caret into the paragraph');
		const {input}=f.open('m1');
		assert.equal(f.doc.activeElement,input);
		input.value='我改的';
		const adds=f.selection.adds;
		await trigger(f);await f.flush();
		assert.equal(f.stored('m1').title,'原标题',name+': the half-typed title is not saved');
		assert.equal(f.U.previewMaterialID,'m1',name+': the material stays open');assert.equal(f.box.dataset.materialId,'m1',name);
		assert.ok(input.isConnected,name+': the title editor stays open');
		assert.equal(f.doc.activeElement,input,name+': the title editor keeps focus');assert.equal(input.value,'我改的',name);
		assert.equal(f.selection.adds,adds,name+': the caret is not moved while the title editor is open');
		input.value='我改的标题';input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.stored('m1').title,'我改的标题',name+': the finished title is saved');assert.equal(input.isConnected,false);
		f.render();
		assert.equal(f.doc.activeElement,f.paragraph(),name+': after the editor closes a render restores the caret');
		assert.equal(f.selection.ranges[0].startOffset,3,name);
		assert.deepEqual(f.failures,[],name);
	}
});
