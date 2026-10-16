/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
 async linkDiscoveryConversationFile(result,sessionID=this.agentData?.activeSessionID) {
  if(!result?.attachmentID||!sessionID||!this.E.chatAttachments||!this.E.workbenchConversations?.get(sessionID))return false;
  try{await this.E.chatAttachments.attach(sessionID,{items:[result.attachmentID]});if(this.agentData?.activeSessionID===sessionID)this.renderAgentAttachments?.();return true;}
  catch(error){this.status('PDF 已保存在文件夹；关联到对话未完成：'+error.message,true);return false;}
 },
 initDiscovery() {
  const view=this.$('view-search'),heading=view.querySelector('h2'),intro=view.querySelector(':scope>p');
  heading.textContent='文献搜集';intro.textContent='按标题、作者、关键词或 DOI 检索，筛选后保存题录、获取公开 PDF；也可以沿当前论文收集引用。';
  const controls=this.el('div',undefined,'discovery-controls'),current=this.el('p',undefined,'muted');current.id='discovery-current';
  const collect=this.el('button','收集参考文献','primary');collect.id='collect-references';collect.onclick=()=>this.loadDiscovery('references');
  const more=this.el('details',undefined,'discovery-more');more.append(this.el('summary','更多'));
  this.pptButton('更换当前论文',()=>this.chooseDiscoveryPaper(),more);
  this.pptButton('重新查找参考文献',()=>this.loadDiscovery('references',true),more);
  this.pptButton('查看被引文献',()=>this.loadDiscovery('citations'),more);
  this.pptButton('寻找相似论文',()=>this.loadDiscovery('similar'),more);
  controls.append(collect,more);intro.after(current,controls);
  const form=this.$('search-query').parentElement;form.classList.add('collection-search-form');heading.after(form);
  const source=this.$('search-source');source.replaceChildren();for(const [value,label]of [['','自动来源'],['openalex','OpenAlex'],['semantic','Semantic Scholar'],['arxiv','arXiv'],['pubmed','PubMed']]){const option=this.el('option',label);option.value=value;source.append(option);}
  const history=this.el('details',undefined,'collection-search-history');history.append(this.el('summary','搜索记录'));this.collectionSearchHistory=this.el('div');history.append(this.collectionSearchHistory);form.after(history);this.renderCollectionHistory();
  const references=this.el('details',undefined,'collection-reference-tools');references.append(this.el('summary','沿当前论文搜集'));intro.after(references);references.append(current,controls);
  const old=this.$('search-academic'),button=old.cloneNode(true);old.replaceWith(button);button.classList.remove('primary');button.textContent='查找论文';
  button.classList.add('primary');button.onclick=()=>this.searchCollection();
  this.$('search-query').addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229){e.stopImmediatePropagation();return;}if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();button.click();}},true);
  const destination=this.createDiscoveryDestination('保存论文到');history.after(destination.root);
  this.collectionFilters={};const filters=this.el('div',undefined,'discovery-feed-filters');this.collectionJournalType=this.el('select');this.collectionJournalType.setAttribute('aria-label','搜集期刊类别');for(const [id,label]of [['','全部文献'],['journal','仅期刊论文'],['top','已核验顶刊']]){const option=this.el('option',label);option.value=id;this.collectionJournalType.append(option);}this.collectionJournal=this.el('select');this.collectionJournal.setAttribute('aria-label','搜集指定期刊');const any=this.el('option','全部期刊');any.value='';this.collectionJournal.append(any);this.collectionSort=this.el('select');this.collectionSort.setAttribute('aria-label','搜集论文排序');for(const[id,label]of [['date','发表日期'],['citations','引用量'],['impact','影响因子']]){const option=this.el('option',label);option.value=id;this.collectionSort.append(option);}filters.append(this.collectionJournalType,this.collectionJournal,this.collectionSort);destination.root.before(filters);
  for(const field of [this.collectionJournalType,this.collectionJournal,this.collectionSort])field.onchange=()=>{this.collectionFilters={journalOnly:!!this.collectionJournalType.value,topOnly:this.collectionJournalType.value==='top',sourceIDs:this.collectionJournal.value?[this.collectionJournal.value]:[],sort:this.collectionSort.value};if(this.$('search-query').value.trim())this.searchCollection();};
  this.refreshDiscoveryDestinations().catch(error=>this.status(error.message,true));
 },
 createDiscoveryDestination(label='保存论文到') {
  const root=this.el('section',undefined,'discovery-destination'),caption=this.el('span',label,'discovery-destination-label'),select=this.el('select'),project=this.el('select'),add=this.el('button','新建文件夹'),form=this.el('form',undefined,'discovery-folder-create'),name=this.el('input'),create=this.el('button','创建'),cancel=this.el('button','取消'),note=this.el('span','','discovery-destination-note');
  select.setAttribute('aria-label','下载论文的文库文件夹');project.setAttribute('aria-label','关联论文项目');add.type='button';add.className='discovery-folder-add';name.placeholder='文件夹名称';name.setAttribute('aria-label','新文件夹名称');name.required=true;create.type='submit';cancel.type='button';form.hidden=true;note.setAttribute('role','status');form.append(name,create,cancel);root.append(caption,select,add,project,note,form);
  const control={root,select,project,note,form};this.discoveryDestinations||=[];this.discoveryDestinations.push(control);
  select.onchange=async()=>{try{const choice=this.discoveryCollectionRows?.find(row=>String(row.id)===select.value);await this.saveDiscoveryDestination({collectionID:choice?.id||null,libraryID:choice?.libraryID||this.discoveryLibraryID});}catch(error){note.textContent=error.message;}};
  project.onchange=async()=>{try{const linked=this.E.manuscripts.get(project.value);await this.saveDiscoveryDestination({projectID:project.value,collectionID:linked?.paperCollectionID||null});}catch(error){note.textContent=error.message;}};
  add.onclick=()=>{form.hidden=!form.hidden;if(!form.hidden){name.value='';name.focus();}};cancel.onclick=()=>{form.hidden=true;add.focus();};
  form.onsubmit=async event=>{event.preventDefault();if(!name.value.trim()||create.disabled)return;create.disabled=true;try{const folder=await this.E.createDiscoveryCollection(name.value.trim(),{libraryID:this.discoveryLibraryID});await this.saveDiscoveryDestination({collectionID:folder.id,libraryID:folder.libraryID});form.hidden=true;await this.refreshDiscoveryDestinations();select.focus();}catch(error){note.textContent=error.message;}finally{create.disabled=false;}};
  this.renderDiscoveryDestinations();return control;
 },
 renderDiscoveryDestinations() {
  const destination=this.E.store.get().settings.discoveryDestination||{},projects=Object.values(this.E.manuscripts.all());
  for(const control of this.discoveryDestinations||[]){const {select,project,note}=control;select.replaceChildren();const auto=this.el('option','下载时新建“论文搜集”');auto.value='';select.append(auto);for(const row of this.discoveryCollectionRows||[]){const option=this.el('option',row.path||row.name);option.value=row.id;select.append(option);}select.value=String(destination.collectionID||'');project.replaceChildren();const none=this.el('option','不关联写作项目');none.value='';project.append(none);for(const row of projects){const option=this.el('option',row.title);option.value=row.id;project.append(option);}project.value=destination.projectID||'';note.textContent=destination.collectionID?'PDF 与题录保存在所选文件夹':'首次下载会创建文件夹，后续可继续筛选与讨论';}
 },
 async refreshDiscoveryDestinations() {
  if(!this.E.discoveryCollections)return;const result=await this.E.discoveryCollections();if(this.agentDisposed)return;this.discoveryCollectionRows=result.collections||[];this.discoveryLibraryID=result.libraryID;this.renderDiscoveryDestinations();
  for(const rail of this.agentFileRails||[])rail.render();
 },
 async saveDiscoveryDestination(update) {
  const current=this.E.store.get().settings.discoveryDestination||{},next={...current,...update};
  if(next.projectID&&next.collectionID&&this.E.notebook?.ensureProjectCollection)await this.E.notebook.ensureProjectCollection(next.projectID,{collectionID:next.collectionID});
  await this.E.store.update(state=>state.settings.discoveryDestination=next);this.renderDiscoveryDestinations();return next;
 },
 async resolveDiscoveryDestination() {
  if(this.discoveryDestinationTask)return this.discoveryDestinationTask;
  this.discoveryDestinationTask=(async()=>{let target={...(this.E.store.get().settings.discoveryDestination||{})};
   if(!target.collectionID){if(target.projectID&&this.E.notebook?.ensureProjectCollection){const project=await this.E.notebook.ensureProjectCollection(target.projectID,{});target.collectionID=project.collectionID;target.libraryID=project.libraryID;}
    else{const folder=await this.E.createDiscoveryCollection('论文搜集',{libraryID:target.libraryID||this.discoveryLibraryID});target.collectionID=folder.id;target.libraryID=folder.libraryID;}}
   // Revalidate the folder before every acquisition; a deleted folder must
   // never silently fall back to the library root.
   const folders=await this.E.discoveryCollections(),folder=folders.collections.find(row=>String(row.id)===String(target.collectionID));if(!folder)throw Error('所选文件夹已不存在，请重新选择论文保存位置');target.libraryID=folder.libraryID;await this.saveDiscoveryDestination(target);await this.refreshDiscoveryDestinations();return{collectionID:target.collectionID,libraryID:target.libraryID};
  })();try{return await this.discoveryDestinationTask;}finally{this.discoveryDestinationTask=null;}
 },
 async refreshDiscoveryProjectScope() {
  const destination=this.E.store.get().settings.discoveryDestination;if(destination?.projectID&&this.E.notebook?.ensureProjectCollection)await this.E.notebook.ensureProjectCollection(destination.projectID,{collectionID:destination.collectionID});
 },
 renderCollectionHistory(){
  if(!this.collectionSearchHistory)return;this.collectionSearchHistory.replaceChildren();
  for(const entry of this.E.store.get().settings.collectionSearchHistory||[]){const button=this.pptButton(entry.query,()=>{this.$('search-query').value=entry.query;this.$('search-source').value=entry.provider||'';this.searchCollection();},this.collectionSearchHistory);button.title=entry.query;}
  if(!this.collectionSearchHistory.childElementCount)this.collectionSearchHistory.append(this.el('p','暂无搜索记录','muted'));
 },
 async searchCollection(more=false){
  if(this.collectionSearching)return;const query=more?this.collectionSearchState?.query:this.$('search-query').value.trim();if(!query){this.$('search-query').focus();return;}
  this.collectionSearching=true;this.discoveryAbort?.abort();const controller=this.discoveryAbort=new AbortController(),token=this.discoveryToken=(this.discoveryToken||0)+1,button=this.$('search-academic');button.disabled=true;
  const provider=more?this.collectionSearchState.provider:this.$('search-source').value,page=more?(this.collectionSearchState.nextPage||this.collectionSearchState.page+1):1;this.$('view-search').querySelector('.collection-search-history').open=false;
  try{this.status('正在查找可获取全文的文献…');const result=provider==='pubmed'?{records:await this.E.searchAcademic(query,'pubmed'),provider,page:1,hasMore:false}:await this.E.searchPaperPage(query,{provider,page,cursor:more?this.collectionSearchState.nextCursor:undefined,filters:this.collectionFilters||{},limit:20,signal:controller.signal});if(token!==this.discoveryToken)return;
   const identity=r=>String(r.doi||r.url||r.source+':'+r.id).toLowerCase(),known=new Map((more?this.collectionResults||[]:[]).map(r=>[identity(r),r]));for(const record of result.records||[])known.set(identity(record),record);this.collectionResults=[...known.values()];this.collectionSearchState={query,provider:result.provider||provider,page:result.page||page,nextPage:result.nextPage,nextCursor:result.nextCursor,hasMore:result.hasMore===true};
   if(!more){this.collectionChosen=new Set();this.collectionOutcomes=new Map();await this.E.store.update(s=>{const history=s.settings.collectionSearchHistory||[];s.settings.collectionSearchHistory=[{query,provider,at:new Date().toISOString()},...history.filter(entry=>entry.query!==query||entry.provider!==provider)].slice(0,30);});this.renderCollectionHistory();}
   const selected=this.collectionJournal.value,journals=this.agentDiscoveryPresentation.discoveryJournalChoices(this.collectionResults,result.filterOptions?.journals);this.collectionJournal.replaceChildren();const any=this.el('option','全部期刊');any.value='';this.collectionJournal.append(any);for(const row of journals){const option=this.el('option',row.name);option.value=row.id;this.collectionJournal.append(option);}if(selected&&!journals.some(row=>row.id===selected)){const option=this.el('option','所选期刊');option.value=selected;this.collectionJournal.append(option);}this.collectionJournal.value=selected;
   this.renderDiscovery(this.collectionResults,{search:true});this.status(`找到 ${this.collectionResults.length} 篇可获取全文的候选${result.hasMore?' · 下滑继续加载':''}${result.limitations?.length?' · '+result.limitations.join('；'):''}`);
  }catch(error){if(token===this.discoveryToken)this.status(controller.signal.aborted?'已停止检索':error.message,true);}finally{this.collectionSearching=false;button.disabled=false;}
 },
 prepareDiscovery() {
  if(!this.current)this.current=this.E.library.selection()[0]||null;
  this.$('discovery-current').textContent=this.current?'当前论文：'+this.current.title:'选择一篇论文，即可一次收集它引用的文献。';
  this.$('collect-references').textContent=this.current?'收集参考文献':'选择论文并收集';
  if(this.discoveryPaperID!==this.current?.id){if(this.$('search-results').dataset.collectionResults!=='search'){this.discoveryAbort?.abort();this.discoveryToken=(this.discoveryToken||0)+1;this.$('collect-references').disabled=false;this.$('search-results').replaceChildren(this.el('p','输入标题、作者或 DOI 开始检索；也可以展开上方的当前论文搜集引用。','empty'));}this.discoveryPaperID=this.current?.id;}
 },
 async chooseDiscoveryPaper() {
  this.$('discovery-picker')?.remove();const dialog=this.el('dialog');dialog.id='discovery-picker';dialog.className='discovery-picker';dialog.append(this.el('h2','选择正在研究的论文'));const input=this.el('input');input.placeholder='搜索文库中的标题或作者';input.setAttribute('aria-label',input.placeholder);const rows=this.el('div');dialog.append(input,rows);document.body.append(dialog);dialog.showModal();
  this.pptButton('取消',()=>dialog.close(),dialog);dialog.onclose=()=>dialog.remove();
  const papers=await this.E.library.pptCandidates();let composing=false;const render=()=>{rows.replaceChildren();const q=input.value.normalize('NFKC').toLowerCase();for(const p of papers.filter(p=>(p.title+' '+p.authors).normalize('NFKC').toLowerCase().includes(q)).slice(0,80))this.pptButton(p.title,()=>{this.current=p;this.papers=[p];this.selection=null;this.$('selection-box').hidden=true;this.renderPapers();this.loadProject();dialog.close();this.prepareDiscovery();this.loadDiscovery();},rows);if(!rows.children.length)rows.append(this.el('p','文库暂无匹配论文。请先导入论文。'));};
  input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;render();});input.oninput=()=>{if(!composing)render();};render();input.focus();
 },
 async loadDiscovery(kind='references',refresh=false) {
  if(!this.current){await this.chooseDiscoveryPaper();return;}
  const paper=this.current,target=this.$('search-results');this.$('discovery-current').textContent='当前论文：'+paper.title;
  this.discoveryAbort?.abort();const controller=new AbortController();this.discoveryAbort=controller;const token=this.discoveryToken=(this.discoveryToken||0)+1;
  this.$('collect-references').disabled=true;this.discoveryPaperID=paper.id;this.$('view-search').querySelector('.discovery-more').open=false;
  const progress=this.el('p','正在读取参考文献并匹配题录…');progress.setAttribute('role','status');target.replaceChildren(progress);this.pptButton('停止收集',()=>controller.abort(),target);
  try{const result=await this.E.discover(paper,kind,{signal:controller.signal,refresh,onProgress:s=>{if(token===this.discoveryToken)progress.textContent=`正在查找 ${s.done}/${s.total} · 已找到 ${s.found} 条`;}});if(token!==this.discoveryToken)return;
   this.renderDiscovery(result.records);target.prepend(this.el('p',kind==='references'?`已找到 ${result.records.length} 篇 · 复用重复题录 ${result.reused||0} 条 · 保留待核对 ${result.skipped?.length||0} 条${result.cacheHit?' · 已复用缓存':''}`:`${kind==='citations'?'被引文献':'相似论文'} · ${result.records.length} 篇`,'discovery-summary'));
   if(result.skipped?.length||result.notes?.length){const detail=this.el('details');detail.append(this.el('summary','查看检索说明'));for(const note of result.notes||[])detail.append(this.el('p',note));const reasons={};for(const skip of result.skipped||[])reasons[skip.reason]=(reasons[skip.reason]||0)+1;for(const [reason,count]of Object.entries(reasons))detail.append(this.el('p',`${count} 条：${reason}`));target.append(detail);}
   if(kind==='references'&&result.references){const missing=result.references.filter(r=>result.skipped?.some(s=>s.referenceID===r.id));if(missing.length){const section=this.el('section');section.append(this.el('h3','待核对的原始参考文献'));for(const ref of missing){const row=this.el('article',undefined,'card');row.append(this.el('p','['+ref.id+'] '+(ref.quote||ref.title)));if(ref.attachmentID)this.pptButton('定位本文引用',()=>this.E.locateReference(ref.attachmentID,ref),row);section.append(row);}target.append(section);}}
   this.status(kind==='references'?`参考文献已收集：找到 ${result.records.length} 篇，未匹配题录已保留`:'已获取论文关系');
  }catch(e){if(token!==this.discoveryToken)return;target.replaceChildren(this.el('p',controller.signal.aborted?'已停止收集，已匹配的题录缓存保留。':e.message,'warning'));this.pptButton('重试收集',()=>this.loadDiscovery(kind,true),target);}
  finally{if(token===this.discoveryToken)this.$('collect-references').disabled=false;if(this.discoveryAbort===controller)this.discoveryAbort=null;}
 },
 renderDiscovery(records,{search=false}={}) {
  const target=this.$('search-results');target.replaceChildren();target.dataset.collectionResults=search?'search':'references';
  if(!records.length){target.append(this.el('p','暂未找到已匹配文献；原始参考文献仍保留在下方。','empty'));return;}
  const chosen=search?(this.collectionChosen||=new Set()):new Set(),outcomes=search?(this.collectionOutcomes||=new Map()):new Map(),bar=this.el('div',undefined,'discovery-actions'),list=this.el('div'),summary=this.el('span'),all=this.el('input'),allLabel=this.el('label','全选当前结果'),source=this.el('select'),filter=this.el('details'),blacklist=this.el('textarea');
  all.type='checkbox';allLabel.prepend(all);allLabel.className='compact-check';source.setAttribute('aria-label','来源筛选');
  for(const value of ['',...new Set(records.map(r=>r.source).filter(Boolean))]){const o=this.el('option',value||'全部来源');o.value=value;source.append(o);}
  filter.append(this.el('summary','筛选'));blacklist.rows=2;blacklist.placeholder='可选：不获取的期刊，每行一个完整名称';blacklist.setAttribute('aria-label',blacklist.placeholder);blacklist.value=this.E.store.get().settings.journalBlacklist||'';filter.append(blacklist);
  let visible=[],busy=false;const normalized=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
  const update=()=>{summary.textContent=`已选 ${chosen.size} / ${visible.length} 篇`;all.checked=!!visible.length&&visible.every(r=>chosen.has(r));all.indeterminate=visible.some(r=>chosen.has(r))&&!all.checked;download.disabled=busy||!chosen.size;metadata.disabled=busy||!chosen.size;};
  const batch=async pdf=>{if(busy)return;const owner=this.agentData?.activeSessionID;busy=true;update();let succeeded=0,reused=0,failed=0;const todo=[...chosen];try{const destination=await this.resolveDiscoveryDestination();for(const [i,r]of todo.entries()){summary.textContent=`${pdf?'获取附件':'保存题录'} ${i+1}/${todo.length} · 失败 ${failed}`;try{const result=pdf?await this.E.obtainPaper(r,{...destination,open:false}):await this.E.importAcademic(r,{...destination,select:false});outcomes.set(r,{result,message:pdf?'已保存至所选文件夹，点击打开 PDF':'题录与摘要已保存至所选文件夹'});if(pdf)await this.linkDiscoveryConversationFile(result,owner);if(result.reused||result.existing)reused++;else succeeded++;}catch(e){failed++;outcomes.set(r,{message:e.message,error:true});}}await this.refreshDiscoveryProjectScope();}catch(error){this.status(error.message,true);}finally{busy=false;render();summary.textContent=`新增 ${succeeded} · 复用 ${reused} · 失败 ${failed}`;}};
  bar.append(allLabel,source,filter,summary);const download=this.pptButton('获取选中附件',()=>batch(true),bar,'primary'),metadata=this.pptButton('只保存题录与摘要',()=>batch(false),bar);target.append(bar,list);list.tabIndex=0;list.setAttribute('aria-label','文献候选列表，Ctrl+A 全选当前结果');
  list.onkeydown=e=>{if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&!e.target.matches('input,textarea,select')){e.preventDefault();visible.forEach(r=>chosen.add(r));render();}};
  all.onchange=()=>{for(const r of visible)if(all.checked)chosen.add(r);else chosen.delete(r);render();};source.onchange=()=>{chosen.clear();render();};
  blacklist.onchange=async()=>{await this.E.store.update(s=>s.settings.journalBlacklist=blacklist.value);chosen.clear();render();};
  const render=()=>{list.replaceChildren();const blocked=new Set(blacklist.value.split(/\r?\n/).map(normalized).filter(Boolean));visible=records.filter(r=>this.agentDiscoveryPresentation?.discoveryPDFCandidate(r)&&!outcomes.get(r)?.error&&(!source.value||r.source===source.value)&&!blocked.has(normalized(r.journal)));
   for(const r of visible){const card=this.el('article',undefined,'card discovery-paper'),title=this.el('div',undefined,'discovery-title'),check=this.el('input');check.type='checkbox';check.checked=chosen.has(r);check.setAttribute('aria-label','选择论文 '+r.title);check.onchange=()=>{if(check.checked)chosen.add(r);else chosen.delete(r);card.classList.toggle('selected',check.checked);update();};const titleButton=this.el('button',r.title,'discovery-collection-title');titleButton.type='button';title.append(check,titleButton);card.append(title,this.el('small',[r.date,r.journal||r.source,this.agentDiscoveryPresentation.discoveryMetricLabel(r)?.text].filter(Boolean).join(' · ')));card.classList.toggle('selected',chosen.has(r));
    const screening=search?this.E.screenPaper(r,this.$('search-query').value):null;if(screening?.reason||r.reason)card.append(this.el('p',screening?.reason||r.reason,'muted'));if(r.retracted)card.append(this.el('p','已标记撤稿；默认不获取附件，可查看原始来源。','warning'));
    const state=this.el('p',outcomes.get(r)?.message||'',outcomes.get(r)?.error?'warning':'muted');state.setAttribute('role','status');card.append(state);
    const open=async()=>{if(busy||outcomes.get(r)?.pending)return;const owner=this.agentData?.activeSessionID,saved=outcomes.get(r)?.result;if(saved?.attachmentID||r.attachmentID){const attachmentID=saved?.attachmentID||r.attachmentID;await this.linkDiscoveryConversationFile({attachmentID},owner);await this.E.library.openSource({attachmentID});return;}outcomes.set(r,{pending:true});titleButton.disabled=true;try{state.textContent='正在下载 PDF 到所选文件夹…';const destination=await this.resolveDiscoveryDestination(),result=await this.E.obtainPaper(r,{...destination,open:false,onProgress:progress=>state.textContent=progress.text});outcomes.set(r,{result,message:'已保存至所选文件夹，点击打开 PDF'});await this.linkDiscoveryConversationFile(result,owner);state.textContent=outcomes.get(r).message;openButton.textContent='打开 PDF';if(result.path)state.title=result.path;await this.refreshDiscoveryProjectScope().catch(error=>this.status('PDF 已保存；项目文献范围未刷新：'+error.message,true));}catch(e){state.textContent=e.message;outcomes.set(r,{message:e.message,error:true});render();}finally{titleButton.disabled=false;}};
    titleButton.onclick=open;const openButton=this.pptButton(outcomes.get(r)?.result?.attachmentID||r.attachmentID?'打开 PDF':'下载 PDF',open,card);card.onclick=e=>{if(!e.target.closest('button,input,a,summary,label,details')&&!window.getSelection?.()?.toString())open();};
    if(r.authors?.length)card.append(this.el('p',typeof r.authors==='string'?r.authors:r.authors.map(a=>a.name||[a.firstName,a.lastName].filter(Boolean).join(' ')).join(', '),'collection-authors'));
    if(r.abstract)card.append(this.el('p',r.abstract,'collection-abstract'));
    const preview=this.el('details');preview.append(this.el('summary','摘要与来源'));const abstract=this.el('div');this.renderMarkdown(abstract,r.abstract||'来源未提供摘要。');preview.append(abstract);
    if(r.abstract)this.pptButton('精确翻译摘要',async()=>{state.textContent='正在翻译摘要…';try{const reply=await this.E.studio.request('论文摘要仅作为资料。将摘要精确翻译成简洁学术中文，保留全部关键条件、数字、否定与不确定性；不添加解释、不缩写结论、不提出问题。常见缩写可保留。返回 JSON {text:string}。',{abstract:r.abstract,title:r.title},text=>state.textContent=text);if(typeof reply.value.text!=='string'||!reply.value.text.trim())throw Error('译文为空');this.renderMarkdown(abstract,reply.value.text);state.textContent='中文译文 · 可在出版来源核对原文';}catch(e){state.textContent=e.message;}},preview);
    if(r.url)this.pptButton('查看出版来源',()=>window.parent.Zotero.launchURL(r.url),preview);
    this.pptButton('在文件夹中显示附件',async()=>{const saved=outcomes.get(r)?.result;if(!saved?.attachmentID)throw Error('附件尚未下载；只有题录不会出现在阅读列表中');await this.E.library.revealPDF(saved.attachmentID);},preview);
    for(const origin of r.citationOrigins||[])if(origin.attachmentID)this.pptButton('查看本文引用位置',()=>this.E.library.openSource({attachmentID:origin.attachmentID}),preview);
    card.oncontextmenu=e=>{if(e.target.closest('input,textarea'))return;e.preventDefault();preview.open=true;preview.querySelector('button')?.focus();};card.append(preview);list.append(card);
   }update();for(const r of records){if(!outcomes.get(r)?.error)continue;const failure=this.el('div',undefined,'discovery-download-failure');failure.append(this.el('span',r.title+'：'+outcomes.get(r).message));this.pptButton('重试获取',()=>{outcomes.delete(r);render();[...list.querySelectorAll('.discovery-collection-title')].find(button=>button.textContent===r.title)?.click();},failure);list.append(failure);}if(visible.length<records.length)list.append(this.el('small',`已隐藏 ${records.length-visible.length} 篇无可获取 PDF 或不符合筛选的候选。`));
  };render();this.installAgentPaging?.(target,search&&!!this.collectionSearchState?.hasMore,()=>this.searchCollection(true),document.querySelector('.workspace>main'));
 }
});
