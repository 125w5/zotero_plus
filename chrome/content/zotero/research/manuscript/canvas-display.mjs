/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,button,persist,status} from './main.mjs';
import {assemblyChatIcon} from './assembly-chat-context.mjs';

export const canvasDisplayMode = project => ['article','digest'].includes(project?.ui?.canvasDisplay) ? project.ui.canvasDisplay : 'materials';

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
 if(!$('canvas-display-mode')){
  const host=el('div');host.id='canvas-display-mode';host.setAttribute('role','group');host.setAttribute('aria-label','画布显示');
  for(const [mode,label]of [['materials','素材'],['digest','写作速读'],['article','正文']]){
   const control=button('',()=>setCanvasDisplay(mode),host);control.append(assemblyChatIcon(document,mode==='materials'?'file':mode==='digest'?'chat':'paper'),el('span',label));control.dataset.canvasDisplay=mode;
   control.title=mode==='materials'?'查看关联素材与手写内容':mode==='digest'?'通读分章节的写作速读，更新相关论证单元':'查看手写正文、图片、表格和公式';
  }
  const compact=el('select');compact.id='canvas-display-select';compact.setAttribute('aria-label','画布显示方式');for(const [mode,label]of [['materials','素材'],['digest','写作速读'],['article','正文']]){const option=el('option',label);option.value=mode;compact.append(option);}compact.onchange=()=>setCanvasDisplay(compact.value);host.append(compact);
  host.onkeydown=event=>{if(event.target===compact||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const modes=['materials','digest','article'],index=modes.indexOf(canvasDisplayMode(U.p)),mode=event.key==='Home'?modes[0]:event.key==='End'?modes[2]:modes[Math.max(0,Math.min(2,index+(event.key==='ArrowRight'?1:-1)))];setCanvasDisplay(mode);host.querySelector('[data-canvas-display="'+mode+'"]').focus();};
  const view=U.writingRibbon?.view||document.querySelector('.writing-ribbon-view');if(view)view.append(host);else $('toggle-right').before(host);
 }
 syncCanvasDisplay();
}
