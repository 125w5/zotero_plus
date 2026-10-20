/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,persist,status} from './main.mjs';

export const canvasDisplayMode = project => project?.ui?.assemblyFlowVersion>=2?(project.ui.step>=2?'article':'materials'):['article','digest'].includes(project?.ui?.canvasDisplay)?project.ui.canvasDisplay:'materials';

export function syncCanvasDisplay() {
 const mode=canvasDisplayMode(U.p);document.body.dataset.canvasDisplay=mode;
 for(const control of document.querySelectorAll('#canvas-display-mode button')) {
  const active=control.dataset.canvasDisplay===mode;control.setAttribute('aria-pressed',String(active));control.tabIndex=active?0:-1;
 }
 const compact=$('canvas-display-select');if(compact)compact.value=mode;
 U.selectionAssistant?.sync();
 return mode;
}

export function applyCanvasBlockDisplay(node,block) {
 // Empty material-only cards have no manuscript content. They can disappear
 // from the article view without removing their sources or saved block.
 node.hidden=canvasDisplayMode(U.p)==='article'&&block.assembly&&block.materials?.length>0
  &&['paragraph','heading','list'].includes(block.type)&&!String(block.text||'').trim()
  &&!(block.runs||[]).some(run=>String(run.text||'').trim());
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
