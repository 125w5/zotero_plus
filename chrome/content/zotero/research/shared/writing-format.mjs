/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const FONT_SIZES=Object.freeze([8,10,12,14,18,24,36]);
export function fontSizeCommand(points){const value=Number(points);if(!FONT_SIZES.includes(value))throw Error('不支持的字号');return String(FONT_SIZES.indexOf(value)+1);}
export function fontSizePoints(value){const index=Number(value);return Number.isInteger(index)&&index>=1&&index<=7?FONT_SIZES[index-1]:null;}
export function styleFontSize(value){const match=String(value||'').match(/^(\d+(?:\.\d+)?)(pt|px)$/);if(!match)return null;const size=Number(match[1])*(match[2]==='px'?.75:1);return size>=6&&size<=72?size:null;}
export function splitListRuns(text,runs=[]){let start=0;return String(text||'').split('\n').map(line=>{let offset=0;const end=start+line.length,parts=runs.flatMap(run=>{const left=Math.max(start-offset,0),right=Math.min(end-offset,String(run.text||'').length);offset+=String(run.text||'').length;return right>left?[{...run,text:run.text.slice(left,right)}]:[];});start=end+1;return parts.length?parts:[{text:line}];});}
export function setParagraphLayout(block,patch){if(!block||block.locked||!['paragraph','heading','list'].includes(block.type))throw Error('请选择可编辑的文字段落');const next={};
 if('lineSpacing'in patch){const value=Number(patch.lineSpacing);if(![1,1.15,1.5,1.8,2].includes(value))throw Error('行距无效');next.lineSpacing=value;}
 if('indent'in patch){const value=Number(patch.indent);if(!Number.isFinite(value)||value<0||value>30)throw Error('缩进应为 0–30 mm');next.indent=value;}
 if('listStyle'in patch){if(!['bullet','number',null].includes(patch.listStyle))throw Error('列表类型无效');next.type=patch.listStyle?'list':'paragraph';next.listStyle=patch.listStyle||undefined;}
 if(Object.keys(next).every(key=>block[key]===next[key]))return false;Object.assign(block,next);block.revision=(block.revision||0)+1;return true;
}
