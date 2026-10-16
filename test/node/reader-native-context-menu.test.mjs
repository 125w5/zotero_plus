/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/reader.js',import.meta.url),'utf8');
function fixture(){
 const nodes=[],doc={createXULElement(tag){const attrs=new Map(),listeners=new Map();const node={tag,ownerDocument:doc,children:[],setAttribute:(key,value)=>attrs.set(key,String(value)),hasAttribute:key=>attrs.has(key),toggleAttribute(key,force){const present=force===undefined?!attrs.has(key):!!force;if(present)attrs.set(key,'');else attrs.delete(key);return present;},append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},addEventListener:(type,fn)=>listeners.set(type,fn),remove(){},openPopupAtScreen(){},fire:type=>listeners.get(type)?.()};nodes.push(node);return node;}};
 const context={setTimeout:fn=>fn(),Zotero:{Promise:{defer(){let resolve;const promise=new Promise(done=>resolve=done);return{resolve,promise};}}}};
 vm.runInNewContext(source.slice(source.indexOf('class ReaderInstance {'),source.indexOf('class ReaderPreview extends'))+'\nglobalThis.ReaderInstance=ReaderInstance;',context);
 const reader=Object.create(context.ReaderInstance.prototype),win={document:doc,windowUtils:{toScreenRectInCSSUnits:(x,y)=>({x,y})}};reader._window=win;reader._iframe={getBoundingClientRect:()=>({left:0,top:0,x:0,y:0})};reader._popupset=doc.createXULElement('popupset');return{reader,nodes};
}

test('native Reader menus keep default actions enabled and disable only explicitly unavailable actions',async()=>{
 const {reader,nodes}=fixture();let commands=0;const done=reader._openContextMenu({x:10,y:20,itemGroups:[[{label:'Default action',onCommand:()=>commands++},{label:'Explicit enabled',disabled:false,onCommand:()=>{}},{label:'Unavailable',disabled:true,onCommand:()=>{}}]]});
 const items=nodes.filter(node=>node.tag==='menuitem');assert.equal(items.length,3);assert.equal(items[0].hasAttribute('disabled'),false);assert.equal(items[1].hasAttribute('disabled'),false);assert.equal(items[2].hasAttribute('disabled'),true);items[0].fire('command');assert.equal(commands,1);nodes.find(node=>node.tag==='menupopup').fire('popuphidden');await done;
});
