/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Canvas pagination (editor.mjs). planPaperPages turns measured lengths into
// pages, and renderEditor writes the blocks first, reads the layout a constant
// number of times and then moves them. Both are compared with the former check,
// which read the layout after each appended block: a block moved to a new page
// when its bottom margin passed the page bottom by more than 1px and another
// visible block was on the page. The model follows the canvas CSS: border-box
// pages of 1050px with 42px/52px padding, a 37.8px chapter heading with a 22px
// margin, block borders (no margin collapses through a block), 8px block
// margins and spaceBefore in pt.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {installAssemblyWorkflow} from '../../chrome/content/zotero/research/manuscript/assembly-workflow.mjs';
import {fixture} from './assembly-details-harness.mjs';
import {Element} from './notebook-page-dom.mjs';

const editor=(await readFile(new URL('../../chrome/content/zotero/research/manuscript/editor.mjs',import.meta.url),'utf8')).replace(/\r/g,'');
// editor.mjs imports the whole page, so its pure part is taken from the source, as the harnesses do.
const {planPaperPages}=vm.runInThisContext('(()=>{'+editor.slice(editor.indexOf('function collapsedMargin('),editor.indexOf('\nfunction editable(')).replace(/^export /gm,'')+'\nreturn {planPaperPages};})()');
const PAGE=1050,TOP=42,BOTTOM=52,HEADING=37.8,HEADING_MARGIN=22,GAP=22;
const collapse=(a,b)=>Math.max(0,a,b)+Math.min(0,a,b);
// One page laid out: the boxes of its blocks from the page top (null when hidden) and its height.
function place(blocks,{quirk=0}={}){
	let bottom=TOP+HEADING+quirk,margin=HEADING_MARGIN;const boxes=[];
	for(const b of blocks){if(b.hidden){boxes.push(null);continue;}const top=bottom+collapse(margin,b.marginTop);bottom=top+b.height;margin=b.marginBottom;boxes.push({top,bottom});}
	return {boxes,height:Math.max(PAGE,bottom+margin+BOTTOM)};
}
// The former renderEditor on one chapter: append, measure, move on overflow.
// chapter.quirk lowers the blocks of continued pages, a rule the margin model does not know.
function former(chapter){
	const pages=[[]];let page=pages[0];
	chapter.blocks.forEach((b,index)=>{
		if(b.pageBreak){page=[];pages.push(page);}
		page.push(index);if(b.hidden)return;
		const blocks=page.map(k=>chapter.blocks[k]),bottom=place(blocks,{quirk:pages.length>1?chapter.quirk:0}).boxes.at(-1).bottom;
		if(bottom+b.marginBottom+BOTTOM>PAGE+1&&blocks.filter(row=>!row.hidden).length>1){page.pop();page=[index];pages.push(page);}
	});
	return pages;
}
// What measurePapers records for an arrangement of one chapter, with the zoom
// and page offsets of a real canvas so that the lengths carry its rounding.
const rowFor=chapter=>({chapter,limit:PAGE,paddingBottom:BOTTOM,headingMargin:HEADING_MARGIN,entries:chapter.blocks.map(b=>({hidden:!!b.hidden,pageBreak:!!b.pageBreak,bottoms:new Map()}))});
function measure(row,pages,{zoom=1,offset=0}={}){
	const {chapter,entries}=row;let at=offset;row.continuedBase=undefined;
	pages.forEach((page,number)=>{
		const {boxes,height}=place(page.map(k=>chapter.blocks[k]),{quirk:number?chapter.quirk:0}),top=at*zoom;let previous=null,anchor=-1;
		page.forEach((k,i)=>{const box=boxes[i],entry=entries[k];if(!box)return;const rect={top:top+box.top*zoom,bottom:top+box.bottom*zoom};
			if(!previous)anchor=k;else entry.gap=(rect.top-previous.bottom)/zoom;
			entry.height=(rect.bottom-rect.top)/zoom;entry.marginTop=chapter.blocks[k].marginTop;entry.marginBottom=chapter.blocks[k].marginBottom;entry.bottoms.set(anchor,(rect.bottom-top)/zoom);
			if(anchor===k&&number>0&&row.continuedBase===undefined)row.continuedBase=entry.bottoms.get(k)-entry.height-collapse(HEADING_MARGIN,entry.marginTop);
			previous=rect;
		});
		at+=height+GAP;
	});
	const lead=entries.findIndex(entry=>!entry.hidden);if(lead>=0){const entry=entries[lead];row.base=entry.bottoms.get(lead)-entry.height-collapse(HEADING_MARGIN,entry.marginTop);}
}
const plan=rows=>planPaperPages(rows).map(pages=>pages.map(page=>page.entries));
// renderEditor's loop on chapters: forced pages first, then at most three rounds
// of one read, a plan and the moves. reads counts the rounds that measured.
function paginate(chapters,options){
	const rows=chapters.map(rowFor);let pages=chapters.map(chapter=>{const split=[[]];chapter.blocks.forEach((b,k)=>{if(b.pageBreak)split.push([]);split.at(-1).push(k);});return split;}),reads=0;
	for(let round=0;round<3;round++){
		if(!rows.some(row=>row.entries.some(entry=>!entry.hidden)))break;
		for(const [k,row] of rows.entries())if(row.entries.some(entry=>!entry.hidden))measure(row,pages[k],options);reads++;
		const next=plan(rows);if(JSON.stringify(next)===JSON.stringify(pages))break;pages=next;
	}
	return {pages,reads,rows};
}
const block=(height,extra={})=>({height,marginTop:0,marginBottom:8,...extra});
const entry=(bottom,height,extra={})=>({hidden:false,pageBreak:false,height,marginTop:0,marginBottom:8,gap:8,bottoms:new Map(bottom===undefined?[]:[[0,bottom]]),...extra});
const row=(entries,extra={})=>({entries,limit:PAGE,paddingBottom:BOTTOM,headingMargin:HEADING_MARGIN,base:TOP+HEADING,...extra});

