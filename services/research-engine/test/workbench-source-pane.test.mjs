import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/workbench-reader.js',import.meta.url),'utf8');
class Node extends EventTarget {
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.style={};this.classList={add(){}};this.textContent='';}
 get isConnected(){return this.root===true||!!this.parentElement?.isConnected;}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(node=>node!==this);this.parentElement=null;}}
 querySelector(tag){for(const node of this.children){if(node.tagName===tag)return node;const child=node.querySelector(tag);if(child)return child;}return null;}
}
function fixture(){
 const win=new EventTarget();Object.assign(win,{AbortController,setTimeout,clearTimeout});
 const doc={defaultView:win,createElementNS:(_ns,tag)=>new Node(doc,tag)};
 const host=new Node(doc,'host');host.root=true;
 const paper={id:10,isRegularItem:()=>true},pdf={id:20,parentID:10,isPDFAttachment:()=>true},version={...pdf,id:40};
 const items=new Map([[10,paper],[20,pdf],[40,version]]),calls=[],disposals=[];
 const E={library:{localPDF:async item=>item.isPDFAttachment?.()?item:pdf,openSource:async location=>calls.push(location)},
  openAssetPanel:(reader,_focus,body)=>{calls.push(reader.itemID);const panel=new Node(doc,'panel');body.append(panel);panel.dispose=()=>disposals.push(reader.itemID);return panel;},
  renderReferencePane:async(body,item)=>{calls.push(item.id);body._referenceDispose=()=>disposals.push('reference-'+item.id);}};
 const Zotero={Research:E,Items:{getAsync:async id=>items.get(id)},logError:error=>{throw error;}};
 vm.runInContext(source,vm.createContext({Zotero}));return {E,host,doc,win,calls,disposals,pdf,version};
}
test('exact attachment version is reused by images and references with independent cleanup',async()=>{
 const f=fixture();const old=await f.E.mountWorkbenchSourcePane(f.host,{id:10,attachmentID:40},'images');
 assert.equal(f.host.children[0].dataset.attachmentId,'40');assert.deepEqual(f.calls,[40]);
 const cleanup=await f.E.mountWorkbenchSourcePane(f.host,{id:10,anchor:{attachmentID:20}},'references');
 assert.deepEqual(f.calls,[40,20]);assert.deepEqual(f.disposals,[40]);old();assert.equal(f.host.children.length,1);
 cleanup();cleanup();assert.deepEqual(f.disposals,[40,'reference-20']);assert.equal(f.host.children.length,0);
});
test('an old lookup and a late reference reply cannot overwrite a new pane',async()=>{
 const f=fixture(),local=f.E.library.localPDF;let release,reference,body;
 f.E.library.localPDF=async item=>item.id===40?new Promise(resolve=>release=()=>resolve(f.version)):local(item);
 const old=f.E.mountWorkbenchSourcePane(f.host,{attachmentID:40},'images');await Promise.resolve();await Promise.resolve();
 const current=await f.E.mountWorkbenchSourcePane(f.host,{attachmentID:20},'images');release();await old;
 assert.deepEqual(f.calls,[20]);assert.equal(f.host.children[0].dataset.attachmentId,'20');current();
 f.E.renderReferencePane=async(node,item)=>{body=node;node._referenceDispose=()=>f.disposals.push('late-ref');await new Promise(resolve=>reference=resolve);node.textContent='late';};
 const controller=new AbortController();const pending=f.E.mountWorkbenchSourcePane(f.host,{attachmentID:20},'references',{signal:controller.signal});
 for(let i=0;i<10&&!reference;i++)await Promise.resolve();controller.abort();reference();await pending;
 assert.equal(body.isConnected,false);assert.equal(f.host.children.length,0);assert.ok(f.disposals.includes('late-ref'));
});
test('missing PDFs do not fetch on mount and an explicit request mounts the returned attachment',async()=>{
 const f=fixture();let downloads=0;f.E.obtainPaper=async()=>{downloads++;return {attachmentID:40};};
 const cleanup=await f.E.mountWorkbenchSourcePane(f.host,{id:'remote-only',doi:'10.1/example'},'images');
 assert.equal(downloads,0);assert.deepEqual(f.calls,[]);assert.match(f.host.querySelector('p').textContent,/暂无本地 PDF/);
 await f.host.querySelector('button').onclick();assert.equal(downloads,1);assert.deepEqual(f.calls,[40]);
 assert.equal(f.host.children[0].dataset.attachmentId,'40');cleanup();assert.deepEqual(f.disposals,[40]);
});
test('invalid explicit attachment never falls back to another version of the paper',async()=>{
 const f=fixture();await f.E.mountWorkbenchSourcePane(f.host,{id:10,attachmentID:9999},'images');
 assert.deepEqual(f.calls,[]);assert.match(f.host.querySelector('p').textContent,/暂无本地 PDF/);
});
