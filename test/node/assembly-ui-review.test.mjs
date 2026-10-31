/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Assembly UI review fixes: margin comments, the assistant logo, the task strip,
// status notices and a few labels. Geometry is tested as pure functions; the
// DOM wiring is checked at the source where a fake window would add little.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {materialMarginGeometry,materialMarginToggleLabel} from '../../chrome/content/zotero/research/manuscript/material-margin.mjs';
import {assemblyOrbArea} from '../../chrome/content/zotero/research/manuscript/assembly-orb.mjs';
import {taskTabScroll,taskTabOverflow,TASK_TAB_FADE} from '../../chrome/content/zotero/research/manuscript/assembly-composer.mjs';

const research=new URL('../../chrome/content/zotero/research/',import.meta.url),read=path=>readFile(new URL(path,research),'utf8');

test('saved margin comments collapse to a badge when the rail would cover the paper',()=>{
	let roomy=materialMarginGeometry({innerWidth:1400,pageRight:1000});assert.equal(roomy.compact,false);assert.equal(roomy.left,1008);
	let wide=materialMarginGeometry({innerWidth:1100,pageRight:1000});assert.equal(wide.compact,true,'about 100px beside the paper cannot hold a 228px card');assert.ok(wide.left<1000);
	let narrow=materialMarginGeometry({innerWidth:520,pageRight:500});assert.equal(narrow.compact,true);assert.equal(narrow.railWidth,196);
	assert.equal(materialMarginToggleLabel(2,false),'批注 2');assert.equal(materialMarginToggleLabel(2,true),'收起批注');
});

