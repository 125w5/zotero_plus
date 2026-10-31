/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A material renamed in the details pane shows the title the user typed, also
// in Latin letters, for cards without a chapter type as for chapter cards
// (A.titleFor in manuscript-index.js). userEdited also follows an edit of the
// 说明 alone (editAsset); such a card keeps the generated 中文名 of its
// untouched Latin title. Full-text hits keep their passage label.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as sections from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as language from '../../chrome/content/zotero/research/shared/material-language.mjs';
import {fixture,asset,key} from './assembly-details-harness.mjs';

const code=await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8');
// The key manuscript-index.js files a generated 说明 and 中文名 under.
const descriptionKey=m=>JSON.stringify([m.id,m.revision,m.summary||m.sourceText,'zh-summary-v2']);
function load(descriptions={}){
	let E={manuscripts:{model:{}},assets:{key:values=>JSON.stringify(values)},store:{get:(branch,name)=>(branch==='materialDescriptions'?(name===undefined?descriptions:descriptions[name]):undefined),update:async()=>{}}};
	let Zotero={Research:E,logError(){},getMainWindow:()=>({AbortController}),addShutdownListener(){},Items:{get:id=>id===101&&{deleted:false,getField:name=>({firstCreator:'Smith',date:'2021'})[name]??''}}};
	vm.runInNewContext(code,{Zotero,ChromeUtils:{importESModule:uri=>(uri.includes('article-section-materials')?sections:language)}});
	return E.manuscripts;
}

test('a card without a chapter type shows the title the user typed, also in Latin letters',()=>{
	// editAsset (manuscript-writing.js) keeps the title before each edit in history.
	let renamed={id:'asset-1',assetID:'asset-1',kind:'paragraph',revision:3,title:'Camera rig',userEdited:true,summary:'说明标定装置。',sourceText:'x',paperItemID:101,history:[{title:'Figure 2. Calibration setup',summary:'说明标定装置。',revision:2}]};
	let A=load({[descriptionKey(renamed)]:{titleZh:'标定装置示意图',summaryZh:'说明标定装置。'}});
	assert.equal(A.titleFor(renamed),'Camera rig','the typed title wins over a generated 中文名');
	// A card kept only in this project records no history; its edit shows its title as written.
	assert.equal(A.titleFor({id:'material-1',kind:'note',revision:2,title:'Lab notes 2024',userEdited:true,sourceText:'x'}),'Lab notes 2024');
});

test('an edit of the 说明 alone keeps the generated 中文名 of an untouched Latin title',()=>{
	let edited={id:'asset-2',assetID:'asset-2',kind:'abstract',revision:3,title:'Learning robust representations for modulation recognition',userEdited:true,summary:'我改写的说明。',sourceText:'x',paperItemID:101,history:[{title:'Learning robust representations for modulation recognition',summary:'原说明。',revision:2}]};
	let A=load({[descriptionKey(edited)]:{titleZh:'调制识别的稳健表示',summaryZh:'我改写的说明。'}});
	assert.equal(A.titleFor(edited),'调制识别的稳健表示');
	assert.equal(A.titleFor({...edited,id:'asset-3'}),'文献素材 · Smith 2021','without a generated name the generic label stays');
});

test('chapter cards and full-text hits keep their labels',()=>{
	let A=load();
	assert.equal(A.titleFor({id:'s-1',kind:'semantic',revision:2,sectionType:'方法',section:'Methods',title:'Camera rig',userEdited:true,paperItemID:101,sourceText:'x'}),'Camera rig','a renamed chapter card');
	assert.equal(A.titleFor({id:'s-2',kind:'semantic',revision:2,sectionType:'方法',section:'Methods',title:'Methods',userEdited:true,paperItemID:101,sourceText:'x'}),'方法 · Methods · Smith 2021','a chapter card whose 说明 alone was edited');
	// A full-text hit and its highlighted copy offer no rename (main.mjs).
	assert.equal(A.titleFor({id:'passage-9-0',revision:1,title:'2.1 Methods',userEdited:true,paperItemID:101,sourceText:'x'}),'论文原文素材 · Smith 2021');
	assert.equal(A.titleFor({id:'m-1',revision:1,title:'English only',paperItemID:101,sourceText:'x'}),'文献素材 · Smith 2021','an unedited Latin title keeps the generic label');
});

// The same through the details pane: the real title editor, editAsset and the
// explanation save (assembly-details-harness.mjs).
const card=asset('lib1',9,{title:'Figure 2. Calibration setup',summary:'说明标定装置与靶板的布置。'});
const named=(...rows)=>({materialDescriptions:Object.fromEntries(rows.map(row=>[descriptionKey(row),{titleZh:'标定装置示意图',summaryZh:row.summary}]))});

test('renaming a library card to a Latin title shows the typed title in its details and list',async()=>{
	let f=await fixture({assets:[asset('m1',7),card],project:['m1'],store:named(card)});
	assert.equal(f.show('lib1').textContent,'标定装置示意图','before the rename the generated name is shown');
	let {input}=f.open('lib1');input.value='Camera rig';input.onkeydown(key('Enter'));await f.flush();
	assert.equal(f.stored('lib1').title,'Camera rig');
	assert.equal(f.box.querySelector('h3').textContent,'Camera rig','the details show the typed title');
	assert.equal(f.A.titleFor(f.stored('lib1')),'Camera rig','the material list uses the same label');
	assert.deepEqual(f.failures,[]);
});

test('saving only the 说明 of a library card keeps the generated name of its Latin title',async()=>{
	let edited={...card,revision:3,summary:'我改写的说明。'},f=await fixture({assets:[asset('m1',7),card],project:['m1'],store:named(card,edited)});
	assert.equal(f.show('lib1').textContent,'标定装置示意图');
	let saved=f.explanations.at(-1).options.onSave({summary:edited.summary});await f.flush();await saved;
	assert.equal(f.stored('lib1').userEdited,true);assert.equal(f.stored('lib1').title,card.title,'the title is unchanged');
	assert.equal(f.box.querySelector('h3').textContent,'标定装置示意图','the heading keeps the generated name');
	assert.deepEqual(f.failures,[]);
});