test('a page keeps blocks whose bottom margin ends at most 1px past the page bottom; the next block starts a page under the heading',()=>{
	// From fake measurements: five 250px blocks, the first measured at 351.8px.
	const five=()=>[entry(351.8,250),...[1,2,3,4].map(()=>entry(undefined,250))];
	assert.deepEqual(plan([row(five())]),[[[0,1,2],[3,4]]],'351.8+258+258=867.8 fits; 1125.8+8+52 passes 1051');
	// The overflow test itself: 991+8+52=1051 is within 1px of the 1050px page, 991.01 is not.
	const edge=five();edge[2]={...edge[2],gap:undefined,bottoms:new Map([[0,991]])};assert.deepEqual(plan([row(edge)])[0][0],[0,1,2]);
	edge[2].bottoms.set(0,991.01);assert.deepEqual(plan([row(edge)]),[[[0,1],[2,3,4]]]);
	// A measured length wins over the margin model: by the model block 3 ends at 975.8 and fits,
	// measured at 995 (as if a style added space) it overflows.
	const measured=[entry(351.8,250),entry(undefined,250),entry(undefined,250),entry(undefined,100),entry(undefined,770)];
	assert.deepEqual(plan([row(measured.slice(0,4))]),[[[0,1,2,3]]]);
	measured[3].bottoms.set(0,995);assert.deepEqual(plan([row(measured.slice(0,4))]),[[[0,1,2],[3]]]);
	// The block that starts a continued page sits under the heading as measured on a continued page:
	// at base 79.8 block 4 ends at 979.8 and fits, at 110 it ends at 1010 and moves on.
	assert.deepEqual(plan([row(measured)]),[[[0,1,2],[3,4]]]);
	assert.deepEqual(plan([row(measured,{continuedBase:110})]),[[[0,1,2],[3],[4]]]);
});

test('every chapter starts its own page; an empty chapter and a chapter of hidden blocks keep one page and are not measured',()=>{
	const short={blocks:[block(120),block(120)]},empty={blocks:[]},hidden={blocks:[block(5000,{hidden:true}),block(5000,{hidden:true})]};
	const result=paginate([short,empty,hidden,short]);
	assert.deepEqual(result.pages,[[[0,1]],[[]],[[0,1]],[[0,1]]],'the second chapter does not share the first page');
	assert.equal(result.reads,1,'nothing overflows, so the first read confirms the written pages');
	assert.deepEqual(paginate([empty,hidden]).reads,0,'chapters without visible blocks need no layout read');
});

