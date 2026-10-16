/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {tableCellRuns,saveTableCellContent,clearTableCellContent,mergedTableCellContent} from '../../chrome/content/zotero/research/shared/table-cell-content.mjs';
const text=value=>({nodeType:3,textContent:value});
const node=(tag,children,style={})=>({nodeType:1,nodeName:tag.toUpperCase(),childNodes:children,style,getAttribute:()=>null});
test('live cell edits preserve actual rich text and intact LaTeX while replacing saved old runs',()=>{
 const cell={text:'旧记录',runs:[{text:'旧记录',italic:true}],citationID:'real-source',align:'center'};
 saveTableCellContent(cell,node('div',[node('strong',[text('准确率 93%')]),text('，阈值 '),node('em',[text('$E_{\\mathrm{F}}=x_i^2$')]),node('br',[]),text('人工核对')]));
 assert.equal(cell.text,'准确率 93%，阈值 $E_{\\mathrm{F}}=x_i^2$\n人工核对');assert.deepEqual(cell.runs,[{text:'准确率 93%',bold:true},{text:'，阈值 '},{text:'$E_{\\mathrm{F}}=x_i^2$',italic:true},{text:'\n'},{text:'人工核对'}]);assert.equal(cell.citationID,'real-source');assert.equal(cell.align,'center');assert.equal(tableCellRuns(cell).map(run=>run.text).join(''),cell.text);
});
test('merging cells carries each trustworthy source run, its notation and style without sharing mutable runs',()=>{
 const first={text:'结果',runs:[{text:'结果',bold:true}]},second={text:'$x_i^2$',runs:[{text:'$x_i^2$',italic:true}]},before=structuredClone([first,second]);const merged=mergedTableCellContent([first,{text:'',runs:[]},second]);assert.equal(merged.text,'结果 $x_i^2$');assert.deepEqual(merged.runs,[{text:'结果',bold:true},{text:' '},{text:'$x_i^2$',italic:true}]);merged.runs[0].bold=false;assert.deepEqual([first,second],before);
});
test('cleared selected cells retain their relationships and cannot reveal earlier text through runs',()=>{
 const cell={text:'旧公式 $x_i$',runs:[{text:'旧公式 $x_i$',bold:true}],citationID:'paper'};clearTableCellContent(cell);assert.equal(cell.text,'');assert.deepEqual(cell.runs,[]);assert.deepEqual(tableCellRuns(cell),[]);assert.equal(cell.citationID,'paper');
});
test('legacy mismatched runs never replace the actual cell on rendering or merging',()=>{
 const cell={text:'最新值 $y_j$',runs:[{text:'旧值 $x_i$',bold:true}]},before=structuredClone(cell);assert.deepEqual(tableCellRuns(cell),[{text:'最新值 $y_j$'}]);assert.equal(mergedTableCellContent([cell,{text:'附注'}]).text,'最新值 $y_j$ 附注');assert.deepEqual(cell,before);
});
