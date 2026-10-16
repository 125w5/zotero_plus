/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {renderEditableContent,readEditableRuns} from '../shared/editable-runs.mjs';

const expression=/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;
export function editableMathTokens(text){return [...String(text||'').matchAll(expression)].map(match=>{const source=match[0],display=source.startsWith('$$')||source.startsWith('\\[');return {index:match.index,source,latex:source.slice(display?2:source.startsWith('\\(')?2:1,display?-2:source.startsWith('\\(')?-2:-1),display};});}

// Typeset only the reading DOM. Focus rebuilds the untouched source/rich runs
// before any editing, selection offsets, formatting or serialization occurs.
export function installEditableMath(node,block,{katex,onRead=()=>{}}={}){
 const doc=node.ownerDocument,win=doc.defaultView;
 const source=()=>{if(block.locked||node.dataset.mathPreview!=='true')return;node.replaceChildren();renderEditableContent(node,block);delete node.dataset.mathPreview;node.contentEditable='true';};
 const preview=()=>{
  if(!katex?.render||!editableMathTokens(block.text).length)return;
  delete node.dataset.mathPreview;node.contentEditable=String(!block.locked);
  node.replaceChildren();renderEditableContent(node,block);
  const walker=doc.createTreeWalker(node,win.NodeFilter.SHOW_TEXT),leaves=[];let leaf,offset=0;while((leaf=walker.nextNode())){leaves.push({node:leaf,start:offset,end:offset+leaf.length});offset+=leaf.length;}
  const point=(index,end=false)=>{const leaf=leaves.find(leaf=>end?index>leaf.start&&index<=leaf.end:index>=leaf.start&&index<leaf.end);return leaf?[leaf.node,index-leaf.start]:null;};
  let count=0;for(const token of editableMathTokens(node.textContent).reverse()){
   const start=point(token.index),end=point(token.index+token.source.length,true);if(!start||!end||start[0].parentElement.closest('li')!==end[0].parentElement.closest('li'))continue;
   const range=doc.createRange();range.setStart(...start);range.setEnd(...end);const math=doc.createElement('span');math.dataset.editableMath=token.source;math.contentEditable='false';katex.render(token.latex,math,{displayMode:token.display,throwOnError:false,trust:false,strict:'ignore'});range.deleteContents();range.insertNode(math);count++;
  }
  if(count){node.dataset.mathPreview='true';node.contentEditable='false';onRead();}
 };
 node.tabIndex=0;
 node.addEventListener('focus',source);
 node.addEventListener('blur',event=>{if(!event.relatedTarget?.closest?.('.writing-ribbon'))preview();});
 node.addEventListener('copy',event=>{
  if(node.dataset.mathPreview!=='true')return;
  const selection=win.getSelection();if(!selection?.rangeCount||selection.isCollapsed||!node.contains(selection.anchorNode)||!node.contains(selection.focusNode))return;
  // A selection can begin inside KaTeX's glyph DOM. Copy that mathematical
  // atom as a complete expression so either endpoint still yields valid TeX.
  const range=selection.getRangeAt(0).cloneRange(),atomFor=point=>(point.nodeType===1?point:point.parentElement)?.closest('[data-editable-math]'),start=atomFor(range.startContainer),end=atomFor(range.endContainer);
  if(start&&node.contains(start))range.setStartBefore(start);
  if(end&&node.contains(end))range.setEndAfter(end);
  const fragment=range.cloneContents(),atoms=fragment.querySelectorAll('[data-editable-math]');if(!atoms.length)return;
  for(const atom of atoms)atom.replaceWith(doc.createTextNode(atom.dataset.editableMath));
  const list=fragment.children.length>0&&[...fragment.children].every(child=>child.tagName==='LI'),text=readEditableRuns(fragment,{list}).map(run=>run.text).join('');event.clipboardData.setData('text/plain',text);event.preventDefault();
 });
 preview();return {preview,source};
}
