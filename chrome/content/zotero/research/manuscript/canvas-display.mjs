/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,button,persist,status,snapshot,changed,openMaterial,materialDetails} from './main.mjs';
import {assemblyCanvasMode} from '../shared/assembly-direction.mjs';
import {placeholderBlock,placeholderCard} from './assembly-placement.mjs';
import {materialAnchors} from '../shared/material-clues.mjs';
import {THREAD_LABELS} from '../shared/research-thread.mjs';

// At stages 3-4 'read' shows the chapter read once a read canvas renderer is
// installed (U.renderChapterReads); otherwise the user's own text is shown.
// The legacy writing digest is its own mode while its flag is set and saved
// digests exist; it offers its own way back (renderWritingDigest).
const legacyDigest=project=>project?.ui?.canvasDisplay==='digest'&&(!(project.ui.assemblyFlowVersion>=2)||Object.keys(project.writingFrameworks||{}).length>0);
export const canvasDisplayMode = project => legacyDigest(project)?'digest':project?.ui?.assemblyFlowVersion>=2?assemblyCanvasMode(project,{readView:project===U.p&&typeof U.renderChapterReads==='function'}):project?.ui?.canvasDisplay==='article'?'article':'materials';
export function closeWritingDigest(){if(U.p.ui.canvasDisplay!=='digest')return;U.p.ui.canvasDisplay=U.p.ui.writingPlanPreviousDisplay&&U.p.ui.writingPlanPreviousDisplay!=='digest'?U.p.ui.writingPlanPreviousDisplay:'materials';delete U.p.ui.writingPlanPreviousDisplay;U.p.ui.writingPlanOpen=false;persist();U.renderEditor?.();U.selectionAssistant?.sync();}

export function syncCanvasDisplay() {
 const mode=canvasDisplayMode(U.p);document.body.dataset.canvasDisplay=mode;
 for(const control of document.querySelectorAll('#canvas-display-mode button')) {
  const active=control.dataset.canvasDisplay===mode;control.setAttribute('aria-pressed',String(active));control.tabIndex=active?0:-1;
 }
 const compact=$('canvas-display-select');if(compact)compact.value=mode;
 U.selectionAssistant?.sync();
 return mode;
}

// Every block in the outline stays visible. A card without the user's text is
// marked as a placeholder; its material, source and actions are drawn by
// renderBlockPlaceholder.
export function applyCanvasBlockDisplay(node,block) {
 node.hidden=false;
 const pending=canvasDisplayMode(U.p)==='article'&&placeholderBlock(block)&&block.materials?.length>0;
 node.classList.toggle('block-placeholder-card',pending);if(pending)node.dataset.placeholder='true';else delete node.dataset.placeholder;
}
const placeholderOptions=()=>({titleFor:row=>U.A.titleFor?.(row)||row.title||'素材',summaryFor:row=>U.A.summaryFor?.(row)||row.summary||'',referenceFor:row=>{const anchor=materialAnchors(row).find(item=>Number.isInteger(item?.pageIndex))||row.anchor;return Number.isInteger(anchor?.pageIndex)?'PDF 第 '+(anchor.pageIndex+1)+' 页':'';}});
// The block's linked material (title, source page, 说明), a 待写 marker and its
// actions. Generating means the chapter read; paper prose is never generated.
// materials: optional project materials by id, so one canvas render looks each up once.
export function renderBlockPlaceholder(host,block,{selectable=true,materials}={}) {
 const card=placeholderCard(U.p,block,placeholderOptions()),box=el('div',undefined,'block-placeholder');box.dataset.placeholderFor=block.id;box.setAttribute('role','group');box.setAttribute('aria-label','待写模块');
 const head=el('div',undefined,'block-placeholder-heading');head.append(el('span','待写','block-placeholder-badge'));box.append(head);
 const action=(label,fn,cls='quiet-action')=>{const control=button(label,event=>{event?.stopPropagation?.();return fn();},actions,cls);control.dataset.placeholderAction=label;return control;};
 const actions=el('div',undefined,'block-placeholder-actions');
 if(card.empty)head.append(el('strong','空白段落','block-placeholder-title'));
 for(const row of card.materials){const material=materials?materials.get(row.id):U.p.materials.find(item=>item.id===row.id);const title=el('strong',row.title,'block-placeholder-title');head.append(title);if(row.reference)head.append(el('small',row.reference,'block-placeholder-source'));if(row.summary){const summary=el('div',undefined,'block-placeholder-summary');if(U.E.renderContent)U.E.renderContent(summary,row.summary);else summary.textContent=row.summary;box.append(summary);}if(material){action('查看素材',()=>materialDetails(material));if(material.kind!=='idea')action('打开来源',()=>openMaterial(material));}}
 if(typeof U.refreshChapterReads==='function'&&!card.empty)action(THREAD_LABELS.updateChapterRead,()=>U.refreshChapterReads({onlyStale:false,sectionIDs:[block.sectionID]}));
 if(selectable)action('写入正文',()=>{if(block.locked)throw Error('此模块已锁定，请先解锁');if(canvasDisplayMode(U.p)==='read')U.chapterReads?.setView('text');U.selectBlock?.(block.id,{scroll:true});$('canvas').querySelector('[data-id="'+block.id+'"] .editable')?.focus({preventScroll:true});});
 const remove=action('移除',()=>{if(block.locked)throw Error('此模块已锁定，请先解锁');snapshot();U.p.blocks=U.p.blocks.filter(row=>row.id!==block.id);if(U.p.ui.blockID===block.id)U.p.ui.blockID=null;changed({editor:true});status('已移除待写模块，素材保留在素材库 · Ctrl+Z 撤销');});remove.disabled=!!block.locked;
 box.append(actions);host.prepend(box);return box;
}

