/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const AI_MODES = [
  {id:'auto',name:'自动',hint:'直接输入问题或写作目标'},
  {id:'search',name:'搜索资料',hint:'输入中文主题或方法名，优先搜索本地素材'},
  {id:'source',name:'来源问答',hint:'根据所选资料解释、比较或翻译'},
  {id:'evaluate',name:'Idea 与可行性',hint:'评估创新性、可行性并制定实验方案'},
  {id:'write',name:'正文共创',hint:'根据当前上下文补全正文'}
];
export function resolveMode(mode, text, fallback='source') {
  if(mode && mode!=='auto')return mode;
  return /可行性|创新性|实验方案|评估.*[Ii]dea|[Ii]dea.*评估|消融.*方案/.test(text)?'evaluate':fallback;
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
export function materialPreview(host,m,E,{compact=false}={}) {
  const doc=host.ownerDocument,create=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  if(m.imagePath){const img=create('img');img.className='material-thumbnail';img.alt=m.summary||m.title;img.loading='lazy';host.append(img);E.previewImage(m.imagePath).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{img.replaceWith(create('small','图片暂时无法读取；原始记录保留'));});}
  else if(m.data?.rows?.length){const table=create('table');table.className='material-table-preview';for(const [i,row] of m.data.rows.slice(0,compact?3:6).entries()){const tr=create('tr');for(const v of row.slice(0,5))tr.append(create(i?'td':'th',String(v??'')));table.append(tr);}host.append(table);}
  else if(m.kind==='formula'||m.category==='公式'){const formula=create('div');E.renderContent(formula,'$$\n'+(m.latex||m.sourceText)+'\n$$');host.append(formula);}
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
