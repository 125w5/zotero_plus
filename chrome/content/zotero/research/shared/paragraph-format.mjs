/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const PARAGRAPH_ALIGNMENTS=Object.freeze(['left','center','right','justify']);
const paragraphTypes=new Set(['paragraph','heading','list']);
export function paragraphAlignment(block){return PARAGRAPH_ALIGNMENTS.includes(block?.textAlign)?block.textAlign:'left';}
export function carryParagraphFormat(block){return {...(PARAGRAPH_ALIGNMENTS.includes(block?.textAlign)?{textAlign:block.textAlign}:{}),...([1,1.15,1.5,1.8,2].includes(block?.lineSpacing)?{lineSpacing:block.lineSpacing}:{}),...(Number.isFinite(block?.indent)&&block.indent>=0&&block.indent<=30?{indent:block.indent}:{})};}
export function setParagraphAlignment(block,value){
 if(!PARAGRAPH_ALIGNMENTS.includes(value))throw Error('不支持的段落对齐方式');
 if(!block||!paragraphTypes.has(block.type))throw Error('请选择正文、标题或列表段落');
 if(block.locked)throw Error('此段已锁定，请先解锁');
 if(block.textAlign===value)return false;block.textAlign=value;block.revision=(block.revision||0)+1;return true;
}
