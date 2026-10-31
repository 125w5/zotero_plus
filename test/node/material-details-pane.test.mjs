/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The assembly material details pane (main.mjs materialDetails, its title
// editor and refreshAssetViews): a click on a material whose title editor is
// still open shows the collapsed right pane; a rename saved in a reopened
// editor replaces the error an earlier failed rename of the same material left
// in the status bar; replacing the details without a blur saves the typed
// title; a fully excluded material is not rebuilt by notifications about other
// materials; closing the title editor of a partly excluded material keeps the
// heading of the shortened view. Real assembly code and services, with Gecko
// focus: assembly-details-harness.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIAL_EXCLUSION_TAG} from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import {fixture,asset,key,settle} from './assembly-details-harness.mjs';

// The toolbar button (main.mjs): collapse or show the right pane and save the project.
const toggleRight=f=>{f.U.p.ui.rightOpen=!f.U.p.ui.rightOpen;f.sandbox.persist();};
const mark=(id,text)=>({id,key:'MARK'+id,parentID:7,annotationType:'ink',annotationText:text,annotationPosition:JSON.stringify({pageIndex:0}),tags:[{tag:MATERIAL_EXCLUSION_TAG}],isAnnotation:()=>true});

test('clicking a material whose title editor is still open shows the collapsed right pane',async()=>{
	const cases={
		'the title changed elsewhere':async(f,input)=>{await f.edit('m1',{title:'别处的标题'});input.onkeydown(key('Enter'));await settle();},
		'the save keeps failing':async(f,input)=>{f.fail(4);input.onkeydown(key('Enter'));}
	};
	for(const [name,start] of Object.entries(cases)){
		const f=await fixture(),{heading,input}=f.open('m1');input.value='我改的标题';
		await start(f,input);await f.flush();
		// The toolbar button takes focus first: the field saves on blur and stays open.
		input.onblur();toggleRight(f);await f.flush();
		assert.equal(f.U.p.ui.rightOpen,false,name);assert.ok(input.isConnected,name+': the editor stays in the hidden pane');
		f.show('m1');await f.flush();
		assert.equal(f.U.p.ui.rightOpen,true,name+': the click shows the pane');
		assert.equal(f.state('manuscripts','p').ui.rightOpen,true,name+': the shown pane is saved with the project');
		assert.ok(input.isConnected,name+': the open editor is kept');assert.equal(input.value,'我改的标题',name+': with the typed title');
		assert.match(heading.textContent,name.startsWith('the title')?/别处改为“别处的标题”/:/标题未保存：存储写入失败/,name+': and its question or error');
		assert.equal(f.stored('m1').title,name.startsWith('the title')?'别处的标题':'原标题',name);
		assert.deepEqual(f.failures,[],name);
	}
});

test('a rename saved in a reopened title editor replaces the error an earlier failed rename of the same material left',async()=>{
	const cases={
		'the workspace file could not be written':{start:async(f,input)=>{f.fail(2);const release=f.hold();input.onblur();await settle();f.show('m2');release();},error:'“原标题”的新标题“我改的标题”未保存：存储写入失败。'},
		'the title changed elsewhere':{start:async(f,input)=>{await f.edit('m1',{title:'别处的标题'});input.onblur();await settle();f.show('m2');},error:'“原标题”的新标题“我改的标题”未保存：这份素材的标题已在别处改为“别处的标题”。'}
	};
	for(const [name,{start,error}] of Object.entries(cases)){
		const f=await fixture(),{input}=f.open('m1');input.value='我改的标题';
		await start(f,input);await f.flush();
		assert.equal(f.box.dataset.materialId,'m2',name);assert.notEqual(f.stored('m1').title,'我改的标题',name);
		assert.deepEqual(f.notice(),{text:error,error:true},name+': the failure is reported');
		// Esc in a reopened editor and a rename of another material leave the error.
		f.open('m1').input.onkeydown(key('Escape'));await f.flush();
		assert.deepEqual(f.notice(),{text:error,error:true},name+': Esc keeps the error');
		const other=f.open('m2');other.input.value='第二份的新标题';other.input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.stored('m2').title,'第二份的新标题',name);assert.deepEqual(f.notice(),{text:error,error:true},name+': another material keeps the error');
		const again=f.open('m1');again.input.value='我改的标题';again.input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.stored('m1').title,'我改的标题',name);assert.equal(f.box.querySelector('h3').textContent,'我改的标题',name);
		assert.deepEqual(f.notice(),{text:'已保存新标题“我改的标题”',error:false},name+': the saved title replaces the error');
		assert.deepEqual(f.failures,[],name);
	}
});

