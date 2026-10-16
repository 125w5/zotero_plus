/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {metadataPaneIDs, paperHiddenPaneIDs, researchPaneKind, resolvePaperPaneID, paperPaneOrder, paperRailOrder, paperRailPaneVisible}
 from '../../../chrome/content/zotero/research/shared/reader-navigation.mjs';
import {installPaperOverview} from '../../../chrome/content/zotero/research/shared/paper-overview.mjs';

const overview = 'easysch-core-research-overview';
const abstract = 'easysch-core-research-abstract';
const images = 'easysch-core-research-images';
const references = 'easysch-core-research-references';
const chat = 'easysch-core-research-workstation';
const ids = ['related', references, 'tags', chat, 'attachments', 'notes', images,
 'libraries-collections', 'info', 'abstract', overview, abstract, 'attachment-info'];

test('late registration and opposite persisted orders share one stable paper content order', () => {
 const order = paperPaneOrder(ids);
 assert.deepEqual(order.slice(0,7), [overview, abstract, 'abstract', 'info', 'attachments', 'notes', 'attachment-info']);
 assert.deepEqual(order.slice(7), [images, references, chat, ...metadataPaneIDs]);
 assert.deepEqual(paperPaneOrder([...ids].reverse()), order);
 assert.equal(new Set(order).size, ids.length);
 assert.deepEqual(paperPaneOrder([...order, images]), order, 'duplicate registration does not duplicate a section');
});

test('paper reader keeps exactly one note destination and low-frequency metadata off the rail', () => {
 const order = paperRailOrder([...ids, 'context-notes'], true)
  .filter(id => paperRailPaneVisible(id, true));
 assert.deepEqual(order.slice(0,6), [abstract, 'info', 'context-notes', images, references, chat]);
 assert.ok(!order.includes('notes'));
 for (const id of [...metadataPaneIDs, overview, 'abstract', 'attachments', 'attachment-info']) assert.ok(!order.includes(id));
 assert.deepEqual(paperRailOrder([...ids].reverse(), true).filter(id=>paperRailPaneVisible(id,true)), order);
});

test('public feature IDs select the registered full-column pane while preserving native metadata IDs', () => {
 assert.equal(resolvePaperPaneID(ids, 'info'), overview);
 assert.equal(resolvePaperPaneID(ids, 'abstract'), abstract);
 assert.equal(resolvePaperPaneID(ids, images), images);
 assert.equal(resolvePaperPaneID(ids, 'tags'), 'tags');
 assert.equal(resolvePaperPaneID(ids, 'missing'), null);
 assert.equal(researchPaneKind(abstract), 'abstract');
 assert.ok(paperHiddenPaneIDs.every(id => ids.includes(id)), 'native abstract and attachment data remain registered');
});

test('library retains paper notes, unknown registered panes, and complete native section IDs', () => {
 const unknown = 'useful-custom-section';
 const content = paperPaneOrder([...ids, unknown]);
 assert.ok(content.includes(unknown));
 assert.ok(metadataPaneIDs.every(id => content.includes(id)), 'metadata remains stored and accessible');
 assert.ok(content.includes('attachments'), '附件 section 对象和关联数据保留，仅隐藏常用界面');
 const rail = paperRailOrder([...ids, unknown]).filter(id => paperRailPaneVisible(id));
 assert.ok(rail.includes('notes'));
 assert.ok(rail.includes(unknown));
 assert.ok(!rail.includes('context-notes'));
});

test('homepage previews share a cropped article task and invalidate on source-file changes', async () => {
 let stat={lastModified:1,size:100},calls=0,fail=false;
 const paths=[],E={assets:{cover:async id=>{calls++;await Promise.resolve();if(fail)throw Error('受控裁图失败');return {pageIndex:2,pageHeight:792,bbox:[30,40,580,740],path:'large.png',thumbnail:'small.png',id};}},previewImage:async path=>{paths.push(path);return 'controlled:'+path;}};
 installPaperOverview(E,{Zotero:{},IOUtils:{stat:async()=>stat}});
 const attachment={id:17,getFilePathAsync:async()=> 'controlled-paper.pdf'};
 const [first,again]=await Promise.all([E.firstPage(attachment),E.firstPage(attachment)]);
 assert.strictEqual(first,again);assert.equal(calls,1);assert.equal(first.pageIndex,2);assert.equal(first.src,'controlled:small.png');assert.deepEqual(paths,['small.png']);
 stat={lastModified:2,size:100};const changed=await E.firstPage(attachment);assert.notStrictEqual(first,changed);assert.equal(calls,2,'改变文件时不能继续显示旧裁图');
 stat={lastModified:2,size:200};fail=true;await assert.rejects(E.firstPage(attachment),/裁图失败/);fail=false;await E.firstPage(attachment);assert.equal(calls,4,'失败任务移出内存缓存，后续可以真实重试');
});

test('homepage generation tokens survive wrapped expandos and reject a late response for an older paper', async () => {
 class Node {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.isConnected=true;this.classList={add:name=>{this.className=[this.className,name].filter(Boolean).join(' ');}};}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  insertBefore(node,before){this.children.splice(this.children.indexOf(before),0,node);}
  addEventListener(){}
  setAttribute(){}
  querySelector(selector){for(const node of this.children){if(selector==='.paper-cover'&&node.className?.split(' ').includes('paper-cover'))return node;const nested=node.querySelector?.(selector);if(nested)return nested;}return null;}
 }
 const doc={querySelector:()=>null,createElementNS:(_ns,tag)=>new Node(tag,doc),createTextNode:text=>({textContent:text}),defaultView:{addEventListener(){},removeEventListener(){},clearTimeout(){}}};doc.documentElement=new Node('root',doc);
 // Controlled approximation of an expando crossing a Gecko compartment:
 // object identity can be wrapped, whereas primitive values remain stable.
 const host=new Proxy(new Node('host',doc),{get(target,key){const value=target[key];return key==='_overviewToken'&&value&&typeof value==='object'?structuredClone(value):value;}});
 let finishOld;const oldSource=new Promise(resolve=>{finishOld=resolve;}),calls=[];
 const attachment=id=>({id,getFilePathAsync:async()=> 'controlled-'+id+'.pdf'});
 const E={store:{get:()=>undefined},library:{localPDF:async item=>item.id===1?oldSource:attachment(item.id)},assets:{cover:async id=>{calls.push(id);return {pageIndex:id,pageHeight:792,bbox:[30,40,580,740],path:'large-'+id+'.png',thumbnail:'small-'+id+'.png'};},position:cover=>({pageIndex:cover.pageIndex,rects:[]})},previewImage:async path=>'controlled:'+path};
 installPaperOverview(E,{Zotero:{debug(){},HTTP:{request:async(method,url)=>{assert.equal(method,'GET');assert.equal(url,'chrome://zotero/content/research/shared/paper-overview.css');return {responseText:'.paper-overview{display:flex}'};}}},IOUtils:{stat:async()=>({lastModified:1,size:100})}});
 const old=E.renderPaperOverview(host,{id:1});
 await E.renderPaperOverview(host,{id:2});
 const image=host.querySelector('.paper-cover');assert.ok(image,'跨realm路径必须生成首页，不能只留下正在读取');assert.equal(image.src,'controlled:small-2.png');assert.equal(typeof host._overviewToken,'string');
 finishOld(attachment(1));await old;assert.strictEqual(host.querySelector('.paper-cover'),image,'旧PDF请求不能重绘当前PDF');assert.deepEqual(calls,[2],'已经过期的首页不得继续加载');assert.equal(host._overviewItem,2);
});
