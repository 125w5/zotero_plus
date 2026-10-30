/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {placedBlock,duplicateLabels,placeholderBlock} from './assembly-placement.mjs';
// Source relationships, not an inferred knowledge graph. No prose is generated.
export function evidenceUsage(project) {
 const rows=new Map(project.materials.map(material=>[material.id,{material,uses:[]}]));
 for(const block of project.blocks)for(const link of block.materials||[]){
  const row=rows.get(link.id);if(row)row.uses.push({block,link,section:project.sections.find(s=>s.id===block.sectionID)});
 }
 return [...rows.values()];
}
export function moveSection(project,id,target,after=false){
 const from=project.sections.findIndex(s=>s.id===id);if(from<0||id===target)return false;
 const section=project.sections.splice(from,1)[0],to=project.sections.findIndex(s=>s.id===target);
 if(to<0){project.sections.splice(from,0,section);return false;}project.sections.splice(to+(after?1:0),0,section);return true;
}
export function moveBlockToSection(project,id,sectionID){
 const block=project.blocks.find(b=>b.id===id);if(!block||!project.sections.some(s=>s.id===sectionID))return false;
 block.sectionID=sectionID;return true;
}
export function outlineLabel(project,block,titleFor=material=>material.title){
 const material=(block.materials||[]).map(link=>project.materials.find(value=>value.id===link.id)).find(Boolean),source=material&&titleFor(material);
 return String(block.title||block.text||block.table?.caption||source||({formula:'公式',table:'表格',image:'图片'})[block.type]||'空白段落').replace(/\s+/g,' ').slice(0,70);
}
export function updateNavigationLabels(U){for(const row of U.$('library').querySelectorAll('[data-outline-block]')){const block=U.p.blocks.find(value=>value.id===row.dataset.outlineBlock);if(block)row.querySelector('.outline-label').textContent=outlineLabel(U.p,block,material=>U.A.titleFor(material));}}
export function renderAssemblyNavigation(U,{el,button,snapshot,changed,persist,selectBlock,attachMaterial,materialDetails,openMaterial,modal,field,verifyBlock}){
 const host=U.$('library');host.querySelector('#material-results')?._endOff?.();host.querySelector('#material-search-history')?._historyOff?.();host.replaceChildren();
 const choose=(block,event)=>{
  let ids=new Set(event.ctrlKey||event.metaKey?U.p.ui.selectedBlocks||[]:[]);
  if(event.shiftKey&&U.p.ui.blockID){const ordered=U.p.sections.flatMap(section=>U.p.blocks.filter(value=>value.sectionID===section.id)),start=ordered.findIndex(value=>value.id===U.p.ui.blockID),end=ordered.indexOf(block);if(start>=0&&end>=0)for(const value of ordered.slice(Math.min(start,end),Math.max(start,end)+1))ids.add(value.id);}
  else if(ids.has(block.id))ids.delete(block.id);else ids.add(block.id);
  U.p.ui.selectedBlocks=[...ids];selectBlock(block.id,{scroll:true,preserveSelection:true});
 };
 const label=b=>outlineLabel(U.p,b,material=>U.A.titleFor(material));
 const menu=(event,actions)=>{
  event.preventDefault();event.stopPropagation();U.$('navigation-context')?.remove();const box=el('div',undefined,'assembly-context');box.id='navigation-context';box.setAttribute('role','menu');
  box.style.left=Math.max(4,Math.min(event.clientX,innerWidth-240))+'px';box.style.top=Math.max(4,Math.min(event.clientY,innerHeight-actions.length*32-16))+'px';document.body.append(box);
  for(const [name,fn]of actions)button(name,()=>{box.remove();return fn();},box).setAttribute('role','menuitem');box.querySelector('button')?.focus();
  const close=e=>{if(!box.contains(e.target)){box.remove();document.removeEventListener('pointerdown',close);}};setTimeout(()=>document.addEventListener('pointerdown',close),0);box.onkeydown=e=>{if(e.key==='Escape'){box.remove();document.removeEventListener('pointerdown',close);}};
 };
 const dragTarget=(node,accept,drop)=>{node.ondragover=e=>{if(!accept(e))return;e.preventDefault();node.dataset.drop='true';};node.ondragleave=()=>delete node.dataset.drop;node.ondrop=e=>{delete node.dataset.drop;if(!accept(e))return;e.preventDefault();e.stopPropagation();drop(e);};};
 const summary=el('div',undefined,'navigation-summary');host.append(summary);

 if(U.p.ui.left==='structure'){
  summary.append(el('span',`${U.p.sections.length} 个章节 · ${U.p.blocks.length} 个模块`));
  button('＋',()=>{const box=modal('新建章节'),name=field(box,'章节名称','',()=>{});name.focus();button('创建',()=>{if(!name.value.trim())return;snapshot();U.p.sections.push({id:U.M.id('section'),title:name.value.trim(),conclusion:''});U.$('popover').close();changed({editor:true});},box,'primary');},summary,'navigation-add').title='新建章节';
  for(const section of U.p.sections){
   const group=el('section',undefined,'outline-section');group.dataset.section=section.id;group.classList.toggle('active',section.id===U.p.ui.sectionID);if(section.parentID)group.style.marginLeft='12px';
   const heading=el('div',undefined,'outline-section-heading'),name=button(section.title,()=>{U.p.ui.sectionID=section.id;U.p.ui.left='structure';persist();U.renderLibrary();U.$('canvas').querySelector(`[data-section="${section.id}"]`)?.scrollIntoView({block:'start'});},heading,'outline-section-name');
   name.draggable=true;name.title='拖动章节排序；右键重命名';name.ondragstart=e=>e.dataTransfer.setData('application/x-manuscript-section',section.id);
   const blocks=U.p.blocks.filter(b=>b.sectionID===section.id),needs=blocks.filter(b=>b.claim&&b.review!=='verified');heading.append(el('small',blocks.length+' 项'+(needs.length?' · '+needs.length+' 待核对':'')));group.append(heading);
   group.oncontextmenu=e=>menu(e,[['重命名章节',()=>{const box=modal('重命名章节'),input=field(box,'名称',section.title,()=>{});button('保存',()=>{if(!input.value.trim())return;snapshot();section.title=input.value.trim();U.$('popover').close();changed({editor:true});},box);}],['在章节末尾添加正文',()=>{snapshot();const block=U.M.block('paragraph',section.id,{emptyStarter:true});U.p.blocks.push(block);U.p.ui.blockID=block.id;changed({editor:true});selectBlock(block.id,{scroll:true});}]]);
   dragTarget(group,e=>['application/x-manuscript-section','application/x-manuscript-block','application/x-manuscript-material'].some(t=>e.dataTransfer.types.includes(t)),e=>{
    snapshot();const sid=e.dataTransfer.getData('application/x-manuscript-section'),bid=e.dataTransfer.getData('application/x-manuscript-block'),mid=e.dataTransfer.getData('application/x-manuscript-material');
    if(sid)moveSection(U.p,sid,section.id,e.clientY>group.getBoundingClientRect().top+group.offsetHeight/2);
    else if(bid)moveBlockToSection(U.p,bid,section.id);
    else if(mid){const existing=placedBlock(U.p,section.id,{material:U.p.materials.find(row=>row.id===mid),materialID:mid});if(existing){U.undo.pop();U.p.ui.blockID=existing.id;}else{const block=U.M.block('paragraph',section.id,{assembly:true});attachMaterial(block,mid);U.p.blocks.push(block);U.p.ui.blockID=block.id;}}
    changed({editor:true});
   });
   // Rows that repeat a label inside the chapter carry ×n, so leftover
   // duplicates from earlier inserts are easy to find and remove.
   const repeated=duplicateLabels(blocks,label);
   for(const block of blocks){const row=button('',event=>choose(block,event),group,'outline-content');row.dataset.outlineBlock=block.id;row.draggable=true;row.title='定位正文；Ctrl 多选、Shift 连选；拖动调整顺序或移到其他章节';
    row.append(el('span',({formula:'∑',table:'▦',image:'▧',heading:'H',citation:'❞'})[block.type]||'¶','outline-type'),el('span',label(block),'outline-label'),el('small',[repeated.has(block.id)?'×'+repeated.get(block.id):'',block.materials.length?String(block.materials.length):''].filter(Boolean).join(' ')));if(repeated.has(block.id)){row.dataset.duplicate=String(repeated.get(block.id));row.title='本章有 '+repeated.get(block.id)+' 个同名模块，可保留一个并删除其余；'+row.title;}if(placeholderBlock(block))row.dataset.placeholder='true';row.classList.toggle('selected',(U.p.ui.selectedBlocks||[U.p.ui.blockID]).includes(block.id));
    row.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('application/x-manuscript-block',block.id);};
    dragTarget(row,e=>e.dataTransfer.types.includes('application/x-manuscript-block'),e=>{const id=e.dataTransfer.getData('application/x-manuscript-block');if(id===block.id)return;snapshot();const index=U.p.blocks.findIndex(b=>b.id===id);if(index<0)return;const moving=U.p.blocks.splice(index,1)[0],target=U.p.blocks.indexOf(block);moving.sectionID=section.id;U.p.blocks.splice(target+(e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2?1:0),0,moving);changed({editor:true});});
   }host.append(group);
  }
 }else{
  const all=evidenceUsage(U.p),filter=U.p.ui.evidenceFilter||'used';summary.append(el('span','来源与使用位置'));
  const choice=el('select');choice.setAttribute('aria-label','证据显示范围');for(const [value,title]of [['used','已引用'],['review','待核对'],['unused','未引用'],['all','全部']]){const option=el('option',title);option.value=value;choice.append(option);}choice.value=filter;choice.onchange=()=>{U.p.ui.evidenceFilter=choice.value;persist();U.renderLibrary();};summary.append(choice);
  const rows=all.filter(r=>filter==='all'?true:filter==='unused'?!r.uses.length:filter==='review'?r.uses.some(u=>u.block.review!=='verified'):r.uses.length>0);
  for(const {material,uses}of rows){
   const card=el('article',undefined,'evidence-source-card');card.dataset.material=material.id;card.draggable=true;card.tabIndex=0;
   const header=el('div',undefined,'evidence-source-heading'),name=button(U.A.titleFor(material),()=>materialDetails(material),header,'evidence-source-name');name.title=U.A.summaryFor(material);header.append(el('small',uses.length+' 处引用'));card.append(header);
   const source=U.E.materialSourceInfo?.(material)||{},meta=[source.title,material.anchor?.pageIndex!=null?'第 '+(material.anchor.pageIndex+1)+' 页':'',source.metric?.impact_factor!=null?source.impact:''].filter(Boolean);if(meta.length){const metadata=el('p',meta.join(' · '),'evidence-source-meta');metadata.title=source.impactDetail||source.impact||'';card.append(metadata);}
   card.ondragstart=e=>{if(e.target.closest('[data-outline-block]'))return;e.dataTransfer.setData('application/x-manuscript-material',material.id);};card.ondblclick=e=>{if(!e.target.closest('[data-outline-block]'))openMaterial(material);};
   dragTarget(card,e=>e.dataTransfer.types.includes('application/x-manuscript-block'),e=>{const b=U.p.blocks.find(b=>b.id===e.dataTransfer.getData('application/x-manuscript-block'));if(!b)return;snapshot();attachMaterial(b,material.id);changed({editor:true});});
   for(const {block,section}of uses){const row=button('',()=>selectBlock(block.id,{scroll:true}),card,'evidence-use');row.dataset.outlineBlock=block.id;row.append(el('span',section?.title||'章节','evidence-use-section'),el('span',label(block),'outline-label'),el('small',({verified:'已核对',conflict:'冲突',stale:'来源更新'})[block.review]||'待核对','evidence-state'));row.dataset.review=block.review;row.draggable=true;row.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('application/x-manuscript-block',block.id);};row.oncontextmenu=e=>menu(e,[['对照来源核验',()=>verifyBlock(block)],['解除这处来源关联',()=>{snapshot();block.materials=block.materials.filter(x=>x.id!==material.id);block.review='missing';changed({editor:true});}]]);}
   host.append(card);
  }
  if(!rows.length)host.append(el('p',filter==='unused'?'当前素材均已有使用位置。':filter==='review'?'当前没有待核对的来源。':'将素材拖入正文后，这里可核对每处引用。','empty'));
 }
}
