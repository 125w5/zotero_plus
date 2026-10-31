/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Assembly header and footer with a side pane closed: the stepper stays between the title and the
// export actions, the footer keeps its controls, and the left tabs follow ui.left on a library-only render.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assemblyStepsCenter,placeAssemblySteps} from '../../chrome/content/zotero/research/manuscript/assembly-workflow.mjs';
import {syncAssemblyLeftTabs} from '../../chrome/content/zotero/research/manuscript/assembly-navigation.mjs';

const research=new URL('../../chrome/content/zotero/research/',import.meta.url),read=path=>readFile(new URL(path,research),'utf8');
const rect=(left,width)=>({left,right:left+width,width,top:0,bottom:30,height:30});

function fakeHeader(){
	let attrs=new Set(),props={};
	let steps={children:[0,120,240,360].map(left=>({getBoundingClientRect:()=>rect(left,110)})),getBoundingClientRect:()=>rect(0,1237)};
	let title={getBoundingClientRect:()=>rect(14,304)},hidden={getBoundingClientRect:()=>rect(0,0)},actions={getBoundingClientRect:()=>rect(908,343)};
	let header={children:[title,steps,hidden,actions],getBoundingClientRect:()=>rect(0,1265),toggleAttribute(name,on){if(on)attrs.add(name);else attrs.delete(name);},style:{getPropertyValue:name=>props[name]||'',setProperty(name,value){props[name]=value;}}};
	steps.parentElement=header;
	let styles=new Map([[header,{columnGap:'8px',paddingLeft:'14px',paddingRight:'14px'}],[steps,{paddingLeft:'4px',paddingRight:'4px',borderLeftWidth:'0px',borderRightWidth:'0px'}]]);
	return {doc:{getElementById:id=>id==='steps'?steps:null,defaultView:{getComputedStyle:node=>styles.get(node)}},attrs,props,title};
}

test('the stepper keeps the canvas centre when it fits and is clamped between the title and the export actions otherwise',()=>{
	assert.deepEqual(assemblyStepsCenter({center:632.5,before:318,after:908,width:478}),{wrap:false,center:632.5},'both panes open at 1265px: no clamp');
	let right=assemblyStepsCenter({center:812.5,before:318,after:908,width:478});assert.equal(right.wrap,false);assert.ok(right.center+239<=900,'right pane closed: the format picker at 908 stays visible');
	let left=assemblyStepsCenter({center:452,before:318,after:908,width:478});assert.ok(left.center-239>=326,'left pane closed: the title end stays visible');
	assert.equal(assemblyStepsCenter({center:500,before:400,after:700,width:478}).wrap,true,'no room between the groups: own row');
});

test('placing the stepper measures the step buttons and header groups, skips hidden boxes and wraps only without room',()=>{
	let {doc,attrs,props,title}=fakeHeader();
	placeAssemblySteps(doc,812.5);assert.equal(props['--assembly-steps-center'],'661px');assert.equal(attrs.has('data-steps-wrap'),false);
	placeAssemblySteps(doc,632.5);assert.equal(props['--assembly-steps-center'],'632.5px');
	title.getBoundingClientRect=()=>rect(14,600);placeAssemblySteps(doc);assert.equal(attrs.has('data-steps-wrap'),true,'a re-measure without a new centre reuses the last one');
	title.getBoundingClientRect=()=>rect(14,304);placeAssemblySteps(doc);assert.equal(attrs.has('data-steps-wrap'),false,'the wrapped full-width nav does not keep it wrapped');
});

test('header size changes re-place the stepper once, in the next frame',()=>{
	let {doc,props,title}=fakeHeader(),observed=[],frames=[],notify;
	doc.defaultView.ResizeObserver=class{constructor(callback){notify=callback;}observe(node){observed.push(node);}};doc.defaultView.requestAnimationFrame=fn=>frames.push(fn);
	placeAssemblySteps(doc,632.5);assert.equal(observed.length,4,'every header group is observed');
	title.getBoundingClientRect=()=>rect(14,380);notify();notify();assert.equal(frames.length,1,'notifications in one frame are coalesced');assert.equal(props['--assembly-steps-center'],'632.5px','nothing is measured inside the observer callback');
	frames[0]();assert.equal(props['--assembly-steps-center'],'641px','a longer title pushes the stepper right');
});

test('a library-only render moves the left tab selection to the shown view',async()=>{
	let tab=view=>{let classes=new Set(view==='materials'?['active']:[]),attrs={'aria-selected':String(view==='materials')};return {dataset:{view},classList:{toggle:(name,on)=>{if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},getAttribute:name=>attrs[name],setAttribute:(name,value)=>{attrs[name]=value;}};};
	let tabs={children:[tab('materials'),tab('structure'),tab('evidence')]};
	syncAssemblyLeftTabs(tabs,'structure');
	assert.deepEqual(tabs.children.map(t=>[t.classList.contains('active'),t.getAttribute('aria-selected')]),[[false,'false'],[true,'true'],[false,'false']]);
	let main=await read('manuscript/main.mjs');assert.match(main,/export function renderLibrary\(\)\{\r?\n if\(U\.p\.ui\.left==='files'\)U\.p\.ui\.left='materials';\r?\n syncAssemblyLeftTabs\(\$\('left-tabs'\),U\.p\.ui\.left\);/);
});

test('the header and footer keep every control when a side pane is closed',async()=>{
	let [main,workspace,refined,workflow]=await Promise.all([read('manuscript/main.mjs'),read('manuscript/workspace-surface.css'),read('manuscript/refined-surface.css'),read('manuscript/assembly-workflow.css')]);
	assert.match(main,/placeAssemblySteps\(document,\(main\.left\+main\.right\)\/2\)/);assert.match(main,/box\.id='assessment-inline';\$\('steps'\)\.after\(box\);placeAssemblySteps\(document\);/);
	assert.match(workspace,/left:var\(--assembly-steps-center,var\(--assembly-canvas-center,50%\)\)/);assert.match(workspace,/header\[data-steps-wrap\] > #steps \{position:static;/);
	assert.doesNotMatch(refined,/data-chat-right-visible=false\] #footer-actions/,'save state, zoom and appearance stay in the footer');
	assert.match(refined,/body\[data-chat-right-visible=false\]>footer,[^{]*\{grid-template-columns:var\(--assembly-console-sessions\) minmax\(0,1fr\) max-content;\}/);
	assert.match(workflow,/#workflow-panel:focus\{outline:none\}/);
});