test('a clicked highlight asks the compact margin to open its comment instead of scrolling the paper',async()=>{
	let [highlights,margin,css]=await Promise.all([read('shared/material-highlights.mjs'),read('manuscript/material-margin.mjs'),read('manuscript/material-overview.css')]);
	assert.match(highlights,/new win\.CustomEvent\('material-highlight-reveal',\{bubbles:true,cancelable:true/);assert.match(highlights,/if\(!revealed\)item\.scrollIntoView/);
	assert.match(margin,/card\.addEventListener\('material-highlight-reveal',reveal\)/);assert.match(margin,/card\.removeEventListener\('material-highlight-reveal',reveal\)/);
	assert.match(margin,/doc\.removeEventListener\('pointerdown',state\.outside,true\)/,'the outside-press listener is removed with the rail');
	assert.match(css,/\.material-margin-group\[data-compact=true\]:is\(:not\(\[data-expanded=true\]\),\[data-drafting=true\]\) \.material-local-comment\{display:none\}/);
});

test('the assistant logo rests above an open bottom conversation and hides when no row is left',()=>{
	let area={left:384,right:1600,top:60,bottom:1000};
	assert.deepEqual(assemblyOrbArea(area),{area,hidden:false},'a closed conversation keeps the whole article area');
	let open=assemblyOrbArea(area,{chatTop:700,toolsBottom:100});assert.equal(open.hidden,false);assert.equal(open.area.bottom,692);assert.equal(open.area.top,100);assert.equal(open.area.left,384);
	let full=assemblyOrbArea(area,{chatTop:130,toolsBottom:100});assert.equal(full.hidden,true);assert.strictEqual(full.area,area);
});

test('the active task tab clears both edge fades and fades appear only where tabs are hidden',async()=>{
	let view={left:0,right:600,width:600};
	assert.equal(taskTabScroll({view,rect:{left:500,right:700,width:200},scrollLeft:0}),124,'the tab and its close button clear the right fade');
	assert.equal(taskTabScroll({view,rect:{left:10,right:150,width:140},scrollLeft:80}),66,'once scrolled, a left fade exists and the tab moves past it');
	assert.equal(taskTabScroll({view,rect:{left:100,right:300,width:200},scrollLeft:40}),40,'a visible tab is left alone');
	assert.equal(taskTabScroll({view:{left:0,right:0,width:0},rect:{left:10,right:20,width:10},scrollLeft:5}),5,'a hidden strip waits until it is shown');
	assert.deepEqual(taskTabOverflow({scrollLeft:0,clientWidth:600,scrollWidth:900}),{start:false,end:true});
	assert.deepEqual(taskTabOverflow({scrollLeft:300,clientWidth:600,scrollWidth:900}),{start:true,end:false});
	assert.equal(TASK_TAB_FADE,24);
	let [composer,orb,css]=await Promise.all([read('manuscript/assembly-composer.mjs'),read('manuscript/assembly-orb.mjs'),read('manuscript/assembly-composer.css')]);
	assert.match(composer,/new win\.ResizeObserver\(entries=>\{if\(entries\.some/);assert.match(composer,/tabResize\.observe\(tab\)/);assert.match(composer,/tabResize\.unobserve\(tab\)/);assert.match(composer,/tabResize\.disconnect\(\)/);
	assert.doesNotMatch(css,/\.assembly-task-tabs\{[^}]*mask-image/,'the strip has no unconditional right fade');assert.match(css,/\.assembly-task-tab\[data-active=true\]\{flex-shrink:0/);
	assert.match(orb,/layer\.hidden=placed\.hidden/,'the layer hides, so conversation docking keeps control of button.hidden');
});

test('status notices reserve their height on the left rail and a user stop is a neutral notice',async()=>{
	let main=await read('manuscript/main.mjs'),start=main.indexOf('export function status('),end=main.indexOf('\nexport function button(');assert.ok(start>0&&end>start);
	let props={},notice={hidden:true,textContent:'',offsetHeight:30,title:'',classList:{toggle(){}}},timers=[];
	let context={document:{body:{style:{setProperty:(key,value)=>{props[key]=value;}}}},$:id=>id==='status'?notice:{hidden:false},U:{},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};
	vm.runInNewContext(main.slice(start,end).replace('export function status','function status'),context);
	context.status('已保存');assert.equal(props['--assembly-status-reserve'],'46px');timers.at(-1)();assert.equal(notice.hidden,true);assert.equal(props['--assembly-status-reserve'],'0px');
	context.status('失败',true);assert.equal(props['--assembly-status-reserve'],'46px','an error stays until dismissed');notice.onclick();assert.equal(props['--assembly-status-reserve'],'0px');
	let [conversation,composer]=await Promise.all([read('manuscript/assembly-conversation.mjs'),read('manuscript/assembly-composer.mjs')]);
	assert.match(conversation,/if\(signal\?\.aborted&&error&&typeof error==='object'\)error\.stopped=true;/);
	assert.match(main,/if\(err\?\.stopped\)status\(err\.message\|\|'已停止。'\);else status\(err\?\.message\|\|'暂时未能完成，请重试。',true\);/);
	assert.match(composer,/if\(U\.activeResearchSessionID===id\)\{status\('请先停止这条对话的任务。'\);return;\}/,'the running-task guard is a notice, not a red failure');
});

test('primary adoption, one read toggle, one clear label, an empty evidence note and a styled first render',async()=>{
	let [chapter,direction,library,context,refined,overview,overviewJS,marginJS]=await Promise.all(['manuscript/chapter-read-view.mjs','manuscript/direction-workspace.mjs','manuscript/material-library.mjs','manuscript/assembly-chat-context.mjs','manuscript/refined-surface.css','manuscript/material-overview.css','manuscript/material-overview.mjs','manuscript/material-margin.mjs'].map(read));
	assert.match(chapter,/button\('采用更新', \(\) => U\.chapterReads\.acceptUpdate\(chapter\.sectionID, node\.id\), actions, 'primary'\)/);
	assert.match(direction,/if\(!toggled\|\|reads\?\.running\|\|!hasReads\(\)\|\|Object\.values\(reads\?\.states\?\.\(\)\|\|\{\}\)\.some\(row=>READ_REFRESH_STATES\.includes\(row\.state\)\)\)readButton\(bar\);/);
	assert.match(library,/button\('清空',reset,filters\)\.setAttribute\('data-l10n-id','easysch-material-filter-reset'\)/,'both clear buttons share one Fluent message');
	assert.match(context,/if\(!evidenceHost\.childElementCount\)evidenceHost\.append\(el\('p',/);
	assert.match(refined,/^\/\*[^*]*\*\/\r?\n\/\*[\s\S]*?\*\/\r?\n@import url\("material-overview\.css"\);/,'the import is the first rule of a page-loaded sheet');
	for(let source of [overviewJS,marginJS])assert.match(source,/link\[data-material-overview\],link\[href\$="refined-surface\.css"\]/);
	assert.match(overview,/html\[data-appearance\] #details \.material-highlight-palette \.material-highlight-color\{[^}]*background-clip:padding-box/);
});
