/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A canvas render restores the caret into the paragraph edited last
// (renderEditor). In Gecko that selection change focuses the paragraph, so an
// open material title or 说明 editor would lose focus, and the paragraph's
// focus handler (selectBlock) would close the material shown in the details.
// Renders and background refreshes leave a shown material, its editors and the
// caret alone; once the user is back in the text (返回正文) a render restores
// the caret again. Real assembly code and services: assembly-details-harness.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key} from './assembly-details-harness.mjs';

const paragraph={id:'b1',type:'paragraph',sectionID:'s1',text:'这是正在写的正文段落。',materials:[],role:'support',targetWords:300,requirements:'',review:'missing',claim:false,revision:1};
const triggers={
	'a canvas render':f=>f.render(),
	'another referenced material changes elsewhere':(f,n)=>f.edit('m2',{summary:'第二份的新说明 '+n})
};

test('a canvas render keeps the open title editor, its typed title and the material; the caret returns once the user is back in the text',async()=>{
	for(const [name,trigger] of Object.entries(triggers)){
		const f=await fixture({blocks:[paragraph],ui:{blockID:'b1',caret:3}});
		f.render();
		assert.equal(f.doc.activeElement,f.paragraph(),name+': the first render restores the caret into the paragraph');
		const {input}=f.open('m1');
		assert.equal(f.doc.activeElement,input);
		input.value='我改的';
		const adds=f.selection.adds;
		await trigger(f,1);await f.flush();
		assert.equal(f.stored('m1').title,'原标题',name+': the half-typed title is not saved');
		assert.equal(f.U.previewMaterialID,'m1',name+': the material stays open');assert.equal(f.box.dataset.materialId,'m1',name);
		assert.ok(input.isConnected,name+': the title editor stays open');
		assert.equal(f.doc.activeElement,input,name+': the title editor keeps focus');assert.equal(input.value,'我改的',name);
		assert.equal(f.selection.adds,adds,name+': the caret is not moved while the title editor is open');
		input.value='我改的标题';input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.stored('m1').title,'我改的标题',name+': the finished title is saved');assert.equal(input.isConnected,false);
		await trigger(f,2);await f.flush();
		assert.equal(f.U.previewMaterialID,'m1',name+': the renamed material stays open');assert.equal(f.box.dataset.materialId,'m1',name);
		assert.equal(f.selection.adds,adds,name+': the caret is not moved while a material is shown');
		await f.box.querySelector('[data-action="return-module"]').onclick();await f.flush();
		assert.equal(f.U.previewMaterialID,null,name+': 返回正文 closes the material');
		f.render();
		assert.equal(f.doc.activeElement,f.paragraph(),name+': back in the text, a render restores the caret');
		assert.equal(f.selection.ranges[0].startOffset,3,name);
		assert.deepEqual(f.failures,[],name);
	}
});

test('a change of another referenced material leaves a shown material and its 说明 editor alone',async()=>{
	for(const step of ['reading','writing its 说明']){
		const f=await fixture({blocks:[paragraph],ui:{blockID:'b1',caret:3}});let textarea=null;
		// The 说明 editor (material-content-editor.mjs) in the details.
		f.sandbox.renderMaterialOverview=host=>{const root=f.doc.createElement('section'),summaryHost=f.doc.createElement('div');root.append(summaryHost);host.append(root);return {summaryHost,dispose:()=>root.remove()};};
		f.sandbox.renderMaterialExplanationEditor=host=>{textarea=f.doc.createElement('textarea');host.append(textarea);let dirty=false;textarea.oninput=()=>{dirty=true;};return {isDirty:()=>dirty,dispose(){textarea.remove();}};};
		f.render();f.show('m1');
		if(step==='reading')f.doc._active=null;else{textarea.focus();textarea.value='写了一半的说明';textarea.oninput();}
		const adds=f.selection.adds;
		await f.edit('m2',{summary:'第二份的新说明'});await f.flush();
		assert.equal(f.U.previewMaterialID,'m1',step+': the material stays open');assert.equal(f.box.dataset.materialId,'m1',step);
		assert.equal(f.selection.adds,adds,step+': the caret is not moved');
		if(step!=='reading'){assert.ok(textarea.isConnected,step+': the 说明 editor stays open');assert.equal(f.doc.activeElement,textarea,step+': and keeps focus');assert.equal(textarea.value,'写了一半的说明',step);}
		assert.deepEqual(f.failures,[],step);
	}
});
