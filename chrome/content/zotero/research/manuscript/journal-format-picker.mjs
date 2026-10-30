/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {JOURNAL_FORMATS,JOURNAL_FORMAT_SCOPE,journalFormat,applyJournalFormat} from '../shared/journal-formats.mjs';

export function installJournalFormatPicker(U,{el,snapshot,changed,persist,status}){
 const doc=U.$('export').ownerDocument,host=U.$('export').parentElement;
 const link=el('link');link.rel='stylesheet';link.href=new URL('./journal-format-picker.css',import.meta.url).href;doc.head.append(link);
 const select=el('select');select.id='journal-format';select.className='journal-format-picker';select.setAttribute('aria-label','期刊稿件格式');
 for(const row of JOURNAL_FORMATS){const option=el('option',row.label);option.value=row.id;option.title=row.description;select.append(option);}host.prepend(select);
 function refresh(){const format=U.p.journalFormat;select.value=format?.id||'research';select.title='期刊稿件格式 · '+(JOURNAL_FORMATS.find(row=>row.id===select.value)?.description||'通用研究稿')+(U.p.template?.referenceDoc?'；版式沿用自定义 Word 模板':'');doc.body.dataset.journalFormat=format?.id||'';}
 async function setFormat(id){if(id===U.p.journalFormat?.id)return;const before=U.p.journalFormat?.id||'research';try{const selected=journalFormat(id);select.disabled=true;await U.E.manuscripts.ensureJournalStyle?.('http://www.zotero.org/styles/'+selected.style);snapshot();const format=applyJournalFormat(U.p,id);refresh();changed();await persist();status('已应用'+format.label+(U.p.template?.referenceDoc?'的引文规则；版式沿用自定义模板':'，导出 Word 时生效')+'；'+JOURNAL_FORMAT_SCOPE+' · Ctrl+Z 撤销');}catch(error){select.value=before;status(error.message,true);throw error;}finally{select.disabled=false;}}
 select.onchange=()=>setFormat(select.value).catch(()=>{});const api={select,refresh,setFormat};U.journalFormatPicker=api;refresh();return api;
}
