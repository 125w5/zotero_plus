/* SPDX-License-Identifier: AGPL-3.0-or-later */
// DC-08: renaming a material in assembly keeps the typed title when the save
// fails, is not rebuilt by a background refresh while open, and asks before
// overwriting a title changed elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {referencedAssetsChanged,rememberAssetViewDefaults} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';
import {mergeMaterialAsset} from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import {descriptionOnlyChange,refreshMaterialDescriptions} from '../../chrome/content/zotero/research/shared/material-description-refresh.mjs';

const source=(await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8')).replace(/\r/g,'');
const slice=(from,to)=>{let start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end);};
const code=slice('function assetDetailSignature(','\nexport function insertMaterial(')+'\n'+slice('export function materialDetails(','export async function openMaterial(').replace(/^export /,'')+';this.showMaterial=materialDetails;this.refresh=refreshAssetViews;';

class Node{
	constructor(tag,text,cls){this.tag=tag;this.children=[];this.dataset={};this.attributes=new Map();this.className=cls||'';this.parent=null;this._text=text===undefined?'':String(text);this.value='';this.classList={toggle(){},add(){},remove(){}};}
	get isConnected(){let node=this;while(node.parent)node=node.parent;return !!node.root;}
	get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
	set textContent(value){for(let child of this.children)child.parent=null;this.children=[];this._text=String(value);}
	append(...nodes){for(let node of nodes){node.parent=this;this.children.push(node);}}
	replaceChildren(...nodes){for(let child of this.children)child.parent=null;this.children=[];this._text='';this.append(...nodes);}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	querySelectorAll(selector){return this.children.flatMap(child=>[...(child.tag===selector?[child]:[]),...child.querySelectorAll(selector)]);}
	setAttribute(key,value){this.attributes.set(key,String(value));}
	removeAttribute(key){this.attributes.delete(key);}
	getAttribute(key){return this.attributes.get(key);}
	focus(){}
	select(){}
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const key=(name,extra={})=>({key:name,preventDefault(){},stopPropagation(){},...extra});

function fixture(){
	let material={id:'m1',assetID:'m1',revision:2,title:'原标题',summary:'原说明',sourceText:'原文',anchor:{attachmentID:7}},library={m1:structuredClone(material)},edits=[],statuses=[],failures=0,saves=0;
	let box=new Node('div');box.root=true;let list=new Node('div');
	let U={p:{materials:[material],sections:[],blocks:[],ui:{rightOpen:true}},assetBranches:new Set(),E:{assets:{key:value=>JSON.stringify(value)}},
		A:{assetLibrary:()=>library,asset:id=>structuredClone(library[id]),titleFor:m=>m.title||'',summaryFor:m=>m.summary||'',filterAutomaticMaterials:rows=>rows,materialAttachmentIDs:()=>[],ensureChineseSummaries(){},
			syncAssets(p){for(let row of p.materials)if(library[row.assetID]&&library[row.assetID].revision!==row.revision)mergeMaterialAsset(row,library[row.assetID]);},
			async editAsset(id,patch,revision){edits.push({patch,revision});if(failures>0){failures--;throw Error('存储写入失败');}if(library[id].revision!==revision)throw Error('素材已有新版本，请重新打开');library[id]={...library[id],...patch,revision:revision+1};return structuredClone(library[id]);}}};
	let el=(tag,text,cls)=>new Node(tag,text,cls);
	let context=vm.createContext({U,el,$:id=>id==='details'?box:list,M:{invalidate(){}},mergeMaterialAsset,referencedAssetsChanged,rememberAssetViewDefaults,descriptionOnlyChange,refreshMaterialDescriptions,assetViewDefaults:new Map(),
		clearDetails:()=>{box.replaceChildren();delete box.dataset.materialId;return box;},button:(text,fn,host,cls)=>{let node=el('button',text,cls);node.onclick=fn;host?.append(node);return node;},
		syncMaterialSelection(){},persist:async()=>{saves++;},snapshot(){},renderLibrary(){},renderEditor(){},materialAnchors:m=>[m.anchor],status:(text,error)=>statuses.push({text,error}),
		renderMaterialOverview:()=>({summaryHost:el('div'),dispose(){}}),renderMaterialExplanationEditor:()=>({isDirty:()=>false})});
	vm.runInContext(code,context);
	let open=()=>{context.showMaterial(material);let heading=box.querySelector('h3');heading.ondblclick();return {heading,input:heading.querySelector('input')};};
	return {material,library,edits,statuses,box,context,open,fail:count=>{failures=count;},get saves(){return saves;}};
}

test('a failed rename keeps the editor and the typed title, and Enter retries it',async()=>{
	let f=fixture(),{heading,input}=f.open();
	input.value='我改的标题';f.fail(2);
	input.onkeydown(key('Enter'));await settle();
	assert.ok(input.isConnected,'the editor stays open after the failure');
	assert.equal(input.value,'我改的标题','the typed title is not lost');
	assert.match(heading.textContent,/标题未保存：存储写入失败/);
	assert.equal(input.getAttribute('aria-invalid'),'true');
	assert.equal(f.edits.length,2,'one automatic retry');
	assert.equal(f.statuses.at(-1).error,true);
	input.onkeydown(key('Enter'));await settle();
	assert.equal(f.material.title,'我改的标题');
	assert.equal(input.isConnected,false);
	assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
	assert.ok(f.saves>0);
});

test('a background revision does not rebuild an open title editor; the save rebases and the details redraw after',async()=>{
	let f=fixture(),{input}=f.open();
	input.value='我改的标题';
	f.library.m1={...f.library.m1,summary:'后台更新的说明',revision:3};
	f.context.refresh();
	assert.ok(input.isConnected,'the open editor survives the refresh');
	assert.equal(input.value,'我改的标题');
	input.onkeydown(key('Enter'));await settle();
	assert.equal(f.edits.at(-1).revision,3,'the title patch applies to the current revision');
	assert.equal(f.library.m1.title,'我改的标题');
	assert.equal(f.library.m1.summary,'后台更新的说明','the background change is kept');
	assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
});

test('a title changed elsewhere is not overwritten until the user presses Enter again',async()=>{
	let f=fixture(),{heading,input}=f.open();
	input.value='我改的标题';
	f.library.m1={...f.library.m1,title:'别处的标题',revision:3};
	input.onkeydown(key('Enter'));await settle();
	assert.equal(f.edits.length,0,'no write before the user decides');
	assert.ok(input.isConnected);
	assert.match(heading.textContent,/别处改为“别处的标题”/);
	input.onblur();await settle();
	assert.equal(f.edits.length,0,'leaving the field does not overwrite');
	input.onkeydown(key('Enter'));await settle();
	assert.equal(f.library.m1.title,'我改的标题');
	assert.equal(f.edits.length,1);
	let again=f.open();again.input.value='放弃的标题';again.input.onkeydown(key('Escape'));await settle();
	assert.equal(f.library.m1.title,'我改的标题','Esc cancels');
	assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
});