test('a manual page break starts a page; a hidden block breaks only when it is an explicit page',()=>{
	// pageBreak is renderEditor's flag: pageBreakBefore and (visible or explicitPage).
	const mid={blocks:[block(300),block(300),block(300,{pageBreak:true}),block(300)]};
	const first={blocks:[block(300,{pageBreak:true}),block(300)]};
	const hidden={blocks:[block(300),block(0,{hidden:true}),block(300),block(0,{hidden:true,pageBreak:true}),block(300)]};
	const result=paginate([mid,first,hidden]);
	assert.deepEqual(result.pages,[[[0,1],[2,3]],[[],[0,1]],[[0,1,2],[3,4]]],'a break on the first block leaves the chapter page with its heading only');
	assert.deepEqual(result.pages,[mid,first,hidden].map(former));
});

test('a block taller than a page keeps a page of its own, and the next block starts a new one',()=>{
	const chapters=[{blocks:[block(2000),block(100)]},{blocks:[block(100),block(2000),block(100)]},{blocks:[block(100),block(1500,{pageBreak:true}),block(1500)]}];
	const result=paginate(chapters);
	assert.deepEqual(result.pages,[[[0],[1]],[[0],[1],[2]],[[0],[1],[2]]]);
	assert.deepEqual(result.pages,chapters.map(former));
});

// mulberry32: deterministic chapters with fractional heights.
const random=seed=>()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
function randomChapter(next,size){
	return {blocks:Array.from({length:size},()=>{const hidden=next()<0.08;return block(next()<0.04?1100+next()*600:20+next()*420,{marginTop:next()<0.25?[8,16,32][Math.floor(next()*3)]:0,marginBottom:next()<0.2?12:8,hidden,pageBreak:next()<0.06});})};
}

test('random chapters paginate as the former block-by-block check, at any zoom, in at most two layout reads',()=>{
	const next=random(20261031);let multi=0;
	for(let run=0;run<400;run++){
		const chapters=Array.from({length:1+Math.floor(next()*4)},()=>randomChapter(next,Math.floor(next()*40))),options={zoom:[1,0.75,1.1,1.35][run%4],offset:14+next()*900};
		const result=paginate(chapters,options);
		assert.deepEqual(result.pages,chapters.map(former),'run '+run);
		assert.ok(result.reads<=2,'run '+run+' read the layout '+result.reads+' times');
		multi+=result.pages.filter(pages=>pages.length>1).length;
	}
	assert.ok(multi>300,'most chapters span several pages');
});

test('when continued pages lay out lower than the margin model says, the next reads correct the pages, still in at most three reads',()=>{
	const next=random(7);let corrected=0;
	for(let run=0;run<300;run++){
		const chapters=Array.from({length:1+Math.floor(next()*3)},()=>({...randomChapter(next,10+Math.floor(next()*40)),quirk:3+next()*12}));
		const result=paginate(chapters,{zoom:[1,1.25][run%2],offset:next()*600});
		assert.deepEqual(result.pages,chapters.map(former),'run '+run);
		assert.ok(result.reads<=3,'run '+run+' read the layout '+result.reads+' times');
		if(result.reads===3)corrected++;
	}
	assert.ok(corrected>10,'the third read corrected the pages in '+corrected+' runs');
});

