/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {readEditableRuns} from './editable-runs.mjs';
// The visible cell text is authoritative. Old saved runs may still describe a
// previous edit and must never replace it on render, merge, or Word export.
export function tableCellRuns(cell){
 const text=String(cell.text??''),runs=Array.isArray(cell.runs)?cell.runs:null;
 return runs&&runs.every(run=>typeof run.text==='string')&&runs.map(run=>run.text).join('')===text?runs.map(run=>({...run})):text?[{text}]:[];
}
export function saveTableCellContent(cell,node){
 const runs=readEditableRuns(node);cell.runs=runs;cell.text=runs.map(run=>run.text).join('');return cell;
}
export function clearTableCellContent(cell){cell.text='';cell.runs=[];return cell;}
export function mergedTableCellContent(cells){
 const runs=[];for(const cell of cells){const parts=tableCellRuns(cell);if(!parts.length)continue;if(runs.length)runs.push({text:' '});runs.push(...parts);}
 return {text:runs.map(run=>run.text).join(''),runs};
}
