import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ASSEMBLY_COMMANDS,assemblyCommandsFor,assemblyRegionRect} from '../../chrome/content/zotero/research/manuscript/assembly-command-menu.mjs';
test('application commands can be found by slash prefix or the research task name',()=>{
 assert.equal(assemblyCommandsFor('/cap')[0].action,'capture');assert.equal(assemblyCommandsFor('核对')[0].action,'check');
 assert.equal(assemblyCommandsFor('论文')[0].action,'papers');assert.equal(assemblyCommandsFor('/').length,ASSEMBLY_COMMANDS.length);
 assert.equal(assemblyCommandsFor('/bash').length,0);assert.equal(assemblyCommandsFor('/write-paper').length,0);
});
test('source placement is an explicit application request and commands do not invent code executors',()=>{
 const row=ASSEMBLY_COMMANDS.find(c=>c.id==='insert');assert.match(row.prompt,/读取/);assert.match(row.prompt,/导入当前装配位置/);assert.match(row.prompt,/不写正文/);
 assert.deepEqual([...new Set(ASSEMBLY_COMMANDS.filter(c=>c.action).map(c=>c.action))].sort(),['capture','check','file','materials','papers','ppt']);
});
test('region selection normalizes reverse drags and clips both axes to the article viewport',()=>{
 const bounds={left:100,right:500,top:50,bottom:300};
 assert.deepEqual(assemblyRegionRect({x:490,y:290},{x:110,y:60},bounds),{x:110,y:60,width:380,height:230});
 assert.deepEqual(assemblyRegionRect({x:50,y:5},{x:600,y:400},bounds),{x:100,y:50,width:400,height:250});
 assert.deepEqual(assemblyRegionRect({x:530,y:330},{x:550,y:350},bounds),{x:500,y:300,width:0,height:0});
});
