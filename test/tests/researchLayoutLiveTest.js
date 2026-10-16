/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Research layout live model', function () {
 this.timeout(180000);
 const E=Zotero.Research;let win,folder;
 const report={type:'真实 Zotero 进程与真实 API 模型；仅整理顺序，不生成论文正文',checks:[]};
 before(async function(){if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}win=await loadZoteroPane();await E.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'layout-live-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});});
 afterEach(async function(){if(folder){report.checks.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));}});
 after(async()=>{await E.store.flush();win?.close();});
 it('returns an actual stable-ID order proposal and preserves all manually written content',async()=>{
  const M=E.manuscripts.model,p=M.createProject('人工内容顺序验收');p.sections=p.sections.slice(0,2);p.sections[0].title='验证条件';p.sections[1].title='研究问题';
  p.blocks=[M.block('paragraph',p.sections[0].id,{text:'人工笔记：先固定训练、验证和测试设备，避免同一设备样本同时进入不同划分。',runs:[{text:'人工笔记：',bold:true},{text:'先固定训练、验证和测试设备，避免同一设备样本同时进入不同划分。'}]}),M.block('formula',p.sections[0].id,{text:'x_{i}^{2}=1'}),M.block('paragraph',p.sections[1].id,{text:'人工笔记：要验证的是模型在未知设备上的泛化能力，尚未运行实验。'})];
  const before=JSON.stringify(p),started=Date.now(),originalFetch=win.fetch,diagnostics=[];
  report.requests=[];
  win.fetch=async(url,options)=>{
   const response=await originalFetch.call(win,url,options);
   if(String(url).endsWith('/chat/completions')){
    const input=JSON.parse(options.body),entry={provider:new URL(url).hostname,model:input.model,stream:!!input.stream,jsonFormat:!!input.response_format,status:response.status};report.requests.push(entry);
    if(response.ok)diagnostics.push((async()=>{try{const chat=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs'),result=await chat.readChatCompletion(response.clone(),{stream:!!input.stream});entry.outputCharacters=result.text.length;entry.finishReason=result.finishReason||null;}catch{entry.responseReadable=false;}})());
   }
   return response;
  };
  let proposal;
  try{proposal=await E.manuscripts.organize(p,'只整理现有章节与模块的阅读顺序，将研究问题放在验证条件之前，章节内容和所有公式不得改变。');}
  catch(error){report.failure=error.message;throw error;}
  finally{win.fetch=originalFetch;await Promise.all(diagnostics);}
  assert.equal(JSON.stringify(p),before);assert.equal(proposal.kind,'layout');assert.isString(proposal.model);assert.isAbove(proposal.model.length,0);
  const next=E.manuscripts.applyLayout(p,proposal);
  for(const field of ['sections','blocks','materials'])for(const original of p[field])assert.deepEqual(next[field].find(row=>row.id===original.id),original);
  assert.lengthOf(next.blocks,p.blocks.length);assert.deepEqual(next.sections.map(row=>row.id),proposal.sectionOrder);
  report.realModel={completed:true,elapsedMS:Date.now()-started,sectionCount:p.sections.length,blockCount:p.blocks.length,reasonCount:proposal.reasons.length,manuscriptContentUnchanged:true,newImageCount:0};
 });
});
