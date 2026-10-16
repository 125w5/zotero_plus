// SPDX-License-Identifier: AGPL-3.0-or-later
// Real transport, Web streams and pinned Pi loop; provider responses are
// controlled fixtures. This is not a real model/network/Zotero UI acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPiChatStream, chatRequestStats } from '../../../chrome/content/zotero/research/shared/pi-chat-transport.mjs';
import { providerHTTPError } from '../../../chrome/content/zotero/research/shared/provider-error.mjs';
import { Agent, AssistantMessageEventStream } from '../../../chrome/content/zotero/research/vendor/pi-agent.mjs';

const model = { id: 'controlled-model', api: 'openai-completions', provider: 'fixture', maxTokens: 2000 };
const chunk = (delta = {}, finish_reason = null) => ({ id: 'response-1', model: 'fixture-response', choices: [{ index: 0, delta, finish_reason }] });
const frame = value => 'data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\r\n\r\n';
const finished = (...parts) => parts.map(frame).join('') + frame('[DONE]');
const reply = text => finished(chunk({ content: text }), chunk({}, 'stop'));
function response(text, split = 0) {
	const bytes = new TextEncoder().encode(text);
	return new Response(new ReadableStream({
		start(controller) {
			if (split) for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
			else controller.enqueue(bytes);
			controller.close();
		},
	}), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
function harness(replies = [], extra = {}) {
	const requests = [], progress = [];
	const streamFn = createPiChatStream({ endpoint: 'https://fixture.invalid/v1/', key: 'controlled-key', config: {}, EventStream: AssistantMessageEventStream,
		onProgress: value => progress.push(value),
		async request(url, options, timeout, readResponse) {
			requests.push({ url, options, payload: JSON.parse(options.body), timeout });
			const value = replies.shift();
			if (value instanceof Error) throw value;
			return readResponse(value instanceof Response ? value : response(value));
		}, ...extra });
	return { streamFn, requests, progress };
}
async function collect(stream) {
	const events = [];
	for await (const event of stream) events.push(event);
	return { events, result: await stream.result() };
}
const context = { systemPrompt: '以中文核验证据。', messages: [{ role: 'user', content: '研究问题', timestamp: 0 }], tools: [] };
test('request diagnostics contain only whitelisted parameters and numeric structure',async()=>{
 const sensitive='private-content https://private.invalid controlled-key',payload={model:sensitive,messages:[{role:'system',content:sensitive},{role:'user',content:[{type:'text',text:sensitive},{type:'image_url',image_url:{url:sensitive}}]},{role:'assistant',content:sensitive,tool_calls:[{id:sensitive,function:{name:sensitive,arguments:sensitive}}]},{role:'tool',content:sensitive,tool_call_id:sensitive}],tools:[{function:{name:sensitive}}],max_tokens:9000,stream:true,[sensitive]:sensitive};
 const stats=chatRequestStats(payload);assert.equal(stats.messageCount,4);assert.deepEqual(stats.roleCounts,{system:1,user:1,assistant:1,tool:1});assert.equal(stats.imageCount,1);assert.equal(stats.toolCallCount,1);assert.equal(stats.toolCount,1);assert.equal(stats.maxOutputTokens,9000);assert.equal(stats.textCharacters,sensitive.length*4);assert.ok(stats.requestBytes>stats.textCharacters);assert.doesNotMatch(JSON.stringify(stats),/private|controlled-key/);
 const observed=[],h=harness([reply('收到')],{onDiagnostics:value=>observed.push(value)});await collect(h.streamFn(model,context));assert.equal(observed.length,1);assert.equal(observed[0].requestIndex,1);assert.equal(observed[0].roleCounts.user,1);assert.doesNotMatch(JSON.stringify(observed),/研究问题|controlled-key|fixture.invalid/);
});
test('Pi preserves sanitized parameter diagnostics without retrying or exposing provider details',async()=>{
 const h=harness([providerHTTPError(400,{error:{code:'unsupported_parameter',param:'max_tokens',message:'Echo controlled-key and private prompt'}})]),{result}=await collect(h.streamFn(model,context));
 assert.equal(result.stopReason,'error');assert.equal(result.errorMessage,'服务返回 HTTP 400：接口不支持参数 max_tokens，请调整模型兼容设置');assert.doesNotMatch(result.errorMessage,/controlled-key|private/);assert.equal(h.requests.length,1);
});

test('Pi keeps a connected response parse failure distinct from a network failure', async () => {
 const message = '服务已连接，但返回内容无法读取，请重试', h = harness([Object.assign(new Error(message), {name: 'ProviderResponseError'})]);
 const {result} = await collect(h.streamFn(model,context));
 assert.equal(result.stopReason,'error'); assert.equal(result.errorMessage,message); assert.equal(h.requests.length,1);
 const unsafe = harness([Object.assign(new Error('private response text and key'),{name:'ProviderResponseError'})]);
 const failed = await collect(unsafe.streamFn(model,context)); assert.equal(failed.result.errorMessage,'无法连接服务，请检查网络或代理');
 assert.doesNotMatch(failed.result.errorMessage,/private|key/);
});

test('empty content and orphan tool results fail locally before an HTTP request',async()=>{
 for(const messages of [[{role:'user',content:[]}],[{role:'assistant',content:[{type:'thinking',thinking:'internal'}]}],[{role:'toolResult',toolCallId:'orphan',content:[{type:'text',text:'result'}]}],[{role:'assistant',content:[{type:'toolCall',id:'pending',name:'read_source',arguments:{}}]}]]){
  const diagnostics=[],h=harness([],{onDiagnostics:value=>diagnostics.push(value)}),{result}=await collect(h.streamFn(model,{systemPrompt:'核验来源',messages}));assert.equal(h.requests.length,0);assert.equal(result.stopReason,'error');assert.match(result.errorMessage,/对话消息格式不完整/);if(diagnostics.length)assert.ok(diagnostics[0].invalidToolMessageCount>0);
 }
});

test('actual SSE decoder handles UTF-8 byte splits, CRLF and complete Pi metadata', async () => {
	const usage = { choices: [], usage: { prompt_tokens: 16, completion_tokens: 7, total_tokens: 23, prompt_tokens_details: { cached_tokens: 5 } } };
	const h = harness([response(': keepalive\r\n\r\n' + finished(chunk({ role: 'assistant' }), chunk({ content: '中文：卷积' }), chunk({ content: '神经网络。' }), chunk({}, 'stop'), usage), 1)]);
	const stream = h.streamFn(model, context);
	assert.ok(stream instanceof AssistantMessageEventStream);
	const { events, result } = await collect(stream);
	assert.equal(result.content[0].text, '中文：卷积神经网络。');
	assert.equal(events[0].type, 'start');
	assert.equal(events.at(-1).type, 'done');
	assert.deepEqual(events.filter(e => e.type === 'text_delta').map(e => e.delta), ['中文：卷积', '神经网络。']);
	assert.equal(result.stopReason, 'stop');
	assert.equal(result.role, 'assistant');
	assert.equal(result.api, model.api);
	assert.equal(result.provider, model.provider);
	assert.equal(result.model, model.id);
	assert.equal(result.responseModel, 'fixture-response');
	assert.equal(result.responseId, 'response-1');
	assert.ok(Number.isFinite(result.timestamp));
	assert.deepEqual(result.usage, { input: 11, output: 7, cacheRead: 5, cacheWrite: 0, totalTokens: 23, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	assert.equal(h.requests[0].url, 'https://fixture.invalid/v1/chat/completions');
	assert.equal(h.requests[0].options.headers.Accept, 'text/event-stream');
	assert.equal(h.requests[0].payload.max_tokens, 2000);
	assert.equal(h.requests[0].payload.stream, true);
});

test('tool deltas assemble by index and execute through the actual pinned Pi loop', async () => {
	const calls = [], seen = [];
	const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
	const wire = finished(
		chunk({ tool_calls: [{ index: 1, id: 'call-', type: 'function', function: { name: 'read_', arguments: '{"query":' } }, { index: 0, id: 'first', type: 'function', function: { name: 'read_source', arguments: '{"query":"甲"}' } }] }),
		chunk({ tool_calls: [{ index: 1, id: 'second', function: { name: 'source', arguments: '"中文"}' } }] }), chunk({}, 'tool_calls'));
	const h = harness([response(wire, 3), reply('已读取两条原文。')]);
	const agent = new Agent({ initialState: { model, systemPrompt: '不要代写论文。', tools: [{ name: 'read_source', description: '读取来源', label: '来源', parameters: schema,
		async execute(id, args) { calls.push({ id, args }); return { content: [{ type: 'text', text: '来源：' + args.query }], details: { fixture: true } }; } }] }, streamFn: h.streamFn, toolExecution: 'sequential' });
	agent.subscribe(event => seen.push(event));
	await agent.prompt('读取两条原文');
	assert.deepEqual(calls, [{ id: 'first', args: { query: '甲' } }, { id: 'call-second', args: { query: '中文' } }]);
	assert.equal(h.requests.length, 2);
	const second = h.requests[1].payload.messages;
	const assistant = second.find(row => row.role === 'assistant');
	assert.deepEqual(assistant.tool_calls.map(call => [call.id, call.function.name, JSON.parse(call.function.arguments)]), [
		['first', 'read_source', { query: '甲' }], ['call-second', 'read_source', { query: '中文' }],
	]);
	assert.equal(assistant.content, null);
	assert.deepEqual(second.filter(row => row.role === 'tool').map(row => [row.tool_call_id, row.content]), [['first', '来源：甲'], ['call-second', '来源：中文']]);
	assert.deepEqual(h.requests[0].payload.tools[0].function.parameters, schema);
	assert.equal('execute' in h.requests[0].payload.tools[0].function, false);
	assert.equal(agent.state.messages.at(-1).content[0].text, '已读取两条原文。');
	assert.ok(seen.some(event => event.type === 'tool_execution_end' && !event.isError));
});

test('gateway identity snapshots across many argument frames execute one exact Pi tool call', async () => {
	const name = 'search_local_materials', id = 'gateway-stable-call', query = '按采集批次划分调制识别训练与测试，并仅用训练数据拟合预处理参数';
	const argumentsJSON = JSON.stringify({query}), fragments = [...argumentsJSON];
	assert.ok(fragments.length >= 10);
	const wire = finished(...fragments.map(part => chunk({tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: part}}]})), chunk({}, 'tool_calls'));
	const calls = [], h = harness([response(wire, 7), reply('已读取原始素材。')]);
	const agent = new Agent({initialState: {model, tools: [{name, label: '检索素材', description: '', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query'], additionalProperties: false},
		async execute(callID, args) {calls.push({id: callID, args}); return {content: [{type: 'text', text: '受控本机素材'}]};}}]}, streamFn: h.streamFn});
	await agent.prompt('推荐与数据划分相关的已有素材');
	assert.deepEqual(calls,[{id,args:{query}}]); assert.equal(h.requests.length,2);
	const next = h.requests[1].payload.messages.find(row => row.role === 'assistant').tool_calls;
	assert.deepEqual(next,[{id,type:'function',function:{name,arguments:argumentsJSON}}]);
	assert.equal(agent.state.messages.at(-1).stopReason,'stop');
});

test('partial and cumulative identity fields preserve declared names without duplicating snapshots', async () => {
	const tools = [{name:'search_local_materials',description:'',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}];
	const wire = finished(chunk({tool_calls:[{index:0,id:'prefix-',function:{name:'search_',arguments:'{"query":'}}]}),
		chunk({tool_calls:[{index:0,id:'prefix-whole',function:{name:'search_local_',arguments:'"中文"'}}]}),
		chunk({tool_calls:[{index:0,id:'prefix-whole',function:{name:'materials',arguments:'}'}}]}),chunk({},'tool_calls'));
	const h = harness([wire]), {result} = await collect(h.streamFn(model,{...context,tools}));
	assert.equal(result.stopReason,'toolUse');
	assert.deepEqual(result.content,[{type:'toolCall',id:'prefix-whole',name:'search_local_materials',arguments:{query:'中文'}}]);
});

test('changed bound identities, unknown names, oversized fields and conflicting terminal reasons never execute', async () => {
	const name = 'search_local_materials', other = 'read_selected_source', start = chunk({tool_calls:[{index:0,id:'stable',function:{name,arguments:'{"query":'}}]});
	const wires = [
		finished(start,chunk({tool_calls:[{index:0,id:'changed',function:{name,arguments:'"中文"}'}}]}),chunk({},'tool_calls')),
		finished(start,chunk({tool_calls:[{index:0,id:'stable-longer',function:{name,arguments:'"中文"}'}}]}),chunk({},'tool_calls')),
		finished(start,chunk({tool_calls:[{index:0,id:'stable',function:{name:other,arguments:'"中文"}'}}]}),chunk({},'tool_calls')),
		finished(chunk({tool_calls:[{index:0,id:'stable',function:{name:'undeclared_tool',arguments:'{}'}}]}),chunk({},'tool_calls')),
		finished(chunk({tool_calls:[{index:0,id:'x'.repeat(257),function:{name,arguments:'{}'}}]}),chunk({},'tool_calls')),
		finished(chunk({tool_calls:[{index:0,id:'stable',function:{name:'x'.repeat(65),arguments:'{}'}}]}),chunk({},'tool_calls')),
		finished(chunk({tool_calls:[{index:0,id:'stable',function:{name,arguments:'x'.repeat(256001)}}]}),chunk({},'tool_calls')),
		finished(chunk({tool_calls:[{index:0,id:'stable',function:{name,arguments:'{"query":"中文"}'}}]}),chunk({},'tool_calls'),chunk({},'stop')),
	];
	for (const wire of wires) {
		let executed = 0; const h = harness([wire]);
		const agent = new Agent({initialState:{model,tools:[name,other].map(toolName => ({name:toolName,label:toolName,description:'',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']},async execute(){executed++;return {content:[{type:'text',text:'must not run'}]};}}))},streamFn:h.streamFn});
		await agent.prompt('受控冲突测试'); assert.equal(executed,0); assert.equal(h.requests.length,1);
		assert.equal(agent.state.messages.at(-1).stopReason,'error'); assert.ok(!agent.state.messages.at(-1).content.some(part => part.type === 'toolCall'));
	}
});

test('Pi history converts user images, assistant calls and tool results without replaying internal details', async () => {
	const h = harness([reply('核验完成')]);
	await collect(h.streamFn(model, { systemPrompt: '系统说明', messages: [
		{ role: 'user', content: [{ type: 'text', text: '图中文字' }, { type: 'image', mimeType: 'image/png', data: 'AA==' }] },
		{ role: 'assistant', content: [{ type: 'thinking', thinking: '隐藏思考' }, { type: 'text', text: '先读取' }, { type: 'toolCall', id: 'c1', name: 'read_source', arguments: { id: 'E1' } }] },
		{ role: 'toolResult', toolCallId: 'c1', toolName: 'read_source', content: [{ type: 'text', text: '原文' }, { type: 'image', mimeType: 'image/png', data: 'BB==' }], details: { secret: 'never-send' }, isError: false },
	] }));
	const messages = h.requests[0].payload.messages;
	assert.deepEqual(messages[0], { role: 'system', content: '系统说明' });
	assert.equal(messages[1].content[1].image_url.url, 'data:image/png;base64,AA==');
	assert.equal(messages[2].content, '先读取');
	assert.equal('reasoning_content' in messages[2], false);
	assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'c1', content: '原文' });
	assert.equal(messages[4].content[0].image_url.url, 'data:image/png;base64,BB==');
	assert.doesNotMatch(JSON.stringify(messages), /never-send|隐藏思考/);
});

test('reasoning parameters require explicit provider capability and preserve thinking stream events', async () => {
	const h = harness([reply('一'), reply('二')], { config: { thinkingLevel: 'high' } });
	await collect(h.streamFn(model, context));
	await collect(h.streamFn(model, context));
	for (const req of h.requests) {
		assert.equal('reasoning_effort' in req.payload, false);
		assert.equal('thinking' in req.payload, false);
	}
	assert.deepEqual(h.progress, ['当前接口未声明思考参数支持，本轮未发送思考强度参数']);
	const known = harness([finished(chunk({ reasoning_content: '仅用于内部连续性' }), chunk({ content: '结论' }), chunk({}, 'stop'))], { config: { reasoningParameter: 'reasoning_effort', thinkingLevel: 'low', maxTokensParameter: 'max_completion_tokens', streamUsage: true } });
	const result = await collect(known.streamFn(model, context));
	assert.equal(known.requests[0].payload.reasoning_effort, 'low');
	assert.equal(known.requests[0].payload.max_completion_tokens, 2000);
	assert.equal('max_tokens' in known.requests[0].payload, false);
	assert.deepEqual(known.requests[0].payload.stream_options, { include_usage: true });
	assert.ok(result.events.some(event => event.type === 'thinking_delta'));
	assert.equal(result.result.content[0].thinking, '仅用于内部连续性');
	const disabled = harness([reply('普通回复')], { config: { reasoningParameter: 'thinking', thinkingLevel: 'off' } });
	await collect(disabled.streamFn(model, context));
	assert.deepEqual(disabled.requests[0].payload.thinking, { type: 'disabled' });
});

test('abort before headers completes the actual Pi stream even if an injected request is pending', async () => {
	let started;
	const ready = new Promise(resolve => started = resolve), abort = new AbortController();
	const h = harness([], { async request() { started(); return new Promise(() => {}); } });
	const stream = h.streamFn(model, context, { signal: abort.signal });
	await ready;
	abort.abort();
	const { events, result } = await collect(stream);
	assert.equal(result.stopReason, 'aborted');
	assert.equal(events.at(-1).type, 'error');
	assert.match(result.errorMessage, /已停止/);
});

test('abort while reading a response cancels its ReadableStream and preserves only safe text', async () => {
	let receive, cancelled = false;
	const abort = new AbortController();
	const r = new Response(new ReadableStream({ start(controller) { receive = controller; }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
	const h = harness([r]);
	const stream = h.streamFn(model, context, { signal: abort.signal });
	const consuming = collect(stream);
	await new Promise(resolve => setTimeout(resolve, 0));
	receive.enqueue(new TextEncoder().encode(frame(chunk({ content: '已接收' }))));
	await new Promise(resolve => setTimeout(resolve, 0));
	abort.abort();
	const { result } = await consuming;
	assert.equal(result.stopReason, 'aborted');
	assert.equal(result.content[0].text, '已接收');
	assert.equal(cancelled, true);
});

test('length preserves editable text but cannot execute truncated tool arguments', async () => {
	const h = harness([finished(chunk({ content: '已有内容' }), chunk({}, 'length'))]);
	const { result } = await collect(h.streamFn(model, context));
	assert.equal(result.stopReason, 'length');
	assert.equal(result.content[0].text, '已有内容');
	assert.match(h.progress[0], /输出上限/);
	let executed = 0;
	const truncated = harness([finished(chunk({ tool_calls: [{ index: 0, id: 'bad', type: 'function', function: { name: 'read_source', arguments: '{"id":' } }] }), chunk({}, 'length'))]);
	const agent = new Agent({ initialState: { model, tools: [{ name: 'read_source', label: '读来源', description: '', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, async execute() { executed++; } }] }, streamFn: truncated.streamFn });
	await agent.prompt('读取');
	assert.equal(executed, 0);
	assert.equal(agent.state.messages.at(-1).stopReason, 'error');
	assert.match(agent.state.errorMessage, /工具参数尚未完成/);
	assert.equal(agent.state.messages.at(-1).content.some(part => part.type === 'toolCall'), false);
});

test('malformed JSON, missing terminal markers, non-SSE bodies and provider errors end safely', async () => {
	const values = [
		frame('{broken-secret-raw'),
		frame(chunk({ content: '未完成' })),
		frame(chunk({ content: '少终止标记' })) + frame(chunk({}, 'stop')),
		frame('[DONE]'),
		finished({ error: { message: 'secret-provider-error', key: 'controlled-key' } }),
		new Response('secret-html', { headers: { 'content-type': 'text/html' } }),
		new Error('secret-network-raw controlled-key'),
	];
	for (const value of values) {
		const h = harness([value]);
		const { events, result } = await collect(h.streamFn(model, context));
		assert.equal(events.at(-1).type, 'error');
		assert.equal(result.stopReason, 'error');
		assert.doesNotMatch(result.errorMessage, /secret|controlled-key|broken/);
		assert.match(result.errorMessage, /模型|服务/);
	}
});

test('complete but malformed or non-object tool arguments never execute', async () => {
	for (const args of ['{"query":', '[]', 'null']) {
		const h = harness([finished(chunk({ tool_calls: [{ index: 0, id: 'bad', function: { name: 'read_source', arguments: args } }] }), chunk({}, 'tool_calls'))]);
		const { result } = await collect(h.streamFn(model, context));
		assert.equal(result.stopReason, 'error');
		assert.match(result.errorMessage, /工具参数不完整/);
		assert.equal(result.content.some(part => part.type === 'toolCall'), false);
	}
});

test('factory turn budget terminates the actual Pi loop without another provider request', async () => {
	let executed = 0;
	const toolReply = finished(chunk({ tool_calls: [{ index: 0, id: 'next', type: 'function', function: { name: 'read_source', arguments: '{}' } }] }), chunk({}, 'tool_calls'));
	const h = harness([toolReply, toolReply], { maxTurns: 2 });
	const agent = new Agent({ initialState: { model, tools: [{ name: 'read_source', label: '读取', description: '', parameters: { type: 'object', properties: {}, additionalProperties: false }, async execute() { executed++; return { content: [{ type: 'text', text: '继续' }], details: {} }; } }] }, streamFn: h.streamFn });
	await agent.prompt('读取');
	assert.equal(h.requests.length, 2);
	assert.equal(executed, 2);
	assert.equal(agent.state.messages.at(-1).stopReason, 'error');
	assert.match(agent.state.errorMessage, /处理上限/);
});
