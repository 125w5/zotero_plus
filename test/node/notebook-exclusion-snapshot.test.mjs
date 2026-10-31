/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The notebook material page and the first exclusion snapshot. Once native
// annotations load, the exclusion events report each watched PDF once, also
// when it has no marks (material-exclusion-events.mjs). The selected material's
// details, with an open 原文证据 drawer, are rebuilt only when the marks they
// show changed, as on the assembly page (refreshMaterialExclusionViews); the
// list and count are refreshed either way. The real notebook page runs on the
// notebook harness; the exclusion feed and the marks are the test's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,wait} from './notebook-page-harness.mjs';

const text='The cameras are calibrated before each run with a fixed target board.';
const material={id:'m1',assetID:'m1',kind:'paragraph',revision:2,title:'标定装置素材',summary:'说明标定装置与靶板。',sourceText:text,anchor:{attachmentID:7,pageIndex:0,sourceText:text}};
function exclusionWorld(){
	let f=libraryWorld({materials:{m1:material},project:{materials:[material]},notebook:{view:'read',selectedMaterial:'m1'}}),listeners=[],marks=new Map();
	// The shapes of A.onMaterialExclusionsChanged, A.materialAttachmentIDs and
	// A.materialExclusionSignature (manuscript.js); marks stand for native annotations.
	f.A.onMaterialExclusionsChanged=(fn,{attachmentIDs=[]}={})=>{let listener={fn,ids:attachmentIDs};listeners.push(listener);let off=()=>{listeners.splice(listeners.indexOf(listener),1);};off.update=ids=>{listener.ids=ids;};return off;};
	f.A.materialAttachmentIDs=rows=>[...new Set(rows.map(row=>row.anchor?.attachmentID||row.attachmentID).filter(Boolean))];
	f.A.materialExclusionSignature=rows=>JSON.stringify(f.A.materialAttachmentIDs(rows).map(id=>[id,marks.get(id)||[]]));
	let snapshot=attachmentIDs=>{for(let listener of [...listeners])if(attachmentIDs.some(id=>listener.ids.includes(id)))listener.fn(Object.freeze({reason:'material-exclusions',attachmentIDs}));};
	// The provenance line of a list row, as academic-assistant.js draws it.
	f.E.appendMaterialProvenance=host=>{let d=host.ownerDocument,line=d.createElement('small'),title=d.createElement('span');line.className='material-provenance';title.className='source-paper-title';line.append(title);host.append(line);return line;};
	return {f,marks,snapshot,listeners};
}

test('the first exclusion snapshot keeps the selected material\'s details and their open source drawer',async()=>{
	let {f,snapshot,listeners}=exclusionWorld(),page=await f.openPage();
	try{
		assert.equal(listeners.length,1);assert.deepEqual(listeners[0].ids,[7],'the page watches the selected material\'s PDF');
		let drawer=page.doc.querySelector('#detail details'),row=page.doc.querySelector('#source-list .source-row');
		assert.ok(drawer,'the details show the source');assert.match(drawer.textContent,/calibrated/);
		drawer.open=true;
		snapshot([7]);await f.quiet();
		assert.ok(drawer.isConnected,'loading annotations without marks does not rebuild the details');
		assert.equal(drawer.open,true,'the source drawer stays open');
		assert.notEqual(page.doc.querySelector('#source-list .source-row'),row,'the list is refreshed');
		assert.equal(page.$('count').textContent,'1 张');
		// A later page render keeps the details as well.
		await f.N.update(f.id,{recentMaterials:['m1']});await wait(40);await f.quiet();
		assert.ok(drawer.isConnected&&drawer.open,'the next render does not rebuild them either');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

test('a mark that changes what the details show rebuilds them once; the same marks again do not',async()=>{
	let {f,marks,snapshot}=exclusionWorld(),page=await f.openPage();
	try{
		let drawer=page.doc.querySelector('#detail details');
		marks.set(7,[{annotationKey:'MARK',quote:'fixed target board'}]);snapshot([7]);await f.quiet();
		assert.equal(drawer.isConnected,false,'a new mark rebuilds the details');
		let next=page.doc.querySelector('#detail details');assert.ok(next);next.open=true;
		snapshot([7]);await f.quiet();
		assert.ok(next.isConnected&&next.open,'a repeated notification with the same marks does not');
		marks.delete(7);snapshot([7]);await f.quiet();
		assert.equal(next.isConnected,false,'removing the mark rebuilds them again');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});