// The real renderEditor on the assembly harness DOM, with a layout engine for
// the same model: pages stack 22px apart, each laid out as place() lays it out.
// A layout read after a DOM change counts as a flush.
const engine={heights:new Map(),offset:14,quirk:0,dirty:true,reads:0,flushes:0};
const read=()=>{engine.reads++;if(engine.dirty){engine.flushes++;engine.dirty=false;}};
const NodeProto=Object.getPrototypeOf(Element.prototype);
for(const [proto,names] of [[NodeProto,['_insert','removeChild']],[Element.prototype,['setAttribute','removeAttribute']]])for(const name of names){const original=proto[name];proto[name]=function(...args){engine.dirty=true;return original.apply(this,args);};}
const ptToPx=value=>(parseFloat(value)||0)*4/3;
const modelBlock=node=>({hidden:node.hidden,height:engine.heights.get(node.dataset.id),marginTop:ptToPx(node.style.marginTop),marginBottom:8});
const blocksOf=page=>page.children.filter(child=>child.classList.contains('block'));
const layoutOf=page=>place(blocksOf(page).map(modelBlock),{quirk:page.dataset.continued==='true'?engine.quirk:0});
Element.prototype.getBoundingClientRect=function(){
	const zero={left:0,top:0,right:0,bottom:0,width:0,height:0,x:0,y:0},canvas=this.ownerDocument.getElementById('canvas');
	if(!canvas?.contains(this)||canvas.hidden)return zero;read();
	const page=this.closest('.paper');if(!page)return zero;
	const zoom=Number(page.style.zoom)||1;let at=engine.offset;
	for(const other of canvas.children.filter(child=>child.classList.contains('paper'))){if(other===page)break;at+=(layoutOf(other).height+GAP)*zoom;}
	const {boxes,height}=layoutOf(page);let box={top:0,bottom:height};
	if(this!==page){const index=blocksOf(page).indexOf(this);box=boxes[index];if(!box)return zero;}
	return {...zero,top:at+box.top*zoom,bottom:at+box.bottom*zoom,height:(box.bottom-box.top)*zoom};
};
function styleOf(node){
	read();
	if(node.classList.contains('paper'))return {paddingTop:TOP+'px',paddingBottom:BOTTOM+'px',minHeight:PAGE+'px',boxSizing:'border-box',getPropertyValue:name=>name==='--canvas-page-height'?PAGE+'px':''};
	if(node.localName==='h2')return {marginBottom:HEADING_MARGIN+'px',getPropertyValue:()=>''};
	return {marginTop:ptToPx(node.style.marginTop)+'px',marginBottom:'8px',getPropertyValue:()=>''};
}
async function canvasFixture(project,{zoom=1,quirk=0}={}){
	const f=await fixture();Object.assign(f.U.p,{sections:project.sections,blocks:project.blocks});f.U.p.ui.paperZoom=zoom;
	f.sandbox.getComputedStyle=styleOf;f.sandbox.applyCanvasBlockDisplay=(node,b)=>{node.hidden=project.hidden.has(b.id);};
	engine.heights=project.heights;engine.quirk=quirk;
	const render=()=>{engine.dirty=true;engine.reads=0;engine.flushes=0;f.render();};
	return {...f,render,canvas:f.doc.getElementById('canvas')};
}
// The pages the former check makes for the project.
function formerPages(project,{quirk=0}={}){
	const out=[];let number=0;
	for(const section of project.sections){
		const blocks=project.blocks.filter(b=>b.sectionID===section.id),chapter={quirk,blocks:blocks.map(b=>{const hidden=project.hidden.has(b.id);return {hidden,pageBreak:!!b.pageBreakBefore&&(!hidden||!!b.explicitPage),height:project.heights.get(b.id),marginTop:(b.spaceBefore||0)*4/3,marginBottom:8};})};
		for(const [index,page] of former(chapter).entries())out.push({page:String(++number),section:section.id,title:section.title,continued:String(index>0),blocks:page.map(k=>blocks[k].id)});
	}
	return out;
}
const canvasPages=canvas=>canvas.children.filter(child=>child.classList.contains('paper')).map(page=>({page:page.dataset.page,section:page.dataset.section,title:page.firstElementChild.textContent,continued:page.dataset.continued,blocks:blocksOf(page).map(node=>node.dataset.id)}));
// Chapter pages and manual pages, written before the layout is read.
const forcedPages=project=>project.sections.length+project.blocks.filter(b=>b.pageBreakBefore&&(!project.hidden.has(b.id)||b.explicitPage)).length;
// One flush for the written pages; a second one checks the pages after blocks moved.
const expectedFlushes=(canvas,project)=>canvasPages(canvas).length>forcedPages(project)?2:1;
function randomProject(next,count,{breaks=0.05}={}){
	const sections=['引言','方法','结果','讨论'].map((title,index)=>({id:'s'+index,title,conclusion:''})),blocks=[],hidden=new Set(),heights=new Map();
	for(let index=0;index<count;index++){
		const b=M.block('paragraph',sections[[0,1,1,3,3,3][Math.floor(next()*6)]].id,{text:'正文 '+index,spaceBefore:next()<0.2?[6,12,24][Math.floor(next()*3)]:0,pageBreakBefore:next()<breaks});
		if(next()<0.06){hidden.add(b.id);if(next()<0.5)b.explicitPage=true;}
		heights.set(b.id,next()<0.03?1200+next()*500:30+next()*400);blocks.push(b);
	}
	return {sections,blocks,hidden,heights};
}

