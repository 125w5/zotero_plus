/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {JOURNAL_FORMATS,journalFormat,applyJournalFormat} from '../../chrome/content/zotero/research/shared/journal-formats.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import {installJournalFormatPicker} from '../../chrome/content/zotero/research/manuscript/journal-format-picker.mjs';

test('journal switch changes only layout and citation settings while preserving authored text, source links and custom reference',()=>{
 const p=Model.createProject('人工稿件');p.template.referenceDoc='C:/templates/my-journal.docx';p.blocks=[Model.block('paragraph',p.sections[0].id,{text:'实际测量值为2.8%，结果尚待复测。',materials:[{id:'evidence',revision:2}]})];const blocks=structuredClone(p.blocks),sections=structuredClone(p.sections);
 for(const format of JOURNAL_FORMATS){applyJournalFormat(p,format.id);assert.deepEqual(p.blocks,blocks);assert.deepEqual(p.sections,sections);assert.equal(p.template.referenceDoc,'C:/templates/my-journal.docx');assert.equal(p.citationStyle,'http://www.zotero.org/styles/'+format.style);}
 const before=structuredClone(p);assert.throws(()=>applyJournalFormat(p,'missing'),/可用/);assert.deepEqual(p,before);
});
test('the APS citation preset installs its bundled licensed CSL without contacting a remote service',async()=>{
 const code=await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js',import.meta.url),'utf8'),csl=await readFile(new URL('../../chrome/content/zotero/research/third-party/csl/american-physics-society.csl',import.meta.url),'utf8'),installed=new Map(),calls=[];
 const E={store:{get:()=>({})}},styleID='http://www.zotero.org/styles/american-physics-society';
 vm.runInNewContext(code,{Zotero:{Research:E,Styles:{get:id=>installed.get(id),install:async(value,_origin,silent)=>{assert.equal(silent,true);assert.equal(value.string,csl);installed.set(styleID,{id:styleID});}},File:{getContentsFromURLAsync:async url=>{calls.push(url);return csl;}}},ChromeUtils:{importESModule:url=>url.includes('research-ai-policy')?Policy:Model}});
 assert.equal(await E.manuscripts.ensureJournalStyle(styleID),true);assert.equal(await E.manuscripts.ensureJournalStyle(styleID),true);assert.deepEqual(calls,['chrome://zotero/content/research/third-party/csl/american-physics-society.csl']);assert.match(csl,/creativecommons.org\/licenses\/by-sa\/3.0/);await assert.rejects(E.manuscripts.ensureJournalStyle('http://invalid/style'),/未安装/);
});
test('a failed citation-style installation leaves the current preset and undo history intact',async()=>{
 const doc={head:{append(){}},body:{dataset:{}}};const el=(tag,text)=>({tag,ownerDocument:doc,children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){},value:'',textContent:text,disabled:false});const host={prepend(){}},exportButton={ownerDocument:doc,parentElement:host},p=Model.createProject('稿件'),snapshots=[];
 const U={p,$:()=>exportButton,E:{manuscripts:{ensureJournalStyle:async()=>{throw Error('style unavailable');}}}},api=installJournalFormatPicker(U,{el,snapshot:()=>snapshots.push(structuredClone(p)),changed(){},persist:async()=>{},status(){}});
 await assert.rejects(api.setFormat('physical-review'),/unavailable/);assert.equal(p.journalFormat,undefined);assert.equal(snapshots.length,0);assert.equal(api.select.value,'research');assert.equal(api.select.disabled,false);assert.equal(journalFormat('ieee').columns,2);
});
