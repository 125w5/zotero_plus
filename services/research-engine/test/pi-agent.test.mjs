// SPDX-License-Identifier: AGPL-3.0-or-later
// These exercise the real pinned Pi loop with controlled protocol responses.
// They do not make model/network calls or count as native Zotero acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantMessageEventStream} from '@mariozechner/pi-ai';
import {createRuntime, planningPrompt} from '../src/runtime.mjs';

const model = {id:'controlled-fixture', name:'Controlled fixture', api:'openai-completions',
  provider:'fixture', baseUrl:'https://invalid.example', reasoning:false, input:['text'],
  cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:16000,maxTokens:1000};
const evidence = [{id:'E1',text:'Controlled evidence fixture.'}];
const plan = {version:1,title:'受控汇报',slides:[{kind:'text',title:'已核实的证据',bullets:['受控测试内容'],sources:['E1']}]};
const message = (content, stopReason='stop') => ({role:'assistant',content,api:model.api,
  provider:model.provider,model:model.id,stopReason,timestamp:Date.now(),
  usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
function completed(content, stopReason='stop') {
  const stream = createAssistantMessageEventStream(), result=message(content,stopReason);
  stream.push({type:'start',partial:result});
  stream.push({type:'done',reason:stopReason,message:result});
  return stream;
}

test('actual Pi executes allowlisted validation and feeds the result into the next turn',async()=>{
  let requests=0;
  const progress=[], events=[];
  const runtime=await createRuntime({model,evidence,onEvent:e=>progress.push(e),onAgentEvent:e=>events.push(e),
    streamFn(_model,context) {
      assert.equal(_model.id,model.id);
      assert.equal(context.tools.length,2);
      assert.match(context.systemPrompt,/不代写论文正文/);
      requests++;
      if(requests===1) return completed([{type:'toolCall',id:'validate-1',name:'validate_research_plan',arguments:{plan}}],'toolUse');
      const result=context.messages.at(-1);
      assert.equal(result.role,'toolResult');
      assert.equal(result.toolCallId,'validate-1');
      assert.equal(result.isError,false);
      assert.equal(result.details,true);
      return completed([{type:'text',text:'来源核对完成。'}]);
    }});
  try {
    const transcript=await runtime.run('核对现有汇报证据');
    assert.equal(requests,2);
    assert.equal(transcript.at(-1).content[0].text,'来源核对完成。');
    assert.deepEqual(progress.map(e=>e.status),['running','completed']);
    assert.ok(events.some(e=>e.type==='tool_execution_end' && !e.isError));
    assert.equal(events.at(-1).type,'agent_end');
    assert.equal(runtime.agent.state.isStreaming,false);
  } finally {await runtime.dispose();}
});

test('actual Pi schema rejects malformed arguments without executing the tool',async()=>{
  const progress=[];
  let requests=0;
  const runtime=await createRuntime({model,evidence,onEvent:e=>progress.push(e),streamFn(_model,context) {
    if(++requests===1) return completed([{type:'toolCall',id:'bad-1',name:'validate_research_plan',arguments:{plan:'not an object'}}],'toolUse');
    assert.equal(context.messages.at(-1).isError,true);
    assert.match(context.messages.at(-1).content[0].text,/Validation failed/);
    return completed([{type:'text',text:'参数需要修正。'}]);
  }});
  try {
    await runtime.run('核对');
    assert.equal(progress.length,0);
    await assert.rejects(runtime.call('validate_research_plan',{}),/Validation failed/);
    await assert.rejects(runtime.call('delete_file',{path:'ignored'}),/未开放/);
  } finally {await runtime.dispose();}
});

test('explicit abort terminates a streaming run and preserves an aborted transcript',async()=>{
  let started;
  const ready=new Promise(resolve=>started=resolve);
  const runtime=await createRuntime({model,streamFn(_model,_context,{signal}) {
    const stream=createAssistantMessageEventStream();
    stream.push({type:'start',partial:message([])});
    signal.addEventListener('abort',()=>{
      stream.push({type:'error',reason:'aborted',error:{...message([],'aborted'),errorMessage:'操作已停止。'}});
    },{once:true});
    started();
    return stream;
  }});
  const running=runtime.run('研究问题');
  await ready;
  runtime.abort();
  await running;
  assert.equal(runtime.agent.state.isStreaming,false);
  assert.equal(runtime.agent.state.messages.at(-1).stopReason,'aborted');
  await runtime.dispose();
  await assert.rejects(runtime.run('继续'),/已经关闭/);
});

test('direct tool abort and absent API configuration cannot silently call providers',async()=>{
  const progress=[];
  const runtime=await createRuntime({evidence,onEvent:e=>progress.push(e)});
  try {
    await assert.rejects(runtime.run('核对'),/明确的模型/);
    const abort=new AbortController();abort.abort();
    await assert.rejects(runtime.call('validate_research_plan',{plan},{signal:abort.signal}),{name:'AbortError'});
    assert.equal(progress.at(-1).status,'failed');
    assert.match((await runtime.prompt()).sections[0].text,/组会/);
    assert.doesNotMatch(planningPrompt,/导师追问/);
  } finally {await runtime.dispose();}
});

test('Gecko ESM bundle exports upstream classes and runs schema-validated tools without provider SDKs',async()=>{
  const {Agent,AssistantMessageEventStream,createAssistantMessageEventStream:makeStream}=
    await import('../../../chrome/content/zotero/research/vendor/pi-agent.mjs');
  assert.ok(makeStream() instanceof AssistantMessageEventStream);
  let called=0,rounds=0;
  const agent=new Agent({initialState:{model,tools:[{
    name:'source_read',label:'读取来源',description:'受控本地来源',
    parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
    async execute(_id,args) {called++;return {content:[{type:'text',text:args.id}],details:{sourceID:args.id}};}
  }]},streamFn(_model,context) {
    const s=makeStream();
    const result=++rounds===1?message([{type:'toolCall',id:'r1',name:'source_read',arguments:{id:'E1'}}],'toolUse'):
      message([{type:'text',text:context.messages.at(-1).content[0].text}]);
    s.push({type:'start',partial:result});s.push({type:'done',reason:result.stopReason,message:result});return s;
  }});
  await agent.prompt('读取来源');
  assert.equal(called,1);
  assert.equal(agent.state.messages.at(-1).content[0].text,'E1');
  const unconfigured=new Agent({initialState:{model}});
  await unconfigured.prompt('不发起默认网络调用');
  assert.equal(unconfigured.state.messages.at(-1).stopReason,'error');
  assert.match(unconfigured.state.errorMessage,/API 传输接口/);
});
