/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A canvas render attaches the margin of every material card (~300 on a large
// project). Attaching must not add DOM or document-wide lookups per card: the
// count badge is made only for a card that shows one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Document,FakeEvent,parseHTML,createWindow} from './notebook-page-dom.mjs';
import {installMaterialMargin} from '../../chrome/content/zotero/research/manuscript/material-margin.mjs';

function page(){
	let doc=new Document(),frames=[];
	parseHTML(doc,'<html><head><link rel="stylesheet" href="manuscript.css"></head><body><link rel="stylesheet" href="manuscript/refined-surface.css"><main><div id="canvas"></div></main></body></html>');
	createWindow(doc,{ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},requestAnimationFrame:fn=>frames.push(fn),cancelAnimationFrame:()=>{}});
	let counts={queries:0,buttons:0},query=doc.querySelector.bind(doc),create=doc.createElement.bind(doc);
	doc.querySelector=selector=>{if(String(selector).includes('link['))counts.queries++;return query(selector);};
	doc.createElement=tag=>{if(String(tag).toLowerCase()==='button')counts.buttons++;return create(tag);};
	return {doc,frames,counts,run:()=>{while(frames.length)frames.shift()();}};
}
function card(doc,id){let node=doc.createElement('div');node.className='material-card-source';node.dataset.materialId=id;return node;}

test('attaching 300 material cards adds no badge and one stylesheet lookup',()=>{
	let {doc,counts,run}=page(),paper=doc.createElement('div');paper.className='paper';
	let margins=[];for(let i=0;i<300;i++){let node=card(doc,'m'+i);margins.push(installMaterialMargin(node));paper.append(node);}
	doc.getElementById('canvas').append(paper);run();
	assert.equal(counts.buttons,0,'no count badge for cards without saved comments');
	assert.equal(counts.queries,1,'the stylesheet is looked up once, not once per card');
	assert.equal(doc.querySelectorAll('.material-margin-group').length,300);
	assert.equal(doc.querySelectorAll('.material-margin-toggle').length,0);
	assert.equal(doc.head.querySelectorAll('link[data-material-overview]').length,0,'refined-surface.css already imports the sheet');
	for(let margin of margins)margin.dispose();
	assert.equal(doc.querySelectorAll('.assembly-material-margin').length,0);
});

test('a compact card with a saved comment still gets its badge, opens from its highlight and collapses',()=>{
	let {doc,counts,run}=page(),paper=doc.createElement('div');paper.className='paper';
	let node=card(doc,'m1'),margin=installMaterialMargin(node),comment=doc.createElement('article');comment.className='material-local-comment';
	let list=doc.createElement('div');list.className='material-local-comments';list.append(comment);margin.host.append(list);
	paper.append(node);doc.getElementById('canvas').append(paper);run();
	let toggle=margin.host.querySelector('.material-margin-toggle');
	assert.ok(toggle,'a narrow canvas collapses the saved comment to a badge');assert.equal(counts.buttons,1);
	assert.equal(margin.host.firstElementChild,toggle,'the badge stays above the comments');
	assert.equal(toggle.hidden,false);assert.equal(toggle.textContent,'批注 1');assert.equal(toggle.getAttribute('aria-expanded'),'false');
	let mark=doc.createElement('mark');node.append(mark);
	let reveal=new FakeEvent('material-highlight-reveal',{bubbles:true,cancelable:true});
	assert.equal(mark.dispatchEvent(reveal),false,'the margin takes over the highlight click');
	assert.equal(margin.host.dataset.expanded,'true');assert.equal(toggle.textContent,'收起批注');assert.equal(toggle.getAttribute('aria-expanded'),'true');
	toggle.onclick(new FakeEvent('click'));
	assert.equal(margin.host.dataset.expanded,'false');assert.equal(toggle.textContent,'批注 1');
	toggle.onclick(new FakeEvent('click'));assert.equal(margin.host.dataset.expanded,'true');
	doc.body.dispatchEvent(new FakeEvent('pointerdown',{bubbles:true}));
	assert.equal(margin.host.dataset.expanded,'false','a press outside the material closes it again');
	run();assert.equal(counts.buttons,1,'later layouts reuse the badge');
	margin.dispose();
});
