/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {materialType} from './material-catalog.mjs';
import {hasChinese} from './material-language.mjs';
export function materialViewSwitch(host,E,id,onChange){
 let group=host.querySelector('.material-view-switch');
 if(!group){const d=host.ownerDocument;group=d.createElement('div');group.className='material-view-switch';group.setAttribute('role','group');group.setAttribute('aria-label','素材显示方式');
  for(const [mode,label] of [['summary','中文简述'],['source','题目 · 分类']]){const b=d.createElement('button');b.type='button';b.textContent=label;b.dataset.mode=mode;b.onclick=async()=>{await E.notebook.update(id,{materialView:mode});onChange?.();};group.append(b);}host.append(group);}
 const mode=E.notebook.state(id).materialView||'summary';for(const b of group.children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));return mode;
}
export function materialDisplay(host,m,E,{mode='summary',type=materialType(m),reason='',snippet=''}={}){
 const d=host.ownerDocument,el=(tag,text,cls)=>{const n=d.createElement(tag);n.textContent=text;n.className=cls||'';return n;},A=E.manuscripts,origin=m.sourceType==='ai-illustration'?{title:'AI 生成示意图'}:E.materialSourceInfo(m);
 host.classList.add('material-display');host.dataset.display=mode;
 const name=A.titleFor?.(m)||(hasChinese(m.title)?m.title:type+'素材');
 if(mode==='source'){host.append(el('strong',origin.title,'material-heading'),el('small',type+' · '+name,'material-category'));}
 else{host.append(el('strong',name,'material-heading'));const summary=el('div',undefined,'material-excerpt');E.renderContent(summary,A.summaryFor(m));summary.title=A.summaryFor(m);host.append(summary);}
 if(m.sourceType==='ai-illustration')host.append(el('small','AI 生成示意图 · 构想，非论文证据','material-provenance material-origin-warning'));
 else{const line=E.appendMaterialProvenance(host,m);if(mode==='source')line.querySelector('.source-paper-title').textContent=Number.isInteger(m.pageIndex)?'PDF 第 '+(m.pageIndex+1)+' 页':type;}
 host.title=[name,A.summaryFor(m),origin.title,type,reason,snippet].filter(Boolean).join('\n');host.setAttribute('aria-label',name+'，'+type+'，'+A.summaryFor(m));
}
