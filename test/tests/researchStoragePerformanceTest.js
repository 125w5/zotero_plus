/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Research native storage performance and durability',function(){
 this.timeout(90000);let win,folder,local,path;const report={tests:[],metrics:[],limitations:['使用独立合成缓存与真实原子磁盘写入，不读取日常论文、笔记或密钥','耗时受本机磁盘和负载影响，不等同整机帧率或所有场景的性能保证']};
 before(async()=>{
  win=await loadZoteroPane();folder=PathUtils.join(Zotero.DataDirectory.dir,'storage-performance-acceptance');await IOUtils.makeDirectory(PathUtils.join(folder,'easysch'),{ignoreExisting:true});path=PathUtils.join(folder,'easysch','workspace.json');
  const fixture={version:1,papers:{cached:{text:'synthetic-cache '.repeat(Math.ceil(32*1024*1024/16))}},projects:{},settings:{model:'chosen'},readerNoteLinks:{},list:[{id:'a'},{id:'b'}]};
  await IOUtils.writeUTF8(path,JSON.stringify(fixture));local={};Services.scriptloader.loadSubScript('chrome://zotero/content/xpcom/research/storage.js',{EasySch:local,Zotero:{DataDirectory:{dir:folder},logError:error=>Zotero.logError(error)},IOUtils,PathUtils,TextEncoder:win.TextEncoder},'UTF-8');await local.initStorage();report.syntheticBytes=(await IOUtils.stat(path)).size;report.writePath='cached UTF-8 pieces / native IOUtils.write';
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(()=>{win?.close();});
 it('writes small note-link changes atomically beside a 32 MiB cache and keeps the native event loop available',async()=>{
  await local.store.update(s=>{s.readerNoteLinks.warm={noteID:-1};});const gaps=[],durations=[];let previous=win.performance.now();const heartbeat=win.setInterval(()=>{const now=win.performance.now();gaps.push(now-previous);previous=now;},10);
  try{for(let i=0;i<4;i++){const start=win.performance.now();await local.store.update(s=>{s.readerNoteLinks['note-'+i]={noteID:i,pageIndex:0};});durations.push(win.performance.now()-start);assert.equal(local.store.get('readerNoteLinks','note-'+i,'noteID'),i);}await Zotero.Promise.delay(35);}
  finally{win.clearInterval(heartbeat);}
  const saved=JSON.parse(await IOUtils.readUTF8(path));assert.equal(saved.papers.cached.text.length,32*1024*1024);assert.lengthOf(Object.keys(saved.readerNoteLinks),5);assert.isTrue(await IOUtils.exists(path+'.bak'));assert.isAbove(gaps.length,0,'实际磁盘写入期间原生事件循环继续执行');report.metrics.push({action:'four-atomic-note-link-writes',durationsMs:durations.map(Math.round),maxHeartbeatGapMs:Math.round(Math.max(...gaps)),heartbeatTicks:gaps.length});
 });
 it('supports array edits and actual branch notifications in Gecko without touching unrelated cached paper data',async()=>{
  const frozen=local.store.peek('list');assert.isTrue(Object.isFrozen(frozen));const events=[];const off=local.store.subscribe(change=>events.push(change));try{await local.store.update(s=>{s.list.reverse();s.list.push({id:'c'});s.list[0].title='edited';});assert.deepEqual(JSON.parse(JSON.stringify(local.store.get('list'))),[{id:'b',title:'edited'},{id:'a'},{id:'c'}]);assert.equal(frozen[0].id,'a','旧共享快照保持不变');assert.deepEqual(Array.from(events[0].changedBranches),['list']);const count=events.length;await local.store.update(s=>{s.settings.model='chosen';});assert.equal(events.length,count,'无变化事务不重写文件或通知界面');}finally{off();}
 });
 it('rejects failed mutations and preserves the last durable note links',async()=>{
  const before=local.store.revision;let rejected=false;try{await local.store.update(s=>{s.readerNoteLinks['note-0'].noteID=999;throw Error('controlled failure');});}catch(error){rejected=error.message==='controlled failure';}assert.isTrue(rejected);assert.equal(local.store.revision,before);assert.equal(local.store.get('readerNoteLinks','note-0','noteID'),0);assert.equal(JSON.parse(await IOUtils.readUTF8(path)).readerNoteLinks['note-0'].noteID,0);await local.store.flush();
 });
 it('persists first-time records edited through assignment results and detaches them after the transaction',async()=>{
  let retained;await local.store.update(s=>{const row=s.readerNoteLinks.first ||= {decisions:[]};retained=row;row.decisions.push('chosen');void s.readerNoteLinks.first.decisions;});
  retained.decisions.push('outside-transaction');assert.deepEqual(Array.from(local.store.get('readerNoteLinks','first','decisions')),['chosen']);assert.deepEqual(JSON.parse(await IOUtils.readUTF8(path)).readerNoteLinks.first.decisions,['chosen']);
 });
});