function viewportAnchor(canvas) {
 const bounds=canvas.getBoundingClientRect(),node=[...canvas.querySelectorAll('.block')].find(node=>!node.hidden&&node.getBoundingClientRect().bottom>bounds.top+8);
 const page=node?.closest('.paper')||[...canvas.querySelectorAll('.paper')].find(page=>page.getBoundingClientRect().bottom>bounds.top+8);
 return {id:node?.dataset.id,sectionID:page?.dataset.section,offset:(node||page)?.getBoundingClientRect().top-bounds.top};
}

export function setCanvasDisplay(mode) {
 if(U.p.ui.assemblyFlowVersion>=2)return;
 if(!['materials','article','digest'].includes(mode)||canvasDisplayMode(U.p)===mode)return;
 if(U.composing){status('请先完成当前文字输入，再切换显示。');return;}
 const canvas=$('canvas'),anchor=viewportAnchor(canvas),scroll=canvas.scrollTop;
 U.formulaEditor?.flush?.();U.p.ui.canvasDisplay=mode;U.p.ui.scrollTop=scroll;syncCanvasDisplay();U.renderEditor();
 const block=anchor.id&&canvas.querySelector('[data-id="'+anchor.id+'"]');
 const target=block&&!block.hidden?block:[...canvas.querySelectorAll('.paper')].find(page=>page.dataset.section===anchor.sectionID);
 if(target&&Number.isFinite(anchor.offset))canvas.scrollTop+=target.getBoundingClientRect().top-canvas.getBoundingClientRect().top-anchor.offset;
 U.p.ui.scrollTop=canvas.scrollTop;canvas.classList.add('canvas-display-changing');clearTimeout(U.canvasDisplayTimer);
 U.canvasDisplayTimer=setTimeout(()=>canvas.classList.remove('canvas-display-changing'),180);persist();
}

export function installCanvasDisplay() {
 if(!document.querySelector('link[data-canvas-display-style]')){
  const link=el('link');link.rel='stylesheet';link.href=new URL('./canvas-display.css',import.meta.url).href;link.dataset.canvasDisplayStyle='true';
  link.onload=()=>{if(U.ready)U.renderEditor();};document.head.append(link);
 }
 $('canvas-display-mode')?.remove();$('canvas-display-select')?.remove();
 syncCanvasDisplay();
}
