/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,button,status,snapshot,changed,persist,attachMaterial} from './main.mjs';
import {captureRange} from './assembly-tools.mjs';
import {sliceRuns} from '../shared/richtext.mjs';

export function formatSelection(command,value,range){
 const selection=window.getSelection();if(range){selection.removeAllRanges();selection.addRange(range);}
 const anchor=selection.anchorNode?.nodeType===1?selection.anchorNode:selection.anchorNode?.parentElement;
 const node=anchor?.closest('.editable'),b=U.p.blocks.find(b=>b.id===node?.closest('.block')?.dataset.id);
 if(!node||!b||b.locked)return;node.focus();if(range){selection.removeAllRanges();selection.addRange(range);}
 snapshot();U.formatting=true;try{document.execCommand(command,false,value??null);node.dispatchEvent(new Event('input',{bubbles:true}));}finally{U.formatting=false;U.lastTyping=0;}
 status('已更新文字格式 · Ctrl+Z 撤销');
}
export function breakParagraph(b,range=captureRange(b)){
 if(b.locked)throw Error('此段已锁定');snapshot();const runs=b.runs||[{text:b.text}],at=range.start;
 const next=U.M.block('paragraph',b.sectionID,{text:b.text.slice(at),runs:sliceRuns(runs,at,b.text.length),pageBreakBefore:true,emptyStarter:!b.text.slice(at),materials:U.M.clone(b.materials),assembly:b.assembly});
 b.text=b.text.slice(0,at);b.runs=sliceRuns(runs,0,at);b.emptyStarter=!b.text;b.revision++;
 U.p.blocks.splice(U.p.blocks.indexOf(b)+1,0,next);U.p.ui.blockID=next.id;U.p.ui.caret=0;changed({editor:true});focusBlock(next);status('已从光标处分页 · Ctrl+Z 撤销');
}
function focusBlock(b){const node=$('canvas').querySelector(`[data-id="${b.id}"] .editable`);node?.focus();node?.scrollIntoView({block:'nearest'});}
export function addAfter(b){snapshot();const next=U.M.block('paragraph',b.sectionID,{emptyStarter:true});U.p.blocks.splice(U.p.blocks.indexOf(b)+1,0,next);U.p.ui.blockID=next.id;U.p.ui.caret=0;changed({editor:true});focusBlock(next);}
export function paperPosition(page,y){
 const nodes=[...page.querySelectorAll(':scope > .block')];
 const following=nodes.find(n=>y<n.getBoundingClientRect().top+n.getBoundingClientRect().height/2);
 const previous=following?nodes[nodes.indexOf(following)-1]:nodes.at(-1);
 const reference=following||previous,at=U.p.blocks.findIndex(b=>b.id===reference?.dataset.id);
 const baseline=previous?.getBoundingClientRect().bottom||page.querySelector('h2').getBoundingClientRect().bottom;
 const distance=Math.max(0,(y-baseline)/(U.p.ui.paperZoom||1));
 return {index:at<0?U.p.blocks.length:at+(following?0:1),spaceBefore:Math.min(2,Math.floor(distance/28))*14};
}
export function placeOnPaper(page,e){
 const mid=e.dataTransfer?.getData('application/x-manuscript-material'),bid=e.dataTransfer?.getData('application/x-manuscript-block');
 if(e.type==='drop'&&!mid&&!bid)return;e.preventDefault();e.stopPropagation();const pos=paperPosition(page,e.clientY);snapshot();
 let b;if(bid){const i=U.p.blocks.findIndex(b=>b.id===bid);if(i<0){U.undo.pop();return;}b=U.p.blocks.splice(i,1)[0];if(i<pos.index)pos.index--;}
 else{b=U.M.block('paragraph',page.dataset.section,{assembly:!!mid,emptyStarter:!mid});if(mid)attachMaterial(b,mid);}
 b.sectionID=page.dataset.section;b.spaceBefore=pos.spaceBefore;U.p.blocks.splice(pos.index,0,b);U.p.ui.blockID=b.id;U.p.ui.caret=0;changed({editor:true});focusBlock(b);status(mid?'已在此处插入素材，保留来源；Ctrl+Z 撤销':'已插入正文段落；Ctrl+Z 撤销');
}
export function setPaperZoom(value){
 const canvas=$('canvas'),old=U.p.ui.paperZoom||1,zoom=Math.min(1.8,Math.max(.5,Math.round(value*20)/20));U.p.ui.paperZoom=zoom;
 for(const page of canvas.querySelectorAll('.paper'))page.style.zoom=zoom;
 canvas.scrollTop=canvas.scrollTop*zoom/old;$('paper-zoom').textContent=Math.round(zoom*100)+'%';persist();
}
export function installEditorInteractions(){
 const reset=button(Math.round((U.p.ui.paperZoom||1)*100)+'%',()=>setPaperZoom(1),document.querySelector('footer'),'paper-zoom');reset.id='paper-zoom';reset.title='Ctrl + 滚轮缩放论文页面；点击恢复 100%';
 $('canvas').addEventListener('wheel',e=>{if(!e.ctrlKey||e.deltaY===0)return;e.preventDefault();e.stopPropagation();setPaperZoom((U.p.ui.paperZoom||1)+(e.deltaY<0?.05:-.05));},{passive:false,capture:true});
 $('canvas').addEventListener('dblclick',e=>{if(e.target.closest('.block,button,input,textarea,h2'))return;const page=e.target.closest('.paper');if(page)placeOnPaper(page,e);});
 $('canvas').addEventListener('contextmenu',e=>{if(e.target.closest('.block'))return;const page=e.target.closest('.paper');if(!page)return;e.preventDefault();e.stopPropagation();document.querySelector('#assembly-context')?.remove();const menu=el('div',undefined,'assembly-context');menu.id='assembly-context';menu.style.left=Math.min(e.clientX,innerWidth-240)+'px';menu.style.top=Math.min(e.clientY,innerHeight-120)+'px';document.body.append(menu);button('在此处写正文',()=>{menu.remove();placeOnPaper(page,e);},menu);button('在此处新建一页',()=>{menu.remove();placeOnPaper(page,e);const b=U.p.blocks.find(b=>b.id===U.p.ui.blockID);b.pageBreakBefore=true;changed({editor:true});focusBlock(b);},menu);menu.onkeydown=k=>{if(k.key==='Escape'){k.stopPropagation();menu.remove();}};menu.querySelector('button').focus();});
}
