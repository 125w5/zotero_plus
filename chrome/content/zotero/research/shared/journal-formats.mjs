/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const JOURNAL_FORMATS=Object.freeze([
	{id:'research',label:'通用研究稿',style:'apa',font:'Times New Roman',fontSize:11,lineSpacing:1.5,columns:1,margin:25.4,description:'A4、单栏、作者与年份引用'},
	{id:'nature',label:'Nature 系列研究稿',style:'nature',font:'Arial',fontSize:11,lineSpacing:2,columns:1,margin:25.4,description:'单栏双倍行距、顺序编码引用'},
	{id:'physical-review',label:'Physical Review 系列研究稿',style:'american-physics-society',font:'Times New Roman',fontSize:12,lineSpacing:2,columns:1,margin:25.4,description:'单栏双倍行距、物理学期刊引用'},
	{id:'ieee',label:'IEEE 会议双栏稿',style:'ieee',font:'Times New Roman',fontSize:10,lineSpacing:1,columns:2,margin:19,description:'双栏、顺序编码引用'}
]);
export function journalFormat(id){const value=JOURNAL_FORMATS.find(row=>row.id===id);if(!value)throw Error('请选择可用的期刊格式');return {...value};}
// Switch presentation and CSL rules without rewriting any authored text,
// evidence links or a user-selected reference.docx.
export function applyJournalFormat(project,id){const format=journalFormat(id);project.journalFormat=format;project.citationStyle='http://www.zotero.org/styles/'+format.style;project.template||={};return format;}
