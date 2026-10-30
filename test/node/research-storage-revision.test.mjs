/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('research storage revisions advance after successful state commits and survive a failed write without invalidating readers',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});let fail=false;const store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{}}),write:async()=>{if(fail)throw Error('Controlled write failure');}});assert.equal(store.revision,0);await store.init();assert.equal(store.revision,1);const observed=[];store.subscribe(()=>observed.push(store.revision));await store.update(state=>state.settings.model='chosen');assert.equal(store.revision,2);assert.equal(store.get('settings').model,'chosen');fail=true;await assert.rejects(()=>store.update(state=>state.settings.model='unsaved'),/write failure/);assert.equal(store.revision,2);assert.equal(store.get('settings').model,'chosen');fail=false;await store.update(state=>state.settings.model='latest');assert.equal(store.revision,3);assert.deepEqual(observed,[2,3]);
});

test('queued conversation branch replacements preserve unrelated data references and notify only after successful persistence',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});const initial={version:1,papers:{p:{title:'论文'}},projects:{},settings:{model:'chosen'},manuscripts:{m:{blocks:[{text:'完整正文'.repeat(10000)}]}}},writes=[],events=[];let fail=false;
 const store=E.createStore({read:async()=>initial,write:async value=>{if(fail)throw Error('Controlled branch write failure');writes.push(value);}});await store.init();store.subscribe(change=>events.push(change));const manuscriptRevision=store.branchRevision('manuscripts'),branch={sessions:[{id:'a',messages:[]}]},first=store.replaceBranch('researchWorkbench',branch);branch.sessions[0].id='external';await first;
 assert.equal(writes[0].manuscripts,initial.manuscripts,'the private unchanged manuscript branch is structurally shared');assert.equal(store.get('researchWorkbench','sessions',0,'id'),'a','queued value was captured before caller mutation');assert.equal(store.branchRevision('manuscripts'),manuscriptRevision);assert.equal(store.branchRevision('researchWorkbench'),store.revision);assert.deepEqual(Array.from(events[0].changedBranches),['researchWorkbench']);assert.equal(Object.isFrozen(events[0].changedBranches),true);
 const saved=store.get('researchWorkbench');saved.sessions[0].id='local';assert.equal(store.get('researchWorkbench','sessions',0,'id'),'a');const revision=store.revision;fail=true;await assert.rejects(()=>store.replaceBranch('researchWorkbench',{sessions:[{id:'failed'}]}),/branch write failure/);assert.equal(store.revision,revision);assert.equal(events.length,1);assert.equal(store.get('researchWorkbench','sessions',0,'id'),'a');
 fail=false;await store.update(state=>state.settings.model='next');await store.replaceBranch('researchWorkbench',{sessions:[{id:'b'}]});assert.equal(store.get('settings','model'),'next');assert.equal(store.get('researchWorkbench','sessions',0,'id'),'b');assert.deepEqual(Array.from(events[1].changedBranches),['settings'],'legacy transactions now report the branches actually changed');assert.equal(store.branchRevision('manuscripts'),manuscriptRevision);assert.equal(events.length,3);assert.throws(()=>store.replaceBranch('__proto__',{}),/分支/);await store.flush();
});

