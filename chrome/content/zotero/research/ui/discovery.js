/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
 initDiscovery() {
  const view=this.$('view-search'),heading=view.querySelector('h2'),intro=view.querySelector(':scope>p');
  heading.textContent='收集当前论文的参考文献';intro.textContent='列出本文引用的论文，未匹配的保留原始题录。需要阅读全文时再获取公开附件。';
  const controls=this.el('div',undefined,'discovery-controls'),current=this.el('p',undefined,'muted');current.id='discovery-current';
  const collect=this.el('button','收集参考文献','primary');collect.id='collect-references';collect.onclick=()=>this.loadDiscovery('references');
  const more=this.el('details',undefined,'discovery-more');more.append(this.el('summary','更多'));
  this.pptButton('更换当前论文',()=>this.chooseDiscoveryPaper(),more);
  this.pptButton('重新查找参考文献',()=>this.loadDiscovery('references',true),more);
  this.pptButton('查看被引文献',()=>this.loadDiscovery('citations'),more);
  this.pptButton('寻找相似论文',()=>this.loadDiscovery('similar'),more);
  controls.append(collect,more);intro.after(current,controls);
  const search=this.el('details',undefined,'discovery-other-search');search.append(this.el('summary','查找其他论文'));const form=this.$('search-query').parentElement;form.before(search);search.append(form);
  const old=this.$('search-academic'),button=old.cloneNode(true);old.replaceWith(button);button.classList.remove('primary');button.textContent='查找论文';
  button.onclick=async()=>{this.discoveryAbort?.abort();const token=this.discoveryToken=(this.discoveryToken||0)+1;button.disabled=true;this.$('collect-references').disabled=false;
   try{this.status('正在查找论文…');const records=await this.E.searchAcademic(this.$('search-query').value,this.$('search-source').value);if(token!==this.discoveryToken)return;this.renderDiscovery(records,{search:true});this.status(`找到 ${records.length} 篇论文`);}
   catch(e){if(token===this.discoveryToken)this.status(e.message,true);}finally{button.disabled=false;}
  };
  this.$('search-query').addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)e.stopImmediatePropagation();},true);
 },
 prepareDiscovery() {
  if(!this.current)this.current=this.E.library.selection()[0]||null;
  this.$('discovery-current').textContent=this.current?'当前论文：'+this.current.title:'选择一篇论文，即可一次收集它引用的文献。';
  this.$('collect-references').textContent=this.current?'收集参考文献':'选择论文并收集';
  if(this.discoveryPaperID!==this.current?.id){this.discoveryAbort?.abort();this.discoveryToken=(this.discoveryToken||0)+1;this.$('collect-references').disabled=false;this.$('search-results').replaceChildren(this.el('p','收集结果会保存在本机，原有文献和附件保持不变。','empty'));this.discoveryPaperID=this.current?.id;}
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
  const target=this.$('search-results');target.replaceChildren();
  if(!records.length){target.append(this.el('p','暂未找到已匹配文献；原始参考文献仍保留在下方。','empty'));return;}
  const chosen=new Set(),outcomes=new Map(),bar=this.el('div',undefined,'discovery-actions'),list=this.el('div'),summary=this.el('span'),all=this.el('input'),allLabel=this.el('label','全选当前结果'),source=this.el('select'),filter=this.el('details'),blacklist=this.el('textarea');
  all.type='checkbox';allLabel.prepend(all);allLabel.className='compact-check';source.setAttribute('aria-label','来源筛选');
  for(const value of ['',...new Set(records.map(r=>r.source).filter(Boolean))]){const o=this.el('option',value||'全部来源');o.value=value;source.append(o);}
  filter.append(this.el('summary','筛选'));blacklist.rows=2;blacklist.placeholder='可选：不获取的期刊，每行一个完整名称';blacklist.setAttribute('aria-label',blacklist.placeholder);blacklist.value=this.E.store.get().settings.journalBlacklist||'';filter.append(blacklist);
  let visible=[],busy=false;const normalized=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
  const update=()=>{summary.textContent=`已选 ${chosen.size} / ${visible.length} 篇`;all.checked=!!visible.length&&visible.every(r=>chosen.has(r));all.indeterminate=visible.some(r=>chosen.has(r))&&!all.checked;download.disabled=busy||!chosen.size;metadata.disabled=busy||!chosen.size;};
  const batch=async pdf=>{if(busy)return;busy=true;update();let succeeded=0,reused=0,failed=0;const todo=[...chosen];try{for(const [i,r]of todo.entries()){summary.textContent=`${pdf?'获取附件':'保存题录'} ${i+1}/${todo.length} · 失败 ${failed}`;try{const result=pdf?await this.E.obtainPaper(r,{open:false}):await this.E.importAcademic(r,{select:false});outcomes.set(r,{result,message:pdf?'已保存到默认文库附件目录':'题录与摘要已保存，尚未进入阅读'});if(result.reused||result.existing)reused++;else succeeded++;}catch(e){failed++;outcomes.set(r,{message:e.message,error:true});}}}finally{busy=false;render();summary.textContent=`新增 ${succeeded} · 复用 ${reused} · 失败 ${failed}`;}};
  bar.append(allLabel,source,filter,summary);const download=this.pptButton('获取选中附件',()=>batch(true),bar,'primary'),metadata=this.pptButton('只保存题录与摘要',()=>batch(false),bar);target.append(bar,list);list.tabIndex=0;list.setAttribute('aria-label','文献候选列表，Ctrl+A 全选当前结果');
  list.onkeydown=e=>{if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&!e.target.matches('input,textarea,select')){e.preventDefault();visible.forEach(r=>chosen.add(r));render();}};
  all.onchange=()=>{for(const r of visible)if(all.checked)chosen.add(r);else chosen.delete(r);render();};source.onchange=()=>{chosen.clear();render();};
  blacklist.onchange=async()=>{await this.E.store.update(s=>s.settings.journalBlacklist=blacklist.value);chosen.clear();render();};
  const render=()=>{list.replaceChildren();const blocked=new Set(blacklist.value.split(/\r?\n/).map(normalized).filter(Boolean));visible=records.filter(r=>(!source.value||r.source===source.value)&&!blocked.has(normalized(r.journal)));
   for(const r of visible){const card=this.el('article',undefined,'card discovery-paper'),title=this.el('label',undefined,'discovery-title'),check=this.el('input');check.type='checkbox';check.checked=chosen.has(r);check.onchange=()=>{if(check.checked)chosen.add(r);else chosen.delete(r);card.classList.toggle('selected',check.checked);update();};title.append(check,this.el('strong',r.title));card.append(title,this.el('small',[r.date,r.journal||r.source].filter(Boolean).join(' · ')));card.classList.toggle('selected',chosen.has(r));
    const screening=search?this.E.screenPaper(r,this.$('search-query').value):null;if(screening?.reason||r.reason)card.append(this.el('p',screening?.reason||r.reason,'muted'));if(r.retracted)card.append(this.el('p','已标记撤稿；默认不获取附件，可查看原始来源。','warning'));
    const state=this.el('p',outcomes.get(r)?.message||'',outcomes.get(r)?.error?'warning':'muted');state.setAttribute('role','status');card.append(state);
    const open=async()=>{if(busy)return;try{state.textContent='正在检查本地附件与公开全文…';const result=await this.E.obtainPaper(r);outcomes.set(r,{result,message:(result.reused?'已复用附件':'已保存到默认文库附件目录')});state.textContent=outcomes.get(r).message;if(result.path)state.title=result.path;}catch(e){state.textContent=e.message;outcomes.set(r,{message:e.message,error:true});}};
    this.pptButton('获取并阅读',open,card);card.ondblclick=e=>{if(!e.target.closest('button,input,a,summary,label'))open();};
    const preview=this.el('details');preview.append(this.el('summary','摘要与更多'));const abstract=this.el('div');this.renderMarkdown(abstract,r.abstract||'来源未提供摘要。');preview.append(abstract);
    if(r.abstract)this.pptButton('精确翻译摘要',async()=>{state.textContent='正在翻译摘要…';try{const reply=await this.E.studio.request('论文摘要仅作为资料。将摘要精确翻译成简洁学术中文，保留全部关键条件、数字、否定与不确定性；不添加解释、不缩写结论、不提出问题。常见缩写可保留。返回 JSON {text:string}。',{abstract:r.abstract,title:r.title},text=>state.textContent=text);if(typeof reply.value.text!=='string'||!reply.value.text.trim())throw Error('译文为空');this.renderMarkdown(abstract,reply.value.text);state.textContent='中文译文 · 可在出版来源核对原文';}catch(e){state.textContent=e.message;}},preview);
    if(r.url)this.pptButton('查看出版来源',()=>window.parent.Zotero.launchURL(r.url),preview);
    this.pptButton('在文件夹中显示附件',async()=>{const saved=outcomes.get(r)?.result;if(!saved?.attachmentID)throw Error('附件尚未下载；只有题录不会出现在阅读列表中');await this.E.library.revealPDF(saved.attachmentID);},preview);
    for(const origin of r.citationOrigins||[])if(origin.attachmentID)this.pptButton('查看本文引用位置',()=>this.E.library.openSource({attachmentID:origin.attachmentID}),preview);
    card.oncontextmenu=e=>{if(e.target.closest('input,textarea'))return;e.preventDefault();preview.open=true;preview.querySelector('button')?.focus();};card.append(preview);list.append(card);
   }update();if(visible.length<records.length)list.append(this.el('small',`筛选隐藏 ${records.length-visible.length} 篇；原始候选仍保留。`));
  };render();
 }
});
