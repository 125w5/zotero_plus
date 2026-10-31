describe('Outcome actions and cited literature collection',function(){
 this.timeout(240000);const R=Zotero.Research;let win,ui,folder,paper,attachment;const report={controlled:[],network:[],limitations:[]};
 const wait=async fn=>{for(let i=0;i<1600;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待前台超时');};
 async function shot(name){const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,name),new Uint8Array(await blob.arrayBuffer()));image.close();}
 before(async()=>{win=await loadZoteroPane();win.Zotero_Tabs.closeAll();await R.attachWindow(win);win.resizeTo(1450,960);folder=PathUtils.join(Zotero.DataDirectory.dir,'reference-flow-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});ui=await R.openWorkflow('research');await wait(()=>ui.ready);});
 after(async()=>{await R.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('only shows applicable reading and selection actions',async()=>{
  ui.current=null;ui.record=null;ui.papers=[];ui.selection=null;ui.renderResult();assert.isTrue(ui.$('save-note').hidden);assert.equal(ui.$('analyze').textContent,'选择论文并阅读');assert.isTrue(ui.$('research-choose-papers').hidden);assert.isFalse(ui.$('paper-skill').closest('details.flow-more').open);
  const candidates=await R.library.pptCandidates();const chosen=candidates.filter(p=>/C-AMC|World Model-Based/i.test(p.title));
  for(const p of chosen){const item=await Zotero.Items.getAsync(p.id),a=item.isPDFAttachment()?item:await item.getBestAttachment();if(a?.isPDFAttachment()&&await a.getFilePathAsync()){paper=p;attachment=a;break;}}
  assert.exists(paper,'已有真实论文及附件');ui.current=paper;ui.papers=[paper];ui.selection={paperID:paper.id,attachmentID:attachment.id,text:'selected passage'};ui.$('prompt').value='';ui.updateReadingActions();assert.equal(ui.$('analyze').textContent,'解释选段');ui.$('prompt').value='请解释这个方法';ui.updateReadingActions();assert.equal(ui.$('analyze').textContent,'回答选段问题');ui.$('prompt').value='';ui.selection=null;report.controlled.push('Gecko DOM：空状态隐藏保存笔记；有选段和问题时主操作随上下文变化；高级技能默认折叠');
 });
 it('collects actual cited papers through the visible button and reuses the saved result',async()=>{
  // The search form stays open; reference collection sits in the collapsed 沿当前论文查找 tools.
  ui.current=paper;ui.show('search');const tools=ui.$('view-search').querySelector('details.discovery-more'),collect=ui.$('collect-references');assert.exists(tools,'沿当前论文查找');assert.isFalse(tools.open,'默认折叠');assert.isTrue(tools.contains(collect));assert.isNull(ui.$('search-query').closest('details'),'检索表单常驻');assert.equal(collect.textContent,'收集参考文献');
  // pptButton marks itself busy at once and awaits pending edits before loadDiscovery disables it.
  tools.open=true;collect.click();assert.equal(collect.getAttribute('aria-busy'),'true');await wait(()=>!collect.hasAttribute('aria-busy')&&!collect.disabled);const text=ui.$('search-results').textContent;
  const result=Object.values(R.store.get().discovery||{}).filter(r=>r.sourceVersion&&r.records?.some(p=>p.citationOrigins?.some(o=>o.parentItemID===paper.id))).sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(!result?.records.length){report.limitations.push({type:'真实 Zotero 网络调用受阻',paper:paper.title,text});throw Error('真实参考文献匹配未完成：'+text);}
  // Cards show only records with a public PDF or a local attachment; the rest are counted as hidden.
  const {discoveryPDFCandidate}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/discovery-presentation.mjs');assert.equal(ui.$('search-results').querySelectorAll('.discovery-paper').length,result.records.filter(p=>discoveryPDFCandidate(p)).length);for(const p of result.records){assert.isFalse(p.incomplete);assert.isAbove(p.citationOrigins.length,0);assert.isTrue(p.citationOrigins.every(o=>o.parentItemID===paper.id));}
  const before=win.Zotero_Tabs.getState().length;tools.open=true;collect.click();await wait(()=>!collect.hasAttribute('aria-busy')&&!collect.disabled);assert.include(ui.$('search-results').textContent,'已复用缓存');assert.equal(win.Zotero_Tabs.getState().length,before);
  await shot('01-collected-references.png');report.network.push({type:'实际 Zotero 进程发出请求；前台按钮由 DOM 点击',paper:paper.title,parentItemID:paper.id,found:result.records.length,total:result.total,skipped:result.skipped,reused:result.reused,sample:result.records.slice(0,4),noAutomaticTabs:true});
 });
 it('ignores an earlier response after a new collection starts',async()=>{
  const original=R.discover;let finish;R.discover=()=>new Promise(resolve=>finish=resolve);
  try{const old=ui.loadDiscovery();ui.discoveryToken++;finish({records:[{title:'过期响应，不应显示'}],at:new Date().toISOString()});await old;assert.notInclude(ui.$('search-results').textContent,'过期响应');report.controlled.push('受控延迟响应：已失效的收集结果不覆盖当前页面');}finally{R.discover=original;ui.$('collect-references').disabled=false;}
 });
});