test('atomic branch updates compose in the shared queue and detach retained mutations without cloning cached papers',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});const initial={version:1,papers:{one:{text:'缓存完整论文'.repeat(1000)}},projects:{},settings:{},researchNotebooks:{p:{first:'旧'}}},writes=[],events=[];let release,entered,retained;
 const store=E.createStore({read:async()=>initial,write:async value=>writes.push(value)});await store.init();store.subscribe(change=>events.push(change));const running=new Promise(resolve=>{entered=resolve;});
 const one=store.updateBranch('researchNotebooks',async notebooks=>{retained=notebooks;entered();await new Promise(resolve=>{release=resolve;});notebooks.p.first='作者关键词';});await running;
 const two=store.update(state=>{state.settings.model='选择的模型';}),three=store.updateBranch('researchNotebooks',notebooks=>{notebooks.p.second='后续条件';});release();await Promise.all([one,two,three]);
 assert.equal(writes[0].papers,initial.papers,'a keyword draft does not deep copy the PDF cache');assert.equal(store.get('researchNotebooks','p','first'),'作者关键词');assert.equal(store.get('researchNotebooks','p','second'),'后续条件');assert.equal(store.get('settings','model'),'选择的模型');retained.p.first='external mutation';assert.equal(store.get('researchNotebooks','p','first'),'作者关键词');assert.deepEqual(Array.from(events[0].changedBranches),['researchNotebooks']);assert.deepEqual(Array.from(events[1].changedBranches),['settings']);
 const revision=store.revision;await assert.rejects(()=>store.updateBranch('researchNotebooks',notebooks=>{notebooks.p.first='未保存';throw Error('受控失败');}),/受控失败/);assert.equal(store.revision,revision);assert.equal(store.get('researchNotebooks','p','first'),'作者关键词');await store.updateBranch('researchNotebooks',notebooks=>{notebooks.p.second='失败后的更新';});assert.equal(store.get('researchNotebooks','p','second'),'失败后的更新');assert.throws(()=>store.updateBranch('__proto__',()=>{}),/分支/);
});

test('ordinary transactions copy changed paths, preserve cached papers, and handle native array edits and moved draft records',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});
 const initial={version:1,papers:{one:{text:'完整缓存'.repeat(10000)}},projects:{},settings:{rows:[{id:'a',n:1},{id:'b',n:2},{id:'c',n:3}],untouched:{model:'chosen'}}},writes=[],events=[];
 const store=E.createStore({read:async()=>initial,write:async next=>writes.push(next)});await store.init();store.subscribe(value=>events.push(value));
 await store.update(s=>{s.settings.rows[1].n=7;s.settings.rows.reverse();const first=s.settings.rows.shift();s.settings.rows.push(first);s.settings.rows.splice(1,0,{id:'d',n:4});delete s.settings.rows[0].n;s.readerPreparations={one:{status:'ready'}};});
 assert.deepEqual(JSON.parse(JSON.stringify(store.get('settings','rows'))),[{id:'b'},{id:'d',n:4},{id:'a',n:1},{id:'c',n:3}]);
 assert.equal(writes[0].papers,initial.papers);assert.equal(writes[0].settings.untouched,initial.settings.untouched);assert.equal(initial.settings.rows[1].n,2,'drafts never mutate the previous committed snapshot');assert.deepEqual(Array.from(events[0].changedBranches).sort(),['readerPreparations','settings']);
});

test('no-op transactions do not write, and failed or escaped drafts cannot corrupt committed state',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});const writes=[],events=[];let retained,fail=false;
 const store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{x:1,nested:{x:2}}}),write:async next=>{if(fail)throw Error('disk unavailable');writes.push(next);}});await store.init();store.subscribe(v=>events.push(v));
 await store.update(s=>{s.settings.x=1;delete s.settings.absent;void s.settings.nested.x;});assert.equal(writes.length,0);assert.equal(store.revision,1);
 await assert.rejects(store.update(s=>{s.settings.nested.x=9;throw Error('failed mutation');}),/failed mutation/);assert.equal(store.get('settings','nested','x'),2);
 const external={nested:{value:'saved'}};await store.update(s=>{s.settings.external=external;s.settings.external.other=true;retained=s.settings;});external.nested.value='outside';assert.equal(store.get('settings','external','nested','value'),'saved');assert.throws(()=>{retained.x=8;},/事务已经结束/);
 fail=true;await assert.rejects(store.update(s=>{s.settings.x=42;}),/disk unavailable/);assert.equal(store.get('settings','x'),1);assert.equal(events.length,1);fail=false;await store.update(s=>{s.settings.x=5;});assert.equal(store.get('settings','x'),5);
});