test('renderEditor splits the canvas as the former check did, numbers the pages and flushes the layout at most twice',async()=>{
	const next=random(31);
	for(let run=0;run<12;run++){
		const project=randomProject(next,20+Math.floor(next()*70)),zoom=[1,1.25,0.8][run%3];engine.offset=14+next()*500;
		const f=await canvasFixture(project,{zoom});f.render();
		assert.deepEqual(canvasPages(f.canvas),formerPages(project),'run '+run);
		assert.equal(engine.flushes,expectedFlushes(f.canvas,project),'run '+run+' flushed the layout '+engine.flushes+' times');
		assert.ok(f.canvas.children.filter(child=>child.classList.contains('paper')).every(page=>Number(page.style.zoom)===zoom),'pages made by the split keep the zoom');
	}
});

test('the number of layout flushes does not grow with the number of blocks',async()=>{
	for(const count of [30,300]){
		const project=randomProject(random(count),count),f=await canvasFixture(project);engine.offset=14;f.render();
		assert.deepEqual(canvasPages(f.canvas),formerPages(project),count+' blocks');
		assert.equal(engine.flushes,2,count+' blocks flushed the layout '+engine.flushes+' times');
		assert.ok(engine.reads>count,'every visible block is read in each round');
	}
});

test('a hidden canvas is not measured: it keeps chapter and manual pages until it is shown, then splits once and applies the scroll position',async()=>{
	const project=randomProject(random(99),60),f=await canvasFixture(project);engine.offset=14;
	f.canvas.hidden=true;f.U.p.ui.scrollTop=420;f.render();
	assert.equal(engine.reads,0,'no layout read while the canvas is hidden');
	assert.equal(canvasPages(f.canvas).length,forcedPages(project),'one page per chapter and per manual page break');
	assert.notDeepEqual(canvasPages(f.canvas),formerPages(project),'long pages wait for the split');
	f.canvas.hidden=false;f.canvas.scrollTop=0;engine.dirty=true;engine.reads=0;engine.flushes=0;
	assert.equal(f.U.paginateCanvas(),true);
	assert.deepEqual(canvasPages(f.canvas),formerPages(project));
	assert.equal(engine.flushes,2);assert.equal(f.canvas.scrollTop,420,'the saved scroll position is applied after the split');
	assert.equal(f.U.paginateCanvas(),false,'nothing is left to split');
});

test('a render on the shown canvas replaces a split left by a hidden render',async()=>{
	const project=randomProject(random(5),40),f=await canvasFixture(project);engine.offset=14;
	f.canvas.hidden=true;f.render();f.canvas.hidden=false;f.render();
	assert.deepEqual(canvasPages(f.canvas),formerPages(project));
	assert.equal(f.U.paginateCanvas(),false,'the shown render already split the pages');
});

test('after an edit the next render splits the pages again from the changed blocks',async()=>{
	const project=randomProject(random(77),50),f=await canvasFixture(project);engine.offset=14;f.render();
	const target=project.blocks[10];project.heights.set(target.id,project.heights.get(target.id)+260);
	const added=M.block('paragraph',target.sectionID,{text:'新段落'});project.heights.set(added.id,180);project.blocks.splice(11,0,added);
	f.render();
	assert.deepEqual(canvasPages(f.canvas),formerPages(project));assert.equal(engine.flushes,expectedFlushes(f.canvas,project));
});