// Gecko fires no blur when the focused field is removed (clearDetails commits it).
test('details replaced without a blur save the title typed in the open editor',async()=>{
	const moves={'another material is shown':f=>f.show('m2'),'the notebook selects another material':f=>f.N.select('p','m2')};
	for(const [name,move] of Object.entries(moves)){
		// The notebook selection that opening m1 starts settles before the move.
		const f=await fixture(),{input}=f.open('m1');await settle();
		input.value='我改的标题';
		await move(f);await f.flush();
		assert.equal(f.box.dataset.materialId,'m2',name);assert.equal(input.isConnected,false,name);
		assert.equal(f.stored('m1').title,'我改的标题',name+': the typed title is saved');
		assert.deepEqual(f.failures,[],name);
	}
	const text='The cameras are calibrated before each run.',copy={id:'corpus-e1',kind:'paragraph',sectionType:'方法',title:'Methods',summary:'说明测量装置。',sourceText:text,paperTitle:'Camera study',origin:'manual',revision:1,anchor:{attachmentID:9,pageIndex:0,sourceText:text}};
	const g=await fixture({local:[copy]}),{input}=g.open('corpus-e1');input.value='我的方法条目';
	const undo=g.U.undo.length;g.show('m1');await g.flush();
	assert.equal(g.box.dataset.materialId,'m1');
	assert.equal(g.U.p.materials.find(row=>row.id==='corpus-e1').title,'我的方法条目','a project-only copy keeps the typed title');
	assert.equal(g.U.undo.length,undo+1,'the project-only rename is one undo step');
	assert.equal(g.writes,0,'a project-only rename writes no shared material');
});

test('a fully excluded material is not rebuilt by notifications about other materials',async()=>{
	const excluded=asset('x1',7,{title:'受控素材',sourceText:'OMITTED',anchor:{attachmentID:7,pageIndex:0,sourceText:'OMITTED'}});
	const f=await fixture({assets:[excluded,asset('m1',8),asset('lib1',9)],project:['x1','m1'],marks:{7:[mark(70,'OMITTED')]}});
	f.show('x1');await f.flush();
	assert.match(f.box.textContent,/该选段已划掉/,'the details show the excluded material');
	const heading=f.box.querySelector('h3'),source=f.box.querySelector('button');
	assert.equal(source.textContent,'打开原文');source.focus();
	for(const summary of ['别处更新的说明','再次更新的说明']){
		await f.edit('lib1',{summary});await f.flush();
		assert.equal(f.box.querySelector('h3'),heading,summary+': the excluded details are not rebuilt');
		assert.equal(f.doc.activeElement,source,summary+': keyboard focus stays on 打开原文');
	}
	f.show('m1');await f.flush();const ordinary=f.box.querySelector('h3');
	await f.edit('lib1',{summary:'第三次更新的说明'});await f.flush();
	assert.equal(f.box.querySelector('h3'),ordinary,'an ordinary material is not rebuilt either');
	assert.deepEqual(f.failures,[]);
});

test('closing the title editor of a partly excluded material keeps the heading of the shortened view',async()=>{
	const text='Before OMITTED after.',x1=asset('x1',7,{title:'Spin relaxation setup',sourceText:text,anchor:{attachmentID:7,pageIndex:0,sourceText:text}});
	// The full record has a generated 中文名; the shortened view has none yet.
	const named={materialDescriptions:{[JSON.stringify([x1.id,x1.revision,x1.summary,'zh-summary-v2'])]:{titleZh:'自旋弛豫装置',summaryZh:x1.summary}}};
	const f=await fixture({assets:[x1],project:['x1'],store:named,marks:{7:[mark(71,'OMITTED')]}});
	f.show('x1');await f.flush();
	const shown=f.overviews.at(-1).display,label=f.A.titleFor(shown);
	assert.equal(shown.sourceText,'Before \n\n after.','the details show the shortened text');
	assert.equal(f.A.titleFor(x1),'自旋弛豫装置');assert.notEqual(label,'自旋弛豫装置');
	assert.equal(f.box.querySelector('h3').textContent,label);
	const closes={'Esc':input=>input.onkeydown(key('Escape')),'leaving the field':input=>input.onblur(),'Enter on the unchanged title':input=>input.onkeydown(key('Enter'))};
	for(const [name,close] of Object.entries(closes)){
		const heading=f.box.querySelector('h3');heading.ondblclick();const input=heading.querySelector('input');
		assert.equal(input.value,'Spin relaxation setup',name);
		close(input);await f.flush();
		assert.equal(f.box.querySelector('h3').textContent,label,name+': the heading keeps the label of the shortened view');
	}
	assert.equal(f.stored('x1').title,'Spin relaxation setup');assert.deepEqual(f.failures,[]);
});
