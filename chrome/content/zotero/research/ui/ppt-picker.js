/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 async pptChoosePapers(body){
  const box=this.el('dialog');box.id='ppt-paper-picker';box.className='paper-picker';box.onclose=()=>box.remove();
  document.body.append(box);box.showModal();box.append(this.el('h3','从文库选择论文'));
  const status=this.el('p','正在读取文库…'),search=this.pptField('搜索标题、作者或年份','',box),rows=this.el('div'),chosen=new Map(this.pptDraft.papers.map(p=>[p.id,p]));
  search.placeholder='输入关键词；可勾选多篇';rows.style.cssText='max-height:280px;overflow:auto;';box.append(status,rows);
  let papers=[];
  const render=()=>{rows.replaceChildren();const q=search.value.trim().toLocaleLowerCase(),matches=papers.filter(p=>[p.title,p.authors,p.year].join(' ').toLocaleLowerCase().includes(q));
   status.textContent=`已选 ${chosen.size} 篇 · 找到 ${matches.length} 篇`;
   for(const p of matches.slice(0,100)){const label=this.el('label'),check=this.el('input');check.type='checkbox';check.checked=chosen.has(p.id);check.dataset.paperId=p.id;label.className='picker-row';label.classList.toggle('selected',check.checked);
    label.append(check,this.el('span',p.title+' · '+(p.year||'日期未知')));rows.append(label);
    check.onchange=()=>{if(check.checked)chosen.set(p.id,p);else chosen.delete(p.id);label.classList.toggle('selected',check.checked);status.textContent=`已选 ${chosen.size} 篇 · 找到 ${matches.length} 篇`;};}
   if(matches.length>100)rows.append(this.el('p','显示前 100 篇，请输入关键词缩小范围。'));
  };
  let composing=false;search.oncompositionstart=()=>composing=true;search.oncompositionend=()=>{composing=false;render();};search.oninput=()=>{if(!composing)render();};
  const selectionBar=this.el('div',undefined,'selection-toolbar'),actions=this.el('div',undefined,'picker-actions');rows.before(selectionBar);box.append(actions);rows.className='picker-rows';rows.tabIndex=0;
  const selectAll=()=>{const q=search.value.trim().toLocaleLowerCase();for(const p of papers.filter(p=>[p.title,p.authors,p.year].join(' ').toLocaleLowerCase().includes(q)).slice(0,100))chosen.set(p.id,p);render();};
  this.pptButton('全选当前结果',selectAll,selectionBar);this.pptButton('取消选择',()=>{chosen.clear();render();},selectionBar);
  rows.onkeydown=e=>{if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selectAll();}};
  this.pptButton('确定使用这些论文',async()=>{
   if(!chosen.size){status.textContent='请至少勾选一篇论文';return;}
   if(chosen.size>12){status.textContent='一次最多选择 12 篇论文，请分批汇报';return;}
   await this.pptPatch(d=>{d.papers=[...chosen.values()];d.scope={mode:'all'};d.materialsReady=false;d.outlineApproved=false;d.templateID=d.papers.length>1?'review':'single';d.outline=this.E.studio.model.initialOutline(d.templateID);d.step=0;});box.close();this.renderPPT();
  },actions,'primary');
  this.pptButton('取消',()=>box.close(),actions);
  try{papers=await this.E.library.readingCandidates();render();search.focus();}catch(e){status.textContent='文库读取失败：'+e.message;}
 }
});
