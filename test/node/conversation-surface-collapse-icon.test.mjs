/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The conversation header's session menu and its collapse control sat side by
// side with the same chevron (materials:ambiguous-duplicate-icons). Collapsing
// the whole conversation now has its own glyph; the chevron stays on the menus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source=fs.readFileSync(new URL('../../chrome/content/zotero/research/shared/conversation-surface.mjs',import.meta.url),'utf8');
let lines=source.split(/\r?\n/),line=prefix=>{let hits=lines.filter(value=>value.startsWith(prefix));assert.equal(hits.length,1,'one line starts with '+prefix);return hits[0];};
let iconsStart=lines.indexOf('const ICONS={'),iconsEnd=lines.indexOf('};',iconsStart);
assert.ok(iconsStart>=0&&iconsEnd>iconsStart,'ICONS is still a block');
// The icon table, the icon/button helpers and the two header controls, in source order.
let script=[line("const HTML='http://www.w3.org/1999/xhtml'"),...lines.slice(iconsStart,iconsEnd+1),line('function icon(doc,name)'),line('function button(doc,text,title,kind)'),
	line(" const choices=button(doc,'研究对话'"),line(" const collapse=button(doc,'','收起研究对话'"),
	'__surface.ICONS=ICONS;__surface.choices=choices;__surface.collapse=collapse;'].join('\n');

function header(){
	let make=(_ns,tag)=>({tag,children:[],attributes:{},dataset:{},className:'',type:'',title:'',textContent:'',setAttribute(name,value){this.attributes[name]=String(value);},append(...nodes){this.children.push(...nodes);}});
	let row=make('','div'),exposed={};
	vm.runInNewContext(script,{doc:{createElementNS:make},header:row,__surface:exposed});
	return {...exposed,row};
}
let svgs=button=>button.children.filter(node=>node.tag==='svg');
let paths=svg=>svg.children.filter(node=>node.tag==='path').map(node=>node.attributes.d);

test('the collapse control uses its own glyph, not the session menu chevron beside it',()=>{
	let {ICONS,choices,collapse,row}=header();
	assert.equal(row.children[0],choices);assert.equal(row.children[1],collapse,'the two controls are neighbours');
	let menuChevron=svgs(choices).at(-1),glyphs=svgs(collapse);
	assert.deepEqual(paths(menuChevron),[...ICONS.chevron],'the session menu keeps its dropdown chevron');
	assert.equal(glyphs.length,1);
	assert.ok(ICONS.collapse,'collapse is a named icon, not the fallback');
	assert.deepEqual(paths(glyphs[0]),[...ICONS.collapse]);
	assert.notDeepEqual(paths(glyphs[0]),paths(menuChevron));
	assert.equal(collapse.attributes['aria-label'],'收起研究对话');
	assert.equal(collapse.dataset.cluiCollapse,'true');
});
