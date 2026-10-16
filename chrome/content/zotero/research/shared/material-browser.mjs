/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {explicitFormula} from './material-content.mjs';
import {installMediaPreview} from './media-preview.mjs';
export const AI_MODES = [
  {id:'auto',name:'自动',hint:'直接输入研究问题或整理要求'},
  {id:'search',name:'搜索资料',hint:'输入中文主题或方法名，优先搜索本地素材'},
  {id:'source',name:'来源问答',hint:'根据所选资料解释、比较或翻译'},
  {id:'evaluate',name:'Idea 与可行性',hint:'评估创新性、可行性并制定实验方案'},
  {id:'organize',name:'整理素材与布局',hint:'整理主题、逻辑与展示顺序，保留现有正文'}
];
export function resolveMode(mode, text, fallback='source') {
  if(mode && mode!=='auto')return AI_MODES.some(m=>m.id===mode)?mode:'source';
  return /可行性|创新性|实验方案|评估.*[Ii]dea|[Ii]dea.*评估|消融.*方案/.test(text)?'evaluate':/整理|归类|归组|排序|布局/.test(text)?'organize':AI_MODES.some(m=>m.id===fallback)?fallback:'source';
}
// Tab cycles only on the mode chip, or in an empty AI input. Shift+Tab always exits.
export function installModePicker(select,input,{value='auto',onChange=()=>{},modes=AI_MODES}={}) {
  for(const mode of modes){const o=select.ownerDocument.createElement('option');o.value=mode.id;o.textContent=mode.name;select.append(o);}
  select.value=modes.some(m=>m.id===value)?value:modes[0].id;
  const change=()=>{input.placeholder=modes.find(m=>m.id===select.value).hint;onChange(select.value);};
  select.onchange=change;
  const key=e=>{if(e.key!=='Tab'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.isComposing||e.keyCode===229)return;if(e.target===input&&(input.value||input.dataset.promptTemplates))return;e.preventDefault();e.stopPropagation();select.value=modes[(modes.findIndex(m=>m.id===select.value)+1)%modes.length].id;change();};
  select.addEventListener('keydown',key);input.addEventListener('keydown',key);
  input.placeholder=modes.find(m=>m.id===select.value).hint;
}
export function recentResults(results,state,query) {
  if(query?.trim())return results;
  const ids=state.recentMaterials||[];
  return [...results].sort((a,b)=>{const rank=m=>{const i=ids.indexOf(m.id);return i<0?ids.length:i;};return rank(a.m)-rank(b.m);});
}
// Recency chooses the initial order. Selecting a card or refreshing its
// summary must not reshuffle the list the user is already reading.
export function stableMaterialResults(results, priorIDs=[]) {
 const remaining=new Map(results.map(row=>[row.m.id,row])),ordered=[];
 for(const id of priorIDs){const row=remaining.get(id);if(row){ordered.push(row);remaining.delete(id);}}
 return [...ordered,...remaining.values()];
}
export function materialResultKey(query,state={}) {
 return JSON.stringify([query||'',state.topic||'',state.type||'',state.categoryID||'',state.sort||'relevance',Object.entries(state.facets||{}).sort(([a],[b])=>a.localeCompare(b))]);
}
export function captureMaterialViewport(host,list,{edge=host.getBoundingClientRect().top,selector='[data-material]'}={}) {
 const row=[...list.querySelectorAll(selector)].find(node=>node.getBoundingClientRect().bottom>edge);
 return {scrollTop:host.scrollTop,id:row?.dataset.material,offset:row?row.getBoundingClientRect().top-edge:0};
}
export function restoreMaterialViewport(host,list,viewport,{edge=host.getBoundingClientRect().top,selector='[data-material]'}={}) {
 if(!viewport)return false;
 const row=viewport.id&&[...list.querySelectorAll(selector)].find(node=>node.dataset.material===viewport.id);
 host.scrollTop=row?host.scrollTop+row.getBoundingClientRect().top-edge-viewport.offset:viewport.scrollTop;
 return !!row;
}
export function materialPreview(host,m,E,{compact=false,onOpenAnchor,onError=()=>{}}={}) {
  const doc=host.ownerDocument,create=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const locate=onOpenAnchor?()=>onOpenAnchor(m.anchor||m,m):E.library?.openSource&&m.anchor?.attachmentID?()=>E.library.openSource(m.anchor):null;
  if(m.imagePath){const img=create('img');img.className='material-thumbnail';img.alt=m.title||'素材图片';img.loading='lazy';host.append(img);E.previewImage(m.imagePath).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{img.replaceWith(create('small','图片暂时无法读取；原始记录保留'));});return installMediaPreview(img,{alt:img.alt,onLocate:locate,onError});}
  else if(m.data?.rows?.length){const table=create('table');table.className='material-table-preview';for(const [i,row] of m.data.rows.slice(0,compact?3:6).entries()){const tr=create('tr');for(const v of row.slice(0,5))tr.append(create(i?'td':'th',String(v??'')));table.append(tr);}host.append(table);}
  else if(m.kind==='formula'||m.category==='公式'){const formula=create('div'),latex=explicitFormula(m);formula.className='material-formula-preview';host.append(formula);if(latex.trim()){E.renderContent(formula,'$$\n'+latex+'\n$$');return installMediaPreview(formula,{content:()=>formula.cloneNode(true),alt:'公式预览',onLocate:locate,onError});}formula.append(create('small','查看原文公式'));if(locate){const open=create('button','定位原式');open.type='button';open.onclick=locate;formula.append(open);}}
  return ()=>{};
}
export function installSearchKeys(input,{results,selected,choose,activate,commit=()=>{},onError=()=>{}}) {
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
  input.addEventListener('keydown',async e=>{
    if(e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey)return;
    if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;e.preventDefault();e.stopPropagation();
    try {await commit();const rows=results();if(!rows.length)return;const i=rows.findIndex(r=>r.m.id===selected());
      if(e.key==='Enter'){const m=rows[Math.max(0,i)].m;await choose(m);await activate(m);}
      else await choose(rows[(i<0?e.key==='ArrowDown'?0:rows.length-1:(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length)].m);
    } catch(error){onError(error);}
  });
}