test('when continued pages lay out lower than the margin model says, the canvas still ends as the former check made it',async()=>{
	// Without manual pages the first read sees no continued page, so moved pages are only measured by the second read.
	const next=random(2026);let corrected=0;
	try{
		for(let run=0;run<10;run++){
			const project=randomProject(next,90+Math.floor(next()*60),{breaks:0}),quirk=10+next()*15,f=await canvasFixture(project,{quirk});engine.offset=14;f.render();
			assert.deepEqual(canvasPages(f.canvas),formerPages(project,{quirk}),'run '+run);
			assert.ok(engine.flushes<=3,'run '+run+' flushed the layout '+engine.flushes+' times');
			if(engine.flushes===3)corrected++;
		}
	}finally{engine.quirk=0;}
	assert.ok(corrected>0,'the check read moved pages and corrected them');
});

// Stage changes on stub elements: the canvas state at each editor render and split request.
class StubNode{
	constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes=new Map();this.hidden=false;this.textContent='';const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};}
	append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
	replaceChildren(...nodes){this.children=[];this.append(...nodes);}
	before(){}after(){}
	get firstChild(){return this.children[0]||null;}
	setAttribute(name,value){this.attributes.set(name,String(value));}
	focus(){}
}
function stageFixture(){
	const p=M.createProject('分页阶段'),doc={body:{dataset:{}},querySelector:()=>null,defaultView:{AbortController,matchMedia:()=>({matches:true})}},elements=new Map(),seen=[];
	const el=(tag,text,cls)=>{const node=new StubNode(tag,doc);node.className=cls||'';if(text!==undefined)node.textContent=text;return node;};
	for(const id of ['steps','workflow-panel','details','cancel-task','canvas','material-search','workspace','recommendation','right'])elements.set(id,el('div'));
	const button=(text,action,host,cls)=>{const node=el('button',text,cls);node.onclick=action;host?.append(node);return node;};
	p.blocks=[M.block('paragraph',p.sections[0].id,{text:'人工正文'})];
	const canvas=elements.get('canvas'),U={p,$:id=>elements.get(id),E:{},A:{assessment:()=>null,check:async()=>[]},renderEditor:()=>seen.push(['render',canvas.hidden]),paginateCanvas:()=>seen.push(['split',canvas.hidden])};
	const workflow=installAssemblyWorkflow(U,{el,button,persist:async()=>{},applyPanels:()=>{},renderNavigation:()=>workflow.render(),selectBlock:()=>{},verifyBlock:()=>{},status:()=>{},exportDocuments:()=>{}});
	return {U,p,workflow,canvas,seen};
}

test('setStep sets the canvas display before the editor renders, so 方向讨论 is not split and 速读细调 is',async()=>{
	const f=stageFixture();
	await f.workflow.setStep(1,{focus:false});
	assert.deepEqual(f.seen,[['render',true]],'方向讨论 renders the hidden canvas without a split');
	f.seen.length=0;await f.workflow.setStep(2,{focus:false});
	assert.deepEqual(f.seen,[['render',false],['split',false]],'速读细调 renders the shown canvas; the split request that follows finds nothing left');
	f.seen.length=0;await f.workflow.setStep(0,{focus:false});
	assert.deepEqual(f.seen,[['render',false]]);assert.equal(f.canvas.hidden,false);
});

test('the direction workspace asks the editor to split a canvas it shows outside setStep, once',async()=>{
	const f=stageFixture();await f.workflow.setStep(1,{focus:false});f.seen.length=0;
	f.p.ui.step=2;f.U.directionWorkspace.render();
	assert.equal(f.canvas.hidden,false);assert.deepEqual(f.seen,[],'the request runs after the current call');
	await null;assert.deepEqual(f.seen,[['split',false]]);
	f.U.directionWorkspace.render();await null;assert.deepEqual(f.seen,[['split',false]],'a canvas that stays shown is not split again');
});
