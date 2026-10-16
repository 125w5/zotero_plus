import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assemblyTaskContext,assemblyTaskRequest} from '../../chrome/content/zotero/research/manuscript/assembly-task-context.mjs';
import {assertResearchPrompt} from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
const project=()=>({id:'p',title:'未命名论文',sections:[{id:'s',title:'方法'}],blocks:[],materials:[],ui:{sectionID:'s'}});
test('empty Enter advances the actual project discussion without writing manuscript words',()=>{
 const p=project(),before=JSON.stringify(p);assert.equal(assemblyTaskContext(p).stage,'direction');assert.match(assemblyTaskRequest(p).prompt,/研究方向/);assert.equal(JSON.stringify(p),before);
 p.title='独立批次验证';assert.equal(assemblyTaskContext(p).stage,'structure');p.materials=[{id:'m'}];assert.equal(assemblyTaskContext(p).stage,'materials');
 p.blocks=[{id:'b',sectionID:'s',assembly:true,text:'',materials:[{id:'m'},{id:'missing'}]}];p.ui.blockID='b';assert.deepEqual(assemblyTaskContext(p).materialIDs,['m']);
 p.blocks[0].text='人工填写的判断 $x_i^2$';assert.equal(assemblyTaskContext(p).stage,'block');assert.equal(assemblyTaskContext(p).currentTask,'素材内容讨论');assert.equal(assemblyTaskContext(p).userText,p.blocks[0].text);
});
test('typed prompt owns the current task and is not replaced by an inferred stage',()=>{
 const p=project(),text='请比较两个方案\n只看验证集';const request=assemblyTaskRequest(p,text);assert.equal(request.prompt,text);assert.equal(request.context.currentTask,'请比较两个方案 只看验证集');
 assert.equal(request.context.stage,'direction');assert.equal(p.blocks.length,0);
});
test('table discussion carries user cell text and context drops stale block bindings',()=>{
 const p=project();p.title='题目';p.ui.blockID='b';p.blocks=[{id:'b',sectionID:'s',type:'table',materials:[],table:{rows:[[{text:'实验'},{text:'隐藏',hidden:true}],[{text:'人工结果'}]]}}];
 assert.equal(assemblyTaskContext(p).userText,'实验\n人工结果');assert.equal(assemblyTaskContext(p).stage,'block');p.ui.blockID='gone';assert.equal(assemblyTaskContext(p).blockID,'');assert.equal(assemblyTaskContext(p).stage,'structure');
});
test('every inferred discussion can pass the actual authorship policy before it reaches the agent',()=>{
 const p=project(),requests=[assemblyTaskRequest(p)];p.title='独立批次验证';requests.push(assemblyTaskRequest(p));p.materials=[{id:'m'}];requests.push(assemblyTaskRequest(p));p.blocks=[{id:'b',sectionID:'s',text:'人工正文 $x_i$。',materials:[{id:'m'}]}];p.ui.blockID='b';requests.push(assemblyTaskRequest(p));
 for(const request of requests)assert.equal(assertResearchPrompt(request.prompt),request.prompt);
});
