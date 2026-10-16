/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {fontSizePoints,styleFontSize,splitListRuns} from './writing-format.mjs';
export function normalizeFontSizes(node){for(const font of node.querySelectorAll('font[size]')){const size=fontSizePoints(font.getAttribute('size'));if(size){font.style.fontSize=size+'pt';font.removeAttribute('size');}}}
export function readEditableRuns(node,{list=false}={}){
 const runs=[];
 const visit=(n,marks={})=>{
  if(n.nodeType===3){runs.push({text:n.textContent,...marks});return;}
  if(n.nodeType!==1)return;
  const tag=n.nodeName.toLowerCase(),next={...marks};
  for(const [tags,key]of [[['b','strong'],'bold'],[['i','em'],'italic'],[['u'],'underline'],[['s','strike','del'],'strike'],[['sup'],'sup'],[['sub'],'sub']])if(tags.includes(tag))next[key]=true;
  if(n.style.color||n.getAttribute('color'))next.color=n.style.color||n.getAttribute('color');
  if(n.style.fontFamily||n.getAttribute('face'))next.fontFamily=n.style.fontFamily||n.getAttribute('face');
  const size=styleFontSize(n.style.fontSize)||fontSizePoints(n.getAttribute('size'));if(size)next.fontSize=size;
  if(n.style.backgroundColor&&!['transparent','rgba(0, 0, 0, 0)'].includes(n.style.backgroundColor))next.highlight=n.style.backgroundColor;
  if(tag==='br'){runs.push({text:'\n'});return;}
  if(['div','p'].includes(tag)&&runs.length)runs.push({text:'\n'});
  for(const child of n.childNodes)visit(child,next);
 };
 if(list){const items=[...node.children];items.forEach((item,index)=>{if(index)runs.push({text:'\n'});for(const child of item.childNodes)visit(child);});}
 else for(const child of node.childNodes)visit(child);
 return runs;
}
export function appendEditableRuns(node,runs){
 const doc=node.ownerDocument;
 for(const run of runs){let span=doc.createElement('span');span.textContent=run.text;
  if(run.color)span.style.color=run.color;if(run.fontFamily)span.style.fontFamily=run.fontFamily;
  const size=Number.isFinite(run.fontSize)&&run.fontSize>=6&&run.fontSize<=72?run.fontSize:null;
  if(size&&!run.sup&&!run.sub)span.style.fontSize=size+'pt';
  if(run.highlight)span.style.backgroundColor=run.highlight;
  for(const [key,tag]of [['bold','strong'],['italic','em'],['underline','u'],['strike','s'],['sup','sup'],['sub','sub']])if(run[key]){const outer=doc.createElement(tag);outer.append(span);span=outer;}
  if(size&&(run.sup||run.sub)){const base=doc.createElement('span');base.style.fontSize=size+'pt';base.append(span);span=base;}
  node.append(span);
 }
}
export function renderEditableContent(node,block){
 if(block.type==='list')for(const runs of splitListRuns(block.text,block.runs)){const li=node.ownerDocument.createElement('li');appendEditableRuns(li,runs);node.append(li);}
 else if(block.runs?.length)appendEditableRuns(node,block.runs);
 else node.textContent=block.text||'';
}
