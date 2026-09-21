import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const code=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');
test('projected card reads remain detached and avoid serializing unrelated research data',async()=>{
 const E={};vm.runInNewContext(code,{EasySch:E});let reads=0;const state={version:1,papers:{},projects:{},settings:{},materials:{m:{summary:'中文说明'}},unrelated:{toJSON(){reads++;return 'large document';}}};
 const store=E.createStore({read:async()=>state,write:async()=>{}});await store.init();const card=store.get('materials','m');assert.equal(card.summary,'中文说明');assert.equal(reads,0);card.summary='修改副本';assert.equal(store.get('materials','m').summary,'中文说明');assert.equal(store.get('missing'),undefined);store.get();assert.equal(reads,1);
 await store.update(s=>{s.materials.m.summary='已确认修改';});await store.flush();assert.equal(store.get('materials','m').summary,'已确认修改');
});
