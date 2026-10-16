/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Commands expose application operations; they never accept shell code.
export const ASSEMBLY_COMMANDS=Object.freeze([
 {id:'materials',label:'选择素材',description:'把素材附入当前对话',action:'materials',icon:'paper'},
 {id:'paper',label:'选择论文',description:'读取文库中已有的论文附件',action:'papers',icon:'paper'},
 {id:'file',label:'添加文件',description:'PDF、DOCX、图片或文本',action:'file',icon:'file'},
 {id:'search',label:'文献搜集',description:'检索与当前问题相关的论文',prompt:'请结合当前项目讨论的问题检索相关文献，说明具体相关性并保留实际来源。不要生成论文正文。',icon:'paper'},
 {id:'capture',label:'截取文章区域',description:'框选当前文章，附入图片',action:'capture',icon:'camera'},
 {id:'insert',label:'导入当前位置',description:'读取已选素材后插入来源框',prompt:'请读取我附加或选中的素材，并导入当前装配位置。保留来源，不写正文。',icon:'plus'},
 {id:'evidence',label:'核对装配证据',description:'检查实际引用及缺失证据',action:'check',icon:'shield'},
 {id:'organize',label:'整理素材',description:'依据实际素材提出分组方案',prompt:'请读取当前项目素材，并按问题、方法、实验和结果整理，给出可核对的素材分组建议。不要生成论文正文。',icon:'tools'},
 {id:'order',label:'调整素材顺序',description:'讨论当前章节的论证顺序',prompt:'请读取当前章节及已有素材，建议它们在论证中的排列顺序，保留来源，不写论文正文。',icon:'tools'},
 {id:'evaluate',label:'评估实验方案',description:'读取证据，比较验证方法与缺口',prompt:'请依据当前项目和已有论文评估实验方案，具体说明数据划分、对照条件、可检验的判断与缺失证据。不要生成论文正文。',icon:'shield'},
 {id:'ppt',label:'组会 PPT',description:'打开应用内的汇报流程',action:'ppt',icon:'slides'}
]);
export function assemblyCommandsFor(value,commands=ASSEMBLY_COMMANDS){
 const query=String(value||'').trim().replace(/^\//u,'').normalize('NFKC').toLowerCase();
 return commands.filter(row=>[row.id,row.label,row.description].some(text=>text.normalize('NFKC').toLowerCase().includes(query)));
}
export function assemblyRegionRect(start,end,bounds){
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const x=clamp(Math.min(start.x,end.x),bounds.left,bounds.right),y=clamp(Math.min(start.y,end.y),bounds.top,bounds.bottom);
 return {x,y,width:Math.max(0,clamp(Math.max(start.x,end.x),bounds.left,bounds.right)-x),height:Math.max(0,clamp(Math.max(start.y,end.y),bounds.top,bounds.bottom)-y)};
}