test('workspace writes reuse unchanged serialized branches while preserving atomic durability and backup options',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8'),initial={version:1,papers:{one:{text:'已生成内容'.repeat(20000)}},projects:{},settings:{model:'old'}},writes=[],encoded=[];let fail=false;
 const E={},json={parse:JSON.parse,stringify(value,...args){encoded.push(value);return JSON.stringify(value,...args);}};
 vm.runInNewContext(source,{EasySch:E,Zotero:{DataDirectory:{dir:'/isolated'}},PathUtils:{join:(...v)=>v.join('/')},JSON:json,IOUtils:{makeDirectory:async()=>{},exists:async()=>true,readUTF8:async()=>JSON.stringify(initial),writeUTF8:async(path,text,options)=>{if(fail)throw Error('disk failure');writes.push({path,text,options});}}});
 await E.initStorage();await E.store.update(s=>{s.settings.model='one';});const cached=v=>v?.one?.text===initial.papers.one.text||v?.text===initial.papers.one.text,serializedPapers=encoded.filter(cached).length;assert.ok(serializedPapers>0,'the first write encodes the paper cache');
 await E.store.update(s=>{s.settings.model='two';});assert.equal(encoded.filter(cached).length,serializedPapers,'second settings edit does not stringify the paper cache');assert.equal(JSON.parse(writes.at(-1).text).settings.model,'two');assert.equal(JSON.parse(writes.at(-1).text).papers.one.text,initial.papers.one.text);assert.equal(writes.at(-1).options.tmpPath,'/isolated/easysch/workspace.json.tmp');assert.equal(writes.at(-1).options.backupFile,'/isolated/easysch/workspace.json.bak');
 fail=true;await assert.rejects(E.store.update(s=>{s.settings.model='unsaved';}),/disk failure/);assert.equal(E.store.get('settings','model'),'two');fail=false;await E.store.update(s=>{s.settings.model='retry';});assert.equal(JSON.parse(writes.at(-1).text).settings.model,'retry');
});

test('new records retain assignment-expression edits within the transaction and detach their RHS before persistence',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});const writes=[];
 const store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{}}),write:async next=>writes.push(next)});await store.init();let decision,entry;
 await store.update(s=>{s.paperConversations||={};decision=s.paperConversations.paper||={turns:[],decisions:[],questions:[]};decision.decisions.push({text:'首次确认'});entry=s.papers.paper||={records:[]};entry.records.push({text:'首次分析'});});
 assert.equal(store.get('paperConversations','paper','decisions',0,'text'),'首次确认');assert.equal(store.get('papers','paper','records',0,'text'),'首次分析');
 decision.decisions[0].text='事务外修改';entry.records.length=0;assert.equal(store.get('paperConversations','paper','decisions',0,'text'),'首次确认');assert.equal(writes[0].papers.paper.records[0].text,'首次分析');
});

test('assigned external subtrees detach after proxy reads or edits and preserve contained draft values',async()=>{
 const E={},source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');vm.runInNewContext(source,{EasySch:E});const writes=[];
 const initial={version:1,papers:{},projects:{},settings:{existing:{text:'原文'}}},store=E.createStore({read:async()=>initial,write:async next=>writes.push(next)});await store.init();const readOnly={nested:{text:'只读取值'}},edited={nested:{text:'先前值'}};let retained;
 await store.update(s=>{s.settings.readOnly=readOnly;assert.equal(s.settings.readOnly.nested.text,'只读取值');s.settings.edited=edited;s.settings.edited.nested.text='通过代理修改';s.settings.wrapper={record:s.settings.existing};s.settings.existing.text='已修改原文';retained=s.settings.wrapper;});
 readOnly.nested.text='外部污染';edited.nested.text='外部污染';assert.equal(store.get('settings','readOnly','nested','text'),'只读取值');assert.equal(store.get('settings','edited','nested','text'),'通过代理修改');assert.equal(store.get('settings','wrapper','record','text'),'已修改原文');assert.equal(initial.settings.existing.text,'原文');assert.throws(()=>{retained.record.text='失效代理修改';},/事务已经结束/);
 assert.equal(writes[0].settings.readOnly.nested.text,'只读取值');assert.equal(writes[0].settings.edited.nested.text,'通过代理修改');
});
